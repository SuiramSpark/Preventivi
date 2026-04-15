/**
 * quote-page.js — pagina dedicata creazione/modifica preventivo
 *
 * Layout: header sticky → tile sommario → toggle → form (collassabile) → preview (full width)
 */

import { calculateQuoteTotals, createLineItem } from "./db.js";
import {
  escapeHtml,
  escapeAttribute,
  formatCurrency,
  renderStatusOptions,
  readNumber,
  emptyState
} from "./utils.js";

// ─────────────────────────────────────────────────────────────
//  ENTRY POINT RENDERING
// ─────────────────────────────────────────────────────────────

export function buildQuoteEditHTML(quote, { templates, settings, companies = [] }) {
  const totals = calculateQuoteTotals(quote);
  const currency = settings.currency || "EUR";
  const tmpl = templates.find(t => t.id === quote.templateId) ?? templates[0];

  return `
    <div class="qe-layout">

      <!-- ① Header fisso -->
      <div class="qe-header panel">
        <button class="ghost qe-back-btn" type="button" data-qe-action="back">← Preventivi</button>
        <div class="qe-header-center">
          <p class="eyebrow">Composizione</p>
          <span class="qe-number">${escapeHtml(quote.number)}</span>
        </div>
        <div class="qe-header-actions">
          <!-- Esporta -->
          <div class="qe-btn-group">
            <button class="qe-btn" type="button" data-qe-action="pdf">PDF</button>
            <button class="qe-btn" type="button" data-qe-action="share">Condividi</button>
          </div>
          <!-- Utility -->
          <div class="qe-btn-group">
            <button class="qe-btn" type="button" data-qe-action="duplicate">Duplica</button>
          </div>
          <!-- Azioni principali: Salva · Elimina -->
          <div class="qe-btn-group">
            <button class="qe-btn qe-btn--save" type="button" data-qe-action="save">Salva</button>
            <button class="qe-btn qe-btn--danger" type="button" data-qe-action="delete">Elimina</button>
          </div>
        </div>
      </div>

      <!-- ② Tile sommario live -->
      <div class="qe-summary" id="qeSummary">
        ${buildSummaryTilesHTML(totals, currency, quote.discount)}
      </div>

      <!-- ③ Toggle form -->
      <button class="qe-toggle-btn" type="button" data-qe-action="toggle-form" id="qeToggleBtn">
        <span class="qe-toggle-arrow">▲</span>
        <span class="qe-toggle-label">Comprimi sezioni</span>
      </button>

      <!-- ④ Form collassabile -->
      <div class="qe-form-area" id="qeFormArea">
        <div class="qe-form-inner">
          <form id="quoteEditForm" novalidate>
            ${buildHeaderPanelHTML(quote, templates, companies)}
            ${buildClientPanelHTML(quote)}
            ${buildLineItemsPanelHTML(quote, currency)}
            ${buildNotesPanelHTML(quote)}
          </form>
        </div>
      </div>

      <!-- ⑤ Preview full-width (sempre visibile) -->
      <div class="panel qe-preview-area">
        <div class="panel-heading">
          <div><p class="eyebrow">Anteprima documento</p><h4>Preview live</h4></div>
          <span id="qeTemplateBadge" class="badge">${escapeHtml(tmpl?.name ?? "Template")}</span>
        </div>
        <div id="qePreview" class="preview-host">
          <p class="preview-note">Il documento si aggiorna in tempo reale.</p>
        </div>
      </div>

    </div>
  `;
}

// ─────────────────────────────────────────────────────────────
//  PANNELLI FORM
// ─────────────────────────────────────────────────────────────

function buildSummaryTilesHTML(totals, currency, discountRate = 0) {
  return `
    <div class="summary-tile"><span>Subtotale</span><strong>${formatCurrency(totals.subtotal, currency)}</strong></div>
    <div class="summary-tile"><span>IVA</span><strong>${formatCurrency(totals.vatAmount, currency)}</strong></div>
    <div class="summary-tile qe-total-tile"><span>Totale</span><strong>${formatCurrency(totals.total, currency)}</strong></div>
    <div class="summary-tile"><span>Sconto</span><strong>${discountRate ?? 0}%</strong></div>
    <div class="summary-tile"><span>Righe</span><strong>${totals.lineCount}</strong></div>
  `;
}

