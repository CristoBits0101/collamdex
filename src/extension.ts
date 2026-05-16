import * as vscode from "vscode";

import { AgentRuntime } from "./agent/agent-loop.js";
import { CapacityPolicy } from "./capacity/capacity-policy.js";
import { registerNativeChatParticipant } from "./chat/native-chat-participant.js";
import { getCollamdexConfig } from "./config/extension-config.js";
import { registerCommands } from "./commands/register-commands.js";
import { OllamaClient } from "./ollama/ollama-client.js";
import { OllamaModelService } from "./ollama/ollama-model-service.js";
import { ModelStatusBar } from "./status-bar/model-status-bar.js";
import { ChatViewProvider } from "./webview/chat-view-provider.js";
import { PatchPreviewService } from "./workspace/patch-preview-service.js";

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("Collamdex");
  const getConfig = getCollamdexConfig;
  const client = new OllamaClient(getConfig);
  const capacityPolicy = new CapacityPolicy(getConfig);
  const modelService = new OllamaModelService(context, client, capacityPolicy, getConfig);
  const modelStatusBar = new ModelStatusBar(modelService);
  const patchPreviewService = new PatchPreviewService();
  const agentRuntime = new AgentRuntime(
    client,
    modelService,
    capacityPolicy,
    patchPreviewService,
    outputChannel,
    getConfig
  );
  const chatViewProvider = new ChatViewProvider(
    context.extensionUri,
    client,
    modelService,
    capacityPolicy,
    agentRuntime,
    getConfig
  );

  context.subscriptions.push(
    modelStatusBar,
    outputChannel,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  registerCommands(context, {
    agentRuntime,
    chatViewProvider,
    modelService
  });
  registerNativeChatParticipant(context, client, modelService, getConfig);

  void client.healthCheck().then((isHealthy) => {
    if (!isHealthy) {
      outputChannel.appendLine(
        "Ollama no esta disponible. Inicia Ollama localmente para usar Collamdex."
      );
    }
  });
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered in the extension context.
}
