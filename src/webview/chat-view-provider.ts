import * as vscode from "vscode";

import { AgentRuntime } from "../agent/agent-loop.js";
import { CapacityPolicy } from "../capacity/capacity-policy.js";
import { formatBytes } from "../capacity/model-capacity-estimator.js";
import type { CollamdexConfig } from "../config/extension-config.js";
import { OllamaClient } from "../ollama/ollama-client.js";
import { OllamaModelService } from "../ollama/ollama-model-service.js";
import type { OllamaModel } from "../ollama/ollama-types.js";
import { getChatViewHtml } from "./chat-view-html.js";

const MODEL_TEST_TIMEOUT_MS = 45_000;

interface WebviewStateModel {
  readonly label: string;
  readonly name: string;
}

interface WebviewState {
  readonly models: readonly WebviewStateModel[];
  readonly selectedModel: string;
  readonly statusText: string;
}

interface WebviewContextSummary {
  readonly files: readonly string[];
  readonly workspaceName: string;
}

interface ModelTestStatus {
  readonly elapsedMs?: number;
  readonly firstTokenMs?: number;
  readonly status: "error" | "ok" | "timeout";
}

type WebviewMessage =
  | { readonly id: string; readonly type: "applyPendingChanges" }
  | { readonly type: "cancel" }
  | { readonly id: string; readonly type: "discardPendingChanges" }
  | { readonly type: "ready" }
  | { readonly type: "refreshModels" }
  | { readonly model: string; readonly prompt: string; readonly type: "sendPrompt" }
  | { readonly model: string; readonly type: "setModel" }
  | { readonly type: "selectModel" }
  | { readonly type: "testModels" };

interface PendingWorkspaceChange {
  readonly id: string;
  readonly result: {
    readonly model: string;
    readonly text: string;
  };
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "collamdex.chatView";

