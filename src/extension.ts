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
import { readInstrumentHeader } from "./instrumentHeader";
import { ensureServerBinary } from "./lsp";
import {
  CtrmmlSemanticTokensProvider,
  SEMANTIC_TOKEN_TYPES,
} from "./semanticTokens";
import { errorMessage } from "./utils/error";
import { fileExists } from "./utils/fs";

let client: LanguageClient | undefined;
/** Serializes client starts and stops. */
let clientQueue: Promise<void> = Promise.resolve();
let restartPending = false;
let outputChannel: vscode.OutputChannel | undefined;

/** Settings changes within this interval cause one restart. */
const CONFIG_RESTART_DELAY_MS = 400;
/** Settings whose change restarts the server. The server reads the
 * completion settings and `command_path` again itself. */
const RESTART_SETTINGS = [
  "ctrmml.languageServer.path",
  "ctrmml.languageServer.args",
  "ctrmml.languageServer.env",
];

const CMD_STATUS_RUN = "ctrmml.status.run";
const CMD_STATUS_EXPORT_MENU = "ctrmml.status.exportMenu";

const COMMANDS_NEED_URI = new Set([
  CMD_MDSLINK_FILE,
  CMD_MDSLINK_DIRECTORY,
  CMD_MDSLINK_FROM_CONFIG,
  CMD_QUICKROM_FILE,
  CMD_QUICKROM_DIRECTORY,
  CMD_QUICKROM_FROM_CONFIG,
  CMD_PLAY,
  CMD_PLAY_FROM_CURSOR,
  CMD_EXPORT_VGM,
  CMD_EXPORT_WAV,
]);

/** The running client, or `undefined` after telling the user it is not. */
function requireClient(): LanguageClient | undefined {
  if (client?.isRunning()) {
    return client;
  }
  vscode.window.showWarningMessage("ctrmml language server is not running.");
  return undefined;
}

/** Status bar command that runs a server command once the client is up. */
function serverCommand(command: string): vscode.Command {
  return { title: command, command: CMD_STATUS_RUN, arguments: [command] };
}

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

interface StatusItem {
  priority: number;
  text: string;
  tooltip: string;
  command: string | vscode.Command;
}

const STATUS_ITEMS: StatusItem[] = [
  {
    priority: 100,
    text: "$(play) Play",
    tooltip: "ctrmml: play",
    command: serverCommand(CMD_PLAY),
  },
  {
    priority: 95,
    text: "$(play-circle) Play Cursor",
    tooltip: "ctrmml: play from cursor",
    command: serverCommand(CMD_PLAY_FROM_CURSOR),
  },
  {
    priority: 90,
    text: "$(stop) Stop",
    tooltip: "ctrmml: stop",
    command: serverCommand(CMD_STOP),
  },
  {
    priority: 80,
    text: "$(save) Export",
    tooltip: "ctrmml: export",
    command: CMD_STATUS_EXPORT_MENU,
  },
  {
    priority: 70,
    text: "$(package) QuickROM",
    tooltip: "ctrmml: quickrom",
    command: serverCommand(CMD_QUICKROM_MENU),
  },
  {
    priority: 60,
    text: "$(link) Mdslink",
    tooltip: "ctrmml: mdslink",
    command: serverCommand(CMD_MDSLINK_MENU),
  },
];

interface MenuItem extends vscode.QuickPickItem {
  command: string;
}

const EXPORT_MENU: MenuItem[] = [
  { label: "Export VGM", command: CMD_EXPORT_VGM },
  { label: "Export WAV", command: CMD_EXPORT_WAV },
];

const MDSLINK_MENU: MenuItem[] = [
  { label: "mdslink file", command: CMD_MDSLINK_FILE },
  { label: "mdslink directory", command: CMD_MDSLINK_DIRECTORY },
  { label: "mdslink from mdslink.json", command: CMD_MDSLINK_FROM_CONFIG },
];

const QUICKROM_MENU: MenuItem[] = [
  { label: "quickrom file", command: CMD_QUICKROM_FILE },
  { label: "quickrom directory", command: CMD_QUICKROM_DIRECTORY },
  { label: "quickrom from quickrom.json", command: CMD_QUICKROM_FROM_CONFIG },
];

