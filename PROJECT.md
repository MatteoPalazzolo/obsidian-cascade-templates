# PROJECT.md

Riferimento del progetto Cascade Templates: dominio, comportamento visibile, vincoli e stato.

Documenti complementari:
- `AGENTS.md` — comportamento operativo: comandi, gotcha, convenzioni e linee guida.
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

## 7. Templater (opzionale)

- Ponte **opt-in**, solo note; i `!Template.md` conservano sempre le espressioni raw.
- Se attivo, i valori con sintassi `<%` sono valutati in scrittura; altrimenti il reconform avvisa nel tooltip.
- Nelle impostazioni la riga **Templater bridge test** parte con `---`. Il pulsante Test valuta una piccola espressione sulla nota attiva e sostituisce `---` con stato e versione (es. `Templater detected v2.18.1 - bridge established`, oppure `bridge failed` / `not detected`).
- Se in Templater è attivo `trigger_on_file_creation`, Templater valuta le espressioni `<% %>` anche nei file `!Template.md`: i template non restano grezzi. È un comportamento esterno al plugin; disattivare quel trigger per conservare le espressioni.

## 8. Non invasività

- Nessuna automazione a cascata; ogni azione è **circoscritta alla nota**.
- Cascate solo su azione esplicita o feature dello scanner.
- Il pannello non scrive mai senza un click dell'utente; l'auto-apply tocca solo file appena creati con body vuoto.

## 9. Compatibilità

- **Baseline: Obsidian 1.5.0** (`minAppVersion`). Il pannello si aggancia alla DOM Properties (introdotta in 1.4); 1.5 è scelta per UI più assestata, Lucide più recente e meno superficie di QA.
- I tipi del pacchetto dev `obsidian` sono **pinnati alla linea 1.5**: il compilatore impedisce di usare API più nuove di quelle dichiarate.
- Le icone **Lucide** sono un asset runtime legato alla versione di Obsidian: rendono tutte tramite `setIconSafe` / `resolvableIcon` (fallback), così non dettano la soglia.

## 10. Auto-apply (D1)

- Tre modalità: `off`, `properties`, `full` (default).
- Trigger indipendente dalla lingua e dalla view: `create` di un `.md` con body vuoto dopo 200 ms, solo a `workspace.layoutReady`; niente nome `Untitled`, niente `file-open` (funziona anche con le righe create/editate dentro una Base). I 200 ms evitano la corsa con il trigger di creazione di Templater, che scrive a 300 ms.
- Il body è ricontrollato atomicamente dentro `vault.process`: se l'utente ha scritto nel frattempo, l'azione si annulla.
- Il frontmatter è sempre unito con `add-missing`: i valori esistenti vincono, anche su file creati da una Base.
- `full` copia anche il body del template. Sui template annidati l'ereditarietà è totale (props + body), ma le espressioni `<% %>` restano raw.
- Templater: solo note e solo col toggle attivo; template mai. Se `trigger_on_file_creation` di Templater è attivo, Templater valuta le espressioni anche nei `!Template.md`: è un comportamento esterno al plugin, vedi §7.
- Sync/import: le note che arrivano con contenuto sono scartate; un singolo file vuoto può ricevere le props (merge non distruttivo).

## 11. Scanner (E)

- In 1.0.0 lo scanner non è esposto: nessun ribbon e nessuna sezione nelle impostazioni. I moduli restano in `src/scanner/` e non entrano nel bundle finché `main.ts` non li importa.
- Una sola Modal (`TemplateScannerModal`) con due scanner: note vs template e template vs parent.
- Solo `metadataCache`: nessun `vault.read` per file.
- Scope dalle settings: `scannerExcludeFolders` (match per prefisso, case-insensitive) e `scannerTargets` (note / template).
- Template vs parent segnala solo le proprietà mancanti; le proprietà extra sono attese (un template annidato specializza il parent).
- Lo scanner legge e apre file, non modifica nulla. Autofix non ancora disponibile.

## 12. Vincoli di design

- Toolbar **per-view**, non legata alla nota attiva globale.
- Nessun comando in command palette per ora.
- Scanner come **Modal**, mai View persistente.
- UI e stringhe sorgente in inglese; i documenti interni in italiano.
- Nessun reconform automatico a cascata.
- Template e note condividono il motore ma mantengono regole e icone distinte.

## 13. Stato e aperti

- Versione **1.0.0**: cascata, pannello, auto-apply, settings e Templater pronti; scanner implementato ma non esposto.
- Aperti:
  - **E2** autofix dello scanner e "fix all" riusando `reconformFile`, spingendo in history come la UI.
  - Riattivazione dello scanner: reimportare `TemplateScannerModal` in `main.ts` e ripristinare i settings.
  - **F3** release e versioning (`npm version`, tag senza prefisso `v`).
  - Verifica live del pannello su casi limite: focus su search/explorer, split multipli.
- Test: core puro coperto da `npm test` (`setOperations`, `mapOperations`, `conformance`, 15 test); history coperta dallo smoke test, non è pura (WeakMap su `MarkdownView` + I/O).

## 14. Riferimenti al codice

- `main.ts` — entry del plugin (`onload` / `onunload`); qui si collegano settings → core → UI.
- `src/settings.ts` — modello impostazioni, persistenza, `PluginSettingTab`; espone `getTemplateFilename()` / `isTemplateFile()`.
- `src/core/templateAPI.ts` — risoluzione del template, lettura/scrittura frontmatter, `reconformFile`, `computeReconformProps`, `computeTemplateConformance`, auto-apply. Contesto del plugin a livello di modulo: `init(this)` in `onload`, poi `getCtx().app` dentro queste funzioni, mai `this.app`.
- `src/core/mapOperations.ts` — merge, conformità, `areMapsEqual`.
- `src/core/setOperations.ts` — helper Set puri (sostituzione mobile-safe dei metodi TC39).
- `src/core/reconformHistory.ts` — stack Back per `MarkdownView` (snapshot prima di ogni azione).
- `src/core/templaterBridge.ts` — ponte Templater (props e body); disponibilità e versione per lo stato nelle impostazioni.
- `src/features/metadataPanel.ts` — UI, stati del cursore, sessione, visibilità.
- `src/scanner/` — `TemplateScannerModal`, `ScannerABC`, `CoherenceScanner`, `TemplateCoherenceScanner`; cache-only, non importato in 1.0.0.
- `src/conts.ts` — soli default statici (`DEFAULT_TEMPLATE_BASENAME = "!Template"`).
