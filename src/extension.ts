import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import {
  CMD_LOAD_PATCH,
  CMD_MDSLINK_DIRECTORY,
  CMD_MDSLINK_FILE,
  CMD_MDSLINK_FROM_CONFIG,
  CMD_MDSLINK_MENU,
  CMD_EXPORT_VGM,
  CMD_EXPORT_WAV,
  CMD_PATCH_FORMATS,
  CMD_PLAY,
  CMD_PLAY_FROM_CURSOR,
  CMD_PREVIEW_PATCH,
  CMD_QUICKROM_DIRECTORY,
  CMD_QUICKROM_FILE,
  CMD_QUICKROM_FROM_CONFIG,
  CMD_QUICKROM_MENU,
  CMD_SAVE_PATCH,
  CMD_STOP,
  LANGUAGE_ID,
  LSP_ID,
} from "./constants";
import { ensureServerBinary } from "./lsp";
import {
  CtrmmlSemanticTokensProvider,
  SEMANTIC_TOKEN_TYPES,
} from "./semanticTokens";
import { fileExists } from "./utils/fs";

let client: LanguageClient | undefined;

const CMD_STATUS_EXPORT_MENU = "ctrmml.status.exportMenu";
const CMD_STATUS_MDSLINK_MENU = "ctrmml.status.mdslinkMenu";
const CMD_STATUS_QUICKROM_MENU = "ctrmml.status.quickromMenu";

const COMMANDS_NEED_URI = new Set([
  CMD_MDSLINK_FILE,
  CMD_MDSLINK_DIRECTORY,
  CMD_MDSLINK_FROM_CONFIG,
  CMD_MDSLINK_MENU,
  CMD_QUICKROM_FILE,
  CMD_QUICKROM_DIRECTORY,
  CMD_QUICKROM_FROM_CONFIG,
  CMD_QUICKROM_MENU,
  CMD_PLAY,
  CMD_PLAY_FROM_CURSOR,
  CMD_EXPORT_VGM,
  CMD_EXPORT_WAV,
]);

function resolveCommandArgs(command: string, args: any[]): any[] {
  if (args.length > 0 || !COMMANDS_NEED_URI.has(command)) {
    return args;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== LANGUAGE_ID) {
    return args;
  }

  const uri = editor.document.uri.toString();
  if (command === CMD_PLAY_FROM_CURSOR) {
    const position = editor.selection.active;
    return [uri, position.line, position.character];
  }
  return [uri];
}

function registerStatusBarItems(context: vscode.ExtensionContext): void {
  const playItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  playItem.text = "$(play) Play";
  playItem.tooltip = "ctrmml: play";
  playItem.command = CMD_PLAY;

  const playCursorItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    95
  );
  playCursorItem.text = "$(play-circle) Play Cursor";
  playCursorItem.tooltip = "ctrmml: play from cursor";
  playCursorItem.command = CMD_PLAY_FROM_CURSOR;

  const stopItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    90
  );
  stopItem.text = "$(stop) Stop";
  stopItem.tooltip = "ctrmml: stop";
  stopItem.command = CMD_STOP;

  const exportItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    80
  );
  exportItem.text = "$(save) Export";
  exportItem.tooltip = "ctrmml: export";
  exportItem.command = CMD_STATUS_EXPORT_MENU;

  const quickromItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    70
  );
  quickromItem.text = "$(package) QuickROM";
  quickromItem.tooltip = "ctrmml: quickrom";
  quickromItem.command = CMD_STATUS_QUICKROM_MENU;

  const mdslinkItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    60
  );
  mdslinkItem.text = "$(link) Mdslink";
  mdslinkItem.tooltip = "ctrmml: mdslink";
  mdslinkItem.command = CMD_STATUS_MDSLINK_MENU;

  const updateVisibility = () => {
    const editor = vscode.window.activeTextEditor;
    const isCtrmml = editor?.document.languageId === LANGUAGE_ID;
    if (isCtrmml) {
      playItem.show();
      playCursorItem.show();
      stopItem.show();
      exportItem.show();
      quickromItem.show();
      mdslinkItem.show();
    } else {
      playItem.hide();
      playCursorItem.hide();
      stopItem.hide();
      exportItem.hide();
      quickromItem.hide();
      mdslinkItem.hide();
    }
  };

  context.subscriptions.push(
    playItem,
    playCursorItem,
    stopItem,
    exportItem,
    quickromItem,
    mdslinkItem,
    vscode.window.onDidChangeActiveTextEditor(updateVisibility),
    vscode.commands.registerCommand(CMD_STATUS_EXPORT_MENU, async () => {
      const selection = await vscode.window.showQuickPick(
        [
          { label: "Export VGM", command: CMD_EXPORT_VGM },
          { label: "Export WAV", command: CMD_EXPORT_WAV },
        ],
        { placeHolder: "ctrmml: export" }
      );
      if (!selection) {
        return;
      }
      await vscode.commands.executeCommand(selection.command);
    }),
    vscode.commands.registerCommand(CMD_STATUS_MDSLINK_MENU, () =>
      showMdslinkMenu()
    ),
    vscode.commands.registerCommand(CMD_STATUS_QUICKROM_MENU, () =>
      showQuickromMenu()
    )
  );

  updateVisibility();
}

