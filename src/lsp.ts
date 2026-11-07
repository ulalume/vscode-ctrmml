import * as fs from "fs";
import * as fsp from "fs/promises";
import * as https from "https";
import * as path from "path";
import { pipeline } from "stream/promises";
import AdmZip from "adm-zip";
import * as tar from "tar";
import { LSP_ID, LSP_PINNED_TAG, LSP_REPO, USER_AGENT } from "./constants";
import { fileExists } from "./utils/fs";

/** Idle time after which a stalled request is aborted. */
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

interface PlatformAssetInfo {
  os: "macos" | "linux" | "windows";
  arch: "arm64" | "x64";
  ext: "zip" | "tar.gz";
  binName: string;
}

/** Path of the pinned server binary under `storage`, installing it first
 * when it is missing. */
export async function ensureServerBinary(storage: string): Promise<string> {
  const platform = platformAssetInfo();
  const versionDirName = `${LSP_ID}-${LSP_PINNED_TAG}`;
  const versionDir = path.join(storage, versionDirName);
  const binPath = path.join(versionDir, platform.binName);
  if (!(await fileExists(binPath))) {
    await fsp.mkdir(storage, { recursive: true });
    await install(storage, versionDir, platform);
    await removeOtherVersions(storage, versionDirName);
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
  const binName = os === "windows" ? `${LSP_ID}.exe` : LSP_ID;
  return { os, arch, ext, binName };
}

/** Download and extract the pinned release into a temporary directory,
 * then move it to `versionDir` in one rename. */
async function install(
  storage: string,
  versionDir: string,
  platform: PlatformAssetInfo
): Promise<void> {
  const version = LSP_PINNED_TAG.replace(/^v/, "");
  const assetName = `${LSP_ID}-${version}-${platform.os}-${platform.arch}.${platform.ext}`;
  const url = `https://github.com/${LSP_REPO}/releases/download/${LSP_PINNED_TAG}/${assetName}`;
  const tempDir = await fsp.mkdtemp(path.join(storage, ".tmp-"));
  try {
    const archivePath = path.join(tempDir, assetName);
    await downloadFile(url, archivePath);
    await extractArchive(archivePath, tempDir, platform.ext);
    await fsp.rm(archivePath, { force: true });
    const tempBin = path.join(tempDir, platform.binName);
    if (!(await fileExists(tempBin))) {
      throw new Error(`${platform.binName} not found in ${assetName}`);
    }
    await makeExecutable(tempBin);
    await moveIntoPlace(tempDir, versionDir, platform.binName);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

async function moveIntoPlace(
  tempDir: string,
  versionDir: string,
  binName: string
): Promise<void> {
  try {
    await fsp.rename(tempDir, versionDir);
  } catch {
    // Another window finished the same install first.
    if (await fileExists(path.join(versionDir, binName))) {
      return;
    }
    // A directory without the binary is not a usable install; replace it.
    await fsp.rm(versionDir, { recursive: true, force: true });
    await fsp.rename(tempDir, versionDir);
  }
}

/** Remove server directories of other versions. Best effort: a binary
 * still running in another window may not be removable on Windows. */
async function removeOtherVersions(
  storage: string,
  keep: string
): Promise<void> {
  const entries = await fsp.readdir(storage).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((name) => name !== keep && name.startsWith(`${LSP_ID}-`))
      .map((name) =>
        fsp
          .rm(path.join(storage, name), { recursive: true, force: true })
          .catch(() => undefined)
      )
  );
}

function downloadFile(
  url: string,
  destPath: string,
  redirects = 0
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { "User-Agent": USER_AGENT }, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) {
            reject(new Error(`too many redirects downloading ${url}`));
            return;
          }
          const next = new URL(res.headers.location, url).toString();
          downloadFile(next, destPath, redirects + 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`download failed: HTTP ${status} for ${url}`));
          return;
        }
        // Rejects on stream errors and on a response that ends early.
        pipeline(res, fs.createWriteStream(destPath)).then(resolve, reject);
      }
    );
    request.on("timeout", () => {
      request.destroy(new Error(`download timed out: ${url}`));
    });
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
