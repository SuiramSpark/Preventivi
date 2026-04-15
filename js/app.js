import {
  DEFAULT_SETTINGS,
  DEFAULT_TEMPLATES,
  STORES,
  calculateQuoteTotals,
  createEmptyCompany,
  createEmptyQuote,
  createLineItem,
  deleteRecord,
  duplicateQuote,
  getAllRecords,
  getRecord,
  putRecord,
  seedDatabase
} from "./db.js";
import { buildFirebaseSnippet, buildFirebaseStatusText, getFirebaseStatus } from "./firebase.js";
import { printPreviewInNewWindow } from "./pdf.js";
import { initSidebar } from "./sidebar.js";
import { buildPreviewMarkup } from "./preview.js";
import {
  buildQuoteEditHTML,
  bindQuotePageEvents,
  readQuoteFromEditForm,
  updateQESummaryTiles,
  updateQELineItemTotal,
  renderQELineItems,
  buildLineItemHTML
} from "./quote-page.js";
import {
  statusLabels,
  STATUS_ORDER,
  readNumber as _readNumber,
  escapeHtml as _escapeHtml,
  escapeAttribute as _escapeAttribute,
  safeFileName as _safeFileName,
  emptyState as _emptyState,
  formatCurrency as _formatCurrency,
  formatDate as _formatDate,
  renderStatusOptions as _renderStatusOptions
} from "./utils.js";

// Wrappers che iniettano lo stato locale dove necessario
function formatCurrency(value) { return _formatCurrency(value, state.settings.currency || "EUR"); }
function formatDate(value)     { return _formatDate(value); }
function renderStatusOptions(s){ return _renderStatusOptions(s); }
function readNumber(v, f)      { return _readNumber(v, f); }
function escapeHtml(v)         { return _escapeHtml(v); }
function escapeAttribute(v)    { return _escapeAttribute(v); }
function safeFileName(v)       { return _safeFileName(v); }
function emptyState(t, d)      { return _emptyState(t, d); }

const state = {
  quotes: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  templates: structuredClone(DEFAULT_TEMPLATES),
  activeSection: "dashboard",
  activeQuoteId: null,
  activeTemplateId: "word",
  companies: [],
  activeCompanyId: null,
  filters: {
    search: "",
    status: "all",
    sort: "updated-desc",
    dateFrom: "",
    dateTo: ""
  },
  installPromptEvent: null,
  lastSharedPdf: null
};

const timers = {
  quote: null,
  template: null,
  settings: null,
  toast: null
};

const refs = {
  navButtons: [...document.querySelectorAll("[data-section]")],
  sectionPanels: [...document.querySelectorAll("[data-section-panel]")],
  installButton: document.querySelector("#installButton"),
  newQuoteButton: document.querySelector("#newQuoteButton"),
  searchQuotes: document.querySelector("#searchQuotes"),
  statusFilter: document.querySelector("#statusFilter"),
  sortQuotes: document.querySelector("#sortQuotes"),
  quoteCounter: document.querySelector("#quoteCounter"),
  quoteList: document.querySelector("#quoteList"),
  filterDateFrom: document.querySelector("#filterDateFrom"),
  filterDateTo: document.querySelector("#filterDateTo"),
  clearFilters: document.querySelector("#clearFilters"),
  quoteEditor: document.querySelector("#quoteEditor"),
  quotePreview: document.querySelector("#quotePreview"),
  previewTemplateBadge: document.querySelector("#previewTemplateBadge"),
  dashboardMetrics: document.querySelector("#dashboardMetrics"),
  dashboardPipeline: document.querySelector("#dashboardPipeline"),
  dashboardRecent: document.querySelector("#dashboardRecent"),
  templateCards: document.querySelector("#templateCards"),
  templateEditor: document.querySelector("#templateEditor"),
  settingsEditor: document.querySelector("#settingsEditor"),
  settingsSummary: document.querySelector("#settingsSummary"),
  companiesEditor: document.querySelector("#companiesEditor"),
  toast: document.querySelector("#statusToast")
};

document.addEventListener("DOMContentLoaded", () => {
  void init();
});

async function init() {
  bindGlobalEvents();
  initSidebar();
  registerInstallPrompt();
  registerServiceWorker();
  await seedDatabase();
  await hydrateState();
  renderApp();
}

