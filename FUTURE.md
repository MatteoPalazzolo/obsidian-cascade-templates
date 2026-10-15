# FUTURE.md

Roadmap delle prossime sessioni di lavoro sul plugin **Cascade Templates**.
Obiettivo: un sistema di templating a cascata funzionale, solido e pubblicabile per la community.

> Contesto: il plugin è già stato ripulito da tutto il non-template.
> Vedi `AGENTS.md` per comandi e architettura.
> Le voci qui sotto sono volutamente **atomiche**: ognuna deve poter compilare e poter essere
> revertita da sola senza rompere le voci precedenti o successive.

---

## Stato attuale (verificato live sull'istanza Obsidian)

Riga del pannello Properties:

```
[indicatore di stato ✅/⚠️/❌] [ + Add property ] [ Reconform from Template ]
```

- L'**indicatore di stato** sta a sinistra del pulsante nativo `Add property`.
- C'è **un solo** pulsante `Reconform from Template`, statico, a destra.
- **Nessun undo**.
- Il pannello è implementato in due moduli separati (`reconformButton.ts`, `templateStatusIcon.ts`)
  legati alla view attiva (non per-view).
USER ANSWER: sentiti libero di ristrutturare completamente quella parte di codice, anche fondendo i file se lo ritieni necessario.

---

## Decisioni di design (confermate)

- **Toolbar nel pannello properties**: deve comparire in **ogni nota visibile** (split pane), non solo
  nella nota attiva → serve un'istanza per `MarkdownView` (WeakMap).
- **Layout riga**: `[indicatore di stato] [Add property] [reconform dinamico] [undo]`.
  L'indicatore resta a sinistra del pulsante nativo; i due pulsanti azione a destra.
- **Pulsante reconform dinamico a stati** (un solo pulsante che cambia azione + etichetta + icona):
  1. **Add missing** — `Conform` (icona `wrench`): aggiunge le prop presenti nel
     template e assenti nel file, usando i valori di default del template; **preserva** i valori
     esistenti e le prop extra. (= `mergeSecondOnFirstMap(template, file, tail=true)`).
  2. **Remove extra** — `Align` (icona `anvil`): rimuove le prop non presenti nel template,
     **preserva** i valori condivisi. (= `mergeSecondOnFirstMap(template, file, tail=false)`).
  3. **Clear** — `Clear` (icona `broom`, da confermare): riporta il frontmatter **esattamente** ai
     default del template (sovrascrive i valori condivisi e rimuove gli extra).
  Lo stato attivo è derivato da `computeMapConformance`: `missing`→fase 1, `extra`→fase 2,
  `ok`→fase 3. Dopo ogni click lo stato viene ricalcolato, quindi il pulsante "avanza" da solo
  lungo la sequenza 1→2→3.
- **Undo a stack**: ogni azione del pulsante reconform spinge uno **snapshot** del frontmatter;
  l'undo **non** è limitato all'ultimo stato. Il pulsante undo è **sempre presente** a destra del
  reconform, ma **disabled e grigio** quando lo stack è vuoto. Nessun clear irreversibile.
- **Hard Reconform**: eliminato come pulsante separato, assorbito nella **fase 2** del pulsante dinamico.
- **History/Revert**: stack legato alla **`MarkdownView`** (non al file attivo globale). Passando da
  una **scheda** all'altra e tornando indietro la history **resta**. Si azzera solo quando la view
  viene **chiusa** oppure quando un **nuovo file sostituisce** quello corrente nella stessa view
  (es. apertura di un link nello stesso pane).
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

---

## Rischi tecnici trasversali (da affrontare)

1. **Compatibilità `Set` TC39** — `isTemplateCoherentToParentTemplate` usa `intersection`/
   `isSubsetOf`/`difference`; con `isDesktopOnly: false` su mobile datato si rischia un crash a
   runtime. Sostituire con helper puri e rimuovere `types/set-methods.d.ts`. **Chiuso in A1**.
2. **`setFileProps` fragile** — il loop `Object.entries(newPropsMap)` su una `Map` è un no-op: si
   affida interamente a `new Doc(map)`. Va costruito esplicitamente lo `YAMLMap` iterando
   `map.entries()`, curando la formattazione del blocco frontmatter (`---`, riga vuota, `...`).
   **Chiuso in A3**.
3. **Performance scanner** — `runAllScanner` fa `vault.read()` per ogni file ma `CoherenceScanner`
   ignora `content` e usa la cache. Rimuovere il read; tutto su `metadataCache`.
4. **Nessuna Settings tab** — per la community serve; vedi Sessione D.
5. **`console.log` residuo** in `src/utils/dom.ts` (`createElInline`, `customData`). **Chiuso in A5**.
6. **Bug visibilità pannello** — `refreshButton`/`refreshIcon` rimuovono gli elementi quando
   `getActiveViewOfType(MarkdownView)` è `null` (focus su search/explorer). Risolto dall'istanza
   per-view della Sessione C.

---

## Convenzione fasi atomiche

- Ogni voce = **1 step revertibile** (idealmente 1 commit).
- Ogni step deve **compilare da solo** (`npx tsc -noEmit -skipLibCheck`) e non dipendere dagli step
  successivi.
- Se uno step viene revertito, quelli prima devono restare validi e il plugin deve continuare a
  caricarsi.

---

## Sessione A — Fondamenta core (nessuna UI)

