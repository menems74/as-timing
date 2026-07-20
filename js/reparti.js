import { requireSession } from "./auth.js?v=28";
import {
  getDipendenti,
  getReparti,
  addReparto,
  updateReparto,
  deleteReparto,
  toggleDipendenteReparto,
  MAX_REPARTI,
} from "./data.js?v=28";

const session = await requireSession({ requirePrivileged: true });
if (!session) throw new Error("redirect");

const form = document.getElementById("reparto-form");
const nomeField = document.getElementById("nome-reparto");
const coloreField = document.getElementById("colore-reparto");
const list = document.getElementById("reparti-list");

async function render() {
  const reparti = await getReparti();
  const dipendenti = await getDipendenti();

  const atMax = reparti.length >= MAX_REPARTI;
  form.classList.toggle("hidden", atMax);

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
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs text-slate-500">Dipendenti abilitati</p>
            ${dipendenti.length === 0 ? "" : `<button data-select-all="${r.id}" class="text-xs text-blue-800 hover:underline">Seleziona tutti</button>`}
          </div>
          ${dipendenti.length === 0 ? '<p class="text-sm text-slate-400">Nessun dipendente in anagrafica.</p>' : checkboxes}
        </div>
      `;
    })
    .join("");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await addReparto(nomeField.value.trim(), coloreField.value);
    form.reset();
    await render();
  } catch (err) {
    alert("Errore durante la creazione del reparto. Riprova.");
  }
});

list.addEventListener("click", async (e) => {
  const delBtn = e.target.closest("button[data-delete]");
  if (delBtn && confirm("Eliminare questo reparto?")) {
    try {
      await deleteReparto(delBtn.dataset.delete);
      await render();
    } catch (err) {
      alert("Errore durante l'eliminazione del reparto. Riprova.");
    }
    return;
  }

  const selectAllBtn = e.target.closest("button[data-select-all]");
  if (selectAllBtn) {
    try {
      const tuttiIds = (await getDipendenti()).map((d) => d.id);
      await updateReparto(selectAllBtn.dataset.selectAll, { dipendentiIds: tuttiIds });
      await render();
    } catch (err) {
      alert("Errore durante l'aggiornamento del reparto. Riprova.");
    }
  }
});

list.addEventListener("change", async (e) => {
  const checkbox = e.target.closest("input[type=checkbox][data-reparto]");
  if (checkbox) {
    try {
      await toggleDipendenteReparto(checkbox.dataset.reparto, checkbox.dataset.dipendente);
    } catch (err) {
      checkbox.checked = !checkbox.checked; // annulla la spunta: la scrittura non è andata a buon fine
      alert("Errore durante l'aggiornamento del reparto. Riprova.");
    }
    return;
  }

  const colorInput = e.target.closest("input[type=color][data-color]");
  if (colorInput) {
    try {
      await updateReparto(colorInput.dataset.color, { colore: colorInput.value });
    } catch (err) {
      alert("Errore durante l'aggiornamento del colore. Riprova.");
      await render();
    }
  }
});

await render();