function bindGlobalEvents() {
  refs.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSection = button.dataset.section;
      renderSectionVisibility();
    });
  });

  // Dashboard: "Vedi tutti" button + click on recent rows
  document.querySelector("#dashboardSection")?.addEventListener("click", (e) => {
    const navBtn    = e.target.closest("[data-nav-section]");
    const recentRow = e.target.closest(".db-recent-row[data-quote-id]");

    if (navBtn) {
      state.activeSection = navBtn.dataset.navSection;
      renderSectionVisibility();
      return;
    }
    if (recentRow) {
      void selectQuote(recentRow.dataset.quoteId);
    }
  });

  refs.installButton.addEventListener("click", async () => {
    if (!state.installPromptEvent) {
      return;
    }

    state.installPromptEvent.prompt();
    const outcome = await state.installPromptEvent.userChoice;
    if (outcome.outcome === "accepted") {
      refs.installButton.hidden = true;
      showStatus("Installazione PWA avviata.");
    }
  });

  refs.newQuoteButton.addEventListener("click", () => {
    void createQuoteAndOpen();
  });

  refs.searchQuotes.addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim();
    renderQuoteList();
  });

  refs.statusFilter.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    renderQuoteList();
  });

  refs.sortQuotes.addEventListener("change", (event) => {
    state.filters.sort = event.target.value;
    renderQuoteList();
  });

  refs.filterDateFrom?.addEventListener("change", (event) => {
    state.filters.dateFrom = event.target.value;
    renderQuoteList();
  });

  refs.filterDateTo?.addEventListener("change", (event) => {
    state.filters.dateTo = event.target.value;
    renderQuoteList();
  });

  refs.clearFilters?.addEventListener("click", () => {
    state.filters = { search: "", status: "all", sort: "updated-desc", dateFrom: "", dateTo: "" };
    refs.searchQuotes.value = "";
    refs.statusFilter.value = "all";
    refs.sortQuotes.value = "updated-desc";
    if (refs.filterDateFrom) refs.filterDateFrom.value = "";
    if (refs.filterDateTo)   refs.filterDateTo.value   = "";
    renderQuoteList();
  });

  refs.quoteList.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-quote-action]");
    const card = event.target.closest("[data-quote-id]");
    if (!card) {
      return;
    }

    const quoteId = card.dataset.quoteId;
    if (!quoteId) {
      return;
    }

    if (!actionButton) {
      void selectQuote(quoteId);
      return;
    }

    const action = actionButton.dataset.quoteAction;
    if (action === "cycle-status") {
      void cycleQuoteStatus(quoteId);
      return;
    }

    if (action === "open") {
      void selectQuote(quoteId);
    }

    if (action === "duplicate") {
      void duplicateQuoteById(quoteId);
    }

    if (action === "delete") {
      void deleteQuoteById(quoteId);
    }
  });

  if (refs.quoteEditor) {
    refs.quoteEditor.addEventListener("input", (event) => {
      if (!event.target.closest("form")) return;

      // Aggiorna il totale della singola riga immediatamente
      const lineField = event.target.dataset.lineField;
      if (lineField === "qty" || lineField === "unitPrice" || lineField === "vatRate" || lineField === "lineDiscount") {
        const row = event.target.closest("[data-item-id]");
        if (row) {
          const form       = event.target.closest("form");
          const defaultVat = readNumber(form?.querySelector('[name="vatRate"]')?.value, 22);
          const qty        = readNumber(row.querySelector('[data-line-field="qty"]')?.value, 0);
          const price      = readNumber(row.querySelector('[data-line-field="unitPrice"]')?.value, 0);
          const vatRate    = readNumber(row.querySelector('[data-line-field="vatRate"]')?.value, defaultVat);
          const discVal    = readNumber(row.querySelector('[data-line-field="lineDiscount"]')?.value, 0);
          const discType   = row.querySelector('[data-line-field="lineDiscountType"]')?.value || "percent";
          const imponibile = qty * price;
          const scontoAmt  = discType === "fixed" ? Math.min(discVal, imponibile) : imponibile * (discVal / 100);
          const totale     = (imponibile - scontoAmt) * (1 + vatRate / 100);
          const el         = row.querySelector(".line-total");
          if (el) el.textContent = formatCurrency(totale);
        }
      }

      const quote = readQuoteFromForm();
      if (!quote) return;

      upsertQuoteInState(quote);
      renderQuotePreview();
      renderQuoteSummaryTiles(quote);
      scheduleQuoteSave();
    });

    refs.quoteEditor.addEventListener("change", (event) => {
      if (!event.target.closest("form")) {
        return;
      }

      // Ricalcola totale riga quando cambia il tipo di sconto (select)
      const lineField = event.target.dataset.lineField;
      if (lineField === "lineDiscountType") {
        const row = event.target.closest("[data-item-id]");
        if (row) {
          const form       = event.target.closest("form");
          const defaultVat = readNumber(form?.querySelector('[name="vatRate"]')?.value, 22);
          const qty        = readNumber(row.querySelector('[data-line-field="qty"]')?.value, 0);
          const price      = readNumber(row.querySelector('[data-line-field="unitPrice"]')?.value, 0);
          const vatRate    = readNumber(row.querySelector('[data-line-field="vatRate"]')?.value, defaultVat);
          const discVal    = readNumber(row.querySelector('[data-line-field="lineDiscount"]')?.value, 0);
          const discType   = event.target.value || "percent";
          const imponibile = qty * price;
          const scontoAmt  = discType === "fixed" ? Math.min(discVal, imponibile) : imponibile * (discVal / 100);
          const totale     = (imponibile - scontoAmt) * (1 + vatRate / 100);
          const el         = row.querySelector(".line-total");
          if (el) el.textContent = formatCurrency(totale);
        }
      }

      const quote = readQuoteFromForm();
      if (!quote) {
        return;
      }

      upsertQuoteInState(quote);
      renderQuotePreview();
      renderQuoteSummaryTiles(quote);
      scheduleQuoteSave();
    });

    refs.quoteEditor.addEventListener("click", (event) => {
      const button = event.target.closest("[data-editor-action]");
      if (!button) {
        return;
      }

      const action = button.dataset.editorAction;

      if (action === "add-item") {
        addLineItemToCurrentQuote();
      }

      if (action === "remove-item") {
        removeLineItemFromCurrentQuote(button.dataset.itemId);
      }

      if (action === "duplicate") {
        void duplicateQuoteById(state.activeQuoteId);
      }

      if (action === "delete") {
        void deleteQuoteById(state.activeQuoteId);
      }

      if (action === "save") {
        void flushQuoteSave(false);
      }

      if (action === "share") {
        void shareCurrentQuote();
      }

      if (action === "pdf") {
        void generatePdfForCurrentQuote();
      }
    });
  }

  refs.templateCards.addEventListener("click", (event) => {
    const button = event.target.closest("[data-template-id]");
    if (!button) {
      return;
    }

    state.activeTemplateId = button.dataset.templateId;
    renderTemplateCards();
    renderTemplateEditor();
  });

  refs.templateEditor.addEventListener("input", () => {
    const template = readTemplateFromForm();
    if (!template) {
      return;
    }

    updateTemplateInState(template);
    renderTemplateCards();
    renderQuotePreview();
    scheduleTemplateSave();
  });

  refs.templateEditor.addEventListener("click", (event) => {
    const button = event.target.closest("[data-template-action]");
    if (!button) {
      return;
    }

    if (button.dataset.templateAction === "save") {
      void flushTemplateSave(false);
    }
  });

  refs.settingsEditor.addEventListener("input", () => {
    const settings = readSettingsFromForm();
    if (!settings) {
      return;
    }

    state.settings = settings;
    renderSettingsSummary();
    renderQuotePreview();
    scheduleSettingsSave();
  });

  refs.settingsEditor.addEventListener("click", (event) => {
    const button = event.target.closest("[data-settings-action]");
    if (!button) {
      return;
    }

    if (button.dataset.settingsAction === "save") {
      void flushSettingsSave(false);
    }

    if (button.dataset.settingsAction === "copy-firebase") {
      void copyFirebaseSnippet();
    }
  });
}

function registerInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPromptEvent = event;
    refs.installButton.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    state.installPromptEvent = null;
    refs.installButton.hidden = true;
    showStatus("PWA installata sul dispositivo.");
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("Service worker non registrato", error);
  }
}

async function hydrateState() {
  const [quotes, settings, templates, companies] = await Promise.all([
    getAllRecords(STORES.quotes),
    getRecord(STORES.settings, DEFAULT_SETTINGS.id),
    getAllRecords(STORES.templates),
    getAllRecords(STORES.companies)
  ]);

  state.settings = mergeSettings(settings);
  state.templates = mergeTemplates(templates);
  state.quotes = sortQuotes(quotes);
  state.activeQuoteId = state.quotes[0]?.id ?? null;
  state.activeTemplateId = state.templates[0]?.id ?? "word";
  state.companies = companies ?? [];
  state.activeCompanyId = state.companies[0]?.id ?? null;
}

function renderApp() {
  renderSectionVisibility();
  renderDashboard();
  renderQuoteList();
  renderQuoteEditor();
  renderQuotePreview();
  renderTemplateCards();
  renderTemplateEditor();
  renderSettingsEditor();
  renderSettingsSummary();
  if (state.activeSection === "quoteEdit") renderQuoteEditSection();
  renderCompaniesEditor();
}

function renderQuoteEditSection() {
  const container = document.querySelector("#quoteEditContent");
  if (!container) return;

  const quote = getActiveQuote();
  if (!quote) {
    container.innerHTML = emptyState("Nessun preventivo", "Crea un nuovo preventivo per aprire l'editor.");
    return;
  }

  container.innerHTML = buildQuoteEditHTML(quote, {
    templates: state.templates,
    settings: state.settings,
    companies: state.companies
  });

  // Bind events to the root child (.qe-layout), NOT to container.
  // container persists across re-renders; its listeners stack up.
  // The root child is replaced on every re-render, so its listeners auto-clear.
  const root = container.firstElementChild;

  renderQEPreview();

  bindQuotePageEvents(
    root,
    {
      onBack:      () => { state.activeSection = "quotes"; renderSectionVisibility(); renderQuoteList(); renderQuoteEditor(); renderQuotePreview(); },
      onSave:      () => { void flushQEQuoteSave(true); },
      onPdf:       () => { void generatePdfForCurrentQuote(); },
      onShare:     () => { void shareCurrentQuote(); },
      onDuplicate: () => { void duplicateQuoteById(state.activeQuoteId); },
      onDelete:    () => { void deleteQuoteById(state.activeQuoteId); },
      onAddItem:   () => { addLineItemToCurrentQuoteEdit(); },
      onRemoveItem:(itemId) => { removeLineItemFromCurrentQuoteEdit(itemId); },
      onChange:    (updatedQuote) => {
        upsertQuoteInState(updatedQuote);
        renderQEPreview();
        updateQESummaryTiles(updatedQuote, state.settings.currency || "EUR");
        scheduleQEQuoteSave();
      }
    },
    () => getActiveQuote(),
    state.settings.currency || "EUR"
  );
}

function renderQEPreview() {
  const quote = getActiveQuote();
  const previewEl = document.querySelector("#qePreview");
  if (!previewEl) return;

  if (!quote) {
    previewEl.innerHTML = emptyState("Nessun preventivo", "");
    return;
  }

  const template = getTemplateById(quote.templateId);
  const badgeEl = document.querySelector("#qeTemplateBadge");
  if (badgeEl) badgeEl.textContent = template.name;

  previewEl.innerHTML = `
    <p class="preview-note">Anteprima HTML. PDF generato solo con "Genera PDF".</p>
    <div class="preview-frame">${buildPreviewMarkup(quote, template, state.settings, getCompanyForQuote(quote))}</div>
  `;
}

