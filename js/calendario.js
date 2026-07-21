import { requireSession } from "./auth.js?v=43";
import {
  getDipendenti,
  getDipendentiTurnabili,
  getTurniRange,
  getTurniPerDipendente,
  turnoKey,
  setTurnoGiorno,
  removeTurno,
  moveSlot,
  isInFerie,
  getFerie,
  getFeriePerDipendente,
  getReparti,
  repartiDiDipendente,
  repartoByNome,
  isGiornoChiusura,
  getImpostazioni,
  applicaPianificazione,
} from "./data.js?v=43";
import {
  pianificaMese,
  analizzaMese,
  settimaneDelMese,
  SLOTS,
  SLOT_LABEL,
  CAMPI_SLOT,
  slotAttivo,
} from "./algoritmo.js?v=43";

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
const modalRepartoHint = document.getElementById("modal-reparto-hint");
const modalDeleteBtn = document.getElementById("modal-delete-btn");
const modalCancelBtn = document.getElementById("modal-cancel-btn");
const modalGiornataBtn = document.getElementById("modal-giornata-btn");

// Riferimenti alle due sezioni indipendenti del modale (una per slot).
const slotRefs = {
  mattina: {
    attiva: document.getElementById("modal-mattina-attiva"),
    campi: document.getElementById("modal-mattina-campi"),
    reparto: document.getElementById("modal-mattina-reparto"),
    orario: document.getElementById("modal-mattina-orario"),
    bloccato: document.getElementById("modal-mattina-bloccato"),
  },
  pomeriggio: {
    attiva: document.getElementById("modal-pomeriggio-attiva"),
    campi: document.getElementById("modal-pomeriggio-campi"),
    reparto: document.getElementById("modal-pomeriggio-reparto"),
    orario: document.getElementById("modal-pomeriggio-orario"),
    bloccato: document.getElementById("modal-pomeriggio-bloccato"),
  },
};

let modalTarget = null; // { dipendenteId, dataISO }
let dragSource = null; // { dipendenteId, dataISO, slot }

// --- Rendering label periodo ---

function updatePeriodLabel() {
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
    periodLabel.textContent = `${GIORNI_SETT_LUNGHI[dow]} ${state.refDate.getDate()} ${MESI[state.refDate.getMonth()]} ${state.refDate.getFullYear()}`;
  }
}

// --- Cella turno (usata da vista mese e settimana): due metà indipendenti,
// una per slot, colorate col colore del reparto (mai per tipo di turno) —
// così un dipendente con reparti diversi a mattina e pomeriggio è leggibile
// a colpo d'occhio ed è la cella stessa (per metà) il bersaglio di
// drag&drop/click, non più l'intera giornata.

