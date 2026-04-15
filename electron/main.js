/**
 * electron/main.js — Processo principale Electron
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs   = require("fs");

const IS_DEV = !app.isPackaged;

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
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

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
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
