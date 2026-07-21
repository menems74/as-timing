# AS Timing — Contesto di progetto (stato al 2026-07-21)

App di gestione turni per il personale di un negozio Acqua e Sapone.

## Stack e percorsi

- Codice locale: `D:\Visual Studio 2010\VIAR Produzione\ASTiming`
- Repo GitHub: https://github.com/menems74/as-timing (utente `menems74`, email `menems@gmail.com`)
- Hosting: GitHub Pages — https://menems74.github.io/as-timing/
- Firebase project id: `as-timing` (Firestore regione europe-west8/Milano, Authentication Email/Password, **piano gratuito Spark**: 50k letture/20k scritture/20k eliminazioni al giorno, 1 GiB storage, 10 GiB/mese di traffico in download)
- Frontend: HTML/CSS/JS vanilla, **nessun build tool/bundler**, Tailwind via CDN (`cdn.tailwindcss.com`)

## Convenzione critica: cache-busting `?v=N`

Ogni file `.js` è referenziato con `?v=N` sia nei tag `<script>` sia negli `import` interni che lo richiamano. Ad ogni modifica a un file `.js` bisogna **bumpare il numero in TUTTI i file** (html + js), altrimenti la CDN di GitHub Pages continua a servire ai browser la versione precedente. Pattern usato finora:

```bash
sed -i 's/v=N/v=N+1/g' *.html js/*.js
```

**Versione corrente: v=40.** Verificare sempre con `grep -oh "v=[0-9]*" *.html js/*.js | sort -u` che sia un unico numero coerente prima di pushare.

## Pagine e file JS (uno-a-uno)

| Pagina | JS | Accesso |
|---|---|---|
| `login.html` | `login.js` | pubblico |
| `index.html` (Home) | `index.js` | tutti (sezioni extra se privilegiato) |
| `calendario.html` | `calendario.js` | tutti (scrittura solo se privilegiato) |
| `ferie.html` | `ferie.js` | solo privilegiati |
| `dipendenti.html` | `dipendenti.js` | solo privilegiati |
| `reparti.html` | `reparti.js` | solo privilegiati |
| `generali.html` | `generali.js` | solo privilegiati |
| `manutenzione.html` | `manutenzione.js` | solo privilegiati |

