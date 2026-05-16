export interface AgentTool {
  readonly description: string;
  readonly name: string;
  readonly requiresConfirmation: boolean;
}

export const defaultAgentTools: readonly AgentTool[] = [
  {
    description: "Obtiene lenguaje, ruta, seleccion y contenido acotado del editor activo.",
    name: "getActiveEditor",
    requiresConfirmation: false
  },
  {
    description: "Obtiene errores y warnings visibles de VS Code.",
    name: "getDiagnostics",
    requiresConfirmation: false
  },
  {
    description: "Prepara un patch o bloque de reemplazo para preview.",
    name: "proposePatch",
    requiresConfirmation: false
  },
  {
    description: "Aplica cambios al workspace.",
    name: "applyWorkspaceEdit",
    requiresConfirmation: true
  },
  {
    description: "Prepara comandos de terminal sugeridos.",
    name: "runCommandPreview",
    requiresConfirmation: true
  }
];
