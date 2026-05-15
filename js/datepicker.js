/**
 * datepicker.js — calendario custom moderno per tutti gli <input type="date"> dell'app.
 * 3 viste navigabili: giorni → mesi → anni. Locale italiano, lunedi primo giorno.
 * Si attacca automaticamente via event delegation, anche agli input creati dopo l'init.
 */

const MONTHS_IT = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];
const MONTHS_SHORT_IT = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
const WEEKDAYS_IT = ["Lu","Ma","Me","Gi","Ve","Sa","Do"];

let activePicker = null;
let installed = false;

export function installDatePicker() {
  if (installed) return;
  installed = true;

  // Apri il custom picker quando l'utente prova a interagire con un input type=date
  document.addEventListener("mousedown", (event) => {
    const input = event.target.closest('input[type="date"]');
    if (!input) return;
    event.preventDefault();
    if (activePicker?.input === input) {
      closeDatePicker();
    } else {
      input.focus({ preventScroll: true });
      openDatePicker(input);
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activePicker) closeDatePicker();
    const input = event.target.closest?.('input[type="date"]');
    if (!input) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDatePicker(input);
    }
  });

  window.addEventListener("scroll", () => closeDatePicker(), true);
  window.addEventListener("resize", () => closeDatePicker());
}

function openDatePicker(input) {
  closeDatePicker();

  const state = {
    input,
    selected: parseInputDate(input.value),
    view: "days",            // "days" | "months" | "years"
    viewYear: 0,
    viewMonth: 0,
    yearRangeStart: 0,
  };
  const seed = state.selected || new Date();
  state.viewYear = seed.getFullYear();
  state.viewMonth = seed.getMonth();
  state.yearRangeStart = Math.floor(state.viewYear / 12) * 12;

  const popover = document.createElement("div");
  popover.className = "dp-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Selezione data");
  document.body.appendChild(popover);

  positionPopover(popover, input);

  state.popover = popover;
  state.render = () => {
    popover.innerHTML = renderView(state);
    attachActions(state);
  };
  state.render();

  const onOutsideClick = (event) => {
    if (popover.contains(event.target) || event.target === input) return;
    closeDatePicker();
  };
  state.onOutsideClick = onOutsideClick;
  setTimeout(() => {
    document.addEventListener("mousedown", onOutsideClick, true);
  }, 0);

  activePicker = state;
}

function closeDatePicker() {
  if (!activePicker) return;
  document.removeEventListener("mousedown", activePicker.onOutsideClick, true);
  activePicker.popover.remove();
  activePicker = null;
}

function renderView(state) {
  if (state.view === "months") return renderMonthsView(state);
  if (state.view === "years")  return renderYearsView(state);
  return renderDaysView(state);
}

