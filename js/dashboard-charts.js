/**
 * dashboard-charts.js — render dei 6 grafici neon glow.
 * Chart.js viene caricato via dynamic import (lazy) per il code-splitting.
 */

// Palette
const PALETTE = {
  greenBrand: "#0b5f56",
  greenNeon:  "#2dd4bf",
  orangeBrand:"#c77b2e",
  orangeNeon: "#f4a261",
  magenta:    "#e879c5",
  cyan:       "#67e8f9",
  beige:      "#f6f0e6",
  textMain:   "#d4e7e3",
  muted:      "rgba(212, 231, 227, 0.5)",
  grid:       "rgba(255, 255, 255, 0.04)",
};

let _chartPromise = null;
function loadChart() {
  if (!_chartPromise) {
    _chartPromise = import("chart.js/auto").then((mod) => mod.Chart || mod.default);
  }
  return _chartPromise;
}

// Distrugge chart precedenti collegati a un canvas (evita memory leak su re-render)
const _registry = new WeakMap();
function attachChart(canvas, chart) {
  const prev = _registry.get(canvas);
  if (prev) {
    try { prev.destroy(); } catch {}
  }
  _registry.set(canvas, chart);
}

function fmtEuro(value) {
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value || 0);
  } catch {
    return `€ ${Math.round(value || 0)}`;
  }
}

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/* ============================================================
   1. Ring counter doppio (SVG, no Chart.js)
   ============================================================ */
export function renderRingCounters(container, { totalQuotes, totalClients }) {
  if (!container) return;

  const ring = (value, label, colorVar, max) => {
    const radius = 55;
    const circumference = 2 * Math.PI * radius;
    // "fill" proporzionale: se max=0 mostra anello vuoto, altrimenti percentuale clamp
    const ratio = max > 0 ? Math.min(value / max, 1) : (value > 0 ? 1 : 0);
    const offset = circumference * (1 - ratio);

    return `
      <div class="ring-counter">
        <div class="ring-counter-wrap">
          <svg class="ring-counter-svg" viewBox="0 0 130 130" aria-hidden="true">
            <circle class="ring-counter-track" cx="65" cy="65" r="${radius}"></circle>
            <circle class="ring-counter-fill ring-counter-fill--${colorVar}"
                    cx="65" cy="65" r="${radius}"
                    stroke-dasharray="${circumference}"
                    stroke-dashoffset="${offset}"></circle>
          </svg>
          <div class="ring-counter-number">
            <strong>${value}</strong>
            <span>${escapeHtml(label.toUpperCase())}</span>
          </div>
        </div>
        <div class="ring-counter-label">${escapeHtml(label)}</div>
      </div>`;
  };

  // max usato per dimensionare l'arco "pieno" — usa il piu grande dei due
  const maxRef = Math.max(totalQuotes, totalClients, 1);

  container.innerHTML = `
    <div class="chart-card-header">
      <div class="chart-card-titlebox">
        <p class="chart-card-title">Riepilogo</p>
        <h3 class="chart-card-value">Archivio</h3>
        <p class="chart-card-sub">Totale preventivi e clienti unici</p>
      </div>
    </div>
    <div class="chart-card-body chart-card-body--ring">
      ${ring(totalQuotes,  "Preventivi", "green",  maxRef)}
      ${ring(totalClients, "Clienti",    "orange", maxRef)}
    </div>
  `;
}

/* ============================================================
   2. Multi-line trend (Chart.js)
   ============================================================ */
