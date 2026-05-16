import * as vscode from "vscode";

import { OllamaModelService } from "../ollama/ollama-model-service.js";

export class ModelStatusBar {
  private readonly item: vscode.StatusBarItem;

  public constructor(modelService: OllamaModelService) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "collamdex.selectModel";
    this.item.name = "Collamdex model selector";
    this.item.tooltip = "Seleccionar modelo local de Ollama para Collamdex";
    this.update(modelService.getSelectedModelName());
    this.item.show();

    modelService.onDidChangeSelectedModel((modelName) => this.update(modelName));
  }

  public dispose(): void {
    this.item.dispose();
  }

  private update(modelName: string | undefined): void {
    this.item.text = modelName ? `$(sparkle) Collamdex: ${modelName}` : "$(sparkle) Collamdex: elegir modelo";
  }
}
