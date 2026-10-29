# FEATURES

Workbench delle feature non ancora concluse. Le voci restano qui finché non
sono completate: solo allora si spostano in `PROJECT.md` (archivio della
documentazione) e si rimuovono da questo file. `PROJECT.md` non anticipa mai
feature pianificate.

Stati: `idea` → `in corso` → `completata` (da spostare).

I controlli manuali non si annotano qui: vivono in `YOUDO.md`, che è
l'unico elenco delle verifiche a carico dell'utente.

## Baseline Obsidian 1.13.0

Stato: idea — decisione presa, implementazione non iniziata.

Perché: i tipi sono pinnati a `obsidian@1.5.7` e il floor dichiarato è 1.5.0.
La 1.13 porta l'API dichiarativa delle impostazioni, i contenitori nativi dei
modal (X di chiusura compresa) e un ridisegno della settings tab che rende la
nostra UI visibilmente datata. Restare a 1.5 significa anche reimplementare a
mano strutture che l'app ormai fornisce, come è successo per il modal di
consenso del bridge Templater. Il costo è dichiarato: chi è su 1.11/1.12 smette
di ricevere aggiornamenti.

### Decisione

- `minAppVersion` = `1.13.0` in `manifest.json`; un solo salto, non una scala
  1.6 → 1.13.
- Tipi dev a `obsidian@~1.13.0` (non `latest`, non `^`): il floor della feature,
  non l'ultima pubblicazione.
- Nessun fallback di compatibilità sotto 1.13: il percorso duale B della
  feature «Settings UI» perde senso con questo floor.

### Impatto sul codice

- `package.json` / `package-lock.json`: `obsidian` → `~1.13.0`. `npm install`
  va lanciato da Windows: in sandbox il registry è bloccato (403).
- `manifest.json`: `minAppVersion` → `1.13.0`. `versions.json` non si tocca a
  mano: `npm version` lo riscrive leggendo il manifest
  (`scripts/version-bump.mjs`).
- `eslint.config.mts`: la regola
  `obsidianmd/settings-tab/prefer-setting-definitions` è disattivata con
  motivazione legata al floor 1.5; con 1.13 l'override va rimosso o riscritto.
- `main.ts`: verificare se il commento `eslint-disable` sull'`onload()`
  asincrono serve ancora con i tipi 1.13.
- `README.md`: aggiungere il requisito di versione (oggi non esiste una
  sezione compatibilità).
- `PROJECT.md` §9: baseline, motivazione e conseguenza sulla superficie di QA.
- `src/settings.ts`: nessun cambio in questa voce; la resa appartiene alla
  feature «Settings UI conforme al redesign».

### Verifiche da fare al bump

- Che `obsidian@1.13.0` esista su npm e che i tipi contengano
  `getSettingDefinitions()`, `SettingGroup` e — se presenti —
  `app.loadLocalStorage` / `saveLocalStorage`.
- Che il modal fornisca da solo la X di chiusura e i contenitori nativi: se sì,
  la struttura del modal di consenso non va replicata a mano.
- Che nessuna API usata dal plugin sia stata rimossa o deprecata tra 1.5 e
  1.13: lo dice il compilatore, ma vanno ricontrollati `Modal`, `Setting`,
  `MetadataCache`, `Workspace.on("layout-change")` e i tipi di `Plugin`.
- Che il plugin si carichi su 1.13 desktop e mobile e che il pannello Properties
  si agganci come prima.

### Criteri di completamento

- `npm run build`, `npm run lint`, `npm test` verdi con i tipi 1.13.
- Plugin caricato su 1.13 desktop e mobile: pannello, reconform, Back,
  auto-apply e bridge test invariati.
- Nessun uso di API più recente del floor dichiarato.
- README e PROJECT.md aggiornati; voce spostata in `PROJECT.md` e rimossa da
  `FEATURES.md`.

### Non-obiettivi

- Nessun cambio di comportamento, di persistenza o del modello di settings.
- Nessun ridisegno della tab: appartiene alla feature «Settings UI conforme al
  redesign di Obsidian».
- Nessun supporto duale 1.5–1.13.

### Aperti

- Se il floor debba essere 1.13.0 o la prima patch che pubblica i tipi
  dichiarativi, se diversa.
- Ordine rispetto a «Settings UI» e al bridge Templater: il bump è prerequisito
  di entrambe, quindi va per primo.
- Comunicazione del taglio: la 1.13 esclude chi è su 1.11/1.12, che non riceverà
  più aggiornamenti; va detto nel README e nella release.

## Dashboard Cascade Templates (ex scanner, E)

Stato: in corso.

Perché: lo scanner di 1.0.0 è un accordion piatto con due liste di file, senza
gerarchia, senza scope visibile e senza azioni. Ma il modello del plugin è un
albero di cartelle: un elenco piatto non lo spiega e non permette di agire. Il
redesign sostituisce il Modal con una dashboard a tre tab (struttura, problemi,
history), espone i verbi di conformità con i gate corretti e introduce un
journal di sessione che rende reversibili anche le operazioni globali. Senza il
journal, `Align notes` su tutto il vault sarebbe esattamente l'automazione a
cascata che il prodotto dichiara di non essere.

### Lessico

- **template**: file con il nome fisso `getTemplateFilename()` (`!Template.md`
  di default) dentro una cartella. Un template per cartella, quindi nessuna
  ambiguità di risoluzione.
- **cascata**: sottostruttura di cartelle che eredita il frontmatter di un
  template lungo la catena degli antenati.
- **local root**: la cartella con un template che non ha template antenati. È la
  radice di una cascata.
- **sotto-cascata**: una cartella con template dentro il sottoalbero di
  un'altra cascata. Il suo template ha come riferimento il template
  dell'antenato più vicino, non la local root.
- **catena**: template → template parent → … → local root.
- **sound**: ogni template della catena è conforme al proprio parent. Una local
  root è sound per definizione. Solo una catena sound autorizza `Align`.
- **foresta**: l'insieme dei sottoalberi delle sole local root. È l'universo
  della dashboard: fuori da lì non esiste nodo.
- **partecipante**: nota con frontmatter presente. Una nota senza frontmatter
  non fa parte del sistema.

### Modello dell'albero

- L'albero si deriva **dalla struttura delle cartelle**, non dall'elenco dei
  file: per ogni cartella si risolve il template con lo stesso walk di
  `getTemplateOfFile` (`src/core/templateAPI.ts:98`).
- Figli di una cartella, in quest'ordine: cartelle, poi il suo template, poi le
  note. Il template è un figlio della cartella e non compare mai tra le note.
- Ogni nodo ha esattamente uno stato: `ok`, `missing`, `extra`.
  - il template di una local root è sempre `ok`;
  - un template interno è `missing` se gli mancano proprietà del parent; le
    proprietà extra sono specializzazione attesa e non sono mai un problema;
  - una nota è `missing` se le manca una chiave del riferimento, `extra` se ne
    ha una che il riferimento non ha, con `missing` prioritario.
- **Nessuno stato neutro.**
- **`ok` significa "stesso insieme di chiavi", non "stessi valori".**
  `computeMapConformance` confronta solo i set di chiavi
  (`src/core/mapOperations.ts:35`): una nota con `status: draft` contro un
  template `status: published` è `ok`. Va scritto nel README, perché è la prima
  cosa che verrà segnalata come bug. Le azioni non toccano mai i valori
  esistenti.
- **Nota senza frontmatter o non indicizzata**: non partecipa. Non compare in
  `Issues`, non entra nei conteggi, non è raggiungibile dai verbi. Compare in
  `Cascades` come riga attenuata senza badge, perché la mappa strutturale non
  deve mentire sul contenuto della cartella.