// Salvataggio per la pagina dedicata (legge da #quoteEditForm)
async function flushQEQuoteSave(showFeedback = true) {
  clearTimeout(timers.quote);
  const quote = readQuoteFromEditForm(getActiveQuote());
  if (!quote) return;
  upsertQuoteInState(quote);
  await persistQuote(quote);
  if (showFeedback) showStatus("Preventivo salvato.");
}

function scheduleQEQuoteSave() {
  clearTimeout(timers.quote);
  timers.quote = setTimeout(() => { void flushQEQuoteSave(false); }, 500);
}

function addLineItemToCurrentQuoteEdit() {
  const quote = readQuoteFromEditForm(getActiveQuote());
  if (!quote) return;
  quote.items.push(createLineItem({ vatRate: Number(quote.vatRate) || 0 }));
  upsertQuoteInState(quote);
  renderQELineItems(quote, state.settings.currency || "EUR");
  renderQEPreview();
  updateQESummaryTiles(quote, state.settings.currency || "EUR");
  scheduleQEQuoteSave();
}

function removeLineItemFromCurrentQuoteEdit(itemId) {
  const quote = readQuoteFromEditForm(getActiveQuote());
  if (!quote) return;
  quote.items = quote.items.filter(i => i.id !== itemId);
  if (!quote.items.length) quote.items = [createLineItem()];
  upsertQuoteInState(quote);
  renderQELineItems(quote, state.settings.currency || "EUR");
  renderQEPreview();
  updateQESummaryTiles(quote, state.settings.currency || "EUR");
  scheduleQEQuoteSave();
}

function renderSectionVisibility() {
  // quoteEdit è una vista contestuale: evidenzia "quotes" nel nav
  const navSection = state.activeSection === "quoteEdit" ? "quotes" : state.activeSection;

  refs.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.section === navSection);
  });

  refs.sectionPanels.forEach((section) => {
    section.classList.toggle("is-active", section.dataset.sectionPanel === state.activeSection);
  });
}

function renderDashboard() {
  const quotes   = state.quotes;
  const currency = state.settings.currency || "EUR";
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const in7Days  = new Date(today.getTime() + 7 * 24 * 3600 * 1000);

  // Pre-calcola totali una sola volta
  const qt = quotes.map(q => ({ q, t: calculateQuoteTotals(q) }));

  const totalValue   = qt.reduce((s, { t }) => s + t.total, 0);
  const pendingValue = qt.filter(({ q }) => ["sent","approved","confirmed"].includes(q.status)).reduce((s, { t }) => s + t.total, 0);
  const paidValue    = qt.filter(({ q }) => q.status === "paid").reduce((s, { t }) => s + t.total, 0);
  const avgValue     = quotes.length ? totalValue / quotes.length : 0;

  const expiringCount = quotes.filter(q => {
    if (!q.validUntil || ["paid","confirmed"].includes(q.status)) return false;
    const d = new Date(q.validUntil);
    return d >= today && d <= in7Days;
  }).length;
  const expiredCount = quotes.filter(q => {
    if (!q.validUntil || ["paid","confirmed"].includes(q.status)) return false;
    return new Date(q.validUntil) < today;
  }).length;

  // Data corrente nell'header
  const dateEl = document.querySelector("#dashboardDate");
  if (dateEl) dateEl.textContent = new Intl.DateTimeFormat("it-IT", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  }).format(new Date());

  // KPIs
  refs.dashboardMetrics.innerHTML = [
    metricCard("Preventivi",   `${quotes.length}`,              "In archivio",                                  ""),
    metricCard("Valore totale", formatCurrency(totalValue, currency),  "Somma complessiva",                    ""),
    metricCard("Da incassare",  formatCurrency(pendingValue, currency), "Inviati · Approvati · Confermati",    pendingValue > 0 ? "warn" : ""),
    metricCard("Incassato",     formatCurrency(paidValue, currency),    "Preventivi pagati",                   paidValue > 0 ? "ok" : ""),
    metricCard("Ticket medio",  formatCurrency(avgValue, currency),     "Media per preventivo",                ""),
    metricCard("In scadenza",   `${expiringCount}`,              `${expiredCount} già scaduti`,                expiringCount > 0 || expiredCount > 0 ? "warn" : ""),
  ].join("");

  refs.dashboardPipeline.innerHTML = buildPipeline(qt, currency);
  refs.dashboardRecent.innerHTML   = buildRecentList(qt, currency);

  const clientsEl = document.querySelector("#dashboardClients");
  if (clientsEl) clientsEl.innerHTML = buildTopClients(qt, currency);

  const trendEl = document.querySelector("#dashboardTrend");
  if (trendEl) trendEl.innerHTML = buildMonthlyTrend(qt, currency);
}

function renderQuoteList() {
  const filteredQuotes = getFilteredQuotes();
  refs.quoteCounter.textContent = `${filteredQuotes.length} risultati`;
  refs.quoteList.innerHTML = filteredQuotes.length
    ? filteredQuotes.map((quote) => renderQuoteCard(quote)).join("")
    : emptyState("Nessun preventivo trovato", "Prova a cambiare i filtri oppure crea un nuovo preventivo dal pulsante in alto.");
}

