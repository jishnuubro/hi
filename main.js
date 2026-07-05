// main.js — Electron main process (Node.js side).
// This is what makes REAL downloading + REAL Minecraft launching possible,
// unlike plain browser JS which is sandboxed and cannot spawn processes.

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const { spawn } = require("child_process");
const os = require("os");

// ------------------------------------------------------------------
// Paths
// ------------------------------------------------------------------
const APP_DIR = path.join(os.homedir(), ".pylauncher-electron");
const VERSIONS_DIR = path.join(APP_DIR, "versions");
const LIBRARIES_DIR = path.join(APP_DIR, "libraries");
const ASSETS_DIR = path.join(APP_DIR, "assets");
const NATIVES_ROOT = path.join(APP_DIR, "natives");
const CONFIG_PATH = path.join(APP_DIR, "config.json");

for (const d of [VERSIONS_DIR, LIBRARIES_DIR, ASSETS_DIR, NATIVES_ROOT]) {
  fs.mkdirSync(d, { recursive: true });
}

const VERSION_MANIFEST_URL =
  "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function getOsName() {
  const platform = process.platform;
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "osx";
  return "linux";
}

function offlineUuid(username) {
  const md5 = crypto.createHash("md5").update(`OfflinePlayer:${username}`).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function ruleAllows(rules, osName) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    const action = rule.action === "allow";
    if (rule.os) {
      if (rule.os.name === osName) allowed = action;
    } else {
      allowed = action;
    }
  }
  return allowed;
}

