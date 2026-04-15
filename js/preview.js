/**
 * preview.js — genera il markup HTML dell'anteprima documento
 *
 * Struttura A4: header | titolo | cliente+sconto | 12 righe fisse | totali | footer
 */

import { calculateQuoteTotals, calculateLineItem } from "./db.js";
import { escapeHtml, formatCurrency, statusLabels } from "./utils.js";

const MAX_ROWS = 20;

/**
 * @param {object} quote
 * @param {object} template
 * @param {object} settings
 * @param {object|null} company  - company object, oppure null per usare settings
 */
export function buildPreviewMarkup(quote, template, settings, company = null) {
  const totals     = calculateQuoteTotals(quote);
  const currency   = settings.currency || "EUR";
  const defaultVat = Number(quote.vatRate) || 0;

  // Dati azienda
  const co = company ?? {
    name: settings.companyName,
    vatId: settings.companyVatId,
    pec: settings.companyPec || "",
    address: settings.address,
    email: settings.email,
    phone: settings.phone,
    website: settings.website,
    logo: null,
  };

  const companyName  = co.name || "La tua azienda";
  const clientLabel  = quote.clientCompany || quote.clientName || "Cliente non specificato";
  const contactLine  = [co.email, co.phone, co.website].filter(Boolean).join("  ·  ");

  const logoHtml = co.logo
    ? `<img src="${co.logo}" alt="${escapeHtml(companyName)}" class="pv-logo">`
    : "";

  // ── Righe tabella voci ──────────────────────────────────────────────────────
  const activeItems = (quote.items ?? []).filter(
    item => item.description || item.qty || item.unitPrice
  );

  const itemRows = activeItems.map(item => {
    const c = calculateLineItem(item, defaultVat);
    let discountCell = "—";
    if (c.lineDiscountAmount > 0) {
      const label = c.discountType === "fixed"
        ? `${formatCurrency(c.discountVal, currency)}`
        : `${c.discountVal}%`;
      discountCell = `${label} <span class="pv-discount-amt">(-${formatCurrency(c.lineDiscountAmount, currency)})</span>`;
    }
    return `
      <tr class="pv-item-row">
        <td class="pv-col-desc">${escapeHtml(item.description || "—")}</td>
        <td>${item.qty}</td>
        <td>${formatCurrency(c.imponibile, currency)}</td>
        <td>${c.vatRate}%</td>
        <td>${discountCell}</td>
        <td>${formatCurrency(c.totaleVoce, currency)}</td>
      </tr>`;
  }).join("");

  const emptyCount = Math.max(0, MAX_ROWS - activeItems.length);
  const emptyRows  = Array(emptyCount)
    .fill(`<tr class="pv-empty-row"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>`)
    .join("");

  // ── Righe IVA nei totali ────────────────────────────────────────────────────
  const vatRows = totals.vatGroups.map(g =>
    `<div class="pv-total-row"><span>IVA ${g.rate}%</span><strong>${formatCurrency(g.amount, currency)}</strong></div>`
  ).join("");

  return `
    <article class="preview-sheet template-${template.id}"
      style="--template-accent:${template.accent}; --template-surface:${template.surface}; --template-text:${template.text};">

      <!-- ① HEADER: azienda | numero/validità -->
      <div class="pv-header">
        <div class="pv-brand">
          ${logoHtml}
          <div class="pv-brand-info">
            <strong class="pv-company-name">${escapeHtml(companyName)}</strong>
            ${contactLine ? `<span class="pv-company-contact">${escapeHtml(contactLine)}</span>` : ""}
            ${co.vatId   ? `<span class="pv-company-detail">P.IVA ${escapeHtml(co.vatId)}</span>` : ""}
            ${co.pec     ? `<span class="pv-company-detail">PEC ${escapeHtml(co.pec)}</span>` : ""}
            ${co.address ? `<span class="pv-company-detail">${escapeHtml(co.address)}</span>` : ""}
          </div>
        </div>
        <div class="pv-quote-meta">
          <div class="pv-meta-item"><small>Numero</small><strong>${escapeHtml(quote.number)}</strong></div>
          <div class="pv-meta-item"><small>Validità</small><strong>${escapeHtml(quote.validUntil)}</strong></div>
        </div>
      </div>

      <!-- ② TITOLO PREVENTIVO -->
      <div class="pv-title">
        <h2>${escapeHtml(quote.title || "Preventivo")}</h2>
        ${quote.intro ? `<p class="pv-intro">${escapeHtml(quote.intro)}</p>` : ""}
      </div>

      <!-- ③ CLIENTE + BOX SCONTO -->
      <div class="pv-info-row">
        <div class="pv-client-box">
          <div class="pv-box-label">Cliente</div>
          <strong class="pv-client-name">${escapeHtml(clientLabel)}</strong>
          ${quote.clientVatId   ? `<div class="pv-client-detail"><span>P.IVA / C.F.</span><span>${escapeHtml(quote.clientVatId)}</span></div>` : ""}
          ${quote.clientAddress ? `<div class="pv-client-detail"><span>Indirizzo</span><span>${escapeHtml(quote.clientAddress)}</span></div>` : ""}
          ${quote.clientPec     ? `<div class="pv-client-detail"><span>PEC</span><span>${escapeHtml(quote.clientPec)}</span></div>` : ""}
          ${quote.clientName    ? `<div class="pv-client-detail"><span>Referente</span><span>${escapeHtml(quote.clientName)}</span></div>` : ""}
          ${quote.clientEmail   ? `<div class="pv-client-detail"><span>Email</span><span>${escapeHtml(quote.clientEmail)}</span></div>` : ""}
          ${quote.clientPhone   ? `<div class="pv-client-detail"><span>Tel.</span><span>${escapeHtml(quote.clientPhone)}</span></div>` : ""}
          <div class="pv-client-detail"><span>Stato</span><span>${statusLabels[quote.status] || quote.status}</span></div>
        </div>
        <div class="pv-discount-box">
          <div class="pv-box-label">Sconto applicato</div>
          <div class="pv-discount-row">
            <span>Percentuale</span>
            <strong>${totals.discountPercent > 0 ? totals.discountPercent.toFixed(1) + "%" : "—"}</strong>
          </div>
          <div class="pv-discount-row">
            <span>Importo</span>
            <strong>${totals.totalDiscount > 0 ? "-" + formatCurrency(totals.totalDiscount, currency) : "—"}</strong>
          </div>
        </div>
      </div>

      <!-- ④ TABELLA VOCI (12 righe fisse) -->
      <table class="pv-table">
        <thead>
          <tr>
            <th class="pv-col-desc">Voce</th>
            <th>Qtà</th>
            <th>Imponibile</th>
            <th>IVA</th>
            <th>Sconto</th>
            <th>Totale</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          ${emptyRows}
        </tbody>
      </table>

      <!-- ⑤ TOTALI -->
      <div class="pv-totals">
        <div class="pv-total-row"><span>Totale imponibile</span><strong>${formatCurrency(totals.subtotal, currency)}</strong></div>
        ${totals.totalDiscount > 0 ? `<div class="pv-total-row"><span>Totale sconto</span><strong>-${formatCurrency(totals.totalDiscount, currency)}</strong></div>` : ""}
        ${vatRows}
        <div class="pv-total-row pv-total-grand"><span>Totale</span><strong>${formatCurrency(totals.total, currency)}</strong></div>
      </div>

      <!-- ⑥ FOOTER: pagamento + note -->
      <div class="pv-footer">
        ${(quote.paymentTerms || settings.paymentTerms) ? `<div class="pv-payment"><strong>Pagamento:</strong> ${escapeHtml(quote.paymentTerms || settings.paymentTerms)}</div>` : ""}
        ${(quote.notes || settings.defaultNotes) ? `<div class="pv-notes"><strong>Note:</strong> ${escapeHtml(quote.notes || settings.defaultNotes)}</div>` : ""}
      </div>

    </article>
  `;
}
