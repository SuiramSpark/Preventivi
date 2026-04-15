/**
 * utils.js — funzioni di utilità pure (no stato, no DOM)
 */

export const statusLabels = {
  draft:     "Bozza",
  sent:      "Inviato",
  approved:  "Approvato",
  confirmed: "Confermato",
  paid:      "Pagato"
};

export const STATUS_ORDER = ["draft", "sent", "approved", "confirmed", "paid"];

export function readNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttribute(value) {
  return escapeHtml(value);
}

export function safeFileName(value) {
  return `${value || "preventivo"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/(^-|-$)/g, "");
}

export function emptyState(title, description) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p class="muted">${escapeHtml(description)}</p>
    </div>
  `;
}

/** Formatta valuta — passa sempre la currency dello stato */
export function formatCurrency(value, currency = "EUR") {
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(value || 0);
  } catch {
    return `${currency} ${Number(value || 0).toFixed(2)}`;
  }
}

export function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function renderStatusOptions(selectedStatus) {
  return Object.entries(statusLabels)
    .map(([value, label]) =>
      `<option value="${value}" ${value === selectedStatus ? "selected" : ""}>${label}</option>`
    )
    .join("");
}
