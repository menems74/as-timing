// Motore di pianificazione automatica dei turni.
//
// Funzione PURA: riceve tutti i dati già caricati (dipendenti, reparti, ferie,
// impostazioni, turni esistenti) e restituisce cosa eliminare, cosa scrivere e
// il report anomalie — senza toccare Firestore. Così è testabile in isolamento
// e il chiamante decide come applicare il risultato.
//
// Ogni giorno un dipendente ha due SLOT indipendenti (mattina/pomeriggio),
// ciascuno assegnabile a un reparto diverso (es. mattina in Cassa, pomeriggio
// in Gialla): il documento turni/{dipendenteId}_{dataISO} porta i campi piatti
// repartoX/orarioX/bloccatoX per X in Mattina/Pomeriggio (CAMPI_SLOT sotto).
//
// Regole implementate (vedi Impostazioni → Generali → Regole):
// - Pianifica per settimane intere lun→dom: tutte le settimane il cui lunedì
//   cade nel mese scelto. L'ultima può sconfinare nel mese successivo; la
//   settimana spezzata a inizio mese è già stata pianificata dal mese prima.
// - Solo gli slot bloccati (🔒) sono intoccabili; gli slot non bloccati dei
//   dipendenti pianificabili vengono eliminati e rigenerati.
// - 1 giorno libero a settimana per ciascuno (la chiusura settimanale conta
//   come giorno libero); il direttore non viene mai schedulato.
// - Ferie/permessi = indisponibilità: il dipendente non viene contato in quei
//   giorni; l'eventuale sotto-ore della settimana finisce nel report.
// - Copertura minima per reparto per slot. Equità: max (domeniche del blocco
//   - 2) domeniche lavorate (conta come "lavorata" se almeno uno slot attivo).

export const SLOTS = ["mattina", "pomeriggio"];
export const SLOT_LABEL = { mattina: "Mattina", pomeriggio: "Pomeriggio" };

// Mappa slot -> nomi dei campi piatti sul documento turno. Condivisa con
// data.js (scritture Firestore) e calendario.js (rendering/form), così lo
// schema del documento è definito in un solo posto.
export const CAMPI_SLOT = {
  mattina: { reparto: "repartoMattina", orario: "orarioMattina", bloccato: "bloccatoMattina" },
  pomeriggio: { reparto: "repartoPomeriggio", orario: "orarioPomeriggio", bloccato: "bloccatoPomeriggio" },
};

export function slotAttivo(turno, slot) {
  return !!(turno && turno[CAMPI_SLOT[slot].reparto]);
}

export function slotBloccato(turno, slot) {
  return slotAttivo(turno, slot) && !!turno[CAMPI_SLOT[slot].bloccato];
}

