import * as fs from "fs";
import * as fsp from "fs/promises";
import * as https from "https";
import * as path from "path";
import { pipeline } from "stream/promises";
import { LSP_ID, LSP_PINNED_TAG, LSP_REPO, USER_AGENT } from "./constants";
import { fileExists } from "./utils/fs";

/** Idle time after which a stalled request is aborted. */
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

type ArchiveExt = "zip" | "tar.gz";

interface PlatformAssetInfo {
  os: string;
  arch: string;
  ext: ArchiveExt;
  binName: string;
}

const PLATFORMS: Partial<
  Record<NodeJS.Platform, { os: string; ext: ArchiveExt; binName: string }>
> = {
  darwin: { os: "macos", ext: "tar.gz", binName: LSP_ID },
  linux: { os: "linux", ext: "tar.gz", binName: LSP_ID },
  win32: { os: "windows", ext: "zip", binName: `${LSP_ID}.exe` },
};

const ARCHS: Partial<Record<string, string>> = { arm64: "arm64", x64: "x64" };

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
  const platform = PLATFORMS[process.platform];
  if (!platform) {
    throw new Error(`unsupported platform ${process.platform}`);
  }
  const arch = ARCHS[process.arch];
  if (!arch) {
    throw new Error(`unsupported architecture ${process.arch}`);
  }
  return { ...platform, arch };
}

/** Release asset name of the pinned version for `platform`. */
function assetName({ os, arch, ext }: PlatformAssetInfo): string {
  const version = LSP_PINNED_TAG.replace(/^v/, "");
  return `${LSP_ID}-${version}-${os}-${arch}.${ext}`;
}

/** Download and extract the pinned release into a temporary directory,
 * then move it to `versionDir` in one rename. */
async function install(
  storage: string,
  versionDir: string,
  platform: PlatformAssetInfo
): Promise<void> {
  const asset = assetName(platform);
  const url = `https://github.com/${LSP_REPO}/releases/download/${LSP_PINNED_TAG}/${asset}`;
  const tempDir = await fsp.mkdtemp(path.join(storage, ".tmp-"));
  try {
    const archivePath = path.join(tempDir, asset);
    await downloadFile(url, archivePath);
    await extractArchive(archivePath, tempDir, platform.ext);
    await fsp.rm(archivePath, { force: true });
    if (!(await fileExists(path.join(tempDir, platform.binName)))) {
      throw new Error(`${platform.binName} not found in ${asset}`);
    }
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

/** The archive libraries are loaded here so activation does not load them. */
async function extractArchive(
  archivePath: string,
  destDir: string,
  ext: ArchiveExt
): Promise<void> {
  if (ext === "zip") {
    const { default: AdmZip } = await import("adm-zip");
    new AdmZip(archivePath).extractAllTo(destDir, true);
    return;
  }
  const tar = await import("tar");
  await tar.x({ file: archivePath, cwd: destDir });
}

async function makeExecutable(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    await fsp.chmod(filePath, 0o755);
  }
}
