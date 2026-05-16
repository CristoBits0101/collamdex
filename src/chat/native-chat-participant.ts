import * as vscode from "vscode";

import type { CollamdexConfig } from "../config/extension-config.js";
import { OllamaClient } from "../ollama/ollama-client.js";
import { OllamaModelService } from "../ollama/ollama-model-service.js";
import { getActiveEditorContext } from "../workspace/active-editor-context.js";
import { getDiagnosticsContext } from "../workspace/diagnostics-context.js";

export function registerNativeChatParticipant(
  context: vscode.ExtensionContext,
  client: OllamaClient,
  modelService: OllamaModelService,
  getConfig: () => CollamdexConfig
): void {
  const participant = vscode.chat.createChatParticipant(
    "collamdex.collamdex",
    async (request, _chatContext, response, token) => {
      const modelName = await modelService.ensureSelectedModel();

      if (!modelName) {
        response.markdown(
          "No hay modelo seleccionado. Ejecuta `Collamdex: Seleccionar modelo` o abre el panel Collamdex."
        );
        return;
      }

      const isHealthy = await client.healthCheck();

      if (!isHealthy) {
        response.markdown("Ollama no esta disponible. Inicia Ollama localmente y vuelve a intentarlo.");
        return;
      }

      const config = getConfig();
      const abortController = new AbortController();
      const tokenDisposable = token.onCancellationRequested(() => abortController.abort());

      try {
        await client.streamChat(
          {
            keep_alive: config.keepAlive,
            messages: [
              {
                content: getSystemPrompt(),
                role: "system"
              },
              {
                content: buildPrompt(request.prompt, config),
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
          (chunk) => response.markdown(chunk),
          abortController.signal
        );
      } finally {
        tokenDisposable.dispose();
      }
    }
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "collamdex.svg");
  context.subscriptions.push(participant);
}

function buildPrompt(userPrompt: string, config: CollamdexConfig): string {
  const editorContext = getActiveEditorContext(config.maxPromptChars);
  const diagnostics = getDiagnosticsContext(Math.min(config.maxPromptChars, 12000));

  return [
    `Tarea del usuario: ${userPrompt}`,
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

function getSystemPrompt(): string {
  return [
    "Eres Collamdex, un agente local de codificacion dentro de VS Code.",
    "Usas Ollama local y no dependes de servicios externos.",
    "Responde en espanol claro.",
    "No inventes archivos no recibidos.",
    "Si propones cambios, devuelve un patch unificado cuando sea viable.",
    "No sugieras comandos destructivos."
  ].join("\n");
}
