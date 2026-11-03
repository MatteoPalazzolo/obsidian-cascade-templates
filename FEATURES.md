# FEATURES

Workbench delle feature non ancora concluse. Le voci restano qui finché non
sono completate: solo allora si spostano in `PROJECT.md` (archivio della
documentazione) e si rimuovono da questo file. `PROJECT.md` non anticipa mai
feature pianificate.

## Stati

Quattro stati in sequenza. Lo stato misura il lavoro **fatto**: `spec` dice che
il disegno è chiuso, non che il codice esista.

- **`idea`** — la feature è annotata e motivata, ma il contratto non c'è: manca
  il comportamento, o l'impatto sul codice, o i criteri di completamento,
  oppure resta una decisione che ridisegna la feature. Non è implementabile
  senza progettare.
- **`spec`** — disegno chiuso: comportamento, impatto sul codice e criteri di
  completamento sono scritti e coerenti. Gli `Aperti` sono decisioni locali e
  circoscritte, dichiarate nella voce, che si chiudono durante
  l'implementazione senza ridisegnare la feature. Codice assente.
- **`in corso`** — esiste codice non ancora completo; la voce indica cosa manca
  rispetto ai criteri di completamento. Di norma una sola feature per volta è
  `in corso`.
- **`completata`** — criteri di completamento soddisfatti e documentazione
  aggiornata: la voce si sposta in `PROJECT.md` e si rimuove da qui, quindi
  `completata` non resta mai scritto in questo file.

Ciclo: `idea` → `spec` → `in corso` → `completata` (da spostare). Ogni passo
avanti presuppone il precedente: non si entra `in corso` su una `idea` e non si
esegue una `spec` che non è chiusa. Il passo indietro è ammesso quando il
lavoro si ferma (`in corso` → `spec` se il codice non si regge, `spec` → `idea`
se una decisione salta): lo stato è una fotografia, non una promessa.

I controlli manuali non si annotano qui: vivono in `YOUDO.md`, che è
l'unico elenco delle verifiche a carico dell'utente.

## Mappa e ordine di lavoro

Ogni feature ha una lettera stabile, usata anche nei rimandi incrociati di
questo file. La tabella è in **ordine di lavoro**, non alfabetico.

| Lettera | Feature | Stato |
|---|---|---|
| **B** | Cascade dashboard (ex scanner E) | spec |
| **D** | Interfaces (`ct-interfaces`) | spec |
| **D2** | Interfaces without a template (sequel di D) | idea |

La colonna Stato segue «Stati»; a dire cosa viene prima è l'ordine, non lo
stato.

Ordine deciso: **B → D**. D2 non entra in piano finché D non è validata sul
campo. A, C, F e G sono completate e archiviate in `PROJECT.md`.

Perché questo ordine:

- **B prima di D.** B introduce il ritorno `{before, changes, changed}` di
  `reconformFile` e gli helper della foresta che D usa.
- **D per ultima.** Tocca pannello, foresta e dashboard: arriva quando
  l'universo della foresta è stabile.
- **D2 fuori piano.** Dipende dagli aperti di D e di B.

Vincoli da rispettare durante l'implementazione:

- **Seam per D dentro B.** B deriva il riferimento con un `referenceFor(node)`
  iniettabile; oggi risolve al template della cartella, con D diventa
  template + interfacce della nota. La foresta non deve assumere un riferimento
  per cartella, altrimenti D rifà `forest.ts`, `journal.ts` e i relativi test.
- **Semantica prima del README di B.** La regola «`ok` = stesso insieme di
  chiavi» e l'aperto «`ct-interfaces` è un'eccezione value-level?» (vedi D)
  vanno decisi prima di congelare la regola nel README: D arriva dopo e non
  deve smentirlo.
- **Release.** B come release della dashboard, poi D.
- **Lettere storiche nel codice.** I commenti usano ancora le sessioni
  (C = pannello, D = impostazioni, E = scanner, G = bridge), che non
  coincidono con queste lettere: non si rinominano, se ne tiene conto in
  lettura. Nei rimandi un aperto con due lettere (es. `D/B`) è condiviso dalle
  due feature.

## (B) Cascade dashboard (ex scanner, E)

Stato: spec — implementazione non iniziata, prima feature del piano residuo
(vedi «Mappa e ordine di lavoro»): oggi `src/scanner/` è ancora il codice in
uso e nessun modulo della dashboard (`forest.ts`, `journal.ts`,
`src/features/dashboard/`) esiste.

Perché: lo scanner di 1.0.0 è un accordion piatto con due liste di file, senza
gerarchia, senza scope visibile e senza azioni. Ma il modello del plugin è un
albero di cartelle: un elenco piatto non lo spiega e non permette di agire. Il
redesign sostituisce il Modal con una dashboard a tre tab (struttura, problemi,
history), espone i verbi di conformità con i gate corretti e introduce un
journal di sessione che rende reversibili anche le operazioni globali. Senza il
journal, `Align notes` su tutto il vault sarebbe esattamente l'automazione a
cascata che il prodotto dichiara di non essere. Il journal è globale e riguarda
solo le operazioni della dashboard; il Back del pannello resta una history
locale alla nota, volatile e indipendente (vedi Due livelli di history).

