/**
 * electron/main.js — Processo principale Electron
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs   = require("fs");

const IS_DEV = !app.isPackaged;

// ── Splashscreen ────────────────────────────────────────────────────────────
let splashWindow = null;

function createSplash() {
  splashWindow = new BrowserWindow({
    width:        400,
    height:       500,
    frame:        false,
    transparent:  true,
    resizable:    false,
    movable:      true,
    alwaysOnTop:  true,
    skipTaskbar:  true,
    center:       true,
    show:         true,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  // Percorso assoluto al logo SVG (diverso fra dev e build installata)
  const iconSvg = IS_DEV
    ? path.join(__dirname, "../assets/icon.svg")
    : path.join(process.resourcesPath, "assets/icon.svg");

  const splashFile = path.join(__dirname, "splash.html");
  const query = fs.existsSync(iconSvg)
    ? { icon: "file:///" + iconSvg.replace(/\\/g, "/") }
    : undefined;

  splashWindow.loadFile(splashFile, query ? { query } : undefined).catch(() => {});

  splashWindow.on("closed", () => { splashWindow = null; });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    try { splashWindow.close(); } catch (_) { /* noop */ }
  }
  splashWindow = null;
}

// ── Crea la finestra principale ─────────────────────────────────────────────
function createWindow() {
  const iconPath = IS_DEV
    ? path.join(__dirname, "../assets/icon.png")
    : path.join(process.resourcesPath, "assets/icon.png");

  const win = new BrowserWindow({
    width:     1400,
    height:    860,
    minWidth:  900,
    minHeight: 600,
    title:     "Preventivi",
    icon:      fs.existsSync(iconPath) ? iconPath : undefined,
    show:      false,
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  // Mostra la main window solo quando e' pronta, e chiudi lo splash
  win.once("ready-to-show", () => {
    win.show();
    closeSplash();
  });

  // Timeout di sicurezza: se ready-to-show non arriva entro 8s,
  // forziamo show + chiusura splash per evitare schermate appese.
  const safetyTimer = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      try { win.show(); } catch (_) {}
    }
    closeSplash();
  }, 8000);
  win.once("show", () => clearTimeout(safetyTimer));
  win.on("closed", () => clearTimeout(safetyTimer));

  // Apre i link "target=_blank" nel browser di sistema, non in una nuova finestra Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    // Permetti i popup interni (es. anteprima PDF)
    return { action: "allow" };
  });

  if (IS_DEV) {
    win.loadURL("http://localhost:5173");
    // Apri DevTools solo in sviluppo
    // win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createSplash();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Controlla aggiornamenti solo nell'app installata (non in sviluppo)
  if (!IS_DEV) {
    // Aspetta 3 secondi dopo l'avvio per non rallentare il caricamento iniziale
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 3000);
  }
});

// ── Auto-update ─────────────────────────────────────────────────────────────
autoUpdater.on("update-downloaded", () => {
  const choice = dialog.showMessageBoxSync({
    type:      "info",
    title:     "Aggiornamento disponibile",
    message:   "Una nuova versione è stata scaricata.",
    detail:    "Vuoi riavviare Preventivi per applicare l'aggiornamento?",
    buttons:   ["Riavvia ora", "Più tardi"],
    defaultId: 0,
  });
  if (choice === 0) autoUpdater.quitAndInstall();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── IPC: Salva file sul disco (es. PDF → Downloads) ─────────────────────────
ipcMain.handle("save-file", async (_event, { filename, buffer }) => {
  const downloadsPath = app.getPath("downloads");
  const filePath      = path.join(downloadsPath, filename);

  try {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    // Apre Explorer con il file selezionato
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: Anteprima di stampa in finestra dedicata ───────────────────────────
ipcMain.handle("open-print-preview", async (_event, { html }) => {
  const tmpPath = path.join(app.getPath("temp"), `preventivi-print-${Date.now()}.html`);
  fs.writeFileSync(tmpPath, html, "utf8");

  const printWin = new BrowserWindow({
    width: 900, height: 1100,
    title: "Anteprima di Stampa – Preventivi",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  await printWin.loadFile(tmpPath);

  // Apre il dialog di stampa di Chromium (stesso di window.print() nel browser)
  printWin.webContents.executeJavaScript("window.print()").catch(() => {});

  // Pulisce il file temporaneo alla chiusura
  printWin.on("closed", () => {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  });
});

// ── IPC: Genera PDF da HTML via Chromium printToPDF ─────────────────────────
ipcMain.handle("generate-pdf", async (_event, { html }) => {
  const tmpWin = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });

  try {
    const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
    await tmpWin.loadURL(dataUrl);
    await new Promise((res) => setTimeout(res, 120));
    const pdfBuffer = await tmpWin.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      margins: { top: 0.28, bottom: 0.28, left: 0.2, right: 0.2 },
      preferCSSPageSize: true,
    });
    return pdfBuffer;
  } finally {
    if (!tmpWin.isDestroyed()) tmpWin.destroy();
  }
});

// ── IPC: Apri dialogo "Salva con nome" ──────────────────────────────────────
ipcMain.handle("save-file-dialog", async (_event, { defaultName, buffer }) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath("downloads"), defaultName),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });

  if (canceled || !filePath) return { ok: false };

  try {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