Moduli di supporto (nessuna pagina propria): `app.js` (init Firebase), `auth.js` (sessione/login/logout), `admin-auth.js` (creazione/reset password dipendenti), `data.js` (**unico punto di accesso a Firestore** — tutte le pagine importano da qui, mai l'SDK Firebase direttamente), `algoritmo.js` (motore di pianificazione, puro/testabile), `nav.js` (barra di navigazione, iniettata in ogni pagina), `firebase-config.js` (credenziali progetto).

## Modello dati Firestore

- `amministratori/{email}` — sola lettura per l'app, creato/gestito a mano da Firebase Console. Chi c'è dentro è Admin.
- `dipendenti_login/{email} -> {dipendenteId}` — collezione ponte: le Security Rules non possono fare query per campo, solo `get()` su path noti, quindi serve per risalire da email autenticata a dipendenteId.
- `dipendenti/{id}` — `nome`, `cognome`, `ruolo` (`"dipendente"` o `"responsabile"`), `email`, `oreContrattualiSettimanali`, `note`.
- `turni/{dipendenteId}_{dataISO}` — id composito per lookup/scrittura O(1); `dipendenteId` e `dataISO` sono *anche* campi veri (necessari per le query per range di date). **Due slot indipendenti come campi piatti** (un dipendente può lavorare in due reparti diversi lo stesso giorno, es. mattina in Cassa e pomeriggio in Gialla): `repartoMattina`/`orarioMattina`/`bloccatoMattina` e `repartoPomeriggio`/`orarioPomeriggio`/`bloccatoPomeriggio`. Uno slot è "attivo" se il suo campo reparto è valorizzato (helper `slotAttivo(turno, slot)` in `js/algoritmo.js`, mappa campi in `CAMPI_SLOT`); se nessuno dei due slot è attivo il documento non deve esistere (niente record orfani — gestito da `setTurnoGiorno`/`moveSlot`/`removeTurno` in `data.js`). Non esiste più il concetto di `tipo` (`mattina`/`pomeriggio`/`giornata`) come singolo campo: la "giornata intera" è solo una scorciatoia del modale che compila entrambi gli slot in un click, non uno stato salvato a parte.
- `ferie/{id}` — `dipendenteId`, `tipo`, `dataInizio`, `dataFine`, `note`.
- `reparti/{id}` — `nome`, `colore` (hex), `coperturaMinima` (persone per slot), `dipendentiIds` (array, max 4 reparti totali).
- `impostazioni/generale` (doc singolo) — `giornoChiusura` (0-6 o `""`), `direttoreId`, `orariDefault` (testo per mattina/pomeriggio/giornata — quello di `giornata` è usato solo dalla scorciatoia "Giornata intera" nel modale), `oreTurno` (durata in ore per mattina/pomeriggio — usata dall'algoritmo per il monte ore; `oreTurno.giornata` non è più usata per il calcolo, il totale giornaliero è sempre `oreTurno.mattina + oreTurno.pomeriggio`), `regoleAlgoritmo` (testo statico mostrato in Generali).

## Modello permessi (3 livelli)

- **Admin**: email presente in `amministratori`. Accesso completo ovunque.
- **Responsabile**: dipendente con `ruolo === "responsabile"`. **Accesso completo ovunque, identico all'Admin** (non è limitato al calendario).
- **Dipendente**: sola lettura, vede solo i propri turni/ferie. Le Security Rules impediscono comunque lato server la lettura di dati altrui.
- Il "Direttore di negozio" (`impostazioni.direttoreId`) è un dipendente escluso da calendario e algoritmo — non è un ruolo di permesso, solo di pianificazione.

Il pattern UI ricorrente: elementi con `data-privileged-only` partono con classe `hidden` nell'HTML e vengono rivelati via JS solo dopo aver risolto la sessione (evita il flash di contenuti riservati); per i non privilegiati vengono rimossi dal DOM, non solo nascosti.

## Algoritmo di pianificazione automatica (`js/algoritmo.js`)

Le regole di business originali concordate con l'utente sono nel file `Algoritmo.txt` sul suo Desktop — utile da rileggere se si toccano i criteri. Riassunto implementato:

- **`settimaneDelMese(refDate)`**: tutte le settimane lun→dom il cui lunedì cade nel mese scelto (l'ultima può sconfinare nel mese successivo).
- **`SLOTS`/`SLOT_LABEL`/`CAMPI_SLOT`**: costanti condivise (SLOTS = `["mattina", "pomeriggio"]`, CAMPI_SLOT mappa slot → nomi dei campi piatti sul doc turno). `data.js` e `calendario.js` le importano da qui invece di duplicarle, ma `algoritmo.js` resta a import zero (nessuna dipendenza da Firestore, per restare testabile in isolamento).
- **`pianificaMese({ refDate, dipendenti, reparti, ferie, impostazioni, turniEsistenti })`**: motore puro. Ritorna `{ daEliminare, daScrivere, report }`. Ogni giorno ha due slot indipendenti (mattina/pomeriggio), ciascuno assegnabile a un reparto diverso.
  - Il "piano" parte dagli slot bloccati del blocco (carry-over intoccabile) e viene riempito slot per slot; i documenti che restano senza nessuno slot bloccato/assegnato finiscono in `daEliminare`.
  - 1 giorno libero a settimana (occupato = almeno uno slot attivo quel giorno; la chiusura settimanale conta come giorno libero per tutti).
  - Competenze di reparto rispettate per slot; direttore mai schedulato.
  - Ferie/permessi = indisponibilità (non conteggiati, non è un errore se la settimana resta sotto-ore).
  - **Fase 1 (coperture)**: per ogni giorno/slot/reparto assegna candidati liberi con ore più basse in rapporto al contratto; se nessuno è libero, chi lavora già l'altro slot dello *stesso* reparto quel giorno viene esteso prima di lasciare un buco. Equità domenicale: max `(numero domeniche del blocco − 2)` domeniche lavorate a testa (conta come "lavorata" se almeno uno slot è attivo quel giorno), con fallback se la copertura sarebbe altrimenti impossibile. Tetto ore: si assegna solo a chi non ha ancora completato il contratto (sforo strutturale massimo: un solo slot) — altrimenti si lascia il buco e si segnala.
  - **Fase 2 (monte ore)**: chi resta sotto contratto riceve prima lo slot mancante nei giorni dove lavora già solo mezza giornata (Pass A, stesso reparto se possibile), poi nuovi turni su giorni completamente liberi se il deficit resta (Pass B) — potendo scegliere un reparto diverso da quello del primo slot dello stesso giorno: **è così che nasce la doppia schedulazione** (es. mattina in Cassa, pomeriggio in Gialla).
- **`analizzaMese({ refDate, dipendenti, reparti, ferie, impostazioni, turniEsistenti })`**: stesso identico report di `pianificaMese`, ma sullo stato **attuale** dei turni (nessuna scrittura). Condivide il calcolo con `pianificaMese` tramite la funzione interna `generaReport(...)`.
- Report anomalie: coperture assenti/singole **per slot** (non più per "tipo turno"), sopra/sotto monte ore (somma dei due slot attivi, con nota "atteso" se la settimana ha ferie), dipendenti con meno di 2 domeniche libere nel periodo.

In `calendario.html`/`calendario.js`: bottone **"Elabora Mese"** (chiede conferma, scrive su Firestore via `applicaPianificazione`, poi mostra il report) e bottone **"Analisi"** (nessuna conferma, nessuna scrittura, ricalcola il report sullo stato presente — pensato per il workflow: blocca i turni fissi → Elabora Mese → correggi a mano → Analisi per verificare se le correzioni hanno risolto le anomalie → ripeti finché "Nessuna anomalia rilevata" → Stampa). Il modale di riepilogo ha un bottone "Stampa" con foglio di stile `@media print` dedicato.

**Modale turno**: due sezioni indipendenti (Mattina/Pomeriggio), ciascuna con checkbox "Attiva" + select Reparto + input Orario + checkbox "Blocca". Bottone scorciatoia **"☀️ Giornata intera"** in alto: attiva entrambe le sezioni, replica lo stesso reparto su entrambe e imposta l'orario a `impostazioni.orariDefault.giornata` (testo, non uno stato salvato — il submit scrive comunque due slot indipendenti). Submit chiama `setTurnoGiorno(dipendenteId, dataISO, { mattina, pomeriggio })` (ognuno `{reparto, orario, bloccato}` o `null` per disattivare quello slot) in un'unica scrittura Firestore.

**Griglia mese/settimana**: ogni cella-giorno è divisa in due metà affiancate (mattina/pomeriggio), colorate col colore del reparto di quello slot (mai per tipo di turno). Ogni metà è il bersaglio indipendente di doppio click (apre il modale del giorno) e drag&drop (`moveSlot` in `data.js`, sposta un singolo slot; se sorgente e destinazione sono lo stesso documento — scambio mattina/pomeriggio dello stesso giorno — viene gestito come scrittura singola, non due scritture separate sullo stesso doc, perché Firestore non ammette più write sullo stesso documento in una transazione).

## Metodologia di test (nessun test automatizzato nel repo)

- **L'emulatore Firestore ufficiale (Firebase Local Emulator Suite) NON funziona in questo ambiente Windows**: bug di rete Java/AF_UNIX verificato con più versioni di JDK, non risolvibile lato utente. Non riprovarci.
- Al suo posto: uno **shim custom** (Firestore + Auth finti, in-memory su `localStorage`, stessa identica API del modular SDK) usato per testare login/permessi/CRUD/algoritmo in un browser locale senza toccare mai il progetto Firebase reale né inserire credenziali vere.
- Lo shim vive in una copia isolata del sito dentro lo scratchpad di sessione, che **non persiste tra conversazioni diverse** — va ricreato da zero: copiare tutti i file del progetto, poi ripatchare gli `import` di `data.js`/`auth.js`/`admin-auth.js` per puntare agli shim invece che ai veri URL `gstatic.com`, servire con un server HTTP locale (es. `python -m http.server`), seminare dati di test via `localStorage`.
- Occhio alle cache del browser durante i test: a volte serve un cache-busting esplicito nella query string (`?cb=1`) per forzare il ricaricamento di `index.html`/`calendario.html` dopo una modifica.
- `alert()`/`confirm()` nativi bloccano l'automazione del browser: durante i test vanno monkey-patchati (`window.alert = ...`, `window.confirm = () => true`) prima di innescare azioni che li usano.

## Cosa resta da fare (dichiarato dall'utente)

**Solo test e modifiche finali.** Il 2026-07-21 è stato completato un refactoring per la doppia schedulazione (v=40, vedi sezioni sopra): schema turni passato da `{tipo, orario, reparto, bloccato}` a due slot piatti indipendenti. Il database di test era già stato azzerato dall'utente prima del refactoring, quindi nessuna migrazione dati necessaria. Testato con Node (motore `algoritmo.js` isolato, senza Firestore): copertura/report per slot, preservazione di uno slot bloccato tra due elaborazioni successive, ore settimanali calcolate come somma dei due slot. **Non ancora testato nel browser reale** (drag&drop, modale con le due sezioni, scorciatoia "Giornata intera") — prossimo passo naturale: provarlo sul sito live con dati reali e segnalare cosa non va.

## TODO differito (esplicitamente rimandato dall'utente, non proporlo finché non richiesto)

In `calendario.js`, l'handler di "Elabora Mese" rilegge da zero (dipendenti/reparti/ferie/impostazioni/turni) dopo aver scritto il piano, invece di riusare i dati già calcolati in `esito` — raddoppia inutilmente le letture Firestore di ogni click. Non urgente (anche decine di elaborazioni ripetute in un giorno restano ben sotto le soglie gratuite), ma se richiesto: ri-renderizzare la vista dai dati già in memoria invece di richiamare `loadCommon()`/`loadTurniPerGiorni()`.