### Lessico

- **template**: file con il nome fisso `getTemplateFilename()` (`!Template.md`
  di default) dentro una cartella. Un template per cartella, quindi nessuna
  ambiguità di risoluzione.
- **cascata**: sottostruttura di cartelle che eredita il frontmatter di un
  template lungo la catena degli antenati.
- **local root**: la cartella con un template che non ha template antenati. È la
  radice di una cascata.
- **operazione**: il click su un verbo della dashboard, cioè l'unità che l'utente
  percepisce e che il budget misura. `Fix all` è una macro: resta una sola
  operazione, anche se produce più entry.
- **entry**: il record di una scrittura nel journal. Ogni operazione che scrive
  produce una entry; l'unica eccezione è `Fix all`, che ne produce una per fase
  che scrive (fino a tre).
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
- **Il riferimento è iniettato per nodo** (`referenceFor(node)`): oggi risolve
  al template della cartella, con D (interfaces) diventa template + interfacce
  dichiarate dalla nota. La derivazione non deve assumere un riferimento per
  cartella: è la seam che evita di rifare `forest.ts`, `journal.ts` e i test
  quando arriva D.
- **Nota senza frontmatter o non indicizzata**: non partecipa. Non compare in
  `Issues`, non entra nei conteggi, non è raggiungibile dai verbi. Compare in
  `Cascade` come riga attenuata senza badge, perché la mappa strutturale non
  deve mentire sul contenuto della cartella.
- Badge di cartella: aggregato dei figli con precedenza `missing` > `extra` >
  `ok`.
- Conteggi di una riga: `T` (template non conformi nel sottoalbero), `Nm` (note
  `missing`), `Ne` (note `extra`). Sono **dello scope dell'azione**, cioè del
  sottoalbero: il numero che leggi è il numero di file che il click toccherà.

### Struttura del modal

