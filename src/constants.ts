export const LANGUAGE_ID = "ctrmml";
export const LANGUAGE_WASM = "tree-sitter-ctrmml.wasm";
export const LSP_ID = "ctrmml-lsp";
export const LSP_REPO = "ulalume/language-server-ctrmml";
// Language-server release the extension is tested with; it relies on the
// server's command IDs and arguments. Bump together with the pin in
// `megamml`'s `wasm-lang-core/build.sh`.
export const LSP_PINNED_TAG = "v0.8.1";
export const USER_AGENT = "vscode-ctrmml";
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
export const CMD_PATCH_FORMATS = "ctrmml.patchFormats";

// Command IDs of the server's code lenses. The extension registers these
// itself; the server does not advertise them to VS Code.
export const CMD_PREVIEW_PATCH = "mml.previewPatch";
export const CMD_LOAD_PATCH = "mml.loadPatch";
export const CMD_SAVE_PATCH = "mml.savePatch";
