const DB_NAME = "preventivi-local-db";
const DB_VERSION = 4;

export const STORES = {
  quotes: "quotes",
  settings: "settings",
  templates: "templates",
  companies: "companies",
};

export const DEFAULT_SETTINGS = {
  id: "app",
  companyName: "La tua azienda",
  companyVatId: "",
  address: "",
  email: "",
  phone: "",
  website: "",
  companyPec: "",
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
    description: "Documentale formale, font serif, blu professionale.",
    accent: "#2b5797",
    surface: "#eef3fb",
    text: "#1a2a4a",
  },
  {
    id: "powerpoint",
    name: "PowerPoint",
    description: "Tono energico per presentazioni, arancione vibrante.",
    accent: "#d24726",
    surface: "#fdf3ef",
    text: "#1f2f2c",
  },
  {
    id: "excel",
    name: "Excel",
    description: "Pulito e analitico, verde professionale stile tabellare.",
    accent: "#217346",
    surface: "#f0f7f2",
    text: "#1a2d20",
  },
  {
    id: "rosso",
    name: "Rosso",
    description: "Impatto visivo forte per preventivi urgenti o premium.",
    accent: "#c0392b",
    surface: "#fef3f2",
    text: "#2d1a1a",
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

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      if (!db.objectStoreNames.contains(STORES.quotes)) {
        const quoteStore = db.createObjectStore(STORES.quotes, { keyPath: "id" });
        quoteStore.createIndex("updatedAt", "updatedAt", { unique: false });
        quoteStore.createIndex("status", "status", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: "id" });
      }

      // v3/v4: delete templates store so seedDatabase re-seeds with new default colors/structure
      if (oldVersion < 4 && db.objectStoreNames.contains(STORES.templates)) {
        db.deleteObjectStore(STORES.templates);
      }
      if (!db.objectStoreNames.contains(STORES.templates)) {
        db.createObjectStore(STORES.templates, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORES.companies)) {
        db.createObjectStore(STORES.companies, { keyPath: "id" });
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

export function createEmptyCompany(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: "",
    vatId: "",
    pec: "",
    address: "",
    email: "",
    phone: "",
    website: "",
    logo: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createLineItem(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    description: "",
    qty: 1,
    unitPrice: 0,
    vatRate: null,          // null = eredita l'aliquota del preventivo
    lineDiscount: 0,        // sconto sulla voce
    lineDiscountType: "percent", // "percent" | "fixed"
    ...overrides,
  };
}

function normalizeItems(items) {
  const normalized = (items ?? []).map((item) => ({
    id: item.id || crypto.randomUUID(),
    description: item.description ?? "",
    qty: Number(item.qty) || 0,
    unitPrice: Number(item.unitPrice) || 0,
    vatRate: item.vatRate != null ? Number(item.vatRate) : null,
    lineDiscount: Number(item.lineDiscount) || 0,
    lineDiscountType: item.lineDiscountType === "fixed" ? "fixed" : "percent",
  }));

  return normalized.length ? normalized : [createLineItem()];
}

/** Calcola tutti i valori economici di una singola riga */
export function calculateLineItem(item, defaultVat = 0) {
  const qty       = Number(item.qty) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const imponibile = qty * unitPrice;

  const discountVal  = Number(item.lineDiscount) || 0;
  const discountType = item.lineDiscountType === "fixed" ? "fixed" : "percent";
  const lineDiscountAmount = discountType === "fixed"
    ? Math.min(discountVal, imponibile)
    : imponibile * (discountVal / 100);

  const imponibileNetto = imponibile - lineDiscountAmount;
  const vatRate         = item.vatRate != null ? Number(item.vatRate) : defaultVat;
  const ivaImporto      = imponibileNetto * (vatRate / 100);
  const totaleVoce      = imponibileNetto + ivaImporto;

  return { qty, unitPrice, imponibile, discountVal, discountType, lineDiscountAmount, imponibileNetto, vatRate, ivaImporto, totaleVoce };
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
    clientVatId: "",
    clientAddress: "",
    clientPec: "",
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
    issuingCompanyId: null,
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
    clientVatId: sourceQuote.clientVatId ?? "",
    clientAddress: sourceQuote.clientAddress ?? "",
    clientPec: sourceQuote.clientPec ?? "",
    clientEmail: sourceQuote.clientEmail,
    clientPhone: sourceQuote.clientPhone,
    status: "draft",
    templateId: sourceQuote.templateId,
    intro: sourceQuote.intro,
    notes: sourceQuote.notes,
    paymentTerms: sourceQuote.paymentTerms,
    vatRate: sourceQuote.vatRate,
    discount: sourceQuote.discount,
    issuingCompanyId: sourceQuote.issuingCompanyId ?? null,
    items: (sourceQuote.items ?? []).map((item) =>
      createLineItem({
        description: item.description,
        qty: item.qty,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate ?? null,
        lineDiscount: item.lineDiscount ?? 0,
        lineDiscountType: item.lineDiscountType ?? "percent",
      }),
    ),
  });
}

export function calculateQuoteTotals(quote) {
  const defaultVat = Number(quote.vatRate) || 0;

  const lines = normalizeItems(quote.items).filter(
    (item) => item.description || item.qty || item.unitPrice
  );

  const calcs = lines.map(item => calculateLineItem(item, defaultVat));

  const subtotal           = calcs.reduce((s, c) => s + c.imponibile,       0);
  const totalDiscount      = calcs.reduce((s, c) => s + c.lineDiscountAmount, 0);
  const discountedSubtotal = calcs.reduce((s, c) => s + c.imponibileNetto,   0);
  const discountPercent    = subtotal > 0 ? (totalDiscount / subtotal) * 100 : 0;

  // Raggruppa IVA per aliquota
  const vatMap = new Map();
  for (const c of calcs) {
    const prev = vatMap.get(c.vatRate) ?? { amount: 0, base: 0 };
    vatMap.set(c.vatRate, { amount: prev.amount + c.ivaImporto, base: prev.base + c.imponibileNetto });
  }
  if (!vatMap.size) vatMap.set(defaultVat, { amount: 0, base: 0 });

  const vatGroups = [...vatMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, { amount, base }]) => ({ rate, amount, base }));

  const vatAmount = vatGroups.reduce((s, g) => s + g.amount, 0);
  const total     = discountedSubtotal + vatAmount;

  return {
    subtotal,
    totalDiscount,
    discountPercent,
    discountedSubtotal,
    vatGroups,
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

  // Migra: crea azienda di default dai settings se non ce ne sono ancora
  const existingCompanies = await getAllRecords(STORES.companies);
  if (!existingCompanies.length) {
    const defaultCompany = createEmptyCompany({
      id: "company-default",
      name: currentSettings.companyName || "",
      vatId: currentSettings.companyVatId || "",
      pec: currentSettings.companyPec || "",
      address: currentSettings.address || "",
      email: currentSettings.email || "",
      phone: currentSettings.phone || "",
      website: currentSettings.website || "",
    });
    await putRecord(STORES.companies, defaultCompany);
  }
}
