// Builds tree-sitter-ctrmml.wasm from the grammar revision in package.json
// ("treeSitterCtrmml") with the tree-sitter CLI from devDependencies.
// Builds are cached per revision and CLI version under node_modules/.cache.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const { repository, rev } = require("../package.json").treeSitterCtrmml;
const cliVersion = require("tree-sitter-cli/package.json").version;
const dest = path.join(root, "tree-sitter-ctrmml.wasm");
const cached = path.join(
  root,
  "node_modules",
  ".cache",
  "tree-sitter-ctrmml",
  `${rev}-cli${cliVersion}.wasm`
);

if (!fs.existsSync(cached)) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "tree-sitter-ctrmml-"));
  try {
    const run = (cmd, args) =>
      execFileSync(cmd, args, { cwd: work, stdio: "inherit" });
    run("git", ["init", "--quiet"]);
    run("git", ["fetch", "--quiet", "--depth", "1", repository, rev]);
    run("git", ["checkout", "--quiet", "FETCH_HEAD"]);
    const built = path.join(work, "tree-sitter-ctrmml.wasm");
    run(process.execPath, [
      require.resolve("tree-sitter-cli/cli.js"),
      "build",
      "--wasm",
      "--output",
      built,
      work,
    ]);
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.copyFileSync(built, cached);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

fs.copyFileSync(cached, dest);
