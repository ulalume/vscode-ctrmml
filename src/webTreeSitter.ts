import type * as ParserType from "web-tree-sitter";

// Use require to force the CJS build so bundled output has a real module path.
export const Parser: typeof ParserType = require("web-tree-sitter");