- Badge di cartella: aggregato dei figli con precedenza `missing` > `extra` >
  `ok`.
- Conteggi di una riga: `T` (template non conformi nel sottoalbero), `Nm` (note
  `missing`), `Ne` (note `extra`). Sono **dello scope dell'azione**, cioè del
  sottoalbero: il numero che leggi è il numero di file che il click toccherà.

### Struttura del modal

Titolo `Cascade Templates`. Non è più uno "scanner": è la dashboard del plugin.

- Header condiviso dai tre tab: `Fix all (N)` centrato e `undo-2`.
- Tab: `Cascades (R) | Issues (N) | History (N)`.
  - `Cascades (R)`: `R` = numero di local root.
  - `Issues (N)`: `N` = file non conformi (le righe di contesto non contano).
  - `History (N)`: `N` = entry ripristinabili.
  - `Fix all (N)` mostra lo stesso `N` di `Issues`, altrimenti nello stesso
    header compaiono due cifre diverse e sembra rotto.
  - `Issues` e `History` sono disabilitati quando il loro counter è 0.
- Si apre su `Cascades`.
- Durante un batch o un rewind: tab, undo e chiusura del modal bloccati (stesso
  mutex).
- Progresso: linea indeterminata in cima al contenuto, `--interactive-accent`,
  2–3 px, animazione in loop, statica e attenuata con `prefers-reduced-motion`.
  Accanto un label testuale (`Fixing 2/3 · Updating notes`): la linea da sola
  non distingue "sta lavorando" da "si è piantato".
- Report di fine operazione: `Notice` se è andato tutto bene, dialog di
  dettaglio se ci sono fallimenti.

#### Tab `Cascades`

- Sola lettura. Nessun verbo, nessun hover, nessuna conferma.
- Scheletro: local root ordinate per **path** (collation numerica), poi le
  cartelle, il template locale e le note **collassate** in un gruppo espandibile
  (`24 notes`). L'ordinamento è identico in `Issues`.
- Ogni local root mostra il riferimento risolto
  (`projects/alpha → _templates/project.md`): il meccanismo "template della
  cartella antenata più vicina" è la cosa che gli utenti sbagliano di più, e la
  vista strutturale serve esattamente a questo.
- Footer: `N notes are outside any cascade`.
- Empty state (zero cascate): guida **statica** in tre passi (scegli la
  cartella-radice; crea `!Template.md` con le proprietà da ereditare; le note
  dentro e sotto la ereditano) più uno snippet di esempio con `Copy` negli
  appunti. Nessun pulsante che crea file: la cartella è la decisione portante,
  e il plugin non la prende al posto dell'utente.

#### Tab `Issues`

- Solo i rami che portano a un problema. Gli antenati restano come righe di
  contesto, attenuate, senza azioni, e non contano nei counter.
- Raggruppamento per tipo, perché i verbi sono tipizzati:
  - `Templates needing update` → `Update templates`;
  - `Notes missing properties` → `Update notes`;
  - `Notes with extra properties` → `Align notes`.
- Ogni gruppo mostra il totale e ha il verbo bulk; ogni riga porta il breadcrumb
  della cascata e i verbi della riga.
- Nessun filtro, nessuna ricerca, nessun multi-select: si entra e si preme il
  verbo. Gli scope sono già espressi dai nodi e una selezione arbitraria
  mescolerebbe template e note.
- Card di errore: quando un batch lascia file falliti, in testa al tab compare
  una card con il dettaglio e una `×` per il dismiss. **L'errore non è uno stato
  di conformità**: non entra nel badge, non ha un colore nella gerarchia, e
  sparisce al dismiss o al primo retry riuscito.

#### Tab `History`

- Una card orizzontale per entry, in ordine cronologico decrescente:
  verbo, timestamp, `Templates modified: N · Notes modified: N · Folders
  involved: N`, e `Restore to this snapshot`.
- Niente log, niente elenco file, niente errori: la history è un riassunto.
  I dettagli di esecuzione stanno nella card di errore di `Issues`.
- `Folders involved` = cartelle distinte che contengono almeno un file
  modificato.
- Le entry prodotte da `Fix all` portano `routine: {id, step, total}` e sono
  raggruppate sotto un header `Fix all · 3 operations`. Restano espansi; ognuna
  resta ripristinabile singolarmente. Se la macro si è fermata:
  `Fix all · stopped after phase 1`.
- `Restore to this snapshot` annulla tutte le entry più recenti (vedi Journal).

### Verbi

| Verbo | Dove | File toccati | Gate |
|---|---|---|---|
| `Update template` | riga template | quel template | nessuno |
| `Update templates` | cartella, local root, `All cascades` | solo template, top-down per profondità | nessuno |
| `Update note` / `Update notes` | riga nota / cartella, local root, `All cascades` | solo note | nessuno |
| `Align note` / `Align notes` | riga nota / cartella, local root, `All cascades` | solo note | catena sound |
| `Fix all` | header del modal | template, poi note, poi note | macro, vedi sotto |
| `Undo last operation` | header del modal | l'entry in cima | conferma se ci sono divergenze |
| `Restore to this snapshot` | card della history | tutte le entry più recenti | conferma con diff |

- Non esistono: `Align template`, `Reset`, `Update` combinato template + note,
  `Rescan`.
- `Update` è additivo e sempre disponibile; `Align` è distruttivo e gated.
- La ricorsività **non è un'opzione**: una cartella agisce sul sottoalbero per
  definizione, il caso non ricorsivo è la riga singola.
- `All cascades` è una root virtuale con gli stessi tre verbi, sempre ricorsiva.
- `Align` si sblocca solo se tutta la catena fino alla local root è sound.
  Motivo sul nodo e nel gruppo di `Issues`, non solo al click: aggiornare un
  template e poi cancellare proprietà nella stessa azione non è ammesso,
  `Update templates` è l'operazione separata.
- Il tipo di file è esplicito nel verbo, lo scope è implicito nella riga.

### Batch

- Un click = un batch omogeneo (stesso tipo di file, stesso verbo) = una entry
  del journal.
- **Dry run** prima di eseguire: calcola il target di ogni nodo con le stesse
  funzioni pure del batch, confronta con il corrente e conta solo i file che
  cambierebbero davvero. La stessa passata produce il numero per la conferma, la
  stima di peso dell'entry e il rilevamento di `<% %>` nei riferimenti. Nessuna
  scrittura, nessun accesso al disco: solo mappe dalla cache.
- Conferma **per scope**: bulk su cartella, local root o `All cascades` sempre;
  azione su singolo file mai.
- Esecuzione sequenziale in ordine deterministico (superficiale → profondo).
- Fallimento in avanti:
  - **note**: foglie indipendenti → si prosegue sulle altre e si riportano le
    fallite;
  - **template**: catena di dipendenza (il target di un figlio dipende dallo
    stato del padre) → si ferma il sottoalbero, i fratelli proseguono.
  In entrambi i casi l'entry resta nel journal con `after` solo per i file
  effettivamente scritti e `skipped` per gli altri; un retry riparte dai
  mancanti, ed è sicuro perché ogni scrittura è idempotente (target state, non
  delta).
- Il conteggio riportato nella `Notice` è quello reale, non la stima del dry
  run.

### `Fix all`

- **Macro, non verbo nuovo.** Esegue tre operazioni in sequenza, tre entry
  distinte: `Update templates` → `Update notes` → `Align notes`.
- L'ordine è obbligato: `Update templates` cambia gli insiemi di riferimento,
  quindi le note possono diventare `missing` (fase 2) e le `extra` possono
  sparire (fase 3). Dopo la fase 1 la catena è sound per costruzione, quindi il
  gate di `Align` è soddisfatto.