export async function renderMultiLineTrend(container, { labels, paid, confirmedApproved, sentDraft }) {
  if (!container) return;

  container.innerHTML = `
    <div class="chart-card-header">
      <div class="chart-card-titlebox">
        <p class="chart-card-title">Andamento valori</p>
        <h3 class="chart-card-value">Trend per stato</h3>
        <p class="chart-card-sub">Ultimi 12 mesi · valori totali (€)</p>
      </div>
    </div>
    <div class="chart-card-body"><canvas></canvas></div>
  `;

  const total = paid.concat(confirmedApproved, sentDraft).reduce((s, v) => s + v, 0);
  if (total === 0) {
    container.querySelector(".chart-card-body").innerHTML = `<div class="chart-empty">Nessun dato ancora.<br>Crea preventivi per vedere il trend.</div>`;
    return;
  }

  const Chart = await loadChart();
  const canvas = container.querySelector("canvas");
  const ctx = canvas.getContext("2d");

  const baseDs = {
    tension: 0.4,
    borderWidth: 2.5,
    pointRadius: 0,
    pointHoverRadius: 5,
    fill: false,
  };

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { ...baseDs, label: "Pagati",                 data: paid,              borderColor: PALETTE.greenNeon,  pointBackgroundColor: PALETTE.greenNeon },
        { ...baseDs, label: "Confermati + Approvati", data: confirmedApproved, borderColor: PALETTE.orangeNeon, pointBackgroundColor: PALETTE.orangeNeon },
        { ...baseDs, label: "Inviati + Bozze",        data: sentDraft,         borderColor: PALETTE.magenta,    pointBackgroundColor: PALETTE.magenta },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: { color: PALETTE.textMain, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } },
        },
        tooltip: {
          backgroundColor: "#052420",
          borderColor: "rgba(46, 213, 191, 0.3)",
          borderWidth: 1,
          titleColor: PALETTE.beige,
          bodyColor: PALETTE.textMain,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtEuro(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: {
          grid: { color: PALETTE.grid, drawBorder: false },
          ticks: { color: PALETTE.muted, font: { size: 10 } },
        },
        y: {
          grid: { color: PALETTE.grid, drawBorder: false },
          ticks: { color: PALETTE.muted, font: { size: 10 }, callback: (v) => fmtEuro(v) },
        },
      },
    },
  });

  attachChart(canvas, chart);
}

/* ============================================================
   3. Area volume mensile (Chart.js)
   ============================================================ */
export async function renderAreaVolume(container, { labels, counts }) {
  if (!container) return;

  const total = counts.reduce((s, v) => s + v, 0);

  container.innerHTML = `
    <div class="chart-card-header">
      <div class="chart-card-titlebox">
        <p class="chart-card-title">Volume mensile</p>
        <h3 class="chart-card-value">${total} preventivi</h3>
        <p class="chart-card-sub">Ultimi 12 mesi · n° creati</p>
      </div>
    </div>
    <div class="chart-card-body"><canvas></canvas></div>
  `;

  if (total === 0) {
    container.querySelector(".chart-card-body").innerHTML = `<div class="chart-empty">Nessun preventivo ancora creato.</div>`;
    return;
  }

  const Chart = await loadChart();
  const canvas = container.querySelector("canvas");
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 220);
  gradient.addColorStop(0, "rgba(45, 212, 191, 0.45)");
  gradient.addColorStop(1, "rgba(45, 212, 191, 0.0)");

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Preventivi",
        data: counts,
        borderColor: PALETTE.greenNeon,
        backgroundColor: gradient,
        borderWidth: 2.5,
        tension: 0.4,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointBackgroundColor: PALETTE.greenNeon,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#052420",
          borderColor: "rgba(46, 213, 191, 0.3)",
          borderWidth: 1,
          titleColor: PALETTE.beige,
          bodyColor: PALETTE.textMain,
          callbacks: { label: (ctx) => `${ctx.parsed.y} preventivi` },
        },
      },
      scales: {
        x: { grid: { color: PALETTE.grid, drawBorder: false }, ticks: { color: PALETTE.muted, font: { size: 10 } } },
        y: { grid: { color: PALETTE.grid, drawBorder: false }, ticks: { color: PALETTE.muted, font: { size: 10 }, precision: 0 }, beginAtZero: true },
      },
    },
  });

  attachChart(canvas, chart);
}

