# PROJECT.md

Riferimento del progetto Cascade Templates: dominio, comportamento visibile, vincoli e stato.

Documenti complementari:
- `AGENTS.md` — comportamento operativo: comandi, gotcha, convenzioni e linee guida.
- `YOUDO.md` — verifiche manuali richieste all'utente; le voci restano finché non sono state eseguite.
- `README.md` — documentazione per l'utente finale.

---

## 1. Dominio della cascata

- Ogni file eredita le proprietà del `!Template.md` **antenato più vicino** risalendo la cartella; un template annidato sovrascrive quello sopra.
- Ogni template risolve a sua volta il proprio template di riferimento tra gli antenati e lo estende: l'ereditarietà è ricorsiva e senza limite di profondità.
- Un template annidato *dovrebbe* includere le proprietà del parent. Se ne manca alcune è un errore da segnalare, non un merge automatico dell'intera catena.
- L'ordine delle chiavi del frontmatter è preservato.
- `position`, iniettata da Obsidian nella cache, non è mai confrontata né scritta.

## 2. Conformità

- **Nota vs template**: `ok` / `extra` / `missing`, in base alla presenza delle chiavi.
- **Template vs template genitore**: valido se include tutte le prop del parent; `extra` = prop proprie.
- **Nessun template**: stato neutro e pulsante reconform disabilitato.
- L'indicatore di stato è sempre **derivato** dalla conformità ed è indipendente dal cursore del pulsante.
- Nota e template usano lo stesso motore ma criteri e icone distinti: ogni differenza di comportamento va resa esplicita, non come eccezione sparsa.

## 3. Pannello Properties

- Toolbar **per-view** (`WeakMap<MarkdownView, PanelUI>`): compare in ogni nota visibile, anche con split pane, non solo nella nota attiva.
- Layout della riga: `[indicatore di stato] [Add property nativo] [reconform] [Back]`.
  `Add property` è il pulsante nativo di Obsidian e non va replicato.
- **Indicatore di stato**: icona derivata dalla conformità (nota: `circle-*`; template: `file-check` / `file-x` rispetto al parent; senza template: `circle-dashed`).
- **Tooltip dell'indicatore**: stato corrente + percorso del template di riferimento.
- **Navigazione dal badge**:
  - click → rivela il template nel file explorer;
  - Ctrl/Cmd + click → apre il template nella tab corrente;
  - Ctrl/Cmd + Alt + click → apre il template in una nuova tab;
  - su mobile il tap rivela soltanto.
- **Visibilità**: `panelVisibility` vale `always` (default) o `onlyWithTemplate`; il secondo nasconde status e pulsanti quando non c'è un template.
- Ogni azione vale solo per la nota su cui viene eseguita: nessun effetto sulle altre.

## 4. Pulsante reconform (cursore a fasi)

- Tre fasi, in ordine: `add-missing` (**Update**) → `remove-extra` (**Align**) → `reset-defaults` (**Reset**).
  - **Update**: aggiunge le proprietà mancanti con i default del template, preserva i valori esistenti e le prop extra, riporta l'ordine a quello del template.
  - **Align**: rimuove le prop non presenti nel template, preserva i valori condivisi.
  - **Reset**: riporta il frontmatter esattamente ai default del template.
- Stato UI **per-view** (`phase` 0..3): parte sempre dalla fase base; ogni click vivo avanza di una fase **anche se il contenuto non cambia**; dopo Reset il cursore si blocca e i click successivi sono inerti.
- `reconformFile(file, mode)` è l'unico entry point; ritorna `{before, changes, changed}` (`changed` è il vecchio booleano) e le scritture sono serializzate per path.
- **Colori a 3 livelli**: attivo / no-op attenuato / disabled.
  - Una fase è no-op se `areMapsEqual(current, computeReconformProps(template, current, mode))`.
  - La fase Reset è no-op solo se il frontmatter coincide coi default, **non** se `status === 'ok'`.
- **Fine corsa** (dopo Reset) e **nessun template** → disabilitato duro.
- Larghezza fissa del **solo** reconform (`min-width` in `ch`): l'etichetta non fa saltare il layout.

## 5. History / Back

