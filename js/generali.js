import { getImpostazioni, updateImpostazioni, getDipendenti } from "./mock-data.js?v=15";

const GIORNI = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

const giornoSelect = document.getElementById("giorno-chiusura");
const direttoreSelect = document.getElementById("direttore");
const regoleField = document.getElementById("regole");

const orarioFields = {
  mattina: document.getElementById("orario-mattina"),
  pomeriggio: document.getElementById("orario-pomeriggio"),
  giornata: document.getElementById("orario-giornata"),
};

function render() {
  const imp = getImpostazioni();

  giornoSelect.innerHTML =
    `<option value="">Nessuna chiusura settimanale</option>` +
    GIORNI.map(
      (g, i) => `<option value="${i}" ${String(i) === String(imp.giornoChiusura) ? "selected" : ""}>${g}</option>`
    ).join("");

  const dipendenti = getDipendenti();
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

giornoSelect.addEventListener("change", () => {
  updateImpostazioni({ giornoChiusura: giornoSelect.value });
});

direttoreSelect.addEventListener("change", () => {
  updateImpostazioni({ direttoreId: direttoreSelect.value });
});

Object.entries(orarioFields).forEach(([tipo, el]) => {
  el.addEventListener("change", () => {
    const imp = getImpostazioni();
    updateImpostazioni({ orariDefault: { ...imp.orariDefault, [tipo]: el.value.trim() } });
  });
});

render();
