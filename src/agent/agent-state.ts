export type AgentAction = "explain" | "fix" | "generate-tests" | "review" | "task";

export interface AgentRunOptions {
  readonly action: AgentAction;
  readonly task?: string;
}

export interface AgentRunResult {
  readonly model: string;
  readonly text: string;
}