async function showMdslinkMenu(): Promise<void> {
  const selection = await vscode.window.showQuickPick(
    [
      { label: "mdslink file", command: CMD_MDSLINK_FILE },
      { label: "mdslink directory", command: CMD_MDSLINK_DIRECTORY },
      {
        label: "mdslink from mdslink.json",
        command: CMD_MDSLINK_FROM_CONFIG,
      },
    ],
    { placeHolder: "ctrmml: mdslink" }
  );
  if (!selection) {
    return;
  }
  await vscode.commands.executeCommand(selection.command);
}

async function showQuickromMenu(): Promise<void> {
  const selection = await vscode.window.showQuickPick(
    [
      { label: "quickrom file", command: CMD_QUICKROM_FILE },
      { label: "quickrom directory", command: CMD_QUICKROM_DIRECTORY },
      {
        label: "quickrom from quickrom.json",
        command: CMD_QUICKROM_FROM_CONFIG,
      },
    ],
    { placeHolder: "ctrmml: quickrom" }
  );
  if (!selection) {
    return;
  }
  await vscode.commands.executeCommand(selection.command);
}

/**
 * Position the cursor just after the `fm` / `pcm` keyword on
 * `lineNumber` (1-based here, since this matches the lang-core/LSP wire
 * line which is 0-based — we add 1 below) and pop the completion list,
 * giving the user the same UX as `loadPatch` does in web-ctrmml.
 */
async function loadPatchAtLine(
  uri: string,
  zeroBasedLine: number,
  type: string,
): Promise<void> {
  if (type !== "fm" && type !== "pcm") {
    return;
  }
  const targetUri = vscode.Uri.parse(uri);
  const document = await vscode.workspace.openTextDocument(targetUri);
  const editor = await vscode.window.showTextDocument(document);
  const line = zeroBasedLine; // already 0-based for vscode.Position
  const text = document.lineAt(line).text;
  const match = text.match(/^\s*@\d+\s+(fm|pcm)(?:\s|$)/);
  if (!match) {
    return;
  }
  const keyword = match[1];
  const kwIndex = match[0].lastIndexOf(keyword);
  const position = new vscode.Position(line, kwIndex + keyword.length);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
  await vscode.commands.executeCommand("editor.action.triggerSuggest");
}

interface PatchFormat {
  label: string;
  ext: string;
}

/** Shape of one entry in `ctrmml.patchFormats`'s JSON array response. */
interface RawPatchFormat {
  format: string;
  name: string;
  extension: string;
  can_read: boolean;
  can_write: boolean;
  is_text: boolean;
}

/** Used when the server doesn't answer `ctrmml.patchFormats` or the
 * client isn't running — only formats known writable. */
const FALLBACK_PATCH_FORMATS: PatchFormat[] = [
  { label: "DefleMask Preset (.dmp)", ext: "dmp" },
  { label: "Furnace Instrument (.fui)", ext: "fui" },
  { label: "GIN (.gin)", ext: "gin" },
  { label: "TFI (.tfi)", ext: "tfi" },
  { label: "VGI (.vgi)", ext: "vgi" },
  { label: "EIF (.eif)", ext: "eif" },
  { label: "ctrmml (.mml)", ext: "mml" },
];

/** `ctrmml.patchFormats` result, cached per client instance. */
let patchFormatsCache: { client: LanguageClient; formats: PatchFormat[] } | undefined;

