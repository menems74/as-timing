// Livello dati "finto" per la fase di sola UI: usa localStorage al posto di Firestore.
// Le funzioni esposte (getDipendenti, addTurno, ecc.) sono pensate per essere
// sostituite in futuro da chiamate reali a Firestore senza cambiare le pagine che le usano.

const KEYS = {
  dipendenti: "astiming_dipendenti",
  turni: "astiming_turni",
  ferie: "astiming_ferie",
  reparti: "astiming_reparti",
};

export const MAX_REPARTI = 4;

function load(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw) return JSON.parse(raw);
  localStorage.setItem(key, JSON.stringify(fallback));
  return fallback;
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid() {
  return crypto.randomUUID();
}

const SEED_DIPENDENTI = [
  { id: uid(), nome: "Mario", cognome: "Rossi", ruolo: "responsabile", email: "mario.rossi@example.com", note: "" },
  { id: uid(), nome: "Anna", cognome: "Bianchi", ruolo: "dipendente", email: "anna.bianchi@example.com", note: "" },
  { id: uid(), nome: "Luca", cognome: "Verdi", ruolo: "dipendente", email: "luca.verdi@example.com", note: "" },
  { id: uid(), nome: "Giulia", cognome: "Ferrari", ruolo: "dipendente", email: "giulia.ferrari@example.com", note: "" },
];

// --- Dipendenti ---

export function getDipendenti() {
  return load(KEYS.dipendenti, SEED_DIPENDENTI);
}

export function addDipendente(dati) {
  const list = getDipendenti();
  list.push({ id: uid(), ...dati });
  save(KEYS.dipendenti, list);
  return list;
}

export function updateDipendente(id, patch) {
  const list = getDipendenti().map((d) => (d.id === id ? { ...d, ...patch } : d));
  save(KEYS.dipendenti, list);
  return list;
}

export function deleteDipendente(id) {
  const list = getDipendenti().filter((d) => d.id !== id);
  save(KEYS.dipendenti, list);
  return list;
}

// --- Turni ---
// Chiave turno: `${dipendenteId}_${dataISO}` -> { tipo, orario, reparto, bloccato }

export function getTurni() {
  return load(KEYS.turni, {});
}

export function turnoKey(dipendenteId, dataISO) {
  return `${dipendenteId}_${dataISO}`;
}

export function setTurno(dipendenteId, dataISO, turno) {
  const turni = getTurni();
  turni[turnoKey(dipendenteId, dataISO)] = turno;
  save(KEYS.turni, turni);
  return turni;
}

export function removeTurno(dipendenteId, dataISO) {
  const turni = getTurni();
  delete turni[turnoKey(dipendenteId, dataISO)];
  save(KEYS.turni, turni);
  return turni;
}

export function moveTurno(fromDipendenteId, fromDataISO, toDipendenteId, toDataISO) {
  const turni = getTurni();
  const fromKey = turnoKey(fromDipendenteId, fromDataISO);
  const toKey = turnoKey(toDipendenteId, toDataISO);
  const turno = turni[fromKey];
  if (!turno || turno.bloccato) return turni;
  delete turni[fromKey];
  turni[toKey] = turno;
  save(KEYS.turni, turni);
  return turni;
}

// --- Ferie e permessi ---

export function getFerie() {
  return load(KEYS.ferie, []);
}

export function addFerie(dati) {
  const list = getFerie();
  list.push({ id: uid(), ...dati });
  save(KEYS.ferie, list);
  return list;
}

export function deleteFerie(id) {
  const list = getFerie().filter((f) => f.id !== id);
  save(KEYS.ferie, list);
  return list;
}

export function isInFerie(dipendenteId, dataISO) {
  return getFerie().some(
    (f) => f.dipendenteId === dipendenteId && dataISO >= f.dataInizio && dataISO <= f.dataFine
  );
}

// --- Reparti ---
// { id, nome, dipendentiIds: [id, ...] }

const SEED_REPARTI = [];

export function getReparti() {
  return load(KEYS.reparti, SEED_REPARTI);
}

export function addReparto(nome) {
  const list = getReparti();
  if (list.length >= MAX_REPARTI) return list;
  list.push({ id: uid(), nome, dipendentiIds: [] });
  save(KEYS.reparti, list);
  return list;
}

export function updateReparto(id, patch) {
  const list = getReparti().map((r) => (r.id === id ? { ...r, ...patch } : r));
  save(KEYS.reparti, list);
  return list;
}

export function deleteReparto(id) {
  const list = getReparti().filter((r) => r.id !== id);
  save(KEYS.reparti, list);
  return list;
}

export function toggleDipendenteReparto(repartoId, dipendenteId) {
  const list = getReparti().map((r) => {
    if (r.id !== repartoId) return r;
    const has = r.dipendentiIds.includes(dipendenteId);
    return {
      ...r,
      dipendentiIds: has
        ? r.dipendentiIds.filter((id) => id !== dipendenteId)
        : [...r.dipendentiIds, dipendenteId],
    };
  });
  save(KEYS.reparti, list);
  return list;
}

export function repartiDiDipendente(dipendenteId) {
  return getReparti().filter((r) => r.dipendentiIds.includes(dipendenteId));
}
