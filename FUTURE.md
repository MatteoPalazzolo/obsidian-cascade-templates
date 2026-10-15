# FUTURE.md

Roadmap delle prossime sessioni di lavoro sul plugin **Cascade Templates**.
Obiettivo: un sistema di templating a cascata funzionale, solido e pubblicabile per la community.

> Contesto: il plugin è già stato ripulito da tutto il non-template.
> Vedi `AGENTS.md` per comandi e architettura.
> Le voci qui sotto sono volutamente **atomiche**: ognuna deve poter compilare e poter essere
> revertita da sola senza rompere le voci precedenti o successive.
> Le rifiniture UX raccolte in `NEXT.md` sono confluite nella **Sessione H** (supersede C3–C5).

---

## Stato attuale (verificato live sull'istanza Obsidian)

Per **ogni** view markdown visibile (split pane), riga del pannello Properties:

```
[indicatore di stato ✅/⚠️/❌] [ + Add property ] [ reconform (a cursore) ] [ undo ]
```

- L'**indicatore di stato** sta a sinistra del pulsante nativo `Add property`.
- Il pulsante **reconform** è dinamico: cambia etichetta/azione avanzando lungo le fasi.
- Il pulsante **undo** è sempre presente a destra, disabilitato quando lo stack è vuoto.
- Tutto è **per-view** (`WeakMap<MarkdownView, PanelUI>`), non legato alla nota attiva.
- Codice: `src/features/metadataPanel.ts` (UI), `src/core/reconformHistory.ts` (memoria).

> Il comportamento a cursore qui sotto è il **target** definito dalla **Sessione H**.
> Il modello precedente (fase derivata da `computeMapConformance`, snapshot solo su modifica reale)
> è superato; vedi C3–C5 nel log "Completato".

---

## Decisioni di design (confermate)

- **Toolbar nel pannello properties**: deve comparire in **ogni nota visibile** (split pane), non solo
  nella nota attiva → serve un'istanza per `MarkdownView` (WeakMap).
- **Layout riga**: `[indicatore di stato] [Add property] [reconform dinamico] [undo]`.
  L'indicatore resta a sinistra del pulsante nativo; i due pulsanti azione a destra.
- **Pulsante reconform a stati, guidato da un cursore per-view** (un solo pulsante che cambia
  azione + etichetta + icona):
  1. **Reconform** — aggiunge le prop presenti nel template e assenti nel file, con i valori di
     default del template; **preserva** i valori esistenti e le prop extra.
     (= `mergeSecondOnFirstMap(template, file, tail=true)`).
  2. **Remove extra** — rimuove le prop non presenti nel template, **preserva** i valori condivisi.
     (= `mergeSecondOnFirstMap(template, file, tail=false)`).
  3. **Reset** — riporta il frontmatter **esattamente** ai default del template (sovrascrive i
     valori condivisi e rimuove gli extra).
  - Il **cursore** è uno stato UI per-view **disaccoppiato** dalla conformità: parte sempre dal
    base e avanza di una fase a ogni click. Sequenza: 1° click esegue *Reconform*, 2° esegue
    *Remove extra*, 3° esegue *Reset*; poi il cursore **si blocca su Reset** (nessun ritorno al
    base) e i click successivi sono **inerti** (nessuno snapshot, nessuna scrittura).
  - L'indicatore di stato resta invece **derivato** da `computeMapConformance` (nota) /
    `isTemplateCoherentToParentTemplate` (template): sono due cose indipendenti.
- **Undo legato alla pressione del pulsante, non alla modifica delle props**: ogni click "vivo" sul
  reconform (*Reconform* / *Remove extra* / *Reset*) registra uno **snapshot** del frontmatter
  pre-press **più la fase pre-press**, anche quando l'azione risulta no-op. L'undo ripristina props
  **e** fase del pulsante; se le props sono identiche salta la scrittura su disco ma muove comunque
  il cursore. Il pulsante undo è **sempre presente**, ma **disabled e grigio** quando lo stack è
  vuoto. Nessun clear irreversibile.
