import * as vscode from "vscode";

export class PatchPreviewService {
  public async showMarkdown(title: string, content: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      content,
      language: "markdown"
    });

    await vscode.window.showTextDocument(document, {
      preview: false,
      viewColumn: vscode.ViewColumn.Beside
    });
    void vscode.window.setStatusBarMessage(title, 3000);
  }

  public async showPatch(title: string, patch: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      content: patch,
      language: "diff"
    });

    await vscode.window.showTextDocument(document, {
      preview: false,
      viewColumn: vscode.ViewColumn.Beside
    });
    void vscode.window.setStatusBarMessage(title, 3000);
  }
}