function buildHeaderPanelHTML(quote, templates, companies = []) {
  return `
    <div class="panel">
      <div class="panel-heading"><div><p class="eyebrow">Documento</p><h4>Dati preventivo</h4></div></div>
      <div class="form-grid">
        <label class="field full">
          <span>Titolo</span>
          <input name="title" value="${escapeAttribute(quote.title)}" placeholder="Es. Sito web aziendale" required>
        </label>
        <label class="field">
          <span>Stato</span>
          <select name="status">${renderStatusOptions(quote.status)}</select>
        </label>
        <label class="field">
          <span>Numero preventivo</span>
          <input name="number" value="${escapeAttribute(quote.number)}">
        </label>
        <label class="field">
          <span>Valido fino al</span>
          <input name="validUntil" type="date" value="${escapeAttribute(quote.validUntil)}">
        </label>
        <label class="field">
          <span>Template</span>
          <select name="templateId">
            ${templates.map(t => `<option value="${t.id}" ${t.id === quote.templateId ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Termini di pagamento</span>
          <input name="paymentTerms" value="${escapeAttribute(quote.paymentTerms)}">
        </label>
        <label class="field">
          <span>Sconto %</span>
          <input name="discount" type="number" min="0" max="100" step="0.5" value="${quote.discount}">
        </label>
        <label class="field">
          <span>IVA %</span>
          <input name="vatRate" type="number" min="0" step="0.5" value="${quote.vatRate}">
        </label>
        <label class="field full">
          <span>Testo introduttivo</span>
          <textarea name="intro">${escapeHtml(quote.intro)}</textarea>
        </label>
        <label class="field full">
          <span>Azienda emittente</span>
          ${companies.length > 0
            ? `<select name="issuingCompanyId">
                <option value="">— Usa impostazioni generali —</option>
                ${companies.map(c => `<option value="${c.id}" ${c.id === quote.issuingCompanyId ? "selected" : ""}>${escapeHtml(c.name || "Azienda senza nome")}</option>`).join("")}
               </select>`
            : `<input name="issuingCompanyId" value="" placeholder="Nessuna azienda configurata — vai in Impostazioni" disabled>`
          }
        </label>
      </div>
    </div>
  `;
}

function buildClientPanelHTML(quote) {
  return `
    <div class="panel">
      <div class="panel-heading"><div><p class="eyebrow">Destinatario</p><h4>Dati cliente</h4></div></div>
      <div class="form-grid">
        <label class="field">
          <span>Azienda</span>
          <input name="clientCompany" value="${escapeAttribute(quote.clientCompany)}" placeholder="Rossi Srl">
        </label>
        <label class="field">
          <span>P.IVA / C.F.</span>
          <input name="clientVatId" value="${escapeAttribute(quote.clientVatId ?? "")}" placeholder="IT12345678901">
        </label>
        <label class="field full">
          <span>Indirizzo</span>
          <input name="clientAddress" value="${escapeAttribute(quote.clientAddress ?? "")}" placeholder="Via Roma 1, 20100 Milano">
        </label>
        <label class="field">
          <span>PEC</span>
          <input name="clientPec" value="${escapeAttribute(quote.clientPec ?? "")}" placeholder="azienda@pec.it">
        </label>
        <label class="field">
          <span>Email</span>
          <input name="clientEmail" type="email" value="${escapeAttribute(quote.clientEmail)}" placeholder="mario@azienda.it">
        </label>
        <label class="field">
          <span>Nome referente</span>
          <input name="clientName" value="${escapeAttribute(quote.clientName)}" placeholder="Mario Rossi">
        </label>
        <label class="field">
          <span>Telefono</span>
          <input name="clientPhone" value="${escapeAttribute(quote.clientPhone)}" placeholder="+39 ...">
        </label>
      </div>
    </div>
  `;
}

function buildLineItemsPanelHTML(quote, currency) {
  const defaultVat = Number(quote.vatRate) || 0;
  return `
    <div class="panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Voci</p><h4>Righe preventivo</h4></div>
        <button class="primary" type="button" data-qe-action="add-item">+ Aggiungi riga</button>
      </div>
      <div class="qe-line-items" id="qeLineItems">
        ${(quote.items ?? []).map(item => buildLineItemHTML(item, currency, defaultVat)).join("")}
      </div>
    </div>
  `;
}

export function buildLineItemHTML(item, currency = "EUR", defaultVatRate = 22) {
  const effectiveVat      = item.vatRate        != null ? item.vatRate        : defaultVatRate;
  const effectiveDiscount = item.lineDiscount   != null ? item.lineDiscount   : 0;
  const effectiveType     = item.lineDiscountType === "fixed" ? "fixed" : "percent";

  // Calcolo totale voce live (imponibileNetto + IVA)
  const qty       = readNumber(item.qty, 0);
  const price     = readNumber(item.unitPrice, 0);
  const imponibile = qty * price;
  const scontoAmt  = effectiveType === "fixed"
    ? Math.min(effectiveDiscount, imponibile)
    : imponibile * (effectiveDiscount / 100);
  const totale = (imponibile - scontoAmt) * (1 + effectiveVat / 100);

  return `
    <div class="qe-line-item" data-item-id="${item.id}">
      <label class="field qe-desc-field">
        <span>Descrizione</span>
        <input data-line-field="description" value="${escapeAttribute(item.description)}" placeholder="Servizio o prodotto">
      </label>
      <label class="field">
        <span>Qtà</span>
        <input data-line-field="qty" type="number" min="0" step="0.01" value="${item.qty}">
      </label>
      <label class="field">
        <span>Imponibile</span>
        <input data-line-field="unitPrice" type="number" min="0" step="0.01" value="${item.unitPrice}" placeholder="0.00">
      </label>
      <label class="field">
        <span>IVA %</span>
        <input data-line-field="vatRate" type="number" min="0" max="100" step="0.5" value="${effectiveVat}">
      </label>
      <div class="qe-line-discount">
        <span class="field-label">Sconto</span>
        <div class="qe-discount-input">
          <select data-line-field="lineDiscountType" title="Tipo sconto">
            <option value="percent" ${effectiveType === "percent" ? "selected" : ""}>%</option>
            <option value="fixed"   ${effectiveType === "fixed"   ? "selected" : ""}>€</option>
          </select>
          <input data-line-field="lineDiscount" type="number" min="0" step="0.01" value="${effectiveDiscount}" placeholder="0">
        </div>
      </div>
      <div class="qe-item-total">
        <span>Totale (IVA incl.)</span>
        <strong class="qe-line-total line-total">${formatCurrency(totale, currency)}</strong>
      </div>
      <button class="danger qe-remove-btn" type="button" data-qe-action="remove-item" data-item-id="${item.id}" title="Rimuovi">✕</button>
    </div>
  `;
}

function buildNotesPanelHTML(quote) {
  return `
    <div class="panel">
      <div class="panel-heading"><div><p class="eyebrow">Chiusura</p><h4>Note finali</h4></div></div>
      <div class="form-grid">
        <label class="field full">
          <span>Note</span>
          <textarea name="notes">${escapeHtml(quote.notes)}</textarea>
        </label>
      </div>
      <div class="action-row" style="margin-top:16px">
        <button class="primary"   type="button" data-qe-action="pdf">Genera PDF</button>
        <button class="secondary" type="button" data-qe-action="share">Condividi</button>
        <button class="ghost"     type="button" data-qe-action="save">Salva ora</button>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────
//  EVENTI
// ─────────────────────────────────────────────────────────────

export function bindQuotePageEvents(container, callbacks, getQuote, currency) {
  // Click delegation
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-qe-action]");
    if (!btn) return;
    const action = btn.dataset.qeAction;

    if (action === "back")        { callbacks.onBack?.(); return; }
    if (action === "save") {
      callbacks.onSave?.();
      const origLabel = btn.textContent;
      btn.classList.add("is-saved");
      btn.textContent = "✓ Salvato";
      setTimeout(() => {
        btn.classList.remove("is-saved");
        btn.textContent = origLabel;
      }, 1200);
      return;
    }
    if (action === "pdf")         { callbacks.onPdf?.();  return; }
    if (action === "share")       { callbacks.onShare?.(); return; }
    if (action === "print")       { callbacks.onPrint?.(); return; }
    if (action === "duplicate")   { callbacks.onDuplicate?.(); return; }
    if (action === "delete")      { callbacks.onDelete?.(); return; }
    if (action === "add-item")    { callbacks.onAddItem?.(); return; }
    if (action === "remove-item") { callbacks.onRemoveItem?.(btn.dataset.itemId); return; }

    if (action === "toggle-form") {
      const formArea  = document.querySelector("#qeFormArea");
      const toggleBtn = document.querySelector("#qeToggleBtn");
      if (!formArea || !toggleBtn) return;

      const collapsed = formArea.classList.toggle("is-collapsed");
      const arrow = toggleBtn.querySelector(".qe-toggle-arrow");
      const label = toggleBtn.querySelector(".qe-toggle-label");

      if (collapsed) {
        if (arrow) arrow.textContent = "▼";
        if (label) label.textContent = "Espandi sezioni";
      } else {
        if (arrow) arrow.textContent = "▲";
        if (label) label.textContent = "Comprimi sezioni";
      }
    }
  });

  // Input: aggiorna totale riga immediatamente + propaga cambio stato
  container.addEventListener("input", (e) => {
    if (!e.target.closest("#quoteEditForm")) return;

    // Totale riga live
    const lf = e.target.dataset.lineField;
    if (lf === "qty" || lf === "unitPrice" || lf === "vatRate" || lf === "lineDiscount") {
      const form = e.target.closest("#quoteEditForm");
      const defaultVat = readNumber(form?.querySelector('[name="vatRate"]')?.value, 22);
      updateQELineItemTotal(e.target.closest("[data-item-id]"), currency, defaultVat);
    }

    const quote = readQuoteFromEditForm(getQuote());
    if (quote) callbacks.onChange?.(quote);
  });

  container.addEventListener("change", (e) => {
    if (!e.target.closest("#quoteEditForm")) return;

    // Totale riga live per select sconto
    const lf = e.target.dataset.lineField;
    if (lf === "lineDiscountType") {
      const form = e.target.closest("#quoteEditForm");
      const defaultVat = readNumber(form?.querySelector('[name="vatRate"]')?.value, 22);
      updateQELineItemTotal(e.target.closest("[data-item-id]"), currency, defaultVat);
    }

    const quote = readQuoteFromEditForm(getQuote());
    if (quote) callbacks.onChange?.(quote);
  });
}

