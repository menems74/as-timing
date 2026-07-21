import { requireSession } from "./auth.js?v=44";
import { getStatoDatabase } from "./data.js?v=44";

const session = await requireSession({ requirePrivileged: false });
if (session) {
  document.querySelectorAll("[data-privileged-only]").forEach((el) => {
    if (session.privileged) el.classList.remove("hidden");
    else el.remove();
  });

  if (session.privileged) {
    await renderStatoDatabase();
  }
}

async function renderStatoDatabase() {
  const totaleEl = document.getElementById("db-status-totale");
  const superatiEl = document.getElementById("db-status-superati");
  if (!totaleEl || !superatiEl) return;

  try {
    const { totale, superati } = await getStatoDatabase();
    totaleEl.textContent = totale;

    if (superati === 0) {
      superatiEl.textContent = "Nessun turno superato da pulire.";
      superatiEl.className = "text-xs mt-0.5 text-emerald-600";
    } else {
      superatiEl.textContent = `${superati} turni ormai superati (prima di questo mese): valuta di eseguire la pulizia.`;
      superatiEl.className = "text-xs mt-0.5 text-amber-600 font-medium";
    }
  } catch (err) {
    totaleEl.textContent = "—";
    superatiEl.textContent = "Impossibile leggere lo stato del database.";
    superatiEl.className = "text-xs mt-0.5 text-slate-400";
  }
}