async function pickAndRun(
  placeHolder: string,
  items: MenuItem[]
): Promise<void> {
  const selection = await vscode.window.showQuickPick(items, { placeHolder });
  if (selection) {
    await vscode.commands.executeCommand(selection.command);
  }
}

function registerStatusBarItems(context: vscode.ExtensionContext): void {
  const items = STATUS_ITEMS.map(({ priority, text, tooltip, command }) => {
    const item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      priority
    );
    item.text = text;
    item.tooltip = tooltip;
    item.command = command;
    return item;
  });

  const updateVisibility = () => {
    const isCtrmml =
      vscode.window.activeTextEditor?.document.languageId === LANGUAGE_ID;
    for (const item of items) {
      if (isCtrmml) {
        item.show();
      } else {
        item.hide();
      }
    }
  };

  context.subscriptions.push(
    ...items,
    vscode.window.onDidChangeActiveTextEditor(updateVisibility),
    vscode.commands.registerCommand(CMD_STATUS_RUN, async (command: string) => {
      if (requireClient()) {
        await vscode.commands.executeCommand(command);
      }
    }),
    vscode.commands.registerCommand(CMD_STATUS_EXPORT_MENU, async () => {
      if (requireClient()) {
        await pickAndRun("ctrmml: export", EXPORT_MENU);
      }
    })
  );

  updateVisibility();
}

/**
 * Position the cursor just after the `fm` / `pcm` keyword of the `@N`
 * header on `zeroBasedLine` and pop the completion list, giving the user
 * the same UX as `loadPatch` does in web-ctrmml.
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
  const header = readInstrumentHeader(document, zeroBasedLine);
  if (!header || header.keyword.toLowerCase() !== type) {
    return;
  }
  const position = new vscode.Position(
    header.line,
    header.start + header.keyword.length,
  );
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

/** Writable patch formats in the library's canonical order, from the
 * server's `ctrmml.patchFormats`; empty when the request failed. */
async function getPatchFormats(client: LanguageClient): Promise<PatchFormat[]> {
  const result = await executeOnServer(
    client,
    "Save patch",
    CMD_PATCH_FORMATS,
    []
  );
  if (!Array.isArray(result)) {
    return [];
  }
  return (result as RawPatchFormat[])
    .filter((f) => f.can_write)
    .map((f) => ({ label: `${f.name} (.${f.extension})`, ext: f.extension }));
}

/** Pick a save target via the native file dialog, returning `{path,
 * format}`, or `null` when cancelled or no format is available. The
 * default filename follows web-ctrmml's convention `<basename>_@<N>.<ext>`. */
async function pickPatchSaveTarget(
  uri: string,
  instrumentNumber: number,
  client: LanguageClient,
): Promise<{ path: string; format: string } | null> {
  const patchFormats = await getPatchFormats(client);
  if (patchFormats.length === 0) return null;
  const sourceUri = vscode.Uri.parse(uri);
  const sourceName = sourceUri.path.split("/").pop() ?? "";
  const stem = sourceName.replace(/\.mml$/i, "") || "patch";
  const defaultName = `${stem}_@${instrumentNumber}.${patchFormats[0].ext}`;
  const defaultUri = vscode.Uri.joinPath(sourceUri, "..", defaultName);

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

function registerLensCommands(context: vscode.ExtensionContext): void {
  // Preview runs on the server. Load opens completion at the header; Save
  // asks for a file, then runs on the server.
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_PREVIEW_PATCH, async (...args) => {
      const client = requireClient();
      if (client) {
        await executeOnServer(client, CMD_PREVIEW_PATCH, CMD_PREVIEW_PATCH, args);
      }
    }),
    vscode.commands.registerCommand(
      CMD_LOAD_PATCH,
      async (uri: string, line: unknown, type: unknown) => {
        await loadPatchAtLine(uri, lensLine(line), String(type));
      },
    ),
    vscode.commands.registerCommand(
      CMD_SAVE_PATCH,
      async (uri: string, line: unknown, type: unknown) => {
        if (type !== "fm") {
          vscode.window.showInformationMessage(
            "Only @N fm blocks can be exported as patches.",
          );
          return;
        }
        const zeroBased = lensLine(line);
        const client = requireClient();
        if (!client) {
          return;
        }
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.parse(uri),
        );
        const number = readInstrumentHeader(document, zeroBased)?.number ?? 1;
        const target = await pickPatchSaveTarget(uri, number, client);
        if (!target) return;
        await executeOnServer(client, "Save patch", CMD_SAVE_PATCH, [
          uri,
          zeroBased,
          type,
          target.path,
          target.format,
        ]);
      },
    ),
  );
}