- Una sola conferma per tutta la macro, con le tre fasi e i conteggi stimati. I
  conteggi delle fasi 2 e 3 sono **stime**, perché dipendono dall'esito della
  fase 1; i numeri veri finiscono nelle card della history.
- Errore: si chiude la fase in corso secondo la regola del suo tipo, poi la
  macro **non entra nelle fasi successive**. Dialog con cosa è successo, quali
  fasi sono girate e quali no, e invito a rilanciare `Fix all` (sicuro,
  idempotente).
- Non è atomica e non viene presentata come tale: ogni confine di fase è uno
  stato valido della foresta, quindi l'undo per entry non lascia mai un ibrido
  incoerente.
- UX: pulsante centrato nell'header, `mod-cta` (accent del tema, **non** rosso:
  il rosso è già `missing` nei badge ed è la convenzione Obsidian per le azioni
  distruttive), icona `sparkles`, label `Fix all (12)`, disabilitato a 0 con
  tooltip `No issues to fix`.

### Journal

- Vive nel plugin, non nel modal: chiudere e riaprire la dashboard conserva la
  history. Scope = sessione, muore con `onunload`.
- Unifica le scritture di dashboard e pannello Properties:
  `origin: "scanner" | "panel" | "fix-all"`.
- Entry: `{id, origin, at, routine?, files: [{path, before, after, skipped?}]}`.
  `before` è la mappa **completa**; `after` solo le chiavi divergenti.
- Modello a **target state**, non a delta: un edit manuale non crea buchi,
  perché viene assorbito dal `before` della entry successiva che tocca quel
  file.
- `Undo last operation` = pop dell'entry in cima. `Restore to this snapshot` =
  pop di tutta la coda più recente, applicando per ogni file il target preso
  dalla **entry più vecchia del range che l'ha toccato**. Non si applicano le
  entry in ordine: si scrive direttamente lo stato finale.
- Il restore è **scoped alle sole chiavi toccate**: le chiavi estranee
  sopravvivono sempre; le chiavi toccate vengono sovrascritte.
- Conflitti: preflight che ripete il rewind in memoria. Una divergenza su una
  chiave toccata è un conflitto → conferma con diff
  (`file → chiave: tuo valore → ripristinato`), non abort automatico: il target
  esiste, la decisione è dell'utente. Diff per chiave fino a una soglia di file
  (10), poi aggregato per file con espansione.
- File cancellati o rinominati tra l'operazione e il rewind: **skip con avviso**
  nel preflight (`2 files no longer exist`). Non è un'applicazione parziale: non
  c'è più nessuno stato da ripristinare.
- Fallimento parziale durante il rewind: stop immediato, **entry non
  consumata**, riporto di fatti/non fatti, retry idempotente.
- Non atomicità: N `process` sequenziali, nessuna transazione. UI congelata,
  eventi `changed` soppressi durante il batch, un solo ricalcolo finale dai dati
  del journal. Un quit a metà lascia uno stato parziale non tracciato: rischio
  accettato e dichiarato in UI.
- Divergenze: **calcolate on demand**, confrontando il valore corrente con
  l'`after` dell'ultima entry che ha scritto quella chiave. Non si traccia
  nulla; l'unica cosa che viene dall'evento `changed` è il timestamp
  (`changed manually at 14:31`).
- Un file non indicizzato o senza frontmatter non partecipa, quindi non
  interferisce.

### Eviction e veto

- Budget in byte stimati (`Σ (len(chiave) + len(raw)) × 2`), con **internment**
  per contenuto di mappe e frammenti: una cascata produce molti frontmatter
  identici, e senza internment il budget si esaurisce in due operazioni globali.
- Eviction **FIFO dalla testa**, unico punto di rimozione del modulo. Mai per
  costo, mai dal centro, nessun pinning in v1.
- La troncatura è visibile: prima riga della history
  `N older operations are no longer restorable`.
- Veto solo quando **una singola entry supera `budget / 2`**: dialog a due
  bottoni, `Proceed` (tronca la history) e `Cancel`. "Procedi senza registrare"
  non è un'opzione, equivale a troncare.
- Budget: 8 MB su mobile, 32 MB su desktop (`Platform.isMobile`).

### Integrazione col pannello Properties

- Il Back diventa una **vista filtrata sul journal** per path: non esiste più
  uno stack separato.
- Il cursore di fase resta per-view e **si resetta sull'edit manuale**, come
  oggi: la sessione di reconform finisce, il journal no.
- Severità stretta del Back: disponibile solo se tutte le chiavi scritte
  dall'entry in cima sono ancora uguali al suo `after`. Altrimenti è disabilitato
  con il motivo (`status changed manually at 14:31`) invece di sparire.
- Il falso positivo attuale sparisce: una chiave estranea aggiunta a mano non
  uccide più la sessione.
- `clearHistory` in `src/features/metadataPanel.ts:546` diventa `resetCursor`;
  `clear()` in `src/core/reconformHistory.ts:152` smette di distruggere l'undo.
- Il pannello guadagna una sola affordance: `Open cascade in scanner`, che apre
  la dashboard sul tab `Cascades`, già scoped alla cascata del file corrente.
  È anche l'entry point mobile.

### Indicizzazione

- Eventi: `metadataCache.on("resolve")` per file e `metadataCache.on("resolved")`
  per tutti; quest'ultimo rifire anche dopo le modifiche, quindi non è one-shot.
- Predicato: tutti i `.md` candidati hanno `getFileCache() !== null`. Se è vero
  si rende subito (caso normale a plugin già caricato).
- Altrimenti schermata `Waiting for indexing…` con il conteggio, in ascolto sui
  due eventi, rivalutazione debounced.
- Timeout di sicurezza → si procede: un file non indicizzato è trattato come una
  nota senza frontmatter, quindi fuori dal sistema. Nessuno stato "non
  indicizzato" nei tab.
- La schermata appare solo quando serve.

### Mobile

- Nessun hover: le azioni vivono nel menu `⋯` della riga.
- Desktop: icone inline su hover/focus, `⋯` come fallback.
- Tab a segmenti in stile nativo, nessun `‹ Back`.
- Indentazione: 16 px desktop / 12 px mobile sui primi 3 livelli, metà oltre il
  4°, clampata al 40% della larghezza della riga; sotto clamp la riga mostra il
  nome della cartella padre in linea (`alpha / beta / note`).

### Tastiera

Pattern ARIA del tree, **roving tabindex**: l'albero è un unico stop di
tabulazione.

- `↑` / `↓`: riga precedente / successiva visibile;
- `→`: espande la cartella, o va al primo figlio se già espansa;
- `←`: collassa, o va al padre se già collassata;
- `Enter`: apre il menu `⋯` della riga (non esegue il verbo primario: stesso
  modello di mobile, niente azioni distruttive da un tasto premuto per sbaglio);
- `Esc`: chiude il menu, poi il modal.

`role="treeitem"`, `aria-level`, `aria-expanded`, DOM in ordine visivo. Va fatto
insieme al renderer, non retrofittato.

### Performance

- La foresta si costruisce **top-down sulle cartelle** con memoizzazione
  `cartella → template`. Non per file: `getTemplateOfFile` fa un
  `getAbstractFileByPath` per livello di antenato, per file, e su 10k note
  diventa decine di migliaia di lookup per rebuild.
- Ricostruzione debounced su `changed`, `resolve`, `resolved` e sui `vault`
  `create` / `delete` / `rename`.
- Durante un batch gli eventi sono soppressi e l'albero si riallinea dai dati
  del journal.

