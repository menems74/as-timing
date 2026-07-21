import { requireSession } from "./auth.js?v=35";
import {
  getDipendenti,
  getDipendentiTurnabili,
  getTurniRange,
  getTurniPerDipendente,
  turnoKey,
  setTurno,
  removeTurno,
  moveTurno,
  isInFerie,
  getFerie,
  getFeriePerDipendente,
  getReparti,
  repartiDiDipendente,
  repartoByNome,
  isGiornoChiusura,
  getImpostazioni,
  applicaPianificazione,
} from "./data.js?v=35";
import { pianificaMese, analizzaMese, settimaneDelMese, SLOT_LABEL } from "./algoritmo.js?v=35";

const session = await requireSession({ requirePrivileged: false });
if (!session) throw new Error("redirect");

// Gli elementi riservati partono nascosti in HTML (classe "hidden") per evitare
// che un Dipendente in sola lettura li veda comparire per un istante prima che
// la sessione venga risolta.
document.querySelectorAll("[data-privileged-only]").forEach((el) => {
  if (session.privileged) el.classList.remove("hidden");
  else el.remove();
});

const MESI = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];
const GIORNI_SETT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const GIORNI_SETT_LUNGHI = [
  "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica",
];

const TIPO_LABEL = { mattina: "Mattina", pomeriggio: "Pomeriggio", giornata: "Giornata intera" };
// Solo bordo colorato, sfondo neutro.
const TIPO_BORDER = {
  mattina: "border-sky-400 text-sky-700",
  pomeriggio: "border-emerald-400 text-emerald-700",
  giornata: "border-violet-400 text-violet-700",
};

const state = {
  view: "mese",
  refDate: new Date(),
  repartoFiltro: "",
};

// Cache popolata ad ogni renderCurrentView(): evita di rifare le stesse query
// Firestore ad ogni singola cella durante il rendering di una griglia.
const cache = {
  dipendenti: [],
  reparti: [],
  impostazioni: null,
  ferie: [],
  turni: {},
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

// --- Caricamento dati (Firestore) ---

async function loadCommon() {
  cache.reparti = await getReparti();
  cache.impostazioni = await getImpostazioni();

  if (session.privileged) {
    const tutti = await getDipendenti();
    cache.dipendenti = getDipendentiTurnabili(tutti, cache.impostazioni);
    cache.ferie = await getFerie();
  } else {
    // Il Dipendente in sola lettura vede solo la propria riga: le Security Rules
    // non permetterebbero comunque di leggere l'anagrafica o le ferie altrui.
    cache.dipendenti = [{ id: session.dipendenteId, nome: session.nome, cognome: session.cognome }];
    cache.ferie = await getFeriePerDipendente(session.dipendenteId);
  }
}

async function loadTurniPerGiorni(days) {
  if (session.privileged) {
    const start = toISO(days[0]);
    const end = toISO(days[days.length - 1]);
    cache.turni = await getTurniRange(start, end);
  } else {
    cache.turni = await getTurniPerDipendente(session.dipendenteId);
  }
}

// --- Elementi DOM ---

const content = document.getElementById("calendar-content");

// Mantiene la posizione di scroll orizzontale della griglia quando si ri-renderizza
// (es. dopo aver salvato un turno), evitando di tornare all'inizio del mese.
function setContentHtml(html) {
  const prevScroller = content.querySelector(".overflow-x-auto");
  const scrollLeft = prevScroller ? prevScroller.scrollLeft : 0;
  content.innerHTML = html;
  const newScroller = content.querySelector(".overflow-x-auto");
  if (newScroller) newScroller.scrollLeft = scrollLeft;
}

const periodLabel = document.getElementById("period-label");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const todayBtn = document.getElementById("today-btn");
const elaboraBtn = document.getElementById("elabora-btn");
const analisiBtn = document.getElementById("analisi-btn");
const repartoFiltroSelect = document.getElementById("reparto-filtro");

const modal = document.getElementById("turno-modal");
const modalTitleNome = document.getElementById("modal-title-nome");
const modalTitleData = document.getElementById("modal-title-data");
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
  const todayISO = toISO(new Date());
  if (state.view === "mese" || state.view === "analisi") {
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
    const isToday = toISO(state.refDate) === todayISO;
    periodLabel.textContent = `${GIORNI_SETT_LUNGHI[dow]} ${state.refDate.getDate()} ${MESI[state.refDate.getMonth()]} ${state.refDate.getFullYear()}${isToday ? " (Oggi)" : ""}`;
  }
}

