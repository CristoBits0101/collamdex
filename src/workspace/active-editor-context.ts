import * as vscode from "vscode";

export interface ActiveEditorContext {
  readonly documentText: string;
  readonly hasSelection: boolean;
  readonly languageId: string;
  readonly relativePath: string;
  readonly selectedText: string;
}

export function getActiveEditorContext(maxChars: number): ActiveEditorContext | undefined {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    return undefined;
  }

  const document = editor.document;
  const selectedText = editor.selection.isEmpty ? "" : document.getText(editor.selection);
  const fullText = document.getText();

  return {
    documentText: limitText(fullText, maxChars),
    hasSelection: !editor.selection.isEmpty,
    languageId: document.languageId,
    relativePath: vscode.workspace.asRelativePath(document.uri),
    selectedText: limitText(selectedText, maxChars)
  };
}

export function limitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const half = Math.floor(maxChars / 2);
  return `${value.slice(0, half)}\n\n...[contenido recortado por Collamdex]...\n\n${value.slice(-half)}`;
}