function renderQuoteEditor() {
  if (!refs.quoteEditor) return;
  const quote = getActiveQuote();

  if (!quote) {
    refs.quoteEditor.innerHTML = emptyState("Nessun preventivo selezionato", "Crea un nuovo preventivo per iniziare a compilare dati, righe e note.");
    return;
  }

  const totals = calculateQuoteTotals(quote);

  refs.quoteEditor.innerHTML = `
    <div class="editor-top">
      <div class="editor-toolbar">
        <div>
          <p class="eyebrow">Composizione</p>
          <h4>${escapeHtml(quote.number)}</h4>
        </div>
        <div class="action-row">
          <button class="ghost" type="button" data-editor-action="save">Salva ora</button>
          <button class="secondary" type="button" data-editor-action="duplicate">Duplica</button>
          <button class="danger" type="button" data-editor-action="delete">Elimina</button>
        </div>
      </div>
      <div id="editorSummaryTiles" class="editor-summary">
        ${buildSummaryTiles(totals)}
      </div>
    </div>

    <form id="quoteForm" class="stack">
      <div class="form-grid">
        <label class="field">
          <span>Titolo preventivo</span>
          <input name="title" value="${escapeAttribute(quote.title)}" required>
        </label>
        <label class="field">
          <span>Stato</span>
          <select name="status">${renderStatusOptions(quote.status)}</select>
        </label>

        <label class="field">
          <span>Azienda cliente</span>
          <input name="clientCompany" value="${escapeAttribute(quote.clientCompany)}">
        </label>
        <label class="field">
          <span>P.IVA / C.F.</span>
          <input name="clientVatId" value="${escapeAttribute(quote.clientVatId ?? "")}">
        </label>
        <label class="field full">
          <span>Indirizzo</span>
          <input name="clientAddress" value="${escapeAttribute(quote.clientAddress ?? "")}">
        </label>
        <label class="field">
          <span>PEC</span>
          <input name="clientPec" value="${escapeAttribute(quote.clientPec ?? "")}">
        </label>
        <label class="field">
          <span>Email cliente</span>
          <input name="clientEmail" type="email" value="${escapeAttribute(quote.clientEmail)}">
        </label>
        <label class="field">
          <span>Nome referente</span>
          <input name="clientName" value="${escapeAttribute(quote.clientName)}">
        </label>
        <label class="field">
          <span>Telefono cliente</span>
          <input name="clientPhone" value="${escapeAttribute(quote.clientPhone)}">
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
            ${state.templates.map((template) => `<option value="${template.id}" ${template.id === quote.templateId ? "selected" : ""}>${escapeHtml(template.name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Sconto %</span>
          <input name="discount" type="number" min="0" max="100" step="0.5" value="${quote.discount}">
        </label>

        <label class="field">
          <span>IVA %</span>
          <input name="vatRate" type="number" min="0" step="0.5" value="${quote.vatRate}">
        </label>
        <label class="field">
          <span>Pagamento</span>
          <input name="paymentTerms" value="${escapeAttribute(quote.paymentTerms)}">
        </label>

        <label class="field full">
          <span>Introduzione</span>
          <textarea name="intro">${escapeHtml(quote.intro)}</textarea>
        </label>
      </div>

      <div class="stack">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Righe</p>
            <h4>Voci di preventivo</h4>
          </div>
          <button class="primary" type="button" data-editor-action="add-item">Aggiungi riga</button>
        </div>

        <div class="line-items">
          ${(quote.items ?? []).map((item) => renderLineItemEditor(item, quote.vatRate)).join("")}
        </div>
      </div>

      <div class="form-grid">
        <label class="field full">
          <span>Note finali</span>
          <textarea name="notes">${escapeHtml(quote.notes)}</textarea>
        </label>
      </div>

      <div class="inline-actions">
        <button class="primary" type="button" data-editor-action="pdf">Genera PDF</button>
        <button class="secondary" type="button" data-editor-action="share">Condividi</button>
      </div>
    </form>
  `;
}

function renderQuotePreview() {
  if (!refs.quotePreview) return;
  const quote = getActiveQuote();

  if (!quote) {
    if (refs.previewTemplateBadge) refs.previewTemplateBadge.textContent = "Nessuna selezione";
    refs.quotePreview.innerHTML = emptyState("Anteprima non disponibile", "Seleziona o crea un preventivo per vedere il layout visivo in tempo reale.");
    return;
  }

  const template = getTemplateById(quote.templateId);
  if (refs.previewTemplateBadge) refs.previewTemplateBadge.textContent = template.name;
  refs.quotePreview.innerHTML = `
    <p class="preview-note">Anteprima HTML/CSS. Il PDF reale viene creato solo quando premi "Genera PDF".</p>
    <div class="preview-frame">${buildPreviewMarkup(quote, template, state.settings, getCompanyForQuote(quote))}</div>
  `;
}

function renderTemplateCards() {
  refs.templateCards.innerHTML = state.templates.map((template) => renderTemplateCard(template)).join("");
}

function renderTemplateEditor() {
  const template = getActiveTemplate();

  if (!template) {
    refs.templateEditor.innerHTML = emptyState("Nessun template", "I template vengono caricati dal database locale durante l'avvio dell'app.");
    return;
  }

  refs.templateEditor.innerHTML = `
    <form id="templateForm" class="stack">
      <div class="form-grid">
        <label class="field">
          <span>Nome</span>
          <input name="name" value="${escapeAttribute(template.name)}">
        </label>
        <label class="field">
          <span>Descrizione</span>
          <input name="description" value="${escapeAttribute(template.description)}">
        </label>
        <label class="field">
          <span>Colore accento</span>
          <input name="accent" type="color" value="${escapeAttribute(template.accent)}">
        </label>
        <label class="field">
          <span>Colore testo</span>
          <input name="text" type="color" value="${escapeAttribute(template.text)}">
        </label>
      </div>

      <div class="action-row">
        <button class="primary" type="button" data-template-action="save">Salva template</button>
      </div>
    </form>
  `;
}

function renderSettingsEditor() {
  refs.settingsEditor.innerHTML = `
    <form id="settingsForm" class="stack">
      <div class="form-grid">
        <label class="field">
          <span>Ragione sociale</span>
          <input name="companyName" value="${escapeAttribute(state.settings.companyName)}">
        </label>
        <label class="field">
          <span>P. IVA</span>
          <input name="companyVatId" value="${escapeAttribute(state.settings.companyVatId)}">
        </label>
        <label class="field full">
          <span>Indirizzo</span>
          <input name="address" value="${escapeAttribute(state.settings.address)}">
        </label>
        <label class="field">
          <span>Email</span>
          <input name="email" type="email" value="${escapeAttribute(state.settings.email)}">
        </label>
        <label class="field">
          <span>Telefono</span>
          <input name="phone" value="${escapeAttribute(state.settings.phone)}">
        </label>
        <label class="field">
          <span>PEC</span>
          <input name="companyPec" value="${escapeAttribute(state.settings.companyPec ?? "")}">
        </label>
        <label class="field">
          <span>Sito web</span>
          <input name="website" value="${escapeAttribute(state.settings.website)}">
        </label>
        <label class="field">
          <span>Prefisso numerazione</span>
          <input name="numberingPrefix" value="${escapeAttribute(state.settings.numberingPrefix)}">
        </label>
        <label class="field">
          <span>Prossimo numero</span>
          <input name="nextQuoteNumber" type="number" min="1" step="1" value="${state.settings.nextQuoteNumber}">
        </label>
        <label class="field">
          <span>IVA default %</span>
          <input name="defaultVatRate" type="number" min="0" step="0.5" value="${state.settings.defaultVatRate}">
        </label>
        <label class="field">
          <span>Valuta</span>
          <input name="currency" value="${escapeAttribute(state.settings.currency)}">
        </label>
        <label class="field full">
          <span>Pagamenti di default</span>
          <textarea name="paymentTerms">${escapeHtml(state.settings.paymentTerms)}</textarea>
        </label>
        <label class="field full">
          <span>Note di default</span>
          <textarea name="defaultNotes">${escapeHtml(state.settings.defaultNotes)}</textarea>
        </label>
      </div>

      <div class="firebase-box stack">
        <div>
          <p class="eyebrow">Firebase</p>
          <h4>Config cloud opzionale</h4>
        </div>
        <div class="form-grid">
          ${renderFirebaseField("apiKey", "API key")}
          ${renderFirebaseField("authDomain", "Auth domain")}
          ${renderFirebaseField("projectId", "Project ID")}
          ${renderFirebaseField("storageBucket", "Storage bucket")}
          ${renderFirebaseField("messagingSenderId", "Messaging sender ID")}
          ${renderFirebaseField("appId", "App ID")}
          ${renderFirebaseField("measurementId", "Measurement ID")}
        </div>
      </div>

      <div class="action-row">
        <button class="primary" type="button" data-settings-action="save">Salva impostazioni</button>
        <button class="secondary" type="button" data-settings-action="copy-firebase">Copia snippet Firebase</button>
      </div>
    </form>
  `;
}

function renderSettingsSummary() {
  const firebaseStatus = getFirebaseStatus(state.settings.firebase);
  const quotesCount = state.quotes.length;
  const totalValue = state.quotes.reduce((sum, quote) => sum + calculateQuoteTotals(quote).total, 0);
  const snippet = buildFirebaseSnippet(state.settings.firebase);

  refs.settingsSummary.innerHTML = `
    <div class="summary-box stack">
      <span class="badge ${firebaseStatus.isReady ? "" : "subtle"}">${firebaseStatus.isReady ? "Firebase pronto" : "Firebase incompleto"}</span>
      <p>${escapeHtml(buildFirebaseStatusText(state.settings.firebase))}</p>
      <div class="summary-grid">
        <div>
          <span class="muted">Archivio locale</span>
          <strong>${quotesCount} preventivi</strong>
        </div>
        <div>
          <span class="muted">Valore attuale</span>
          <strong>${formatCurrency(totalValue)}</strong>
        </div>
      </div>
    </div>

    <div class="stack">
      <div>
        <p class="eyebrow">Snippet di aggancio</p>
        <h4>Bootstrap Firebase</h4>
      </div>
      <pre class="code-block">${escapeHtml(snippet)}</pre>
    </div>
  `;
}

function renderQuoteSummaryTiles(quote) {
  const container = document.querySelector("#editorSummaryTiles");
  if (!container) {
    return;
  }

  container.innerHTML = buildSummaryTiles(calculateQuoteTotals(quote));
}

function buildSummaryTiles(totals) {
  return `
    <div class="summary-tile"><span>Subtotale</span><strong>${formatCurrency(totals.subtotal)}</strong></div>
    <div class="summary-tile"><span>IVA</span><strong>${formatCurrency(totals.vatAmount)}</strong></div>
    <div class="summary-tile"><span>Totale</span><strong>${formatCurrency(totals.total)}</strong></div>
    <div class="summary-tile"><span>Righe</span><strong>${totals.lineCount}</strong></div>
  `;
}

function metricCard(label, value, caption, variant = "") {
  return `
    <article class="metric-card${variant ? ` metric-card--${variant}` : ""}">
      <span class="metric-label">${label}</span>
      <strong class="metric-value">${value}</strong>
      <span class="metric-caption">${caption || "&nbsp;"}</span>
    </article>
  `;
}

const PIPELINE_CONFIG = [
  { key: "draft",     label: "Bozza",      color: "#c77b2e", bg: "rgba(203,127,54,0.18)" },
  { key: "sent",      label: "Inviato",    color: "#0b5f56", bg: "rgba(11,95,86,0.18)"   },
  { key: "approved",  label: "Approvato",  color: "#2563eb", bg: "rgba(37,99,235,0.18)"  },
  { key: "confirmed", label: "Confermato", color: "#2d6e49", bg: "rgba(53,116,78,0.18)"  },
  { key: "paid",      label: "Pagato",     color: "#7c3aed", bg: "rgba(124,58,237,0.18)" },
];

function buildPipeline(qt, currency) {
  if (!qt.length) return emptyState("Nessun preventivo", "Crea il primo preventivo per popolare la dashboard.");

  const totalValue = qt.reduce((s, { t }) => s + t.total, 0) || 1;
  const totalCount = qt.length;

  return `<div class="pipeline-list">${PIPELINE_CONFIG.map(({ key, label, color, bg }) => {
    const items = qt.filter(({ q }) => q.status === key);
    const count = items.length;
    const value = items.reduce((s, { t }) => s + t.total, 0);
    const pctW  = Math.max(Math.round((value / totalValue) * 100), count > 0 ? 1 : 0);

    return `
      <div class="pipeline-row">
        <div class="pipeline-status">
          <span class="pipeline-dot" style="background:${color}"></span>
          <span class="pipeline-label">${label}</span>
        </div>
        <div class="pipeline-track">
          <div class="pipeline-fill" style="width:${pctW}%;background:${bg};border-right:3px solid ${color}"></div>
        </div>
        <div class="pipeline-numbers">
          <span class="pipeline-count">${count} <small>prev.</small></span>
          <strong class="pipeline-value">${formatCurrency(value, currency)}</strong>
          <span class="pipeline-pct">${pctW}%</span>
        </div>
      </div>`;
  }).join("")}</div>`;
}

function buildRecentList(qt, currency) {
  if (!qt.length) return emptyState("Archivio vuoto", "I preventivi appariranno qui.");

  return `<div class="db-recent-list">${
    sortQuotes(qt.map(({ q }) => q)).slice(0, 7).map(q => {
      const totals = calculateQuoteTotals(q);
      const client = escapeHtml(q.clientCompany || q.clientName || "—");
      return `
        <div class="db-recent-row" data-quote-id="${q.id}" role="button" tabindex="0">
          <div class="db-recent-main">
            <div class="db-recent-info">
              <strong>${escapeHtml(q.title || q.number)}</strong>
              <span class="muted">${client} · ${escapeHtml(q.number)}</span>
            </div>
            <div class="db-recent-right">
              <strong>${formatCurrency(totals.total, currency)}</strong>
              <span class="status-chip status-chip--sm" data-status="${q.status}">${statusLabels[q.status] ?? q.status}</span>
            </div>
          </div>
        </div>`;
    }).join("")
  }</div>`;
}

function buildTopClients(qt, currency) {
  if (!qt.length) return emptyState("Nessun cliente", "I dati clienti appariranno qui.");

  const map = new Map();
  for (const { q, t } of qt) {
    const name = q.clientCompany || q.clientName || "—";
    const prev = map.get(name) ?? { name, total: 0, count: 0 };
    map.set(name, { name, total: prev.total + t.total, count: prev.count + 1 });
  }

  const clients  = [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  const maxTotal = clients[0]?.total || 1;

  return `<div class="db-client-list">${clients.map((c, i) => `
    <div class="db-client-row">
      <span class="db-client-rank">${i + 1}</span>
      <div class="db-client-info">
        <strong>${escapeHtml(c.name)}</strong>
        <div class="db-bar-track">
          <div class="db-bar-fill" style="width:${Math.round((c.total / maxTotal) * 100)}%"></div>
        </div>
      </div>
      <div class="db-client-value">
        <strong>${formatCurrency(c.total, currency)}</strong>
        <span class="muted">${c.count} prev.</span>
      </div>
    </div>`).join("")
  }</div>`;
}

function buildMonthlyTrend(qt, currency) {
  const now    = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      year:  d.getFullYear(),
      month: d.getMonth(),
      label: d.toLocaleDateString("it-IT", { month: "short" }),
      total: 0, count: 0
    });
  }

  for (const { q, t } of qt) {
    const d  = new Date(q.createdAt || q.updatedAt);
    const mi = months.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth());
    if (mi >= 0) { months[mi].total += t.total; months[mi].count++; }
  }

  const maxTotal = Math.max(...months.map(m => m.total), 1);

  return `<div class="db-trend-rows">${months.map(m => {
    const pct = Math.max(Math.round((m.total / maxTotal) * 100), m.total > 0 ? 3 : 0);
    return `
      <div class="db-trend-row">
        <span class="db-trend-month">${m.label}</span>
        <div class="db-trend-track">
          <div class="db-trend-fill" style="width:${pct}%"></div>
        </div>
        <div class="db-trend-right">
          <strong>${m.total > 0 ? formatCurrency(m.total, currency) : "—"}</strong>
          ${m.count > 0 ? `<span class="muted">${m.count} prev.</span>` : ""}
        </div>
      </div>`;
  }).join("")}</div>`;
}

function renderQuoteCard(quote) {
  const totals = calculateQuoteTotals(quote);
  const isActive = quote.id === state.activeQuoteId;
  const clientName = quote.clientCompany || quote.clientName || "Cliente non indicato";

  return `
    <article class="quote-card ${isActive ? "is-active" : ""}" data-quote-id="${quote.id}">
      <div class="quote-card-header">
        <div>
          <h5>${escapeHtml(quote.title || quote.number)}</h5>
          <span class="muted">${escapeHtml(quote.number)}</span>
        </div>
        <button class="status-chip" type="button" data-status="${quote.status}" data-quote-action="cycle-status" title="Clicca per cambiare stato">${statusLabels[quote.status] ?? quote.status}</button>
      </div>
      <div class="quote-card-meta">
        <span>${escapeHtml(clientName)}</span>
        <strong>${formatCurrency(totals.total)}</strong>
      </div>
      <div class="quote-card-meta">
        <span class="muted">Aggiornato ${formatDate(quote.updatedAt)}</span>
        <span class="badge subtle">${escapeHtml(getTemplateById(quote.templateId).name)}</span>
      </div>
      <div class="quote-card-actions">
        <button class="mini-button" type="button" data-quote-action="open">Apri</button>
        <button class="mini-button" type="button" data-quote-action="duplicate">Duplica</button>
        <button class="mini-button" type="button" data-quote-action="delete">Elimina</button>
      </div>
    </article>
  `;
}

function renderLineItemEditor(item, defaultVatRate = 22) {
  const effectiveVat      = item.vatRate        != null ? item.vatRate        : defaultVatRate;
  const effectiveDiscount = item.lineDiscount   != null ? item.lineDiscount   : 0;
  const effectiveType     = item.lineDiscountType === "fixed" ? "fixed" : "percent";

  const qty        = Number(item.qty) || 0;
  const price      = Number(item.unitPrice) || 0;
  const imponibile = qty * price;
  const scontoAmt  = effectiveType === "fixed"
    ? Math.min(effectiveDiscount, imponibile)
    : imponibile * (effectiveDiscount / 100);
  const totale = (imponibile - scontoAmt) * (1 + effectiveVat / 100);

  return `
    <div class="line-item" data-item-id="${item.id}">
      <label class="field">
        <span>Descrizione</span>
        <input data-line-field="description" value="${escapeAttribute(item.description)}">
      </label>
      <label class="field">
        <span>Qtà</span>
        <input data-line-field="qty" type="number" min="0" step="0.01" value="${item.qty}">
      </label>
      <label class="field">
        <span>Imponibile</span>
        <input data-line-field="unitPrice" type="number" min="0" step="0.01" value="${item.unitPrice}">
      </label>
      <label class="field">
        <span>IVA %</span>
        <input data-line-field="vatRate" type="number" min="0" step="0.5" value="${effectiveVat}">
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
      <div class="stack">
        <span class="line-total">${formatCurrency(totale)}</span>
        <button class="mini-button" type="button" data-editor-action="remove-item" data-item-id="${item.id}">Rimuovi</button>
      </div>
    </div>
  `;
}

function renderTemplateCard(template) {
  const isActive = template.id === state.activeTemplateId;

  return `
    <button class="template-card ${isActive ? "is-active" : ""}" type="button" data-template-id="${template.id}">
      <div class="template-card-header">
        <div>
          <h5>${escapeHtml(template.name)}</h5>
          <span class="muted">${escapeHtml(template.description)}</span>
        </div>
        <span class="badge subtle">${template.id}</span>
      </div>
      <div class="template-swatches">
        <span class="template-swatch" style="background: ${template.accent}"></span>
        <span class="template-swatch" style="background: ${template.surface}"></span>
        <span class="template-swatch" style="background: ${template.text}"></span>
      </div>
    </button>
  `;
}

function renderFirebaseField(field, label) {
  return `
    <label class="field">
      <span>${label}</span>
      <input name="firebase.${field}" value="${escapeAttribute(state.settings.firebase[field])}">
    </label>
  `;
}

async function createQuoteAndOpen() {
  if (state.activeSection === "quoteEdit") {
    await flushQEQuoteSave(false);
  } else {
    await flushQuoteSave(false);
  }
  const quote = createEmptyQuote(state.settings);
  await persistNewQuote(quote);
  state.activeQuoteId = quote.id;
  state.activeSection = "quoteEdit";
  renderApp();
  showStatus("Nuovo preventivo creato.");
}

async function selectQuote(quoteId) {
  if (state.activeSection === "quoteEdit") {
    await flushQEQuoteSave(false);
  } else {
    await flushQuoteSave(false);
  }
  state.activeQuoteId = quoteId;
  state.activeSection = "quoteEdit";
  renderSectionVisibility();
  renderQuoteEditSection();
}

async function duplicateQuoteById(quoteId) {
  const quote = getQuoteById(quoteId);
  if (!quote) {
    return;
  }

  if (state.activeSection === "quoteEdit") {
    await flushQEQuoteSave(false);
  } else {
    await flushQuoteSave(false);
  }
  const duplicated = duplicateQuote(quote, state.settings);
  await persistNewQuote(duplicated);
  state.activeQuoteId = duplicated.id;
  state.activeSection = "quotes";
  renderApp();
  showStatus("Preventivo duplicato.");
}

async function deleteQuoteById(quoteId) {
  const quote = getQuoteById(quoteId);
  if (!quote) return;

  const confirmed = await showConfirmModal(
    "Elimina preventivo",
    `Eliminare ${quote.number} — ${quote.title || "Preventivo"}? L'operazione non è reversibile.`
  );
  if (!confirmed) return;

  clearTimeout(timers.quote);
  await deleteRecord(STORES.quotes, quoteId);
  state.quotes = state.quotes.filter((item) => item.id !== quoteId);
  state.activeQuoteId = null;
  state.activeSection = "quotes";
  renderApp();
  showStatus("Preventivo eliminato.");
}

async function cycleQuoteStatus(quoteId) {
  const quote = getQuoteById(quoteId);
  if (!quote) return;

  const currentIndex = STATUS_ORDER.indexOf(quote.status);
  const nextStatus   = STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length];
  const updatedQuote = { ...quote, status: nextStatus, updatedAt: new Date().toISOString() };

  // persistQuote handles upsertQuoteInState + renderQuoteList internally
  await persistQuote(updatedQuote);

  // Aggiorna la select nello form di editing se aperto su questo preventivo
  if (state.activeSection === "quoteEdit" && state.activeQuoteId === quoteId) {
    const statusSelect = document.querySelector("#quoteEditForm [name='status']");
    if (statusSelect) statusSelect.value = nextStatus;
  }
  showStatus(`Stato: ${statusLabels[nextStatus]}`);
}

