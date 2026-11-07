import * as vscode from "vscode";
import { getTreeSitterLanguage } from "./treeSitter";
import { errorMessage } from "./utils/error";
import {
  Parser,
  type Language,
  type Tree,
  type TreeCursor,
} from "./webTreeSitter";

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

const TOKEN_INDEX_BY_NODE = new Map(
  Object.entries(TOKEN_TYPE_BY_NODE).map(([node, type]) => [
    node,
    SEMANTIC_TOKEN_TYPES.indexOf(type),
  ])
);

let treeSitterErrorShown = false;

export class CtrmmlSemanticTokensProvider
  implements vscode.DocumentSemanticTokensProvider, vscode.Disposable
{
  private parser: InstanceType<typeof Parser.Parser> | undefined;

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
        vscode.window.showWarningMessage(
          `ctrmml highlight disabled: ${errorMessage(err)}`
        );
        treeSitterErrorShown = true;
      }
      return new vscode.SemanticTokens(new Uint32Array());
    }

    if (token.isCancellationRequested) {
      return new vscode.SemanticTokens(new Uint32Array());
    }

    if (!this.parser) {
      this.parser = new Parser.Parser();
      this.parser.setLanguage(language);
    }
    const text = document.getText();
    const tree = this.parser.parse(text);
    if (!tree) {
      return new vscode.SemanticTokens(new Uint32Array());
    }
    try {
      const builder = new vscode.SemanticTokensBuilder(this.legend);
      collectTokens(tree, text, builder);
      return builder.build();
    } finally {
      tree.delete();
    }
  }

  dispose(): void {
    this.parser?.delete();
    this.parser = undefined;
  }
}

/** Push a token for every named node without named children whose type is
 * highlighted. */
function collectTokens(
  tree: Tree,
  text: string,
  builder: vscode.SemanticTokensBuilder
): void {
  const cursor = tree.walk();
  try {
    for (;;) {
      if (gotoNamedChild(cursor)) {
        continue;
      }
      pushToken(cursor, text, builder);
      while (!gotoNamedSibling(cursor)) {
        if (!cursor.gotoParent()) {
          return;
        }
      }
    }
  } finally {
    cursor.delete();
  }
}

/** Move to the first named child; stays put when there is none. */
function gotoNamedChild(cursor: TreeCursor): boolean {
  if (!cursor.gotoFirstChild()) {
    return false;
  }
  do {
    if (cursor.nodeIsNamed) {
      return true;
    }
  } while (cursor.gotoNextSibling());
  cursor.gotoParent();
  return false;
}

function gotoNamedSibling(cursor: TreeCursor): boolean {
  while (cursor.gotoNextSibling()) {
    if (cursor.nodeIsNamed) {
      return true;
    }
  }
  return false;
}

const META_VALUE_NODES = new Set([
  "meta_value",
  "platform_known_value",
  "option_known_value",
  "group_known_value",
  "timesig_known_value",
]);

function pushToken(
  cursor: TreeCursor,
  text: string,
  builder: vscode.SemanticTokensBuilder
): void {
  const nodeType = cursor.nodeType;
  const tokenType = TOKEN_INDEX_BY_NODE.get(nodeType);
  if (tokenType === undefined) {
    return;
  }
  let { row, column } = cursor.startPosition;
  const end = cursor.endPosition;
  if (META_VALUE_NODES.has(nodeType)) {
    // Meta values include the whitespace after the keyword, line breaks
    // too; the token starts at the first non-space character.
    let index = cursor.startIndex;
    const endIndex = cursor.endIndex;
    for (; index < endIndex && /\s/.test(text[index]); index += 1) {
      if (text[index] === "\n") {
        row += 1;
        column = 0;
      } else {
        column += 1;
      }
    }
    if (index === endIndex) {
      return;
    }
  }
  // A semantic token cannot span lines.
  if (row !== end.row) {
    return;
  }
  builder.push(row, column, end.column - column, tokenType, 0);
}