// ─────────────────────────────────────────────────────────────
//  LETTORE FORM (con null-safety)
// ─────────────────────────────────────────────────────────────

export function readQuoteFromEditForm(activeQuote) {
  const form = document.querySelector("#quoteEditForm");
  if (!form || !activeQuote) return null;

  const formData = new FormData(form);

  const items = [...form.querySelectorAll("[data-item-id]")].map(row => {
    const vatEl          = row.querySelector('[data-line-field="vatRate"]');
    const discountEl     = row.querySelector('[data-line-field="lineDiscount"]');
    const discountTypeEl = row.querySelector('[data-line-field="lineDiscountType"]');
    return {
      id:               row.dataset.itemId,
      description:      (row.querySelector('[data-line-field="description"]')?.value ?? "").trim(),
      qty:              readNumber(row.querySelector('[data-line-field="qty"]')?.value, 0),
      unitPrice:        readNumber(row.querySelector('[data-line-field="unitPrice"]')?.value, 0),
      vatRate:          vatEl          ? readNumber(vatEl.value, null) : null,
      lineDiscount:     discountEl     ? readNumber(discountEl.value, 0) : 0,
      lineDiscountType: discountTypeEl ? (discountTypeEl.value === "fixed" ? "fixed" : "percent") : "percent",
    };
  }).filter((item, i, arr) =>
    arr.length === 1 || item.description || item.qty || item.unitPrice
  );

  return {
    ...activeQuote,
    title:        `${formData.get("title") ?? ""}`.trim() || "Nuovo preventivo",
    status:       `${formData.get("status") ?? "draft"}`,
    clientName:    `${formData.get("clientName") ?? ""}`.trim(),
    clientCompany: `${formData.get("clientCompany") ?? ""}`.trim(),
    clientVatId:   `${formData.get("clientVatId") ?? ""}`.trim(),
    clientAddress: `${formData.get("clientAddress") ?? ""}`.trim(),
    clientPec:     `${formData.get("clientPec") ?? ""}`.trim(),
    clientEmail:   `${formData.get("clientEmail") ?? ""}`.trim(),
    clientPhone:   `${formData.get("clientPhone") ?? ""}`.trim(),
    number:       (`${formData.get("number") ?? ""}`.trim()) || activeQuote.number,
    validUntil:   `${formData.get("validUntil") ?? activeQuote.validUntil}`.trim(),
    templateId:   `${formData.get("templateId") ?? activeQuote.templateId}`.trim(),
    discount:     readNumber(formData.get("discount"), 0),
    vatRate:      readNumber(formData.get("vatRate"), 22),
    paymentTerms: `${formData.get("paymentTerms") ?? ""}`.trim(),
    intro:        `${formData.get("intro") ?? ""}`.trim(),
    notes:        `${formData.get("notes") ?? ""}`.trim(),
    issuingCompanyId: `${formData.get("issuingCompanyId") ?? ""}`.trim() || null,
    items:        items.length ? items : [createLineItem()],
    updatedAt:    new Date().toISOString()
  };
}

