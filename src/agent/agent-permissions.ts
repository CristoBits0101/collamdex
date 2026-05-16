export interface AgentPermissions {
  readonly allowReadWorkspace: boolean;
  readonly allowTerminalWithoutConfirmation: boolean;
  readonly allowWriteWithoutConfirmation: boolean;
  readonly maxIterations: number;
}

export function createDefaultAgentPermissions(maxIterations: number): AgentPermissions {
  return {
    allowReadWorkspace: true,
    allowTerminalWithoutConfirmation: false,
    allowWriteWithoutConfirmation: false,
    maxIterations
  };
}
