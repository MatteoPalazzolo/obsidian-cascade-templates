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
- `reconformFile(file, mode)` è l'unico entry point; ritorna `true` solo se ha scritto.
- **Colori a 3 livelli**: attivo / no-op attenuato / disabled.
  - Una fase è no-op se `areMapsEqual(current, computeReconformProps(template, current, mode))`.
  - La fase Reset è no-op solo se il frontmatter coincide coi default, **non** se `status === 'ok'`.
- **Fine corsa** (dopo Reset) e **nessun template** → disabilitato duro.
- Larghezza fissa del **solo** reconform (`min-width` in `ch`): l'etichetta non fa saltare il layout.

## 5. History / Back

- Stack **per-view**: ogni pressione viva del reconform pusha uno snapshot **incondizionato** = frontmatter + fase **pre-press**.
- Back poppa l'ultimo snapshot, ripristina frontmatter e fase; se le props coincidono con quelle su disco **salta la scrittura** ma muove comunque il cursore.
- Back è abilitato solo se lo stack non è vuoto.

## 6. Sessione

Cursore + stack Back = **una sessione** del pulsante. Si chiude (cursore → fase base, stack svuotato) quando:

- il frontmatter cambia **fuori dal pulsante** (edit manuale, sync, altri plugin, altro pannello);
- la view mostra un **file diverso**;
- la view viene **chiusa**;
- Back **svuota** lo stack.

Dettagli:

- Le scritture del pulsante **non** chiudono la sessione: ogni azione fa prima un refresh `fresh` che adotta le nuove props come **baseline**; il confronto con la baseline avviene solo su un reale cambio di contenuto (`metadataCache` `"changed"`).
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
- Cascate solo su azione esplicita o feature dello scanner.
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

## 12. Scanner (E)

- In 1.0.0 lo scanner non è esposto: nessun ribbon e nessuna sezione nelle impostazioni. I moduli restano in `src/scanner/` e non entrano nel bundle finché `main.ts` non li importa.
- Una sola Modal (`TemplateScannerModal`) con due scanner: note vs template e template vs parent.
- Solo `metadataCache`: nessun `vault.read` per file.
- Scope dalle settings: `scannerExcludeFolders` (match per prefisso, case-insensitive) e `scannerTargets` (note / template).
- Template vs parent segnala solo le proprietà mancanti; le proprietà extra sono attese (un template annidato specializza il parent).
- Lo scanner legge e apre file, non modifica nulla. Autofix non ancora disponibile.

## 13. Vincoli di design

- Toolbar **per-view**, non legata alla nota attiva globale.
- Command palette: solo le due azioni esplicite di C (creazione del template
  nella cartella corrente, navigazione al parent template); nessun comando che
  modifichi la nota attiva.
- Scanner come **Modal**, mai View persistente.
- UI e stringhe sorgente in inglese; i documenti interni in italiano.
- Nessun reconform automatico a cascata.
- Template e note condividono il motore ma mantengono regole e icone distinte.

## 14. Stato e aperti

- Stato funzionale: cascata, pannello, auto-apply, settings dichiarative (Obsidian 1.13+), bridge Templater opt-in per dispositivo e creazione del template di cartella da menu/palette (C); scanner implementato ma non esposto. Ultima release: **1.0.2**.
- Aperti:
  - **E2** autofix dello scanner e "fix all" riusando `reconformFile`, spingendo in history come la UI.
  - Riattivazione dello scanner: reimportare `TemplateScannerModal` in `main.ts` e ripristinare i settings.
  - **F3** release e versioning (`npm version`, tag senza prefisso `v`).
  - C (polish): `Open template` nel menu della cartella e, da palette, apertura del template esistente al posto della sola Notice.
  - Verifica live del pannello su casi limite (focus su search/explorer, split multipli): check tracciato in `YOUDO.md`.
- Test: core puro coperto da `npm test` (`setOperations`, `mapOperations`, `conformance`, 15 test); history coperta dallo smoke test, non è pura (WeakMap su `MarkdownView` + I/O).

## 15. Riferimenti al codice

- `main.ts` — entry del plugin (`onload` / `onunload`); qui si collegano settings → core → UI.
- `src/settings.ts` — modello impostazioni, persistenza, tab dichiarativa (`getSettingDefinitions()`, override di `getControlValue()` / `setControlValue()`) e probe Templater; espone `getTemplateFilename()` / `isTemplateFile()`.
- `src/core/templaterConsent.ts` — consenso Templater per dispositivo/vault e marker della Notice una-tantum; nessuna cache, `stored === true`, errori di storage = spento.
- `src/core/templateAPI.ts` — risoluzione del template (file e cartella), lettura/scrittura frontmatter, `reconformFile`, `computeReconformProps`, `computeTemplateConformance`, auto-apply. Contesto del plugin a livello di modulo: `init(this)` in `onload`, poi `getCtx().app` dentro queste funzioni, mai `this.app`.
- `src/core/mapOperations.ts` — merge, conformità, `areMapsEqual`.
- `src/core/setOperations.ts` — helper Set puri (sostituzione mobile-safe dei metodi TC39).
- `src/core/reconformHistory.ts` — stack Back per `MarkdownView` (snapshot prima di ogni azione).
- `src/core/templaterBridge.ts` — ponte Templater (props e body); disponibilità e versione per lo stato nelle impostazioni; `hasScriptSyntax` per l'avviso sui blocchi `<%* %>`; `holdTemplaterPendingTemplate` per la guardia sul `vault.create` dei template.
- `src/features/TemplaterConsentModal.ts` — modal di consenso nativo (`ConfirmationModal`) con checkbox bloccante e `Enable` disabilitato.
- `src/features/metadataPanel.ts` — UI, stati del cursore, sessione, visibilità.
- `src/features/folderTemplateMenu.ts` — voce del menu cartella e runner condiviso di creazione: placeholder `edit:` per i root, seed `add-missing`, guardia Templater.
- `src/features/templateCommands.ts` — i due comandi palette (`create-folder-template`, `navigate-to-current-template`) con `checkCallback`.
- `src/scanner/` — `TemplateScannerModal`, `ScannerABC`, `CoherenceScanner`, `TemplateCoherenceScanner`; cache-only, non importato in 1.0.0.
- `src/conts.ts` — soli default statici (`DEFAULT_TEMPLATE_BASENAME = "!Template"`).
