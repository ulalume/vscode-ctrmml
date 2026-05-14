export const LANGUAGE_ID = "ctrmml";
export const LANGUAGE_WASM = "tree-sitter-ctrmml.wasm";
export const LSP_ID = "ctrmml-lsp";
export const LSP_REPO = "ulalume/language-server-ctrmml";
// Pin to a known-good language-server release so an upstream release
// can't silently break the vendored grammar / semantic-token contract.
// Bump in lockstep with `web-ctrmml`'s `wasm-lang-core/build.sh` pin.
export const LSP_PINNED_TAG = "v0.6.4";
export const USER_AGENT = "vscode-ctrmml";
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const UPDATE_CHECK_FILENAME = ".ctrmml-lsp-last-check";
export const CMD_PLAY = "ctrmml.play";
export const CMD_PLAY_FROM_CURSOR = "ctrmml.playFromCursor";
export const CMD_STOP = "ctrmml.stop";
export const CMD_EXPORT_VGM = "ctrmml.exportVgm";
export const CMD_EXPORT_WAV = "ctrmml.exportWav";
export const CMD_MDSLINK_FILE = "ctrmml.mdslinkFile";
export const CMD_MDSLINK_DIRECTORY = "ctrmml.mdslinkDirectory";
export const CMD_MDSLINK_FROM_CONFIG = "ctrmml.mdslinkFromConfig";
export const CMD_MDSLINK_MENU = "ctrmml.mdslinkMenu";
export const CMD_QUICKROM_FILE = "ctrmml.quickromFile";
export const CMD_QUICKROM_DIRECTORY = "ctrmml.quickromDirectory";
export const CMD_QUICKROM_FROM_CONFIG = "ctrmml.quickromFromConfig";
export const CMD_QUICKROM_MENU = "ctrmml.quickromMenu";

// Code-lens lens command IDs. These match the titles emitted by the LSP's
// `textDocument/codeLens` response so the click chain
// (Monaco → vscode.commands.executeCommand → middleware) lands here.
export const CMD_PREVIEW_PATCH = "mml.previewPatch";
export const CMD_LOAD_PATCH = "mml.loadPatch";
export const CMD_SAVE_PATCH = "mml.savePatch";
