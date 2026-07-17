import { getImpostazioni, updateImpostazioni } from "./mock-data.js";

const GIORNI = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

const giornoSelect = document.getElementById("giorno-chiusura");
const regoleField = document.getElementById("regole");
const regoleSaveBtn = document.getElementById("regole-save-btn");
const regoleSavedMsg = document.getElementById("regole-saved-msg");

function render() {
  const imp = getImpostazioni();

  giornoSelect.innerHTML =
    `<option value="">Nessuna chiusura settimanale</option>` +
    GIORNI.map(
      (g, i) => `<option value="${i}" ${String(i) === String(imp.giornoChiusura) ? "selected" : ""}>${g}</option>`
    ).join("");

  regoleField.value = imp.regoleAlgoritmo || "";
}

giornoSelect.addEventListener("change", () => {
  updateImpostazioni({ giornoChiusura: giornoSelect.value });
});

regoleSaveBtn.addEventListener("click", () => {
  updateImpostazioni({ regoleAlgoritmo: regoleField.value });
  regoleSavedMsg.classList.remove("hidden");
  setTimeout(() => regoleSavedMsg.classList.add("hidden"), 2000);
});

render();