function buildCellaHtml(dipendenteId, dataISO) {
  const turno = cache.turni[turnoKey(dipendenteId, dataISO)];
  const inFerie = isInFerie(dipendenteId, dataISO, cache.ferie);

  if (inFerie) {
    return `<div class="h-10 rounded bg-orange-100 border border-orange-300 text-orange-800 text-[11px] flex items-center justify-center font-bold" title="Ferie/Permesso">F</div>`;
  }

  const filtro = state.repartoFiltro;

  const halfHtml = (slot) => {
    const c = CAMPI_SLOT[slot];
    const attivo = slotAttivo(turno, slot);
    const cursorClass = session.privileged ? "cursor-pointer" : "";

    if (!attivo) {
      const hint = session.privileged ? `Doppio click: assegna ${SLOT_LABEL[slot]}` : "";
      return `<div class="flex-1 h-10 rounded border border-dashed border-slate-200 ${cursorClass} hover:border-slate-400 hover:bg-slate-50 transition-colors" data-slot="${slot}" title="${hint}"></div>`;
    }

    const repNome = turno[c.reparto];
    const reparto = repartoByNome(repNome, cache.reparti);
    const bloccato = !!turno[c.bloccato];
    const dimClass = filtro && repNome !== filtro ? "opacity-25" : "";
    const style = reparto
      ? `background-color:${reparto.colore}22;border-color:${reparto.colore}80;`
      : "background-color:#f8fafc;border-color:#cbd5e1;";
    const lockClass = bloccato ? "ring-2 ring-red-400" : "";
    const lockIcon = bloccato ? `<span class="text-[8px] leading-none">🔒</span>` : "";
    const title = `${SLOT_LABEL[slot]}${turno[c.orario] ? " · " + turno[c.orario] : ""} · ${repNome}`;

    return `
      <div class="flex-1 h-10 rounded border ${lockClass} ${dimClass} ${cursorClass} flex flex-col items-center justify-center gap-0.5 select-none transition-opacity"
           style="${style}" title="${title}" data-slot="${slot}"
           draggable="${!!(session.privileged && !bloccato)}">
        ${lockIcon}
        <span class="text-[9px] font-semibold text-slate-600 truncate max-w-full px-0.5 leading-none">${repNome.slice(0, 4)}</span>
      </div>
    `;
  };

  return `<div class="h-10 flex gap-0.5">${halfHtml("mattina")}${halfHtml("pomeriggio")}</div>`;
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
    if (!turno) continue;
    const nome = `${dip.nome} ${dip.cognome}`;
    if (turno.repartoMattina === reparto.nome) mattina.push(nome);
    if (turno.repartoPomeriggio === reparto.nome) pomeriggio.push(nome);
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

// --- Vista Giorno (card per dipendente, uno slot per riga) ---

function repartoPrincipale(turno) {
  if (!turno) return "";
  return turno.repartoMattina || turno.repartoPomeriggio || "";
}

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

  // Ordina i dipendenti:
  // 1. Chi lavora (ordinato per reparto principale alfabetico)
  // 2. Chi è in ferie / permesso
  // 3. Chi non ha turno
  const sortedDipendenti = [...dipendenti].sort((a, b) => {
    const aInFerie = isInFerie(a.id, iso, cache.ferie);
    const bInFerie = isInFerie(b.id, iso, cache.ferie);
    const aTurno = cache.turni[turnoKey(a.id, iso)];
    const bTurno = cache.turni[turnoKey(b.id, iso)];

    const aCat = aTurno ? 0 : aInFerie ? 1 : 2;
    const bCat = bTurno ? 0 : bInFerie ? 1 : 2;

    if (aCat !== bCat) return aCat - bCat;

    if (aCat === 0) {
      const aRep = repartoPrincipale(aTurno);
      const bRep = repartoPrincipale(bTurno);
      if (aRep !== bRep) return aRep.localeCompare(bRep);
    }

    const aFull = `${a.cognome} ${a.nome}`.toLowerCase();
    const bFull = `${b.cognome} ${b.nome}`.toLowerCase();
    return aFull.localeCompare(bFull);
  });

  const filtro = state.repartoFiltro;

  const cards = sortedDipendenti
    .map((dip) => {
      const inFerie = isInFerie(dip.id, iso, cache.ferie);
      const turno = cache.turni[turnoKey(dip.id, iso)];
      const match = !filtro || (turno && (turno.repartoMattina === filtro || turno.repartoPomeriggio === filtro));
      const dimClass = match ? "" : "opacity-30";

      let leftBorderColor = "#cbd5e1"; // slate-300 default
      let bodyHtml;

      if (inFerie) {
        leftBorderColor = "#fb923c"; // orange-400
        bodyHtml = `
          <div class="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold bg-orange-50 text-orange-800 border border-orange-200">
            <span class="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span>
            Ferie/Permesso
          </div>
        `;
      } else if (turno) {
        const repPrincipaleNome = repartoPrincipale(turno);
        const repPrincipale = repPrincipaleNome ? repartoByNome(repPrincipaleNome, cache.reparti) : null;
        leftBorderColor = repPrincipale ? repPrincipale.colore : "#3b82f6";

        const rigaSlot = (slot) => {
          const c = CAMPI_SLOT[slot];
          const repNome = turno[c.reparto];
          if (!repNome) {
            return `<div class="flex items-center justify-between text-[11px] text-slate-300 italic">
              <span>${SLOT_LABEL[slot]}</span><span>—</span>
            </div>`;
          }
          const reparto = repartoByNome(repNome, cache.reparti);
          const colore = reparto ? reparto.colore : "#3b82f6";
          const bloccato = !!turno[c.bloccato];
          return `
            <div class="flex items-center justify-between gap-1.5 text-[11px]">
              <span class="text-slate-400 font-medium shrink-0">${SLOT_LABEL[slot]}</span>
              <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-bold text-slate-700 border truncate"
                    style="background:${colore}18; border-color:${colore}60;">
                ${bloccato ? "🔒 " : ""}${repNome}
              </span>
              ${turno[c.orario] ? `<span class="text-slate-500 font-medium shrink-0">${turno[c.orario]}</span>` : ""}
            </div>
          `;
        };

        bodyHtml = `<div class="space-y-1.5">${rigaSlot("mattina")}${rigaSlot("pomeriggio")}</div>`;
      } else {
        bodyHtml = `
          <span class="text-[10px] font-medium text-slate-400 italic bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
            Nessun turno
          </span>
        `;
      }

      const ruoloLabel = dip.ruolo ? dip.ruolo.charAt(0).toUpperCase() + dip.ruolo.slice(1) : "Dipendente";
      const clickable = session.privileged && !inFerie;
      const cardHoverClass = clickable
        ? "cursor-pointer hover:shadow-md hover:border-slate-300 hover:bg-slate-50/50 hover:-translate-y-0.5 active:translate-y-0"
        : "bg-white";

      return `
        <div class="bg-white rounded-lg border border-slate-200 shadow-sm p-3 flex flex-col justify-between min-h-[85px] transition-all duration-200 ${cardHoverClass} ${dimClass}"
             style="border-left: 5px solid ${leftBorderColor}"
             ${clickable ? `data-cell data-dipendente="${dip.id}" data-data="${iso}"` : ""}>
          <div class="mb-1.5">
            <h4 class="font-bold text-slate-800 text-sm leading-tight">${dip.nome} ${dip.cognome}</h4>
            <p class="text-[9px] font-semibold text-slate-400 mt-0.5 uppercase tracking-wider">${ruoloLabel}</p>
          </div>
          <div class="border-t border-slate-100/80 pt-2">
            ${bodyHtml}
          </div>
        </div>
      `;
    })
    .join("");

  setContentHtml(`<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-1">${cards}</div>`);

  attachCellHandlers();
}

