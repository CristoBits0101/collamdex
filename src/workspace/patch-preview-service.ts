import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

export type PatchApplyStatus = "applied" | "failed" | "invalid" | "no-workspace" | "preview";
export type PatchFileOperation = "create" | "delete" | "edit";
type ProposedChangeKind = "file-operations" | "patch";
type WorkspaceFileWriteOperation = "create" | "edit" | "write";
type WorkspaceFileOperationKind = "delete" | WorkspaceFileWriteOperation;

const relativeFilePathPattern =
  /(?:^|[\s`"':(])((?:[A-Za-z0-9_.-]+[\\/])*[A-Za-z0-9_.-]+\.[A-Za-z0-9][A-Za-z0-9_-]{0,15})(?=$|[\s`"',:.)\]])/g;

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

interface ProposedWorkspaceChange {
  readonly changes: readonly PatchFileChange[];
  readonly content: string;
  readonly fileOperations?: readonly WorkspaceFileOperation[];
  readonly kind: ProposedChangeKind;
  readonly language: "diff" | "json";
}

interface WorkspaceFileOperation {
  readonly content?: string;
  readonly operation: WorkspaceFileOperationKind;
  readonly path: string;
}

export class PatchPreviewService {
  public hasPatch(content: string): boolean {
    return extractUnifiedDiff(content) !== undefined;
  }

  public hasApplicableChanges(content: string): boolean {
    return extractProposedWorkspaceChange(content) !== undefined;
  }

  public getPatchSummary(content: string): readonly PatchFileChange[] {
    const patch = extractUnifiedDiff(content);
    return patch ? summarizePatch(patch) : [];
  }

  public getChangeSummary(content: string): readonly PatchFileChange[] {
    return extractProposedWorkspaceChange(content)?.changes ?? [];
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

  public async showChangePreview(title: string, content: string): Promise<PatchApplyResult> {
    const proposedChange = extractProposedWorkspaceChange(content);

    if (!proposedChange) {
      const message =
        "Collamdex no encontro un diff unificado ni operaciones de archivo aplicables.";
      void vscode.window.showWarningMessage(message);
      return { changes: [], message, status: "invalid" };
    }

    await this.showPreviewDocument(title, proposedChange.content, proposedChange.language);
    return {
      changes: proposedChange.changes,
      message: "Cambios abiertos en preview. Esperando confirmacion.",
      status: "preview"
    };
  }

  public async applyProposedChanges(content: string): Promise<PatchApplyResult> {
    const proposedChange = extractProposedWorkspaceChange(content);

    if (!proposedChange) {
      const message =
        "Collamdex no encontro un diff unificado ni operaciones de archivo aplicables.";
      void vscode.window.showWarningMessage(message);
      return { changes: [], message, status: "invalid" };
    }

    if (proposedChange.kind === "patch") {
      return this.applyPatchWithGit(proposedChange.content, proposedChange.changes);
    }

    return this.applyFileOperations(proposedChange.fileOperations ?? [], proposedChange.changes);
  }

  public async showPatchAndOfferApply(
    title: string,
    content: string,
    requireConfirmation: boolean
  ): Promise<PatchApplyResult> {
    const proposedChange = extractProposedWorkspaceChange(content);

    if (!proposedChange) {
      const message =
        "Collamdex no encontro un diff unificado ni operaciones de archivo aplicables.";
      void vscode.window.showWarningMessage(
        message
      );
      return { changes: [], message, status: "invalid" };
    }

    await this.showPreviewDocument(title, proposedChange.content, proposedChange.language);

    if (requireConfirmation) {
      const answer = await vscode.window.showInformationMessage(
        "Collamdex preparo cambios. Revisa la vista preview antes de aplicarlos.",
        { modal: true },
        "Aplicar cambios",
        "Solo preview"
      );

      if (answer !== "Aplicar cambios") {
        return {
          changes: proposedChange.changes,
          message: "Cambios abiertos en preview. No se aplico nada.",
          status: "preview"
        };
      }
    }

    return this.applyProposedChanges(content);
  }

  private async showPreviewDocument(
    title: string,
    content: string,
    language: "diff" | "json"
  ): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      content,
      language
    });

    await vscode.window.showTextDocument(document, {
      preview: false,
      viewColumn: vscode.ViewColumn.Beside
    });
    void vscode.window.setStatusBarMessage(title, 3000);
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

  private async applyFileOperations(
    operations: readonly WorkspaceFileOperation[],
    changes: readonly PatchFileChange[]
  ): Promise<PatchApplyResult> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      const message = "No hay workspace abierto para aplicar cambios.";
      void vscode.window.showErrorMessage(message);
      return { changes, message, status: "no-workspace" };
    }

    if (operations.length === 0) {
      const message = "No hay operaciones de archivo validas para aplicar.";
      void vscode.window.showWarningMessage(message);
      return { changes, message, status: "invalid" };
    }

    try {
      for (const operation of operations) {
        const filePath = resolveWorkspaceFilePath(workspaceFolder.uri.fsPath, operation.path);

        if (operation.operation === "delete") {
          await fs.unlink(filePath);
          continue;
        }

        if (operation.content === undefined) {
          throw new Error(`La operacion de escritura no incluye contenido: ${operation.path}`);
        }

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, operation.content, "utf8");
      }

      const message = "Cambios aplicados al workspace.";
      void vscode.window.showInformationMessage(message);
      return { changes, message, status: "applied" };
    } catch (error) {
      const message = `No se pudieron aplicar los cambios: ${formatCommandError(error)}`;
      void vscode.window.showErrorMessage(message);
      return { changes, message, status: "failed" };
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

function extractProposedWorkspaceChange(content: string): ProposedWorkspaceChange | undefined {
  const patch = extractUnifiedDiff(content);

  if (patch) {
    return {
      changes: summarizePatch(patch),
      content: patch,
      kind: "patch",
      language: "diff"
    };
  }

  const fileOperations = extractWorkspaceFileOperations(content);

  if (fileOperations.length === 0) {
    return undefined;
  }

  return {
    changes: summarizeFileOperations(fileOperations),
    content: buildFileOperationsPreview(fileOperations),
    fileOperations,
    kind: "file-operations",
    language: "diff"
  };
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

function extractWorkspaceFileOperations(content: string): readonly WorkspaceFileOperation[] {
  const operations: WorkspaceFileOperation[] = [];
  const fencedBlocks = content.matchAll(
    /```(collamdex-files|collamdex-file|collamdex-tool)\s*\r?\n([\s\S]*?)```/gi
  );

  for (const match of fencedBlocks) {
    const blockType = match[1]?.toLowerCase();
    const raw = match[2]?.trim();

    if (!blockType || !raw) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const parsedOperations =
        blockType === "collamdex-tool"
          ? normalizeToolCall(parsed)
          : normalizeFileOperationContainer(parsed);
      operations.push(...parsedOperations);
    } catch {
      // Invalid structured blocks are ignored so normal markdown answers still render.
    }
  }

  if (operations.length === 0) {
    const plainMarkdownOperation = extractPlainMarkdownFileOperation(content);
    if (plainMarkdownOperation) {
      operations.push(plainMarkdownOperation);
    }
  }

  return operations;
}

function extractPlainMarkdownFileOperation(content: string): WorkspaceFileOperation | undefined {
  const intent = extractPlainFileIntent(content);

  if (!intent || !isMarkdownPath(intent.path)) {
    return undefined;
  }

  const markdownContent = extractMarkdownDocumentForPath(content, intent.path);

  if (!markdownContent) {
    return undefined;
  }

  return {
    content: markdownContent,
    operation: intent.operation,
    path: intent.path
  };
}

function extractPlainFileIntent(
  content: string
): { readonly operation: WorkspaceFileWriteOperation; readonly path: string } | undefined {
  const lines = content.split(/\r?\n/).slice(0, 40);

  for (const line of lines) {
    if (!hasFileWriteIntent(line)) {
      continue;
    }

    const pathCandidate = extractFirstRelativePathCandidate(line);

    if (!pathCandidate) {
      continue;
    }

    return {
      operation: inferPlainFileOperation(line),
      path: pathCandidate
    };
  }

  return extractMarkdownHeadingFileIntent(content);
}

function hasFileWriteIntent(value: string): boolean {
  return /\b(crea|crear|cree|genera|generar|escribe|escribir|anade|agrega|modifica|actualiza|edita|create|write|generate|add|modify|update|edit)\b/.test(
    normalizeForSearch(value)
  );
}

function inferPlainFileOperation(value: string): WorkspaceFileWriteOperation {
  const normalized = normalizeForSearch(value);

  if (/\b(crea|crear|cree|genera|generar|nuevo|nueva|create|generate|new)\b/.test(normalized)) {
    return "create";
  }

  if (/\b(modifica|actualiza|edita|modify|update|edit)\b/.test(normalized)) {
    return "edit";
  }

  return "write";
}

function extractFirstRelativePathCandidate(value: string): string | undefined {
  relativeFilePathPattern.lastIndex = 0;
  let match = relativeFilePathPattern.exec(value);

  while (match) {
    const candidate = sanitizePathCandidate(match[1] ?? "");

    if (candidate && isSafeRelativePathCandidate(candidate)) {
      return candidate;
    }

    match = relativeFilePathPattern.exec(value);
  }

  return undefined;
}

function extractMarkdownHeadingFileIntent(
  content: string
): { readonly operation: WorkspaceFileWriteOperation; readonly path: string } | undefined {
  const lines = content.split(/\r?\n/).slice(0, 40);

  for (const line of lines) {
    const match = /^#{1,2}\s+(.+?)\s*#*\s*$/.exec(line.trim());

    if (!match) {
      continue;
    }

    const pathCandidate = extractFirstRelativePathCandidate(match[1] ?? "");

    if (pathCandidate && isSafeRelativePathCandidate(pathCandidate) && isMarkdownPath(pathCandidate)) {
      return {
        operation: "create",
        path: pathCandidate
      };
    }
  }

  return undefined;
}

function sanitizePathCandidate(value: string): string {
  return value.replace(/^[`"'(<[]+/, "").replace(/[`"'),.;:\]]+$/, "").trim();
}

function isSafeRelativePathCandidate(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");

  return (
    normalized.length > 0 &&
    !normalized.includes("\0") &&
    !path.isAbsolute(normalized) &&
    !path.win32.isAbsolute(normalized) &&
    normalized.split("/").every((segment) => segment.length > 0 && segment !== "..")
  );
}

function isMarkdownPath(value: string): boolean {
  const extension = path.posix.extname(value.replace(/\\/g, "/")).toLowerCase();
  return extension === ".md" || extension === ".markdown";
}

function extractMarkdownDocumentForPath(content: string, targetPath: string): string | undefined {
  const fencedContent = extractMarkdownFenceForPath(content, targetPath);

  if (fencedContent) {
    return fencedContent;
  }

  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => isFileTitleHeading(line, targetPath));

  if (headingIndex < 0) {
    return undefined;
  }

  const markdownContent = lines.slice(headingIndex).join("\n").trimEnd();
  return markdownContent.trim().length > 0 ? ensureTrailingNewline(markdownContent) : undefined;
}

function extractMarkdownFenceForPath(content: string, targetPath: string): string | undefined {
  const fencedBlocks = content.matchAll(/```([A-Za-z0-9_-]*)[^\n]*\r?\n([\s\S]*?)```/g);

  for (const match of fencedBlocks) {
    const language = (match[1] ?? "").toLowerCase();

    if (!isMarkdownFenceLanguage(language)) {
      continue;
    }

    const blockStart = match.index ?? 0;
    const previousText = content.slice(Math.max(0, blockStart - 300), blockStart);

    if (!mentionsPath(previousText, targetPath)) {
      continue;
    }

    const raw = match[2]?.trimEnd();

    if (raw && raw.trim().length > 0) {
      return ensureTrailingNewline(raw);
    }
  }

  return undefined;
}

function isMarkdownFenceLanguage(value: string): boolean {
  return value.length === 0 || value === "md" || value === "markdown";
}

function mentionsPath(value: string, targetPath: string): boolean {
  const normalizedValue = normalizePathMention(value);
  const normalizedTarget = normalizePathMention(targetPath);
  const targetBaseName = path.posix.basename(normalizedTarget);

  return normalizedValue.includes(normalizedTarget) || normalizedValue.includes(targetBaseName);
}

function isFileTitleHeading(line: string, targetPath: string): boolean {
  const match = /^#{1,2}\s+(.+?)\s*#*\s*$/.exec(line.trim());

  if (!match) {
    return false;
  }

  const title = normalizeHeadingTitle(match[1] ?? "");
  const normalizedPath = normalizePathMention(targetPath);
  const baseName = path.posix.basename(normalizedPath);
  const extension = path.posix.extname(baseName);
  const stem = extension ? baseName.slice(0, -extension.length) : baseName;

  return title === baseName || title === stem;
}

function normalizeHeadingTitle(value: string): string {
  return normalizePathMention(value.replace(/[`"'()]/g, "").trim());
}

function normalizePathMention(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeToolCall(value: unknown): readonly WorkspaceFileOperation[] {
  if (!isRecord(value)) {
    return [];
  }

  const name = typeof value.name === "string" ? value.name : "";
  const input = isRecord(value.input) ? value.input : {};
  const normalizedName = name.toLowerCase();

  if (normalizedName === "applyworkspaceedit") {
    return normalizeFileOperationContainer(input.changes ?? input.operations ?? input);
  }

  if (
    normalizedName === "writefile" ||
    normalizedName === "createfile" ||
    normalizedName === "modifyfile"
  ) {
    const operation = normalizedName === "createfile" ? "create" : "write";
    const normalized = normalizeFileOperation({
      content: input.content,
      operation,
      path: input.path
    });
    return normalized ? [normalized] : [];
  }

  if (normalizedName === "deletefile" || normalizedName === "removefile") {
    const normalized = normalizeFileOperation({
      operation: "delete",
      path: input.path
    });
    return normalized ? [normalized] : [];
  }

  return [];
}

function normalizeFileOperationContainer(value: unknown): readonly WorkspaceFileOperation[] {
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.files)
      ? value.files
      : isRecord(value) && Array.isArray(value.operations)
        ? value.operations
        : isRecord(value) && Array.isArray(value.changes)
          ? value.changes
          : [value];

  return candidates
    .map((candidate) => normalizeFileOperation(candidate))
    .filter((operation): operation is WorkspaceFileOperation => operation !== undefined);
}

function normalizeFileOperation(value: unknown): WorkspaceFileOperation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const pathValue = value.path ?? value.file ?? value.target;

  if (typeof pathValue !== "string" || pathValue.trim().length === 0) {
    return undefined;
  }

  const operationValue = String(
    value.operation ?? value.action ?? value.type ?? "write"
  ).toLowerCase();
  const operation = normalizeFileOperationKind(operationValue);

  if (!operation) {
    return undefined;
  }

  if (operation === "delete") {
    return {
      operation,
      path: pathValue.trim()
    };
  }

  if (typeof value.content !== "string") {
    return undefined;
  }

  return {
    content: value.content,
    operation,
    path: pathValue.trim()
  };
}

function normalizeFileOperationKind(value: string): WorkspaceFileOperationKind | undefined {
  switch (value) {
    case "create":
    case "edit":
    case "update":
    case "write":
      return value === "update" ? "edit" : value;
    case "delete":
    case "remove":
    case "unlink":
      return "delete";
    default:
      return undefined;
  }
}

function summarizeFileOperations(
  operations: readonly WorkspaceFileOperation[]
): readonly PatchFileChange[] {
  return operations.map((operation) => {
    const addedLines =
      operation.operation === "delete" ? 0 : countContentLines(operation.content ?? "");
    return {
      addedLines,
      operation:
        operation.operation === "delete" ? "delete" : fileOperationToSummary(operation.operation),
      path: operation.path,
      removedLines: 0
    };
  });
}

function fileOperationToSummary(operation: WorkspaceFileWriteOperation): PatchFileOperation {
  if (operation === "create") {
    return "create";
  }

  return "edit";
}

function countContentLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  return content.replace(/\n$/, "").split(/\r?\n/).length;
}

function buildFileOperationsPreview(operations: readonly WorkspaceFileOperation[]): string {
  const lines: string[] = [];

  for (const operation of operations) {
    if (operation.operation === "delete") {
      lines.push(
        `diff --collamdex delete ${operation.path}`,
        `--- a/${operation.path}`,
        "+++ /dev/null",
        "@@ file delete @@",
        `- ${operation.path}`,
        ""
      );
      continue;
    }

    const contentLines = (operation.content ?? "").split(/\r?\n/);
    lines.push(
      `diff --collamdex ${operation.operation} ${operation.path}`,
      operation.operation === "create" ? "--- /dev/null" : `--- a/${operation.path}`,
      `+++ b/${operation.path}`,
      "@@ full file write @@",
      ...contentLines.map((line) => `+${line}`),
      ""
    );
  }

  return ensureTrailingNewline(lines.join("\n"));
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

function resolveWorkspaceFilePath(workspaceRoot: string, relativePath: string): string {
  const normalizedInput = relativePath.replace(/\\/g, "/").replace(/^[ab]\//, "");

  if (
    normalizedInput.length === 0 ||
    normalizedInput.includes("\0") ||
    path.isAbsolute(normalizedInput)
  ) {
    throw new Error(`Ruta de workspace invalida: ${relativePath}`);
  }

  const resolvedPath = path.resolve(workspaceRoot, normalizedInput);
  const relativeToWorkspace = path.relative(workspaceRoot, resolvedPath);

  if (
    relativeToWorkspace.length === 0 ||
    relativeToWorkspace.startsWith("..") ||
    path.isAbsolute(relativeToWorkspace)
  ) {
    throw new Error(`La ruta sale del workspace: ${relativePath}`);
  }

  return resolvedPath;
}

function formatCommandError(error: unknown): string {
  if (error instanceof Error) {
    const commandError = error as Error & { readonly stderr?: string; readonly stdout?: string };
    return (commandError.stderr || commandError.stdout || commandError.message).trim();
  }

  return "error desconocido";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
