import * as vscode from "vscode";
import { LANGUAGE_WASM } from "./constants";
import { fileExists } from "./utils/fs";
import { Parser, type Language } from "./webTreeSitter";

let languagePromise: Promise<Language> | null = null;

export async function getTreeSitterLanguage(
  context: vscode.ExtensionContext
): Promise<Language> {
  if (languagePromise) {
    return languagePromise;
  }
  languagePromise = (async () => {
    await Parser.Parser.init();
    const wasmPath = await resolveLanguageWasmPath(context);
    try {
      return await Parser.Language.load(wasmPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("libc.so") || message.includes("libc++")) {
        throw new Error(
          "tree-sitter wasm was built without --reuse-allocator. Rebuild with `tree-sitter build --wasm --reuse-allocator`."
        );
      }
      throw err;
    }
  })();
  return languagePromise;
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
