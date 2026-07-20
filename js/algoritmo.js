// Motore di pianificazione automatica dei turni.
//
// Funzione PURA: riceve tutti i dati già caricati (dipendenti, reparti, ferie,
// impostazioni, turni esistenti) e restituisce cosa eliminare, cosa scrivere e
// il report anomalie — senza toccare Firestore. Così è testabile in isolamento
// e il chiamante decide come applicare il risultato.
//
// Regole implementate (vedi Impostazioni → Generali → Regole):
// - Pianifica per settimane intere lun→dom: tutte le settimane il cui lunedì
//   cade nel mese scelto. L'ultima può sconfinare nel mese successivo; la
//   settimana spezzata a inizio mese è già stata pianificata dal mese prima.
// - Solo i turni bloccati (🔒) sono intoccabili; i non bloccati dei dipendenti
//   pianificabili vengono eliminati e rigenerati.
// - 1 giorno libero a settimana per ciascuno (la chiusura settimanale conta
//   come giorno libero); il direttore non viene mai schedulato.
// - Ferie/permessi = indisponibilità: il dipendente non viene contato in quei
//   giorni; l'eventuale sotto-ore della settimana finisce nel report.
// - Copertura minima per reparto per turno (mattina/pomeriggio; "giornata"
//   copre entrambi). Equità: max (domeniche del blocco - 2) domeniche lavorate.

