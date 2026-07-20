import { requireSession } from "./auth.js?v=29";
import { getImpostazioni, updateImpostazioni, getDipendenti } from "./data.js?v=29";

const session = await requireSession({ requirePrivileged: true });
if (!session) throw new Error("redirect");

const GIORNI = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

const giornoSelect = document.getElementById("giorno-chiusura");
const direttoreSelect = document.getElementById("direttore");

const orarioFields = {
  mattina: document.getElementById("orario-mattina"),
  pomeriggio: document.getElementById("orario-pomeriggio"),
  giornata: document.getElementById("orario-giornata"),
};

const oreFields = {
  mattina: document.getElementById("ore-mattina"),
  pomeriggio: document.getElementById("ore-pomeriggio"),
  giornata: document.getElementById("ore-giornata"),
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

  Object.entries(orarioFields).forEach(([tipo, el]) => {
    el.value = imp.orariDefault[tipo] || "";
  });

  Object.entries(oreFields).forEach(([tipo, el]) => {
    el.value = imp.oreTurno[tipo] ?? "";
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

Object.entries(oreFields).forEach(([tipo, el]) => {
  el.addEventListener("change", async () => {
    try {
      const imp = await getImpostazioni();
      await updateImpostazioni({ oreTurno: { ...imp.oreTurno, [tipo]: el.value ? Number(el.value) : 0 } });
    } catch (err) {
      alert("Errore durante il salvataggio. Riprova.");
      await render();
    }
  });
});

await render();