### Rimozioni

- `scannerExcludeFolders`, `isScannerExcluded` (`src/settings.ts:170`),
  `normalizeFolders`, `parseFolderList`: il confine di scope è la foresta, le
  eccezioni verranno gestite dalle interfacce.
- `scannerTargets` e il tipo `ScannerTargets` (`src/settings.ts:48`): in una
  foresta non si possono nascondere né i template (scheletro) né le note
  (foglie).
- `ScannerABC` con `AllertLevel` e il render piatto.
- `CoherenceScanner` e `TemplateCoherenceScanner` come classi: la logica resta
  in `mapOperations` / `conformance`.

### Impatto sul codice

- `src/core/forest.ts` (nuovo, puro): derivazione della foresta da path + lookup
  del template, local root, ordinamento, badge, conteggi, scope dei verbi.
- `src/core/journal.ts` (nuovo, puro): entry, internment, budget, eviction,
  veto, preflight del rewind, diff delle divergenze.
- `src/core/templateAPI.ts`: `reconformFile` torna
  `{before, after, changed}` mantenendo un unico entry point; helper per il
  batch, che espone anche il dry run.
- `src/core/reconformHistory.ts`: da stack autonomo a vista filtrata sul
  journal; `push` porta `origin`.
- `src/features/metadataPanel.ts`: `resetCursor` al posto di `clearHistory`,
  push con `origin: "panel"`, affordance `Open cascade in scanner`.
- `src/features/dashboard/` (nuova, sostituisce `src/scanner/`): modal, tab,
  albero, menu `⋯`, card di history, card di errore, progress line.
- `src/settings.ts`: rimozione dei campi e dei tipi elencati sopra.
- `main.ts`: import della dashboard, icona ribbon (`git-fork`, con fallback via
  `setIconSafe`) e comando `Open Cascade Templates`. Il comando è l'eccezione
  esplicita al vincolo "nessun comando in palette per ora" di `PROJECT.md` §12.
- `styles.css`: tab, righe dell'albero, indentation, progress line, card.
- `README.md`: lessico della foresta, `ok` = insieme di chiavi, verbi e gate,
  history di sessione, rimozione dei due settings.
- `PROJECT.md` §11 e §14 a lavoro concluso (la feature non si anticipa).

### Test

La suite è pure-core: journal, forest e dry run devono essere funzioni pure con
l'IO iniettato.

- `forest`: derivazione, local root vs sotto-cascata, ordinamento per path,
  badge aggregato, conteggi per scope, note fuori cascata, note senza
  frontmatter.
- `journal`: target state per file, chiavi estranee preservate, eviction FIFO,
  veto, internment, preflight con divergenze, rewind che attraversa una
  divergenza, file spariti.
- `dry run`: conteggio dei soli file che cambiano, stima di peso, rilevamento
  `<% %>`.
- Fixture come struttura di path sintetica, senza file system reale.

### Criteri di completamento

- `npm run build`, `npm run lint`, `npm test` verdi.
- Le tre tab rispettano i counter e i disabilitati; `Cascades` è read-only.
- `Update` sempre disponibile; `Align` bloccato su catena non sound, con motivo
  visibile su riga e gruppo.
- `Fix all` esegue le tre fasi, si ferma su errore, e lascia tre card
  raggruppate.
- Journal: undo, rewind con conferma, eviction visibile, fallimento parziale con
  retry, file spariti saltati con avviso.
- Pannello: Back disabilitato con motivo invece di sparire; cursore che si
  resetta; `Open cascade in scanner`.
- Schermata di indicizzazione solo quando serve, con uscita al timeout.
- Verifiche manuali (resa desktop/mobile, tema chiaro/scuro, long-press/`⋯`,
  indentazione profonda, animazione con `prefers-reduced-motion`) tracciate in
  `YOUDO.md`.
- README e PROJECT.md aggiornati; voce spostata in `PROJECT.md` e rimossa da
  `FEATURES.md`.

### Aperti

- Budget esatto da tarare su una misura reale; la soglia del veto è
  `budget / 2`.
- Nome definitivo del comando (`Open Cascade Templates`) e conferma dell'icona
  ribbon.
- Se il journal debba sopravvivere al reload: sarebbe una feature separata,
  perché al reload ogni entry va riverificata chiave per chiave.
- Se serva un `Update all` unico che unisca template e note: oggi è escluso dal
  batch omogeneo.
- Se l'errore di esecuzione debba anche essere persistito, o restare di
  sessione come la history.

## Voce di menu per creare il template di cartella

Stato: idea.

Perché: creare a mano un template richiede di ricordare il `templateBasename`
configurato e di posizionare il file nella cartella giusta. Una voce nel menu
contestuale della cartella rende l'azione scopribile, esplicita e disponibile
anche su mobile (long-press), senza introdurre comandi in palette. La
distinzione root/child rende inoltre visibile se l'azione inizierà una cascata
o estenderà il template parent.

Comportamento:
- solo menu di una `TFolder` (in pratica il file explorer), non il menu di un
  file: il flusso è template prima, note dopo;
- template locale assente e nessun template antenato:
  `New root template (<nome>.md)`, sezione `action`, icona `file-plus`;
- template locale assente ma template antenato presente:
  `New child template (<nome>.md)`, stessa sezione e icona: erediterà le
  proprietà dal parent. "Root" significa inizio della cascata, non root del
  vault;
- template locale presente: voce disabled
  `Template already exists (<nome>.md)`, icona neutra (`file`, non
  `file-check` per non sovrapporsi alla semantica di conformità), nessun click;
  serve solo a segnalare l'esistenza, anche se il file non è visibile. Il
  titolo resta generico, senza distinzione root/child;
- il file nasce vuoto e riceve subito le proprietà del template antenato più
  vicino, anche con auto-apply `off`: è un'azione esplicita, non una cascata
  automatica;
- il body segue auto-apply: `off`/`properties` → body vuoto, `full` → body del
  parent copiato dal listener esistente;
- le espressioni `<% %>` restano raw: la destinazione è un template;
- apertura in una nuova tab; path normalizzato anche per la root del vault.

Note implementative:
- riusare `reconformFile(created, "add-missing")` dopo `vault.create(path, "")`
  per il seed delle proprietà: stesso motore della UI, già template-safe;
- il seed legge il parent diretto, non fonde l'intera catena: un parent non
  conforme resta un errore dello scanner;
- la distinzione root/child usa lo stesso walk sincrono di `getTemplateOfFile`:
  nessun costo aggiuntivo;
- registrarsi su `file-menu` con la sola guardia `TFolder`; la verifica dal vivo
  (`source`, `setSection("action")`, long-press mobile) è tracciata in
  `YOUDO.md`;
- aggiornare README e descrizione della setting auto-apply: l'azione esplicita
  eredita le proprietà anche con auto-apply disattivato.

Criteri di completamento:
- desktop e mobile (verifica tracciata in `YOUDO.md`); `off`, `properties`,
  `full`;
- root del vault, root di cascata e cartelle child;
- cartella con template locale, con solo template antenato, senza nessuno dei
  due;
- `npm run build` e `npm test` verdi;
- documentazione utente aggiornata;
- voce spostata in `PROJECT.md` e rimossa da `FEATURES.md`.

Aperti:
- se il template esiste, valutare un `Open template` separato in una sezione
  `view` (non nello slot create);
- se differenziare anche il disabled (`Root/Child template already exists`) o
  lasciarlo generico come da design attuale;
- interazione con `trigger_on_file_creation` di Templater;
- eventuale seed del body immediato invece di attendere i 200 ms di auto-apply.

## Interfaces (ct-interfaces)

