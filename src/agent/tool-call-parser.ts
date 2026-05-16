export interface ParsedToolCall {
  readonly input: unknown;
  readonly name: string;
}

export function parseToolCalls(text: string): readonly ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  const regex = /```collamdex-tool\s*([\s\S]*?)```/g;
  let match = regex.exec(text);

  while (match) {
    const raw = match[1]?.trim();

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ParsedToolCall;
        if (typeof parsed.name === "string") {
          calls.push(parsed);
        }
      } catch {
        // Ignore invalid tool blocks. The agent prompt asks for plain text fallback.
      }
    }

    match = regex.exec(text);
  }

  return calls;
}
