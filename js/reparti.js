import {
  getDipendenti,
  getReparti,
  addReparto,
  updateReparto,
  deleteReparto,
  toggleDipendenteReparto,
  MAX_REPARTI,
} from "./mock-data.js?v=8";

const form = document.getElementById("reparto-form");
const nomeField = document.getElementById("nome-reparto");
const coloreField = document.getElementById("colore-reparto");
const maxMsg = document.getElementById("max-reparti-msg");
const list = document.getElementById("reparti-list");

function render() {
  const reparti = getReparti();
  const dipendenti = getDipendenti();

  const atMax = reparti.length >= MAX_REPARTI;
  form.classList.toggle("hidden", atMax);
  maxMsg.classList.toggle("hidden", !atMax);

  if (reparti.length === 0) {
    list.innerHTML = `<p class="text-sm text-slate-500 col-span-full">Nessun reparto creato.</p>`;
    return;
  }

  list.innerHTML = reparti
    .map((r) => {
      const checkboxes = dipendenti
        .map((d) => {
          const checked = r.dipendentiIds.includes(d.id);
          return `
          <label class="flex items-center gap-2 text-sm py-1 cursor-pointer">
            <input type="checkbox" data-reparto="${r.id}" data-dipendente="${d.id}" ${checked ? "checked" : ""}
                   class="rounded border-slate-300" />
            ${d.nome} ${d.cognome}
          </label>
        `;
        })
        .join("");

      return `
        <div class="bg-white rounded-xl shadow p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <input type="color" data-color="${r.id}" value="${r.colore}"
                     class="h-6 w-6 rounded cursor-pointer border border-slate-200 p-0" title="Colore identificativo nel calendario" />
              <h3 class="font-semibold text-slate-800">${r.nome}</h3>
            </div>
            <button data-delete="${r.id}" class="text-red-600 hover:underline text-xs">Elimina</button>
          </div>
          <p class="text-xs text-slate-500 mb-2">Dipendenti abilitati</p>
          ${dipendenti.length === 0 ? '<p class="text-sm text-slate-400">Nessun dipendente in anagrafica.</p>' : checkboxes}
        </div>
      `;
    })
    .join("");
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  addReparto(nomeField.value.trim(), coloreField.value);
  form.reset();
  render();
});

list.addEventListener("click", (e) => {
  const delBtn = e.target.closest("button[data-delete]");
  if (delBtn && confirm("Eliminare questo reparto?")) {
    deleteReparto(delBtn.dataset.delete);
    render();
  }
});

list.addEventListener("change", (e) => {
  const checkbox = e.target.closest("input[type=checkbox][data-reparto]");
  if (checkbox) {
    toggleDipendenteReparto(checkbox.dataset.reparto, checkbox.dataset.dipendente);
    return;
  }

  const colorInput = e.target.closest("input[type=color][data-color]");
  if (colorInput) {
    updateReparto(colorInput.dataset.color, { colore: colorInput.value });
  }
});

render();
