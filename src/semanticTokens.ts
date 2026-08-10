import * as vscode from "vscode";
import { getTreeSitterLanguage } from "./treeSitter";
import { Parser, type Language, type Node } from "./webTreeSitter";

export const SEMANTIC_TOKEN_TYPES = [
  "comment",
  "keyword",
  "string",
  "number",
  "function",
  "type",
  "variable",
  "operator",
  "property",
] as const;

const TOKEN_TYPE_BY_NODE: Record<
  string,
  (typeof SEMANTIC_TOKEN_TYPES)[number]
> = {
  comment: "comment",
  platform_command_keyword: "keyword",
  string: "string",
  number: "number",
  // Generic + the four discriminated meta keywords (`#platform`, `#option`,
  // `#group`, `#timesig`). Grammar emits a dedicated node per variant.
  meta_keyword: "keyword",
  platform_meta_keyword: "keyword",
  option_meta_keyword: "keyword",
  group_meta_keyword: "keyword",
  timesig_meta_keyword: "keyword",
  // Known-value nodes for the discriminated metas — these should pop as
  // keywords next to their preprocessor sibling.
  platform_known_value: "keyword",
  option_known_value: "keyword",
  group_known_value: "keyword",
  timesig_known_value: "keyword",
  meta_value: "string",
  at_command: "function",
  track_selector: "type",
  instrument_type: "type",
  note: "variable",
  rest: "variable",
  command_with_number: "keyword",
  command: "keyword",
  escape_command: "keyword",
  key_signature: "keyword",
  operator: "operator",
  punctuation: "operator",
  param_key: "property",
};

let treeSitterErrorShown = false;

export class CtrmmlSemanticTokensProvider
  implements vscode.DocumentSemanticTokensProvider
{
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly legend: vscode.SemanticTokensLegend
  ) {}

  async provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.SemanticTokens> {
    let language: Language;
    try {
      language = await getTreeSitterLanguage(this.context);
    } catch (err) {
      if (!treeSitterErrorShown) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showWarningMessage(
          `ctrmml highlight disabled: ${message}`
        );
        treeSitterErrorShown = true;
      }
      return new vscode.SemanticTokens(new Uint32Array());
    }

    if (token.isCancellationRequested) {
      return new vscode.SemanticTokens(new Uint32Array());
    }

    const parser = new Parser.Parser();
    parser.setLanguage(language);
    const tree = parser.parse(document.getText());
    if (!tree) {
      return new vscode.SemanticTokens(new Uint32Array());
    }
    const builder = new vscode.SemanticTokensBuilder(this.legend);
    collectTokens(tree.rootNode, document, builder);
    return builder.build();
  }
}

function collectTokens(
  node: Node,
  document: vscode.TextDocument,
  builder: vscode.SemanticTokensBuilder
): void {
  if (!node.isNamed) {
    return;
  }

  if (node.namedChildCount === 0) {
    const tokenType = TOKEN_TYPE_BY_NODE[node.type];
    if (!tokenType) {
      return;
    }

    const range = new vscode.Range(
      node.startPosition.row,
      node.startPosition.column,
      node.endPosition.row,
      node.endPosition.column
    );
    // The `*_known_value` and `meta_value` tokens capture the leading
    // whitespace between the keyword and the value to keep the grammar
    // simple. Strip it before pushing so the highlight starts at the
    // first non-space char.
    const trimmedRange = trimLeadingWhitespaceRange(
      node.type,
      range,
      document
    );
    if (!trimmedRange) {
      return;
    }
    builder.push(trimmedRange, tokenType);
    return;
  }

  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child) {
      collectTokens(child, document, builder);
    }
  }
}

const META_VALUE_NODES = new Set([
  "meta_value",
  "platform_known_value",
  "option_known_value",
  "group_known_value",
  "timesig_known_value",
]);

function trimLeadingWhitespaceRange(
  nodeType: string,
  range: vscode.Range,
  document: vscode.TextDocument
): vscode.Range | null {
  if (!META_VALUE_NODES.has(nodeType)) {
    return range;
  }

  const text = document.getText(range);
  let offset = 0;
  while (offset < text.length && /\s/.test(text[offset])) {
    offset += 1;
  }
  if (offset === 0) {
    return range;
  }
  const startOffset = document.offsetAt(range.start) + offset;
  const newStart = document.positionAt(startOffset);
  if (newStart.isAfterOrEqual(range.end)) {
    return null;
  }
  return new vscode.Range(newStart, range.end);
}