// --- Cella turno (usata da vista mese e settimana) ---

function buildCellaHtml(dipendenteId, dataISO) {
  const turno = cache.turni[turnoKey(dipendenteId, dataISO)];
  const inFerie = isInFerie(dipendenteId, dataISO, cache.ferie);
  const filtro = state.repartoFiltro;
  const match = !filtro || (turno && turno.reparto === filtro);
  const dimClass = match ? "" : "opacity-25";

  if (inFerie) {
    return `<div class="h-10 rounded bg-orange-200 text-orange-800 text-[11px] flex items-center justify-center font-medium transition-opacity ${dimClass}" title="Ferie/Permesso">F</div>`;
  }

  if (!turno) {
    const cursorClass = session.privileged ? "cursor-pointer hover:border-slate-400 hover:bg-slate-50" : "";
    const hint = session.privileged ? "Doppio click per assegnare un turno" : "";
    return `<div class="h-10 rounded border border-dashed border-slate-200 ${cursorClass} transition-opacity ${dimClass}" title="${hint}"></div>`;
  }

  const lockClass = turno.bloccato ? "ring-2 ring-red-400" : "";
  const icon = turno.bloccato ? "🔒" : "";
  const sigla = turno.tipo === "giornata" ? "G" : turno.tipo === "pomeriggio" ? "P" : "M";
  const reparto = turno.reparto ? repartoByNome(turno.reparto, cache.reparti) : null;
  const tipoClass = `bg-white border-2 ${TIPO_BORDER[turno.tipo]}`;
  const repartoStyle = reparto ? `border-left:8px solid ${reparto.colore};` : "";
  const cursorClass = session.privileged ? "cursor-pointer" : "";

  return `
    <div class="h-10 rounded ${tipoClass} ${lockClass} ${dimClass} ${cursorClass} text-[11px] flex items-center justify-center font-medium select-none transition-opacity"
         style="${repartoStyle}"
         title="${TIPO_LABEL[turno.tipo]}${turno.orario ? " · " + turno.orario : ""}${turno.reparto ? " · " + turno.reparto : ""}"
         draggable="${!!(session.privileged && !turno.bloccato)}">
      ${icon}${sigla}
    </div>
  `;
}

// --- Vista Mese / Settimana (griglia dipendenti x giorni) ---

