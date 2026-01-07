const fs = require("fs");
const path = require("path");

const src = require.resolve("web-tree-sitter/web-tree-sitter.wasm");
const dest = path.join(__dirname, "..", "out", "web-tree-sitter.wasm");

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