Titolo: da confermare dopo l'implementazione (`Cascade Templates` o `Cascade
dashboard`). Non è più uno "scanner": è la dashboard del plugin.

- Header condiviso dai tre tab: `Fix all (N)` centrato e `undo-2`
  (`Undo last batch`, tooltip: ultima operazione della dashboard), disabilitato
  quando il journal è vuoto.
- Tab: `Cascade | Issues (N) | History (M)`.
  - `Cascade`: nessun contatore, nemmeno per le local root.
  - `Issues (N)`: `N` = file non conformi (le righe di contesto non contano).
  - `History (M)`: `M` = entry ripristinabili.
  - `Fix all (N)` mostra lo stesso `N` di `Issues`, altrimenti nello stesso
    header compaiono due cifre diverse e sembra rotto.
  - `Issues` e `History` sono disabilitati quando il loro counter è 0. Se il
    counter scende a 0 mentre il tab è attivo, il tab resta attivo e mostra
    l'empty state in place: niente navigazione forzata.
- Si apre su `Cascade`.
- Durante un batch o un rewind: tab, undo e chiusura del modal bloccati (stesso
  mutex). `Esc` non chiude il modal: è l'eccezione esplicita alla regola di
  tastiera. Un cancel per i batch lunghi è un aperto, non una promessa.
- Progresso: linea indeterminata in cima al contenuto, `--interactive-accent`,
  2–3 px, animazione in loop, statica e attenuata con `prefers-reduced-motion`.
  Accanto un label testuale (`Fixing 2/3 · Updating notes`): la linea da sola
  non distingue "sta lavorando" da "si è piantato".
- Report di fine operazione: `Notice` se è andato tutto bene, dialog di
  dettaglio se ci sono fallimenti.

#### Tab `Cascade`

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
- Empty state a 0: `No issues`. Se il tab è già attivo quando il counter scende
  a 0, il contenuto viene sostituito dall'empty state e il focus resta lì.

#### Tab `History`

- Solo operazioni del journal, cioè della dashboard: le pressioni del pannello
  non compaiono mai (vedi Due livelli di history).
- Una card orizzontale per entry, in ordine cronologico decrescente: verbo,
  timestamp, `Templates modified: N · Notes modified: N · Folders involved: N`,
  e il verbo di annullamento.
- Niente log, niente elenco file: la history è un riassunto. I dettagli
  (`Undo 3 operations · 38 files · 2 conflicts`) stanno nella conferma, non
  nella card.
- `Folders involved` = cartelle distinte che contengono almeno un file
  modificato.
- **Il verbo dipende dalla posizione.** Sulla card in cima è `Undo`, identico a
  `Undo last batch` dell'header. Su una card più vecchia è
  `Undo this and N newer operations`: annulla quella entry e tutte le più
  recenti (vedi Journal). La conferma dichiara la portata con i numeri presi dal
  preflight: entry, file, cartelle, conflitti, file spariti.
- Le entry prodotte da `Fix all` portano `routine: {id, step, total}` e sono
  raggruppate sotto un header **derivato** dalle entry sopravvissute:
  `Fix all · 3 operations`, `Fix all · 2 of 3 operations`, `Fix all · stopped
  after phase 1`. Con una sola entry superstite il gruppo si dissolve in card
  normale. Ogni entry resta ripristinabile singolarmente.
- **Errori.** Un rewind fallito non è un errore di conformità e non ha casa in
  `Issues`: compare come card di errore in testa a `History`, con fatti/non
  fatti, entry non consumata e retry. Sparisce al dismiss o al primo retry
  riuscito.
- **Counter a 0 mentre il tab è attivo.** Il tab mostra un empty state in place
  (`Nothing to restore`); non si viene portati altrove e il focus resta nel
  contenuto. Il counter a 0 impedisce solo l'ingresso dagli altri tab.
- Empty state e tooltip del tab dicono che si tratta di operazioni della
  dashboard: chi ha passi di Back nel pannello non deve leggere `History (0)`
  come un bug.

### Verbi

| Verbo | Dove | File toccati | Gate |
|---|---|---|---|
| `Update template` | riga template | quel template | nessuno |
| `Update templates` | cartella, local root, `All cascades` | solo template, top-down per profondità | nessuno |
| `Update note` / `Update notes` | riga nota / cartella, local root, `All cascades` | solo note | nessuno |
| `Align note` / `Align notes` | riga nota / cartella, local root, `All cascades` | solo note | catena sound |
| `Fix all` | header del modal | template, poi note, poi note | macro, vedi sotto |
| `Undo last batch` | header del modal | l'entry in cima del journal | conferma se ci sono divergenze |
| `Undo this and N newer operations` | card della history (non la prima) | quella entry e tutte le più recenti | conferma con numeri e diff |

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

- Un click che scrive = un'operazione. Per i verbi normali è un batch omogeneo
  (stesso tipo di file, stesso verbo) e produce una entry del journal. `Fix all`
  è l'unica macro e produce fino a tre entry, una per fase che scrive. Se il dry
  run conta 0 file cambiati il click non produce entry e la UI lo dice
  (`Nothing to do`).
- **Dry run** prima di eseguire: calcola il target di ogni nodo con le stesse
  funzioni pure del batch, confronta con il corrente e conta solo i file che
  cambierebbero davvero. La stessa passata produce il numero per la conferma, la
  stima di peso dell'operazione e il rilevamento di `<% %>` nei riferimenti.
  Nessuna scrittura, nessun accesso al disco: solo mappe dalla cache.
- Conferma **per scope**: bulk su cartella, local root o `All cascades` sempre;
  azione su singolo file mai.
- Esecuzione sequenziale in ordine deterministico (superficiale → profondo).
- Fallimento in avanti:
  - **note**: foglie indipendenti → si prosegue sulle altre e si riportano le
    fallite;
  - **template**: catena di dipendenza (il target di un figlio dipende dallo
    stato del padre) → si ferma il sottoalbero, i fratelli proseguono.
  In entrambi i casi l'entry resta nel journal con `changes` solo per i file
  effettivamente scritti e `skipped` per gli altri; un retry riparte dai
  mancanti, ed è sicuro perché ogni scrittura è idempotente (target state, non
  delta).
- Il conteggio riportato nella `Notice` è quello reale, non la stima del dry
  run.

### `Fix all`

- **Macro, non verbo nuovo.** Esegue tre fasi in sequenza, con una entry per
  fase che scrive: `Update templates` → `Update notes` → `Align notes`.
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

### Due livelli di history

Il plugin ha due storie, con unità, scope e vita diverse. Non si leggono e non
si scrivono a vicenda: nessuna delle due è una vista dell'altra.

| | Journal globale | History della nota |
|---|---|---|
| Chi lo produce | operazioni del tab `Issues`, batch o singolo file | una pressione del pulsante a fasi nel pannello |
| Unità | un'operazione: una entry, salvo `Fix all` che ne produce fino a tre | una pressione, con la sua fase |
| Scope | sessione del plugin | una per nota, condivisa dalle tab che mostrano quella nota |
| Memoria | budget, internment, eviction FIFO | nessun budget: stack corto, limitato alla sessione |
| Fine | `onunload`, eviction | scrittura esterna sul frontmatter, nessuna tab che mostra la nota, stack svuotato |
| Superficie | tab `History` | `Back` del pannello |

- Il journal **non** registra le pressioni del pannello (`origin: "batch" |
  "fix-all"`); il Back **non** consuma entry, **non** fa scendere `History (M)`
  e **non** è influenzato da eviction, undo o restore.
- Il file è la risorsa condivisa: **qualsiasi scrittura sul frontmatter che non
  venga dal pulsante di quella nota uccide la sessione locale**, comprese le
  operazioni della dashboard. La scrittura globale ha priorità assoluta: una
  pressione che arriva durante un batch o un rewind **decade**, non viene
  accodata.
- Sono due consumatori diversi dello stesso evento `changed`: il rebuild della
  foresta ignora gli eventi generati dal batch e si riallinea a fine batch; la
  sessione del pannello non li ignora e si chiude per token di origine. Un batch
  della dashboard resta una scrittura esterna per il pannello, anche se non
  provoca un rebuild dell'albero.
- La sessione è **per nota, non per view**: due tab sulla stessa nota
  condividono stack, cursore e stato del pulsante e si aggiornano insieme.
  Editare la nota 1 non tocca la sessione della nota 2.
- Le scritture del pulsante non chiudono la sessione: è l'unica eccezione, ed è
  la ragione per cui lo stack può esistere. L'origine di una scrittura si
  distingue **per path**, non per view, perché l'evento `changed` è unico per
  file.
- Una nota che non è più visibile in nessuna tab perde la sessione: riaprirla dà
  sempre una history vuota. L'insieme delle note visibili si **deriva** dalle
  view aperte, non si conta con un reference counter.
- Il cursore di fase appartiene alla sessione, quindi è per nota e non per view,
  e torna alla fase base quando la sessione finisce.

### Journal

- Vive nel plugin, non nel modal: chiudere e riaprire la dashboard conserva la
  history. Scope = sessione, muore con `onunload`. Riguarda **solo** le
  operazioni della dashboard: il pannello ha la sua history locale (vedi Due
  livelli di history).
- Entry: `{id, origin, at, routine?, files: FileChange[]}` con
  `origin: "batch" | "fix-all"`. Per file:
  `{path, before, changes, skipped?}`.
  - `before` è la mappa **completa**: è il target quando la entry è la più
    vecchia del range, e serve per le chiavi che entry successive del range
    toccano ma questa no.
  - `changes` è la lista **autorevole** delle chiavi toccate:
    `[{key, after}]`, dove `after` è il nuovo valore oppure `REMOVED`. Una
    chiave assente da `changes` non è stata toccata. La rimozione è uno stato
    esplicito: senza, "invariata" e "cancellata da `Align`" sarebbero
    indistinguibili.
  - `skipped` = file non scritto: nessuna change, nessun ripristino.
  - `touched(file) = keys(changes)`: è questo insieme, non la mappa dei valori,
    a definire cosa il restore sovrascrive.
- Modello a **target state**, non a delta: un edit manuale non crea buchi,
  perché viene assorbito dal `before` della entry successiva che tocca quel
  file.
- `Undo last batch` = pop dell'entry in cima. `Undo this and N newer
  operations` = pop di tutta la coda più recente, applicando per ogni chiave
  toccata nel range il valore che aveva nel `before` della **entry più vecchia
  del range che ha toccato il file**. Non si applicano le entry in ordine: si
  scrive direttamente lo stato finale.
- Il restore è **scoped alle sole chiavi toccate**: le chiavi estranee
  sopravvivono sempre; le chiavi toccate vengono riportate al valore che avevano
  all'inizio del range, o rimosse se allora non esistevano.
- Conflitti: preflight che ripete il rewind in memoria. Una divergenza su una
  chiave toccata è un conflitto → conferma con diff
  (`file → chiave: tuo valore → ripristinato`), non abort automatico: il target
  esiste, la decisione è dell'utente. Diff per chiave fino a una soglia di file
  (10), poi aggregato per file con espansione. **Entrano nel diff solo i file
  che richiedono una scrittura**: un file già al target non è un conflitto, e
  vale anche per il retry dopo un rewind parziale.
- File cancellati o rinominati tra l'operazione e il rewind: **skip con avviso**
  nel preflight (`2 files no longer exist`). Non è un'applicazione parziale: non
  c'è più nessuno stato da ripristinare.
- Fallimento parziale durante il rewind: stop immediato, **entry non
  consumata**, riporto di fatti/non fatti, retry idempotente. I file già al
  target vengono saltati, non segnalati come divergenze.
- Non atomicità: N `process` sequenziali, nessuna transazione. UI congelata, gli
  eventi `changed` generati dal batch sono **ignorati dal rebuild della
  foresta** (non dalla sessione del pannello, che si chiude per token di origine),
  un solo ricalcolo finale dalla `metadataCache`: dopo skip, fallimenti ed
  eviction il journal non è source of truth della foresta. Un quit a metà lascia
  uno stato parziale non tracciato: rischio accettato e dichiarato in UI.
- Divergenze: **calcolate on demand**, confrontando il valore corrente con
  l'`after` dell'ultima entry che ha scritto quella chiave (`REMOVED` compreso).
  Non si traccia nulla; l'unica cosa che viene dall'evento `changed` è il
  timestamp (`changed manually at 14:31`).
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
- **L'unità di budget è l'operazione, non la entry.** Una `Fix all` produce fino
  a tre entry ma resta **una sola unità di budget**: la stima è la somma delle
  fasi, e la macro non si rimuove mai a metà. O tutta o niente: se lo spazio
  basta solo per una parte, si scarta la macro intera e la troncatura lo dice.
- **Operazione oversized.** Se la stima di una singola operazione supera il
  budget, troncare non basta: la conferma di esecuzione avvisa che l'operazione
  **non sarà annullabile**, parte solo su conferma esplicita e non viene
  registrata. Mai un drop silenzioso.
- Veto quando l'operazione stimata supera `budget / 2`: dialog a due bottoni,
  `Proceed` (tronca la history e registra) e `Cancel` (non esegue). "Procedi
  senza registrare" non è un'opzione: se lo spazio va liberato, la nuova entry
  si registra.
- **Il veto è sulla stima, la verifica è sul reale.** La stima viene dal dry
  run; se l'operazione reale supera comunque soglia o budget, si applica la
  stessa regola a posteriori: eviction dalla testa e, se non basta, scarto
  dell'operazione intera con la troncatura visibile.
- Budget: 8 MB su mobile, 32 MB su desktop (`Platform.isMobile`).

### Integrazione col pannello Properties

- Il Back resta **uno stack locale alla nota**, con il cursore di fase
  accoppiato: nessuna vista filtrata sul journal, nessuna entry consumata.
- La sessione è **per nota, non per view**: stack, cursore e stato del pulsante
  sono condivisi da tutte le tab che mostrano la stessa nota e si aggiornano
  insieme. Editare la nota 1 non tocca la sessione della nota 2.
- La sessione muore per: prima scrittura esterna sul frontmatter (manuale, sync,
  altro plugin, **dashboard inclusa**), nessuna tab che mostra più la nota,
  stack svuotato da Back. Le uniche scritture che non la chiudono sono quelle
  del pulsante stesso.
- `Back` è abilitato se e solo se lo stack non è vuoto. Non esiste uno stato
  "divergente con motivo": se il frontmatter è cambiato fuori dal pulsante la
  sessione non c'è più, quindi non c'è nulla da spiegare.
- Una chiave estranea aggiunta a mano **chiude** la sessione: è il prezzo del
  modello a vita corta, ed è coerente con "la prima interazione col frontmatter
  chiude il discorso". Non è un falso positivo da correggere.
- `clearHistory` e `clear()` confluiscono in `endSession(view)`, che chiude stack
  e cursore insieme.
- Una pressione del pannello durante un batch o un rewind **non viene
  accodata**: decade, perché il globale ha priorità assoluta. La scrittura del
  pulsante non deve mai sovrascrivere quella del journal.
- Il pannello guadagna una sola affordance: `Open cascade dashboard`, che apre
  la dashboard sul tab `Cascade`, già scoped alla cascata del file corrente.
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
- Card di `History` e card di errore: il verbo di annullamento è un'azione a
  tutta larghezza sotto i numeri, non nel `⋯` (la card non è una riga
  dell'albero); i numeri vanno a capo su due righe.
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
- `Esc`: chiude il menu, poi il modal (bloccato durante batch e rewind);
- **Fuori dall'albero**: le card di `History` e la card di errore sono uno stop
  di tabulazione separato; `Enter` attiva il verbo di annullamento, `Esc` chiude
  prima il dialog di conferma.

`role="treeitem"`, `aria-level`, `aria-expanded`, DOM in ordine visivo. Va fatto
insieme al renderer, non retrofittato.

### Performance

- La foresta si costruisce **top-down sulle cartelle** con memoizzazione
  `cartella → template`. Non per file: `getTemplateOfFile` fa un
  `getAbstractFileByPath` per livello di antenato, per file, e su 10k note
  diventa decine di migliaia di lookup per rebuild.
- Ricostruzione debounced su `changed`, `resolve`, `resolved` e sui `vault`
  `create` / `delete` / `rename`.
- Durante un batch gli eventi `changed` generati dal plugin sono ignorati dal
  rebuild della foresta e l'albero si riallinea dalla `metadataCache`, non dal
  journal. La sessione del pannello resta un consumatore separato: si chiude per
  token di origine, non perché l'evento sia stato ignorato altrove.

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
- `src/core/journal.ts` (nuovo, puro): entry con `before` + `changes` e
  `REMOVED`, internment, budget per operazione, eviction, veto, preflight del
  rewind, diff delle divergenze.
- `src/core/templateAPI.ts`: `reconformFile` torna `{before, changes, changed}`
  mantenendo un unico entry point; helper per il batch, che espone anche il dry
  run.
- `src/core/reconformSession.ts` (nuovo, puro): il modello dello stack, con
  chiave = path invece della view: snapshot con frontmatter, fase e chiavi
  scritte, `endSession`, sweep delle note visibili per scartare le sessioni
  sparite. `src/core/reconformHistory.ts` resta l'adapter I/O che applica il
  modello e parla con le view; nessun legame col journal.
- `src/features/metadataPanel.ts`: `endSession` unifica `clearHistory` e il
  reset del cursore, sincronizzazione dello stato del pulsante tra le tab della
  stessa nota, Back = stack non vuoto, affordance `Open cascade dashboard`.
- Scritture: un'unica API per path (coda seriale, ricalcolo dentro
  `vault.process`) e token di origine depositato sul path prima del write; il
  token `panel` non uccide la sessione, qualunque altro sì. Generation check al
  commit: la pressione decade se la sessione è stata uccisa nel frattempo.
- `src/features/dashboard/` (nuova, sostituisce `src/scanner/`): modal, tab,
  albero, menu `⋯`, card di history, card di errore, progress line.
- `src/settings.ts`: rimozione dei campi e dei tipi elencati sopra.
- `main.ts`: import della dashboard, icona ribbon placeholder (`git-fork`, con
  fallback via `setIconSafe`) e comando placeholder `Open Cascade Templates`.
- `styles.css`: tab, righe dell'albero, indentation, progress line, card.
- `README.md`: lessico della foresta, `ok` = insieme di chiavi, verbi e gate,
  due livelli di history (journal della dashboard, Back locale alla nota). I due
  settings dello scanner non sono elencati nel README attuale, quindi non c'è
  una rimozione da annunciare.
- `PROJECT.md` §12 (scanner), §13 (vincoli), §14 (stato) e §15 (riferimenti) a
  lavoro concluso (la feature non si anticipa).

### Test

La suite è pure-core: journal, forest, dry run e logica di sessione devono
essere funzioni pure con l'IO iniettato (per le sessioni, l'insieme dei path
aperti). Aggiungere `forest`, `journal` e il modulo puro di sessione a
`tsconfig.test.json`; l'adapter `reconformHistory` resta fuori dalla suite
perché fa I/O sulle view.

- `forest`: derivazione, local root vs sotto-cascata, ordinamento per path,
  badge aggregato, conteggi per scope, note fuori cascata, note senza
  frontmatter.
- `journal`: target state per file, `REMOVED` per le cancellazioni, chiavi
  estranee preservate, eviction FIFO, budget per operazione e `Fix all` come una
  sola unità anche con tre entry, veto su stima e su reale, internment, preflight
  con divergenze, retry dopo rewind parziale senza falsi conflitti, file spariti,
  nessuna entry senza scrittura.
- `sessioni`: una per nota e non per view, condivisa da due tab, morte su
  scrittura esterna (dashboard inclusa) e sopravvivenza alle scritture del
  pulsante, cursore sincronizzato, riapertura della nota = storia vuota, Back
  che non tocca il journal e journal che non tocca il Back.
- `dry run`: conteggio dei soli file che cambiano, stima di peso
  dell'operazione, rilevamento `<% %>`.
- Fixture come struttura di path sintetica, senza file system reale.

### Criteri di completamento

- `npm run build`, `npm run lint`, `npm test` verdi.
- Le tre tab rispettano i counter e i disabilitati; `Cascade` è read-only; un
  tab attivo che scende a 0 mostra l'empty state in place.
- `Update` sempre disponibile; `Align` bloccato su catena non sound, con motivo
  visibile su riga e gruppo.
- `Fix all` esegue le tre fasi, si ferma su errore, e lascia le card raggruppate
  (fino a tre, una per fase che ha scritto).
- Journal: undo, rewind con conferma, eviction visibile, fallimento parziale con
  retry, file spariti saltati con avviso.
- History: verbo di annullamento dinamico con portata e numeri del preflight;
  gruppo `Fix all` derivato; errore di rewind nel tab; empty state a 0.
- Due livelli indipendenti: nessuna pressione del pannello in `History`, Back
  che non consuma entry e non è toccato da eviction o restore.
- Pannello: Back = stack non vuoto; sessione per nota condivisa e sincronizzata
  tra tab; morte su qualunque scrittura esterna, dashboard inclusa;
  `Open cascade dashboard`.
- Schermata di indicizzazione solo quando serve, con uscita al timeout.
- Verifiche manuali (resa desktop/mobile, tema chiaro/scuro, long-press/`⋯`,
  indentazione profonda, animazione con `prefers-reduced-motion`, popout con la
  stessa nota, drag di una tab tra pane) tracciate in `YOUDO.md`.
- README e PROJECT.md aggiornati; voce spostata in `PROJECT.md` e rimossa da
  `FEATURES.md`.

### Aperti

- Budget esatto da tarare su una misura reale; la soglia del veto è
  `budget / 2`.
- Nome definitivo del modal, del comando e dell'icona ribbon: rinviati a dopo
  l'implementazione. Fino ad allora restano i placeholder (`Cascade Templates`,
  `Open Cascade Templates`, `git-fork`).
- Se il journal debba sopravvivere al reload: sarebbe una feature separata,
  perché al reload ogni entry va riverificata chiave per chiave.
- Se serva un `Update all` unico che unisca template e note: oggi è escluso dal
  batch omogeneo.
- Se l'errore di esecuzione debba anche essere persistito, o restare di
  sessione come il journal.
- Se una pressione del pannello superata da un batch debba avvisare
  (`operation superseded`) o decadere in silenzio.
- Cancellazione di un batch lungo (`Stop after current file`): oggi `Esc` e la
  chiusura sono bloccati e non esiste un cancel.

## (D) Interfaces (ct-interfaces)

Stato: spec — minor dedicata, ultima in ordine dopo B, con due decisioni
locali ancora aperte (eccezione value-level di `ct-interfaces` e politica dei
link non risolti).

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
- Link irrisolti, self-link, link a file non `.md`, valori non-stringa e link
  malformati **non contribuiscono al riferimento**. Non esiste uno stato
  `invalid` e nessun link blocca Update/Align/Reset. Se un link non risolto
  debba essere segnalato in silenzio o con un warning non bloccante è un aperto
  di questa feature, da decidere all'implementazione.
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
coperto da (D2).

### Conformità

- **Nota vs riferimento**: `ok` / `extra` / `missing`, come oggi, ma il
  riferimento include le chiavi delle interfacce. `ct-interfaces` è filtrata
  dal confronto.
- **Template vs parent**: props dichiarate come oggi, più il check di
  sottoinsieme sui link di `ct-interfaces`. Link del parent mancanti nel figlio
  = template incoerente; link extra del figlio = specializzazione ammessa.
- **Link non risolto**: non contribuisce al riferimento e non produce uno stato
  dedicato. Update/Align/Reset usano i soli link risolti; la segnalazione
  (silenziosa o warning non bloccante) è un aperto.
- Un'interfaccia vuota (nessun frontmatter) è valida e non contribuisce nulla.

### Reconform

Matrice dei tre stati. `ct-interfaces` non è mai una prop del contratto: è una
dichiarazione che sopravvive alle azioni.

| File | Update | Align | Reset |
|---|---|---|---|
| Nota con template | aggiunge le chiavi mancanti del riferimento (template + interfacce), preserva i valori esistenti, riporta l'ordine al riferimento e lascia le prop extra in coda; preserva `ct-interfaces` | rimuove le prop non presenti nel riferimento; preserva `ct-interfaces` | riporta le prop ai default del riferimento; preserva `ct-interfaces` |
| Template con parent | aggiunge le prop mancanti del parent e fa il merge dei link `ct-interfaces` del parent con quelli del figlio; non materializza le chiavi delle interfacce | default: se il parent ha `ct-interfaces` la chiave resta con l'array del figlio; se il parent non ce l'ha, la chiave viene rimossa come prop extra | riporta le prop dichiarate al parent; `ct-interfaces` diventa l'array del parent, o viene rimossa se il parent non ce l'ha; non materializza le chiavi |
| Nota senza template | inerte in fase 1 | inerte | inerte |
| Link non risolto | prosegue sui link risolti | prosegue sui link risolti | prosegue sui link risolti |

Note:
- `Reset` resta **solo del pannello Properties**: la dashboard B non lo espone e
  non lo aggiunge.
- Sulle note la dichiarazione `ct-interfaces` è sempre preservata: è ciò che
  definisce il riferimento. Rimuoverla cambierebbe il significato dell'azione.
- Sui template `ct-interfaces` segue il comportamento di default rispetto al
  parent. Un template figlio che aggiunge interfacce non presenti nel parent le
  perde con Align/Reset: è il comportamento prevedibile, non un caso speciale.
- Non esiste uno stato `invalid`: un link non risolto non blocca il pulsante e
  non fa ripartire il cursore. Il tooltip può elencarlo, ma la policy di
  segnalazione è l'aperto D/B.
- Il no-op di una fase usa lo stesso calcolo del reconform, inclusa la
  preservazione della chiave riservata.
- Back/history locale continua a funzionare: lo snapshot della nota contiene
  anche `ct-interfaces`.

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
  delle interfacce con la provenienza (`template` o `nota`). I link non risolti
  possono comparire nel tooltip; la policy di segnalazione è aperta.
- **Template**: l'icona continua a confrontare le props dichiarate con il
  parent. Il tooltip elenca le interfacce dichiarate.
- **Link non risolto**: non c'è uno stato dedicato né hard-disable; il tooltip
  può elencarlo. La segnalazione è l'aperto D/B.
- **Nota senza template**: stato neutro e pulsante disabilitato, come oggi;
  `ct-interfaces` resta inerte in fase 1.
- **Refresh**: quando cambia il frontmatter di una nota-interfaccia, vanno
  aggiornate le view la cui nota o il cui template la usano. Oggi
  `refreshViewsForFile` guarda solo il template diretto: va esteso.
- **Navigazione dal badge**: resta quella attuale (template per le note, parent
  per i template). Le interfacce si aprono dai link nella prop.

### Dashboard

- **Note**: usano il riferimento effettivo (template + interfacce), filtrano
  `ct-interfaces` e non creano uno stato dedicato per le note con link non
  risolti; la segnalazione è l'aperto D/B.
- **Template**: props dichiarate come oggi, più il check di sottoinsieme sui
  link `ct-interfaces`. Il valore della chiave non partecipa al confronto delle
  props.
- **Link non risolti**: non c'è uno scanner dedicato in questa fase; la policy
  di segnalazione è l'aperto D/B.

### Settings

- Toggle "Enable interfaces", default `off`.
- Descrizione: riserva `ct-interfaces`; la prop contiene una lista di link a
  note; le props mancanti vengono aggiunte con Update o su note nuove; nessuna
  scrittura automatica; i link non risolti non contribuiscono al riferimento e
  la loro segnalazione è un aperto; le note senza template non sono supportate
  in questa fase.
- Il toggle deve aggiornare i pannelli aperti, come le altre setting.

### Casi limite

- Interfaccia cancellata o rinominata: il link non è più risolto finché non
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
- Nessuna interfaccia per note senza template in questa fase (vedi D2).
- Nessuna scrittura automatica al salvataggio.
- Nessuna cartella o grammatica sul nome file: le interfacce sono link.
- Nessuna ereditarietà implicita tra template: vale la regola esistente delle
  props dichiarate, con il check di sottoinsieme per `ct-interfaces`.

### Impatto sul codice

- `src/conts.ts`: costante `INTERFACES_PROP = "ct-interfaces"`.
- `src/settings.ts`: `enableInterfaces`, normalizzazione, toggle e descrizione
  nella tab dichiarativa delle impostazioni.
- Nuovo `src/core/interfaceProps.ts` (puro): parsing dei linkpath, filtro della
  chiave riservata, append/merge, preservazione della chiave, check di
  sottoinsieme, conformità del riferimento. Da aggiungere a
  `tsconfig.test.json` e coprire con test.
- `src/core/templateAPI.ts`: risoluzione dei link, riferimento effettivo,
  `reconformFile`, auto-apply.
- `src/core/conformance.ts`: eventuale helper puro per il sottoinsieme; il merge
  resta in `interfaceProps.ts`.
- `src/features/metadataPanel.ts`: riferimento effettivo, tooltip, refresh sulle
  interfacce; nessuno stato `invalid`.
- `src/features/dashboard/`: filtro e riferimento effettivo, innestato sulla
  seam `referenceFor(node)` lasciata da B; nessuno scanner per i link non
  risolti in questa fase.
- `styles.css`: nessuno stato `invalid`; l'eventuale warning per i link non
  risolti dipende dall'aperto D/B.
- `README.md`, `PROJECT.md`, `YOUDO.md`: documentazione e check manuali.

### Criteri di completamento

- `npm run build`, `npm run lint`, `npm test` verdi.
- Setting `off` invariato rispetto a oggi; setting `on` verificato su note e
  template.
- Update/Align/Reset verificati per nota con template, template con parent e
  link non risolto; nessun link blocca le azioni.
- Auto-apply verificato per nuova nota e nuovo template.
- Tooltip, link non risolti, refresh su cambio interfaccia e mobile verificati in
  `YOUDO.md`.
- README e PROJECT.md aggiornati; voce spostata in `PROJECT.md` e rimossa da
  `FEATURES.md`.

### Aperti

- Politica dei link `ct-interfaces` non risolti: skip silenzioso o warning non
  bloccante; da decidere all'implementazione. Nessuno stato `invalid`.
- `ct-interfaces` è un'eccezione value-level alla regola `ok` di B (stesso
  insieme di chiavi), o la regola vale solo per le note? Da decidere con B.
- Universo di B: le note senza template restano fuori dalla foresta; panel-only
  o emendamento a B. Vedi (D2).

Restano fuori scope la ricorsione, il picker e le note senza template (vedi D2).

## (D2) Interfaces without a template (sequel di D)

Stato: idea — comportamento proposto, ma universo e comunicazione UI sono
ancora da decidere; fuori piano finché D non è validata.

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
- dashboard dedicata o estensione del tab `Issues`; l'universo resta un aperto
  (panel-only o emendamento a B).

Aperti:
- comunicazione UI dello stato parziale;
- interazione con auto-apply e note create fuori da un template;
- se il caso valga la complessità o se richiedere sempre un template sia
  sufficiente.
