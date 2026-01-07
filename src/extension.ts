import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import {
  CMD_EXPORT_VGM,
  CMD_EXPORT_WAV,
  CMD_PLAY,
  CMD_PLAY_FROM_CURSOR,
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

const CMD_EXPORT_MENU = "ctrmml.status.exportMenu";

const COMMANDS_NEED_URI = new Set([
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
  exportItem.command = CMD_EXPORT_MENU;

  const updateVisibility = () => {
    const editor = vscode.window.activeTextEditor;
    const isCtrmml = editor?.document.languageId === LANGUAGE_ID;
    if (isCtrmml) {
      playItem.show();
      playCursorItem.show();
      stopItem.show();
      exportItem.show();
    } else {
      playItem.hide();
      playCursorItem.hide();
      stopItem.hide();
      exportItem.hide();
    }
  };

  context.subscriptions.push(
    playItem,
    playCursorItem,
    stopItem,
    exportItem,
    vscode.window.onDidChangeActiveTextEditor(updateVisibility),
    vscode.commands.registerCommand(CMD_EXPORT_MENU, async () => {
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
    })
  );

  updateVisibility();
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
