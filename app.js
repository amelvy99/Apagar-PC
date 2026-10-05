const config = window.APAGAR_PC_CONFIG || {};
const hasConfig =
  config.SUPABASE_URL &&
  config.SUPABASE_ANON_KEY &&
  !config.SUPABASE_URL.includes("TU-PROYECTO") &&
  !config.SUPABASE_ANON_KEY.includes("TU_ANON");

const client = hasConfig
  ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
  : null;

const els = {
  configWarning: document.querySelector("#configWarning"),
  authView: document.querySelector("#authView"),
  mainView: document.querySelector("#mainView"),
  authForm: document.querySelector("#authForm"),
  signUpBtn: document.querySelector("#signUpBtn"),
  signOutBtn: document.querySelector("#signOutBtn"),
  email: document.querySelector("#email"),
  password: document.querySelector("#password"),
  deviceSelect: document.querySelector("#deviceSelect"),
  deviceName: document.querySelector("#deviceName"),
  deviceForm: document.querySelector("#deviceForm"),
  deviceIdBox: document.querySelector("#deviceIdBox"),
  refreshBtn: document.querySelector("#refreshBtn"),
  statusDot: document.querySelector("#statusDot"),
  deviceStatus: document.querySelector("#deviceStatus"),
  lastSeen: document.querySelector("#lastSeen"),
  commandsList: document.querySelector("#commandsList"),
  scheduleForm: document.querySelector("#scheduleForm"),
  scheduleMinutes: document.querySelector("#scheduleMinutes"),
  toast: document.querySelector("#toast")
};

let session = null;
let devices = [];
let refreshTimer = null;

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  setTimeout(() => els.toast.classList.add("hidden"), 3200);
}

function setSignedIn(isSignedIn) {
  els.authView.classList.toggle("hidden", isSignedIn);
  els.mainView.classList.toggle("hidden", !isSignedIn);
  els.signOutBtn.classList.toggle("hidden", !isSignedIn);
}

function selectedDevice() {
  return devices.find((device) => device.id === els.deviceSelect.value) || null;
}

function renderDeviceStatus() {
  const device = selectedDevice();
  els.statusDot.className = "status-dot";
  if (!device) {
    els.deviceStatus.textContent = "Sin dispositivo";
    els.lastSeen.textContent = "--";
    return;
  }

  const lastSeen = device.last_seen_at ? new Date(device.last_seen_at) : null;
  const isOnline = lastSeen && Date.now() - lastSeen.getTime() < 90_000;
  els.statusDot.classList.add(isOnline ? "online" : "offline");
  els.deviceStatus.textContent = isOnline ? "Online" : "Offline";
  els.lastSeen.textContent = lastSeen ? `Visto ${lastSeen.toLocaleString()}` : "Sin heartbeat";
}

function renderDevices() {
  els.deviceSelect.innerHTML = "";
  for (const device of devices) {
    const option = document.createElement("option");
    option.value = device.id;
    option.textContent = device.name;
    els.deviceSelect.append(option);
  }
  renderDeviceStatus();
}

function renderCommands(commands) {
  els.commandsList.innerHTML = "";
  if (!commands.length) {
    els.commandsList.textContent = "Sin comandos todavía.";
    return;
  }
  for (const command of commands) {
    const item = document.createElement("div");
    item.className = "list-item";
    const left = document.createElement("div");
    left.innerHTML = `<strong>${command.action}</strong><br><small>${new Date(command.requested_at).toLocaleString()}</small>`;
    const right = document.createElement("strong");
    right.textContent = command.status;
    item.append(left, right);
    els.commandsList.append(item);
  }
}

async function loadDevices() {
  const { data, error } = await client
    .from("devices")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  devices = data || [];
  renderDevices();
}

async function loadCommands() {
  const device = selectedDevice();
  if (!device) {
    renderCommands([]);
    return;
  }
  const { data, error } = await client
    .from("commands")
    .select("id, action, status, requested_at, error_message")
    .eq("device_id", device.id)
    .order("requested_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  renderCommands(data || []);
}

async function refreshAll() {
  await loadDevices();
  await loadCommands();
}

async function sendCommand(action, payload = {}) {
  const device = selectedDevice();
  if (!device) {
    toast("Registra o selecciona una PC primero.");
    return;
  }
  const command = {
    device_id: device.id,
    action,
    payload,
    idempotency_key: `${device.id}:${action}:${Date.now()}`
  };
  const { error } = await client.from("commands").insert(command);
  if (error) throw error;
  toast("Comando enviado.");
  await loadCommands();
}

async function init() {
  if (!hasConfig) {
    els.configWarning.classList.remove("hidden");
    setSignedIn(false);
    return;
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  const { data } = await client.auth.getSession();
  session = data.session;
  setSignedIn(Boolean(session));
  if (session) await refreshAll();

  client.auth.onAuthStateChange(async (_event, newSession) => {
    session = newSession;
    setSignedIn(Boolean(session));
    if (session) await refreshAll();
  });

  refreshTimer = setInterval(async () => {
    if (!session) return;
    try {
      await refreshAll();
    } catch (error) {
      console.warn(error);
    }
  }, 15000);
}

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { error } = await client.auth.signInWithPassword({
    email: els.email.value.trim(),
    password: els.password.value
  });
  if (error) return toast(error.message);
  toast("Sesión iniciada.");
});

els.signUpBtn.addEventListener("click", async () => {
  const { error } = await client.auth.signUp({
    email: els.email.value.trim(),
    password: els.password.value
  });
  if (error) return toast(error.message);
  toast("Cuenta creada. Si Supabase pide confirmación, revisa tu email.");
});

els.signOutBtn.addEventListener("click", async () => {
  await client.auth.signOut();
  devices = [];
  renderDevices();
});

els.deviceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = els.deviceName.value.trim() || "PC Windows";
  const { data, error } = await client
    .from("devices")
    .insert({ name, platform: "windows" })
    .select("*")
    .single();
  if (error) return toast(error.message);
  els.deviceIdBox.textContent = `DEVICE_ID=${data.id}`;
  els.deviceIdBox.classList.remove("hidden");
  toast("PC registrada. Copia ese DEVICE_ID al agente.");
  await loadDevices();
  els.deviceSelect.value = data.id;
  await loadCommands();
});

els.deviceSelect.addEventListener("change", loadCommands);
els.refreshBtn.addEventListener("click", () => refreshAll().catch((error) => toast(error.message)));

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    const ok = action === "shutdown"
      ? confirm("¿Apagar la PC ahora?")
      : true;
    if (!ok) return;
    sendCommand(action).catch((error) => toast(error.message));
  });
});

els.scheduleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const minutes = Math.max(0, Math.min(1440, Number(els.scheduleMinutes.value || 0)));
  sendCommand("scheduled_shutdown", { delay_seconds: Math.round(minutes * 60) })
    .catch((error) => toast(error.message));
});

window.addEventListener("beforeunload", () => {
  if (refreshTimer) clearInterval(refreshTimer);
});

init().catch((error) => toast(error.message));

