import { getSession, logout } from "./auth.js?v=21";

const LINKS = [
  { href: "index.html", label: "Home" },
  { href: "calendario.html", label: "Calendario" },
  { href: "ferie.html", label: "Ferie e Permessi", privileged: true },
  { href: "manutenzione.html", label: "Manutenzione DB", privileged: true },
];

const SETTINGS_LINKS = [
  { href: "dipendenti.html", label: "Dipendenti" },
  { href: "reparti.html", label: "Reparti" },
  { href: "generali.html", label: "Generali", separator: true },
];

function currentPage() {
  const path = window.location.pathname.split("/").pop();
  return path === "" ? "index.html" : path;
}

function linkClass(active) {
  return `px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
    active
      ? "bg-gradient-to-r from-teal-500/90 to-cyan-500/90 text-white shadow-sm shadow-teal-900/30"
      : "text-slate-300 hover:bg-white/10 hover:text-white"
  }`;
}

async function renderNav() {
  const session = await getSession();
  if (!session) return; // la pagina stessa reindirizza a login.html via requireSession

  const active = currentPage();
  const placeholder = document.getElementById("nav-placeholder");
  if (!placeholder) return;

  const links = LINKS.filter((l) => !l.privileged || session.privileged);
  const settingsLinks = session.privileged ? SETTINGS_LINKS : [];
  const settingsActive = settingsLinks.some((l) => l.href === active);

  placeholder.innerHTML = `
    <nav class="bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 text-white sticky top-0 z-30 shadow-lg shadow-slate-900/20">
      <div class="max-w-6xl mx-auto px-4">
        <div class="flex flex-wrap items-center justify-between gap-y-1 py-2 min-h-14">
          <a href="index.html" class="flex items-center gap-2 shrink-0">
            <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 text-slate-900 font-black text-sm shadow-inner">AS</span>
            <span class="font-bold text-lg tracking-tight">Timing</span>
          </a>
          <div class="flex flex-wrap gap-1 items-center">
            ${links.map((l) => `<a href="${l.href}" class="${linkClass(l.href === active)}">${l.label}</a>`).join("")}

            ${
              settingsLinks.length
                ? `
            <div class="relative">
              <button id="settings-toggle" type="button" class="${linkClass(settingsActive)} inline-flex items-center gap-1">
                Impostazioni
                <svg id="settings-chevron" class="w-3 h-3 transition-transform" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" /></svg>
              </button>
              <div id="settings-menu" class="hidden absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl ring-1 ring-black/5 overflow-hidden text-slate-700 z-20 py-1">
                ${settingsLinks.map(
                  (l) => `
                  ${l.separator ? '<div class="my-1 border-t border-slate-100"></div>' : ""}
                  <a href="${l.href}" class="block px-4 py-2.5 text-sm hover:bg-teal-50 hover:text-teal-700 transition-colors ${
                    l.href === active ? "bg-teal-50 text-teal-700 font-medium" : ""
                  }">${l.label}</a>
                `
                ).join("")}
              </div>
            </div>`
                : ""
            }

            <div class="ml-2 pl-2 border-l border-white/15 flex items-center gap-2">
              <span class="text-xs text-slate-300 hidden sm:inline">${`${session.nome} ${session.cognome}`.trim()}</span>
              <button id="logout-btn" type="button" class="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-all">Esci</button>
            </div>
          </div>
        </div>
      </div>
      <div class="h-[2px] bg-gradient-to-r from-teal-400 via-cyan-400 to-teal-400 opacity-70"></div>
    </nav>
  `;

  const toggle = document.getElementById("settings-toggle");
  const menu = document.getElementById("settings-menu");
  const chevron = document.getElementById("settings-chevron");

  if (toggle) {
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("hidden");
      chevron.classList.toggle("rotate-180");
    });

    document.addEventListener("click", () => {
      menu.classList.add("hidden");
      chevron.classList.remove("rotate-180");
    });
  }

  document.getElementById("logout-btn").addEventListener("click", logout);
}

renderNav();
