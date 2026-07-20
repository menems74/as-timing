import { requireSession } from "./auth.js?v=34";
import { getDipendenti, addDipendente, updateDipendente, deleteDipendente } from "./data.js?v=34";
import { creaAccessoDipendente, inviaResetPassword } from "./admin-auth.js?v=34";

const session = await requireSession({ requirePrivileged: true });
if (!session) throw new Error("redirect");

const form = document.getElementById("dipendente-form");
const idField = document.getElementById("dipendente-id");
const nomeField = document.getElementById("nome");
const cognomeField = document.getElementById("cognome");
const ruoloField = document.getElementById("ruolo");
const emailField = document.getElementById("email");
const passwordAccessoField = document.getElementById("password-accesso");
const oreContrattualiField = document.getElementById("ore-contrattuali");
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

let dipendenti = [];

async function render() {
  dipendenti = await getDipendenti();
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
      <td class="px-4 py-3 text-slate-500">${d.email || "—"}</td>
      <td class="px-4 py-3 text-slate-500">${d.oreContrattualiSettimanali ?? "—"}</td>
      <td class="px-4 py-3 text-slate-500">${d.note || "—"}</td>
      <td class="px-4 py-3 text-right whitespace-nowrap">
        ${
          d.email
            ? `<button data-action="reset-password" data-id="${d.id}" class="text-blue-800 hover:underline text-xs mr-3">Invia reset password</button>`
            : ""
        }
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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const dati = {
    nome: nomeField.value.trim(),
    cognome: cognomeField.value.trim(),
    ruolo: ruoloField.value,
    email: emailField.value.trim(),
    oreContrattualiSettimanali: oreContrattualiField.value ? Number(oreContrattualiField.value) : null,
    note: noteField.value.trim(),
  };

  const password = passwordAccessoField.value;

  try {
    if (idField.value) {
      await updateDipendente(idField.value, dati);
    } else {
      await addDipendente(dati);
    }

    if (dati.email && password) {
      try {
        await creaAccessoDipendente(dati.email, password);
      } catch (err) {
        if (err.code === "auth/email-already-in-use") {
          alert(
            "Questo dipendente ha già un accesso attivo: la password non è stata cambiata. Per cambiarla usa \"Invia reset password\"."
          );
        } else {
          alert("Il dipendente è stato salvato, ma la creazione dell'accesso è fallita. Riprova dal bottone \"Invia reset password\" oppure ricontrolla la password inserita.");
        }
      }
    }

    resetForm();
    await render();
  } catch (err) {
    alert("Errore durante il salvataggio del dipendente. Riprova.");
  }
});

cancelEditBtn.addEventListener("click", resetForm);

tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === "reset-password") {
    const d = dipendenti.find((x) => x.id === id);
    if (!d) return;
    if (confirm(`Inviare a ${d.email} l'email per impostare una nuova password?`)) {
      try {
        await inviaResetPassword(d.email);
        alert("Email inviata. Il dipendente potrà scegliere una nuova password dal link ricevuto.");
      } catch (err) {
        if (err.code === "auth/user-not-found") {
          alert("Questo dipendente non ha ancora un accesso attivo: crealo prima compilando \"Password di accesso\" in anagrafica.");
        } else {
          alert("Errore durante l'invio dell'email. Riprova.");
        }
      }
    }
    return;
  }

  if (btn.dataset.action === "delete") {
    if (confirm("Eliminare questo dipendente? Verranno rimossi anche i suoi turni e le sue ferie registrate.")) {
      try {
        await deleteDipendente(id);
        await render();
      } catch (err) {
        alert("Errore durante l'eliminazione del dipendente. Riprova.");
      }
    }
    return;
  }

  if (btn.dataset.action === "edit") {
    const d = dipendenti.find((x) => x.id === id);
    if (!d) return;
    idField.value = d.id;
    nomeField.value = d.nome;
    cognomeField.value = d.cognome;
    ruoloField.value = d.ruolo;
    emailField.value = d.email || "";
    oreContrattualiField.value = d.oreContrattualiSettimanali ?? "";
    noteField.value = d.note || "";
    formTitle.textContent = "Modifica dipendente";
    submitBtn.textContent = "Salva modifiche";
    cancelEditBtn.classList.remove("hidden");
    form.scrollIntoView({ behavior: "smooth" });
  }
});

await render();
