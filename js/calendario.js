import {
  getDipendenti,
  getTurni,
  setTurno,
  removeTurno,
  moveTurno,
  isInFerie,
  getReparti,
  repartiDiDipendente,
  isGiornoChiusura,
  getImpostazioni,
} from "./mock-data.js";

const MESI = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];
const GIORNI_SETT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const GIORNI_SETT_LUNGHI = [
  "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica",
];

const TIPO_LABEL = { mattina: "Mattina", pomeriggio: "Pomeriggio", giornata: "Giornata intera", riposo: "Riposo" };
const TIPO_COLOR = {
  mattina: "bg-sky-200 text-sky-800",
  pomeriggio: "bg-orange-200 text-orange-800",
  giornata: "bg-violet-200 text-violet-800",
  riposo: "bg-slate-300 text-slate-700",
};

const state = {
  view: "mese",
  refDate: new Date(),
};

// --- Helpers data ---

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  const dow = (d.getDay() + 6) % 7; // 0 = lunedì
  return addDays(d, -dow);
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function isWeekend(date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

function isSunday(date) {
  return date.getDay() === 0;
}

// --- Elementi DOM ---

const content = document.getElementById("calendar-content");
const periodLabel = document.getElementById("period-label");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const todayBtn = document.getElementById("today-btn");
const viewTabs = document.querySelectorAll(".view-tab");
const elaboraBtn = document.getElementById("elabora-btn");

const modal = document.getElementById("turno-modal");
const modalTitle = document.getElementById("modal-title");
const modalForm = document.getElementById("turno-form");
const modalTipo = document.getElementById("modal-tipo");
const modalOrario = document.getElementById("modal-orario");
const modalReparto = document.getElementById("modal-reparto");
const modalRepartoHint = document.getElementById("modal-reparto-hint");
const modalBloccato = document.getElementById("modal-bloccato");
const modalDeleteBtn = document.getElementById("modal-delete-btn");
const modalCancelBtn = document.getElementById("modal-cancel-btn");

let modalTarget = null; // { dipendenteId, dataISO }
let dragSource = null; // { dipendenteId, dataISO }

// --- Rendering label periodo ---

function updatePeriodLabel() {
  if (state.view === "mese") {
    periodLabel.textContent = `${MESI[state.refDate.getMonth()]} ${state.refDate.getFullYear()}`;
  } else if (state.view === "settimana") {
    const start = startOfWeek(state.refDate);
    const end = addDays(start, 6);
    const sameMonth = start.getMonth() === end.getMonth();
    periodLabel.textContent = sameMonth
      ? `${start.getDate()}–${end.getDate()} ${MESI[start.getMonth()]} ${start.getFullYear()}`
      : `${start.getDate()} ${MESI[start.getMonth()]} – ${end.getDate()} ${MESI[end.getMonth()]} ${end.getFullYear()}`;
  } else {
    const dow = (state.refDate.getDay() + 6) % 7;
    periodLabel.textContent = `${GIORNI_SETT_LUNGHI[dow]} ${state.refDate.getDate()} ${MESI[state.refDate.getMonth()]} ${state.refDate.getFullYear()}`;
  }
}

// --- Cella turno (usata da vista mese e settimana) ---

function buildCellaHtml(dipendenteId, dataISO) {
  const turni = getTurni();
  const turno = turni[`${dipendenteId}_${dataISO}`];
  const inFerie = isInFerie(dipendenteId, dataISO);

  if (inFerie) {
    return `<div class="h-10 rounded bg-emerald-200 text-emerald-800 text-[11px] flex items-center justify-center font-medium" title="Ferie/Permesso">F</div>`;
  }

  if (!turno) {
    return `<div class="h-10 rounded border border-dashed border-slate-200 hover:border-slate-400 hover:bg-slate-50 cursor-pointer" title="Doppio click per assegnare un turno"></div>`;
  }

  const lockClass = turno.bloccato ? "ring-2 ring-red-400" : "";
  const icon = turno.bloccato ? "🔒" : "";
  const sigla = turno.tipo === "riposo" ? "R" : turno.tipo === "giornata" ? "G" : turno.tipo === "pomeriggio" ? "P" : "M";

  return `
    <div class="h-10 rounded ${TIPO_COLOR[turno.tipo]} ${lockClass} text-[11px] flex items-center justify-center font-medium cursor-pointer select-none"
         title="${TIPO_LABEL[turno.tipo]}${turno.orario ? " · " + turno.orario : ""}${turno.reparto ? " · " + turno.reparto : ""} (doppio click per modificare)"
         draggable="${!turno.bloccato}">
      ${icon}${sigla}
    </div>
  `;
}

// --- Vista Mese / Settimana (griglia dipendenti x giorni) ---

function renderGrid(days) {
  const dipendenti = getDipendenti();
  const chiusura = days.map((d) => isGiornoChiusura(d));

  const headerCells = days
    .map((d, i) => {
      const dow = (d.getDay() + 6) % 7;
      const cls = chiusura[i]
        ? "bg-slate-50 text-slate-400"
        : isSunday(d)
        ? "text-red-600"
        : isWeekend(d)
        ? "text-slate-500"
        : "text-slate-600";
      return `<th class="px-1 py-2 text-center font-medium ${cls} min-w-[2.75rem]">
        <div class="text-[10px]">${GIORNI_SETT[dow]}</div>
        <div>${d.getDate()}</div>
      </th>`;
    })
    .join("");

  const rows = dipendenti
    .map((dip) => {
      const cells = days
        .map((d, i) => {
          const iso = toISO(d);
          if (chiusura[i]) {
            return `<td class="px-1 py-1">
              <div class="h-10 rounded border border-dashed border-slate-200 bg-slate-50 text-slate-300 text-[11px] flex items-center justify-center font-medium" title="Negozio chiuso">C</div>
            </td>`;
          }
          return `<td class="px-1 py-1" data-cell data-dipendente="${dip.id}" data-data="${iso}">
            ${buildCellaHtml(dip.id, iso)}
          </td>`;
        })
        .join("");
      return `
        <tr>
          <td class="px-3 py-2 sticky left-0 bg-white z-10 border-r border-slate-100 whitespace-nowrap font-medium text-slate-700">
            ${dip.nome} ${dip.cognome}
          </td>
          ${cells}
        </tr>
      `;
    })
    .join("");

  content.innerHTML = `
    <div class="overflow-x-auto">
      <table class="min-w-full text-sm border-collapse">
        <thead class="bg-slate-50">
          <tr>
            <th class="px-3 py-2 sticky left-0 bg-slate-50 z-10 text-left text-slate-500">Dipendente</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${rows}
        </tbody>
      </table>
    </div>
  `;

  attachCellHandlers();
}

function renderMese() {
  const year = state.refDate.getFullYear();
  const month = state.refDate.getMonth();
  const total = daysInMonth(state.refDate);
  const days = Array.from({ length: total }, (_, i) => new Date(year, month, i + 1));
  renderGrid(days);
}

function renderSettimana() {
  const start = startOfWeek(state.refDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  renderGrid(days);
}

// --- Vista Giorno (card per dipendente) ---

function renderGiorno() {
  const dipendenti = getDipendenti();
  const iso = toISO(state.refDate);
  const turni = getTurni();

  if (isGiornoChiusura(state.refDate)) {
    content.innerHTML = `
      <div class="p-10 text-center text-slate-500">
        <div class="text-4xl mb-2">🔒</div>
        <p class="font-medium text-slate-700">Il negozio è chiuso in questo giorno.</p>
        <p class="text-sm mt-1">Nessun turno può essere assegnato (impostazione in Impostazioni → Generali).</p>
      </div>
    `;
    return;
  }

  const cards = dipendenti
    .map((dip) => {
      const inFerie = isInFerie(dip.id, iso);
      const turno = turni[`${dip.id}_${iso}`];

      let bodyHtml;
      if (inFerie) {
        bodyHtml = `<span class="px-2 py-1 rounded-full text-xs font-medium bg-emerald-200 text-emerald-800">Ferie/Permesso</span>`;
      } else if (turno) {
        bodyHtml = `
          <span class="px-2 py-1 rounded-full text-xs font-medium ${TIPO_COLOR[turno.tipo]}">
            ${turno.bloccato ? "🔒 " : ""}${TIPO_LABEL[turno.tipo]}
          </span>
          ${turno.orario ? `<span class="ml-2 text-sm text-slate-500">${turno.orario}</span>` : ""}
          ${turno.reparto ? `<span class="ml-2 text-sm text-slate-500">· ${turno.reparto}</span>` : ""}
        `;
      } else {
        bodyHtml = `<span class="text-sm text-slate-400">Nessun turno</span>`;
      }

      return `
        <div class="flex items-center justify-between px-4 py-3 ${inFerie ? "" : "cursor-pointer hover:bg-slate-50"}"
             ${inFerie ? "" : `data-cell data-dipendente="${dip.id}" data-data="${iso}"`}>
          <span class="font-medium text-slate-700">${dip.nome} ${dip.cognome}</span>
          <span>${bodyHtml}</span>
        </div>
      `;
    })
    .join("");

  content.innerHTML = `<div class="divide-y divide-slate-100">${cards}</div>`;

  attachCellHandlers();
}

// --- Interazioni cella: click per aprire modale, drag & drop ---

function attachCellHandlers() {
  content.querySelectorAll("[data-cell]").forEach((cell) => {
    cell.addEventListener("dblclick", () => openModal(cell.dataset.dipendente, cell.dataset.data));

    const inner = cell.querySelector("[draggable]");
    if (inner) {
      inner.addEventListener("dragstart", (e) => {
        dragSource = { dipendenteId: cell.dataset.dipendente, dataISO: cell.dataset.data };
        e.dataTransfer.effectAllowed = "move";
      });
    }

    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      cell.classList.add("bg-slate-100");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("bg-slate-100"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("bg-slate-100");
      if (!dragSource) return;

      const targetDipendenteId = cell.dataset.dipendente;
      const targetDataISO = cell.dataset.data;
      const turni = getTurni();
      const targetOccupato = turni[`${targetDipendenteId}_${targetDataISO}`];
      const targetInFerie = isInFerie(targetDipendenteId, targetDataISO);

      if (targetInFerie) {
        alert("Il dipendente è in ferie/permesso in questo giorno.");
      } else if (targetOccupato) {
        alert("La cella di destinazione ha già un turno assegnato.");
      } else {
        moveTurno(dragSource.dipendenteId, dragSource.dataISO, targetDipendenteId, targetDataISO);
        renderCurrentView();
      }
      dragSource = null;
    });
  });
}

// --- Modale turno ---

function populateModalReparto(dipendenteId, repartoSelezionato) {
  let compatibili = repartiDiDipendente(dipendenteId).map((r) => r.nome);
  const tuttiReparti = getReparti().map((r) => r.nome);
  let usaFallback = false;

  if (compatibili.length === 0) {
    compatibili = tuttiReparti;
    usaFallback = compatibili.length > 0;
  }

  // Se il turno esistente ha un reparto non più tra quelli compatibili, lo aggiungiamo comunque per non perderlo.
  if (repartoSelezionato && !compatibili.includes(repartoSelezionato)) {
    compatibili = [...compatibili, repartoSelezionato];
  }

  modalReparto.innerHTML =
    compatibili.length === 0
      ? `<option value="">Nessun reparto disponibile</option>`
      : compatibili.map((nome) => `<option value="${nome}">${nome}</option>`).join("");

  modalReparto.value = repartoSelezionato || compatibili[0] || "";

  if (usaFallback) {
    modalRepartoHint.textContent =
      "Nessun reparto assegnato a questo dipendente in Impostazioni → Reparti: mostro tutti i reparti disponibili.";
    modalRepartoHint.classList.remove("hidden");
  } else {
    modalRepartoHint.classList.add("hidden");
  }
}

function openModal(dipendenteId, dataISO) {
  if (isInFerie(dipendenteId, dataISO)) return;

  modalTarget = { dipendenteId, dataISO };
  const turno = getTurni()[`${dipendenteId}_${dataISO}`];
  const dip = getDipendenti().find((d) => d.id === dipendenteId);

  modalTitle.textContent = `${dip ? dip.nome + " " + dip.cognome : ""} — ${dataISO.split("-").reverse().join("/")}`;

  if (turno) {
    modalTipo.value = turno.tipo;
    modalOrario.value = turno.orario || "";
    populateModalReparto(dipendenteId, turno.reparto || "");
    modalBloccato.checked = !!turno.bloccato;
    modalDeleteBtn.classList.remove("hidden");
  } else {
    modalForm.reset();
    populateModalReparto(dipendenteId, "");
    modalOrario.value = orarioDefaultPerTipo(modalTipo.value);
    modalBloccato.checked = false;
    modalDeleteBtn.classList.add("hidden");
  }

  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function orarioDefaultPerTipo(tipo) {
  return getImpostazioni().orariDefault[tipo] || "";
}

modalTipo.addEventListener("change", () => {
  const isNuovoTurno = modalDeleteBtn.classList.contains("hidden");
  if (isNuovoTurno) {
    modalOrario.value = orarioDefaultPerTipo(modalTipo.value);
  }
});

function closeModal() {
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  modalTarget = null;
}

modalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!modalTarget) return;

  setTurno(modalTarget.dipendenteId, modalTarget.dataISO, {
    tipo: modalTipo.value,
    orario: modalOrario.value.trim(),
    reparto: modalReparto.value.trim(),
    bloccato: modalBloccato.checked,
  });

  closeModal();
  renderCurrentView();
});