Stato: idea — pianificata per una minor dedicata.

Perché: la cascata attuale condivide proprietà solo lungo l'asse cartella. Le
interfacce aggiungono un secondo asse: una nota può dichiarare un insieme di
note-interfaccia e ricevere da queste le proprietà che le mancano, senza
duplicare template o creare sottocartelle. È il caso d'uso
"mixin/composizione per riferimento": `Ratable`, `Image`, `Reviewable` si
definiscono una volta e si applicano a qualsiasi nota, indipendentemente dalla
posizione nella cascata.

La feature è attivabile dalle settings e spenta di default. Non introduce
scritture automatiche: cambia il criterio di conformità e l'effetto del
pulsante di reconform.

Lessico:
- **nota-interfaccia**: una qualsiasi nota o template linkato da
  `ct-interfaces`;
- **nota ricevente**: il file che dichiara `ct-interfaces`;
- **dichiarazione**: il valore della prop `ct-interfaces`, cioè l'array di link;
- **riferimento**: la mappa di proprietà contro cui si confronta la nota;
- **materializzazione**: la scrittura delle chiavi dell'interfaccia nel
  frontmatter della nota ricevente.

### Attivazione

- Setting `enableInterfaces`, default `off`.
- Con la feature `off`, `ct-interfaces` è una proprietà normale: il plugin la
  ignora, non la filtra e non risolve i link.
- Con la feature `on`, `ct-interfaces` è riservata in qualsiasi `.md` (nota o
  template).
- Accendere la feature non scrive nulla: cambia solo il riferimento calcolato.
  Le note esistenti che dichiarano `ct-interfaces` diventano non conformi
  finché l'utente non esegue Update.
- Spegnere la feature riporta `ct-interfaces` a proprietà normale; nessun dato
  viene perso.

### Sintassi e validità

`ct-interfaces` è una lista di link a note:

```yaml
ct-interfaces:
  - "[[Ratable]]"
  - "[[Image]]"
```

- Si accetta anche un singolo link come stringa.
- La risoluzione usa `metadataCache.getFirstLinkpathDest(linkpath, sourcePath)`.
  Alias, heading e block vengono ignorati: conta la nota.
- La lista può stare in una nota o in un template. Ogni nota è una potenziale
  interfaccia, template compresi.
- Nel contratto dei dati la dichiarazione è riservata: non viene confrontata
  come prop della nota e non viene copiata da un template a una nota.
  Nell'eredità tra template è invece una prop normale (vedi sotto).
- Sono **invalidi**: link irrisolti, self-link, link a file non `.md`, valori
  non-stringa, link malformati. Un solo link invalido rende invalido l'intero
  riferimento e blocca il reconform.
- I duplicati vengono deduplicati per path risolto; vince la prima occorrenza.
- Un'interfaccia contribuisce solo con il proprio frontmatter, **esclusa
  `ct-interfaces`**. Non c'è ricorsione: se la nota-interfaccia dichiara a sua
  volta delle interfacce, queste non si propagano. La composizione si ottiene
  elencando più link nell'array o mettendo l'array nel template.
- Se la nota-interfaccia è un template, si usa solo il suo frontmatter
  dichiarato: non si espande il suo template parent e non si espandono le sue
  interfacce.
- Il body della nota-interfaccia è ignorato.
- Templater: il file interfaccia è sempre letto raw, mai eseguito. La
  valutazione di `<% %>` resta quella attuale: avviene solo scrivendo su una
  nota, se il bridge è attivo. Non ci sono eccezioni per i valori che arrivano
  da un'interfaccia.

### Risoluzione del riferimento

Per una **nota con template**:

1. si parte dalle props dichiarate del template più vicino, meno
   `ct-interfaces`;
2. si appendono le props delle interfacce dichiarate dal template, nell'ordine
   del suo array, solo per le chiavi non ancora presenti;
3. si appendono le props delle interfacce dichiarate dalla nota, nell'ordine
   del suo array, solo per le chiavi non ancora presenti;
4. i valori già presenti nella nota vincono sempre; le props del template
   precedono i default delle interfacce.

L'ordine risultante è: props del template, interfacce del template, interfacce
della nota, prop extra della nota. La prima interfaccia che definisce una
chiave vince. Presenza = chiave, non valore: una prop vuota nella nota non
viene sovrascritta.

Per un **template con parent**:

- la conformità e il reconform restano sulle props dichiarate, come oggi;
- `ct-interfaces` è una prop normale per l'eredità: il parent può dichiarare
  dei link e il figlio deve includerli per restare coerente;
- il check è di **sottoinsieme**: i link risolti del parent devono essere
  presenti nei link risolti del figlio; il figlio può aggiungerne altri;
- le chiavi prodotte dalle interfacce non vengono mai materializzate nel
  template: il template dichiara, le note ricevono.

Per una **nota senza template**: in fase 1 la feature è inerte. `ct-interfaces`
non viene risolta e il pannello resta nello stato "no template". Il caso è
coperto dalla feature sequel.

### Conformità

- **Nota vs riferimento**: `ok` / `extra` / `missing`, come oggi, ma il
  riferimento include le chiavi delle interfacce. `ct-interfaces` è filtrata
  dal confronto.
- **Template vs parent**: props dichiarate come oggi, più il check di
  sottoinsieme sui link di `ct-interfaces`. Link del parent mancanti nel figlio
  = template incoerente; link extra del figlio = specializzazione ammessa.
- **Link invalido**: il riferimento è incompleto. Lo stato non è `ok`/`missing`:
  è un warning dedicato. Il pulsante entra nello stato `invalid`.
- Un'interfaccia vuota (nessun frontmatter) è valida e non contribuisce nulla.

### Reconform

Matrice dei tre stati. `ct-interfaces` non è mai una prop del contratto: è una
dichiarazione che sopravvive alle azioni.

| File | Update | Align | Reset |
|---|---|---|---|
| Nota con template | aggiunge le chiavi mancanti del riferimento (template + interfacce), preserva i valori esistenti, riporta l'ordine al riferimento e lascia le prop extra in coda; preserva `ct-interfaces` | rimuove le prop non presenti nel riferimento; preserva `ct-interfaces` | riporta le prop ai default del riferimento; preserva `ct-interfaces` |
| Template con parent | aggiunge le prop mancanti del parent e fa il merge dei link `ct-interfaces` del parent con quelli del figlio; non materializza le chiavi delle interfacce | default: se il parent ha `ct-interfaces` la chiave resta con l'array del figlio; se il parent non ce l'ha, la chiave viene rimossa come prop extra | riporta le prop dichiarate al parent; `ct-interfaces` diventa l'array del parent, o viene rimossa se il parent non ce l'ha; non materializza le chiavi |
| Nota senza template | inerte in fase 1 | inerte | inerte |
| Link invalido | bloccato | bloccato | bloccato |

Note:
- Sulle note la dichiarazione `ct-interfaces` è sempre preservata: è ciò che
  definisce il riferimento. Rimuoverla cambierebbe il significato dell'azione.
- Sui template `ct-interfaces` segue il comportamento di default rispetto al
  parent. Un template figlio che aggiunge interfacce non presenti nel parent le
  perde con Align/Reset: è il comportamento prevedibile, non un caso speciale.
- Il pulsante entra nello stato `invalid` (hard-disabled, icona dedicata,
  tooltip con il link rotto) se la nota o il suo template hanno un link
  invalido. Quando il link torna valido, il cursore riparte dalla fase base.
- Il no-op di una fase usa lo stesso calcolo del reconform, inclusa la
  preservazione della chiave riservata.
- Back/history continua a funzionare: lo snapshot contiene anche
  `ct-interfaces`.

