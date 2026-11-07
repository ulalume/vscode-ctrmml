/** Lines after a bare `@N` that may hold its type keyword. */
const KEYWORD_LOOKAHEAD = 3;

interface Lines {
  readonly lineCount: number;
  lineAt(line: number): { readonly text: string };
}

export interface InstrumentHeader {
  number: number;
  /** The type keyword as written; empty when there is none. */
  keyword: string;
  /** 0-based line holding the keyword (the `@N` line when there is none). */
  line: number;
  /** Character offset of the keyword within `line`. */
  start: number;
}

/** Parse the `@N <type>` header whose `@N` starts `zeroBasedLine`. The type
 * keyword follows the number on the same line or is the first token of the
 * first non-blank, non-comment line among the next three, as the language
 * server reads it. */
export function readInstrumentHeader(
  document: Lines,
  zeroBasedLine: number
): InstrumentHeader | null {
  if (zeroBasedLine < 0 || zeroBasedLine >= document.lineCount) {
    return null;
  }
  const text = document.lineAt(zeroBasedLine).text;
  const match = text.match(/^\s*@(\d+)(?=$|[\s;])/);
  if (!match) {
    return null;
  }
  const number = parseInt(match[1], 10);
  const sameLine = firstToken(text, match[0].length);
  if (sameLine.token) {
    return {
      number,
      keyword: sameLine.token,
      line: zeroBasedLine,
      start: sameLine.start,
    };
  }
  const last = Math.min(
    zeroBasedLine + KEYWORD_LOOKAHEAD,
    document.lineCount - 1
  );
  for (let line = zeroBasedLine + 1; line <= last; line += 1) {
    const content = document.lineAt(line).text;
    const trimmed = content.trimStart();
    if (trimmed === "" || trimmed.startsWith(";")) {
      continue;
    }
    const { start, token } = firstToken(content, 0);
    return { number, keyword: token, line, start };
  }
  return { number, keyword: "", line: zeroBasedLine, start: text.length };
}

/** The first token at or after `from`, delimited by whitespace, `"`, `,`
 * and `;`. */
function firstToken(
  text: string,
  from: number
): { start: number; token: string } {
  const rest = text.slice(from);
  const start = from + rest.length - rest.trimStart().length;
  const token = text.slice(start).match(/^[^\s",;]*/)?.[0] ?? "";
  return { start, token };
}
