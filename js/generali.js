import { requireSession } from "./auth.js?v=20";
import {
  getImpostazioni,
  updateImpostazioni,
  getDipendenti,
  contaTurniFinoA,
  eliminaTurniFinoA,
  contaTurniMeseCorrente,
  eliminaTurniMeseCorrente,
} from "./data.js?v=20";

const session = await requireSession({ requirePrivileged: true });
if (!session) throw new Error("redirect");

const GIORNI = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

const giornoSelect = document.getElementById("giorno-chiusura");
const direttoreSelect = document.getElementById("direttore");
const regoleField = document.getElementById("regole");

const orarioFields = {
  mattina: document.getElementById("orario-mattina"),
  pomeriggio: document.getElementById("orario-pomeriggio"),
  giornata: document.getElementById("orario-giornata"),
};

async function render() {
  const imp = await getImpostazioni();

  giornoSelect.innerHTML =
    `<option value="">Nessuna chiusura settimanale</option>` +
    GIORNI.map(
      (g, i) => `<option value="${i}" ${String(i) === String(imp.giornoChiusura) ? "selected" : ""}>${g}</option>`
    ).join("");

  const dipendenti = await getDipendenti();
  direttoreSelect.innerHTML =
    `<option value="">Nessuno</option>` +
    dipendenti
      .map(
        (d) =>
          `<option value="${d.id}" ${d.id === imp.direttoreId ? "selected" : ""}>${d.nome} ${d.cognome}</option>`
      )
      .join("");

  regoleField.textContent = imp.regoleAlgoritmo || "";

  Object.entries(orarioFields).forEach(([tipo, el]) => {
    el.value = imp.orariDefault[tipo] || "";
  });
}

giornoSelect.addEventListener("change", async () => {
  try {
    await updateImpostazioni({ giornoChiusura: giornoSelect.value });
  } catch (err) {
    alert("Errore durante il salvataggio. Riprova.");
    await render();
  }
});

direttoreSelect.addEventListener("change", async () => {
  try {
    await updateImpostazioni({ direttoreId: direttoreSelect.value });
  } catch (err) {
    alert("Errore durante il salvataggio. Riprova.");
    await render();
  }
});

Object.entries(orarioFields).forEach(([tipo, el]) => {
  el.addEventListener("change", async () => {
    try {
      const imp = await getImpostazioni();
      await updateImpostazioni({ orariDefault: { ...imp.orariDefault, [tipo]: el.value.trim() } });
    } catch (err) {
      alert("Errore durante il salvataggio. Riprova.");
      await render();
    }
  });
});

// --- Manutenzione database ---

const manutenzioneDataField = document.getElementById("manutenzione-data");
const eliminaFinoABtn = document.getElementById("manutenzione-elimina-fino-a-btn");
const eliminaMeseBtn = document.getElementById("manutenzione-elimina-mese-btn");

function formatDataIt(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

eliminaFinoABtn.addEventListener("click", async () => {
  const dataLimite = manutenzioneDataField.value;
  if (!dataLimite) {
    alert("Scegli prima una data.");
    return;
  }

  try {
    const count = await contaTurniFinoA(dataLimite);
    if (count === 0) {
      alert("Non ci sono turni da eliminare fino a questa data.");
      return;
    }
    const confermato = confirm(
      `Verranno eliminati definitivamente ${count} turni (bloccati compresi) fino al ${formatDataIt(dataLimite)}. L'operazione non è reversibile. Continuare?`
    );
    if (!confermato) return;

    const eliminati = await eliminaTurniFinoA(dataLimite);
    alert(`${eliminati} turni eliminati.`);
  } catch (err) {
    alert("Errore durante l'eliminazione. Riprova.");
  }
});

eliminaMeseBtn.addEventListener("click", async () => {
  try {
    const count = await contaTurniMeseCorrente();
    if (count === 0) {
      alert("Non ci sono turni da eliminare nel mese corrente (o sono tutti bloccati).");
      return;
    }
    const confermato = confirm(
      `Verranno eliminati definitivamente ${count} turni del mese corrente (esclusi quelli bloccati). L'operazione non è reversibile. Continuare?`
    );
    if (!confermato) return;

    const eliminati = await eliminaTurniMeseCorrente();
    alert(`${eliminati} turni eliminati.`);
  } catch (err) {
    alert("Errore durante l'eliminazione. Riprova.");
  }
});

await render();
