// Livello dati reale su Firestore. Sostituisce mock-data.js (localStorage).
// A differenza del mock, queste funzioni sono ASYNC (Firestore è sempre a Promise):
// ogni pagina deve fare `await` e ri-renderizzare dopo la risposta.
//
// Alcune funzioni che nel mock leggevano da sole lo storage globale (isInFerie,
// repartoByNome, repartiDiDipendente, isGiornoChiusura, isDirettore,
// getDipendentiTurnabili) qui diventano funzioni "pure": ricevono la lista/oggetto
// già caricato come parametro, invece di andare a fare una query ogni volta.
// Le pagine caricano dipendenti/reparti/impostazioni una volta per render e le
// passano a queste funzioni, per non moltiplicare le letture da Firestore.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./app.js?v=17";

export const MAX_REPARTI = 4;

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function withId(docSnap) {
  return { id: docSnap.id, ...docSnap.data() };
}

const dipendentiCol = collection(db, "dipendenti");
const turniCol = collection(db, "turni");
const ferieCol = collection(db, "ferie");
const repartiCol = collection(db, "reparti");
const amministratoriCol = collection(db, "amministratori");
const dipendentiLoginCol = collection(db, "dipendenti_login");
const impostazioniRef = doc(db, "impostazioni", "generale");

// --- Dipendenti ---

export async function getDipendenti() {
  const snap = await getDocs(dipendentiCol);
  return snap.docs.map(withId);
}

async function syncLoginDoc(dipendenteId, oldEmail, newEmail) {
  const oldNorm = normalizeEmail(oldEmail);
  const newNorm = normalizeEmail(newEmail);
  if (oldNorm === newNorm) {
    if (newNorm) await setDoc(doc(dipendentiLoginCol, newNorm), { dipendenteId });
    return;
  }
  if (oldNorm) await deleteDoc(doc(dipendentiLoginCol, oldNorm));
  if (newNorm) await setDoc(doc(dipendentiLoginCol, newNorm), { dipendenteId });
}

export async function addDipendente(dati) {
  const ref = await addDoc(dipendentiCol, dati);
  await syncLoginDoc(ref.id, "", dati.email);
  return getDipendenti();
}

export async function updateDipendente(id, patch) {
  const ref = doc(dipendentiCol, id);
  const prima = await getDoc(ref);
  const oldEmail = prima.exists() ? prima.data().email : "";
  await updateDoc(ref, patch);
  if (Object.prototype.hasOwnProperty.call(patch, "email")) {
    await syncLoginDoc(id, oldEmail, patch.email);
  }
  return getDipendenti();
}

export async function deleteDipendente(id) {
  const ref = doc(dipendentiCol, id);
  const snap = await getDoc(ref);
  const email = snap.exists() ? snap.data().email : "";
  await deleteDoc(ref);
  if (normalizeEmail(email)) await deleteDoc(doc(dipendentiLoginCol, normalizeEmail(email)));
  return getDipendenti();
}

// --- Turni ---
// Doc id: `${dipendenteId}_${dataISO}`. Campi: { dipendenteId, dataISO, tipo, orario, reparto, bloccato }.

export function turnoKey(dipendenteId, dataISO) {
  return `${dipendenteId}_${dataISO}`;
}

// Restituisce { [turnoKey]: turno } per tutti i dipendenti nell'intervallo [startISO, endISO] incluso.
export async function getTurniRange(startISO, endISO) {
  const q = query(turniCol, where("dataISO", ">=", startISO), where("dataISO", "<=", endISO));
  const snap = await getDocs(q);
  const out = {};
  snap.docs.forEach((d) => {
    out[d.id] = d.data();
  });
  return out;
}

// Variante per il Dipendente in sola lettura: le Security Rules gli permettono di
// leggere solo i propri turni, quindi la query deve filtrare per dipendenteId
// (un filtro di sola data, senza vincolo di uguaglianza, verrebbe respinto in blocco).
// Nessun range sulla data qui: si filtra il range lato client per evitare un indice composito.
export async function getTurniPerDipendente(dipendenteId) {
  const q = query(turniCol, where("dipendenteId", "==", dipendenteId));
  const snap = await getDocs(q);
  const out = {};
  snap.docs.forEach((d) => {
    out[d.id] = d.data();
  });
  return out;
}

export async function setTurno(dipendenteId, dataISO, turno) {
  const ref = doc(turniCol, turnoKey(dipendenteId, dataISO));
  await setDoc(ref, { dipendenteId, dataISO, ...turno });
}

export async function removeTurno(dipendenteId, dataISO) {
  await deleteDoc(doc(turniCol, turnoKey(dipendenteId, dataISO)));
}

export async function moveTurno(fromDipendenteId, fromDataISO, toDipendenteId, toDataISO) {
  const fromRef = doc(turniCol, turnoKey(fromDipendenteId, fromDataISO));
  const fromSnap = await getDoc(fromRef);
  if (!fromSnap.exists() || fromSnap.data().bloccato) return;

  const toRef = doc(turniCol, turnoKey(toDipendenteId, toDataISO));
  const { dipendenteId, dataISO, ...turno } = fromSnap.data();

  const batch = writeBatch(db);
  batch.set(toRef, { dipendenteId: toDipendenteId, dataISO: toDataISO, ...turno });
  batch.delete(fromRef);
  await batch.commit();
}

// --- Ferie e permessi ---

export async function getFerie() {
  const snap = await getDocs(ferieCol);
  return snap.docs.map(withId);
}

export async function addFerie(dati) {
  await addDoc(ferieCol, dati);
  return getFerie();
}

