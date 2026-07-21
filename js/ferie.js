import { requireSession } from "./auth.js?v=42";
import { getDipendenti, getFerie, addFerie, deleteFerie } from "./data.js?v=42";

const session = await requireSession({ requirePrivileged: true });
if (!session) throw new Error("redirect");

const form = document.getElementById("ferie-form");
const dipendenteSelect = document.getElementById("dipendente-id");
const tipoField = document.getElementById("tipo");
const dataInizioField = document.getElementById("data-inizio");
const dataFineField = document.getElementById("data-fine");
const noteField = document.getElementById("note");
const tbody = document.getElementById("ferie-tbody");

const TIPO_LABEL = { ferie: "Ferie", permesso: "Permesso" };
const TIPO_BADGE = {
  ferie: "bg-orange-100 text-orange-700",
  permesso: "bg-purple-100 text-purple-700",
};

function dipendentiById(dipendenti) {
  return Object.fromEntries(dipendenti.map((d) => [d.id, d]));
}

function renderDipendentiOptions(dipendenti) {
  const selezionato = dipendenteSelect.value;
  dipendenteSelect.innerHTML = dipendenti.map((d) => `<option value="${d.id}">${d.nome} ${d.cognome}</option>`).join("");
  if (dipendenti.some((d) => d.id === selezionato)) dipendenteSelect.value = selezionato;
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Ricarica sempre i dipendenti (non solo all'avvio): se un dipendente viene
// aggiunto o eliminato altrove, questa pagina resta comunque coerente.
async function render() {
  const dipendenti = await getDipendenti();
  renderDipendentiOptions(dipendenti);
  const byId = dipendentiById(dipendenti);
  const ferie = await getFerie();

  tbody.innerHTML = ferie
    .map((f) => {
      const dip = byId[f.dipendenteId];
      const nomeDip = dip ? `${dip.nome} ${dip.cognome}` : "(dipendente rimosso)";
      return `
      <tr>
        <td class="px-4 py-3">${nomeDip}</td>
        <td class="px-4 py-3">
          <span class="px-2 py-1 rounded-full text-xs font-medium ${TIPO_BADGE[f.tipo]}">
            ${TIPO_LABEL[f.tipo]}
          </span>
        </td>
        <td class="px-4 py-3">${formatDate(f.dataInizio)}</td>
        <td class="px-4 py-3">${formatDate(f.dataFine)}</td>
        <td class="px-4 py-3 text-slate-500">${f.note || "—"}</td>
        <td class="px-4 py-3 text-right">
          <button data-id="${f.id}" class="text-red-600 hover:underline text-xs">Elimina</button>
        </td>
      </tr>
    `;
    })
    .join("");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (dataFineField.value < dataInizioField.value) {
    alert("La data di fine non può essere precedente alla data di inizio.");
    return;
  }

  try {
    await addFerie({
      dipendenteId: dipendenteSelect.value,
      tipo: tipoField.value,
      dataInizio: dataInizioField.value,
      dataFine: dataFineField.value,
      note: noteField.value.trim(),
    });
    form.reset();
    await render();
  } catch (err) {
    alert("Errore durante il salvataggio della richiesta. Riprova.");
  }
});

tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  if (confirm("Eliminare questa richiesta?")) {
    try {
      await deleteFerie(btn.dataset.id);
      await render();
    } catch (err) {
      alert("Errore durante l'eliminazione della richiesta. Riprova.");
    }
  }
});

await render();
