export type AgentAction = "explain" | "fix" | "generate-tests" | "review" | "task";

export type AgentActivityDirection = "forward" | "reverse";

export interface AgentRunProgress {
  readonly detail: string;
  readonly direction?: AgentActivityDirection;
  readonly phase: string;
}

export interface AgentRunEvents {
  readonly onComplete?: (event: { readonly detail: string; readonly result: AgentRunResult }) => void;
  readonly onError?: (message: string) => void;
  readonly onProgress?: (event: AgentRunProgress) => void;
  readonly onStart?: (event: { readonly detail: string; readonly model: string }) => void;
  readonly onToken?: (token: string) => void;
}

export interface AgentRunOptions {
  readonly action: AgentAction;
  readonly task?: string;
}

export interface AgentRunResult {
  readonly model: string;
  readonly task?: string;
  readonly text: string;
}
