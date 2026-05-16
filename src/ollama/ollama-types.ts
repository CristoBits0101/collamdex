export interface OllamaModelDetails {
  readonly family?: string;
  readonly families?: readonly string[];
  readonly format?: string;
  readonly parameter_size?: string;
  readonly parent_model?: string;
  readonly quantization_level?: string;
}

export interface OllamaModel {
  readonly details?: OllamaModelDetails;
  readonly digest: string;
  readonly model?: string;
  readonly modified_at: string;
  readonly name: string;
  readonly size: number;
}

export interface OllamaRunningModel {
  readonly context_length?: number;
  readonly digest: string;
  readonly expires_at: string;
  readonly model: string;
  readonly name?: string;
  readonly size: number;
  readonly size_vram?: number;
}

export interface OllamaTagsResponse {
  readonly models: readonly OllamaModel[];
}

export interface OllamaPsResponse {
  readonly models: readonly OllamaRunningModel[];
}

export interface OllamaChatMessage {
  readonly content: string;
  readonly role: "assistant" | "system" | "user";
}

export interface OllamaChatRequest {
  readonly keep_alive?: string | number;
  readonly messages: readonly OllamaChatMessage[];
  readonly model: string;
  readonly options?: {
    readonly num_ctx?: number;
    readonly temperature?: number;
  };
  readonly stream: boolean;
}

export interface OllamaChatStreamChunk {
  readonly done?: boolean;
  readonly message?: {
    readonly content?: string;
    readonly role?: string;
  };
}
