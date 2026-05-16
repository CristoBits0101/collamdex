import * as vscode from "vscode";

import { AgentRuntime } from "../agent/agent-loop.js";
import { OllamaModelService } from "../ollama/ollama-model-service.js";
import { ChatViewProvider } from "../webview/chat-view-provider.js";

export interface RegisterCommandDependencies {
  readonly agentRuntime: AgentRuntime;
  readonly chatViewProvider: ChatViewProvider;
  readonly modelService: OllamaModelService;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  dependencies: RegisterCommandDependencies
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("collamdex.openChat", async () => {
      await openCollamdexView();
    }),
    vscode.commands.registerCommand("collamdex.openView", async () => {
      await openCollamdexView();
    }),
    vscode.commands.registerCommand("collamdex.selectModel", async () => {
      await dependencies.modelService.selectModel();
      await dependencies.chatViewProvider.refreshModels();
    }),
    vscode.commands.registerCommand("collamdex.refreshModels", async () => {
      await dependencies.chatViewProvider.refreshModels();
    }),
    vscode.commands.registerCommand("collamdex.explainSelection", async () => {
      await dependencies.agentRuntime.runEditorAction("explain");
    }),
    vscode.commands.registerCommand("collamdex.fixSelection", async () => {
      await dependencies.agentRuntime.runEditorAction("fix");
    }),
    vscode.commands.registerCommand("collamdex.generateTests", async () => {
      await dependencies.agentRuntime.runEditorAction("generate-tests");
    }),
    vscode.commands.registerCommand("collamdex.reviewActiveFile", async () => {
      await dependencies.agentRuntime.runEditorAction("review");
    }),
    vscode.commands.registerCommand("collamdex.runAgentTask", async () => {
      const task = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        placeHolder: "Ejemplo: revisa este archivo y propon un refactor pequeno",
        prompt: "Tarea para Collamdex"
      });

      if (!task) {
        return;
      }

      const result = await dependencies.agentRuntime.runTask(task);

      if (result) {
        const document = await vscode.workspace.openTextDocument({
          content: result.text,
          language: "markdown"
        });
        await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
      }
    }),
    vscode.commands.registerCommand("collamdex.cancelGeneration", () => {
      dependencies.chatViewProvider.cancel();
      dependencies.agentRuntime.cancel();
    })
  );
}

async function openCollamdexView(): Promise<void> {
  const focusCommands = [
    "collamdex.chatView.focus",
    "workbench.view.extension.collamdex"
  ];

  for (const command of focusCommands) {
    try {
      await vscode.commands.executeCommand(command);
      return;
    } catch {
      // Try next compatible VS Code focus command.
    }
  }

  void vscode.window.showWarningMessage(
    "No se pudo enfocar el panel Collamdex. Abre el icono Collamdex en la Activity Bar o recarga la ventana."
  );
}