/** Writable patch formats in the library's canonical order, fetched from
 * the server's `ctrmml.patchFormats` command and cached per client
 * session. Falls back to a static list if the request fails, the
 * response is unusable, or no client is running. */
async function getPatchFormats(
  client: LanguageClient | undefined,
): Promise<PatchFormat[]> {
  if (!client) return FALLBACK_PATCH_FORMATS;
  if (patchFormatsCache && patchFormatsCache.client === client) {
    return patchFormatsCache.formats;
  }
  try {
    const result = await client.sendRequest("workspace/executeCommand", {
      command: CMD_PATCH_FORMATS,
      arguments: [],
    });
    if (!Array.isArray(result)) throw new Error("unexpected response shape");
    const formats: PatchFormat[] = (result as RawPatchFormat[])
      .filter((f) => f && f.can_write === true)
      .map((f) => ({ label: `${f.name} (.${f.extension})`, ext: f.extension }));
    if (formats.length === 0) throw new Error("no writable formats");
    patchFormatsCache = { client, formats };
    return formats;
  } catch {
    return FALLBACK_PATCH_FORMATS;
  }
}

/** Pick a save target via the native file dialog, returning `{path,
 * format}` or `null` if the user cancelled. The default filename
 * follows web-ctrmml's convention `<basename>_@<N>.<ext>`. */
async function pickPatchSaveTarget(
  uri: string,
  instrumentNumber: number,
  client: LanguageClient | undefined,
): Promise<{ path: string; format: string } | null> {
  const patchFormats = await getPatchFormats(client);
  const sourceUri = vscode.Uri.parse(uri);
  const sourceName = sourceUri.path.split("/").pop() ?? "";
  const stem = sourceName.replace(/\.mml$/i, "") || "patch";
  const defaultName = `${stem}_@${instrumentNumber}.${patchFormats[0].ext}`;
  const defaultUri = vscode.Uri.joinPath(
    vscode.Uri.parse(uri).with({ path: sourceUri.path.replace(/\/[^/]*$/, "") }),
    defaultName,
  );

  const filters: Record<string, string[]> = {};
  for (const f of patchFormats) filters[f.label] = [f.ext];

  const picked = await vscode.window.showSaveDialog({
    defaultUri,
    filters,
    saveLabel: "Save patch",
    title: `Save @${instrumentNumber} as patch`,
  });
  if (!picked) return null;
  const ext = (picked.path.split(".").pop() ?? "").toLowerCase();
  const format =
    patchFormats.find((f) => f.ext === ext)?.ext ?? patchFormats[0].ext;
  return { path: picked.fsPath, format };
}

/** Extract the instrument number from the `@N` header at `lineNumber`
 * (0-based) — used to seed the save dialog's default filename. */
