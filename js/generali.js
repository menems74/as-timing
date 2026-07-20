import { requireSession } from "./auth.js?v=23";
import { getImpostazioni, updateImpostazioni, getDipendenti } from "./data.js?v=23";

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

await render();