### Auto-apply

- **Nuova nota**: riceve le props effettive del template (dichiarate +
  interfacce del template) e le eventuali interfacce già dichiarate nella nota.
  Non copia l'array `ct-interfaces` dal template: l'effetto è ereditato, la
  dichiarazione no.
- **Nuovo template**: riceve le props dichiarate del parent, incluso l'array
  `ct-interfaces` come prop normale (merge dei link del parent con eventuali
  link già presenti). Non riceve le chiavi prodotte dalle interfacce.
- Se il file nasce già con `ct-interfaces` (Base, Templater, import), la
  dichiarazione viene preservata e le sue interfacce contribuiscono al merge.
- Templater resta invariato: solo note, solo con il setting attivo, mai sui
  template.

### Pannello

- **Nota**: l'icona confronta la nota con il riferimento (template +
  interfacce). Il tooltip riporta lo stato, il path del template e l'elenco
  delle interfacce con la provenienza (`template` o `nota`). I link invalidi
  compaiono nel tooltip.
- **Template**: l'icona continua a confrontare le props dichiarate con il
  parent. Il tooltip elenca le interfacce dichiarate.
- **Link invalido**: icona di stato in warning, non `ok`/`missing`. Il pulsante
  di reconform è hard-disabled con stato `invalid`.
- **Nota senza template**: stato neutro e pulsante disabilitato, come oggi;
  `ct-interfaces` resta inerte in fase 1.
- **Refresh**: quando cambia il frontmatter di una nota-interfaccia, vanno
  aggiornate le view la cui nota o il cui template la usano. Oggi
  `refreshViewsForFile` guarda solo il template diretto: va esteso.
- **Navigazione dal badge**: resta quella attuale (template per le note, parent
  per i template). Le interfacce si aprono dai link nella prop.

### Scanner

- **Note scanner**: usa il riferimento effettivo (template + interfacce),
  filtra `ct-interfaces` e ignora le note con riferimento invalido, che sono
  gestite dallo scanner dedicato.
- **Template scanner**: props dichiarate come oggi, più il check di
  sottoinsieme sui link `ct-interfaces`. Il valore della chiave non partecipa al
  confronto delle props.
- **Invalid-link scanner**: segnala link irrisolti, self-link, link a file non
  `.md`, valori non-stringa. Cache-only, come gli altri scanner.
- Autofix resta fuori scope (E2).

### Settings

- Toggle "Enable interfaces", default `off`.
- Descrizione: riserva `ct-interfaces`; la prop contiene una lista di link a
  note; le props mancanti vengono aggiunte con Update o su note nuove; nessuna
  scrittura automatica; i link invalidi bloccano il reconform; le note senza
  template non sono supportate in questa fase.
- Il toggle deve aggiornare i pannelli aperti, come le altre setting.

### Casi limite

- Interfaccia cancellata o rinominata: il link diventa invalido finché non
  viene corretto. Se Obsidian aggiorna i link interni al rename, la prop si
  aggiorna da sola.
- Interfaccia che è un template: si usa solo il suo frontmatter dichiarato.
- Interfaccia che ha un template: il suo template non contribuisce.
- Interfaccia che dichiara `ct-interfaces`: la chiave è esclusa, nessuna
  ricorsione.
- Template root: può dichiarare interfacce e le sue note le ricevono; il
  reconform del template resta disabilitato perché non ha parent.
- Feature attivata su un vault con `ct-interfaces` già usata per altro: la prop
  diventa riservata; è una scelta esplicita dell'utente.
- `position` in cache: ignorata come sempre.
- Espressioni `<% %>` nelle interfacce: raw nella sorgente, valutate solo
  scrivendo su una nota se il bridge è attivo.
- Body dell'interfaccia: ignorato.

### Non-obiettivi

- Nessuna ricorsione tra interfacce.
- Nessun picker o registro globale: ogni nota è già un'interfaccia e la prop si
  edita nel pannello Properties nativo.
- Nessuna interfaccia per note senza template in questa fase (feature sequel).
- Nessuna scrittura automatica al salvataggio.
- Nessuna cartella o grammatica sul nome file: le interfacce sono link.
- Nessuna ereditarietà implicita tra template: vale la regola esistente delle
  props dichiarate, con il check di sottoinsieme per `ct-interfaces`.

### Impatto sul codice

- `src/conts.ts`: costante `INTERFACES_PROP = "ct-interfaces"`.
- `src/settings.ts`: `enableInterfaces`, normalizzazione, toggle e descrizione.
- Nuovo `src/core/interfaceProps.ts` (puro): parsing dei linkpath, filtro della
  chiave riservata, append/merge, preservazione della chiave, check di
  sottoinsieme, conformità del riferimento. Da aggiungere a
  `tsconfig.test.json` e coprire con test.
- `src/core/templateAPI.ts`: risoluzione dei link, riferimento effettivo,
  `reconformFile`, auto-apply.
- `src/core/conformance.ts`: eventuale helper puro per il sottoinsieme; il merge
  resta in `interfaceProps.ts`.
- `src/features/metadataPanel.ts`: riferimento effettivo, tooltip, stato
  `invalid`, refresh sulle interfacce.
- `src/scanner/CoherenceScanner.ts`, `TemplateCoherenceScanner.ts`: filtro e
  riferimento effettivo; nuovo scanner per i link invalidi.
- `styles.css`: stato `invalid` del pulsante e warning dell'icona.
- `README.md`, `PROJECT.md`, `YOUDO.md`: documentazione e check manuali.

### Criteri di completamento

- `npm run build`, `npm run lint`, `npm test` verdi.
- Setting `off` invariato rispetto a oggi; setting `on` verificato su note e
  template.
- Update/Align/Reset verificati per nota con template, template con parent,
  link invalido.
- Auto-apply verificato per nuova nota e nuovo template.
- Tooltip, stato `invalid`, refresh su cambio interfaccia e mobile verificati in
  `YOUDO.md`.
- README e PROJECT.md aggiornati; voce spostata in `PROJECT.md` e rimossa da
  `FEATURES.md`.

### Aperti

- Nessuno sul modello. Restano fuori scope la ricorsione, il picker e le note
  senza template (vedi feature sequel).

## Interfaces without a template (sequel)

Stato: idea.

Perché: la feature Interfaces richiede un template come schema di riferimento.
Una nota fuori da qualsiasi cascata non può usare `ct-interfaces`, anche se le
sue interfacce definirebbero uno schema parziale. Il caso è legittimo ma
introduce uno stato UI nuovo e va comunicato con attenzione.

Comportamento proposto:
- riferimento = solo le props delle interfacce dichiarate nella nota;
- conformità missing-only: `missing` se manca una chiave dell'interfaccia,
  `ok` se ci sono tutte; mai `extra`, perché non esiste un template che definisca
  cosa sia di troppo;
- reconform: solo Update (append delle chiavi mancanti); Align/Reset
  disabilitati;
- tooltip e stato del pannello devono spiegare che il riferimento è parziale;
- scanner dedicato o estensione dello scanner note.

Aperti:
- comunicazione UI dello stato parziale;
- interazione con auto-apply e note create fuori da un template;
- se il caso valga la complessità o se richiedere sempre un template sia
  sufficiente.

## Settings UI conforme al redesign di Obsidian

Stato: idea — baseline decisa (1.13.0, vedi «Baseline Obsidian 1.13.0»);
restano da riformulare A/B/C e l'ordine rispetto a Interfaces.