function showConfirmModal(title, message) {
  return new Promise((resolve) => {
    const overlay    = document.querySelector("#confirmModal");
    const titleEl    = document.querySelector("#confirmModalTitle");
    const messageEl  = document.querySelector("#confirmModalMessage");
    const cancelBtn  = document.querySelector("#confirmModalCancel");
    const confirmBtn = document.querySelector("#confirmModalConfirm");

    if (!overlay) { resolve(window.confirm(message)); return; }

    titleEl.textContent   = title;
    messageEl.textContent = message;
    overlay.hidden = false;

    function cleanup(result) {
      overlay.hidden = true;
      resolve(result);
    }

    cancelBtn.addEventListener("click",  () => cleanup(false), { once: true });
    confirmBtn.addEventListener("click", () => cleanup(true),  { once: true });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(false); }, { once: true });
  });
}

function addLineItemToCurrentQuote() {
  const quote = readQuoteFromForm();
  if (!quote) {
    return;
  }

  quote.items.push(createLineItem({ vatRate: Number(quote.vatRate) || 0 }));
  upsertQuoteInState(quote);
  renderQuoteEditor();
  renderQuotePreview();
  scheduleQuoteSave();
}

function removeLineItemFromCurrentQuote(itemId) {
  const quote = readQuoteFromForm();
  if (!quote) {
    return;
  }

  quote.items = quote.items.filter((item) => item.id !== itemId);
  if (!quote.items.length) {
    quote.items = [createLineItem()];
  }

  upsertQuoteInState(quote);
  renderQuoteEditor();
  renderQuotePreview();
  scheduleQuoteSave();
}