- Stack **per nota** (chiave = path, non `MarkdownView`): due tab sulla stessa nota condividono stack, cursore e stato del pulsante; note diverse hanno sessioni indipendenti.
- Ogni pressione viva del reconform pusha uno snapshot **incondizionato** = frontmatter + fase **pre-press**.
- Back poppa l'ultimo snapshot, ripristina frontmatter e fase; se le props coincidono con quelle su disco **salta la scrittura** ma muove comunque il cursore.
- Back è abilitato solo se lo stack non è vuoto.
- Il Back resta **locale alla nota** e volatile: non consuma il journal della dashboard, non compare nella sua History e non è toccato da eviction o rewind.

## 6. Sessione

Cursore + stack Back = **una sessione** del pulsante, condivisa dalle tab che mostrano la stessa nota. Si chiude (cursore → fase base, stack svuotato) quando:

- il frontmatter cambia **fuori dal pulsante** (edit manuale, sync, altri plugin, **dashboard inclusa**);
- **nessuna tab** mostra più la nota;
- Back **svuota** lo stack.

Dettagli:

- Le scritture del pulsante **non** chiudono la sessione: ogni azione fa prima un refresh `fresh` che adotta le nuove props come **baseline**; il confronto con la baseline avviene solo su un reale cambio di contenuto (`metadataCache` `"changed"`).
- Le scritture della dashboard sono scritture esterne per il pannello e chiudono la sessione della nota.
- Il **body** della nota non conta: chiude solo un cambio di frontmatter.
- Chiudere **non è un revert**: la history è scartata, lo stato corrente resta.
- L'edit manuale è interpretato come **hand-off**: l'utente prende il controllo, la sessione guidata termina e il pulsante riparte da Update.

## 7. Templater (opzionale, opt-in)

- Ponte **opt-in e spento di default**, solo note; i `!Template.md` conservano sempre le espressioni raw.
- Il consenso è **per dispositivo e per vault**: vive in `app.loadLocalStorage` / `saveLocalStorage` (chiave `cascade-templates:evaluate-templater-in-notes`), non in `data.json`, e quindi non viene sincronizzato. Ogni dispositivo deve attivarlo separatamente. La lettura non è in cache e valida il valore (`stored === true`); qualsiasi errore di storage equivale a spento.
- Attivazione: il toggle apre un modal nativo con l'avviso di rischio e la checkbox `I understand the risks`; `Enable` resta disabilitato finché la checkbox non è spuntata. Conferma → flag scritto e toggle ON. Annulla / Esc / X → nessuna scrittura e toggle di nuovo OFF.
- Primo avvio dopo l'aggiornamento: una Notice non modale per dispositivo/vault (marker `cascade-templates:templater-notice-shown`), perché il vecchio default era ON e il cambio non deve passare in silenzio.
- Capability probe all'apertura della tab: `<% 1 + 1 %>` via `create_running_config` + `parse_template`. Target: nota attiva, altrimenti primo `.md` del vault, altrimenti stato esplicito `Create a note first to verify the bridge`. Stati della riga: `Checking…`, `bridge verified`, `bridge verification failed`, `Templater not detected — option unavailable`. Il probe gira una volta per sessione, è invalidato dal cambio di versione di Templater e `Test again` lo ripete. Il toggle è abilitato solo a probe riuscito.
- Se il flag è ON ma Templater non è più disponibile, il runtime degrada al valore raw senza scrivere nulla di rotto.
- Con il ponte attivo i valori con sintassi `<%` sono valutati in scrittura; altrimenti il valore è copiato raw. Il tooltip del reconform ha tre stati: ponte spento → invito ad attivarlo; consenso ON ma Templater assente → `expressions are written verbatim`; `<%* … %>` nel template → avviso che esegue codice.
- La riga **Templater bridge test** mostra lo stato del probe e ospita `Test again`; non è una setting e non viene persistita.
- Se in Templater è attivo `trigger_on_file_creation`, Templater valuta le espressioni `<% %>` anche nei file `!Template.md`: i template non restano grezzi. È un comportamento esterno al plugin; disattivare quel trigger per conservare le espressioni.

## 8. Non invasività

