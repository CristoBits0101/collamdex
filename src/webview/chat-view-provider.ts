import * as vscode from "vscode";

import { CapacityPolicy } from "../capacity/capacity-policy.js";
import { formatBytes } from "../capacity/model-capacity-estimator.js";
import type { CollamdexConfig } from "../config/extension-config.js";
import { OllamaClient } from "../ollama/ollama-client.js";
import { OllamaModelService } from "../ollama/ollama-model-service.js";
import type { OllamaModel } from "../ollama/ollama-types.js";
import { getChatViewHtml } from "./chat-view-html.js";

interface WebviewStateModel {
  readonly label: string;
  readonly name: string;
}

interface WebviewState {
  readonly models: readonly WebviewStateModel[];
  readonly selectedModel: string;
  readonly statusText: string;
}

type WebviewMessage =
  | { readonly type: "cancel" }
  | { readonly type: "ready" }
  | { readonly type: "refreshModels" }
  | { readonly model: string; readonly prompt: string; readonly type: "sendPrompt" }
  | { readonly model: string; readonly type: "setModel" }
  | { readonly type: "selectModel" };

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "collamdex.chatView";

  private abortController: AbortController | undefined;
  private models: readonly OllamaModel[] = [];
  private view: vscode.WebviewView | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: OllamaClient,
    private readonly modelService: OllamaModelService,
    private readonly capacityPolicy: CapacityPolicy,
    private readonly getConfig: () => CollamdexConfig
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")]
    };

    webviewView.webview.html = getChatViewHtml(webviewView.webview, this.extensionUri);
    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message);
    });
  }

  public cancel(): void {
    this.abortController?.abort();
    this.abortController = undefined;
    this.post({ type: "busy", value: false });
  }

  public async refreshModels(): Promise<void> {
    const isHealthy = await this.client.healthCheck();

    if (!isHealthy) {
      this.models = [];
      this.postState("Ollama no esta disponible. Inicia Ollama localmente.");
      return;
    }

    this.models = await this.client.listModels();
    const selectedModel = this.modelService.getSelectedModelName();

    if (!selectedModel && this.models[0]) {
      await this.modelService.setSelectedModel(this.models[0].name);
    }

    this.postState(`${this.models.length} modelos locales detectados.`);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
      case "refreshModels":
        await this.refreshModels();
        return;
      case "selectModel":
        await this.modelService.selectModel();
        await this.refreshModels();
        return;
      case "setModel":
        await this.modelService.setSelectedModel(message.model);
        await this.refreshModels();
        return;
      case "sendPrompt":
        await this.modelService.setSelectedModel(message.model);
        await this.sendPrompt(message.prompt, message.model);
        return;
      case "cancel":
        this.cancel();
        return;
    }
  }

  private async sendPrompt(prompt: string, modelName: string): Promise<void> {
    const model = this.models.find((item) => item.name === modelName || item.model === modelName);

    if (model) {
      const decision = this.capacityPolicy.evaluate(model);

      if (decision.status === "blocked") {
        const answer = await vscode.window.showWarningMessage(
          decision.message,
          { modal: true },
          "Usar bajo mi responsabilidad"
        );

        if (answer !== "Usar bajo mi responsabilidad") {
          return;
        }
      }
    }

    const config = this.getConfig();
    this.abortController = new AbortController();
    this.post({ type: "busy", value: true });
    this.post({ type: "assistant-start" });

    try {
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
        (token) => this.post({ type: "assistant-token", token }),
        this.abortController.signal
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido.";
      this.post({ type: "error", message });
    } finally {
      this.abortController = undefined;
      this.post({ type: "busy", value: false });
    }
  }

  private postState(statusText: string): void {
    const selectedModel = this.modelService.getSelectedModelName() ?? "";
    const models = this.models.map((model) => {
      const decision = this.capacityPolicy.evaluate(model);
      const size = formatBytes(model.size);
      return {
        label: `${model.name} - ${getModelKind(model)} - ${size} - ${decision.status}`,
        name: model.name
      };
    });

    this.post({
      state: {
        models,
        selectedModel,
        statusText
      },
      type: "state"
    });
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private getSystemPrompt(): string {
    return [
      "Eres Collamdex, un agente local de codificacion para VS Code.",
      "Usas Ollama local y no dependes de servicios externos.",
      "Responde en espanol claro.",
      "Cuando propongas cambios de codigo, devuelve un patch unificado si es posible.",
      "No sugieras comandos destructivos."
    ].join("\n");
  }
}

function getModelKind(model: OllamaModel): string {
  const families = [model.details?.family, ...(model.details?.families ?? [])]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  if (families.includes("bert")) {
    return "embedding";
  }

  if (families.includes("clip") || families.includes("mllama")) {
    return "vision";
  }

  return "chat";
}
