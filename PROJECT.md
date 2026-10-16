# PROJECT.md

Logiche e semantica del progetto Cascade Templates.

Documenti complementari:
- `AGENTS.md` — architettura, comandi, convenzioni di codice.
- `FUTURE.md` — roadmap e sessioni di lavoro.
- `UX.md` — interfaccia visibile all'utente, senza tecnicismi.

---

## 1. Dominio della cascata

- Ogni file eredita le proprietà del `!Template.md` **antenato più vicino** risalendo la cartella; un template annidato sovrascrive quello sopra.
- L'ordine delle chiavi del frontmatter è preservato.
- `position`, iniettata da Obsidian nella cache, non è mai confrontata né scritta.

## 2. Conformità

- **Nota vs template**: `ok` / `extra` / `missing`, in base alla presenza delle chiavi.
- **Template vs template genitore**: valido se include tutte le prop del parent; `extra` = prop proprie.
- **Nessun template**: stato neutro e pulsante reconform disabilitato.
- L'indicatore di stato è sempre **derivato** dalla conformità ed è indipendente dal cursore del pulsante.

## 3. Pulsante reconform (cursore a fasi)

- Tre fasi, in ordine: `add-missing` (Reconform) → `remove-extra` (Remove extra) → `reset-defaults` (Reset).
- Stato UI **per-view** (`phase` 0..3): parte sempre dalla fase base; ogni click vivo avanza di una fase **anche se il contenuto non cambia**; dopo Reset il cursore si blocca.
- `reconformFile(file, mode)` è l'unico entry point; ritorna `true` solo se ha scritto.
- **Colori a 3 livelli**: attivo / no-op attenuato / disabled.
  - Una fase è no-op se `areMapsEqual(current, computeReconformProps(template, current, mode))`.
  - La fase Reset è no-op solo se il frontmatter coincide coi default, **non** se `status === 'ok'`.
- **Fine corsa** (dopo Reset) e **nessun template** → disabilitato duro.
- Larghezza fissa del **solo** reconform (`min-width` in `ch`): l'etichetta non fa saltare il layout.

## 4. History / Back

- Stack **per-view**: ogni pressione viva del reconform pusha uno snapshot **incondizionato** = frontmatter + fase **pre-press**.
- Back poppa l'ultimo snapshot, ripristina frontmatter e fase; se le props coincidono con quelle su disco **salta la scrittura** ma muove comunque il cursore.
- Back è abilitato solo se lo stack non è vuoto.

## 5. Sessione

Cursore + stack Back = **una sessione** del pulsante. Si chiude (cursore → fase base, stack svuotato) quando:

- il frontmatter cambia **fuori dal pulsante** (edit manuale, sync, altri plugin, altro pannello);
- la view mostra un **file diverso**;
- la view viene **chiusa**;
- Back **svuota** lo stack.

Dettagli:

- Le scritture del pulsante **non** chiudono la sessione: ogni azione fa prima un refresh `fresh` che adotta le nuove props come **baseline**; il confronto con la baseline avviene solo su un reale cambio di contenuto (`metadataCache` `"changed"`).
- Il **body** della nota non conta: chiude solo un cambio di frontmatter.
- Chiudere **non è un revert**: la history è scartata, lo stato corrente resta.
- L'edit manuale è interpretato come **hand-off**: l'utente prende il controllo, la sessione guidata termina.

## 6. Templater (opzionale)

- Ponte **opt-in**, solo note; i `!Template.md` conservano sempre le espressioni raw.
- Se attivo, i valori con sintassi `<%` sono valutati in scrittura; altrimenti il reconform avvisa nel tooltip.

## 7. Non invasività

- Nessuna automazione a cascata; ogni azione è **circoscritta alla nota**.
- Cascate solo su azione esplicita o feature dello scanner.

## 8. Compatibilità

- **Baseline: Obsidian 1.5.0** (`minAppVersion`). Il pannello si aggancia alla DOM Properties (introdotta in 1.4); 1.5 è scelta per UI più assestata, Lucide più recente e meno superficie di QA.
- I tipi del pacchetto dev `obsidian` sono **pinnati alla linea 1.5**: il compilatore impedisce di usare API più nuove di quelle dichiarate.
- Le icone **Lucide** sono un asset runtime legato alla versione di Obsidian: rendono tutte tramite `setIconSafe` / `resolvableIcon` (fallback), così non dettano la soglia.

## 9. Riferimenti al codice

- `src/features/metadataPanel.ts` — UI, stati del cursore, sessione.
- `src/core/templateAPI.ts` — `reconformFile`, `computeReconformProps`, `computeTemplateConformance`.
- `src/core/reconformHistory.ts` — stack Back.
- `src/core/mapOperations.ts` — merge, conformità, `areMapsEqual`.
- `src/core/templaterBridge.ts` — ponte Templater.