/** 0-based line from a code-lens argument. */
function lensLine(arg: unknown): number {
  if (typeof arg === "number") {
    return arg;
  }
  if (typeof arg === "string") {
    return parseInt(arg, 10) || 0;
  }
  return 0;
}

/** Run a server command and return its result; a failure is shown as
 * `<label> failed: …` and returns `undefined`. */
async function executeOnServer(
  client: LanguageClient,
  label: string,
  command: string,
  args: unknown[]
): Promise<unknown> {
  try {
    return await client.sendRequest("workspace/executeCommand", {
      command,
      arguments: args,
    });
  } catch (err) {
    vscode.window.showErrorMessage(`${label} failed: ${errorMessage(err)}`);
    return undefined;
  }
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const semanticLegend = new vscode.SemanticTokensLegend(
    [...SEMANTIC_TOKEN_TYPES],
    []
  );
  const semanticTokens = new CtrmmlSemanticTokensProvider(
    context,
    semanticLegend
  );
  context.subscriptions.push(
    semanticTokens,
    vscode.languages.registerDocumentSemanticTokensProvider(
      { scheme: "file", language: LANGUAGE_ID },
      semanticTokens,
      semanticLegend
    )
  );

  registerStatusBarItems(context);
  registerLensCommands(context);

  outputChannel = vscode.window.createOutputChannel("ctrmml language server");
  let configTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    outputChannel,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        RESTART_SETTINGS.some((setting) => event.affectsConfiguration(setting))
      ) {
        clearTimeout(configTimer);
        configTimer = setTimeout(
          () => void restartClient(context),
          CONFIG_RESTART_DELAY_MS
        );
      }
    }),
    { dispose: () => clearTimeout(configTimer) }
  );
  await restartClient(context);
}

/** Queue a restart unless one is already waiting; it reads the settings
 * when it starts. */
function restartClient(context: vscode.ExtensionContext): Promise<void> {
  if (restartPending) {
    return clientQueue;
  }
  restartPending = true;
  clientQueue = clientQueue.then(async () => {
    restartPending = false;
    await stopClient();
    await startClient(context);
  });
  return clientQueue;
}

/** What this extension handles itself. camelCase so that a key in
 * `ctrmml.languageServer.initializationOptions` wins in either spelling:
 * the server reads snake_case first. */
const CLIENT_OPTIONS = {
  codeLensIcons: "codicon",
  codeLensFileActions: true,
  // Play, stop, export, quickrom and mdslink are on the status bar.
  commandCodeActions: false,
  clientCommands: [CMD_PREVIEW_PATCH, CMD_LOAD_PATCH, CMD_SAVE_PATCH],
  // What `ctrmml.completion.fmPickerHierarchy: "auto"` means.
  fmPickerHierarchy: true,
};

async function startClient(context: vscode.ExtensionContext): Promise<void> {
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
      command = await ensureServerBinary(context.globalStorageUri.fsPath);
    } catch (err) {
      vscode.window.showErrorMessage(
        `ctrmml-lsp download failed: ${errorMessage(err)}`
      );
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
    outputChannel,
    initializationOptions: { ...CLIENT_OPTIONS, ...initOptions },
    middleware: {
      executeCommand: (command, args, next) => {
        if (command === CMD_MDSLINK_MENU) {
          return pickAndRun("ctrmml: mdslink", MDSLINK_MENU);
        }
        if (command === CMD_QUICKROM_MENU) {
          return pickAndRun("ctrmml: quickrom", QUICKROM_MENU);
        }
        return next(command, resolveCommandArgs(command, args));
      },
    },
  };

  const newClient = new LanguageClient(
    LSP_ID,
    "ctrmml language server",
    serverOptions,
    clientOptions
  );
  client = newClient;
  try {
    await newClient.start();
  } catch {
    // The client reports start failures itself.
  }
}

async function stopClient(): Promise<void> {
  const current = client;
  client = undefined;
  try {
    await current?.dispose();
  } catch {
    // Not running.
  }
}

export async function deactivate(): Promise<void> {
  clientQueue = clientQueue.then(stopClient);
  await clientQueue;
}