function scheduleQuoteSave() {
  clearTimeout(timers.quote);
  timers.quote = setTimeout(() => {
    void flushQuoteSave(false);
  }, 450);
}

function scheduleTemplateSave() {
  clearTimeout(timers.template);
  timers.template = setTimeout(() => {
    void flushTemplateSave(false);
  }, 450);
}

function scheduleSettingsSave() {
  clearTimeout(timers.settings);
  timers.settings = setTimeout(() => {
    void flushSettingsSave(false);
  }, 450);
}

async function flushQuoteSave(showFeedback = true) {
  clearTimeout(timers.quote);
  const quote = readQuoteFromForm();
  if (!quote) {
    return;
  }

  await persistQuote(quote);
  if (showFeedback) {
    showStatus("Preventivo salvato in locale.");
  }
}

async function flushTemplateSave(showFeedback = true) {
  clearTimeout(timers.template);
  const template = readTemplateFromForm();
  if (!template) {
    return;
  }

  updateTemplateInState(template);
  await putRecord(STORES.templates, template);
  if (showFeedback) {
    showStatus("Template salvato.");
  }
}

async function flushSettingsSave(showFeedback = true) {
  clearTimeout(timers.settings);
  const settings = readSettingsFromForm();
  if (!settings) {
    return;
  }

  state.settings = settings;
  await putRecord(STORES.settings, settings);
  if (showFeedback) {
    showStatus("Impostazioni salvate.");
  }
}

async function persistNewQuote(quote) {
  const nextSettings = {
    ...state.settings,
    nextQuoteNumber: (Number(state.settings.nextQuoteNumber) || 1) + 1
  };

  state.settings = nextSettings;
  state.quotes = sortQuotes([quote, ...state.quotes]);
  await Promise.all([putRecord(STORES.quotes, quote), putRecord(STORES.settings, nextSettings)]);
}

async function persistQuote(quote) {
  upsertQuoteInState(quote);
  await putRecord(STORES.quotes, quote);
  renderDashboard();
  renderQuoteList();
  renderSettingsSummary();
}