/* ============================================================
   4. Donut % pagati (Chart.js + overlay HTML al centro)
   ============================================================ */
export async function renderDonutPaid(container, { paidCount, totalCount }) {
  if (!container) return;

  const pct = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0;

  container.innerHTML = `
    <div class="chart-card-header">
      <div class="chart-card-titlebox">
        <p class="chart-card-title">Tasso di incasso</p>
        <h3 class="chart-card-value">Pagati</h3>
        <p class="chart-card-sub">${paidCount} su ${totalCount} preventivi</p>
      </div>
    </div>
    <div class="chart-card-body">
      <canvas></canvas>
      <div class="donut-center"><strong>${pct}%</strong><span>Pagati</span></div>
    </div>
  `;

  if (totalCount === 0) {
    container.querySelector(".chart-card-body").innerHTML = `<div class="chart-empty">Nessun dato ancora.</div>`;
    return;
  }

  const Chart = await loadChart();
  const canvas = container.querySelector("canvas");
  const ctx = canvas.getContext("2d");

  const chart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Pagati", "Altri stati"],
      datasets: [{
        data: [paidCount, Math.max(totalCount - paidCount, 0)],
        backgroundColor: [PALETTE.orangeBrand, "rgba(255, 255, 255, 0.08)"],
        borderColor: ["rgba(244, 162, 97, 0.5)", "rgba(255, 255, 255, 0.05)"],
        borderWidth: 1,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#052420",
          borderColor: "rgba(244, 162, 97, 0.4)",
          borderWidth: 1,
          titleColor: PALETTE.beige,
          bodyColor: PALETTE.textMain,
        },
      },
    },
  });

  attachChart(canvas, chart);
}

/* ============================================================
   5. Bar verticali top template (Chart.js)
   ============================================================ */
export async function renderBarTemplates(container, items) {
  if (!container) return;

  container.innerHTML = `
    <div class="chart-card-header">
      <div class="chart-card-titlebox">
        <p class="chart-card-title">Template piu usati</p>
        <h3 class="chart-card-value">Distribuzione</h3>
        <p class="chart-card-sub">N° preventivi per template</p>
      </div>
    </div>
    <div class="chart-card-body"><canvas></canvas></div>
  `;

  const total = items.reduce((s, it) => s + it.count, 0);
  if (total === 0) {
    container.querySelector(".chart-card-body").innerHTML = `<div class="chart-empty">Nessun template usato ancora.</div>`;
    return;
  }

  const Chart = await loadChart();
  const canvas = container.querySelector("canvas");
  const ctx = canvas.getContext("2d");

  const labels = items.map((it) => it.name);
  const data   = items.map((it) => it.count);
  const colors = items.map((it) => it.color || PALETTE.greenNeon);

  // Backgrounds con leggera trasparenza per effetto neon (border colore pieno)
  const backgrounds = colors.map((c) => `${c}cc`);

  const chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Preventivi",
        data,
        backgroundColor: backgrounds,
        borderColor: colors,
        borderWidth: 1.5,
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 60,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#052420",
          borderColor: "rgba(46, 213, 191, 0.3)",
          borderWidth: 1,
          titleColor: PALETTE.beige,
          bodyColor: PALETTE.textMain,
          callbacks: { label: (ctx) => `${ctx.parsed.y} preventivi` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: PALETTE.muted, font: { size: 11 } } },
        y: { grid: { color: PALETTE.grid, drawBorder: false }, ticks: { color: PALETTE.muted, font: { size: 10 }, precision: 0 }, beginAtZero: true },
      },
    },
  });

  attachChart(canvas, chart);
}

/* ============================================================
   6. Progress bar orizzontali top clienti (HTML/CSS, no Chart.js)
   ============================================================ */
