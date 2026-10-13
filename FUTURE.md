# FUTURE.md

Roadmap delle prossime sessioni di lavoro sul plugin **Cascade Templates**.
Obiettivo: un sistema di templating a cascata funzionale, solido e pubblicabile per la community.

> Contesto: il plugin è già stato ripulito da tutto il non-template
> Vedi `AGENTS.md` per comandi e architettura.

---

## Decisioni di design (confermate)

- **Toolbar nel pannello properties**: deve comparire in **ogni nota visibile** (split pane), non solo nella nota attiva → serve un'istanza per `MarkdownView` (WeakMap).
- **Revert**: una sola voce di undo, disponibile **fino al cambio scheda/file**, poi azzerata.
- **Hard Reconform**: rimuove solo le proprietà extra (non presenti nel template), mantenendo i
  valori del file per le chiavi condivise. Corrisponde a `mergeSecondOnFirstMap(template, file, false)`.
- **Set methods**: sostituire i metodi nativi TC39 (`Set.prototype.intersection`, `isSubsetOf`, ...)
  con helper puri, per compatibilità con WebView mobile datate.
- **Settings**: introdotta a breve con le opzioni minime: template filename, auto-apply on/off,
  scanner scope (+ esclusioni).
- **Scanner**: resta una **Modal** (nessuna View persistente).
- **Stringhe sorgente**: standardizzate in **inglese** (nuovi commenti in inglese caratterizzati sempre dal prefisso AI per distinguere chi li scrive).
- **Command palette**: nessun nuovo comando per ora.
- **Ordine sessioni**: **panel prima, poi fondamenta/settings, poi scanner, poi community**.
- **Semantica di cascata**: confermato "nearest template wins" + disciplina. Ogni template
  *dovrebbe* includere le prop del parent; se ne manca alcune è un errore da segnalare (non un merge automatico dell'intera catena).

---

## Rischi tecnici trasversali (da affrontare)

1. **Compatibilità `Set` TC39** — `isTemplateCoherentToParentTemplate` usa `intersection`/
   `isSubsetOf`/`difference`; con `isDesktopOnly: false` su mobile datato si rischia un crash a
   runtime. Sostituire con helper puri e rimuovere `types/set-methods.d.ts`.
2. **`setFileProps` fragile** — il loop `Object.entries(newPropsMap)` su una `Map` è un no-op: si
   affida interamente a `new Doc(map)`. Va costruito esplicitamente lo `YAMLMap` iterando
   `map.entries()`, curando la formattazione del blocco frontmatter (`---`, riga vuota, `...`).
3. **Performance scanner** — `runAllScanner` fa `vault.read()` per ogni file ma `CoherenceScanner`
   ignora `content` e usa la cache. Rimuovere il read; tutto su `metadataCache`.
4. **Nessuna Settings tab** — per la community serve; vedi Sessione B.
5. **`console.log` residuo** in `src/utils/dom.ts` (`createElInline`, `customData`).
6. **Bug visibilità pannello** — `refreshButton`/`refreshIcon` rimuovono gli elementi quando
   `getActiveViewOfType(MarkdownView)` è `null` (focus su search/explorer). Vedi Sessione A.

---

## Sessione A — Metadata panel + set helper (PRIORITÀ)

Obiettivo: risolvere il bug della scomparsa e introdurre l'intero set di controlli nel pannello
properties, per ogni nota visibile.

- [ ] `src/core/setOperations.ts` con helper puri (`intersection`, `difference`, `isSubsetOf`);
      rimuovere `types/set-methods.d.ts` e gli usi nativi in `templateAPI`.
- [ ] Core: `reconformFile(file, { hard })` unico, condiviso da UI e scanner; snapshot store per il
      revert (singola voce, azzerata al cambio file/leaf).
- [ ] `src/features/metadataPanel.ts`: una toolbar per ogni `MarkdownView` visibile
      (`WeakMap<MarkdownView, PanelUI>`), gestita su `active-leaf-change`/`file-open`/`layout-change`
      + `MutationObserver` scoped per sopravvivere ai re-render del pannello.
- [ ] Toolbar:
      - status icon: note → `circle-*` (ok/extra/missing); template → `file-check`/`file-x`
        confrontato col parent via `isTemplateCoherentToParentTemplate`.
      - soft Reconform;
      - hard Reconform (`tail=false`, solo rimozione extra);
      - Revert (visibile solo se esiste uno snapshot per il file attivo).
      - label contestuale ("Reconform from parent template" sui template).
- [ ] Stringhe **in inglese**.
- [ ] Il panel legge il filename template tramite l'API core (non la costante diretta), così la
      settings della Sessione B sarà trasparente.
- [ ] Rimuovere `src/features/reconformButton.ts` e `src/features/templateStatusIcon.ts`.
- [ ] Wiring in `main.ts`.

## Sessione B — Fondamenta + Settings

- [ ] Hardening `setFileProps` / `getFileProps` (YAMLMap esplicito, formattazione frontmatter).
- [ ] `src/settings.ts` + `PluginSettingTab` con `loadData`/`saveData`: template filename,
      auto-apply on/off, scanner scope (+ esclusioni).
- [ ] `TEMPLATE_FILENAME` letto dal context (non hardcoded).
- [ ] Cleanup `console.log` in `src/utils/dom.ts`.

## Sessione C — Scanner (resta Modal)

- [ ] Autofix per item + "fix all" riusando `reconformFile`.
- [ ] Secondo scanner: **template vs parent** (stessa regola delle icone); etichette esplicite
      extra/missing per file.
- [ ] Performance: operare su `metadataCache`, niente `vault.read` per file.
- [ ] Scope/escusioni dalle settings.
- [ ] Stringhe in inglese.

## Sessione D — Community readiness

- [ ] Passata finale stringhe in inglese.
- [ ] README + screenshot aggiornati.
- [ ] Manifest/release (versioning con `npm version`, tag senza prefisso `v`).
- [ ] Test del core puro (`mapOperations`, `setOperations`, conformance).

---

## Note operative

- Unica verifica completa: `npm run build` (`tsc -noEmit -skipLibCheck` + bundle). In alcuni
  ambienti `node` non è installato e il build va lanciato altrove.
- `main.js` è un artefatto generato e gitignored: non editarlo mai.
- I file nuovi/modificati devono essere LF (`.editorconfig`).
- Versioning Git gestito manualmente dall'utente: non toccare comandi git se non esplicitamente
  richiesto.
