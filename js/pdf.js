/**
 * pdf.js — apre nuova finestra con anteprima embedded e chiama window.print()
 * Produce PDF vettoriale, funziona offline.
 * In Electron usa IPC per aprire una finestra dedicata (window.open è bloccato da file://).
 */

export function printPreviewInNewWindow(quote, template, previewMarkup) {
  const accentColor  = template?.accent  ?? "#0b5f56";
  const surfaceColor = template?.surface ?? "#f7fbfa";
  const textColor    = template?.text    ?? "#1f2f2c";
  const fontFamily   = template?.id === "word"
    ? "'Cambria','Palatino Linotype','Book Antiqua',serif"
    : "'Aptos','Segoe UI','Trebuchet MS',sans-serif";

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>${quote.number} – ${quote.title || "Preventivo"}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --template-accent: ${accentColor};
  --template-surface: ${surfaceColor};
  --template-text: ${textColor};
  --muted: #5a6d69;
}
@page { size: A4 portrait; margin: 7mm 5mm; }
body {
  font-family: ${fontFamily};
  font-size: 0.82rem;
  line-height: 1.4;
  color: ${textColor};
  background: white;
}
@media screen {
  body { background: #f0ece5; padding: 20px; }
  .preview-sheet { box-shadow: 0 20px 40px rgba(0,0,0,0.15); border-radius: 10px; margin: 0 auto; }
}
@media print {
  body { background: white; padding: 0; }
  .preview-sheet { box-shadow: none !important; border-radius: 0 !important; }
}

/* ── Sheet ── */
.preview-sheet {
  width: 100%; max-width: 200mm;
  min-height: 283mm;
  background: white;
  padding: 12mm 5mm 10mm;
  display: flex; flex-direction: column;
  page-break-after: always;
}
/* Stili visivi per template */
.preview-sheet.template-word        { border-top: 8px solid var(--template-accent); }
.preview-sheet.template-powerpoint  { border-top: 10px solid var(--template-accent); }
.preview-sheet.template-excel       { border-left: 8px solid var(--template-accent); }
.preview-sheet.template-rosso       { border-top: 6px solid var(--template-accent); border-left: 4px solid var(--template-accent); }

/* ── Header ── */
.pv-header {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
  margin-bottom: 10px; padding-bottom: 8px;
  border-bottom: 1px solid rgba(31,47,44,0.12);
}
.pv-brand { display: flex; align-items: flex-start; gap: 8px; }
.pv-logo { height: 53px; max-width: 166px; object-fit: contain; flex-shrink: 0; }
.pv-brand-info { display: flex; flex-direction: column; gap: 1px; }
.pv-company-name { font-size: 0.95rem; font-weight: 700; display: block; }
.pv-company-contact, .pv-company-detail { font-size: 0.68rem; color: var(--muted); display: block; }
.pv-quote-meta { display: flex; gap: 16px; flex-shrink: 0; text-align: right; }
.pv-meta-item { display: flex; flex-direction: column; gap: 1px; }
.pv-meta-item small { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
.pv-meta-item strong { font-size: 0.88rem; }

/* ── Titolo ── */
.pv-title { margin-bottom: 10px; }
.pv-title h2 { font-size: 1.3rem; color: var(--template-accent); margin-bottom: 2px; }
.pv-intro { font-size: 0.75rem; color: var(--muted); }

/* ── Cliente + sconto ── */
.pv-info-row { display: grid; grid-template-columns: 1.6fr 1fr; gap: 5px; margin-bottom: 5px; }
.pv-client-box, .pv-discount-box {
  padding: 4px 5px; border-radius: 3px;
  background: rgba(11,95,86,0.04); border: 1px solid rgba(11,95,86,0.08);
}
.pv-box-label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 1px; }
.pv-client-name { display: block; font-size: 0.84rem; font-weight: 700; margin-bottom: 1px; }
.pv-client-detail { display: flex; justify-content: space-between; gap: 3px; font-size: 0.70rem; padding: 0; }
.pv-client-detail span:first-child { color: var(--muted); min-width: 26px; }
.pv-discount-row { display: flex; justify-content: space-between; gap: 4px; font-size: 0.76rem; padding: 1px 0; }
.pv-discount-row span { color: var(--muted); }

/* ── Tabella voci ── */
.pv-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 0.68rem; flex-shrink: 0; }
.pv-table thead tr { background: var(--template-accent); color: white; }
.pv-table th { padding: 5px 4px; text-align: right; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; white-space: nowrap; }
.pv-table th.pv-col-desc, .pv-table td.pv-col-desc { text-align: left; }
.pv-table th:first-child { padding-left: 6px; }
.pv-item-row td, .pv-empty-row td {
  padding: 3px 4px; border-bottom: 1px solid rgba(31,47,44,0.06);
  text-align: right; vertical-align: middle;
}
.pv-item-row td.pv-col-desc { text-align: left; padding-left: 6px; }
.pv-empty-row td { color: transparent; }
.pv-discount-amt { font-size: 0.58rem; color: var(--muted); display: block; }

/* ── Totali ── */
.pv-totals {
  display: grid; gap: 3px;
  margin-left: auto; width: 220px; margin-bottom: 12px;
  font-size: 0.78rem;
  break-before: avoid; page-break-before: avoid;
  break-inside: avoid; page-break-inside: avoid;
}
.pv-total-row { display: flex; justify-content: space-between; gap: 10px; padding: 1px 0; }
.pv-total-row span { color: var(--muted); }
.pv-total-grand {
  padding-top: 5px; margin-top: 2px;
  border-top: 2px solid var(--template-accent);
  font-weight: 700; font-size: 0.9rem;
}
.pv-total-grand span, .pv-total-grand strong { color: var(--template-text); }

/* ── Firma ── */
.pv-signature {
  margin-top: auto; padding-top: 16px;
  display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
}
.pv-signature-line {
  width: 180px; border-bottom: 1px solid rgba(31,47,44,0.35);
}
.pv-signature-label {
  font-size: 0.65rem; color: var(--muted); text-align: right;
}

/* ── Footer ── */
.pv-footer {
  padding-top: 10px;
  border-top: 1px solid rgba(31,47,44,0.1);
  display: grid; gap: 4px;
  font-size: 0.72rem; color: var(--muted); line-height: 1.5;
  break-before: avoid; page-break-before: avoid;
}
.pv-payment strong, .pv-notes strong { color: var(--template-text); }
</style>
</head>
<body>${previewMarkup}</body>
</html>`;

  // ── Electron: finestra dedicata via IPC (window.open è bloccato da file://) ──
  if (window.electronAPI?.openPrintPreview) {
    window.electronAPI.openPrintPreview(html).catch(console.error);
    return true;
  }

  // ── Browser (PWA / dev server) ──────────────────────────────────────────────
  const win = window.open("", "_blank");
  if (!win) return false;

  win.document.write(html);
  win.document.close();
  win.focus();
  if (win.document.readyState === "complete") {
    win.print();
  } else {
    win.addEventListener("load", () => win.print(), { once: true });
  }
  return true;
}
