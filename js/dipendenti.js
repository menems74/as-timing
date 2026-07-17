import { getDipendenti, addDipendente, updateDipendente, deleteDipendente } from "./mock-data.js?v=6";

const form = document.getElementById("dipendente-form");
const idField = document.getElementById("dipendente-id");
const nomeField = document.getElementById("nome");
const cognomeField = document.getElementById("cognome");
const ruoloField = document.getElementById("ruolo");
const emailField = document.getElementById("email");
const noteField = document.getElementById("note");
const formTitle = document.getElementById("form-title");
const submitBtn = document.getElementById("submit-btn");
const cancelEditBtn = document.getElementById("cancel-edit-btn");
const tbody = document.getElementById("dipendenti-tbody");

const RUOLO_LABEL = { dipendente: "Dipendente", responsabile: "Responsabile" };
const RUOLO_BADGE = {
  dipendente: "bg-blue-100 text-blue-700",
  responsabile: "bg-amber-100 text-amber-700",
};

function render() {
  const dipendenti = getDipendenti();
  tbody.innerHTML = dipendenti
    .map(
      (d) => `
    <tr>
      <td class="px-4 py-3">${d.nome}</td>
      <td class="px-4 py-3">${d.cognome}</td>
      <td class="px-4 py-3">
        <span class="px-2 py-1 rounded-full text-xs font-medium ${RUOLO_BADGE[d.ruolo]}">
          ${RUOLO_LABEL[d.ruolo]}
        </span>
      </td>
      <td class="px-4 py-3 text-slate-500">${d.email}</td>
      <td class="px-4 py-3 text-slate-500">${d.note || "—"}</td>
      <td class="px-4 py-3 text-right whitespace-nowrap">
        <button data-action="edit" data-id="${d.id}" class="text-slate-600 hover:underline text-xs mr-3">Modifica</button>
        <button data-action="delete" data-id="${d.id}" class="text-red-600 hover:underline text-xs">Elimina</button>
      </td>
    </tr>
  `
    )
    .join("");
}

function resetForm() {
  form.reset();
  idField.value = "";
  formTitle.textContent = "Nuovo dipendente";
  submitBtn.textContent = "Aggiungi";
  cancelEditBtn.classList.add("hidden");
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const dati = {
    nome: nomeField.value.trim(),
    cognome: cognomeField.value.trim(),
    ruolo: ruoloField.value,
    email: emailField.value.trim(),
    note: noteField.value.trim(),
  };

  if (idField.value) {
    updateDipendente(idField.value, dati);
  } else {
    addDipendente(dati);
  }

  resetForm();
  render();
});

cancelEditBtn.addEventListener("click", resetForm);

tbody.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === "delete") {
    if (confirm("Eliminare questo dipendente?")) {
      deleteDipendente(id);
      render();
    }
    return;
  }

  if (btn.dataset.action === "edit") {
    const d = getDipendenti().find((x) => x.id === id);
    if (!d) return;
    idField.value = d.id;
    nomeField.value = d.nome;
    cognomeField.value = d.cognome;
    ruoloField.value = d.ruolo;
    emailField.value = d.email;
    noteField.value = d.note || "";
    formTitle.textContent = "Modifica dipendente";
    submitBtn.textContent = "Salva modifiche";
    cancelEditBtn.classList.remove("hidden");
    form.scrollIntoView({ behavior: "smooth" });
  }
});

render();
