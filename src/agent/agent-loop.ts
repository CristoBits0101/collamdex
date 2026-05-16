import * as vscode from "vscode";

import { CapacityPolicy } from "../capacity/capacity-policy.js";
import type { CollamdexConfig } from "../config/extension-config.js";
import { OllamaClient } from "../ollama/ollama-client.js";
import { OllamaModelService } from "../ollama/ollama-model-service.js";
import { getActiveEditorContext } from "../workspace/active-editor-context.js";
import { getDiagnosticsContext } from "../workspace/diagnostics-context.js";
import { PatchPreviewService } from "../workspace/patch-preview-service.js";
import { createDefaultAgentPermissions } from "./agent-permissions.js";
import type { AgentRunOptions, AgentRunResult } from "./agent-state.js";
import { defaultAgentTools } from "./tool-registry.js";

export class AgentRuntime {
  private abortController: AbortController | undefined;

  public constructor(
    private readonly client: OllamaClient,
    private readonly modelService: OllamaModelService,
    private readonly capacityPolicy: CapacityPolicy,
    private readonly patchPreviewService: PatchPreviewService,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly getConfig: () => CollamdexConfig
  ) {}

  public cancel(): void {
    this.abortController?.abort();
    this.abortController = undefined;
  }

  public async runEditorAction(action: AgentRunOptions["action"]): Promise<void> {
    const result = await this.run({ action });

    if (!result) {
      return;
    }

    if (action === "fix" || action === "generate-tests") {
      await this.patchPreviewService.showPatch(`Collamdex - ${result.model}`, result.text);
      return;
    }

    await this.patchPreviewService.showMarkdown(`Collamdex - ${result.model}`, result.text);
  }

  public async runTask(task: string): Promise<AgentRunResult | undefined> {
    return this.run({ action: "task", task });
  }

  private async run(options: AgentRunOptions): Promise<AgentRunResult | undefined> {
    const modelName = await this.modelService.ensureSelectedModel();

    if (!modelName) {
      return undefined;
    }

    const model = await this.modelService.findModel(modelName);

    if (model) {
      const decision = this.capacityPolicy.evaluate(model);

      if (decision.status === "blocked") {
        const answer = await vscode.window.showWarningMessage(
          decision.message,
          { modal: true },
          "Usar bajo mi responsabilidad"
        );

        if (answer !== "Usar bajo mi responsabilidad") {
          return undefined;
        }
      }
    }

    const isHealthy = await this.client.healthCheck();

    if (!isHealthy) {
      void vscode.window.showErrorMessage(
        "Ollama no esta disponible. Inicia Ollama y vuelve a intentarlo."
      );
      return undefined;
    }

    const config = this.getConfig();
    const prompt = this.buildPrompt(options);
    let text = "";

    this.abortController = new AbortController();
    this.outputChannel.clear();
    this.outputChannel.show(true);
    this.outputChannel.appendLine(`Collamdex usando modelo: ${modelName}`);
    this.outputChannel.appendLine("");

    await vscode.window.withProgress(
      {
        cancellable: true,
        location: vscode.ProgressLocation.Notification,
        title: "Collamdex esta trabajando"
      },
      async (_progress, token) => {
        token.onCancellationRequested(() => this.cancel());

        await this.client.streamChat(
          {
            keep_alive: config.keepAlive,
            messages: [
              {
                content: this.getSystemPrompt(),
                role: "system"
              },
              {
                content: prompt,
                role: "user"
              }
            ],
            model: modelName,
            options: {
              num_ctx: config.numCtx,
              temperature: config.temperature
            },
            stream: true
          },
          (chunk) => {
            text += chunk;
            this.outputChannel.append(chunk);
          },
          this.abortController?.signal
        );
      }
    );

    this.abortController = undefined;
    return {
      model: modelName,
      text
    };
  }

  private buildPrompt(options: AgentRunOptions): string {
    const config = this.getConfig();
    const editorContext = getActiveEditorContext(config.maxPromptChars);
    const diagnostics = getDiagnosticsContext(Math.min(config.maxPromptChars, 12000));
    const permissions = createDefaultAgentPermissions(config.agentMaxIterations);

    const task = this.getTaskInstruction(options);

    return [
      `Tarea: ${task}`,
      "",
      "Permisos:",
      `- Leer workspace: ${permissions.allowReadWorkspace}`,
      `- Escribir sin confirmacion: ${permissions.allowWriteWithoutConfirmation}`,
      `- Terminal sin confirmacion: ${permissions.allowTerminalWithoutConfirmation}`,
      `- Iteraciones maximas: ${permissions.maxIterations}`,
      "",
      "Herramientas disponibles en esta version:",
      ...defaultAgentTools.map(
        (tool) =>
          `- ${tool.name}: ${tool.description} Confirmacion: ${tool.requiresConfirmation ? "si" : "no"}`
      ),
      "",
      "Contexto del editor:",
      editorContext
        ? [
            `Ruta: ${editorContext.relativePath}`,
            `Lenguaje: ${editorContext.languageId}`,
            `Hay seleccion: ${editorContext.hasSelection}`,
            "",
            "Seleccion:",
            editorContext.selectedText || "[sin seleccion]",
            "",
            "Archivo:",
            editorContext.documentText
          ].join("\n")
        : "[sin editor activo]",
      "",
      "Diagnosticos:",
      diagnostics
    ].join("\n");
  }

  private getTaskInstruction(options: AgentRunOptions): string {
    switch (options.action) {
      case "explain":
        return "Explica la seleccion o el archivo activo de forma clara y util.";
      case "fix":
        return "Propone un fix para la seleccion o el archivo activo. Devuelve preferiblemente un patch unificado.";
      case "generate-tests":
        return "Genera tests para el archivo activo. Devuelve el codigo propuesto y explica donde colocarlo.";
      case "review":
        return "Revisa el archivo activo. Prioriza bugs, riesgos, regresiones y tests faltantes.";
      case "task":
        return options.task ?? "Resuelve la tarea indicada por el usuario.";
    }
  }

  private getSystemPrompt(): string {
    return [
      "Eres Collamdex, un agente local de codificacion dentro de VS Code.",
      "Trabajas con modelos Ollama locales y no dependes de servicios externos.",
      "Responde en espanol cuando expliques, pero conserva codigo, APIs y errores en su idioma original.",
      "No inventes archivos que no has recibido.",
      "Si propones cambios, devuelve un resumen breve y un patch unificado o bloque verificable.",
      "No pidas ejecutar comandos destructivos.",
      "Cualquier escritura o comando de terminal requiere confirmacion del usuario."
    ].join("\n");
  }
}