- **Azzeramento del cursore = azzeramento dello stack undo**: gli stessi trigger di B2 (file
  sostituito nella stessa view, chiusura della view, stack svuotato dagli undo). Nessun trigger
  aggiuntivo: non si azzera a ogni refresh esterno.
- **Hard Reconform**: eliminato come pulsante separato, assorbito nella **fase 2** del pulsante.
- **History/Revert**: stack legato alla **`MarkdownView`** (non al file attivo globale). Passando da
  una **scheda** all'altra e tornando indietro la history **resta**. Si azzera solo quando la view
  viene **chiusa** oppure quando un **nuovo file sostituisce** quello corrente nella stessa view
  (es. apertura di un link nello stesso pane).
- **Tooltip**: l'indicatore di stato mostra **stato + path del template di riferimento**; il pulsante
  reconform mostra la **descrizione dello stato corrente** (con contesto "from template" / "from
  parent template"). Il warning Templater (G4) resta sul pulsante reconform.
- **Colori del pulsante (3 livelli)**: 1) normale per l'azione attiva; 2) attenuato, sempre nella
  palette grigia di default, per la fase no-op; 3) disabled classico (nessun template).
- **Larghezza pulsante**: solo il reconform ha larghezza fissa (in `ch`) per non saltare al cambio
  etichetta; l'undo no.
- **Set methods**: sostituire i metodi nativi TC39 (`Set.prototype.intersection`, `isSubsetOf`, ...)
  con helper puri, per compatibilità con WebView mobile datate.
- **Settings**: template filename, auto-apply on/off, scanner scope (+ esclusioni), comportamento
  senza template (hide/disabled).
- **Scanner**: resta una **Modal** (nessuna View persistente).
- **Stringhe sorgente**: standardizzate in **inglese** (nuovi commenti in inglese caratterizzati dal
  prefisso AI per distinguere chi li scrive).
