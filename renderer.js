// renderer.js — runs in the browser-like renderer process.
// Talks to the Node.js backend (main.js) only through window.api
// (exposed safely via preload.js). No direct Node/file-system access here,
// exactly like a normal web page.

const loginScreen = document.getElementById("login-screen");
const mainScreen = document.getElementById("main-screen");
const usernameInput = document.getElementById("username-input");
const createAccountBtn = document.getElementById("create-account-btn");
const javaStatusEl = document.getElementById("java-status");

const welcomeText = document.getElementById("welcome-text");
const logoutBtn = document.getElementById("logout-btn");
const versionSelect = document.getElementById("version-select");
const snapshotToggle = document.getElementById("snapshot-toggle");
const downloadBtn = document.getElementById("download-btn");
const playBtn = document.getElementById("play-btn");
const progressLabel = document.getElementById("progress-label");
const progressBar = document.getElementById("progress-bar");
const logBox = document.getElementById("log-box");

let username = null;
let allVersions = [];
let config = {};

function appendLog(message, kind = "") {
  const line = document.createElement("div");
  line.className = "line" + (kind ? ` ${kind}` : "");
  line.textContent = message;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

function setProgress(done, total, label) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  progressBar.style.width = pct + "%";
  progressLabel.textContent = `${label}: ${done}/${total} (${pct}%)`;
}

// ---------------- Init ----------------
(async function init() {
  config = (await window.api.loadConfig()) || {};
  if (config.last_username) usernameInput.value = config.last_username;

  const javaStatus = await window.api.getJavaStatus();
  if (javaStatus.found) {
    javaStatusEl.textContent = `Java পাওয়া গেছে: ${javaStatus.path}`;
    javaStatusEl.classList.add("ok");
  } else {
    javaStatusEl.textContent = "⚠ Java পাওয়া যায়নি — PATH-এ Java (JDK 17+) ইন্সটল করো।";
    javaStatusEl.classList.add("error");
  }

  window.api.onInstallLog((msg) => {
    const isError = msg.startsWith("❌") || msg.includes("সমস্যা");
    const isSuccess = msg.startsWith("✅");
    appendLog(msg, isError ? "error" : isSuccess ? "success" : "");
  });

  window.api.onInstallProgress(({ done, total, label }) => setProgress(done, total, label));
})();

// ---------------- Login ----------------
createAccountBtn.addEventListener("click", createAccount);
usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createAccount();
});

async function createAccount() {
  const name = usernameInput.value.trim();
  if (!name || /\s/.test(name) || name.length > 16) {
    alert("একটা valid username দাও (স্পেস ছাড়া, ১৬ অক্ষরের মধ্যে)।");
    return;
  }
  username = name;
  config.last_username = name;
  await window.api.saveConfig(config);

  loginScreen.classList.add("hidden");
  mainScreen.classList.remove("hidden");
  welcomeText.textContent = `স্বাগতম, ${username}!`;

  await loadVersions();
}

logoutBtn.addEventListener("click", () => {
  username = null;
  mainScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  logBox.innerHTML = "";
  playBtn.disabled = true;
});

// ---------------- Version list ----------------
snapshotToggle.addEventListener("change", renderVersionOptions);

async function loadVersions() {
  try {
    allVersions = await window.api.fetchVersions();
    appendLog(`${allVersions.length}টি version পাওয়া গেছে।`);
    renderVersionOptions();
  } catch (e) {
    appendLog(`❌ Version list আনতে সমস্যা হয়েছে: ${e.message}`, "error");
    appendLog("→ ইন্টারনেট সংযোগ বা firewall/network setting চেক করো।");
  }
}

function renderVersionOptions() {
  const allowedTypes = snapshotToggle.checked ? ["release", "snapshot"] : ["release"];
  const filtered = allVersions.filter((v) => allowedTypes.includes(v.type));
  versionSelect.innerHTML = "";
  for (const v of filtered) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.id;
    versionSelect.appendChild(opt);
  }
  if (config.last_version && filtered.some((v) => v.id === config.last_version)) {
    versionSelect.value = config.last_version;
  }
}

// ---------------- Download / Install ----------------
downloadBtn.addEventListener("click", async () => {
  const versionId = versionSelect.value;
  const entry = allVersions.find((v) => v.id === versionId);
  if (!entry) {
    alert("আগে একটা version সিলেক্ট করো।");
    return;
  }
  downloadBtn.disabled = true;
  playBtn.disabled = true;
  setProgress(0, 1, "শুরু");
  config.last_version = versionId;
  await window.api.saveConfig(config);

  try {
    await window.api.installVersion(entry);
    playBtn.disabled = false;
  } catch (e) {
    appendLog(`❌ ডাউনলোডে সমস্যা হয়েছে: ${e.message}`, "error");
  } finally {
    downloadBtn.disabled = false;
  }
});

// ---------------- Play ----------------
playBtn.addEventListener("click", async () => {
  try {
    appendLog("🎮 Minecraft চালু হচ্ছে...");
    await window.api.launchGame(username);
  } catch (e) {
    appendLog(`❌ চালাতে সমস্যা হয়েছে: ${e.message}`, "error");
  }
});
