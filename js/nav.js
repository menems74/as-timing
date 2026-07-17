const LINKS = [
  { href: "index.html", label: "Home" },
  { href: "dipendenti.html", label: "Anagrafica Dipendenti" },
  { href: "calendario.html", label: "Calendario Turni" },
  { href: "ferie.html", label: "Ferie e Permessi" },
];

function currentPage() {
  const path = window.location.pathname.split("/").pop();
  return path === "" ? "index.html" : path;
}

function renderNav() {
  const active = currentPage();
  const placeholder = document.getElementById("nav-placeholder");
  if (!placeholder) return;

  placeholder.innerHTML = `
    <nav class="bg-slate-800 text-white">
      <div class="max-w-6xl mx-auto px-4">
        <div class="flex items-center justify-between h-14">
          <span class="font-bold text-lg">AS Timing</span>
          <div class="flex gap-1 overflow-x-auto">
            ${LINKS.map(
              (l) => `
              <a href="${l.href}"
                 class="px-3 py-2 rounded text-sm whitespace-nowrap transition-colors ${
                   l.href === active
                     ? "bg-slate-600 text-white"
                     : "text-slate-300 hover:bg-slate-700 hover:text-white"
                 }">${l.label}</a>
            `
            ).join("")}
          </div>
        </div>
      </div>
    </nav>
  `;
}

renderNav();
