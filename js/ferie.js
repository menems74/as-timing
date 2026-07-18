import { getDipendenti, getFerie, addFerie, deleteFerie } from "./mock-data.js?v=13";

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

function dipendentiById() {
  return Object.fromEntries(getDipendenti().map((d) => [d.id, d]));
}

function renderDipendentiOptions() {
  dipendenteSelect.innerHTML = getDipendenti()
    .map((d) => `<option value="${d.id}">${d.nome} ${d.cognome}</option>`)
    .join("");
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function render() {
  const byId = dipendentiById();
  const ferie = getFerie();

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

form.addEventListener("submit", (e) => {
  e.preventDefault();

  if (dataFineField.value < dataInizioField.value) {
    alert("La data di fine non può essere precedente alla data di inizio.");
    return;
  }

  addFerie({
    dipendenteId: dipendenteSelect.value,
    tipo: tipoField.value,
    dataInizio: dataInizioField.value,
    dataFine: dataFineField.value,
    note: noteField.value.trim(),
  });

  form.reset();
  render();
});

tbody.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  if (confirm("Eliminare questa richiesta?")) {
    deleteFerie(btn.dataset.id);
    render();
  }
});

renderDipendentiOptions();
render();
