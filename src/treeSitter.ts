import * as vscode from "vscode";
import { LANGUAGE_WASM } from "./constants";
import { errorMessage } from "./utils/error";
import { fileExists } from "./utils/fs";
import { Parser, type Language } from "./webTreeSitter";

let languagePromise: Promise<Language> | null = null;

export async function getTreeSitterLanguage(
  context: vscode.ExtensionContext
): Promise<Language> {
  if (languagePromise) {
    return languagePromise;
  }
  const promise = (async () => {
    await Parser.Parser.init();
    const wasmPath = await resolveLanguageWasmPath(context);
    try {
      return await Parser.Language.load(wasmPath);
    } catch (err) {
      throw new Error(
        `cannot load ${LANGUAGE_WASM}: ${errorMessage(err)}. Rebuild it with \`npm run build:grammar\`.`
      );
    }
  })();
  languagePromise = promise;
  promise.catch(() => {
    if (languagePromise === promise) {
      languagePromise = null;
    }
  });
  return promise;
}

async function resolveLanguageWasmPath(
  context: vscode.ExtensionContext
): Promise<string> {
  const wasmPath = vscode.Uri.joinPath(
    context.extensionUri,
    LANGUAGE_WASM
  ).fsPath;
  if (await fileExists(wasmPath)) {
    return wasmPath;
  }
  throw new Error(`missing ${LANGUAGE_WASM} in extension root`);
}
