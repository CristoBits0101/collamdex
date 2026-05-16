import * as vscode from "vscode";

export function getDiagnosticsContext(maxChars: number): string {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    return "";
  }

  const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);

  if (diagnostics.length === 0) {
    return "Sin diagnosticos visibles.";
  }

  const lines = diagnostics.map((diagnostic) => {
    const start = diagnostic.range.start;
    const severity = severityToText(diagnostic.severity);
    return `${severity} L${start.line + 1}: ${diagnostic.message}`;
  });

  const text = lines.join("\n");

  if (text.length <= maxChars) {
    return text;
  }

  return text.slice(0, maxChars);
}

function severityToText(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "Error";
    case vscode.DiagnosticSeverity.Warning:
      return "Warning";
    case vscode.DiagnosticSeverity.Information:
      return "Info";
    case vscode.DiagnosticSeverity.Hint:
      return "Hint";
  }
}
