import { getImpostazioni, updateImpostazioni } from "./mock-data.js";

const GIORNI = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

const giornoSelect = document.getElementById("giorno-chiusura");
const regoleField = document.getElementById("regole");

function render() {
  const imp = getImpostazioni();

  giornoSelect.innerHTML =
    `<option value="">Nessuna chiusura settimanale</option>` +
    GIORNI.map(
      (g, i) => `<option value="${i}" ${String(i) === String(imp.giornoChiusura) ? "selected" : ""}>${g}</option>`
    ).join("");

  regoleField.textContent = imp.regoleAlgoritmo || "";
}

giornoSelect.addEventListener("change", () => {
  updateImpostazioni({ giornoChiusura: giornoSelect.value });
});

render();