function toISO(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Tutte le settimane (array di 7 date, lun→dom) il cui lunedì cade nel mese di refDate.
export function settimaneDelMese(refDate) {
  const anno = refDate.getFullYear();
  const mese = refDate.getMonth();
  const settimane = [];
  const ultimoGiorno = new Date(anno, mese + 1, 0).getDate();
  for (let g = 1; g <= ultimoGiorno; g++) {
    const d = new Date(anno, mese, g);
    if ((d.getDay() + 6) % 7 === 0) {
      settimane.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    }
  }
  return settimane;
}

export function pianificaMese({ refDate, dipendenti, reparti, ferie, impostazioni, turniEsistenti }) {
  const oreTurno = impostazioni.oreTurno || {};
  const orariDefault = impostazioni.orariDefault || {};
  const giornoChiusura = impostazioni.giornoChiusura ?? "";
  const direttoreId = impostazioni.direttoreId || "";

  const staff = dipendenti.filter((d) => d.id !== direttoreId);

  const settimane = settimaneDelMese(refDate);
  const giorniISO = settimane.flat().map(toISO);
  const giorniSet = new Set(giorniISO);

  const chiuso = (date) => giornoChiusura !== "" && (date.getDay() + 6) % 7 === Number(giornoChiusura);
  const inFerie = (dipId, iso) =>
    ferie.some((f) => f.dipendenteId === dipId && iso >= f.dataInizio && iso <= f.dataFine);
  const key = (dipId, iso) => `${dipId}_${iso}`;

  // --- Piano: parte dagli slot bloccati del blocco (carry-over intoccabile),
  // poi viene riempito dagli assegnamenti. I documenti esistenti del blocco
  // che restano senza nessuno slot bloccato finiscono in daEliminare (vengono
  // rigenerati da zero da questa stessa elaborazione).
  const piano = new Map(); // key -> { dipendenteId, dataISO, repartoMattina?, orarioMattina?, bloccatoMattina?, ... }
  for (const [k, t] of Object.entries(turniEsistenti)) {
    if (!giorniSet.has(t.dataISO)) continue;
    let entry = null;
    for (const slot of SLOTS) {
      if (slotBloccato(t, slot)) {
        entry = entry || { dipendenteId: t.dipendenteId, dataISO: t.dataISO };
        const c = CAMPI_SLOT[slot];
        entry[c.reparto] = t[c.reparto];
        entry[c.orario] = t[c.orario];
        entry[c.bloccato] = true;
      }
    }
    if (entry) piano.set(k, entry);
  }

  const slotDi = (dipId, iso, slot) => {
    const t = piano.get(key(dipId, iso));
    return slotAttivo(t, slot) ? t : null;
  };
  const oreGiorno = (dipId, iso) => {
    const t = piano.get(key(dipId, iso));
    if (!t) return 0;
    return SLOTS.reduce((tot, slot) => tot + (slotAttivo(t, slot) ? oreTurno[slot] || 0 : 0), 0);
  };

  // --- Equità domenicale sul blocco pianificato: conta come "lavorata" se
  // almeno uno slot è attivo quel giorno.
  const domenicheISO = settimane.map((w) => toISO(w[6]));
  const capDomenicheLavorate = Math.max(0, domenicheISO.length - 2);
  const domenicheLavorate = new Map();
  for (const dip of staff) {
    domenicheLavorate.set(dip.id, domenicheISO.filter((iso) => piano.has(key(dip.id, iso))).length);
  }

  for (const settimana of settimane) {
    const isoDays = settimana.map(toISO);
    const domenicaISO = isoDays[6];

    // --- 1 giorno libero a settimana. Con chiusura impostata è quello per tutti;
    // altrimenti viene scelto spalmandolo sui giorni, con la domenica riservata
    // in via prioritaria a chi ha già raggiunto il tetto di domeniche lavorate.
    // "Occupato" per un giorno = ha già almeno uno slot attivo (bloccato).
    const liberoDi = new Map();
    if (giornoChiusura !== "") {
      const isoChiusura = isoDays[Number(giornoChiusura)];
      for (const dip of staff) liberoDi.set(dip.id, isoChiusura);
    } else {
      const liberiPerGiorno = {};
      const ordinati = [...staff].sort(
        (a, b) => (domenicheLavorate.get(b.id) || 0) - (domenicheLavorate.get(a.id) || 0)
      );
      for (const dip of ordinati) {
        const candidati = isoDays.filter((iso) => !piano.has(key(dip.id, iso)) && !inFerie(dip.id, iso));
        if (candidati.length === 0) continue; // settimana interamente ferie/bloccata: nessun libero da fissare
        let scelto;
        if ((domenicheLavorate.get(dip.id) || 0) >= capDomenicheLavorate && candidati.includes(domenicaISO)) {
          scelto = domenicaISO;
        } else {
          scelto = candidati.reduce((best, iso) =>
            (liberiPerGiorno[iso] || 0) < (liberiPerGiorno[best] || 0) ? iso : best
          );
        }
        liberoDi.set(dip.id, scelto);
        liberiPerGiorno[scelto] = (liberiPerGiorno[scelto] || 0) + 1;
      }
    }

    // rispettaCapDomenica blocca solo l'aggiunta di una NUOVA domenica lavorata
    // oltre il tetto: se il giorno è già attivo (es. sto riempiendo il secondo
    // slot della stessa domenica) non viene ricontato né bloccato.
    const disponibile = (dip, iso, slot, rispettaCapDomenica) => {
      if (liberoDi.get(dip.id) === iso) return false;
      if (inFerie(dip.id, iso)) return false;
      if (slotDi(dip.id, iso, slot)) return false;
      if (
        rispettaCapDomenica &&
        iso === domenicaISO &&
        !piano.has(key(dip.id, iso)) &&
        (domenicheLavorate.get(dip.id) || 0) >= capDomenicheLavorate
      )
        return false;
      return true;
    };

    // Tetto ore per la copertura: assegnabile solo chi non ha ancora completato
    // il contratto. Lo sforo massimo è quindi un solo slot (l'ultimo assegnato);
    // pur di coprire un reparto non si pianificano settimane irrealistiche —
    // meglio lasciare il buco e segnalarlo nel report.
    const sottoTettoOre = (dip) => (oreSettimana.get(dip.id) || 0) < (dip.oreContrattualiSettimanali || 40);

    const oreSettimana = new Map();
    for (const dip of staff) {
      oreSettimana.set(dip.id, isoDays.reduce((tot, iso) => tot + oreGiorno(dip.id, iso), 0));
    }

    const copertura = (iso, slot, repNome) => {
      let n = 0;
      for (const t of piano.values()) {
        if (t.dataISO === iso && slotAttivo(t, slot) && t[CAMPI_SLOT[slot].reparto] === repNome) n++;
      }
      return n;
    };

    const assegna = (dip, iso, slot, repNome) => {
      const k = key(dip.id, iso);
      const giornoGiaAttivo = piano.has(k);
      const entry = piano.get(k) || { dipendenteId: dip.id, dataISO: iso };
      const c = CAMPI_SLOT[slot];
      entry[c.reparto] = repNome;
      entry[c.orario] = orariDefault[slot] || "";
      entry[c.bloccato] = false;
      piano.set(k, entry);
      oreSettimana.set(dip.id, (oreSettimana.get(dip.id) || 0) + (oreTurno[slot] || 0));
      if (iso === domenicaISO && !giornoGiaAttivo) domenicheLavorate.set(dip.id, (domenicheLavorate.get(dip.id) || 0) + 1);
    };

    // --- Fase 1: copertura minima di ogni reparto per ogni slot
    for (const [di, iso] of isoDays.entries()) {
      if (chiuso(settimana[di])) continue;
      for (const slot of SLOTS) {
        for (const rep of reparti) {
          const minimo = rep.coperturaMinima ?? 1;
          let cov = copertura(iso, slot, rep.nome);
          while (cov < minimo) {
            let candidati = staff.filter(
              (d) => rep.dipendentiIds.includes(d.id) && disponibile(d, iso, slot, true) && sottoTettoOre(d)
            );

            if (candidati.length === 0) {
              // Nessuno libero: chi lavora già l'altro slot dello stesso reparto
              // quel giorno viene esteso alla giornata intera, prima di lasciare un buco.
              const altroSlot = slot === "mattina" ? "pomeriggio" : "mattina";
              const estendibili = staff
                .filter((d) => {
                  const t = piano.get(key(d.id, iso));
                  return (
                    t &&
                    slotAttivo(t, altroSlot) &&
                    t[CAMPI_SLOT[altroSlot].reparto] === rep.nome &&
                    !slotAttivo(t, slot) &&
                    sottoTettoOre(d)
                  );
                })
                .sort((a, b) => {
                  const ra = (oreSettimana.get(a.id) || 0) / (a.oreContrattualiSettimanali || 40);
                  const rb = (oreSettimana.get(b.id) || 0) / (b.oreContrattualiSettimanali || 40);
                  return ra - rb;
                });
              if (estendibili.length > 0) {
                assegna(estendibili[0], iso, slot, rep.nome);
                cov++;
                continue;
              }
              // Se il tetto domenicale rende impossibile la copertura, l'equità cede il passo.
              if (iso === domenicaISO) {
                candidati = staff.filter(
                  (d) => rep.dipendentiIds.includes(d.id) && disponibile(d, iso, slot, false) && sottoTettoOre(d)
                );
              }
            }

            if (candidati.length === 0) break; // finirà nel report come copertura assente/parziale
            candidati.sort((a, b) => {
              const ra = (oreSettimana.get(a.id) || 0) / (a.oreContrattualiSettimanali || 40);
              const rb = (oreSettimana.get(b.id) || 0) / (b.oreContrattualiSettimanali || 40);
              return ra - rb || (domenicheLavorate.get(a.id) || 0) - (domenicheLavorate.get(b.id) || 0);
            });
            assegna(candidati[0], iso, slot, rep.nome);
            cov++;
          }
        }
      }
    }

    // --- Fase 2: monte ore. Chi è sotto contratto riceve prima lo slot mancante
    // nei giorni dove lavora già solo mezza giornata (Pass A), poi nuovi turni
    // su giorni completamente liberi se il deficit resta (Pass B).
    const perDeficit = [...staff].sort(
      (a, b) =>
        (b.oreContrattualiSettimanali || 0) -
        (oreSettimana.get(b.id) || 0) -
        ((a.oreContrattualiSettimanali || 0) - (oreSettimana.get(a.id) || 0))
    );
    for (const dip of perDeficit) {
      const contratto = dip.oreContrattualiSettimanali || 0;
      if (contratto <= 0) continue;
      const abilitati = reparti.filter((r) => r.dipendentiIds.includes(dip.id));
      if (abilitati.length === 0) continue; // nessun reparto: resterà sotto-ore nel report

      const migliorReparto = (iso) =>
        abilitati.reduce((best, r) => {
          const cr = copertura(iso, "mattina", r.nome) + copertura(iso, "pomeriggio", r.nome);
          const cb = copertura(iso, "mattina", best.nome) + copertura(iso, "pomeriggio", best.nome);
          return cr < cb ? r : best;
        });

      // Pass A: giorni dove il dipendente ha già un solo slot — riempie l'altro
      // nello stesso reparto se possibile, altrimenti nel reparto meno coperto.
      for (const iso of isoDays) {
        if ((oreSettimana.get(dip.id) || 0) >= contratto) break;
        const t = piano.get(key(dip.id, iso));
        if (!t) continue;
        for (const slot of SLOTS) {
          if ((oreSettimana.get(dip.id) || 0) >= contratto) break;
          if (slotAttivo(t, slot)) continue;
          if (!disponibile(dip, iso, slot, true)) continue;
          const altroSlot = slot === "mattina" ? "pomeriggio" : "mattina";
          const repAttuale = slotAttivo(t, altroSlot)
            ? reparti.find((r) => r.nome === t[CAMPI_SLOT[altroSlot].reparto])
            : null;
          const rep = repAttuale && abilitati.includes(repAttuale) ? repAttuale : migliorReparto(iso);
          assegna(dip, iso, slot, rep.nome);
        }
      }

      // Pass B: giorni completamente liberi, se il deficit resta.
      for (const [di, iso] of isoDays.entries()) {
        if ((oreSettimana.get(dip.id) || 0) >= contratto) break;
        if (chiuso(settimana[di])) continue;
        if (piano.has(key(dip.id, iso))) continue; // già gestito in Pass A
        for (const slot of SLOTS) {
          if ((oreSettimana.get(dip.id) || 0) >= contratto) break;
          if (!disponibile(dip, iso, slot, true)) continue;
          assegna(dip, iso, slot, migliorReparto(iso).nome);
        }
      }
    }
  }

  const daEliminare = Object.keys(turniEsistenti).filter(
    (k) => giorniSet.has(turniEsistenti[k].dataISO) && !piano.has(k)
  );

  const report = generaReport({
    settimane,
    giorniISO,
    reparti,
    staff,
    oreTurno,
    giornoChiusura,
    ferie,
    turniBlocco: [...piano.values()],
  });

  return { daEliminare, daScrivere: [...piano.values()], report };
}

// Stesso identico report di pianificaMese, ma a partire dallo stato ATTUALE
// dei turni (nessuna scrittura): serve per ricontrollare le anomalie dopo che
// il responsabile ha corretto a mano i turni proposti dall'algoritmo.
export function analizzaMese({ refDate, dipendenti, reparti, ferie, impostazioni, turniEsistenti }) {
  const oreTurno = impostazioni.oreTurno || {};
  const giornoChiusura = impostazioni.giornoChiusura ?? "";
  const direttoreId = impostazioni.direttoreId || "";
  const staff = dipendenti.filter((d) => d.id !== direttoreId);

  const settimane = settimaneDelMese(refDate);
  const giorniISO = settimane.flat().map(toISO);
  const giorniSet = new Set(giorniISO);
  const turniBlocco = Object.values(turniEsistenti).filter((t) => giorniSet.has(t.dataISO));

  return generaReport({ settimane, giorniISO, reparti, staff, oreTurno, giornoChiusura, ferie, turniBlocco });
}

// Nucleo di calcolo del report, condiviso da pianificaMese (sullo stato che
// l'algoritmo sta per scrivere) e analizzaMese (sullo stato letto da Firestore).
function generaReport({ settimane, giorniISO, reparti, staff, oreTurno, giornoChiusura, ferie, turniBlocco }) {
  const chiuso = (date) => giornoChiusura !== "" && (date.getDay() + 6) % 7 === Number(giornoChiusura);
  const inFerie = (dipId, iso) =>
    ferie.some((f) => f.dipendenteId === dipId && iso >= f.dataInizio && iso <= f.dataFine);
  const byKey = new Map(turniBlocco.map((t) => [`${t.dipendenteId}_${t.dataISO}`, t]));
  const turnoDi = (dipId, iso) => byKey.get(`${dipId}_${iso}`) || null;
  const oreGiorno = (t) => (!t ? 0 : SLOTS.reduce((tot, slot) => tot + (slotAttivo(t, slot) ? oreTurno[slot] || 0 : 0), 0));
  const domenicheISO = settimane.map((w) => toISO(w[6]));

  const copertura = (iso, slot, repNome) => {
    let n = 0;
    for (const t of turniBlocco) {
      if (t.dataISO === iso && slotAttivo(t, slot) && t[CAMPI_SLOT[slot].reparto] === repNome) n++;
    }
    return n;
  };

  const copertureAssenti = [];
  const copertureSingole = [];
  for (const settimana of settimane) {
    for (const [di, iso] of settimana.map(toISO).entries()) {
      if (chiuso(settimana[di])) continue;
      for (const slot of SLOTS) {
        for (const rep of reparti) {
          const cov = copertura(iso, slot, rep.nome);
          if (cov === 0) copertureAssenti.push({ dataISO: iso, slot, reparto: rep.nome });
          else if (cov === 1) copertureSingole.push({ dataISO: iso, slot, reparto: rep.nome });
        }
      }
    }
  }

  const oreSopra = [];
  const oreSotto = [];
  for (const settimana of settimane) {
    const isoDays = settimana.map(toISO);
    for (const dip of staff) {
      const contratto = dip.oreContrattualiSettimanali || 0;
      if (contratto <= 0) continue;
      const tot = isoDays.reduce((s, iso) => s + oreGiorno(turnoDi(dip.id, iso)), 0);
      const haFerie = isoDays.some((iso) => inFerie(dip.id, iso));
      const voce = {
        nome: `${dip.nome} ${dip.cognome}`,
        settimana: isoDays[0],
        ore: tot,
        contratto,
        haFerie,
      };
      if (tot > contratto) oreSopra.push(voce);
      else if (tot < contratto) oreSotto.push(voce);
    }
  }

  const domenicheInsufficienti = [];
  if (domenicheISO.length >= 2) {
    for (const dip of staff) {
      const libere = domenicheISO.filter((iso) => !turnoDi(dip.id, iso)).length;
      if (libere < 2) {
        domenicheInsufficienti.push({ nome: `${dip.nome} ${dip.cognome}`, libere });
      }
    }
  }

  return {
    dallISO: giorniISO[0],
    alISO: giorniISO[giorniISO.length - 1],
    settimane: settimane.length,
    copertureAssenti,
    copertureSingole,
    oreSopra,
    oreSotto,
    domenicheInsufficienti,
  };
}
