import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

export type PatchApplyStatus = "applied" | "failed" | "invalid" | "no-workspace" | "preview";
export type PatchFileOperation = "create" | "delete" | "edit";

export interface PatchApplyResult {
  readonly changes: readonly PatchFileChange[];
  readonly message: string;
  readonly status: PatchApplyStatus;
}

export interface PatchFileChange {
  readonly addedLines: number;
  readonly operation: PatchFileOperation;
  readonly path: string;
  readonly removedLines: number;
}

export class PatchPreviewService {
  public hasPatch(content: string): boolean {
    return extractUnifiedDiff(content) !== undefined;
  }

  public getPatchSummary(content: string): readonly PatchFileChange[] {
    const patch = extractUnifiedDiff(content);
    return patch ? summarizePatch(patch) : [];
  }

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

  public async showPatchAndOfferApply(
    title: string,
    content: string,
    requireConfirmation: boolean
  ): Promise<PatchApplyResult> {
    const patch = extractUnifiedDiff(content);
    const changes = patch ? summarizePatch(patch) : [];
    await this.showPatch(title, patch ?? content);

    if (!patch) {
      const message = "Collamdex no encontro un diff unificado aplicable en la respuesta.";
      void vscode.window.showWarningMessage(
        message
      );
      return { changes, message, status: "invalid" };
    }

    if (requireConfirmation) {
      const answer = await vscode.window.showInformationMessage(
        "Collamdex preparo un patch. Revisa la vista diff antes de aplicarlo.",
        { modal: true },
        "Aplicar patch",
        "Solo preview"
      );

      if (answer !== "Aplicar patch") {
        return {
          changes,
          message: "Patch abierto en preview. No se aplicaron cambios.",
          status: "preview"
        };
      }
    }

    return this.applyPatchWithGit(patch, changes);
  }

  private async applyPatchWithGit(
    patch: string,
    changes: readonly PatchFileChange[]
  ): Promise<PatchApplyResult> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      const message = "No hay workspace abierto para aplicar el patch.";
      void vscode.window.showErrorMessage(message);
      return { changes, message, status: "no-workspace" };
    }

    const patchPath = path.join(
      os.tmpdir(),
      `collamdex-${Date.now()}-${Math.random().toString(16).slice(2)}.patch`
    );

    try {
      await fs.writeFile(patchPath, patch, "utf8");
      await runGitApply(["apply", "--check", "--whitespace=nowarn", patchPath], workspaceFolder.uri.fsPath);
      await runGitApply(["apply", "--whitespace=nowarn", patchPath], workspaceFolder.uri.fsPath);
      const message = "Patch aplicado al workspace.";
      void vscode.window.showInformationMessage(message);
      return { changes, message, status: "applied" };
    } catch (error) {
      const message = `No se pudo aplicar el patch: ${formatCommandError(error)}`;
      void vscode.window.showErrorMessage(message);
      return { changes, message, status: "failed" };
    } finally {
      await fs.unlink(patchPath).catch(() => undefined);
    }
  }
}

async function runGitApply(args: readonly string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024 * 8,
    windowsHide: true
  });
}

function extractUnifiedDiff(content: string): string | undefined {
  const fencedBlocks = content.matchAll(/```(?:diff|patch)?\s*\r?\n([\s\S]*?)```/gi);

  for (const match of fencedBlocks) {
    const block = match[1]?.trim();

    if (block && looksLikeUnifiedDiff(block)) {
      return ensureTrailingNewline(block);
    }
  }

  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex(
    (line) => line.startsWith("diff --git ") || line.startsWith("--- ")
  );

  if (startIndex >= 0) {
    const candidate = lines.slice(startIndex).join("\n").trim();

    if (looksLikeUnifiedDiff(candidate)) {
      return ensureTrailingNewline(candidate);
    }
  }

  const trimmed = content.trim();
  return looksLikeUnifiedDiff(trimmed) ? ensureTrailingNewline(trimmed) : undefined;
}

function looksLikeUnifiedDiff(value: string): boolean {
  return (
    /(^|\n)(diff --git\s+a\/|\-\-\-\s+(?:a\/|\/dev\/null|[^\n]+))/.test(value) &&
    /(^|\n)\+\+\+\s+(?:b\/|\/dev\/null|[^\n]+)/.test(value) &&
    /(^|\n)@@\s+-\d/.test(value)
  );
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function summarizePatch(patch: string): readonly PatchFileChange[] {
  const changes: PatchFileChange[] = [];
  const lines = patch.split(/\r?\n/);
  let current: MutablePatchFileChange | undefined;
  let inHunk = false;

  const flush = () => {
    if (!current) {
      return;
    }

    const operation = inferOperation(current);
    const path = operation === "delete" ? current.oldPath : current.newPath || current.oldPath;

    if (path && path !== "/dev/null") {
      changes.push({
        addedLines: current.addedLines,
        operation,
        path,
        removedLines: current.removedLines
      });
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      current = createPatchFileChange();
      inHunk = false;

      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (match) {
        current.oldPath = unquotePatchPath(match[1] ?? "");
        current.newPath = unquotePatchPath(match[2] ?? "");
      }
      continue;
    }

    if (!current && (line.startsWith("--- ") || line.startsWith("+++ "))) {
      current = createPatchFileChange();
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("new file mode")) {
      current.operation = "create";
      continue;
    }

    if (line.startsWith("deleted file mode")) {
      current.operation = "delete";
      continue;
    }

    if (line.startsWith("--- ")) {
      const oldPath = normalizePatchPath(line.slice(4).trim());
      current.oldPath = oldPath;
      if (oldPath === "/dev/null") {
        current.operation = "create";
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      const newPath = normalizePatchPath(line.slice(4).trim());
      current.newPath = newPath;
      if (newPath === "/dev/null") {
        current.operation = "delete";
      }
      continue;
    }

    if (line.startsWith("@@ ")) {
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (line.startsWith("+")) {
      current.addedLines += 1;
    } else if (line.startsWith("-")) {
      current.removedLines += 1;
    }
  }

  flush();
  return changes;
}

interface MutablePatchFileChange {
  addedLines: number;
  newPath: string;
  oldPath: string;
  operation?: PatchFileOperation;
  removedLines: number;
}

function createPatchFileChange(): MutablePatchFileChange {
  return {
    addedLines: 0,
    newPath: "",
    oldPath: "",
    removedLines: 0
  };
}

function inferOperation(change: MutablePatchFileChange): PatchFileOperation {
  if (change.operation) {
    return change.operation;
  }

  if (change.oldPath === "/dev/null") {
    return "create";
  }

  if (change.newPath === "/dev/null") {
    return "delete";
  }

  return "edit";
}

function normalizePatchPath(value: string): string {
  const withoutTimestamp = value.split(/\t|\s{2,}/)[0] ?? value;
  const pathValue = unquotePatchPath(withoutTimestamp);

  if (pathValue === "/dev/null") {
    return pathValue;
  }

  return pathValue.replace(/^[ab]\//, "");
}

function unquotePatchPath(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }

  return value;
}

function formatCommandError(error: unknown): string {
  if (error instanceof Error) {
    const commandError = error as Error & { readonly stderr?: string; readonly stdout?: string };
    return (commandError.stderr || commandError.stdout || commandError.message).trim();
  }

  return "error desconocido";
}