- Nessuna automazione a cascata; ogni azione è **circoscritta alla nota**.
- Cascate solo su azione esplicita (dashboard inclusa, dietro setting opt-in).
- Il pannello non scrive mai senza un click dell'utente; l'auto-apply tocca solo file appena creati con body vuoto.

## 9. Compatibilità

- **Baseline: Obsidian 1.13.0** (`minAppVersion`). La 1.13 porta l'API dichiarativa delle impostazioni, i contenitori nativi dei modal (X di chiusura compresa) e il ridisegno della settings tab; sotto quella soglia si sarebbero dovute reimplementare a mano strutture che l'app ora fornisce.
- **Settings UI dichiarativa**: la tab usa `getSettingDefinitions()` come unica implementazione, senza `display()` né `new Setting(containerEl)`. `getControlValue()` / `setControlValue()` sono sovrascritti per leggere e scrivere lo store module-level; il bridge test resta l'unico `render`. Ogni riga con un nome stabile entra nella ricerca globale delle impostazioni.
- **Taglio dichiarato**: chi è su 1.11/1.12 smette di ricevere aggiornamenti. Va detto nel README (sezione Compatibility) e nella release; un solo salto 1.5 → 1.13, senza scala di fallback né supporto duale.
- I tipi del pacchetto dev `obsidian` sono **pinnati alla linea 1.13** (`~1.13.0`): il compilatore impedisce di usare API più nuove di quelle dichiarate.
- Le icone **Lucide** sono un asset runtime legato alla versione di Obsidian: rendono tutte tramite `setIconSafe` / `resolvableIcon` (fallback), così non dettano la soglia.

## 10. Auto-apply (D1)

- Tre modalità: `off`, `properties`, `full` (default).
- Trigger indipendente dalla lingua e dalla view: `create` di un `.md` con body vuoto dopo 200 ms, solo a `workspace.layoutReady`; niente nome `Untitled`, niente `file-open` (funziona anche con le righe create/editate dentro una Base). I 200 ms evitano la corsa con il trigger di creazione di Templater, che scrive a 300 ms.
- Il body è ricontrollato atomicamente dentro `vault.process`: se l'utente ha scritto nel frattempo, l'azione si annulla.
- Il frontmatter è sempre unito con `add-missing`: i valori esistenti vincono, anche su file creati da una Base.
- `full` copia anche il body del template. Sui template annidati l'ereditarietà è totale (props + body), ma le espressioni `<% %>` restano raw.
- Templater: solo note e solo col toggle attivo; template mai. Se `trigger_on_file_creation` di Templater è attivo, Templater valuta le espressioni anche nei `!Template.md`: è un comportamento esterno al plugin, vedi §7.
- Sync/import: le note che arrivano con contenuto sono scartate; un singolo file vuoto può ricevere le props (merge non distruttivo).

## 11. Creazione del template di cartella (C)

- Due entry point per la stessa azione: menu contestuale di una `TFolder`
  (right-click su desktop, long-press su mobile) e command palette. Il menu è
  l'entry point primario perché può colpire qualunque cartella; la palette
  lavora solo sulla cartella della nota attiva, perché il file explorer non
  espone una selezione pubblica.
- Menu, solo cartelle: `New root cascade template` se non esiste un template
  antenato, `New child cascade template` se esiste (erediterà le proprietà);
  con un template locale la voce è disabilitata `Cascade template already in
  folder` (icona `file`, non `file-check`). «Root» è l'inizio della cascata,
  non la root del vault.
- Palette: `Create cascade template in current folder` sulla cartella della
  nota attiva; senza nota attiva è disabilitato via `checkCallback`. Se il
  template esiste, il comando resta eseguibile e mostra una Notice con il path
  in tono d'errore (`--text-error`), perché un comando disabilitato non
  spiegherebbe il motivo.
- Palette: `Navigate to parent template` apre in una nuova tab il template di
  riferimento della nota attiva (per un template, il parent), con la stessa
  risoluzione del pannello (`getTemplateOfFile`); disabilitato senza nota
  attiva o senza template.
- Il file viene creato e aperto in una nuova tab, con il path normalizzato
  anche per la root del vault. Le proprietà del parent più vicino sono seminate
  subito con `reconformFile(..., "add-missing")` anche con auto-apply `off`: è
  un'azione esplicita, non una cascata. Il body segue auto-apply
  (`off`/`properties` → vuoto, `full` → body del parent); le espressioni
  `<% %>` restano raw.
