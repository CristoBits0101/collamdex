import type { CollamdexConfig } from "../config/extension-config.js";
import type {
  OllamaChatRequest,
  OllamaChatStreamChunk,
  OllamaModel,
  OllamaPsResponse,
  OllamaRunningModel,
  OllamaTagsResponse
} from "./ollama-types.js";

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
    signal?: AbortSignal
  ): Promise<void> {
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

    await this.readNdjsonStream(response.body, onToken);
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
    onToken: (token: string) => void
  ): Promise<void> {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = "";

    for (;;) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        this.consumeStreamLine(line, onToken);
      }
    }

    if (buffer.trim().length > 0) {
      this.consumeStreamLine(buffer, onToken);
    }
  }

  private consumeStreamLine(line: string, onToken: (token: string) => void): void {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      return;
    }

    const chunk = JSON.parse(trimmed) as OllamaChatStreamChunk;
    const content = chunk.message?.content;

    if (content) {
      onToken(content);
    }
  }
}
