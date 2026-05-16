import * as vscode from "vscode";

export interface CollamdexConfig {
  readonly agentMaxIterations: number;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly keepAlive: string;
  readonly maxPromptChars: number;
  readonly maxSystemRamRatio: number;
  readonly numCtx: number;
  readonly requireDiffConfirmation: boolean;
  readonly temperature: number;
}

export function getCollamdexConfig(): CollamdexConfig {
  const config = vscode.workspace.getConfiguration("collamdex");
  const baseUrl = config.get<string>("ollama.baseUrl", "http://localhost:11434/api");

  return {
    agentMaxIterations: config.get<number>("agent.maxIterations", 6),
    baseUrl: baseUrl.replace(/\/$/, ""),
    defaultModel: config.get<string>("model.default", ""),
    keepAlive: config.get<string>("generation.keepAlive", "30s"),
    maxPromptChars: config.get<number>("safety.maxPromptChars", 60000),
    maxSystemRamRatio: config.get<number>("hardware.maxSystemRamRatio", 0.65),
    numCtx: config.get<number>("generation.numCtx", 4096),
    requireDiffConfirmation: config.get<boolean>("safety.requireDiffConfirmation", true),
    temperature: config.get<number>("generation.temperature", 0.2)
  };
}