export async function deleteFerie(id) {
  await deleteDoc(doc(ferieCol, id));
  return getFerie();
}

// Variante per il Dipendente in sola lettura: stesso motivo di getTurniPerDipendente.
export async function getFeriePerDipendente(dipendenteId) {
  const q = query(ferieCol, where("dipendenteId", "==", dipendenteId));
  const snap = await getDocs(q);
  return snap.docs.map(withId);
}

// Pura: ferieList va caricata a parte con getFerie().
export function isInFerie(dipendenteId, dataISO, ferieList) {
  return ferieList.some(
    (f) => f.dipendenteId === dipendenteId && dataISO >= f.dataInizio && dataISO <= f.dataFine
  );
}

// --- Reparti ---

export async function getReparti() {
  const snap = await getDocs(repartiCol);
  return snap.docs.map(withId);
}

export async function addReparto(nome, colore) {
  const attuali = await getReparti();
  if (attuali.length >= MAX_REPARTI) return attuali;
  await addDoc(repartiCol, { nome, colore: colore || "#0d9488", dipendentiIds: [] });
  return getReparti();
}

export async function updateReparto(id, patch) {
  await updateDoc(doc(repartiCol, id), patch);
  return getReparti();
}

export async function deleteReparto(id) {
  await deleteDoc(doc(repartiCol, id));
  return getReparti();
}

export async function toggleDipendenteReparto(repartoId, dipendenteId) {
  const ref = doc(repartiCol, repartoId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return getReparti();
  const dipendentiIds = snap.data().dipendentiIds || [];
  const has = dipendentiIds.includes(dipendenteId);
  const next = has ? dipendentiIds.filter((id) => id !== dipendenteId) : [...dipendentiIds, dipendenteId];
  await updateDoc(ref, { dipendentiIds: next });
  return getReparti();
}

// Pure: repartiList va caricata a parte con getReparti().
export function repartiDiDipendente(dipendenteId, repartiList) {
  return repartiList.filter((r) => r.dipendentiIds.includes(dipendenteId));
}

export function repartoByNome(nome, repartiList) {
  return repartiList.find((r) => r.nome === nome);
}

// --- Impostazioni generali ---

const DEFAULT_REGOLE_ALGORITMO = `Vincoli rigidi:
- Rispettare tutti i turni pre-assegnati e bloccati manualmente dall'Admin.
- Garantire a ciascun dipendente esattamente 1 giorno libero a settimana.
- Rispettare le competenze di reparto (i dipendenti jolly, cioè abilitati su più reparti, possono coprire qualsiasi reparto).
- Non assegnare mai turni nel giorno libero programmato del dipendente.
- Nessun turno nel giorno di chiusura settimanale del negozio.

Vincoli di equità mensile:
- Garantire a ciascun dipendente almeno 2 domeniche libere al mese, distribuendo i turni domenicali in modo equo tra il personale disponibile.
- Bilanciare le ore totali mensili lavorate in modo che ogni dipendente si avvicini il più possibile al proprio monte ore contrattuale, compensando settimane più cariche con settimane più scariche.`;

const SEED_IMPOSTAZIONI = {
  giornoChiusura: "",
  regoleAlgoritmo: DEFAULT_REGOLE_ALGORITMO,
  orariDefault: {
    mattina: "9:00-13:00",
    pomeriggio: "15:00-19:30",
    giornata: "9:00-19:00",
  },
  direttoreId: "",
};

export async function getImpostazioni() {
  const snap = await getDoc(impostazioniRef);
  if (!snap.exists()) {
    await setDoc(impostazioniRef, SEED_IMPOSTAZIONI);
    return { ...SEED_IMPOSTAZIONI };
  }
  const stored = snap.data();
  return { ...SEED_IMPOSTAZIONI, ...stored, orariDefault: { ...SEED_IMPOSTAZIONI.orariDefault, ...stored.orariDefault } };
}

export async function updateImpostazioni(patch) {
  const attuali = await getImpostazioni();
  const next = { ...attuali, ...patch };
  await setDoc(impostazioniRef, next);
  return next;
}

// Pure: impostazioni va caricata a parte con getImpostazioni().
export function isGiornoChiusura(date, impostazioni) {
  const { giornoChiusura } = impostazioni;
  if (giornoChiusura === "" || giornoChiusura === null || giornoChiusura === undefined) return false;
  const dow = (date.getDay() + 6) % 7; // 0 = lunedì ... 6 = domenica
  return dow === Number(giornoChiusura);
}

export function isDirettore(dipendenteId, impostazioni) {
  const { direttoreId } = impostazioni;
  return !!direttoreId && direttoreId === dipendenteId;
}

// Pura: dipendentiList e impostazioni vanno caricate a parte.
export function getDipendentiTurnabili(dipendentiList, impostazioni) {
  return dipendentiList.filter((d) => !isDirettore(d.id, impostazioni));
}

// --- Autenticazione: risoluzione ruolo (usate da auth.js) ---

export async function findAmministratore(email) {
  const snap = await getDoc(doc(amministratoriCol, normalizeEmail(email)));
  return snap.exists() ? snap.data() : null;
}

export async function findLoginDipendente(email) {
  const loginSnap = await getDoc(doc(dipendentiLoginCol, normalizeEmail(email)));
  if (!loginSnap.exists()) return null;
  const { dipendenteId } = loginSnap.data();
  const dipSnap = await getDoc(doc(dipendentiCol, dipendenteId));
  if (!dipSnap.exists()) return null;
  return withId(dipSnap);
}