function renderGrid(days) {
  const dipendenti = cache.dipendenti;
  const chiusura = days.map((d) => isGiornoChiusura(d, cache.impostazioni));
  const todayISO = toISO(new Date());

  const headerCells = days
    .map((d, i) => {
      const dow = (d.getDay() + 6) % 7;
      const isToday = toISO(d) === todayISO;
      const todayClass = isToday ? "bg-blue-50/50 border-x border-blue-200/50" : "";
      const cls = chiusura[i]
        ? "bg-slate-50 text-slate-400"
        : isSunday(d)
        ? "text-red-600"
        : isWeekend(d)
        ? "text-slate-500"
        : "text-slate-600";
      
      const dateNumHtml = isToday
        ? `<div class="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white font-semibold shadow-sm mx-auto">${d.getDate()}</div>`
        : `<div>${d.getDate()}</div>`;

      return `<th class="px-1 py-2 text-center font-medium ${cls} ${todayClass} min-w-[2.75rem]">
        <div class="text-[10px]">${GIORNI_SETT[dow]}</div>
        ${dateNumHtml}
      </th>`;
    })
    .join("");

  const rows = dipendenti
    .map((dip) => {
      const cells = days
        .map((d, i) => {
          const iso = toISO(d);
          const isToday = iso === todayISO;
          const todayCellClass = isToday ? "bg-blue-50/30 border-x border-blue-200/40" : "";
          if (chiusura[i]) {
            return `<td class="px-1 py-1 ${todayCellClass}">
              <div class="h-10 rounded border border-dashed border-slate-200 bg-slate-50 text-slate-300 text-[11px] flex items-center justify-center font-medium" title="Negozio chiuso">C</div>
            </td>`;
          }
          return `<td class="px-1 py-1 ${todayCellClass}" data-cell data-dipendente="${dip.id}" data-data="${iso}">
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

  setContentHtml(`
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
  `);

  attachCellHandlers();
}

async function renderMese() {
  const year = state.refDate.getFullYear();
  const month = state.refDate.getMonth();
  const total = daysInMonth(state.refDate);
  const days = Array.from({ length: total }, (_, i) => new Date(year, month, i + 1));
  await loadTurniPerGiorni(days);
  renderGrid(days);
}

async function renderSettimana() {
  const start = startOfWeek(state.refDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  await loadTurniPerGiorni(days);
  renderGrid(days);
}

// --- Vista Analisi Reparti (conteggio dipendenti per reparto/turno) ---

function contaCopertura(reparto, iso, dipendenti) {
  const mattina = [];
  const pomeriggio = [];
  for (const dip of dipendenti) {
    const turno = cache.turni[turnoKey(dip.id, iso)];
    if (!turno || turno.reparto !== reparto.nome) continue;
    const nome = `${dip.nome} ${dip.cognome}`;
    if (turno.tipo === "mattina" || turno.tipo === "giornata") mattina.push(nome);
    if (turno.tipo === "pomeriggio" || turno.tipo === "giornata") pomeriggio.push(nome);
  }
  return { mattina, pomeriggio };
}

function contaCellaHtml(nomi, colore) {
  const count = nomi.length;
  const style = count === 0 ? "background:#fef2f2;color:#dc2626;" : `background:${colore}22;color:#1e293b;`;
  const title = count === 0 ? "Nessun dipendente" : nomi.join(", ");
  return `<div class="h-10 rounded flex items-center justify-center text-sm font-semibold cursor-default" style="${style}" title="${title}">${count}</div>`;
}

function chiusaCellaHtml() {
  return `<div class="h-10 rounded border border-dashed border-slate-200 bg-slate-50 text-slate-300 text-[11px] flex items-center justify-center font-medium">C</div>`;
}

async function renderAnalisiReparti() {
  const year = state.refDate.getFullYear();
  const month = state.refDate.getMonth();
  const total = daysInMonth(state.refDate);
  const days = Array.from({ length: total }, (_, i) => new Date(year, month, i + 1));
  await loadTurniPerGiorni(days);

  const chiusura = days.map((d) => isGiornoChiusura(d, cache.impostazioni));
  const dipendenti = cache.dipendenti;
  const reparti = cache.reparti.filter((r) => !state.repartoFiltro || r.nome === state.repartoFiltro);

  if (reparti.length === 0) {
    setContentHtml(`<div class="p-10 text-center text-slate-500">Nessun reparto configurato (Impostazioni → Reparti).</div>`);
    return;
  }

  const todayISO = toISO(new Date());

  const headerCells = days
    .map((d, i) => {
      const dow = (d.getDay() + 6) % 7;
      const isToday = toISO(d) === todayISO;
      const todayClass = isToday ? "bg-blue-50/50 border-x border-blue-200/50" : "";
      const cls = chiusura[i]
        ? "bg-slate-50 text-slate-400"
        : isSunday(d)
        ? "text-red-600"
        : isWeekend(d)
        ? "text-slate-500"
        : "text-slate-600";

      const dateNumHtml = isToday
        ? `<div class="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white font-semibold shadow-sm mx-auto">${d.getDate()}</div>`
        : `<div>${d.getDate()}</div>`;

      return `<th class="px-1 py-2 text-center font-medium ${cls} ${todayClass} min-w-[2.75rem]">
        <div class="text-[10px]">${GIORNI_SETT[dow]}</div>
        ${dateNumHtml}
      </th>`;
    })
    .join("");

  const rows = reparti
    .flatMap((r) => {
      const cellsPer = (slot) =>
        days
          .map((d, i) => {
            const iso = toISO(d);
            const isToday = iso === todayISO;
            const todayCellClass = isToday ? "bg-blue-50/30 border-x border-blue-200/40" : "";
            if (chiusura[i]) return `<td class="px-1 py-1 ${todayCellClass}">${chiusaCellaHtml()}</td>`;
            const cov = contaCopertura(r, toISO(d), dipendenti);
            return `<td class="px-1 py-1 ${todayCellClass}">${contaCellaHtml(cov[slot], r.colore)}</td>`;
          })
          .join("");

      return [
        `<tr class="border-t-2 border-slate-200">
          <td class="px-3 py-2 sticky left-0 bg-white z-10 border-r border-slate-100 whitespace-nowrap">
            <span class="inline-flex items-center gap-1.5 font-medium text-slate-700">
              <span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:${r.colore}"></span>${r.nome}
            </span>
            <span class="block text-xs font-normal text-slate-400 pl-4">Mattina</span>
          </td>
          ${cellsPer("mattina")}
        </tr>`,
        `<tr>
          <td class="px-3 py-2 pl-8 sticky left-0 bg-white z-10 border-r border-slate-100 whitespace-nowrap text-xs text-slate-400">
            Pomeriggio
          </td>
          ${cellsPer("pomeriggio")}
        </tr>`,
      ];
    })
    .join("");

  setContentHtml(`
    <div class="overflow-x-auto">
      <table class="min-w-full text-sm border-collapse">
        <thead class="bg-slate-50">
          <tr>
            <th class="px-3 py-2 sticky left-0 bg-slate-50 z-10 text-left text-slate-500">Reparto</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${rows}
        </tbody>
      </table>
    </div>
  `);
}

// --- Vista Giorno (card per dipendente) ---

async function renderGiorno() {
  const dipendenti = cache.dipendenti;
  const iso = toISO(state.refDate);
  await loadTurniPerGiorni([state.refDate]);

  if (isGiornoChiusura(state.refDate, cache.impostazioni)) {
    setContentHtml(`
      <div class="p-10 text-center text-slate-500">
        <div class="text-4xl mb-2">🔒</div>
        <p class="font-medium text-slate-700">Il negozio è chiuso in questo giorno.</p>
        <p class="text-sm mt-1">Nessun turno può essere assegnato (impostazione in Impostazioni → Generali).</p>
      </div>
    `);
    return;
  }

  const cards = dipendenti
    .map((dip) => {
      const inFerie = isInFerie(dip.id, iso, cache.ferie);
      const turno = cache.turni[turnoKey(dip.id, iso)];

      const filtro = state.repartoFiltro;
      const match = !filtro || (turno && turno.reparto === filtro);
      const dimClass = match ? "" : "opacity-25";

      let bodyHtml;
      let reparto = null;
      if (inFerie) {
        bodyHtml = `<span class="px-2 py-1 rounded-full text-xs font-medium bg-orange-200 text-orange-800 transition-opacity ${dimClass}">Ferie/Permesso</span>`;
      } else if (turno) {
        reparto = turno.reparto ? repartoByNome(turno.reparto, cache.reparti) : null;
        const badgeClass = `bg-white border-2 ${TIPO_BORDER[turno.tipo]}`;
        bodyHtml = `
          <span class="px-2 py-1 rounded-full text-xs font-medium ${badgeClass} transition-opacity ${dimClass}">
            ${turno.bloccato ? "🔒 " : ""}${TIPO_LABEL[turno.tipo]}
          </span>
          ${turno.orario ? `<span class="ml-2 text-sm text-slate-500">${turno.orario}</span>` : ""}
        `;
      } else {
        bodyHtml = `<span class="text-sm text-slate-400 transition-opacity ${dimClass}">Nessun turno</span>`;
      }

      const repartoNome = reparto
        ? `<span class="ml-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-slate-700 border transition-opacity ${dimClass}"
                style="background:${reparto.colore}1f; border-color:${reparto.colore}90;">
            <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${reparto.colore}"></span>${reparto.nome}
          </span>`
        : "";

      const clickable = session.privileged && !inFerie;

      return `
        <div class="flex items-center justify-between px-4 py-3 ${clickable ? "cursor-pointer hover:bg-slate-50" : ""}"
             ${clickable ? `data-cell data-dipendente="${dip.id}" data-data="${iso}"` : ""}>
          <span class="font-medium text-slate-700 inline-flex items-center">${dip.nome} ${dip.cognome}${repartoNome}</span>
          <span>${bodyHtml}</span>
        </div>
      `;
    })
    .join("");

  setContentHtml(`<div class="divide-y divide-slate-100">${cards}</div>`);

  attachCellHandlers();
}

// --- Interazioni cella: click per aprire modale, drag & drop ---

function attachCellHandlers() {
  if (!session.privileged) return; // sola lettura: nessuna modifica possibile

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
    cell.addEventListener("drop", async (e) => {
      e.preventDefault();
      cell.classList.remove("bg-slate-100");
      if (!dragSource) return;

      const targetDipendenteId = cell.dataset.dipendente;
      const targetDataISO = cell.dataset.data;
      const targetInFerie = isInFerie(targetDipendenteId, targetDataISO, cache.ferie);

      if (targetInFerie) {
        alert("Il dipendente è in ferie/permesso in questo giorno.");
      } else {
        try {
          await moveTurno(dragSource.dipendenteId, dragSource.dataISO, targetDipendenteId, targetDataISO);
          await renderCurrentView();
        } catch (err) {
          if (err.message === "CELLA_OCCUPATA") {
            alert("La cella di destinazione ha già un turno assegnato.");
          } else if (err.message === "TURNO_NON_SPOSTABILE") {
            alert("Questo turno non è più spostabile (è stato bloccato o rimosso nel frattempo).");
          } else {
            alert("Errore durante lo spostamento del turno. Riprova.");
          }
          await renderCurrentView();
        }
      }
      dragSource = null;
    });
  });
}

// --- Modale turno ---

function populateModalReparto(dipendenteId, repartoSelezionato) {
  const tuttiReparti = cache.reparti.map((r) => r.nome);
  const compatibili = repartiDiDipendente(dipendenteId, cache.reparti).map((r) => r.nome);

  modalReparto.innerHTML =
    tuttiReparti.length === 0
      ? `<option value="">Nessun reparto disponibile</option>`
      : tuttiReparti.map((nome) => `<option value="${nome}">${nome}</option>`).join("");

  modalReparto.value = repartoSelezionato || compatibili[0] || tuttiReparti[0] || "";

  if (compatibili.length === 0 && tuttiReparti.length > 0) {
    modalRepartoHint.textContent =
      "Nessun reparto assegnato a questo dipendente in Impostazioni → Reparti: puoi comunque scegliere tra tutti quelli disponibili.";
    modalRepartoHint.classList.remove("hidden");
  } else {
    modalRepartoHint.classList.add("hidden");
  }
}

function openModal(dipendenteId, dataISO) {
  if (isInFerie(dipendenteId, dataISO, cache.ferie)) return;

  modalTarget = { dipendenteId, dataISO };
  const turno = cache.turni[turnoKey(dipendenteId, dataISO)];
  const dip = cache.dipendenti.find((d) => d.id === dipendenteId);

  modalTitleNome.textContent = dip ? `${dip.nome} ${dip.cognome}` : "";
  modalTitleData.textContent = dataISO.split("-").reverse().join("/");

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
  return (cache.impostazioni?.orariDefault || {})[tipo] || "";
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

modalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!modalTarget) return;

  try {
    await setTurno(modalTarget.dipendenteId, modalTarget.dataISO, {
      tipo: modalTipo.value,
      orario: modalOrario.value.trim(),
      reparto: modalReparto.value.trim(),
      bloccato: modalBloccato.checked,
    });
    closeModal();
    await renderCurrentView();
  } catch (err) {
    alert("Errore durante il salvataggio del turno. Riprova.");
  }
});

