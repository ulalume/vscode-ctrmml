import * as vscode from "vscode";
import * as Parser from "web-tree-sitter";
import { getTreeSitterLanguage } from "./treeSitter";

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
  meta_keyword: "keyword",
  meta_platform_value: "keyword",
  meta_value: "string",
  at_command: "function",
  track_selector: "type",
  instrument_type: "type",
  note: "variable",
  rest: "variable",
  command_with_number: "keyword",
  command: "keyword",
  escape_command: "keyword",
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
    let language: Parser.Language;
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
  node: Parser.Node,
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
    const trimmedRange = trimLeadingWhitespaceRange(
      node.type,
      range,
      document
    );
    if (!trimmedRange) {
      return;
    }
    const resolvedType = resolveTokenType(node.type, trimmedRange, document);
    builder.push(trimmedRange, resolvedType);
    return;
  }

  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child) {
      collectTokens(child, document, builder);
    }
  }
}

function resolveTokenType(
  nodeType: string,
  range: vscode.Range,
  document: vscode.TextDocument
): (typeof SEMANTIC_TOKEN_TYPES)[number] {
  if (nodeType === "meta_value") {
    const text = document.getText(range).trim();
    if (text === "noextpitch") {
      return "keyword";
    }
  }
  return TOKEN_TYPE_BY_NODE[nodeType];
}

function trimLeadingWhitespaceRange(
  nodeType: string,
  range: vscode.Range,
  document: vscode.TextDocument
): vscode.Range | null {
  if (nodeType !== "meta_platform_value" && nodeType !== "meta_value") {
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