// ─────────────────────────────────────────────────────────────
//  AGGIORNAMENTI LIVE (senza re-render del form)
// ─────────────────────────────────────────────────────────────

export function updateQESummaryTiles(quote, currency = "EUR") {
  const el = document.querySelector("#qeSummary");
  if (!el) return;
  el.innerHTML = buildSummaryTilesHTML(calculateQuoteTotals(quote), currency, quote.discount);
}

export function updateQELineItemTotal(row, currency = "EUR", defaultVatRate = 22) {
  if (!row) return;
  const qty          = readNumber(row.querySelector('[data-line-field="qty"]')?.value, 0);
  const price        = readNumber(row.querySelector('[data-line-field="unitPrice"]')?.value, 0);
  const vatRate      = readNumber(row.querySelector('[data-line-field="vatRate"]')?.value, defaultVatRate);
  const discountVal  = readNumber(row.querySelector('[data-line-field="lineDiscount"]')?.value, 0);
  const discountType = row.querySelector('[data-line-field="lineDiscountType"]')?.value || "percent";

  const imponibile  = qty * price;
  const scontoAmt   = discountType === "fixed"
    ? Math.min(discountVal, imponibile)
    : imponibile * (discountVal / 100);
  const totale = (imponibile - scontoAmt) * (1 + vatRate / 100);

  const el = row.querySelector(".qe-line-total");
  if (el) el.textContent = formatCurrency(totale, currency);
}

export function renderQELineItems(quote, currency = "EUR") {
  const el = document.querySelector("#qeLineItems");
  if (!el) return;
  const defaultVat = Number(quote.vatRate) || 0;
  el.innerHTML = (quote.items ?? []).map(item => buildLineItemHTML(item, currency, defaultVat)).join("");
}
