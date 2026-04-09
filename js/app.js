import {
  DEFAULT_SETTINGS,
  DEFAULT_TEMPLATES,
  STORES,
  calculateQuoteTotals,
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
import { generatePdfFromNode } from "./pdf.js";

const statusLabels = {
  draft: "Bozza",
  sent: "Inviato",
  approved: "Confermato"
};

const state = {
  quotes: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  templates: structuredClone(DEFAULT_TEMPLATES),
  activeSection: "dashboard",
  activeQuoteId: null,
  activeTemplateId: "word",
  filters: {
    search: "",
    status: "all",
    sort: "updated-desc"
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
  toast: document.querySelector("#statusToast")
};

document.addEventListener("DOMContentLoaded", () => {
  void init();
});

async function init() {
  bindGlobalEvents();
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

  refs.quoteEditor.addEventListener("input", (event) => {
    if (!event.target.closest("form")) {
      return;
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

  refs.quoteEditor.addEventListener("change", (event) => {
    if (!event.target.closest("form")) {
      return;
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

    if (action === "print") {
      window.print();
    }

    if (action === "share") {
      void shareCurrentQuote();
    }

    if (action === "pdf") {
      void generatePdfForCurrentQuote();
    }
  });

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
  const [quotes, settings, templates] = await Promise.all([
    getAllRecords(STORES.quotes),
    getRecord(STORES.settings, DEFAULT_SETTINGS.id),
    getAllRecords(STORES.templates)
  ]);

  state.settings = mergeSettings(settings);
  state.templates = mergeTemplates(templates);
  state.quotes = sortQuotes(quotes);
  state.activeQuoteId = state.quotes[0]?.id ?? null;
  state.activeTemplateId = state.templates[0]?.id ?? "word";
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
}

function renderSectionVisibility() {
  refs.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.section === state.activeSection);
  });

  refs.sectionPanels.forEach((section) => {
    section.classList.toggle("is-active", section.dataset.sectionPanel === state.activeSection);
  });
}

function renderDashboard() {
  const quotes = state.quotes;
  const totals = quotes.map((quote) => calculateQuoteTotals(quote));
  const totalValue = totals.reduce((sum, result) => sum + result.total, 0);
  const approvedCount = quotes.filter((quote) => quote.status === "approved").length;
  const sentCount = quotes.filter((quote) => quote.status === "sent").length;
  const averageValue = quotes.length ? totalValue / quotes.length : 0;

  refs.dashboardMetrics.innerHTML = [
    metricCard("Preventivi", `${quotes.length}`, "Archivio locale"),
    metricCard("Valore totale", formatCurrency(totalValue), "Somma di tutti i preventivi"),
    metricCard("Inviati", `${sentCount}`, "Pronti per follow-up"),
    metricCard("Ticket medio", formatCurrency(averageValue), `${approvedCount} confermati`)
  ].join("");

  refs.dashboardPipeline.innerHTML = renderPipelineList(quotes);
  refs.dashboardRecent.innerHTML = renderRecentList(quotes);
}

function renderQuoteList() {
  const filteredQuotes = getFilteredQuotes();
  refs.quoteCounter.textContent = `${filteredQuotes.length} risultati`;
  refs.quoteList.innerHTML = filteredQuotes.length
    ? filteredQuotes.map((quote) => renderQuoteCard(quote)).join("")
    : emptyState("Nessun preventivo trovato", "Prova a cambiare i filtri oppure crea un nuovo preventivo dal pulsante in alto.");
}

function renderQuoteEditor() {
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
          <span>Nome cliente</span>
          <input name="clientName" value="${escapeAttribute(quote.clientName)}">
        </label>
        <label class="field">
          <span>Azienda cliente</span>
          <input name="clientCompany" value="${escapeAttribute(quote.clientCompany)}">
        </label>

        <label class="field">
          <span>Email cliente</span>
          <input name="clientEmail" type="email" value="${escapeAttribute(quote.clientEmail)}">
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
          ${(quote.items ?? []).map((item) => renderLineItemEditor(item)).join("")}
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
        <button class="ghost" type="button" data-editor-action="print">Stampa</button>
      </div>
    </form>
  `;
}

function renderQuotePreview() {
  const quote = getActiveQuote();

  if (!quote) {
    refs.previewTemplateBadge.textContent = "Nessuna selezione";
    refs.quotePreview.innerHTML = emptyState("Anteprima non disponibile", "Seleziona o crea un preventivo per vedere il layout visivo in tempo reale.");
    return;
  }

  const template = getTemplateById(quote.templateId);
  refs.previewTemplateBadge.textContent = template.name;
  refs.quotePreview.innerHTML = `
    <p class="preview-note">Anteprima HTML/CSS. Il PDF reale viene creato solo quando premi "Genera PDF".</p>
    <div class="preview-frame">${buildPreviewMarkup(quote, template)}</div>
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
          <span>Colore superficie</span>
          <input name="surface" type="color" value="${escapeAttribute(template.surface)}">
        </label>
        <label class="field">
          <span>Colore testo</span>
          <input name="text" type="color" value="${escapeAttribute(template.text)}">
        </label>
        <label class="field">
          <span>Etichetta copertina</span>
          <input name="coverLabel" value="${escapeAttribute(template.coverLabel)}">
        </label>
        <label class="field full">
          <span>Testo introduttivo</span>
          <textarea name="introText">${escapeHtml(template.introText)}</textarea>
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

function metricCard(label, value, caption) {
  return `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <span>${caption}</span>
    </article>
  `;
}

function renderPipelineList(quotes) {
  if (!quotes.length) {
    return emptyState("Nessun dato", "Crea il primo preventivo per popolare la dashboard.");
  }

  const total = quotes.length;
  const counts = [
    { label: "Bozze", count: quotes.filter((quote) => quote.status === "draft").length },
    { label: "Inviati", count: quotes.filter((quote) => quote.status === "sent").length },
    { label: "Confermati", count: quotes.filter((quote) => quote.status === "approved").length }
  ];

  return counts.map((item) => `
    <div class="pipeline-row">
      <div class="quote-card-header">
        <strong>${item.label}</strong>
        <span>${item.count}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${total ? (item.count / total) * 100 : 0}%"></div>
      </div>
    </div>
  `).join("");
}

function renderRecentList(quotes) {
  if (!quotes.length) {
    return emptyState("Archivio vuoto", "I preventivi recenti appariranno qui.");
  }

  return sortQuotes(quotes).slice(0, 5).map((quote) => {
    const totals = calculateQuoteTotals(quote);
    return `
      <div class="recent-row">
        <div class="quote-card-header">
          <strong>${escapeHtml(quote.title || quote.number)}</strong>
          <span class="status-chip" data-status="${quote.status}">${statusLabels[quote.status]}</span>
        </div>
        <div class="quote-card-meta">
          <span>${escapeHtml(quote.clientCompany || quote.clientName || "Cliente non indicato")}</span>
          <strong>${formatCurrency(totals.total)}</strong>
        </div>
      </div>
    `;
  }).join("");
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
        <span class="status-chip" data-status="${quote.status}">${statusLabels[quote.status]}</span>
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

function renderLineItemEditor(item) {
  return `
    <div class="line-item" data-item-id="${item.id}">
      <label class="field">
        <span>Descrizione</span>
        <input data-line-field="description" value="${escapeAttribute(item.description)}">
      </label>
      <label class="field">
        <span>Qta</span>
        <input data-line-field="qty" type="number" min="0" step="0.01" value="${item.qty}">
      </label>
      <label class="field">
        <span>Prezzo</span>
        <input data-line-field="unitPrice" type="number" min="0" step="0.01" value="${item.unitPrice}">
      </label>
      <div class="stack">
        <span class="line-total">${formatCurrency(item.qty * item.unitPrice)}</span>
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

function buildPreviewMarkup(quote, template) {
  const totals = calculateQuoteTotals(quote);
  const companyName = state.settings.companyName || "La tua azienda";
  const clientLabel = quote.clientCompany || quote.clientName || "Cliente non specificato";
  const intro = quote.intro || template.introText;
  const lineRows = (quote.items ?? []).filter((item) => item.description || item.qty || item.unitPrice).map((item) => `
    <tr>
      <td>${escapeHtml(item.description || "Voce senza descrizione")}</td>
      <td>${item.qty}</td>
      <td>${formatCurrency(item.unitPrice)}</td>
      <td>${formatCurrency(item.qty * item.unitPrice)}</td>
    </tr>
  `).join("");

  return `
    <article class="preview-sheet template-${template.id}" style="--template-accent:${template.accent}; --template-surface:${template.surface}; --template-text:${template.text};">
      <header class="preview-header">
        <div class="preview-brand">
          <span class="preview-kicker">${escapeHtml(template.coverLabel)}</span>
          <strong>${escapeHtml(companyName)}</strong>
          <span>${escapeHtml(state.settings.email || state.settings.phone || state.settings.website || "Configurazione azienda in impostazioni")}</span>
        </div>
        <div class="preview-meta-grid">
          <div class="preview-meta-item">
            <small>Numero</small>
            <strong>${escapeHtml(quote.number)}</strong>
          </div>
          <div class="preview-meta-item">
            <small>Validita</small>
            <strong>${escapeHtml(quote.validUntil)}</strong>
          </div>
        </div>
      </header>

      <section class="preview-hero">
        <h2>${escapeHtml(quote.title || "Preventivo")}</h2>
        <p>${escapeHtml(intro || "Compila il preventivo dal pannello di modifica per aggiornare questa anteprima.")}</p>
      </section>

      <section class="preview-columns">
        <div class="preview-box">
          <small>Cliente</small>
          <strong>${escapeHtml(clientLabel)}</strong>
          <div class="preview-meta-grid">
            <div class="preview-meta-item">
              <small>Referente</small>
              <strong>${escapeHtml(quote.clientName || "Non indicato")}</strong>
            </div>
            <div class="preview-meta-item">
              <small>Email</small>
              <strong>${escapeHtml(quote.clientEmail || "Non indicata")}</strong>
            </div>
            <div class="preview-meta-item">
              <small>Telefono</small>
              <strong>${escapeHtml(quote.clientPhone || "Non indicato")}</strong>
            </div>
            <div class="preview-meta-item">
              <small>Stato</small>
              <strong>${statusLabels[quote.status]}</strong>
            </div>
          </div>
        </div>

        <aside class="preview-totals">
          <div><small>Subtotale</small><strong>${formatCurrency(totals.subtotal)}</strong></div>
          <div><small>Sconto</small><strong>${quote.discount}%</strong></div>
          <div><small>IVA</small><strong>${quote.vatRate}%</strong></div>
        </aside>
      </section>

      <table class="preview-table">
        <thead>
          <tr>
            <th>Voce</th>
            <th>Qta</th>
            <th>Prezzo</th>
            <th>Totale</th>
          </tr>
        </thead>
        <tbody>
          ${lineRows || `<tr><td colspan="4" class="muted">Aggiungi almeno una riga per mostrare il dettaglio economico.</td></tr>`}
        </tbody>
      </table>

      <div class="preview-totals">
        <div class="preview-total-row"><span>Subtotale</span><strong>${formatCurrency(totals.subtotal)}</strong></div>
        <div class="preview-total-row"><span>Sconto</span><strong>${quote.discount}%</strong></div>
        <div class="preview-total-row"><span>IVA</span><strong>${formatCurrency(totals.vatAmount)}</strong></div>
        <div class="preview-total-row strong"><span>Totale</span><strong>${formatCurrency(totals.total)}</strong></div>
      </div>

      <footer class="preview-footer">
        <div><strong>Pagamento:</strong> ${escapeHtml(quote.paymentTerms || state.settings.paymentTerms)}</div>
        <div><strong>Note:</strong> ${escapeHtml(quote.notes || state.settings.defaultNotes)}</div>
      </footer>
    </article>
  `;
}

async function createQuoteAndOpen() {
  await flushQuoteSave(true);
  const quote = createEmptyQuote(state.settings);
  await persistNewQuote(quote);
  state.activeQuoteId = quote.id;
  state.activeSection = "quotes";
  renderApp();
  showStatus("Nuovo preventivo creato in locale.");
}

async function selectQuote(quoteId) {
  await flushQuoteSave(true);
  state.activeQuoteId = quoteId;
  state.activeSection = "quotes";
  renderQuoteList();
  renderQuoteEditor();
  renderQuotePreview();
}

async function duplicateQuoteById(quoteId) {
  const quote = getQuoteById(quoteId);
  if (!quote) {
    return;
  }

  await flushQuoteSave(true);
  const duplicated = duplicateQuote(quote, state.settings);
  await persistNewQuote(duplicated);
  state.activeQuoteId = duplicated.id;
  state.activeSection = "quotes";
  renderApp();
  showStatus("Preventivo duplicato.");
}

async function deleteQuoteById(quoteId) {
  const quote = getQuoteById(quoteId);
  if (!quote) {
    return;
  }

  const confirmed = window.confirm(`Eliminare il preventivo ${quote.number}?`);
  if (!confirmed) {
    return;
  }

  clearTimeout(timers.quote);
  await deleteRecord(STORES.quotes, quoteId);
  state.quotes = state.quotes.filter((item) => item.id !== quoteId);
  state.activeQuoteId = state.quotes[0]?.id ?? null;
  renderApp();
  showStatus("Preventivo eliminato.");
}

function addLineItemToCurrentQuote() {
  const quote = readQuoteFromForm();
  if (!quote) {
    return;
  }

  quote.items.push(createLineItem());
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
  const items = [...form.querySelectorAll("[data-item-id]")].map((row) => ({
    id: row.dataset.itemId,
    description: row.querySelector('[data-line-field="description"]').value.trim(),
    qty: readNumber(row.querySelector('[data-line-field="qty"]').value, 0),
    unitPrice: readNumber(row.querySelector('[data-line-field="unitPrice"]').value, 0)
  })).filter((item, index, collection) => collection.length === 1 || item.description || item.qty || item.unitPrice);

  return {
    ...activeQuote,
    title: `${formData.get("title") ?? ""}`.trim() || "Nuovo preventivo",
    status: `${formData.get("status") ?? "draft"}`,
    clientName: `${formData.get("clientName") ?? ""}`.trim(),
    clientCompany: `${formData.get("clientCompany") ?? ""}`.trim(),
    clientEmail: `${formData.get("clientEmail") ?? ""}`.trim(),
    clientPhone: `${formData.get("clientPhone") ?? ""}`.trim(),
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
    surface: `${formData.get("surface") ?? activeTemplate.surface}`.trim(),
    text: `${formData.get("text") ?? activeTemplate.text}`.trim(),
    coverLabel: `${formData.get("coverLabel") ?? ""}`.trim(),
    introText: `${formData.get("introText") ?? ""}`.trim()
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
  await flushQuoteSave(false);
  const quote = getActiveQuote();
  const previewNode = document.querySelector(".preview-sheet");
  if (!quote || !previewNode) {
    return;
  }

  try {
    const fileName = `${safeFileName(quote.number || quote.title)}.pdf`;
    const pdfFile = await generatePdfFromNode(previewNode, fileName);
    state.lastSharedPdf = { quoteId: quote.id, file: pdfFile };
    showStatus("PDF generato e scaricato.");
  } catch (error) {
    console.error(error);
    showStatus("Errore durante la generazione del PDF.");
  }
}

async function shareCurrentQuote() {
  await flushQuoteSave(false);
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
  const filtered = state.quotes.filter((quote) => {
    const haystack = [quote.number, quote.title, quote.clientName, quote.clientCompany].join(" ").toLowerCase();
    const matchesSearch = !searchTerm || haystack.includes(searchTerm);
    const matchesStatus = state.filters.status === "all" || quote.status === state.filters.status;
    return matchesSearch && matchesStatus;
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

function readNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatCurrency(value) {
  try {
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: state.settings.currency || "EUR"
    }).format(value || 0);
  } catch {
    return `EUR ${Number(value || 0).toFixed(2)}`;
  }
}

function formatDate(value) {
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

function renderStatusOptions(selectedStatus) {
  return Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${value === selectedStatus ? "selected" : ""}>${label}</option>`).join("");
}

function showStatus(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("is-visible");
  clearTimeout(timers.toast);
  timers.toast = setTimeout(() => {
    refs.toast.classList.remove("is-visible");
  }, 2200);
}

function emptyState(title, description) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p class="muted">${escapeHtml(description)}</p>
    </div>
  `;
}

function safeFileName(value) {
  return `${value || "preventivo"}`.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(value) {
  return `${value ?? ""}`.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
