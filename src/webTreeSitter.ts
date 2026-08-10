import type * as ParserType from "web-tree-sitter";

// Use require to force the CJS build so bundled output has a real module path.
export const Parser: typeof ParserType = require("web-tree-sitter");

// web-tree-sitter 0.26+ exports Language/Node/etc. as plain named exports,
// not under a Parser namespace, so type positions must import them directly.
export type { Language, Node } from "web-tree-sitter";