function readInstrumentNumber(
  document: vscode.TextDocument,
  zeroBasedLine: number,
): number | null {
  if (zeroBasedLine < 0 || zeroBasedLine >= document.lineCount) return null;
  const match = document.lineAt(zeroBasedLine).text.match(/^\s*@(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function registerLensCommands(
  context: vscode.ExtensionContext,
  getClient: () => LanguageClient | undefined,
): void {
  // Code-lens click chain: Monaco code-lens → vscode.commands.executeCommand
  // ("mml.previewPatch" or "mml.savePatch", …args). For commands the LSP
  // owns we forward the request via the language client; for ones that
  // need native UI (Load triggers completion, Save prompts a file
  // dialog) we handle them here and then optionally call the LSP.
  const forwardToLsp = (command: string) =>
    vscode.commands.registerCommand(command, async (...args: unknown[]) => {
      const client = getClient();
      if (!client) {
        vscode.window.showWarningMessage(
          "ctrmml-lsp is not running; lens commands are unavailable.",
        );
        return;
      }
      await client.sendRequest("workspace/executeCommand", {
        command,
        arguments: args,
      });
    });

  context.subscriptions.push(
    forwardToLsp(CMD_PREVIEW_PATCH),
    vscode.commands.registerCommand(
      CMD_LOAD_PATCH,
      async (uri: string, line: unknown, type: unknown) => {
        const zeroBased = typeof line === "number"
          ? line
          : typeof line === "string"
            ? parseInt(line, 10) || 0
            : 0;
        await loadPatchAtLine(uri, zeroBased, String(type));
      },
    ),
    vscode.commands.registerCommand(
      CMD_SAVE_PATCH,
      async (uri: string, line: unknown, type: unknown) => {
        if (type !== "fm") {
          // Only FM patch export is wired right now — PSG/PCM blocks
          // don't have a matching format ladder in ym2612_convert.
          vscode.window.showInformationMessage(
            "Only @N fm blocks can be exported as patches.",
          );
          return;
        }
        const zeroBased = typeof line === "number"
          ? line
          : typeof line === "string"
            ? parseInt(line, 10) || 0
            : 0;
        const client = getClient();
        if (!client) {
          vscode.window.showWarningMessage(
            "ctrmml-lsp is not running; save patch is unavailable.",
          );
          return;
        }
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.parse(uri),
        );
        const number = readInstrumentNumber(document, zeroBased) ?? 1;
        const target = await pickPatchSaveTarget(uri, number, client);
        if (!target) return;
        try {
          await client.sendRequest("workspace/executeCommand", {
            command: CMD_SAVE_PATCH,
            arguments: [uri, zeroBased, type, target.path, target.format],
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Save patch failed: ${message}`);
        }
      },
    ),
  );
}

/** First-class completion settings in the server's snake_case wire form. */
function completionInitializationOptions(
  config: vscode.WorkspaceConfiguration
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    arpeggio_enabled: config.get<boolean>("completion.arpeggio.enabled", false),
    arpeggio_pattern: config.get<string>("completion.arpeggio.pattern", "up"),
    chord_stack_mode: config.get<string>("completion.chordStackMode", "stack_up"),
  };
  // "auto" omits the key entirely so the server falls back to its
  // editor-based default (VS Code gets the hierarchical picker).
  const hierarchy = config.get<string>("completion.fmPickerHierarchy", "auto");
  if (hierarchy === "on" || hierarchy === "off") {
    options.fm_picker_hierarchy = hierarchy === "on";
  }
  return options;
}

/** Merge first-class completion settings with the raw
 * `ctrmml.languageServer.initializationOptions` object. The raw object
 * wins on conflicts; the server accepts snake_case and camelCase keys,
 * so a field counts as overridden in either spelling. */
function mergeInitializationOptions(
  completion: Record<string, unknown>,
  raw: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!raw) {
    return completion;
  }
  const merged: Record<string, unknown> = { ...completion };
  for (const key of Object.keys(completion)) {
    const camel = key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
    if (key in raw || camel in raw) {
      delete merged[key];
    }
  }
  return { ...merged, ...raw };
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const semanticLegend = new vscode.SemanticTokensLegend(
    [...SEMANTIC_TOKEN_TYPES],
    []
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      { scheme: "file", language: LANGUAGE_ID },
      new CtrmmlSemanticTokensProvider(context, semanticLegend),
      semanticLegend
    )
  );

  const config = vscode.workspace.getConfiguration("ctrmml");
  const customPath = config.get<string>("languageServer.path")?.trim();
  const args = config.get<string[]>("languageServer.args") ?? [];
  const env = config.get<Record<string, string>>("languageServer.env") ?? {};
  const initOptions = config.get<Record<string, unknown> | null>(
    "languageServer.initializationOptions"
  );

  let command = customPath;
  if (command) {
    const exists = await fileExists(command);
    if (!exists) {
      vscode.window.showErrorMessage(
        `ctrmml-lsp not found at configured path: ${command}`
      );
      return;
    }
  } else {
    try {
      command = await ensureServerBinary(context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`ctrmml-lsp download failed: ${message}`);
      return;
    }
  }

  const serverOptions: ServerOptions = {
    command,
    args,
    options: {
      env: {
        ...process.env,
        ...env,
      },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: LANGUAGE_ID }],
    initializationOptions: mergeInitializationOptions(
      completionInitializationOptions(config),
      initOptions
    ),
    middleware: {
      executeCommand: (command, args, next) => {
        if (command === CMD_MDSLINK_MENU) {
          return showMdslinkMenu();
        }
        if (command === CMD_QUICKROM_MENU) {
          return showQuickromMenu();
        }
        const resolvedArgs = resolveCommandArgs(command, args);
        return next(command, resolvedArgs);
      },
    },
  };

  client = new LanguageClient(
    LSP_ID,
    "ctrmml language server",
    serverOptions,
    clientOptions
  );

  await client.start();
  context.subscriptions.push(client);

  registerStatusBarItems(context);
  registerLensCommands(context, () => client);
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}