Obiettivo: tutto il "motore" necessario alla UI, senza toccare l'interfaccia. Sicura da revertire.

- [x] **A1** `src/core/setOperations.ts` con helper puri (`intersection`, `difference`, `isSubsetOf`);
      usali in `templateAPI` e rimuovi `types/set-methods.d.ts` (chiude il Rischio 1).
- [x] **A2** `getFilePropsMapFromCache(file): Map<string, any>` in `templateAPI` (Map ordinata, scarta
      `position`), riusabile da UI e scanner.
- [x] **A3** Hardening `setFileProps`/`getFileProps`: `YAMLMap` esplicito iterando `map.entries()`,
      formattazione frontmatter corretta (chiude il Rischio 2).
- [x] **A4** `reconformFile(file, mode)` unico, con `mode ∈ { add-missing, remove-extra, reset-defaults }`,
      costruito su `mergeSecondOnFirstMap` + `computeMapConformance`. Restituisce `boolean` (se ha
      modificato qualcosa) per pilotare il refresh.
- [x] **A5** Cleanup `console.log` in `src/utils/dom.ts` (chiude il Rischio 5).

## Sessione B — History / Undo stack (core)

Obiettivo: la memoria delle modifiche, separata dalla UI così è testabile e revertibile da sola.

- [x] **B1** `src/core/reconformHistory.ts`: store **per `MarkdownView`** con stack di snapshot.
      API minima: `push(view, Map)` prima di ogni azione, `undo(view)`, `hasHistory(view)`,
      `clear(view)`.
- [x] **B2** Azzeramento del solo stack della view quando: la view viene **chiusa** (leaf
      distrutto/`onunload`) oppure **il file della view viene sostituito** (stessa view, file
      diverso). **Non** azzerare al solo cambio scheda/leaf attivo.
- [x] **B3** Notifica ai listener (callback) quando lo stack cambia, così i pulsanti undo si
      abilitano/disabilitano senza polling.

Note implementative (B): lo store vive in una `WeakMap<MarkdownView, Snapshot[]>` (la view chiusa
sparisce da sola); il cambio file è rilevato confrontando il path dello snapshot con `view.file` a
ogni chiamata (prune lazy) e in modo proattivo da `registerHistoryLifecycle(view)` via
`file-open`/`layout-change`; `undo(view)` scrive già su disco tramite `setFileProps`. API extra:
`onHistoryChange(listener)` → unsubscribe, `disposeHistory()` per l'`onunload`.

## Sessione C — UI pannello (feature principale)

Obiettivo: la nuova toolbar per ogni nota visibile. È il cuore della modifica UI.

- [ ] **C1** `src/features/metadataPanel.ts`: una toolbar per **ogni `MarkdownView`** visibile
      (`WeakMap<MarkdownView, PanelUI>`), gestita su `active-leaf-change`/`file-open`/`layout-change`
      + `MutationObserver` scoped per sopravvivere ai re-render del pannello.
- [ ] **C2** Indicatore di stato a **sinistra** di `Add property`:
      nota → `circle-*` (ok/extra/missing); template → `file-check`/`file-x` confrontato col parent
      via `isTemplateCoherentToParentTemplate`; senza template → `circle-dashed` (o nascosto, vedi D).
- [ ] **C3** Pulsante reconform **dinamico a 3 fasi** a destra di `Add property`, guidato da
      `computeMapConformance` (add missing / remove extra / clear). Ogni click esegue la fase corrente
      via `reconformFile` e spinge uno snapshot in history (B1).
- [ ] **C4** Pulsante **undo a stack** a destra del reconform: sempre presente, `disabled` + grigio
      (`.cascade-templates-disabled`) quando `hasHistory(view)` è falso; il click fa `undo(view)` e
      ricalcola.
- [ ] **C5** Etichette/tooltip in inglese + label contestuale ("Reconform from parent template" sui
      template). Icone: `list-restart` (fase 1), `list-x` (fase 2), `eraser` (fase 3), `undo-2` (undo).
- [ ] **C6** Rimozione di `src/features/reconformButton.ts` e `src/features/templateStatusIcon.ts`;
      wiring di `metadataPanel` in `main.ts`.
- [ ] **C7** `styles.css`: classi della toolbar (`.cascade-templates-toolbar`, `-status`, `-action`,
      `-disabled`) con variabili CSS native di Obsidian.

## Sessione D — Settings + fondamenta

- [ ] **D1** `src/settings.ts` + `PluginSettingTab` con `loadData`/`saveData`: template filename,
      auto-apply on/off, scanner scope (+ esclusioni), comportamento senza template (hide/disabled).
- [ ] **D2** `TEMPLATE_FILENAME` letto dal context (non hardcoded); il panel legge il filename via
      `getTemplateFilename()`.
- [ ] **D3** Refresh della UI panel/scanner al cambio settings (listener da `onSettingsChange`).

## Sessione E — Scanner (resta Modal)

- [ ] **E1** Performance: operare su `metadataCache`, eliminare `vault.read` per file (chiude il Rischio 3).
- [ ] **E2** Autofix per item + "fix all" riusando `reconformFile` (e spingendo in history come la UI).
- [ ] **E3** Secondo scanner: **template vs parent** (stessa regola delle icone); etichette esplicite
      extra/missing per file.
- [ ] **E4** Scope/esclusioni dalle settings + stringhe in inglese.

## Sessione F — Community readiness

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
