import * as vscode from "vscode";
import type { OllamaClient } from "../ollama/ollama-client.js";
import type { OllamaModelService } from "../ollama/ollama-model-service.js";

export class CollamdexInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private lastRequestToken?: vscode.CancellationTokenSource;
  // Anti-rebote para evitar llamar a Ollama en cada pulsacion instantaneamente
  private debounceTimer?: NodeJS.Timeout;

  public constructor(
    private readonly client: OllamaClient,
    private readonly modelService: OllamaModelService
  ) {}

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    if (this.lastRequestToken) {
      this.lastRequestToken.cancel();
    }

    this.lastRequestToken = new vscode.CancellationTokenSource();
    const currentToken = this.lastRequestToken.token;

    token.onCancellationRequested(() => {
      this.lastRequestToken?.cancel();
    });

    const modelName = this.modelService.getSelectedModelName();
    if (!modelName) {
      return null;
    }

    // Anti-rebote simple de 300ms
    return new Promise((resolve) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(async () => {
        if (currentToken.isCancellationRequested) {
          return resolve(null);
        }

        try {
          const controller = new AbortController();
          currentToken.onCancellationRequested(() => {
            controller.abort();
          });

          // Extraer las lineas recientes para no enviar todo el archivo (por velocidad)
          const startLine = Math.max(0, position.line - 60);
          const prefixRange = new vscode.Range(new vscode.Position(startLine, 0), position);
          const prefix = document.getText(prefixRange);

          const response = await this.client.generate(
            {
              model: modelName,
              prompt: prefix,
              stream: false,
              options: {
                num_predict: 64, // Generacion corta
                temperature: 0.1,
                stop: ["\n\n", "```"]
              }
            },
            controller.signal
          );

          if (currentToken.isCancellationRequested) {
            return resolve(null);
          }

          if (response.response && response.response.trim().length > 0) {
            resolve([new vscode.InlineCompletionItem(response.response)]);
            return;
          }
        } catch {
          // Ignorar abortos o errores de red
        }

        resolve(null);
      }, 300);
    });
  }
}
