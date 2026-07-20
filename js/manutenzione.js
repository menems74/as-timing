import { requireSession } from "./auth.js?v=22";
import {
  contaTurniFinoA,
  eliminaTurniFinoA,
  contaTurniMeseCorrente,
  eliminaTurniMeseCorrente,
} from "./data.js?v=22";

const session = await requireSession({ requirePrivileged: true });
if (!session) throw new Error("redirect");

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