// --- Interazioni cella: click per aprire modale, drag & drop per singolo slot ---

function attachCellHandlers() {
  if (!session.privileged) return; // sola lettura: nessuna modifica possibile

  if (state.view === "giorno") {
    content.querySelectorAll("[data-cell]").forEach((cell) => {
      cell.addEventListener("click", () => openModal(cell.dataset.dipendente, cell.dataset.data));
    });
    return;
  }

  content.querySelectorAll("[data-cell]").forEach((cell) => {
    const dipendenteId = cell.dataset.dipendente;
    const dataISO = cell.dataset.data;

    cell.querySelectorAll("[data-slot]").forEach((slotEl) => {
      slotEl.addEventListener("dblclick", () => openModal(dipendenteId, dataISO));

      if (slotEl.getAttribute("draggable") === "true") {
        slotEl.addEventListener("dragstart", (e) => {
          dragSource = { dipendenteId, dataISO, slot: slotEl.dataset.slot };
          e.dataTransfer.effectAllowed = "move";
        });
      }

      slotEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        slotEl.classList.add("bg-slate-200");
      });
      slotEl.addEventListener("dragleave", () => slotEl.classList.remove("bg-slate-200"));
      slotEl.addEventListener("drop", async (e) => {
        e.preventDefault();
        slotEl.classList.remove("bg-slate-200");
        if (!dragSource) return;

        const targetSlot = slotEl.dataset.slot;
        const targetInFerie = isInFerie(dipendenteId, dataISO, cache.ferie);

        if (targetInFerie) {
          alert("Il dipendente è in ferie/permesso in questo giorno.");
        } else {
          try {
            await moveSlot(dragSource.dipendenteId, dragSource.dataISO, dragSource.slot, dipendenteId, dataISO, targetSlot);
            await renderCurrentView();
          } catch (err) {
            if (err.message === "CELLA_OCCUPATA") {
              alert("Lo slot di destinazione ha già un turno assegnato.");
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
  });
}

// --- Modale turno: due sezioni indipendenti (Mattina/Pomeriggio) più la
// scorciatoia "Giornata intera" che le compila insieme in un click. ---

function populateSelectReparto(selectEl, dipendenteId, repartoSelezionato) {
  const tuttiReparti = cache.reparti.map((r) => r.nome);
  const compatibili = repartiDiDipendente(dipendenteId, cache.reparti).map((r) => r.nome);

  selectEl.innerHTML =
    tuttiReparti.length === 0
      ? `<option value="">Nessun reparto disponibile</option>`
      : tuttiReparti.map((nome) => `<option value="${nome}">${nome}</option>`).join("");

  selectEl.value = repartoSelezionato || compatibili[0] || tuttiReparti[0] || "";

  return compatibili.length === 0 && tuttiReparti.length > 0;
}

function orarioDefaultPerSlot(slot) {
  return (cache.impostazioni?.orariDefault || {})[slot] || "";
}

function refreshSlotEnabled(slot) {
  const r = slotRefs[slot];
  const on = r.attiva.checked;
  r.campi.classList.toggle("opacity-40", !on);
  r.campi.classList.toggle("pointer-events-none", !on);
}

SLOTS.forEach((slot) => {
  slotRefs[slot].attiva.addEventListener("change", () => refreshSlotEnabled(slot));
});

function openModal(dipendenteId, dataISO) {
  if (isInFerie(dipendenteId, dataISO, cache.ferie)) return;

  modalTarget = { dipendenteId, dataISO };
  const turno = cache.turni[turnoKey(dipendenteId, dataISO)];
  const dip = cache.dipendenti.find((d) => d.id === dipendenteId);

  modalTitleNome.textContent = dip ? `${dip.nome} ${dip.cognome}` : "";
  modalTitleData.textContent = dataISO.split("-").reverse().join("/");

  let mancaCompatibile = false;
  for (const slot of SLOTS) {
    const r = slotRefs[slot];
    const c = CAMPI_SLOT[slot];
    const attivo = slotAttivo(turno, slot);
    r.attiva.checked = attivo;
    const senzaCompat = populateSelectReparto(r.reparto, dipendenteId, attivo ? turno[c.reparto] : "");
    mancaCompatibile = mancaCompatibile || senzaCompat;
    r.orario.value = attivo ? turno[c.orario] || "" : orarioDefaultPerSlot(slot);
    r.bloccato.checked = attivo && !!turno[c.bloccato];
    refreshSlotEnabled(slot);
  }

  if (mancaCompatibile) {
    modalRepartoHint.textContent =
      "Nessun reparto assegnato a questo dipendente in Impostazioni → Reparti: puoi comunque scegliere tra tutti quelli disponibili.";
    modalRepartoHint.classList.remove("hidden");
  } else {
    modalRepartoHint.classList.add("hidden");
  }

  modalDeleteBtn.classList.toggle("hidden", !turno);

  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

modalGiornataBtn.addEventListener("click", () => {
  const repartoComune = slotRefs.mattina.reparto.value || slotRefs.pomeriggio.reparto.value;
  const orarioGiornata = orarioDefaultPerSlot("giornata");
  for (const slot of SLOTS) {
    const r = slotRefs[slot];
    r.attiva.checked = true;
    if (repartoComune) r.reparto.value = repartoComune;
    r.orario.value = orarioGiornata;
    refreshSlotEnabled(slot);
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

  const payload = {};
  for (const slot of SLOTS) {
    const r = slotRefs[slot];
    payload[slot] = r.attiva.checked
      ? { reparto: r.reparto.value.trim(), orario: r.orario.value.trim(), bloccato: r.bloccato.checked }
      : null;
  }

  try {
    await setTurnoGiorno(modalTarget.dipendenteId, modalTarget.dataISO, payload);
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

function sezioneReport(titolo, righe, colore, collassabile = false) {
  if (righe.length === 0) return "";
  const palette = {
    rosso: "bg-red-50 border-red-200 text-red-800",
    ambra: "bg-amber-50 border-amber-200 text-amber-800",
  }[colore];
  const lista = `<ul class="list-disc list-inside space-y-0.5">${righe.map((r) => `<li>${r}</li>`).join("")}</ul>`;

  if (collassabile) {
    // Chiusa di default: la freccia ruota di 90° quando <details> è aperto (:open).
    return `
      <details class="rounded-lg border p-3 ${palette} group">
        <summary class="font-semibold cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex items-center gap-2">
          <span class="inline-block transition-transform group-open:rotate-90">▶</span>
          ${titolo} (${righe.length})
        </summary>
        <div class="mt-1.5">${lista}</div>
      </details>
    `;
  }

  return `
    <div class="rounded-lg border p-3 ${palette}">
      <p class="font-semibold mb-1.5">${titolo} (${righe.length})</p>
      ${lista}
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
      "ambra",
      true
    ),
    sezioneReport(
      "Sopra il monte ore contrattuale",
      [...r.oreSopra]
        .sort((a, b) => a.nome.localeCompare(b.nome, "it") || a.settimana.localeCompare(b.settimana))
        .map((v) => `${v.nome} — settimana del ${formatISO(v.settimana)}: ${v.ore}h su ${v.contratto}h`),
      "ambra",
      true
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
    if (!(oreT.mattina > 0) || !(oreT.pomeriggio > 0)) {
      alert("Prima di elaborare imposta le durate in ore di mattina e pomeriggio in Impostazioni → Generali.");
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
        `Pianificare automaticamente ${label}?\n\nGli slot non bloccati delle settimane del mese verranno riorganizzati; quelli bloccati (🔒) restano intatti.`
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
          `${esito.daScrivere.length} giorni pianificati, ${esito.daEliminare.length} rimossi.`
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