function readQuoteFromForm() {
  const form = document.querySelector("#quoteForm");
  const activeQuote = getActiveQuote();
  if (!form || !activeQuote) {
    return null;
  }

  const formData = new FormData(form);
  const items = [...form.querySelectorAll("[data-item-id]")].map((row) => {
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
  }).filter((item, index, collection) => collection.length === 1 || item.description || item.qty || item.unitPrice);

  return {
    ...activeQuote,
    title: `${formData.get("title") ?? ""}`.trim() || "Nuovo preventivo",
    status: `${formData.get("status") ?? "draft"}`,
    clientName:    `${formData.get("clientName") ?? ""}`.trim(),
    clientCompany: `${formData.get("clientCompany") ?? ""}`.trim(),
    clientVatId:   `${formData.get("clientVatId") ?? ""}`.trim(),
    clientAddress: `${formData.get("clientAddress") ?? ""}`.trim(),
    clientPec:     `${formData.get("clientPec") ?? ""}`.trim(),
    clientEmail:   `${formData.get("clientEmail") ?? ""}`.trim(),
    clientPhone:   `${formData.get("clientPhone") ?? ""}`.trim(),
    number: `${formData.get("number") ?? activeQuote.number}`.trim() || activeQuote.number,
    validUntil: `${formData.get("validUntil") ?? activeQuote.validUntil}`.trim(),
    templateId: `${formData.get("templateId") ?? activeQuote.templateId}`.trim(),
    discount: readNumber(formData.get("discount"), 0),
    vatRate: readNumber(formData.get("vatRate"), state.settings.defaultVatRate),
    paymentTerms: `${formData.get("paymentTerms") ?? ""}`.trim(),
    intro: `${formData.get("intro") ?? ""}`.trim(),
    notes: `${formData.get("notes") ?? ""}`.trim(),
    items: items.length ? items : [createLineItem()],
    updatedAt: new Date().toISOString()
  };
}

function readTemplateFromForm() {
  const form = document.querySelector("#templateForm");
  const activeTemplate = getActiveTemplate();
  if (!form || !activeTemplate) {
    return null;
  }

  const formData = new FormData(form);

  return {
    ...activeTemplate,
    name: `${formData.get("name") ?? ""}`.trim() || activeTemplate.name,
    description: `${formData.get("description") ?? ""}`.trim(),
    accent: `${formData.get("accent") ?? activeTemplate.accent}`.trim(),
    surface: activeTemplate.surface,
    text: `${formData.get("text") ?? activeTemplate.text}`.trim()
  };
}

function readSettingsFromForm() {
  const form = document.querySelector("#settingsForm");
  if (!form) {
    return null;
  }

  const formData = new FormData(form);

  return mergeSettings({
    id: "app",
    companyName: `${formData.get("companyName") ?? ""}`.trim(),
    companyVatId: `${formData.get("companyVatId") ?? ""}`.trim(),
    address: `${formData.get("address") ?? ""}`.trim(),
    email: `${formData.get("email") ?? ""}`.trim(),
    phone: `${formData.get("phone") ?? ""}`.trim(),
    website: `${formData.get("website") ?? ""}`.trim(),
    companyPec: `${formData.get("companyPec") ?? ""}`.trim(),
    numberingPrefix: `${formData.get("numberingPrefix") ?? "PREV"}`.trim() || "PREV",
    nextQuoteNumber: Math.max(1, readNumber(formData.get("nextQuoteNumber"), 1)),
    defaultVatRate: readNumber(formData.get("defaultVatRate"), 22),
    currency: `${formData.get("currency") ?? "EUR"}`.trim() || "EUR",
    paymentTerms: `${formData.get("paymentTerms") ?? ""}`.trim(),
    defaultNotes: `${formData.get("defaultNotes") ?? ""}`.trim(),
    firebase: {
      apiKey: `${formData.get("firebase.apiKey") ?? ""}`.trim(),
      authDomain: `${formData.get("firebase.authDomain") ?? ""}`.trim(),
      projectId: `${formData.get("firebase.projectId") ?? ""}`.trim(),
      storageBucket: `${formData.get("firebase.storageBucket") ?? ""}`.trim(),
      messagingSenderId: `${formData.get("firebase.messagingSenderId") ?? ""}`.trim(),
      appId: `${formData.get("firebase.appId") ?? ""}`.trim(),
      measurementId: `${formData.get("firebase.measurementId") ?? ""}`.trim()
    }
  });
}

async function generatePdfForCurrentQuote() {
  if (state.activeSection === "quoteEdit") {
    await flushQEQuoteSave(false);
  } else {
    await flushQuoteSave(false);
  }
  const quote = getActiveQuote();
  if (!quote) return;
  const template = getTemplateById(quote.templateId);
  const company = getCompanyForQuote(quote);
  const markup = buildPreviewMarkup(quote, template, state.settings, company);
  const ok = printPreviewInNewWindow(quote, template, markup);
  if (!ok) showStatus("Popup bloccato dal browser. Sblocca i popup per questa pagina.");
}

async function shareCurrentQuote() {
  if (state.activeSection === "quoteEdit") {
    await flushQEQuoteSave(false);
  } else {
    await flushQuoteSave(false);
  }
  const quote = getActiveQuote();
  if (!quote) {
    return;
  }

  const totals = calculateQuoteTotals(quote);
  const shareData = {
    title: quote.title || quote.number,
    text: `${quote.number} - ${quote.title}\nCliente: ${quote.clientCompany || quote.clientName || "N/D"}\nTotale: ${formatCurrency(totals.total)}`
  };

  try {
    if (navigator.share && state.lastSharedPdf?.quoteId === quote.id && state.lastSharedPdf.file && navigator.canShare?.({ files: [state.lastSharedPdf.file] })) {
      await navigator.share({
        ...shareData,
        files: [state.lastSharedPdf.file]
      });
      showStatus("Preventivo condiviso.");
      return;
    }

    if (navigator.share) {
      await navigator.share(shareData);
      showStatus("Riepilogo condiviso.");
      return;
    }

    await navigator.clipboard.writeText(shareData.text);
    showStatus("Web Share non disponibile: riepilogo copiato negli appunti.");
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error(error);
      showStatus("Condivisione non riuscita.");
    }
  }
}

async function copyFirebaseSnippet() {
  try {
    await navigator.clipboard.writeText(buildFirebaseSnippet(state.settings.firebase));
    showStatus("Snippet Firebase copiato.");
  } catch (error) {
    console.error(error);
    showStatus("Impossibile copiare lo snippet.");
  }
}

function getFilteredQuotes() {
  const searchTerm = state.filters.search.toLowerCase();
  const dateFromMs = state.filters.dateFrom ? new Date(state.filters.dateFrom).getTime() : null;
  const dateToMs   = state.filters.dateTo   ? new Date(state.filters.dateTo + "T23:59:59").getTime() : null;

  const filtered = state.quotes.filter((quote) => {
    const haystack = [
      quote.number, quote.title,
      quote.clientName, quote.clientCompany,
      quote.clientEmail, quote.clientPhone
    ].join(" ").toLowerCase();

    const matchesSearch = !searchTerm || haystack.includes(searchTerm);
    const matchesStatus = state.filters.status === "all" || quote.status === state.filters.status;

    const updatedAt = new Date(quote.updatedAt).getTime();
    const matchesFrom = !dateFromMs || updatedAt >= dateFromMs;
    const matchesTo   = !dateToMs   || updatedAt <= dateToMs;

    return matchesSearch && matchesStatus && matchesFrom && matchesTo;
  });

  return filtered.sort((left, right) => compareQuotes(left, right, state.filters.sort));
}

function compareQuotes(left, right, mode) {
  if (mode === "updated-asc") {
    return new Date(left.updatedAt) - new Date(right.updatedAt);
  }

  if (mode === "total-desc") {
    return calculateQuoteTotals(right).total - calculateQuoteTotals(left).total;
  }

  if (mode === "total-asc") {
    return calculateQuoteTotals(left).total - calculateQuoteTotals(right).total;
  }

  if (mode === "client-asc") {
    return `${left.clientCompany || left.clientName}`.localeCompare(`${right.clientCompany || right.clientName}`, "it");
  }

  if (mode === "status-asc") {
    return `${statusLabels[left.status]}`.localeCompare(`${statusLabels[right.status]}`, "it");
  }

  return new Date(right.updatedAt) - new Date(left.updatedAt);
}