modalDeleteBtn.addEventListener("click", async () => {
  if (!modalTarget) return;
  try {
    await removeTurno(modalTarget.dipendenteId, modalTarget.dataISO);
    closeModal();
    await renderCurrentView();
  } catch (err) {
    alert("Errore durante la rimozione del turno. Riprova.");
  }
});

modalCancelBtn.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

// --- Tabs, navigazione periodo, elabora ---

async function renderCurrentView() {
  updatePeriodLabel();
  await loadCommon();
  if (state.view === "mese") await renderMese();
  else if (state.view === "settimana") await renderSettimana();
  else if (state.view === "analisi") await renderAnalisiReparti();
  else await renderGiorno();
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".view-tab").forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("bg-white", active);
    tab.classList.toggle("shadow-sm", active);
    tab.classList.toggle("text-blue-900", active);
    tab.classList.toggle("text-slate-500", !active);
  });
  renderCurrentView();
}

document.querySelectorAll(".view-tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));

prevBtn.addEventListener("click", () => {
  if (state.view === "mese" || state.view === "analisi") state.refDate = addMonths(state.refDate, -1);
  else if (state.view === "settimana") state.refDate = addDays(state.refDate, -7);
  else state.refDate = addDays(state.refDate, -1);
  renderCurrentView();
});

nextBtn.addEventListener("click", () => {
  if (state.view === "mese" || state.view === "analisi") state.refDate = addMonths(state.refDate, 1);
  else if (state.view === "settimana") state.refDate = addDays(state.refDate, 7);
  else state.refDate = addDays(state.refDate, 1);
  renderCurrentView();
});

todayBtn.addEventListener("click", () => {
  state.refDate = new Date();
  renderCurrentView();
});

// --- Elaborazione automatica del mese ---

const reportModal = document.getElementById("report-modal");
const reportSottotitolo = document.getElementById("report-sottotitolo");
const reportContent = document.getElementById("report-content");
const reportCloseBtn = document.getElementById("report-close-btn");
const reportPrintBtn = document.getElementById("report-print-btn");

function formatISO(iso) {
  return iso.split("-").reverse().join("/");
}

function sezioneReport(titolo, righe, colore) {
  if (righe.length === 0) return "";
  const palette = {
    rosso: "bg-red-50 border-red-200 text-red-800",
    ambra: "bg-amber-50 border-amber-200 text-amber-800",
  }[colore];
  return `
    <div class="rounded-lg border p-3 ${palette}">
      <p class="font-semibold mb-1.5">${titolo} (${righe.length})</p>
      <ul class="list-disc list-inside space-y-0.5">${righe.map((r) => `<li>${r}</li>`).join("")}</ul>
    </div>
  `;
}

function mostraReport(r, sottotitolo) {
  reportSottotitolo.textContent = sottotitolo;

  const sezioni = [
    sezioneReport(
      "Reparti senza copertura",
      r.copertureAssenti.map((c) => `${formatISO(c.dataISO)} ${SLOT_LABEL[c.slot]} — ${c.reparto}`),
      "rosso"
    ),
    sezioneReport(
      "Reparti con un solo dipendente",
      r.copertureSingole.map((c) => `${formatISO(c.dataISO)} ${SLOT_LABEL[c.slot]} — ${c.reparto}`),
      "ambra"
    ),
    sezioneReport(
      "Sopra il monte ore contrattuale",
      r.oreSopra.map((v) => `${v.nome} — settimana del ${formatISO(v.settimana)}: ${v.ore}h su ${v.contratto}h`),
      "ambra"
    ),
    sezioneReport(
      "Sotto il monte ore contrattuale",
      r.oreSotto.map(
        (v) =>
          `${v.nome} — settimana del ${formatISO(v.settimana)}: ${v.ore}h su ${v.contratto}h` +
          (v.haFerie ? " (ferie/permessi in settimana: atteso)" : "")
      ),
      "ambra"
    ),
    sezioneReport(
      "Meno di 2 domeniche libere",
      r.domenicheInsufficienti.map((v) => `${v.nome} — ${v.libere} domeniche libere nel periodo`),
      "ambra"
    ),
  ].filter(Boolean);

  reportContent.innerHTML = sezioni.length
    ? sezioni.join("")
    : `<div class="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 p-3 font-medium">Nessuna anomalia rilevata.</div>`;

  reportModal.classList.remove("hidden");
  reportModal.classList.add("flex");
}

reportCloseBtn.addEventListener("click", () => {
  reportModal.classList.add("hidden");
  reportModal.classList.remove("flex");
});
reportPrintBtn.addEventListener("click", () => window.print());
reportModal.addEventListener("click", (e) => {
  if (e.target === reportModal) reportCloseBtn.click();
});

if (elaboraBtn) {
  elaboraBtn.addEventListener("click", async () => {
    const imp = await getImpostazioni();
    const oreT = imp.oreTurno || {};
    if (!(oreT.mattina > 0) || !(oreT.pomeriggio > 0) || !(oreT.giornata > 0)) {
      alert("Prima di elaborare imposta le durate in ore dei tre tipi turno in Impostazioni → Generali.");
      return;
    }
    const reparti = await getReparti();
    if (reparti.length === 0) {
      alert("Prima di elaborare crea almeno un reparto in Impostazioni → Reparti.");
      return;
    }

    const label = `${MESI[state.refDate.getMonth()]} ${state.refDate.getFullYear()}`;
    if (
      !confirm(
        `Pianificare automaticamente ${label}?\n\nI turni non bloccati delle settimane del mese verranno riorganizzati; quelli bloccati (🔒) restano intatti.`
      )
    )
      return;

    elaboraBtn.disabled = true;
    const testoOriginale = elaboraBtn.textContent;
    elaboraBtn.textContent = "Elaborazione…";
    try {
      const [dipendenti, ferieList] = await Promise.all([getDipendenti(), getFerie()]);
      const settimane = settimaneDelMese(state.refDate);
      const giorni = settimane.flat();
      const turniEsistenti = await getTurniRange(toISO(giorni[0]), toISO(giorni[giorni.length - 1]));

      const esito = pianificaMese({
        refDate: state.refDate,
        dipendenti,
        reparti,
        ferie: ferieList,
        impostazioni: imp,
        turniEsistenti,
      });

      await applicaPianificazione(esito.daEliminare, esito.daScrivere);
      await renderCurrentView();
      const r = esito.report;
      mostraReport(
        r,
        `Periodo ${formatISO(r.dallISO)} – ${formatISO(r.alISO)} (${r.settimane} settimane): ` +
          `${esito.daScrivere.length} turni creati, ${esito.daEliminare.length} rimossi.`
      );
    } catch (err) {
      // Le scritture avvengono a blocchi: un errore a metà può lasciare uno stato
      // parziale, ma rilanciare l'elaborazione riorganizza comunque tutto.
      alert("Errore durante l'elaborazione. Riprova: una nuova elaborazione sistema anche eventuali turni parziali.");
    } finally {
      elaboraBtn.disabled = false;
      elaboraBtn.textContent = testoOriginale;
    }
  });
}

if (analisiBtn) {
  analisiBtn.addEventListener("click", async () => {
    analisiBtn.disabled = true;
    const testoOriginale = analisiBtn.textContent;
    analisiBtn.textContent = "Verifica…";
    try {
      const [dipendenti, reparti, ferieList, imp] = await Promise.all([
        getDipendenti(),
        getReparti(),
        getFerie(),
        getImpostazioni(),
      ]);
      const settimane = settimaneDelMese(state.refDate);
      const giorni = settimane.flat();
      const turniEsistenti = await getTurniRange(toISO(giorni[0]), toISO(giorni[giorni.length - 1]));

      const r = analizzaMese({
        refDate: state.refDate,
        dipendenti,
        reparti,
        ferie: ferieList,
        impostazioni: imp,
        turniEsistenti,
      });

      mostraReport(
        r,
        `Periodo ${formatISO(r.dallISO)} – ${formatISO(r.alISO)} (${r.settimane} settimane): stato attuale del calendario, nessuna modifica.`
      );
    } catch (err) {
      alert("Errore durante l'analisi. Riprova.");
    } finally {
      analisiBtn.disabled = false;
      analisiBtn.textContent = testoOriginale;
    }
  });
}

// --- Filtro e legenda reparti ---

async function populateRepartiUI() {
  const reparti = await getReparti();
  repartoFiltroSelect.innerHTML =
    `<option value="">Tutti</option>` +
    reparti.map((r) => `<option value="${r.nome}">${r.nome}</option>`).join("");
}

repartoFiltroSelect.addEventListener("change", () => {
  state.repartoFiltro = repartoFiltroSelect.value;
  renderCurrentView();
});

// --- Avvio ---

await populateRepartiUI();
setView("mese");