Perché: Obsidian ha ridisegnato le impostazioni (header della tab, poi una card
unica con le righe separate da hairline) e dalla 1.13 i plugin possono
descrivere la tab in modo dichiarativo, entrando anche nella ricerca globale
delle impostazioni. Oggi la tab è una lista piatta di `new Setting(containerEl)`
in `src/settings.ts` e resta visivamente indietro rispetto alle tab core.
L'intervento è solo di struttura e resa: nessun cambio di comportamento, di
persistenza o del modello di settings.

### Le due API

- **`SettingGroup`** (Obsidian 1.11.0): resa imperativa del blocco con heading e
  separatori, usabile dentro `display()`. Non dà ricerca globale, liste o
  sub-pages. Da 1.11 c'è anche `SettingTab.icon` per la sidebar.
- **`getSettingDefinitions()`** (Obsidian 1.13.0): API dichiarativa completa.
  Obsidian renderizza, indicizza per la ricerca globale, salva da solo e
  gestisce `visible` / `disabled` / `validate`, gruppi, liste e sub-pages.
  `display()` viene bypassato quando il metodo restituisce un array non vuoto.
  `control.key` normalmente legge `this.plugin.settings[key]`; il plugin ha uno
  store module-level, quindi vanno sovrascritti `getControlValue()` e
  `setControlValue()` per delegare a `getSettings()` / `updateSettings()`.
  La riga del bridge Templater (descrizione dinamica + pulsante) diventa un
  `render` callback. `getSettingDefinitions()` viene chiamato anche alla
  registrazione per indicizzare la ricerca: deve restare economico.

### Percorsi possibili

| | Implementazione | `minAppVersion` | Costo |
|---|---|---|---|
| A | solo `SettingGroup` in `display()`, con fallback piatto sotto 1.11 | resta 1.5.0 | resa nuova, niente ricerca globale |
| B | dichiarativo + `display()` legacy (dual support) | resta 1.5.0 | due implementazioni da tenere allineate |
| C | solo dichiarativo, `display()` rimosso | sale a 1.13.0 | una sola implementazione, taglia gli utenti < 1.13 |

La guida ufficiale consiglia C quando si può alzare il minimo, B quando
esiste una base utenti su versioni precedenti. A ha senso solo se interessa la
resa e non l'integrazione con la ricerca.

> Nota: con la baseline 1.13.0 decisa (vedi «Baseline Obsidian 1.13.0»), B non
> è più un'opzione e i costi di A e C vanno riletti senza il vincolo 1.5.

### Dipendenze e ordine

- I tipi installati sono `obsidian@1.5.7` e non contengono né `SettingGroup` né
  `getSettingDefinitions`. Il bump va fatto a `~1.13.0` (non `latest` e non
  `^1.13.0`): i tipi devono restare allineati al floor della feature, non
  all'ultima versione. `npm install` va lanciato da Windows: in sandbox il
  registry è bloccato.
- `minAppVersion` è `1.5.0` in `manifest.json`; la baseline decisa è 1.13.0
  (vedi «Baseline Obsidian 1.13.0»), quindi B perde senso e A va inteso come
  resa imperativa con `SettingGroup` a floor 1.13.
- **Interfaces aggiunge una setting.** Se la resa resta imperativa (`display()`
  + `SettingGroup`), conviene migrare la UI dopo Interfaces: il toggle nasce
  insieme agli altri e viene convertito una volta sola. Con la resa
  dichiarativa l'ordine è indifferente.
- La regola `obsidianmd/settings-tab/prefer-setting-definitions` è disattivata
  in `eslint.config.mts` con la motivazione legata a `minAppVersion` 1.5:
  adottando l'API dichiarativa il commento va aggiornato o l'override rimosso.
  `require-display` e `no-deprecated-display` sono coerenti con entrambe le
  rese possibili.

### Resa e contenuti

- Nessun heading con il nome del plugin o "Settings": la tab è già intitolata
  nella sidebar. Heading solo quando esistono almeno due sezioni distinte;
  con le setting attuali basta un blocco unico, i gruppi arriveranno con
  Interfaces.
- Le descrizioni attuali di auto-apply e Templater sono lunghe: la style guide
  chiede una frase, con il dettaglio spostato nel README. È una decisione di
  contenuto, non solo di CSS.
- Un solo controllo per riga, sentence case: già rispettati.
- Nessun CSS custom previsto: la resa deve venire dalle classi native.

### Impatto sul codice

- `package.json` / `package-lock.json`: bump dei tipi a `~1.13.0`.
- `src/settings.ts`: `getSettingDefinitions()`, `getControlValue()` /
  `setControlValue()`, bridge test in `render`, `display()` legacy o rimosso.
- `manifest.json`: solo per C.
- `eslint.config.mts`: override e commento della regola sulle settings.
- `main.ts`: verificare se il commento `eslint-disable` su `onload()` asincrono
  serve ancora con i tipi 1.13.
- `README.md`, `PROJECT.md`, `YOUDO.md`: documentazione e check visivi.

### Criteri di completamento

- `npm run build`, `npm run lint`, `npm test` verdi.
- Persistenza, refresh dei pannelli e bridge test invariati.
- Se B/C: le impostazioni compaiono nella ricerca globale.
- Resa verificata su desktop e mobile, light e dark, e — se B — anche su una
  versione < 1.13.
- README e PROJECT.md aggiornati; voce spostata in `PROJECT.md` e rimossa da
  `FEATURES.md`.

### Aperti

- Scelta tra dichiarativo e imperativo con floor 1.13: A/B/C vanno riformulati
  (B non ha più senso, A non «resta a 1.5», C non «taglia gli utenti < 1.13»).
- Verificare che `obsidian@1.13.0` esista su npm e che i tipi contengano
  davvero `getSettingDefinitions()`: la reference API online non lo elenca
  ancora, lo documenta solo la guida.
- Raggruppamenti definitivi: blocco unico oppure gruppi Template / Templater /
  Toolbar.
- Se accorciare le descrizioni e linkare il README.
- Se impostare `this.icon` sulla tab.
- Se usare `SettingGroup` anche nel `display()` legacy per coprire 1.11–1.12.

