import { requireSession } from "./auth.js?v=36";
import {
  contaTurniFinoA,
  eliminaTurniFinoA,
  contaTurniMeseCorrente,
  eliminaTurniMeseCorrente,
} from "./data.js?v=36";

const session = await requireSession({ requirePrivileged: true });
if (!session) throw new Error("redirect");

const manutenzioneDataField = document.getElementById("manutenzione-data");
const eliminaFinoABtn = document.getElementById("manutenzione-elimina-fino-a-btn");
const eliminaMeseBtn = document.getElementById("manutenzione-elimina-mese-btn");

function formatDataIt(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Precompila con l'ultimo giorno del mese di due mesi fa: tiene per default
// gli ultimi ~2 mesi e propone di ripulire tutto ciò che è più vecchio.
function ultimoGiornoDueMesiFa() {
  const oggi = new Date();
  const fine = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${fine.getFullYear()}-${pad(fine.getMonth() + 1)}-${pad(fine.getDate())}`;
}

manutenzioneDataField.value = ultimoGiornoDueMesiFa();

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
