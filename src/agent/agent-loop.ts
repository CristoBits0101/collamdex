import * as vscode from "vscode";

import { CapacityPolicy } from "../capacity/capacity-policy.js";
import type { CollamdexConfig } from "../config/extension-config.js";
import { OllamaClient, type OllamaChatResult } from "../ollama/ollama-client.js";
import { OllamaModelService } from "../ollama/ollama-model-service.js";
import { getActiveEditorContext, limitText } from "../workspace/active-editor-context.js";
import { getDiagnosticsContext } from "../workspace/diagnostics-context.js";
import {
  PatchPreviewService,
  type PatchApplyResult,
  type PatchFileChange
} from "../workspace/patch-preview-service.js";
import { createDefaultAgentPermissions } from "./agent-permissions.js";
import type { AgentRunEvents, AgentRunOptions, AgentRunResult } from "./agent-state.js";
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

  public async runEditorAction(
    action: AgentRunOptions["action"],
    events?: AgentRunEvents
  ): Promise<void> {
    const result = await this.run({ action }, events);

    if (!result) {
      return;
    }

    await this.showResult(result, {
      openMarkdownWhenNoPatch: true,
      preferPatch: action === "fix" || action === "generate-tests"
    });
  }

  public async runTask(
    task: string,
    events?: AgentRunEvents
  ): Promise<AgentRunResult | undefined> {
    return this.run({ action: "task", task }, events);
  }

  public hasPatch(text: string): boolean {
    return this.patchPreviewService.hasPatch(text);
  }

  public hasApplicableChanges(text: string): boolean {
    return this.patchPreviewService.hasApplicableChanges(text);
  }

  public getPatchSummary(text: string): readonly PatchFileChange[] {
    return this.patchPreviewService.getPatchSummary(text);
  }

  public getChangeSummary(text: string): readonly PatchFileChange[] {
    return this.patchPreviewService.getChangeSummary(text);
  }

  public async previewChanges(result: AgentRunResult): Promise<PatchApplyResult> {
    return this.patchPreviewService.showChangePreview(`Collamdex - ${result.model}`, result.text);
  }

  public async applyChanges(result: AgentRunResult): Promise<PatchApplyResult> {
    return this.patchPreviewService.applyProposedChanges(result.text);
  }

  public async showResult(
    result: AgentRunResult,
    options: {
      readonly openMarkdownWhenNoPatch?: boolean;
      readonly preferPatch?: boolean;
    } = {}
  ): Promise<PatchApplyResult | undefined> {
    const title = `Collamdex - ${result.model}`;
    const containsApplicableChanges = this.patchPreviewService.hasApplicableChanges(result.text);

    if (containsApplicableChanges) {
      const applyResult = await this.patchPreviewService.showPatchAndOfferApply(
        title,
        result.text,
        this.getConfig().requireDiffConfirmation
      );

      if (applyResult.status === "applied" || !options.openMarkdownWhenNoPatch) {
        return applyResult;
      }
    }

    if (options.preferPatch) {
      await this.patchPreviewService.showPatch(title, result.text);
      return undefined;
    }

    if (options.openMarkdownWhenNoPatch ?? true) {
      await this.patchPreviewService.showMarkdown(title, result.text);
    }

    return undefined;
  }

  private async run(
    options: AgentRunOptions,
    events?: AgentRunEvents
  ): Promise<AgentRunResult | undefined> {
    const modelName = await this.modelService.ensureSelectedModel();

    if (!modelName) {
      events?.onError?.("No hay modelo seleccionado.");
      return undefined;
    }

    events?.onStart?.({
      detail: `Modelo ${modelName}. Preparando contexto del proyecto.`,
      model: modelName
    });

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
          events?.onError?.("Ejecucion cancelada por politica de capacidad.");
          return undefined;
        }
      }
    }

    events?.onProgress?.({
      detail: "Comprobando conexion local con Ollama.",
      direction: "forward",
      phase: "Preparando"
    });
    const isHealthy = await this.client.healthCheck();

    if (!isHealthy) {
      const message = "Ollama no esta disponible. Inicia Ollama y vuelve a intentarlo.";
      events?.onError?.(message);
      void vscode.window.showErrorMessage(message);
      return undefined;
    }

    const config = this.getConfig();
    const prompt = await this.buildPrompt(options);
    let text = "";
    let streamResult: OllamaChatResult | undefined;
    const runController = new AbortController();

    this.abortController = runController;
    this.outputChannel.clear();
    this.outputChannel.show(true);
    this.outputChannel.appendLine(`Collamdex usando modelo: ${modelName}`);
    this.outputChannel.appendLine("");

    try {
      await vscode.window.withProgress(
        {
          cancellable: true,
          location: vscode.ProgressLocation.Notification,
          title: "Collamdex esta trabajando"
        },
        async (progress, token) => {
          token.onCancellationRequested(() => this.cancel());
          progress.report({ message: "Preparando contexto del proyecto..." });
          events?.onProgress?.({
            detail: "Contexto preparado. Enviando tarea al modelo local.",
            direction: "forward",
            phase: "Pensando"
          });

          streamResult = await this.client.streamChat(
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
              events?.onToken?.(chunk);
              this.outputChannel.append(chunk);
            },
            runController.signal,
            {
              onFirstToken: (elapsedMs) => {
                const detail = `Primer token en ${formatDuration(elapsedMs)}.`;
                progress.report({ message: detail });
                events?.onProgress?.({
                  detail,
                  direction: "forward",
                  phase: "Respondiendo"
                });
                this.outputChannel.appendLine("");
                this.outputChannel.appendLine(`[Primer token: ${formatDuration(elapsedMs)}]`);
              },
              onMetrics: (metrics) => {
                const detail = formatMetrics(metrics.tokensPerSecond, metrics.evalCount);
                progress.report({ message: detail });
                events?.onProgress?.({
                  detail,
                  direction: "forward",
                  phase: "Finalizando"
                });
              }
            }
          );
          this.outputChannel.appendLine("");
          if (streamResult) {
            this.outputChannel.appendLine(`[Resumen: ${formatChatResult(streamResult)}]`);
          }
        }
      );

      const result = {
        model: modelName,
        text
      };
      events?.onComplete?.({
        detail: streamResult ? formatChatResult(streamResult) : "Respuesta completada.",
        result
      });

      return result;
    } catch (error) {
      const message = formatRunError(error);
      events?.onError?.(message);
      void vscode.window.showErrorMessage(message);
      return undefined;
    } finally {
      if (this.abortController === runController) {
        this.abortController = undefined;
      }
    }
  }

  private async buildPrompt(options: AgentRunOptions): Promise<string> {
    const config = this.getConfig();
    const editorContext = getActiveEditorContext(config.maxPromptChars);
    const diagnostics = getDiagnosticsContext(Math.min(config.maxPromptChars, 12000));
    const permissions = createDefaultAgentPermissions(config.agentMaxIterations);
    const workspaceContext = await this.readWorkspaceContext(
      Math.min(config.maxPromptChars, 16000)
    );

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
      "Contexto del workspace:",
      workspaceContext,
      "",
      "Diagnosticos:",
      diagnostics
    ].join("\n");
  }

  private async readWorkspaceContext(maxChars: number): Promise<string> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      return "[sin workspace abierto]";
    }

    const parts = [`Workspace: ${workspaceFolder.name}`];

    try {
      const entries = await vscode.workspace.fs.readDirectory(workspaceFolder.uri);
      const names = entries
        .slice(0, 30)
        .map(([name]) => name)
        .join(", ");
      parts.push(`Raiz: ${names || "[sin entradas]"}`);
    } catch {
      parts.push("Raiz: no se pudo leer");
    }

    const perFileLimit = Math.max(1200, Math.floor(maxChars / 4));
    const importantFiles = ["AGENTS.md", "README.md", "package.json"];

    for (const fileName of importantFiles) {
      const content = await this.readWorkspaceTextFile(workspaceFolder.uri, fileName, perFileLimit);
      if (content) {
        parts.push(`${fileName}:`, content);
      }
    }

    return limitText(parts.join("\n"), maxChars);
  }

  private async readWorkspaceTextFile(
    rootUri: vscode.Uri,
    relativePath: string,
    maxChars: number
  ): Promise<string | undefined> {
    try {
      const fileUri = vscode.Uri.joinPath(rootUri, relativePath);
      const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri));
      return limitText(content, maxChars);
    } catch {
      return undefined;
    }
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
        return [
          options.task ?? "Resuelve la tarea indicada por el usuario.",
          "Si la tarea requiere modificar archivos existentes, devuelve un diff unificado aplicable con git apply.",
          "Si la tarea requiere crear, reescribir o eliminar archivos completos, devuelve obligatoriamente un bloque JSON ```collamdex-files``` con operation, path y content.",
          "Ejemplo para crear un archivo: ```collamdex-files\n[{\"operation\":\"create\",\"path\":\"README-2.md\",\"content\":\"# README-2.md\\nContenido\\n\"}]\n```",
          "No devuelvas solo el contenido Markdown de un archivo nuevo fuera de un formato aplicable.",
          "No digas que has escrito archivos si solo estas proponiendo cambios; Collamdex pedira confirmacion antes de aplicar.",
          "No uses placeholders cuando el dato solicitado aparezca en el contexto del workspace."
        ].join("\n");
    }
  }

  private getSystemPrompt(): string {
    return [
      "Eres Collamdex, un agente local de codificacion dentro de VS Code.",
      "Trabajas con modelos Ollama locales y no dependes de servicios externos.",
      "Responde en espanol cuando expliques, pero conserva codigo, APIs y errores en su idioma original.",
      "No inventes contenido de archivos existentes que no aparezca en el contexto.",
      "Si propones cambios, devuelve un resumen breve y un patch unificado aplicable.",
      "Si necesitas crear, reescribir o eliminar archivos completos, usa un bloque ```collamdex-files``` con JSON valido; no respondas solo con Markdown del archivo.",
      "No pidas ejecutar comandos destructivos.",
      "Cualquier escritura o comando de terminal requiere confirmacion del usuario."
    ].join("\n");
  }
}

function formatChatResult(result: OllamaChatResult): string {
  return [
    `primer token ${formatDuration(result.firstTokenMs)}`,
    `total ${formatDuration(result.elapsedMs)}`,
    formatMetrics(result.metrics?.tokensPerSecond, result.metrics?.evalCount)
  ].join(" | ");
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) {
    return "n/d";
  }

  if (ms < 1000) {
    return `${ms} ms`;
  }

  return `${(ms / 1000).toFixed(1)} s`;
}

function formatMetrics(tokensPerSecond: number | undefined, evalCount: number | undefined): string {
  const speed =
    tokensPerSecond === undefined ? "velocidad n/d" : `${tokensPerSecond.toFixed(1)} tok/s`;
  const tokens = evalCount === undefined ? "tokens n/d" : `${evalCount} tokens`;
  return `${speed}, ${tokens}`;
}

function formatRunError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "Operacion cancelada.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Error desconocido durante la ejecucion del agente.";
}