  private abortController: AbortController | undefined;
  private modelTests = new Map<string, ModelTestStatus>();
  private models: readonly OllamaModel[] = [];
  private pendingChange: PendingWorkspaceChange | undefined;
  private view: vscode.WebviewView | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: OllamaClient,
    private readonly modelService: OllamaModelService,
    private readonly capacityPolicy: CapacityPolicy,
    private readonly agentRuntime: AgentRuntime,
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
    this.agentRuntime.cancel();
    this.post({ type: "busy", value: false });
    this.post({ detail: "Operacion cancelada.", type: "activity-complete" });
  }

  public async runPrompt(prompt: string): Promise<void> {
    this.post({ prompt, type: "user-message" });
    await this.sendPrompt(prompt, this.modelService.getSelectedModelName() ?? "");
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
      case "testModels":
        await this.testModels();
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
      case "applyPendingChanges":
        await this.applyPendingChanges(message.id);
        return;
      case "discardPendingChanges":
        this.discardPendingChanges(message.id);
        return;
    }
  }

  private async sendPrompt(prompt: string, modelName: string): Promise<void> {
    if (modelName) {
      await this.modelService.setSelectedModel(modelName);
    }

    this.post({ summary: await this.buildContextSummary(), type: "context-summary" });
    this.post({ type: "busy", value: true });
    this.post({
      detail: `Modelo ${modelName || "seleccionado"}. Preparando contexto del proyecto.`,
      direction: "forward",
      phase: "Pensando",
      type: "activity"
    });
    this.post({ type: "assistant-start" });

    try {
      const result = await this.agentRuntime.runTask(prompt, {
        onComplete: ({ detail }) => {
          this.post({ detail, type: "activity-complete" });
        },
        onError: (message) => {
          this.post({ type: "error", message });
          this.post({ detail: message, type: "activity-complete" });
        },
        onProgress: ({ detail, direction, phase }) => {
          this.post({
            detail,
            direction: direction ?? "forward",
            phase,
            type: "activity"
          });
        },
        onStart: ({ detail }) => {
          this.post({
            detail,
            direction: "forward",
            phase: "Pensando",
            type: "activity"
          });
        },
        onToken: (token) => this.post({ type: "assistant-token", token })
      });

      if (result && this.agentRuntime.hasApplicableChanges(result.text)) {
        const changes = this.agentRuntime.getChangeSummary(result.text);
        this.post({
          detail: "Cambios detectados. Abriendo preview y preparando confirmacion.",
          direction: "forward",
          phase: "Revisando cambios",
          type: "activity"
        });
        this.post({ changes, type: "patch-summary" });
        const previewResult = await this.agentRuntime.previewChanges(result);
        const id = createPendingChangeId();
        this.pendingChange = { id, result };
        const detail =
          previewResult.status === "invalid"
            ? previewResult.message
            : `Preview abierto: ${formatFileChangeCount(changes)}. Confirma en el panel para escribir.`;
        this.post({ detail, id, type: "pending-changes" });
      } else if (result && looksLikeWorkspaceMutationRequest(prompt)) {
        this.post({
          detail:
            "El modelo respondio sin diff ni bloque collamdex-files aplicable. No se escribio nada.",
          type: "activity-complete"
        });
      }
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "Operacion cancelada."
          : error instanceof Error
            ? error.message
            : "Error desconocido.";
      this.post({ type: "error", message });
      this.post({ detail: message, type: "activity-complete" });
    } finally {
      this.post({ type: "busy", value: false });
    }
  }

  private async applyPendingChanges(id: string): Promise<void> {
    const pendingChange = this.pendingChange;

    if (!pendingChange || pendingChange.id !== id) {
      this.post({ type: "error", message: "No hay cambios pendientes para aplicar." });
      return;
    }

    this.post({ type: "busy", value: true });
    this.post({
      detail: "Aplicando cambios confirmados por el usuario.",
      direction: "forward",
      phase: "Aplicando cambios",
      type: "activity"
    });

    try {
      const applyResult = await this.agentRuntime.applyChanges(pendingChange.result);
      const detail =
        applyResult.status === "applied"
          ? `Cambios aplicados: ${formatFileChangeCount(applyResult.changes)}.`
          : applyResult.message;
      this.pendingChange = applyResult.status === "applied" ? undefined : pendingChange;
      this.post({ detail, status: applyResult.status, type: "patch-result" });
      this.post({ detail, type: "activity-complete" });
    } finally {
      this.post({ type: "busy", value: false });
    }
  }

  private discardPendingChanges(id: string): void {
    if (this.pendingChange?.id !== id) {
      return;
    }

    this.pendingChange = undefined;
    const detail = "Cambios cancelados. No se escribio nada en el workspace.";
    this.post({ detail, status: "discarded", type: "patch-result" });
    this.post({ detail, type: "activity-complete" });
  }

  private async buildContextSummary(): Promise<WebviewContextSummary> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const files: string[] = [];
    const editor =
      vscode.window.activeTextEditor ??
      vscode.window.visibleTextEditors.find((visibleEditor) => visibleEditor.document.uri.scheme === "file") ??
      vscode.window.visibleTextEditors[0];

    if (editor) {
      addUnique(files, vscode.workspace.asRelativePath(editor.document.uri));
    }

    if (workspaceFolder) {
      for (const fileName of ["AGENTS.md", "README.md", "package.json"]) {
        if (await workspaceFileExists(workspaceFolder.uri, fileName)) {
          addUnique(files, fileName);
        }
      }
    }

    return {
      files,
      workspaceName: workspaceFolder?.name ?? "sin workspace abierto"
    };
  }

  public async testModels(): Promise<void> {
    const isHealthy = await this.client.healthCheck();

    if (!isHealthy) {
      this.post({ type: "error", message: "Ollama no esta disponible. Inicia Ollama localmente." });
      return;
    }

    if (this.models.length === 0) {
      this.models = await this.client.listModels();
    }

    const candidates = this.models.filter((model) => getModelKind(model) !== "embedding");

    if (candidates.length === 0) {
      this.post({
        summary: "No hay modelos de chat/vision para probar. Los modelos embedding se omiten.",
        type: "model-test-result"
      });
      return;
    }

    const prompt = await this.buildProjectProbePrompt();
    const runController = new AbortController();
    this.abortController = runController;
    this.post({ type: "busy", value: true });
    this.post({
      detail: `${candidates.length} modelos detectados. Se omiten embeddings.`,
      direction: "forward",
      phase: "Probando Ollama",
      type: "activity"
    });

    try {
      for (const model of candidates) {
        if (runController.signal.aborted) {
          break;
        }

        const summary = await this.testOneModel(model.name, prompt, runController.signal);
        this.post({ summary, type: "model-test-result" });
        this.postState("Pruebas de modelos actualizadas.");
      }

      this.post({ detail: "Pruebas de Ollama completadas.", type: "activity-complete" });
    } finally {
      if (this.abortController === runController) {
        this.abortController = undefined;
      }
      this.post({ type: "busy", value: false });
    }
  }

  private async testOneModel(
    modelName: string,
    prompt: string,
    parentSignal: AbortSignal
  ): Promise<string> {
    const config = this.getConfig();
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), MODEL_TEST_TIMEOUT_MS);
    const cancelFromParent = () => timeoutController.abort();
    let responseText = "";

    parentSignal.addEventListener("abort", cancelFromParent, { once: true });
    this.post({
      detail: `Enviando prueba a ${modelName}.`,
      direction: "forward",
      phase: "Probando modelo",
      type: "activity"
    });

    try {
      const result = await this.client.streamChat(
        {
          keep_alive: config.keepAlive,
          messages: [
            {
              content:
                "Eres una prueba de capacidad. Responde breve y confirma si puedes trabajar con el proyecto recibido.",
              role: "system"
            },
            {
              content: prompt,
              role: "user"
            }
          ],
          model: modelName,
          options: {
            num_ctx: Math.min(config.numCtx, 2048),
            temperature: 0
          },
          stream: true
        },
        (token) => {
          responseText += token;
        },
        timeoutController.signal,
        {
          onFirstToken: (elapsedMs) => {
            this.post({
              detail: `${modelName}: primer token en ${formatDuration(elapsedMs)}.`,
              direction: "forward",
              phase: "Probando modelo",
              type: "activity"
            });
          }
        }
      );

      this.modelTests.set(modelName, {
        elapsedMs: result.elapsedMs,
        firstTokenMs: result.firstTokenMs,
        status: "ok"
      });

      return [
        `${modelName}: OK`,
        `primer token ${formatDuration(result.firstTokenMs)}`,
        `total ${formatDuration(result.elapsedMs)}`,
        formatMetrics(result.metrics?.tokensPerSecond, result.metrics?.evalCount),
        `respuesta: ${compactText(responseText, 180)}`
      ].join(" | ");
    } catch (error) {
      const isTimeout = timeoutController.signal.aborted && !parentSignal.aborted;
      const status = isTimeout ? "timeout" : "error";
      const message =
        error instanceof Error && parentSignal.aborted
          ? "cancelado"
          : isTimeout
            ? `sin respuesta antes de ${formatDuration(MODEL_TEST_TIMEOUT_MS)}`
            : error instanceof Error
              ? error.message
              : "error desconocido";

      this.modelTests.set(modelName, { status });
      return `${modelName}: ${status.toUpperCase()} | ${message}`;
    } finally {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", cancelFromParent);
    }
  }

  private async buildProjectProbePrompt(): Promise<string> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const packageSummary = await this.readPackageSummary(folder?.uri);
    const srcSummary = await this.readSrcSummary(folder?.uri);

    return [
      "Prueba de Collamdex con contexto real del proyecto.",
      "Responde en menos de 30 palabras y confirma si puedes ayudar a modificarlo.",
      "",
      `Workspace: ${folder?.name ?? "sin workspace"}`,
      packageSummary,
      srcSummary,
      "",
      "Pregunta: Puedes trabajar con este proyecto de extension VS Code y proponer patches?"
    ].join("\n");
  }

  private async readPackageSummary(root: vscode.Uri | undefined): Promise<string> {
    if (!root) {
      return "package.json: no disponible";
    }

    try {
      const packageUri = vscode.Uri.joinPath(root, "package.json");
      const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(packageUri));
      const packageJson = JSON.parse(content) as {
        contributes?: unknown;
        description?: string;
        name?: string;
        version?: string;
      };

      return [
        "package.json:",
        `- name: ${packageJson.name ?? "desconocido"}`,
        `- version: ${packageJson.version ?? "desconocida"}`,
        `- description: ${packageJson.description ?? "sin descripcion"}`,
        `- contributes: ${packageJson.contributes ? "si" : "no"}`
      ].join("\n");
    } catch {
      return "package.json: no se pudo leer";
    }
  }

  private async readSrcSummary(root: vscode.Uri | undefined): Promise<string> {
    if (!root) {
      return "src/: no disponible";
    }

    try {
      const srcUri = vscode.Uri.joinPath(root, "src");
      const entries = await vscode.workspace.fs.readDirectory(srcUri);
      const names = entries
        .slice(0, 12)
        .map(([name]) => name)
        .join(", ");

      return `src/: ${names || "sin entradas"}`;
    } catch {
      return "src/: no se pudo leer";
    }
  }

  private postState(statusText: string): void {
    const selectedModel = this.modelService.getSelectedModelName() ?? "";
    const models = this.models.map((model) => {
      const decision = this.capacityPolicy.evaluate(model);
      const size = formatBytes(model.size);
      const test = this.modelTests.get(model.name);
      const testLabel = test ? ` - test ${formatModelTest(test)}` : "";
      return {
        label: `${model.name} - ${getModelKind(model)} - ${size} - ${decision.status}${testLabel}`,
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

}

function compactText(text: string, maxLength: number): string {
  const compacted = text.replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted || "[sin texto]";
  }

  return `${compacted.slice(0, maxLength - 3)}...`;
}

async function workspaceFileExists(rootUri: vscode.Uri, relativePath: string): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(rootUri, relativePath));
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
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

function formatModelTest(test: ModelTestStatus): string {
  if (test.status !== "ok") {
    return test.status;
  }

  return `${formatDuration(test.firstTokenMs)}/${formatDuration(test.elapsedMs)}`;
}

function formatFileChangeCount(changes: readonly unknown[]): string {
  if (changes.length === 1) {
    return "1 archivo";
  }

  return `${changes.length} archivos`;
}

function createPendingChangeId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
