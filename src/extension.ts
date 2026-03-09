import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import {
  CMD_MDSLINK_DIRECTORY,
  CMD_MDSLINK_FILE,
  CMD_MDSLINK_FROM_CONFIG,
  CMD_MDSLINK_MENU,
  CMD_EXPORT_VGM,
  CMD_EXPORT_WAV,
  CMD_PLAY,
  CMD_PLAY_FROM_CURSOR,
  CMD_QUICKROM_DIRECTORY,
  CMD_QUICKROM_FILE,
  CMD_QUICKROM_FROM_CONFIG,
  CMD_QUICKROM_MENU,
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
    initializationOptions: initOptions ?? undefined,
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
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}
