const LINKS = [
  { href: "index.html", label: "Home" },
  { href: "calendario.html", label: "Calendario Turni" },
  { href: "ferie.html", label: "Ferie e Permessi" },
];

const SETTINGS_LINKS = [
  { href: "dipendenti.html", label: "Anagrafica Dipendenti" },
  { href: "reparti.html", label: "Reparti" },
];

function currentPage() {
  const path = window.location.pathname.split("/").pop();
  return path === "" ? "index.html" : path;
}

function linkClass(active) {
  return `px-3 py-2 rounded text-sm whitespace-nowrap transition-colors ${
    active ? "bg-slate-600 text-white" : "text-slate-300 hover:bg-slate-700 hover:text-white"
  }`;
}

function renderNav() {
  const active = currentPage();
  const placeholder = document.getElementById("nav-placeholder");
  if (!placeholder) return;

  const settingsActive = SETTINGS_LINKS.some((l) => l.href === active);

  placeholder.innerHTML = `
    <nav class="bg-slate-800 text-white relative">
      <div class="max-w-6xl mx-auto px-4">
        <div class="flex items-center justify-between h-14">
          <span class="font-bold text-lg">AS Timing</span>
          <div class="flex gap-1 overflow-x-auto items-center">
            ${LINKS.map((l) => `<a href="${l.href}" class="${linkClass(l.href === active)}">${l.label}</a>`).join("")}

            <div class="relative">
              <button id="settings-toggle" type="button" class="${linkClass(settingsActive)} inline-flex items-center gap-1">
                Impostazioni
                <svg class="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" /></svg>
              </button>
              <div id="settings-menu" class="hidden absolute right-0 mt-1 w-56 bg-white rounded shadow-lg overflow-hidden text-slate-700 z-20">
                ${SETTINGS_LINKS.map(
                  (l) => `
                  <a href="${l.href}" class="block px-4 py-2 text-sm hover:bg-slate-100 ${
                    l.href === active ? "bg-slate-100 font-medium" : ""
                  }">${l.label}</a>
                `
                ).join("")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  `;

  const toggle = document.getElementById("settings-toggle");
  const menu = document.getElementById("settings-menu");

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  });

  document.addEventListener("click", () => menu.classList.add("hidden"));
}

renderNav();
