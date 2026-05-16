import * as vscode from "vscode";

import { AgentRuntime } from "../agent/agent-loop.js";
import type { PatchApplyResult } from "../workspace/patch-preview-service.js";

export function registerNativeChatParticipant(
  context: vscode.ExtensionContext,
  agentRuntime: AgentRuntime
): void {
  const participant = vscode.chat.createChatParticipant(
    "collamdex.collamdex",
    async (request, _chatContext, response, token) => {
      const tokenDisposable = token.onCancellationRequested(() => agentRuntime.cancel());

      try {
        const result = await agentRuntime.runTask(request.prompt, {
          onError: (message) => {
            response.markdown(message);
          },
          onProgress: ({ detail, phase }) => {
            response.progress(`${phase}: ${detail}`);
          },
          onStart: ({ detail }) => {
            response.progress(detail);
          },
          onToken: (chunk) => {
            response.markdown(chunk);
          }
        });

        if (!result) {
          return;
        }

        const applyResult = await agentRuntime.showResult(result, {
          openMarkdownWhenNoPatch: false
        });

        if (applyResult) {
          response.markdown(`\n\n${formatApplyResult(applyResult)}`);
        } else if (looksLikeWorkspaceMutationRequest(request.prompt)) {
          response.markdown(
            "\n\nNo he detectado un diff ni un bloque `collamdex-files` aplicable, asi que no se escribio nada."
          );
        }
      } finally {
        tokenDisposable.dispose();
      }
    }
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "collamdex.svg");
  context.subscriptions.push(participant);
}

function formatApplyResult(result: PatchApplyResult): string {
  if (result.status === "applied") {
    return `Cambios aplicados: ${formatFileChangeCount(result.changes)}.`;
  }

  return result.message;
}

function formatFileChangeCount(changes: readonly { readonly path: string }[]): string {
  return `${changes.length} archivo${changes.length === 1 ? "" : "s"}`;
}

function looksLikeWorkspaceMutationRequest(prompt: string): boolean {
  return /\b(crea|crear|cree|genera|generar|escribe|escribir|anade|agrega|modifica|actualiza|edita|corrige|arregla|implementa|elimina|borra|reemplaza|write|create|edit|modify|update|delete|remove|add|implement|fix|generate|replace)\b/.test(
    normalizeForSearch(prompt)
  );
}

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
