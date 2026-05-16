import type { CollamdexConfig } from "../config/extension-config.js";
import type {
  OllamaChatRequest,
  OllamaChatStreamChunk,
  OllamaModel,
  OllamaPsResponse,
  OllamaRunningModel,
  OllamaTagsResponse
} from "./ollama-types.js";

export interface OllamaChatResult {
  readonly elapsedMs: number;
  readonly firstTokenMs?: number;
  readonly metrics?: OllamaChatMetrics;
}

export interface OllamaChatMetrics {
  readonly evalCount?: number;
  readonly evalDurationMs?: number;
  readonly loadDurationMs?: number;
  readonly promptEvalCount?: number;
  readonly promptEvalDurationMs?: number;
  readonly tokensPerSecond?: number;
  readonly totalDurationMs?: number;
}

export interface OllamaStreamEvents {
  readonly onFirstToken?: (elapsedMs: number) => void;
  readonly onMetrics?: (metrics: OllamaChatMetrics) => void;
}

export class OllamaConnectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OllamaConnectionError";
  }
}

export class OllamaClient {
  public constructor(private readonly getConfig: () => CollamdexConfig) {}

  public async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getConfig().baseUrl}/tags`, {
        signal: AbortSignal.timeout(2500)
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  public async listModels(): Promise<readonly OllamaModel[]> {
    const response = await this.fetchJson<OllamaTagsResponse>("/tags");
    return response.models;
  }

  public async listRunningModels(): Promise<readonly OllamaRunningModel[]> {
    const response = await this.fetchJson<OllamaPsResponse>("/ps");
    return response.models;
  }

  public async streamChat(
    request: OllamaChatRequest,
    onToken: (token: string) => void,
    signal?: AbortSignal,
    events?: OllamaStreamEvents
  ): Promise<OllamaChatResult> {
    const startedAt = Date.now();
    let firstTokenMs: number | undefined;
    const response = await fetch(`${this.getConfig().baseUrl}/chat`, {
      body: JSON.stringify(request),
      headers: {
        "content-type": "application/json"
      },
      method: "POST",
      signal
    });

    if (!response.ok) {
      const message = await response.text();
      throw new OllamaConnectionError(`Ollama respondio ${response.status}: ${message}`);
    }

    if (!response.body) {
      throw new OllamaConnectionError("Ollama no devolvio stream de respuesta.");
    }

    const metrics = await this.readNdjsonStream(
      response.body,
      (token) => {
        if (firstTokenMs === undefined) {
          firstTokenMs = Date.now() - startedAt;
          events?.onFirstToken?.(firstTokenMs);
        }

        onToken(token);
      },
      (chunk) => {
        const chunkMetrics = getChunkMetrics(chunk);

        if (chunkMetrics) {
          events?.onMetrics?.(chunkMetrics);
        }
      }
    );

    return {
      elapsedMs: Date.now() - startedAt,
      firstTokenMs,
      metrics
    };
  }

  private async fetchJson<T>(path: string): Promise<T> {
    try {
      const response = await fetch(`${this.getConfig().baseUrl}${path}`);

      if (!response.ok) {
        const message = await response.text();
        throw new OllamaConnectionError(`Ollama respondio ${response.status}: ${message}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof OllamaConnectionError) {
        throw error;
      }

      throw new OllamaConnectionError(
        "No se pudo conectar con Ollama. Comprueba que Ollama este ejecutandose."
      );
    }
  }

  private async readNdjsonStream(
    body: ReadableStream<Uint8Array>,
    onToken: (token: string) => void,
    onChunk: (chunk: OllamaChatStreamChunk) => void
  ): Promise<OllamaChatMetrics | undefined> {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = "";
    let metrics: OllamaChatMetrics | undefined;

    for (;;) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        metrics = this.consumeStreamLine(line, onToken, onChunk) ?? metrics;
      }
    }

    if (buffer.trim().length > 0) {
      metrics = this.consumeStreamLine(buffer, onToken, onChunk) ?? metrics;
    }

    return metrics;
  }

  private consumeStreamLine(
    line: string,
    onToken: (token: string) => void,
    onChunk: (chunk: OllamaChatStreamChunk) => void
  ): OllamaChatMetrics | undefined {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      return undefined;
    }

    const chunk = JSON.parse(trimmed) as OllamaChatStreamChunk;
    onChunk(chunk);

    const content = chunk.message?.content;

    if (content) {
      onToken(content);
    }

    return getChunkMetrics(chunk);
  }
}

function getChunkMetrics(chunk: OllamaChatStreamChunk): OllamaChatMetrics | undefined {
  if (!chunk.done) {
    return undefined;
  }

  const evalDurationMs = nanosToMs(chunk.eval_duration);
  const evalCount = chunk.eval_count;
  const tokensPerSecond =
    evalCount !== undefined && evalDurationMs !== undefined && evalDurationMs > 0
      ? evalCount / (evalDurationMs / 1000)
      : undefined;

  return {
    evalCount,
    evalDurationMs,
    loadDurationMs: nanosToMs(chunk.load_duration),
    promptEvalCount: chunk.prompt_eval_count,
    promptEvalDurationMs: nanosToMs(chunk.prompt_eval_duration),
    tokensPerSecond,
    totalDurationMs: nanosToMs(chunk.total_duration)
  };
}

function nanosToMs(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value / 1_000_000);
}