Riferimenti:
- [Settings](https://docs.obsidian.md/Plugins/User+interface/Settings)
- [Migrate to declarative settings](https://docs.obsidian.md/plugins/guides/migrate-declarative-settings)
- [SettingGroup](https://docs.obsidian.md/Reference/TypeScript+API/SettingGroup)

## Bridge Templater opt-in con consenso per dispositivo

Stato: idea.

Perché: oggi `evaluateTemplaterInNotes` vale `true` di default e vive in
`data.json`, quindi il permesso è opt-out e viaggia col vault: chi sincronizza
si ritrova l'esecuzione di codice abilitata su un dispositivo dove non ha mai
dato consenso. `PROJECT.md` §7 promette invece un ponte opt-in, e `<%* … %>`
esegue JavaScript con i privilegi del plugin. Templater ha risolto lo stesso
problema spostando i toggle pericolosi su base per-dispositivo, con avviso
giallo nella riga e un modal che non si conferma senza una checkbox di
assunzione di responsabilità: questa feature replica quel modello.

### Prerequisito: baseline 1.13.0

La feature assume `minAppVersion` 1.13.0 e tipi `obsidian@~1.13.0`: X del modal
e contenitori nativi forniti dall'app, eventuale `app.loadLocalStorage` /
`saveLocalStorage` tipizzato. Il bump è tracciato in «Baseline Obsidian
1.13.0», che va eseguito per primo: questa feature non parte prima di quel
bump. In assenza dei tipi 1.13 il flag usa `window.localStorage` con chiave
namespaced; il comportamento non cambia.

### Dipendenze

Templater (`templater-obsidian`, v2.x) è una dipendenza esterna e opzionale:
nessun bundling, nessun import statico, lookup runtime con feature detection.
La feature non ha senso senza Templater e lo dichiara nella UI (nome della
riga, descrizione, modal, README, PROJECT.md).

### Comportamento

1. Il flag non esiste più in `CascadeTemplatesSettings`: niente `data.json`,
   niente persistenza sincronizzata.
2. Flag per dispositivo in storage locale, chiave
   `cascade-templates:evaluate-templater-in-notes`. Default assente = spento.
3. Toggle ON → modal di conferma; nessuna scrittura prima della conferma.
4. Conferma → flag scritto, toggle ON. Annulla / Esc / X → `setValue(false)`,
   nessuna scrittura, riapertura possibile.
5. `Enable` resta `disabled` finché la checkbox «I understand the risks» non è
   spuntata.
6. Templater assente o probe fallito: toggle `disabled`, nessun modal
   raggiungibile, flag invariato.
7. Primo avvio dopo l'aggiornamento: una sola Notice non modale per
   dispositivo, perché il default precedente era ON e il cambio non deve
   passare in silenzio.
8. L'auto-apply `full` ricade sotto lo stesso consenso: nessun prompt
   aggiuntivo per nota.
9. Se il flag è ON ma Templater non è più disponibile, il runtime degrada al
   valore raw senza scrivere nulla di rotto.

### Capability probe

- Il toggle è attivabile solo se il probe end-to-end è passato: `<% 1 + 1 %>`
  via `create_running_config` + `parse_template`.
- Target: nota `.md` attiva → primo `.md` del vault → `undefined`. Zero file
  markdown = stato esplicito `Create a note first to verify the bridge`.
- Eseguito all'apertura della tab impostazioni, una volta per sessione,
  invalidato al cambio di `getTemplaterVersion()`.
- Fallito: riga `bridge verification failed` + `Test again`; nessun blocco
  definitivo, il probe si ripete.
- Non tocca contenuto utente e non scrive: è l'unica valutazione Templater
  fuori dai due percorsi di scrittura, ed è quella che il pulsante Test già
  esegue.

### UI (stringhe in inglese)

Riga impostazioni, struttura identica a Templater (classi native, nessun CSS):

> **Templater bridge**
> Requires the Templater community plugin (v2.x or later); without it this
> option stays disabled. When a note is reconformed or created with
> "Properties and body", evaluate "<% … %>" values coming from `!Template.md`.
> Never applied to template files.
> **This setting is stored on this device only and must be enabled separately
> on each device.**

Stati della riga:

| Stato | Testo | Toggle |
|---|---|---|
| assente | `Templater not detected — option unavailable` | disabled |
| probe fallito | `Templater detected vX — bridge verification failed` + `Test again` | disabled |
| probe ok, flag off | `Templater detected vX — bridge verified` | enabled, off |
| probe ok, flag on | come sopra + `mod-warning` per-dispositivo | enabled, on |

Modal:

> **Enable Templater evaluation in notes**
> This can be dangerous if your templates contain unsafe content: "<%* … %>"
> blocks run arbitrary JavaScript, and expressions can read or modify files in
> your vault.
> *Only enable this if you trust the current and future contents of this
> vault, including files you may later download, copy, or sync from other
> people.*
> This setting is stored on this device only; enable it separately on each
> device where you use this vault. This plugin calls Templater's internal API;
> if Templater is disabled or updated incompatibly, expressions are written
> verbatim.
>
> `[ ] I understand the risks` `[Enable]` (disabled) `[Cancel]`

Classi: `mod-warning`, `mod-checkbox`, `mod-cta`, `mod-cancel`,
`modal-button-container`. Il contenitore bottoni è fratello di `.modal-content`,
non figlio.

### Tooltip del reconform

Tre stati distinti, senza I/O aggiuntivo:

- bridge spento e template con `<%` → invito ad attivare la setting;
- bridge ON ma Templater non più disponibile → `expressions are written
  verbatim`;
- template con `<%*` → `contains script blocks that run code`, calcolato sulle
  props del template (cache metadata). Nel solo auto-apply `full` il controllo
  copre anche il body, che è già in memoria. Il pannello non legge il body:
  sarebbe I/O per keystroke.

### Migrazione

- Il valore `evaluateTemplaterInNotes` presente in `data.json` viene ignorato:
  non è un consenso informato, non va importato.
- `normalizeSettings` non lo valida più; la chiave residua resta innocua.
- Lettura e scrittura del flag in try/catch: storage non disponibile = spento.

### Interazione con Templater

- Nessuna dipendenza da `trigger_on_file_creation`: è la flag che fa valutare
  `<% … %>` anche nei `!Template.md` e rompe l'invariante «template sempre
  raw», senza che il plugin possa impedirlo.
- `parse_template` gira senza sandbox: il modal è consenso informato, non
  protezione, e il testo lo dice.
- Resta valido il contratto attuale: API non pubblica, feature-detected, ogni
  errore degrada al valore raw.

### Impatto sul codice

- `src/core/templaterConsent.ts` (nuovo): lettura, scrittura e cache del flag.
- `src/features/TemplaterConsentModal.ts` (nuovo): modal con checkbox
  bloccante.
- `src/settings.ts`: campo rimosso dal modello e dai default; riga con
  descrizione `mod-warning`; handler del toggle con modal e revert; probe e
  stati della riga; Notice una-tantum.
- `src/core/templateAPI.ts`: i due resolver leggono il flag dal dispositivo.
- `src/features/metadataPanel.ts`: tooltip a tre stati.
- `src/core/templaterBridge.ts`: helper `hasScriptSyntax` per `<%*`.
- `manifest.json`, `package.json`, `versions.json`: baseline 1.13.0.
- `PROJECT.md` §7, `README.md`: modello opt-in per dispositivo e prerequisito
  Templater.
- `YOUDO.md`: check manuali.

### Criteri di completamento

- `npm run build`, `npm run lint`, `npm test` verdi.
- Primo uso: toggle OFF, nessuna valutazione, tooltip che invita ad attivare.
- Attivazione: modal, `Enable` bloccato fino alla checkbox, flag scritto solo
  dopo conferma.
- Annulla / Esc / X: toggle OFF, storage invariato.
- Probe: assente, fallito, ok; `Test again`; invalidazione al cambio versione.
- Secondo dispositivo dopo sync: toggle OFF, Notice mostrata una volta per
  dispositivo.
- `<%*` segnalato nel tooltip; template mai valutati in nessun percorso.
- README e PROJECT.md aggiornati; voce spostata in `PROJECT.md` e rimossa da
  `FEATURES.md`.

### Non-obiettivi

- Nessun sandbox e nessun blocco selettivo di `<%*`: è sintassi legittima dei
  template, il rischio si comunica, non si impedisce.
- Nessuna granularità per nota, cartella o template: consenso per vault e per
  dispositivo.
- Nessun prompt a ogni reconform.
- Nessuna dipendenza dalle impostazioni di Templater (trigger, system
  commands).
- Nessuna migrazione del vecchio `true` come consenso.

### Aperti

- Se la descrizione dichiarativa di 1.13 supporta contenuto ricco: se solo
  stringa, il `mod-warning` va reso con un `render` dedicato (o si accetta
  testo semplice, con il modal come segnale forte).
- Se restringere il reconform alla sola template side (oggi valuta anche i
  `<%` già presenti nella nota), allineandolo all'auto-apply.
- Testo definitivo della Notice una-tantum.
- Se separare un secondo gate per il body di auto-apply `full`.
- Se il probe con target `undefined` sia tollerato da Templater: non
  verificabile in sandbox, si scopre al primo run; in caso di errore resta lo
  stato `verification failed`.