modalDeleteBtn.addEventListener("click", () => {
  if (!modalTarget) return;
  removeTurno(modalTarget.dipendenteId, modalTarget.dataISO);
  closeModal();
  renderCurrentView();
});

modalCancelBtn.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

// --- Tabs, navigazione periodo, elabora ---

function renderCurrentView() {
  updatePeriodLabel();
  if (state.view === "mese") renderMese();
  else if (state.view === "settimana") renderSettimana();
  else renderGiorno();
}

function setView(view) {
  state.view = view;
  viewTabs.forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("bg-white", active);
    tab.classList.toggle("shadow-sm", active);
    tab.classList.toggle("text-teal-700", active);
    tab.classList.toggle("text-slate-500", !active);
  });
  renderCurrentView();
}

viewTabs.forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));

prevBtn.addEventListener("click", () => {
  if (state.view === "mese") state.refDate = addMonths(state.refDate, -1);
  else if (state.view === "settimana") state.refDate = addDays(state.refDate, -7);
  else state.refDate = addDays(state.refDate, -1);
  renderCurrentView();
});

nextBtn.addEventListener("click", () => {
  if (state.view === "mese") state.refDate = addMonths(state.refDate, 1);
  else if (state.view === "settimana") state.refDate = addDays(state.refDate, 7);
  else state.refDate = addDays(state.refDate, 1);
  renderCurrentView();
});

todayBtn.addEventListener("click", () => {
  state.refDate = new Date();
  renderCurrentView();
});

elaboraBtn.addEventListener("click", () => {
  alert(
    "L'algoritmo di pianificazione automatica sarà implementato nella fase successiva.\n\nPer ora puoi inserire e spostare i turni manualmente."
  );
});

// --- Avvio ---

setView("mese");