const SLOTS = ["mattina", "pomeriggio"];
export const SLOT_LABEL = { mattina: "Mattina", pomeriggio: "Pomeriggio" };

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
  const staffIds = new Set(staff.map((d) => d.id));

  const settimane = settimaneDelMese(refDate);
  const giorniISO = settimane.flat().map(toISO);
  const giorniSet = new Set(giorniISO);

  const chiuso = (date) => giornoChiusura !== "" && (date.getDay() + 6) % 7 === Number(giornoChiusura);
  const inFerie = (dipId, iso) =>
    ferie.some((f) => f.dipendenteId === dipId && iso >= f.dataInizio && iso <= f.dataFine);
  const key = (dipId, iso) => `${dipId}_${iso}`;

  // --- Turni esistenti nel blocco: i bloccati restano, i non bloccati dei
  // dipendenti pianificabili vengono eliminati e rigenerati.
  const bloccati = new Map();
  const daEliminare = [];
  for (const [k, t] of Object.entries(turniEsistenti)) {
    if (!giorniSet.has(t.dataISO)) continue;
    if (t.bloccato) bloccati.set(k, t);
    else if (staffIds.has(t.dipendenteId)) daEliminare.push(k);
  }

  const piano = new Map(); // key -> nuovo turno
  const turnoDi = (dipId, iso) => bloccati.get(key(dipId, iso)) || piano.get(key(dipId, iso)) || null;
  const oreDi = (t) => (t ? oreTurno[t.tipo] || 0 : 0);

  // --- Equità domenicale sul blocco pianificato
  const domenicheISO = settimane.map((w) => toISO(w[6]));
  const capDomenicheLavorate = Math.max(0, domenicheISO.length - 2);
  const domenicheLavorate = new Map();
  for (const dip of staff) {
    domenicheLavorate.set(dip.id, domenicheISO.filter((iso) => bloccati.has(key(dip.id, iso))).length);
  }

  for (const settimana of settimane) {
    const isoDays = settimana.map(toISO);
    const domenicaISO = isoDays[6];

    // --- 1 giorno libero a settimana. Con chiusura impostata è quello per tutti;
    // altrimenti viene scelto spalmandolo sui giorni, con la domenica riservata
    // in via prioritaria a chi ha già raggiunto il tetto di domeniche lavorate.
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
        const candidati = isoDays.filter(
          (iso) => !bloccati.has(key(dip.id, iso)) && !inFerie(dip.id, iso)
        );
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

    const disponibile = (dip, iso, rispettaCapDomenica) => {
      if (liberoDi.get(dip.id) === iso) return false;
      if (inFerie(dip.id, iso)) return false;
      if (turnoDi(dip.id, iso)) return false;
      if (rispettaCapDomenica && iso === domenicaISO && (domenicheLavorate.get(dip.id) || 0) >= capDomenicheLavorate)
        return false;
      return true;
    };

    // Tetto ore per la copertura: assegnabile solo chi non ha ancora completato
    // il contratto. Lo sforo massimo è quindi un solo turno (l'ultimo assegnato);
    // pur di coprire un reparto non si pianificano settimane irrealistiche —
    // meglio lasciare il buco e segnalarlo nel report.
    const sottoTettoOre = (dip) =>
      (oreSettimana.get(dip.id) || 0) < (dip.oreContrattualiSettimanali || 40);

    const oreSettimana = new Map();
    for (const dip of staff) {
      oreSettimana.set(dip.id, isoDays.reduce((tot, iso) => tot + oreDi(turnoDi(dip.id, iso)), 0));
    }

    const copertura = (iso, slot, repNome) => {
      let n = 0;
      for (const t of [...bloccati.values(), ...piano.values()]) {
        if (t.dataISO === iso && t.reparto === repNome && (t.tipo === slot || t.tipo === "giornata")) n++;
      }
      return n;
    };

    const assegna = (dip, iso, tipo, repNome) => {
      piano.set(key(dip.id, iso), {
        dipendenteId: dip.id,
        dataISO: iso,
        tipo,
        orario: orariDefault[tipo] || "",
        reparto: repNome,
        bloccato: false,
      });
      oreSettimana.set(dip.id, (oreSettimana.get(dip.id) || 0) + (oreTurno[tipo] || 0));
      if (iso === domenicaISO) domenicheLavorate.set(dip.id, (domenicheLavorate.get(dip.id) || 0) + 1);
    };

    // --- Fase 1: copertura minima di ogni reparto per ogni turno
    for (const [di, iso] of isoDays.entries()) {
      if (chiuso(settimana[di])) continue;
      for (const slot of SLOTS) {
        for (const rep of reparti) {
          const minimo = rep.coperturaMinima ?? 1;
          let cov = copertura(iso, slot, rep.nome);
          while (cov < minimo) {
            let candidati = staff.filter(
              (d) => rep.dipendentiIds.includes(d.id) && disponibile(d, iso, true) && sottoTettoOre(d)
            );

            if (candidati.length === 0) {
              // Nessuno libero: chi copre l'altro mezzo turno nello stesso reparto
              // può passare a "giornata" e coprire entrambi gli slot.
              const altroSlot = slot === "mattina" ? "pomeriggio" : "mattina";
              const upgradabili = staff
                .filter((d) => {
                  const t = piano.get(key(d.id, iso));
                  return t && t.reparto === rep.nome && t.tipo === altroSlot && sottoTettoOre(d);
                })
                .sort((a, b) => {
                  const ra = (oreSettimana.get(a.id) || 0) / (a.oreContrattualiSettimanali || 40);
                  const rb = (oreSettimana.get(b.id) || 0) / (b.oreContrattualiSettimanali || 40);
                  return ra - rb;
                });
              if (upgradabili.length > 0) {
                const t = piano.get(key(upgradabili[0].id, iso));
                const delta = (oreTurno.giornata || 0) - (oreTurno[t.tipo] || 0);
                t.tipo = "giornata";
                t.orario = orariDefault.giornata || "";
                if (delta > 0)
                  oreSettimana.set(upgradabili[0].id, (oreSettimana.get(upgradabili[0].id) || 0) + delta);
                cov++;
                continue;
              }
              // Se il tetto domenicale rende impossibile la copertura, l'equità cede il passo.
              if (iso === domenicaISO) {
                candidati = staff.filter(
                  (d) => rep.dipendentiIds.includes(d.id) && disponibile(d, iso, false) && sottoTettoOre(d)
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

    // --- Fase 2: monte ore. Chi è sotto contratto riceve prima upgrade a
    // "giornata" dei propri turni, poi nuovi turni su giorni liberi da impegni.
    const perDeficit = [...staff].sort(
      (a, b) =>
        (b.oreContrattualiSettimanali || 0) - (oreSettimana.get(b.id) || 0) -
        ((a.oreContrattualiSettimanali || 0) - (oreSettimana.get(a.id) || 0))
    );
    for (const dip of perDeficit) {
      const contratto = dip.oreContrattualiSettimanali || 0;
      if (contratto <= 0) continue;

      for (const iso of isoDays) {
        if ((oreSettimana.get(dip.id) || 0) >= contratto) break;
        const t = piano.get(key(dip.id, iso));
        if (t && t.tipo !== "giornata") {
          const delta = (oreTurno.giornata || 0) - (oreTurno[t.tipo] || 0);
          if (delta > 0) {
            t.tipo = "giornata";
            t.orario = orariDefault.giornata || "";
            oreSettimana.set(dip.id, (oreSettimana.get(dip.id) || 0) + delta);
          }
        }
      }

      for (const [di, iso] of isoDays.entries()) {
        const deficit = contratto - (oreSettimana.get(dip.id) || 0);
        if (deficit <= 0) break;
        if (chiuso(settimana[di]) || !disponibile(dip, iso, true)) continue;

        const abilitati = reparti.filter((r) => r.dipendentiIds.includes(dip.id));
        if (abilitati.length === 0) break; // nessun reparto: resterà sotto-ore nel report
        const rep = abilitati.reduce((best, r) => {
          const cr = copertura(iso, "mattina", r.nome) + copertura(iso, "pomeriggio", r.nome);
          const cb = copertura(iso, "mattina", best.nome) + copertura(iso, "pomeriggio", best.nome);
          return cr < cb ? r : best;
        });

        // Il tipo più piccolo che colma il deficit; se nessuno basta, il più capiente.
        const tipi = ["mattina", "pomeriggio", "giornata"].filter((tp) => (oreTurno[tp] || 0) > 0);
        if (tipi.length === 0) break;
        const sufficienti = tipi.filter((tp) => oreTurno[tp] >= deficit);
        const tipo = sufficienti.length
          ? sufficienti.reduce((a, b) => (oreTurno[a] <= oreTurno[b] ? a : b))
          : tipi.reduce((a, b) => (oreTurno[a] >= oreTurno[b] ? a : b));
        assegna(dip, iso, tipo, rep.nome);
      }
    }
  }

  const report = generaReport({
    settimane,
    giorniISO,
    reparti,
    staff,
    oreTurno,
    giornoChiusura,
    ferie,
    turniBlocco: [...bloccati.values(), ...piano.values()],
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
  const oreDi = (t) => (t ? oreTurno[t.tipo] || 0 : 0);
  const byKey = new Map(turniBlocco.map((t) => [`${t.dipendenteId}_${t.dataISO}`, t]));
  const turnoDi = (dipId, iso) => byKey.get(`${dipId}_${iso}`) || null;
  const domenicheISO = settimane.map((w) => toISO(w[6]));

  const copertura = (iso, slot, repNome) => {
    let n = 0;
    for (const t of turniBlocco) {
      if (t.dataISO === iso && t.reparto === repNome && (t.tipo === slot || t.tipo === "giornata")) n++;
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
      const tot = isoDays.reduce((s, iso) => s + oreDi(turnoDi(dip.id, iso)), 0);
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
