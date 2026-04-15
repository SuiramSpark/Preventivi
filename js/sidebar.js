/**
 * sidebar.js — gestione sidebar collassabile (desktop) e drawer mobile
 *
 * Desktop (> 1080px):
 *   - Bottone toggle nella sidebar per collassare/espandere
 *   - Stato persiste in localStorage
 *
 * Mobile (≤ 1080px):
 *   - Topbar fissa con hamburger button
 *   - Sidebar si apre come drawer laterale con overlay
 *   - Si chiude cliccando overlay, un nav-link, o tasto Escape
 */

const STORAGE_KEY = "sb-collapsed";

export function initSidebar() {
  const sidebar   = document.querySelector("#mainSidebar");
  const appShell  = document.querySelector("#appShell");
  const toggle    = document.querySelector("#sidebarToggle");
  const hamburger = document.querySelector("#hamburgerBtn");
  const overlay   = document.querySelector("#sidebarOverlay");

  if (!sidebar || !appShell || !toggle || !hamburger || !overlay) return;

  // ── Desktop: collapse / expand ──────────────────────────

  function setSidebarCollapsed(collapsed) {
    sidebar.classList.toggle("is-collapsed", collapsed);
    appShell.classList.toggle("sidebar-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    try { localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0"); } catch (_) {}
  }

  toggle.addEventListener("click", () => {
    setSidebarCollapsed(!sidebar.classList.contains("is-collapsed"));
  });

  // Restore on load
  try {
    if (localStorage.getItem(STORAGE_KEY) === "1") setSidebarCollapsed(true);
  } catch (_) {}

  // ── Mobile: open / close drawer ─────────────────────────

  function openMobileSidebar() {
    sidebar.classList.add("is-open");
    overlay.classList.add("is-visible");
    overlay.removeAttribute("aria-hidden");
    hamburger.classList.add("is-active");
    hamburger.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  }

  function closeMobileSidebar() {
    sidebar.classList.remove("is-open");
    overlay.classList.remove("is-visible");
    overlay.setAttribute("aria-hidden", "true");
    hamburger.classList.remove("is-active");
    hamburger.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  hamburger.addEventListener("click", () => {
    sidebar.classList.contains("is-open") ? closeMobileSidebar() : openMobileSidebar();
  });

  overlay.addEventListener("click", closeMobileSidebar);

  // Close on nav-link click (mobile only)
  sidebar.querySelectorAll("[data-section]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (window.innerWidth <= 1080) closeMobileSidebar();
    });
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebar.classList.contains("is-open")) {
      closeMobileSidebar();
    }
  });
}
