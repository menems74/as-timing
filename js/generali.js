import { getImpostazioni, updateImpostazioni } from "./mock-data.js";

const GIORNI = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

const giornoSelect = document.getElementById("giorno-chiusura");
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

  regoleField.textContent = imp.regoleAlgoritmo || "";

  Object.entries(orarioFields).forEach(([tipo, el]) => {
    el.value = imp.orariDefault[tipo] || "";
  });
}

giornoSelect.addEventListener("change", () => {
  updateImpostazioni({ giornoChiusura: giornoSelect.value });
});

Object.entries(orarioFields).forEach(([tipo, el]) => {
  el.addEventListener("change", () => {
    const imp = getImpostazioni();
    updateImpostazioni({ orariDefault: { ...imp.orariDefault, [tipo]: el.value.trim() } });
  });
});

render();