- Un template root nasce con il placeholder `edit:` in frontmatter: con un
  frontmatter vuoto Obsidian non materializza la GUI delle proprietà, e
  «sporcare» il frontmatter è l'unico modo per ottenerla. `edit` è una
  proprietà reale e segue la cascata come tutte le altre; un child non riceve
  il placeholder perché eredita dal parent.
- Templater: prima di `vault.create` il path è registrato in
  `files_with_pending_templates` e rilasciato in `finally`; il passaggio a
  ~300 ms salta il file, che resta raw. Se il campo non esiste, l'azione
  funziona comunque (al massimo logga in debug).
- Il seed legge il parent diretto, non fonde la catena: un parent non conforme
  resta un errore da segnalare.

## 12. Cascade dashboard (B)

- La dashboard è l'unica superficie che agisce sull'intero vault. Si apre dalla
  ribbon (`git-fork`) e dal comando `Open cascade dashboard`. Non aggiunge
  controlli alla UI della nota: il pannello Properties resta invariato.
- `Cascade` è una mappa **sola lettura** derivata dalle cartelle: per ogni local
  root mostra le sottocartelle e le note raggruppate (`N notes`). La riga cartella
  porta due badge distinti: quello del **template** (conformità del template
  rispetto al parent, non cumulativo, sempre visibile) e quello **batch** (errori
  nelle note o nei template discendenti, cumulativo, mostrato solo a cartella
  chiusa e solo quando c'è davvero un errore). I conteggi `T` / `Nm` / `Ne`
  restano solo in `Issues`, perché sono un'analisi di conformità e non un fatto
  strutturale della mappa. La riga cartella **è** la riga del suo template e non
  esiste una riga separata per il template. I tooltip passano da `setTooltip`
  (uno solo, gestito da Obsidian: niente `title` nativo in aggiunta). Il click
  semplice sul nome espande/collassa;
  `Ctrl`/`Cmd`+click apre il template; il menu `⋯` della riga offre sempre
  `Open template` (visibile all'hover su desktop, sempre su mobile e raggiungibile
  con `Enter` da tastiera), così il template si apre anche solo col mouse senza
  rischiare click accidentali. Un template annidato vive dentro la cascata del
  suo antenato; solo un template senza template antenati è una local root. Le
  note fuori da ogni cascata sono contate a parte, quelle senza frontmatter
  restano righe attenuate senza badge.
- **Solo le cartelle con un template sono nodi**: una cartella senza template
  (anche una catena di cartelle senza template) non compare nell'albero, le sue
  note risalgono alla cartella-template più vicina. L'etichetta di una cartella
  è quindi il percorso relativo al parent visibile (`deep` se è figlia diretta,
  `skip/deep` quando in mezzo sono state appiattite delle cartelle), con il
  percorso completo nel tooltip. Anche le **note** usano lo stesso criterio:
  l'etichetta è il percorso relativo alla cartella-template che le contiene
  (`note.md` se sono dirette, `alpha/note.md` se arrivano da una sottocartella
  appiattita), così due `index.md` di rami diversi restano distinguibili; il
  tooltip conserva il percorso completo.
- Il gruppo `N notes` è solo una compattazione e vive **solo nella mappa**:
  compare solo nelle cartelle che mostrano anche sottocartelle-template e solo
  **oltre 3 note** (`> 3`, costante `NOTES_GROUP_THRESHOLD` in
  `CascadeDashboardModal.ts`). Con 1–3 note, e in ogni cartella leaf, le note
  sono righe dirette sotto la cartella: chiuderla basta a nasconderle. Quando il
  gruppo viene espanso la sua riga sparisce e restano le note, con la stessa
  indentazione; per ricompattare si chiude la cartella, e la chiusura ripristina
  tutti i gruppi `N notes` discendenti senza chiudere le sottocartelle annidate.
- **Issues non compatta**: è un'analisi locale di ciò che non va, non una vista
  d'insieme, quindi le note con problemi sono sempre righe dirette sotto la loro
  cartella, senza gruppo `N notes`. Chiudere una cartella lì è solo un gesto
  visivo: non resetta alcun gruppo e non chiude le cartelle annidate.
- **Regola `ok`**: `ok` significa *stesso insieme di chiavi*, non stessi valori
  (`computeMapConformance`). Un template è `missing` solo se gli mancano chiavi
  del parent; le sue chiavi extra sono specializzazione attesa.
- **Setting opt-in sperimentale** `Enable Issues and History tabs
  (experimental)` (`dashboardTabs`, default `false`):
  - spenta (default): niente tab e niente azioni di scrittura, solo la mappa;
  - accesa: mostra `Cascade | Issues (N) | History (M)`, i verbi e `Fix all`.
  La descrizione avvisa che la History è un journal **in memoria di sessione**,
  non un backup: va tenuta una copia del vault altrove.
- `Issues (N)` è un **unico albero** con i soli rami che portano a un problema:
  template da aggiornare, note con chiavi mancanti e note con chiavi extra
  convivono nello stesso contesto, senza ripetere tre volte gli stessi antenati.
  Il template non ha una riga propria: la cartella che lo contiene appare anche
  quando l'unico problema è il template, e il suo verbo `Update templates` lo
  copre. Ogni riga cartella porta i tre verbi bulk sul proprio sottoalbero
  (`Update templates`, `Update notes`, `Align notes`), con il menu `⋯` su mobile; le righe file
  portano il verbo singolo. `N` è lo stesso numero di `Fix all (N)`.
- Verbi: `Update template(s)` e `Update note(s)` sempre disponibili; `Align
  note(s)` è distruttivo e sbloccato solo se l'intera catena delle note
  coinvolte è sound. `Align` non tocca mai i valori esistenti, rimuove solo le
  chiavi.
- `Fix all` è una macro confermata una volta: `Update templates` → `Update
  notes` → `Align notes`. Non è atomica: si ferma al primo errore e lascia una
  entry di journal per ogni fase che ha scritto.
- **Journal** (`History`): vive nel plugin, non nel modal, quindi chiudere e
  riaprire la dashboard conserva la history. Scope = sessione, muore con
  `onunload`. Modello a target state: per file conserva il frontmatter completo
  (`before`) e le chiavi toccate (`changes`, con `REMOVED` esplicito). Undo
  ripristina solo quelle chiavi, dal valore che avevano all'inizio del range.
- Eviction FIFO dalla testa, budget 8 MB su mobile e 32 MB su desktop, unità di
  budget = operazione (`Fix all` è una sola unità). Una troncatura è visibile in
  cima alla History; un'operazione oltre il budget parte solo su conferma e non
  viene registrata.
- Le scritture della dashboard sono scritture esterne per il pannello: chiudono
  la sessione Back della nota, che resta invece locale alla nota e indipendente
  dal journal. Nessuna pressione del pannello compare nella History.
- Mobilità e tastiera: l'intera card di una cartella è il bersaglio di
  espansione (la freccina è solo indicatore di stato, non un bottone separato);
  le azioni interne fermano la propagazione e non collassano la riga. Le azioni
  delle righe hanno il menu `⋯` come fallback, l'albero usa il pattern ARIA con
  roving tabindex, `Enter` apre il menu e `Esc` chiude il modal (bloccato durante
  batch e rewind). L'indicizzazione mostra `Waiting for indexing…` solo quando
  serve, con timeout di sicurezza.


## 13. Vincoli di design

- Toolbar **per-view**, non legata alla nota attiva globale.
- Command palette: le due azioni esplicite di C (creazione del template nella
  cartella corrente, navigazione al parent template) e l'apertura della
  dashboard; nessun comando che modifichi la nota attiva.
- Dashboard come **Modal**, mai View persistente; il journal vive nel plugin,
  non nel modal.
- UI e stringhe sorgente in inglese; i documenti interni in italiano.
- Nessun reconform automatico a cascata.
- Template e note condividono il motore ma mantengono regole e icone distinte.

## 14. Stato e aperti

- Stato funzionale: cascata, pannello, auto-apply, settings dichiarative (Obsidian 1.13+), bridge Templater opt-in per dispositivo, creazione del template di cartella da menu/palette (C) e cascade dashboard (B) con mappa, Issues e History dietro setting sperimentale. Ultima release: **1.1.0**.
- Aperti:
  - Nome definitivo del modal, del comando e dell'icona ribbon (oggi `Cascade dashboard`, `Open cascade dashboard`, `git-fork`).
  - Persistenza del journal tra reload: sarebbe una feature separata, perché ogni entry andrebbe riverificata chiave per chiave.
  - Cancel di un batch lungo (`Stop after current file`): oggi `Esc` e la chiusura sono bloccati durante l'operazione.
  - Taratura del budget reale su vault grandi; oggi 8 MB mobile / 32 MB desktop.
  - **F3** release e versioning (`npm version`, tag senza prefisso `v`).
  - C (polish): `Open template` nel menu della cartella e, da palette, apertura del template esistente al posto della sola Notice.
  - Verifica live del pannello su casi limite (focus su search/explorer, split multipli): check tracciato in `YOUDO.md`.
- Test: core puro coperto da `npm test` (`setOperations`, `mapOperations`, `conformance`, `frontmatterChanges`, `forest`, `journal`, `reconformSession`, 38 test); history del pannello e adapter I/O restano fuori dalla suite pura.

## 15. Riferimenti al codice

- `main.ts` — entry del plugin (`onload` / `onunload`); qui si collegano settings → core → UI.
- `src/settings.ts` — modello impostazioni, persistenza, tab dichiarativa (`getSettingDefinitions()`, override di `getControlValue()` / `setControlValue()`) e probe Templater; espone `getTemplateFilename()` / `isTemplateFile()`.
- `src/core/templaterConsent.ts` — consenso Templater per dispositivo/vault e marker della Notice una-tantum; nessuna cache, `stored === true`, errori di storage = spento.
- `src/core/templateAPI.ts` — risoluzione del template (file e cartella), lettura/scrittura frontmatter, `reconformFile`, `computeReconformProps`, `computeTemplateConformance`, auto-apply. Contesto del plugin a livello di modulo: `init(this)` in `onload`, poi `getCtx().app` dentro queste funzioni, mai `this.app`.
- `src/core/mapOperations.ts` — merge, conformità, `areMapsEqual`.
- `src/core/setOperations.ts` — helper Set puri (sostituzione mobile-safe dei metodi TC39).
- `src/core/frontmatterChanges.ts` — `REMOVED`, diff autorevole delle chiavi toccate e applicazione di un patch.
- `src/core/forest.ts` — derivazione pura della foresta (local root, sotto-cascate, stati, badge, conteggi, catena sound, appiattimento delle cartelle senza template) con `referenceFor(node)` iniettabile per D.
- `src/core/journal.ts` — journal puro: entry a target state, budget/interning/eviction, preflight del rewind, conflitti e file spariti.
- `src/core/reconformSession.ts` — modello puro della sessione per path (stack + cursore condivisi dalle tab della stessa nota).
- `src/core/reconformHistory.ts` — adapter I/O della sessione: stack per nota, sweep delle note visibili, scritture via templateAPI.
- `src/core/templaterBridge.ts` — ponte Templater (props e body); disponibilità e versione per lo stato nelle impostazioni; `hasScriptSyntax` per l'avviso sui blocchi `<%* %>`; `holdTemplaterPendingTemplate` per la guardia sul `vault.create` dei template.
- `src/features/TemplaterConsentModal.ts` — modal di consenso nativo (`ConfirmationModal`) con checkbox bloccante e `Enable` disabilitato.
- `src/features/metadataPanel.ts` — UI, stati del cursore, sessione per nota, visibilità.
- `src/features/folderTemplateMenu.ts` — voce del menu cartella e runner condiviso di creazione: placeholder `edit:` per i root, seed `add-missing`, guardia Templater.
- `src/features/templateCommands.ts` — i due comandi palette (`create-folder-template`, `navigate-to-current-template`) con `checkCallback`.
- `src/features/dashboard/` — `CascadeDashboardModal` (mappa, Issues, History, tastiera, progress), `actions` (batch sequenziale), `vaultForest` (adapter cache → foresta), `journalStore`, `confirm`.
- `src/conts.ts` — soli default statici (`DEFAULT_TEMPLATE_BASENAME = "!Template"`).
