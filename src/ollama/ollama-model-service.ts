import * as vscode from "vscode";

import { CapacityPolicy } from "../capacity/capacity-policy.js";
import { formatBytes } from "../capacity/model-capacity-estimator.js";
import type { CollamdexConfig } from "../config/extension-config.js";
import type { OllamaModel } from "./ollama-types.js";
import { OllamaClient } from "./ollama-client.js";

const SELECTED_MODEL_KEY = "collamdex.selectedModel";

export class OllamaModelService {
  private readonly selectedModelEmitter = new vscode.EventEmitter<string | undefined>();
  public readonly onDidChangeSelectedModel = this.selectedModelEmitter.event;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: OllamaClient,
    private readonly capacityPolicy: CapacityPolicy,
    private readonly getConfig: () => CollamdexConfig
  ) {}

  public getSelectedModelName(): string | undefined {
    const stored = this.context.globalState.get<string>(SELECTED_MODEL_KEY);
    const configured = this.getConfig().defaultModel.trim();

    return stored || configured || undefined;
  }

  public async setSelectedModel(modelName: string): Promise<void> {
    await this.context.globalState.update(SELECTED_MODEL_KEY, modelName);
    this.selectedModelEmitter.fire(modelName);
  }

  public async ensureSelectedModel(): Promise<string | undefined> {
    const selected = this.getSelectedModelName();

    if (selected) {
      return selected;
    }

    return this.selectModel();
  }

  public async listModels(): Promise<readonly OllamaModel[]> {
    return this.client.listModels();
  }

  public async findModel(modelName: string): Promise<OllamaModel | undefined> {
    const models = await this.listModels();
    return models.find((model) => model.name === modelName || model.model === modelName);
  }

  public async selectModel(): Promise<string | undefined> {
    const isHealthy = await this.client.healthCheck();

    if (!isHealthy) {
      void vscode.window.showErrorMessage(
        "Ollama no esta disponible. Inicia Ollama y vuelve a intentarlo."
      );
      return undefined;
    }

    const models = await this.listModels();

    if (models.length === 0) {
      void vscode.window.showWarningMessage(
        "Ollama no tiene modelos locales instalados. Ejecuta ollama pull <modelo>."
      );
      return undefined;
    }

    const selectedName = this.getSelectedModelName();
    const selected = await vscode.window.showQuickPick(
      models.map((model) => {
        const decision = this.capacityPolicy.evaluate(model);
        return {
          description: `${getModelKind(model)} ${model.details?.parameter_size ?? "?"} ${model.details?.quantization_level ?? ""}`.trim(),
          detail: `${formatBytes(model.size)} - ${decision.message}`,
          label: model.name,
          picked: model.name === selectedName
        };
      }),
      {
        matchOnDescription: true,
        matchOnDetail: true,
        placeHolder: "Selecciona un modelo local de Ollama"
      }
    );

    if (!selected) {
      return undefined;
    }

    await this.setSelectedModel(selected.label);
    void vscode.window.showInformationMessage(`Collamdex usara ${selected.label}.`);

    return selected.label;
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