export function renderTopClientsBars(container, items) {
  if (!container) return;

  container.innerHTML = `
    <div class="chart-card-header">
      <div class="chart-card-titlebox">
        <p class="chart-card-title">Top clienti</p>
        <h3 class="chart-card-value">Fatturato</h3>
        <p class="chart-card-sub">Top 5 per valore complessivo (€)</p>
      </div>
    </div>
    <div class="chart-card-body"></div>
  `;

  const body = container.querySelector(".chart-card-body");

  if (!items.length) {
    body.innerHTML = `<div class="chart-empty">Nessun cliente ancora.</div>`;
    return;
  }

  const max = items[0]?.total || 1;

  body.innerHTML = `
    <div class="top-clients-list">
      ${items.map((c) => {
        const pct = Math.max(Math.round((c.total / max) * 100), 4);
        return `
          <div class="top-client-row">
            <div class="top-client-fill" style="width:${pct}%"></div>
            <span class="top-client-name">${escapeHtml(c.name)}</span>
            <span class="top-client-value">${fmtEuro(c.total)}<span class="top-client-count">${c.count} prev.</span></span>
          </div>`;
      }).join("")}
    </div>
  `;
}

/* ============================================================
   Aggregazioni (helpers)
   ============================================================ */

/** Ritorna { labels, byStatus: {paid, confirmedApproved, sentDraft}, counts } per ultimi 12 mesi */
export function aggregateQuotesByMonth(quotesWithTotals) {
  const now = new Date();
  const buckets = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      year:  d.getFullYear(),
      month: d.getMonth(),
      label: d.toLocaleDateString("it-IT", { month: "short" }),
      paid: 0,
      confirmedApproved: 0,
      sentDraft: 0,
      count: 0,
    });
  }

  for (const { q, t } of quotesWithTotals) {
    const d = new Date(q.createdAt || q.updatedAt);
    const idx = buckets.findIndex((b) => b.year === d.getFullYear() && b.month === d.getMonth());
    if (idx < 0) continue;
    buckets[idx].count++;
    const val = t.total || 0;
    if (q.status === "paid") buckets[idx].paid += val;
    else if (q.status === "confirmed" || q.status === "approved") buckets[idx].confirmedApproved += val;
    else if (q.status === "sent" || q.status === "draft") buckets[idx].sentDraft += val;
  }

  return {
    labels: buckets.map((b) => b.label),
    paid:              buckets.map((b) => b.paid),
    confirmedApproved: buckets.map((b) => b.confirmedApproved),
    sentDraft:         buckets.map((b) => b.sentDraft),
    counts:            buckets.map((b) => b.count),
  };
}

/** Raggruppa per cliente, ritorna array ordinato desc per total. Limit opzionale */
export function groupQuotesByClient(quotesWithTotals, limit = 5) {
  const map = new Map();
  for (const { q, t } of quotesWithTotals) {
    const name = (q.clientCompany || q.clientName || "—").trim() || "—";
    const prev = map.get(name) ?? { name, total: 0, count: 0 };
    map.set(name, { name, total: prev.total + (t.total || 0), count: prev.count + 1 });
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

/** Conta clienti unici (clientCompany || clientName) */
export function countUniqueClients(quotes) {
  const set = new Set();
  for (const q of quotes) {
    const key = (q.clientCompany || q.clientName || "").trim();
    if (key) set.add(key);
  }
  return set.size;
}

/** Raggruppa per template, ritorna array { id, name, color, count } limit 5 */
export function groupQuotesByTemplate(quotes, templates, limit = 5) {
  const tplById = new Map(templates.map((t) => [t.id, t]));
  const map = new Map();
  for (const q of quotes) {
    const id = q.templateId || "—";
    const prev = map.get(id) ?? 0;
    map.set(id, prev + 1);
  }
  const arr = [...map.entries()].map(([id, count]) => {
    const tpl = tplById.get(id);
    return {
      id,
      name:  tpl?.name  || id,
      color: tpl?.accent || PALETTE.greenNeon,
      count,
    };
  });
  return arr.sort((a, b) => b.count - a.count).slice(0, limit);
}
