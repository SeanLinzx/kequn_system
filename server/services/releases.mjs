// 发布管理（合并自 camera-local-console/release-admin）
// 发布目录默认 kequn_system/public/releases/camera-local-console（主系统静态托管，URL 兼容原 release-admin）
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const CHANNELS = ["canary", "beta", "stable"];
export const PLATFORMS = ["win-x64", "linux-arm64", "linux-x64"];

export function releaseRoot() {
  return path.resolve(
    process.env.RELEASE_ROOT || join(__dirname, "..", "..", "public", "releases", "camera-local-console"),
  );
}
export function releaseBaseUrl() {
  const env = process.env.RELEASE_BASE_URL || process.env.TUNNEL_PUBLIC_URL || "";
  return `${env.replace(/\/+$/, "")}/releases/camera-local-console`;
}

function registryFile() {
  return path.join(releaseRoot(), "registry.json");
}
function readRegistry() {
  return readJsonFile(registryFile());
}
function writeRegistry(registry) {
  writeJson(registryFile(), registry);
}
function readChannel(channel) {
  const file = path.join(releaseRoot(), "channels", `${channel}.json`);
  return fs.existsSync(file) ? readJsonFile(file) : null;
}
function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function fileSha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

export function ensureLayout() {
  const root = releaseRoot();
  for (const dir of [
    root,
    path.join(root, "channels"),
    path.join(root, "manifests"),
    path.join(root, "packages", "win-x64"),
    path.join(root, "packages", "linux-arm64"),
    path.join(root, "packages", "linux-x64"),
    path.join(root, "uploads"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(registryFile())) {
    writeRegistry({ packages: [], channelHistory: [] });
  }
}

function publishedChannelsFor(version, platform) {
  return CHANNELS.filter((channel) => {
    const manifest = readChannel(channel);
    return manifest?.version === version && manifest?.platform === platform;
  });
}

function packageState(packages, channels) {
  return packages.map((item) => {
    const publishedChannels = CHANNELS.filter(
      (channel) => channels[channel]?.version === item.version && channels[channel]?.platform === item.platform,
    );
    return {
      ...item,
      status: publishedChannels.length ? "published" : item.status || "draft",
      publishedChannels,
    };
  });
}

export function state() {
  ensureLayout();
  const registry = readRegistry();
  const channels = Object.fromEntries(CHANNELS.map((channel) => [channel, readChannel(channel)]));
  return {
    releaseRoot: releaseRoot(),
    baseUrl: releaseBaseUrl(),
    currentVersion: readPackageVersion(),
    suggestedNextVersion: suggestNextVersion(registry.packages || []),
    channels,
    packages: packageState(registry.packages || [], channels),
    channelHistory: registry.channelHistory || [],
  };
}

/** 从服务器路径导入安装包（校验版本 → 拷贝 → SHA256 → 写 manifest/registry） */
export function importPackage({ sourcePath, version, platform, notes, required }) {
  const src = path.resolve(String(sourcePath || ""));
  const ver = String(version || "").trim();
  const plat = String(platform || "win-x64").trim();
  if (!src || !fs.existsSync(src)) throw new Error("sourcePath not found");
  if (!ver) throw new Error("version is required");
  if (!PLATFORMS.includes(plat)) throw new Error(`platform must be one of: ${PLATFORMS.join(", ")}`);
  validatePackageVersion(src, ver);

  const extension = safePackageExtension(src);
  const packageName = `camera-local-console-${plat}-${ver}${extension}`;
  const targetPath = path.join(releaseRoot(), "packages", plat, packageName);
  const registry = readRegistry();
  const existing = (registry.packages || []).find((item) => item.version === ver && item.platform === plat);
  const published = publishedChannelsFor(ver, plat);
  if (existing && published.length) {
    throw new Error(`version ${ver} / ${plat} 已发布到 ${published.join(", ")}，请先撤回通道后再覆盖`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${Date.now()}.tmp`;
  let sha256 = "";
  try {
    fs.copyFileSync(src, tempPath);
    sha256 = fileSha256(tempPath);
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  const baseUrl = releaseBaseUrl();
  const manifest = {
    version: ver,
    channel: "",
    platform: plat,
    url: `${baseUrl}/packages/${plat}/${packageName}`,
    sha256,
    required: Boolean(required),
    notes: String(notes || ""),
  };
  writeJson(path.join(releaseRoot(), "manifests", `${ver}-${plat}.json`), manifest);

  const now = new Date().toISOString();
  registry.packages = [
    { ...manifest, packageName, status: existing?.status || "draft", importedAt: existing?.importedAt || now, overwrittenAt: existing ? now : "", previousSha256: existing?.sha256 || "" },
    ...(registry.packages || []).filter((item) => !(item.version === ver && item.platform === plat)),
  ];
  if (existing) {
    registry.channelHistory = [
      { action: "overwrite", channel: "", version: ver, platform: plat, previousSha256: existing.sha256 || "", sha256, at: now },
      ...(registry.channelHistory || []),
    ].slice(0, 200);
  }
  writeRegistry(registry);
  return manifest;
}

export function getManifest(version, platform) {
  const p = path.join(releaseRoot(), "manifests", `${String(version || "")}-${String(platform || "")}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

export function promoteChannel({ channel, version, platform }) {
  const ch = String(channel || "").trim();
  const ver = String(version || "").trim();
  const plat = String(platform || "win-x64").trim();
  if (!CHANNELS.includes(ch)) throw new Error(`channel must be one of: ${CHANNELS.join(", ")}`);
  if (!ver) throw new Error("version is required");
  const manifestPath = path.join(releaseRoot(), "manifests", `${ver}-${plat}.json`);
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);
  const manifest = readJsonFile(manifestPath);
  manifest.channel = ch;
  writeJson(path.join(releaseRoot(), "channels", `${ch}.json`), manifest);
  const registry = readRegistry();
  registry.packages = (registry.packages || []).map((item) =>
    item.version === ver && item.platform === plat
      ? { ...item, status: "published", lastPublishedChannel: ch, publishedAt: new Date().toISOString() }
      : item,
  );
  registry.channelHistory = [
    { action: "promote", channel: ch, version: ver, platform: plat, at: new Date().toISOString() },
    ...(registry.channelHistory || []),
  ].slice(0, 200);
  writeRegistry(registry);
  return manifest;
}

export function rollbackChannel(body) {
  return promoteChannel(body);
}

export function revokeChannel({ channel }) {
  const ch = String(channel || "").trim();
  if (!CHANNELS.includes(ch)) throw new Error(`channel must be one of: ${CHANNELS.join(", ")}`);
  const channelPath = path.join(releaseRoot(), "channels", `${ch}.json`);
  const manifest = fs.existsSync(channelPath) ? readJsonFile(channelPath) : null;
  if (!manifest) throw new Error(`channel 已为空: ${ch}`);
  fs.rmSync(channelPath, { force: true });
  const registry = readRegistry();
  registry.packages = (registry.packages || []).map((item) =>
    item.version === manifest.version && item.platform === manifest.platform
      ? { ...item, status: "revoked", revokedAt: new Date().toISOString() }
      : item,
  );
  registry.channelHistory = [
    { action: "revoke", channel: ch, version: manifest.version, platform: manifest.platform, at: new Date().toISOString() },
    ...(registry.channelHistory || []),
  ].slice(0, 200);
  writeRegistry(registry);
  return { channel: ch, manifest };
}

export function deletePackage({ version, platform }) {
  const ver = String(version || "").trim();
  const plat = String(platform || "win-x64").trim();
  if (!ver) throw new Error("version is required");
  if (!PLATFORMS.includes(plat)) throw new Error(`platform must be one of: ${PLATFORMS.join(", ")}`);
  const published = publishedChannelsFor(ver, plat);
  if (published.length) {
    throw new Error(`package 已发布到 ${published.join(", ")}，请先撤回通道再删除`);
  }
  const registry = readRegistry();
  const item = (registry.packages || []).find((entry) => entry.version === ver && entry.platform === plat);
  if (!item) throw new Error("package not found");
  fs.rmSync(path.join(releaseRoot(), "manifests", `${ver}-${plat}.json`), { force: true });
  if (item.packageName) {
    fs.rmSync(path.join(releaseRoot(), "packages", plat, item.packageName), { force: true });
  }
  registry.packages = (registry.packages || []).filter((entry) => !(entry.version === ver && entry.platform === plat));
  registry.channelHistory = [
    { action: "delete", channel: "", version: ver, platform: plat, at: new Date().toISOString() },
    ...(registry.channelHistory || []),
  ].slice(0, 200);
  writeRegistry(registry);
  return { version: ver, platform: plat, deleted: true };
}

// ---------- 内部工具（自 release-admin 移植） ----------

function safePackageExtension(filename) {
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".tar.gz")) return ".tar.gz";
  if (lower.endsWith(".zip")) return ".zip";
  return path.extname(filename || "") || ".zip";
}

function validatePackageVersion(packagePath, expectedVersion) {
  const metadata = readPackageMetadata(packagePath);
  if (!metadata?.version) return;
  if (String(metadata.version).trim() !== expectedVersion) {
    throw new Error(`安装包内 version.json 版本为 ${metadata.version}，与填写版本 ${expectedVersion} 不一致，请重新打包或修改版本号。`);
  }
}

function readPackageMetadata(packagePath) {
  if (!String(packagePath).toLowerCase().endsWith(".zip")) return null;
  try {
    const content = fs.readFileSync(packagePath);
    const entry = readZipEntry(content, "version.json");
    if (!entry) return null;
    return JSON.parse(entry.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`读取安装包版本信息失败：${error.message}`);
  }
}

function readZipEntry(buffer, wantedName) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("zip central directory not found");
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;
  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8").replaceAll("\\", "/");
    if (name === wantedName || name.endsWith(`/${wantedName}`)) {
      return readZipLocalEntry(buffer, localHeaderOffset, compressedSize, compressionMethod);
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return null;
}

function readZipLocalEntry(buffer, localHeaderOffset, compressedSize, compressionMethod) {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error("invalid zip local header");
  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const data = buffer.subarray(dataStart, dataStart + compressedSize);
  if (compressionMethod === 0) return data;
  if (compressionMethod === 8) return zlib.inflateRawSync(data);
  throw new Error(`unsupported zip compression method: ${compressionMethod}`);
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8").replace(/^\uFEFF/, ""));
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function suggestNextVersion(packages) {
  const versions = [readPackageVersion(), ...packages.map((item) => item.version)].filter(Boolean);
  const latest = versions.sort(compareVersions).at(-1) || "0.0.0";
  const match = latest.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) return latest;
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}${match[4] || ""}`;
}

function compareVersions(a, b) {
  const left = String(a).match(/^(\d+)\.(\d+)\.(\d+)/);
  const right = String(b).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!left || !right) return String(a).localeCompare(String(b));
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(left[index]) - Number(right[index]);
    if (diff) return diff;
  }
  return String(a).localeCompare(String(b));
}
