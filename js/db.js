const DB_NAME = "preventivi-local-db";
const DB_VERSION = 1;

export const STORES = {
  quotes: "quotes",
  settings: "settings",
  templates: "templates",
};

export const DEFAULT_SETTINGS = {
  id: "app",
  companyName: "La tua azienda",
  companyVatId: "",
  address: "",
  email: "",
  phone: "",
  website: "",
  defaultVatRate: 22,
  currency: "EUR",
  numberingPrefix: "PREV",
  nextQuoteNumber: 1,
  paymentTerms: "50% all'accettazione, saldo alla consegna.",
  defaultNotes: "Preventivo valido 15 giorni dalla data di emissione.",
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
    measurementId: "",
  },
};

export const DEFAULT_TEMPLATES = [
  {
    id: "word",
    name: "Word",
    description: "Stile sobrio, pulito e documentale per preventivi formali.",
    accent: "#0b5f56",
    surface: "#f7fbfa",
    text: "#1f2f2c",
    coverLabel: "Documento professionale",
    introText: "Proposta economica strutturata, pronta per condivisione e stampa.",
  },
  {
    id: "powerpoint",
    name: "PowerPoint",
    description: "Visuale piu forte, con hero iniziale e tono da presentazione.",
    accent: "#cb7f36",
    surface: "#fff4ea",
    text: "#1f2f2c",
    coverLabel: "Pitch commerciale",
    introText: "Una proposta visiva adatta a presentazioni, meeting e invio rapido.",
  },
];

let databasePromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Errore IndexedDB"));
  });
}

function openDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORES.quotes)) {
        const quoteStore = db.createObjectStore(STORES.quotes, { keyPath: "id" });
        quoteStore.createIndex("updatedAt", "updatedAt", { unique: false });
        quoteStore.createIndex("status", "status", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORES.templates)) {
        db.createObjectStore(STORES.templates, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Impossibile aprire il database locale"));
  });

  return databasePromise;
}

export async function getRecord(storeName, id) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readonly");
  const request = transaction.objectStore(storeName).get(id);
  return requestToPromise(request);
}

export async function getAllRecords(storeName) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readonly");
  const request = transaction.objectStore(storeName).getAll();
  const result = await requestToPromise(request);
  return Array.isArray(result) ? result : [];
}

export async function putRecord(storeName, value) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  const request = transaction.objectStore(storeName).put(value);
  return requestToPromise(request);
}

export async function deleteRecord(storeName, id) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  const request = transaction.objectStore(storeName).delete(id);
  return requestToPromise(request);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDateInput(dateValue) {
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mergeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings ?? {}),
    firebase: {
      ...DEFAULT_SETTINGS.firebase,
      ...(settings?.firebase ?? {}),
    },
  };
}

function mergeTemplate(template, baseTemplate) {
  return {
    ...baseTemplate,
    ...(template ?? {}),
  };
}

export function createLineItem(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    description: "",
    qty: 1,
    unitPrice: 0,
    ...overrides,
  };
}

function normalizeItems(items) {
  const normalized = (items ?? []).map((item) => ({
    id: item.id || crypto.randomUUID(),
    description: item.description ?? "",
    qty: Number(item.qty) || 0,
    unitPrice: Number(item.unitPrice) || 0,
  }));

  return normalized.length ? normalized : [createLineItem()];
}

export function createEmptyQuote(settings, overrides = {}) {
  const safeSettings = mergeSettings(settings);
  const now = new Date();

  return {
    id: crypto.randomUUID(),
    number: `${safeSettings.numberingPrefix}-${now.getFullYear()}-${`${safeSettings.nextQuoteNumber}`.padStart(3, "0")}`,
    title: "Nuovo preventivo",
    clientName: "",
    clientCompany: "",
    clientEmail: "",
    clientPhone: "",
    status: "draft",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    validUntil: formatDateInput(addDays(now, 15)),
    templateId: "word",
    intro: "",
    notes: safeSettings.defaultNotes,
    paymentTerms: safeSettings.paymentTerms,
    vatRate: safeSettings.defaultVatRate,
    discount: 0,
    items: [createLineItem({ description: "Servizio principale" })],
    ...overrides,
    items: normalizeItems(overrides.items),
  };
}

export function duplicateQuote(sourceQuote, settings) {
  return createEmptyQuote(settings, {
    title: sourceQuote.title ? `${sourceQuote.title} copia` : "Copia preventivo",
    clientName: sourceQuote.clientName,
    clientCompany: sourceQuote.clientCompany,
    clientEmail: sourceQuote.clientEmail,
    clientPhone: sourceQuote.clientPhone,
    status: "draft",
    templateId: sourceQuote.templateId,
    intro: sourceQuote.intro,
    notes: sourceQuote.notes,
    paymentTerms: sourceQuote.paymentTerms,
    vatRate: sourceQuote.vatRate,
    discount: sourceQuote.discount,
    items: (sourceQuote.items ?? []).map((item) =>
      createLineItem({
        description: item.description,
        qty: item.qty,
        unitPrice: item.unitPrice,
      }),
    ),
  });
}

export function calculateQuoteTotals(quote) {
  const lines = normalizeItems(quote.items).filter((item) => item.description || item.qty || item.unitPrice);
  const subtotal = lines.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
  const discountRate = Number(quote.discount) || 0;
  const discountedSubtotal = subtotal - (subtotal * discountRate) / 100;
  const vatRate = Number(quote.vatRate) || 0;
  const vatAmount = discountedSubtotal * (vatRate / 100);
  const total = discountedSubtotal + vatAmount;

  return {
    subtotal,
    discountedSubtotal,
    vatAmount,
    total,
    lineCount: lines.length,
  };
}

export async function seedDatabase() {
  const currentSettings = mergeSettings(await getRecord(STORES.settings, DEFAULT_SETTINGS.id));
  await putRecord(STORES.settings, currentSettings);

  const currentTemplates = await getAllRecords(STORES.templates);
  const templatesById = new Map(currentTemplates.map((template) => [template.id, template]));

  for (const template of DEFAULT_TEMPLATES) {
    await putRecord(STORES.templates, mergeTemplate(templatesById.get(template.id), template));
  }

  const quotes = await getAllRecords(STORES.quotes);
  if (!quotes.length) {
    const demoQuote = createEmptyQuote(currentSettings, {
      title: "Restyling sito web",
      clientCompany: "Rossi Impianti",
      clientName: "Marco Rossi",
      clientEmail: "marco@rossi-impianti.it",
      status: "sent",
      templateId: "word",
      intro: "Preventivo per redesign homepage, pagine servizi e ottimizzazione mobile.",
      items: [
        createLineItem({ description: "Analisi iniziale e architettura", qty: 1, unitPrice: 480 }),
        createLineItem({ description: "UI design responsive", qty: 1, unitPrice: 920 }),
        createLineItem({ description: "Sviluppo componenti e consegna", qty: 1, unitPrice: 1240 })
      ]
    });

    await putRecord(STORES.quotes, demoQuote);
    await putRecord(STORES.settings, {
      ...currentSettings,
      nextQuoteNumber: currentSettings.nextQuoteNumber + 1
    });
  }
}