function sortQuotes(quotes) {
  return [...quotes].sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}

function getActiveQuote() {
  return state.quotes.find((quote) => quote.id === state.activeQuoteId) ?? null;
}

function getQuoteById(id) {
  return state.quotes.find((quote) => quote.id === id) ?? null;
}

function getTemplateById(id) {
  return state.templates.find((template) => template.id === id) ?? state.templates[0] ?? DEFAULT_TEMPLATES[0];
}

function getActiveTemplate() {
  return getTemplateById(state.activeTemplateId);
}

function getCompanyForQuote(quote) {
  if (quote?.issuingCompanyId) {
    return state.companies.find(c => c.id === quote.issuingCompanyId) ?? null;
  }
  // Nessuna azienda selezionata: usa la prima configurata (caso tipico con una sola azienda)
  return state.companies[0] ?? null;
}

function upsertQuoteInState(quote) {
  const nextQuotes = state.quotes.some((item) => item.id === quote.id)
    ? state.quotes.map((item) => item.id === quote.id ? quote : item)
    : [quote, ...state.quotes];

  state.quotes = sortQuotes(nextQuotes);
  state.activeQuoteId = quote.id;
}

function updateTemplateInState(template) {
  state.templates = state.templates.map((item) => item.id === template.id ? template : item);
}

function mergeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings ?? {}),
    companyPec: settings?.companyPec ?? DEFAULT_SETTINGS.companyPec ?? "",
    firebase: {
      ...DEFAULT_SETTINGS.firebase,
      ...(settings?.firebase ?? {})
    }
  };
}

function mergeTemplates(templates) {
  const map = new Map((templates ?? []).map((template) => [template.id, template]));
  return DEFAULT_TEMPLATES.map((template) => ({
    ...template,
    ...(map.get(template.id) ?? {})
  }));
}

function renderCompaniesEditor() {
  if (!refs.companiesEditor) return;

  const activeId = state.activeCompanyId;

  const cards = state.companies.map(c => {
    const isActive = c.id === activeId;
    return `
      <div class="company-card ${isActive ? "is-active" : ""}" data-company-id="${c.id}">
        <div class="company-card-header">
          ${c.logo ? `<img src="${c.logo}" class="company-card-logo" alt="">` : `<div class="company-card-logo-placeholder">${escapeHtml((c.name || "?")[0].toUpperCase())}</div>`}
          <div>
            <strong>${escapeHtml(c.name || "Azienda senza nome")}</strong>
            ${c.vatId ? `<span class="muted">P.IVA ${escapeHtml(c.vatId)}</span>` : ""}
          </div>
        </div>
        <div class="company-card-actions">
          <button class="mini-button" type="button" data-co-action="edit" data-company-id="${c.id}">Modifica</button>
          <button class="mini-button" type="button" data-co-action="delete" data-company-id="${c.id}">Elimina</button>
        </div>
      </div>
    `;
  }).join("");

  const activeCompany = state.companies.find(c => c.id === activeId);

  refs.companiesEditor.innerHTML = `
    <div class="companies-list">
      ${cards || `<p class="muted">Nessuna azienda configurata.</p>`}
      <button class="primary" type="button" id="addCompanyBtn">+ Aggiungi azienda</button>
    </div>
    ${activeCompany ? buildCompanyFormHTML(activeCompany) : ""}
  `;

  refs.companiesEditor.querySelector("#addCompanyBtn")?.addEventListener("click", () => {
    const newCo = createEmptyCompany();
    state.companies = [...state.companies, newCo];
    state.activeCompanyId = newCo.id;
    renderCompaniesEditor();
  });

  refs.companiesEditor.querySelectorAll("[data-co-action='edit']").forEach(btn => {
    btn.addEventListener("click", () => {
      state.activeCompanyId = btn.dataset.companyId;
      renderCompaniesEditor();
    });
  });

  refs.companiesEditor.querySelectorAll("[data-co-action='delete']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.companyId;
      if (!window.confirm("Eliminare questa azienda?")) return;
      await deleteRecord(STORES.companies, id);
      state.companies = state.companies.filter(c => c.id !== id);
      if (state.activeCompanyId === id) state.activeCompanyId = state.companies[0]?.id ?? null;
      renderCompaniesEditor();
    });
  });

  // Form events
  const form = refs.companiesEditor.querySelector("#companyEditForm");
  if (form) {
    const logoInput = form.querySelector("[name='logo']");
    if (logoInput) {
      logoInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const co = state.companies.find(c => c.id === state.activeCompanyId);
          if (co) { co.logo = reader.result; renderCompaniesEditor(); }
        };
        reader.readAsDataURL(file);
      });
    }

    refs.companiesEditor.querySelector("[data-co-action='save-company']")?.addEventListener("click", async () => {
      await saveActiveCompany();
    });

    refs.companiesEditor.querySelector("[data-co-action='remove-logo']")?.addEventListener("click", () => {
      const co = state.companies.find(c => c.id === state.activeCompanyId);
      if (co) { co.logo = null; renderCompaniesEditor(); }
    });
  }
}

function buildCompanyFormHTML(company) {
  return `
    <form id="companyEditForm" class="panel" style="margin-top:18px;" novalidate>
      <div class="panel-heading">
        <div><p class="eyebrow">Modifica</p><h4>${escapeHtml(company.name || "Nuova azienda")}</h4></div>
      </div>
      <div class="form-grid">
        <label class="field">
          <span>Ragione sociale</span>
          <input name="co_name" value="${escapeAttribute(company.name)}">
        </label>
        <label class="field">
          <span>P.IVA</span>
          <input name="co_vatId" value="${escapeAttribute(company.vatId)}">
        </label>
        <label class="field full">
          <span>Indirizzo</span>
          <input name="co_address" value="${escapeAttribute(company.address)}">
        </label>
        <label class="field">
          <span>Email</span>
          <input name="co_email" type="email" value="${escapeAttribute(company.email)}">
        </label>
        <label class="field">
          <span>PEC</span>
          <input name="co_pec" value="${escapeAttribute(company.pec)}">
        </label>
        <label class="field">
          <span>Telefono</span>
          <input name="co_phone" value="${escapeAttribute(company.phone)}">
        </label>
        <label class="field">
          <span>Sito web</span>
          <input name="co_website" value="${escapeAttribute(company.website)}">
        </label>
        <label class="field full">
          <span>Logo (PNG/JPG, max 200KB)</span>
          <div class="logo-upload-area">
            ${company.logo
              ? `<img src="${company.logo}" class="logo-preview" alt="Logo">
                 <button class="ghost" type="button" data-co-action="remove-logo">Rimuovi logo</button>`
              : `<input type="file" name="logo" accept="image/png,image/jpeg,image/svg+xml" class="logo-file-input">`
            }
          </div>
        </label>
      </div>
      <div class="action-row" style="margin-top:16px">
        <button class="primary" type="button" data-co-action="save-company">Salva azienda</button>
      </div>
    </form>
  `;
}

async function saveActiveCompany() {
  const form = document.querySelector("#companyEditForm");
  const co = state.companies.find(c => c.id === state.activeCompanyId);
  if (!form || !co) return;

  const fd = new FormData(form);
  const updated = {
    ...co,
    name:    `${fd.get("co_name") ?? ""}`.trim(),
    vatId:   `${fd.get("co_vatId") ?? ""}`.trim(),
    address: `${fd.get("co_address") ?? ""}`.trim(),
    email:   `${fd.get("co_email") ?? ""}`.trim(),
    pec:     `${fd.get("co_pec") ?? ""}`.trim(),
    phone:   `${fd.get("co_phone") ?? ""}`.trim(),
    website: `${fd.get("co_website") ?? ""}`.trim(),
    updatedAt: new Date().toISOString(),
  };
  state.companies = state.companies.map(c => c.id === updated.id ? updated : c);
  await putRecord(STORES.companies, updated);
  renderCompaniesEditor();
  showStatus("Azienda salvata.");
}

function showStatus(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("is-visible");
  clearTimeout(timers.toast);
  timers.toast = setTimeout(() => {
    refs.toast.classList.remove("is-visible");
  }, 2200);
}

