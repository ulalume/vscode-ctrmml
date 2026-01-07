import * as fs from "fs";
import * as fsp from "fs/promises";
import * as https from "https";
import * as path from "path";
import * as vscode from "vscode";
import AdmZip from "adm-zip";
import * as tar from "tar";
import {
  LSP_ID,
  LSP_REPO,
  UPDATE_CHECK_FILENAME,
  UPDATE_CHECK_INTERVAL_MS,
  USER_AGENT,
} from "./constants";
import { fileExists } from "./utils/fs";

interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface PlatformAssetInfo {
  os: "macos" | "linux" | "windows";
  arch: "arm64" | "x64";
  ext: "zip" | "tar.gz";
}

export async function ensureServerBinary(
  context: vscode.ExtensionContext
): Promise<string> {
  const storage = context.globalStorageUri.fsPath;
  await fsp.mkdir(storage, { recursive: true });

  const platform = platformAssetInfo();
  const cachedPath = await findCachedBinary(storage, platform);
  const checkDue = !cachedPath || (await updateCheckDue(storage));
  if (cachedPath && !checkDue) {
    await makeExecutable(cachedPath);
    return cachedPath;
  }

  let release: GithubRelease;
  try {
    release = await fetchLatestRelease();
    await recordUpdateCheck(storage);
  } catch (err) {
    if (cachedPath) {
      await recordUpdateCheck(storage);
      await makeExecutable(cachedPath);
      return cachedPath;
    }
    throw err;
  }
  const version = release.tag_name.replace(/^v/, "");
  const assetName = `${LSP_ID}-${version}-${platform.os}-${platform.arch}.${platform.ext}`;
  const asset = release.assets.find((entry) => entry.name === assetName);
  if (!asset) {
    if (cachedPath) {
      await makeExecutable(cachedPath);
      return cachedPath;
    }
    throw new Error(`no asset found matching ${assetName}`);
  }

  const versionDir = path.join(storage, `${LSP_ID}-${release.tag_name}`);
  const binName = platform.os === "windows" ? `${LSP_ID}.exe` : LSP_ID;
  const binPath = path.join(versionDir, binName);
  if (await fileExists(binPath)) {
    await makeExecutable(binPath);
    return binPath;
  }

  await fsp.mkdir(versionDir, { recursive: true });
  const archivePath = path.join(versionDir, assetName);
  try {
    await downloadFile(asset.browser_download_url, archivePath);
    await extractArchive(archivePath, versionDir, platform.ext);
    await fsp.unlink(archivePath).catch(() => undefined);
  } catch (err) {
    if (cachedPath) {
      await makeExecutable(cachedPath);
      return cachedPath;
    }
    throw err;
  }

  if (!(await fileExists(binPath))) {
    throw new Error(`ctrmml-lsp binary not found after extracting ${assetName}`);
  }

  await makeExecutable(binPath);
  return binPath;
}

function platformAssetInfo(): PlatformAssetInfo {
  let os: PlatformAssetInfo["os"];
  switch (process.platform) {
    case "darwin":
      os = "macos";
      break;
    case "linux":
      os = "linux";
      break;
    case "win32":
      os = "windows";
      break;
    default:
      throw new Error(`unsupported platform ${process.platform}`);
  }

  let arch: PlatformAssetInfo["arch"];
  switch (process.arch) {
    case "arm64":
      arch = "arm64";
      break;
    case "x64":
      arch = "x64";
      break;
    default:
      throw new Error(`unsupported architecture ${process.arch}`);
  }

  const ext: PlatformAssetInfo["ext"] = os === "windows" ? "zip" : "tar.gz";
  return { os, arch, ext };
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const url = `https://api.github.com/repos/${LSP_REPO}/releases/latest`;
  return fetchJson<GithubRelease>(url);
}

async function findCachedBinary(
  storage: string,
  platform: PlatformAssetInfo
): Promise<string | null> {
  const binName = platform.os === "windows" ? `${LSP_ID}.exe` : LSP_ID;
  let best: { mtimeMs: number; path: string } | null = null;
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(storage, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (!entry.name.startsWith(`${LSP_ID}-`)) {
      continue;
    }
    const candidate = path.join(storage, entry.name, binName);
    try {
      const stat = await fsp.stat(candidate);
      if (!stat.isFile()) {
        continue;
      }
      if (!best || stat.mtimeMs > best.mtimeMs) {
        best = { mtimeMs: stat.mtimeMs, path: candidate };
      }
    } catch {
      continue;
    }
  }
  return best ? best.path : null;
}

async function updateCheckDue(storage: string): Promise<boolean> {
  const last = await readLastUpdateCheck(storage);
  if (!last) {
    return true;
  }
  return Date.now() - last >= UPDATE_CHECK_INTERVAL_MS;
}

async function readLastUpdateCheck(storage: string): Promise<number | null> {
  const filePath = path.join(storage, UPDATE_CHECK_FILENAME);
  try {
    const text = await fsp.readFile(filePath, "utf8");
    const value = Number.parseInt(text.trim(), 10);
    return Number.isNaN(value) ? null : value;
  } catch {
    return null;
  }
}

async function recordUpdateCheck(storage: string): Promise<void> {
  const filePath = path.join(storage, UPDATE_CHECK_FILENAME);
  await fsp.writeFile(filePath, Date.now().toString());
}

async function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": USER_AGENT } },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(
            new Error(`request failed: ${res.statusCode ?? "unknown status"}`)
          );
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve(JSON.parse(text) as T);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
  });
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { "User-Agent": USER_AGENT } },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          downloadFile(res.headers.location, destPath).then(resolve, reject);
          return;
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(
            new Error(`download failed: ${res.statusCode ?? "unknown status"}`)
          );
          return;
        }

        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", (err) => {
          file.close();
          reject(err);
        });
      }
    );
    request.on("error", reject);
  });
}

async function extractArchive(
  archivePath: string,
  destDir: string,
  ext: "zip" | "tar.gz"
): Promise<void> {
  if (ext === "zip") {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(destDir, true);
    return;
  }
  await tar.x({
    file: archivePath,
    cwd: destDir,
  });
}

async function makeExecutable(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    await fsp.chmod(filePath, 0o755);
  }
}