function renderDaysView(state) {
  const { viewYear, viewMonth, selected } = state;
  const today = new Date();

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startCol = (firstOfMonth.getDay() + 6) % 7; // 0 = Lun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();

  const cells = [];
  for (let i = startCol - 1; i >= 0; i--) {
    cells.push({ label: daysInPrev - i, muted: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(viewYear, viewMonth, d);
    cells.push({
      label: d,
      muted: false,
      isToday: sameDay(date, today),
      isSelected: selected && sameDay(date, selected),
      day: d,
    });
  }
  while (cells.length < 42) {
    cells.push({ label: cells.length - daysInMonth - startCol + 1, muted: true });
  }

  const dayCells = cells.map((cell) => {
    if (cell.muted) return `<button type="button" class="dp-day is-muted" tabindex="-1" data-dp="noop">${cell.label}</button>`;
    const classes = ["dp-day"];
    if (cell.isToday) classes.push("is-today");
    if (cell.isSelected) classes.push("is-selected");
    return `<button type="button" class="${classes.join(" ")}" data-dp="select-day" data-day="${cell.day}">${cell.label}</button>`;
  }).join("");

  return `
    <div class="dp-header">
      <button type="button" class="dp-nav" data-dp="prev-month" aria-label="Mese precedente">‹</button>
      <button type="button" class="dp-title" data-dp="open-months">
        <span>${MONTHS_IT[viewMonth]}</span>
        <span class="dp-title-year">${viewYear}</span>
      </button>
      <button type="button" class="dp-nav" data-dp="next-month" aria-label="Mese successivo">›</button>
    </div>
    <div class="dp-weekdays">${WEEKDAYS_IT.map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="dp-grid dp-grid-days">${dayCells}</div>
    <div class="dp-footer">
      <button type="button" class="dp-foot-btn" data-dp="clear">Cancella</button>
      <button type="button" class="dp-foot-btn dp-foot-btn--primary" data-dp="today">Oggi</button>
    </div>
  `;
}

function renderMonthsView(state) {
  const { viewYear, viewMonth, selected } = state;
  const months = MONTHS_SHORT_IT.map((name, i) => {
    const isCurrent = i === viewMonth;
    const isSelected = selected && selected.getFullYear() === viewYear && selected.getMonth() === i;
    const classes = ["dp-cell"];
    if (isCurrent) classes.push("is-current");
    if (isSelected) classes.push("is-selected");
    return `<button type="button" class="${classes.join(" ")}" data-dp="select-month" data-month="${i}">${name}</button>`;
  }).join("");

  return `
    <div class="dp-header">
      <button type="button" class="dp-nav" data-dp="prev-year" aria-label="Anno precedente">‹</button>
      <button type="button" class="dp-title" data-dp="open-years">${viewYear}</button>
      <button type="button" class="dp-nav" data-dp="next-year" aria-label="Anno successivo">›</button>
    </div>
    <div class="dp-grid dp-grid-months">${months}</div>
  `;
}

function renderYearsView(state) {
  const { yearRangeStart, viewYear, selected } = state;
  const selectedYear = selected?.getFullYear();
  const cells = [];
  for (let y = yearRangeStart; y < yearRangeStart + 12; y++) {
    const classes = ["dp-cell"];
    if (y === viewYear) classes.push("is-current");
    if (y === selectedYear) classes.push("is-selected");
    cells.push(`<button type="button" class="${classes.join(" ")}" data-dp="select-year" data-year="${y}">${y}</button>`);
  }

  return `
    <div class="dp-header">
      <button type="button" class="dp-nav" data-dp="prev-year-range" aria-label="Decennio precedente">‹</button>
      <span class="dp-title dp-title--static">${yearRangeStart}–${yearRangeStart + 11}</span>
      <button type="button" class="dp-nav" data-dp="next-year-range" aria-label="Decennio successivo">›</button>
    </div>
    <div class="dp-grid dp-grid-years">${cells.join("")}</div>
  `;
}

function attachActions(state) {
  state.popover.querySelectorAll("[data-dp]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      handleAction(state, btn.dataset.dp, btn.dataset);
    });
  });
}

function handleAction(state, action, dataset) {
  switch (action) {
    case "prev-month":
      state.viewMonth--;
      if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
      break;
    case "next-month":
      state.viewMonth++;
      if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
      break;
    case "prev-year": state.viewYear--; break;
    case "next-year": state.viewYear++; break;
    case "prev-year-range": state.yearRangeStart -= 12; break;
    case "next-year-range": state.yearRangeStart += 12; break;
    case "open-months": state.view = "months"; break;
    case "open-years":
      state.view = "years";
      state.yearRangeStart = Math.floor(state.viewYear / 12) * 12;
      break;
    case "select-month":
      state.viewMonth = Number(dataset.month);
      state.view = "days";
      break;
    case "select-year":
      state.viewYear = Number(dataset.year);
      state.view = "months";
      break;
    case "select-day":
      state.selected = new Date(state.viewYear, state.viewMonth, Number(dataset.day));
      commitSelection(state);
      return;
    case "today":
      state.selected = new Date();
      state.viewYear = state.selected.getFullYear();
      state.viewMonth = state.selected.getMonth();
      commitSelection(state);
      return;
    case "clear":
      state.selected = null;
      commitSelection(state);
      return;
    case "noop":
      return;
  }
  state.render();
}

function commitSelection(state) {
  state.input.value = state.selected ? formatDateIso(state.selected) : "";
  state.input.dispatchEvent(new Event("input", { bubbles: true }));
  state.input.dispatchEvent(new Event("change", { bubbles: true }));
  closeDatePicker();
}

function positionPopover(popover, input) {
  const rect = input.getBoundingClientRect();
  const popWidth = 300;
  const popHeight = 360;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + popWidth > window.innerWidth - 8) left = window.innerWidth - popWidth - 8;
  if (left < 8) left = 8;
  if (top + popHeight > window.innerHeight - 8 && rect.top - popHeight - 6 > 8) {
    top = rect.top - popHeight - 6;
  }
  popover.style.position = "fixed";
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.zIndex = "10000";
}

function parseInputDate(value) {
  if (!value) return null;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDateIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}
