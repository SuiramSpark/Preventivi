/**
 * electron/preload.js — Bridge sicuro tra Electron e la web app
 * Espone solo le API necessarie tramite contextBridge.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  /** Indica che l'app gira dentro Electron (non browser) */
  isElectron: true,

  /**
   * Salva un file direttamente nella cartella Downloads.
   * @param {string} filename  — nome del file (es. "preventivo-001.pdf")
   * @param {ArrayBuffer} buffer — contenuto del file
   * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
   */
  saveFile: (filename, buffer) =>
    ipcRenderer.invoke("save-file", { filename, buffer }),

  /**
   * Apre una finestra di anteprima di stampa dedicata (solo Electron).
   * @param {string} html — contenuto HTML completo della pagina
   */
  openPrintPreview: (html) =>
    ipcRenderer.invoke("open-print-preview", { html }),

  /**
   * Apre il dialogo "Salva con nome" di Windows.
   * @param {string} defaultName — nome suggerito
   * @param {ArrayBuffer} buffer  — contenuto del file
   * @returns {Promise<{ ok: boolean, path?: string }>}
   */
  saveFileDialog: (defaultName, buffer) =>
    ipcRenderer.invoke("save-file-dialog", { defaultName, buffer }),
});