function sha1Of(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function downloadFile(url, destPath, expectedSha1) {
  if (fs.existsSync(destPath) && expectedSha1) {
    const existing = await sha1Of(destPath);
    if (existing === expectedSha1) return;
  }
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for url: ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpPath = destPath + ".part";
  await fsp.writeFile(tmpPath, buffer);
  await fsp.rename(tmpPath, destPath);
}

function findJava() {
  // Very small heuristic: rely on "java" being on PATH.
  // (On Windows we could also probe common install dirs if needed.)
  return "java";
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(data) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

async function extractNative(jarPath, natives_dir) {
  // Minimal ZIP extraction without extra deps, using Node's zlib + manual
  // central-directory parsing would be a lot of code; instead we shell out
  // to the 'jar' tool that ships with every JDK (same JDK as `java`).
  await fsp.mkdir(natives_dir, { recursive: true });
  return new Promise((resolve) => {
    const p = spawn("jar", ["xf", jarPath], { cwd: natives_dir });
    p.on("close", () => resolve());
    p.on("error", () => resolve()); // if 'jar' isn't found, just skip natives extraction
  });
}

// ------------------------------------------------------------------
// Install logic (reports progress back to renderer via webContents.send)
// ------------------------------------------------------------------

async function installVersion(versionEntry, win) {
  const send = (channel, payload) => win.webContents.send(channel, payload);
  const log = (msg) => send("install-log", msg);
  const progress = (done, total, label) => send("install-progress", { done, total, label });

  const osName = getOsName();
  const versionId = versionEntry.id;
  const versionDir = path.join(VERSIONS_DIR, versionId);
  await fsp.mkdir(versionDir, { recursive: true });
  const versionJsonPath = path.join(versionDir, `${versionId}.json`);
  const clientJarPath = path.join(versionDir, `${versionId}.jar`);
  const nativesDir = path.join(NATIVES_ROOT, versionId);
  await fsp.mkdir(nativesDir, { recursive: true });

  log(`[1/4] Version metadata নামানো হচ্ছে (${versionId})...`);
  const versionRes = await fetch(versionEntry.url);
  if (!versionRes.ok) throw new Error(`${versionRes.status} ${versionRes.statusText} for url: ${versionEntry.url}`);
  const versionData = await versionRes.json();
  await fsp.writeFile(versionJsonPath, JSON.stringify(versionData));

  log("[2/4] Client jar ডাউনলোড হচ্ছে...");
  const client = versionData.downloads.client;
  await downloadFile(client.url, clientJarPath, client.sha1);

  log("[3/4] Libraries ও natives ডাউনলোড হচ্ছে...");
  const classpath = [clientJarPath];
  const libs = (versionData.libraries || []).filter((l) => ruleAllows(l.rules, osName));
  for (let i = 0; i < libs.length; i++) {
    const lib = libs[i];
    const downloads = lib.downloads || {};
    if (downloads.artifact) {
      const libPath = path.join(LIBRARIES_DIR, downloads.artifact.path);
      await downloadFile(downloads.artifact.url, libPath, downloads.artifact.sha1);
      classpath.push(libPath);
    }
    if (lib.natives) {
      const classifierKey = lib.natives[osName];
      if (classifierKey && downloads.classifiers && downloads.classifiers[classifierKey]) {
        const nativeInfo = downloads.classifiers[classifierKey];
        const nativePath = path.join(LIBRARIES_DIR, nativeInfo.path);
        await downloadFile(nativeInfo.url, nativePath, nativeInfo.sha1);
        await extractNative(nativePath, nativesDir);
      }
    }
    progress(i + 1, libs.length, "Libraries");
  }

  log("[4/4] Assets (sound/texture) ডাউনলোড হচ্ছে...");
  const assetIndex = versionData.assetIndex;
  const indexPath = path.join(ASSETS_DIR, "indexes", `${assetIndex.id}.json`);
  await downloadFile(assetIndex.url, indexPath, assetIndex.sha1);
  const indexData = JSON.parse(await fsp.readFile(indexPath, "utf-8"));
  const objects = Object.entries(indexData.objects || {});
  for (let i = 0; i < objects.length; i++) {
    const [, obj] = objects[i];
    const hash = obj.hash;
    const sub = hash.slice(0, 2);
    const objPath = path.join(ASSETS_DIR, "objects", sub, hash);
    if (!(fs.existsSync(objPath) && (await sha1Of(objPath)) === hash)) {
      const url = `https://resources.download.minecraft.net/${sub}/${hash}`;
      await downloadFile(url, objPath, hash);
    }
    if (i % 25 === 0 || i === objects.length - 1) {
      progress(i + 1, objects.length, "Assets");
    }
  }

  log("✅ Install সম্পূর্ণ হয়েছে! এখন Play চাপতে পারো।");
  return { versionData, classpath, assetsIndexId: assetIndex.id };
}

function buildLaunchCommand(versionData, classpath, assetsIndexId, username, javaPath) {
  const osName = getOsName();
  const versionId = versionData.id;
  const playerUuid = offlineUuid(username);
  const nativesDir = path.join(NATIVES_ROOT, versionId);
  const mainClass = versionData.mainClass || "net.minecraft.client.main.Main";
  const sep = osName === "windows" ? ";" : ":";
  const classpathStr = classpath.join(sep);

  const placeholders = {
    auth_player_name: username,
    version_name: versionId,
    game_directory: APP_DIR,
    assets_root: ASSETS_DIR,
    assets_index_name: assetsIndexId,
    auth_uuid: playerUuid,
    auth_access_token: "0",
    user_type: "legacy",
    version_type: versionData.type || "release",
    clientid: "0",
    auth_xuid: "0",
    user_properties: "{}",
    natives_directory: nativesDir,
    launcher_name: "pylauncher-electron",
    launcher_version: "1.0",
    classpath: classpathStr,
  };

  const fill = (tpl) =>
    Object.entries(placeholders).reduce(
      (acc, [k, v]) => acc.split(`\${${k}}`).join(String(v)),
      tpl
    );

  const cmd = [];
  const jvmSpec = versionData.arguments && versionData.arguments.jvm;
  if (jvmSpec) {
    for (const entry of jvmSpec) {
      if (typeof entry === "string") {
        cmd.push(fill(entry));
      } else if (ruleAllows(entry.rules, osName)) {
        const value = entry.value;
        if (Array.isArray(value)) value.forEach((v) => cmd.push(fill(v)));
        else cmd.push(fill(value));
      }
    }
  } else {
    cmd.push(`-Djava.library.path=${nativesDir}`);
    cmd.push("-cp");
    cmd.push(classpathStr);
  }

  cmd.push(mainClass);

  const gameSpec = versionData.arguments && versionData.arguments.game;
  if (gameSpec) {
    for (const entry of gameSpec) {
      if (typeof entry === "string") {
        cmd.push(fill(entry));
      } else if (ruleAllows(entry.rules, osName)) {
        const value = entry.value;
        if (Array.isArray(value)) value.forEach((v) => cmd.push(fill(v)));
        else cmd.push(fill(value));
      }
    }
  } else if (versionData.minecraftArguments) {
    versionData.minecraftArguments.split(" ").forEach((tok) => cmd.push(fill(tok)));
  }

  return { javaPath, args: cmd };
}

// ------------------------------------------------------------------
// IPC handlers exposed to the renderer (via preload.js)
// ------------------------------------------------------------------

ipcMain.handle("get-java-status", async () => {
  return new Promise((resolve) => {
    const p = spawn(findJava(), ["-version"]);
    let found = false;
    p.on("error", () => resolve({ found: false, path: null }));
    p.on("spawn", () => {
      found = true;
    });
    p.on("close", () => resolve({ found, path: found ? findJava() : null }));
  });
});

ipcMain.handle("load-config", async () => loadConfig());

ipcMain.handle("save-config", async (_evt, data) => {
  saveConfig(data);
  return true;
});

ipcMain.handle("fetch-versions", async () => {
  const res = await fetch(VERSION_MANIFEST_URL);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for url: ${VERSION_MANIFEST_URL}`);
  const data = await res.json();
  return data.versions; // [{id, type, url, ...}, ...]
});

let lastInstall = null; // cache of {versionData, classpath, assetsIndexId} for Play

ipcMain.handle("install-version", async (evt, versionEntry) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const result = await installVersion(versionEntry, win);
  lastInstall = result;
  return true;
});

ipcMain.handle("launch-game", async (_evt, username) => {
  if (!lastInstall) throw new Error("আগে একটা version install করো।");
  const { versionData, classpath, assetsIndexId } = lastInstall;
  const { javaPath, args } = buildLaunchCommand(
    versionData,
    classpath,
    assetsIndexId,
    username,
    findJava()
  );
  const child = spawn(javaPath, args, { cwd: APP_DIR, detached: true, stdio: "ignore" });
  child.unref();
  return true;
});

// ------------------------------------------------------------------
// Window bootstrap
// ------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 600,
    height: 640,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile("index.html");
  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