- **Command palette**: nessun nuovo comando per ora.
- **Ordine sessioni**: **core, poi panel, poi settings, poi scanner, poi community**.
- **Semantica di cascata**: confermato "nearest template wins" + disciplina. Ogni template
  *dovrebbe* includere le prop del parent; se ne manca alcune è un errore da segnalare (non un merge
  automatico dell'intera catena).
- **Non invasività**: nessun reconform automatico a cascata; le automazioni in una nota restano
  **circoscritte alla nota stessa**. Eventuali cascate solo su azione esplicita (o feature dello
  scanner).
- **Templater**: mai dipendenza obbligatoria. Ponte opzionale e parziale (solo proprietà del
  frontmatter, solo se la voce è attiva nelle settings), senza doppia valutazione rispetto a
  `trigger_on_file_creation`. **Vale solo per i file nota**: i `!Template.md` conservano sempre le
  espressioni raw (sono la sorgente, non vanno materializzati). Default: comportamento attuale
  (copia fedele). Vedi Sessione G.
- **Template vs nota**: stesso motore, criteri di conformità e icone distinti (nota →
  `computeMapConformance`; template → `isTemplateCoherentToParentTemplate`). Ogni differenza di
  comportamento tra i due tipi va resa esplicita come questa, non come eccezione sparsa.

---

## Rischi tecnici trasversali (aperti)

3. **Performance scanner** — `runAllScanner` fa `vault.read()` per ogni file ma `CoherenceScanner`
   ignora `content` e usa la cache. Rimuovere il read; tutto su `metadataCache`. (Sessione E1).
4. **Settings incomplete** — per la community serve completare la Settings tab: esiste già la
   versione minima (nome template + toggle Templater); restano le voci di D1.
6. **Bug visibilità pannello** — superato dall'istanza per-view della Sessione C; resta da
   verificare live su casi limite (focus su search/explorer, split multipli).

> Chiusi: 1 (Set TC39, A1), 2 (`setFileProps`, A3), 5 (`console.log`, A5).

---

## Convenzione fasi atomiche

- Ogni voce = **1 step revertibile** (idealmente 1 commit).
- Ogni step deve **compilare da solo** (`npx tsc -noEmit -skipLibCheck`) e non dipendere dagli step
  successivi.
- Se uno step viene revertito, quelli prima devono restare validi e il plugin deve continuare a
  caricarsi.

---

## Completato (log)

### Sessione A — Fondamenta core (nessuna UI)

- **A1** `src/core/setOperations.ts` con helper puri (`intersection`, `difference`, `isSubsetOf`),
  usati in `templateAPI`; rimosso `types/set-methods.d.ts`. **(chiude il Rischio 1)**
- **A2** `getFilePropsMapFromCache(file)` in `templateAPI`: Map ordinata, scarta `position`.
- **A3** Hardening `setFileProps`/`getFileProps`: `YAMLMap` esplicito iterando `map.entries()`,
  formattazione frontmatter corretta (`---`, riga vuota, `...`). **(chiude il Rischio 2)**
- **A4** `reconformFile(file, mode)` unico, `mode ∈ { add-missing, remove-extra, reset-defaults }`,
  costruito su `mergeSecondOnFirstMap` + `computeMapConformance`; ritorna `boolean` (se ha
  modificato qualcosa).
- **A5** Cleanup `console.log` in `src/utils/dom.ts`. **(chiude il Rischio 5)**

### Sessione B — History / Undo stack (core)

- Store **per `MarkdownView`** in `src/core/reconformHistory.ts` (`WeakMap<MarkdownView, Snapshot[]>`).
- Snapshot prima di ogni azione; prune al cambio file (lazy all'accesso + eventi
  `file-open`/`layout-change`); notifica ai listener (`onHistoryChange`) per sincronizzare i pulsanti
  undo senza polling.

### Sessione C — UI pannello (feature principale)

- Toolbar **per-view** in `src/features/metadataPanel.ts` (`WeakMap<MarkdownView, PanelUI>`),
  gestita su `active-leaf-change`/`file-open`/`layout-change` + `MutationObserver` scoped.
- Indicatore di stato a sinistra di `Add property` (nota → `circle-*`; template → `file-check`/
  `file-x` confrontato col parent; senza template → `circle-dashed`).
- Pulsante reconform + undo a stack; rimossi `reconformButton.ts` e `templateStatusIcon.ts`.
- Contratto DOM verificato live (Obsidian 1.x):

```
.metadata-container
  .metadata-content
    .metadata-properties        (righe prop)
    <span.cascade-templates-status>    ← status (C2), PRIMA dell'add button
    .metadata-add-button                ← "Add property" nativo
    <div.cascade-templates-toolbar>     ← azioni (C3/C4), DOPO l'add button
      .cascade-templates-action (reconform) + .cascade-templates-action (undo)
```

- Note utili: dopo un click il refresh legge da **disco** (`fresh=true`) perché `vault.modify`
  risolve prima che il `metadataCache` sia aggiornato; il `MutationObserver` fa solo **ri-aggancio**
  (lo stato è guidato da `metadataCache.on('changed')`, debounce 200ms).
- Verifica: integrazione headless con moduli core reali + DOM/vault finti (33 assert).

- C3/C4/C5 sono **superseded dalla Sessione H**: il modello a "fase derivata" è stato sostituito dal
  cursore per-view.

### Sessione G — Integrazione opzionale con Templater

- Contesto: Templater gira solo alla **creazione** del file, non su `vault.modify`; il ponte è
  opt-in e riguarda solo i valori di frontmatter con sintassi `<%` dei file **nota**.
- **G1** `src/core/templaterBridge.ts`: `hasTemplaterSyntax` + `evaluateTemplaterValue` (lookup
  runtime, feature detection, logica pura dove possibile).
- **G2** Integrazione in `reconformFile` (mai sui `!Template.md`), fallback al valore raw per valore.
- **G3** Setting "Evaluate Templater scripts in notes" (default off, attivo solo se Templater rilevato).
- **G4** Guardrail nel tooltip del reconform quando l'opzione è off.
- **G5** Test headless (16 assert).
- Note: API `create_running_config` + `parse_template` dietro feature detection e `try/catch`;
  `parse_template` non è API pubblica → degrado con grazia; in v1 liste/oggetti non riconvertiti.

---

## Roadmap

### Sessione H — UX pannello a cursore (supersede C3–C5)

Origine: `NEXT.md`. Atomicità e non invasività invariate.

- [ ] **H1** Cursore per-view in `metadataPanel.ts`: campo di avanzamento in `PanelUI`
      (0=Reconform, 1=Remove extra, 2=Reset, 3=concluso); il mode **non** è più derivato da
      `computeMapConformance`; avanzamento di una fase per click fino a Reset, poi click **inerti**;
      reset del cursore agganciato alla notifica `hasHistory=false` (stessi trigger di B2).
- [ ] **H2** Snapshot a ogni pressione "viva": rimozione della guardia `if (changed)`; in
      `ReconformSnapshot` si salva anche la fase pre-press; `undo` ripristina props **e** fase e salta
      la scrittura quando le props sono identiche. Dipende da H1.
- [ ] **H3** Etichette `Reconform` / `Remove extra` / `Reset`; tooltip: status = stato + path del
      template di riferimento; reconform = descrizione dello stato corrente (contesto note/template);
      il warning Templater (G4) resta sul reconform.
- [ ] **H4** Convenzione colore a 3 livelli sul reconform (attivo / no-op attenuato / disabled) +
      helper di actionability per fase. Dipende da H1. Nota: la fase Reset è no-op solo se
      `areMapsEqual(current, template)`, non se `status === 'ok'`.
- [ ] **H5** Larghezza fissa del solo pulsante reconform con `min-width` in `ch` (evita il salto di
      layout al cambio etichetta).

### Sessione D — Settings + fondamenta

- [ ] **D1** `src/settings.ts` + `PluginSettingTab` con `loadData`/`saveData`: template filename,
      auto-apply on/off, scanner scope (+ esclusioni), comportamento senza template (hide/disabled).
      *Fatto finora: Template file name + toggle Templater. Restano auto-apply on/off, scanner scope,
      comportamento senza template.*
- [x] **D2** Nome del file template configurabile: default **`!Template`** (basename, `.md`
      implicito), salvato nelle settings; helper `getTemplateFilename()` (basename → `!Template.md`)
      e `isTemplateFile(file)`, riusati da panel, scanner e dal bridge Templater (G2). I vault
      esistenti restano compatibili (`!Template` + `.md` = `!Template.md`).
- [x] **D3** Refresh della UI panel/scanner al cambio settings (listener da `onSettingsChange`).

### Sessione E — Scanner (resta Modal)

- [ ] **E1** Performance: operare su `metadataCache`, eliminare `vault.read` per file (chiude il Rischio 3).
- [ ] **E2** Autofix per item + "fix all" riusando `reconformFile` (e spingendo in history come la UI).
- [ ] **E3** Secondo scanner: **template vs parent** (stessa regola delle icone); etichette esplicite
      extra/missing per file.
- [ ] **E4** Scope/esclusioni dalle settings + stringhe in inglese.

### Sessione F — Community readiness

- [ ] **F1** Passata finale stringhe in inglese.
- [ ] **F2** README + screenshot aggiornati.
- [ ] **F3** Manifest/release (versioning con `npm version`, tag senza prefisso `v`).
- [ ] **F4** Test del core puro (`mapOperations`, `setOperations`, conformance, history).

---

## Note operative

- Unica verifica completa: `npm run build` (`tsc -noEmit -skipLibCheck` + bundle). In alcuni
  ambienti `node` non è installato e il build va lanciato altrove.
- `main.js` è un artefatto generato e gitignored: non editarlo mai.
- I file nuovi/modificati devono essere LF (`.editorconfig`).
- Versioning Git gestito manualmente dall'utente: non toccare comandi git se non esplicitamente
  richiesto.
