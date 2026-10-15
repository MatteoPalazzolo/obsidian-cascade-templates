# AGENTS.md

## Project
Obsidian plugin "Cascade Templates" (`manifest.json` id `cascade-templates`).
TypeScript source bundled by esbuild into `main.js`. Single package, no test suite.

## Commands
- `npm install` first.
- `npm run dev` - esbuild watch only. DOES NOT typecheck.
- `npm run build` - `tsc -noEmit -skipLibCheck` + production bundle. Only full verification; run before finishing.
- Typecheck only: `npx tsc -noEmit -skipLibCheck`.
- Lint (no npm script): `npx eslint .` (config `.eslintrc`, ignores `main.js`).
- Release: `npm version <patch|minor|major>` runs `version-bump.mjs`, syncing `manifest.json` + `versions.json`; tags have no `v` prefix (`.npmrc`).
- `node` may be absent in sandboxes; typecheck/build then cannot run.

## Gotchas
- `main.js` is a generated, gitignored bundle. Never edit it; rebuild instead.
- New/changed files must be LF (`.editorconfig` `end_of_line = lf`).
- Ti trovi all'interno di una sandbox che gira su WSL con il progetto condiviso in un mount da una cartella di windows, tienine conto.

## Architecture
- `main.ts` - plugin entry (`onload`/`onunload`); wire modules here (settings → core → UI).
- `src/settings.ts` - user settings + persistence + `PluginSettingTab`; exposes `getTemplateFilename()` / `isTemplateFile()`.
- `src/core/templateAPI.ts` - template resolution + frontmatter read/write + `reconformFile`. Module-level plugin context: `init(this)` in onload, then use `getCtx().app` inside these functions, never `this.app`.
- `src/core/mapOperations.ts` - property merge + conformance (`ok`/`extra`/`missing`).
- `src/core/setOperations.ts` - pure Set helpers (mobile-safe replacement of the TC39 Set methods).
- `src/core/reconformHistory.ts` - per-`MarkdownView` undo stack (snapshot before each action).
- `src/core/templaterBridge.ts` - optional runtime bridge to Templater (opt-in, notes only).
- `src/features/metadataPanel.ts` - per-view metadata panel toolbar (status / reconform / undo).
- `src/scanner/` - vault-wide coherence scanner (`TemplateScannerModal`, `ScannerABC` subclasses).
- `src/conts.ts` - static defaults only (`DEFAULT_TEMPLATE_BASENAME = "!Template"`).

## Domain rules
- A note inherits the nearest ancestor `!Template.md` walking up its folder chain; nested templates override.
- Auto-apply triggers only on new untitled empty notes (`create` event, name starts `Untitled`).
- Frontmatter key order is preserved (`yaml` package).
- Obsidian injects `position` into cached frontmatter; ignore it when comparing/merging.

## Conventions
- `tsconfig` `baseUrl "."`: `main.ts` imports use `src/...`, files under `src/` use relative imports. Match neighbors.
- `types/` no longer augments `Set`: TC39 set methods are replaced by `src/core/setOperations.ts`.
- `styles.css` uses native CSS nesting keyed by modal class (e.g. `.ScannerModal`).
- Comments/source strings mix Italian and English; do not add comments unless asked.

## Obsidian Guidelines
- Piattaforme: Assicurati che il plugin funzioni sia su Desktop che su Mobile (iOS e Android), oppure disabilita esplicitamente il supporto mobile nel manifest.json ("isDesktopOnly": true).
- Lifecycle Hooks: Ripulisci sempre eventi, listener e intervalli all'interno del metodo onunload(). Utilizza helper come this.registerEvent() o this.registerInterval() che gestiscono automaticamente il cleanup.
- Prestazioni: Non eseguire scansioni massive del vault all'avvio nel thread principale (onLayoutReady). Differisci i caricamenti pesanti ed evita operazioni bloccanti.
- CSS & Temi: Usa le variabili CSS native di Obsidian (es. --text-normal, --background-primary) per garantire che il plugin si adatti perfettamente sia al tema chiaro/scuro sia ai temi personalizzati.
- Conformità UI (seamless): Quando modifichi o inietti interfaccia, l'interfaccia nativa che stai toccando è la fonte di verità. Riutilizza le classi/componenti native di Obsidian (es. text-icon-button, text-button-icon, text-button-label) e le sue variabili CSS (--metadata-label-font, --metadata-label-font-size, --button-radius, --size-*, --text-muted, --background-modifier-hover, --icon-color-hover, --input-font-weight, --line-height-normal, ...) al posto di valori a mano, e non ridefinire gli stati (hover, :focus-visible, disabled, active) se puoi ereditare quelli nativi. Replica tipografia, spaziature e stati del controllo nativo equivalente in modo che l'elemento iniettato risulti indistinguibile da quello nativo. Ispeziona l'elemento reale (devtools) e verifica la resa prima di chiudere il lavoro.

## User Guidelines
- alla fine dell'implementazione di uno o più punti suggeriscimi sempre cosa scrivere nel git commit che gestirò in autonomia
- ogni qualvolta che ti chiedo un riferimento al codice ti chiederei di rispondermi con la notazione di vscode del tipo main.ts:42 o src/settings.md:5 ; crea dei link relativi all'interno di workspace/ e non menzionare workspace nei link stesso
- considera NEXT.md readonly con delle mie considerazioni a caldo non strutturate a cui attingere a inizio sessione
- non toccare mai comandi di github in scrittura, ho disabilitato la scrittura nella cartella .git, ogni tentativo sarà negato, voglio avere controllo completo del versioning in autonomia
- commenta estensivamente sia file che codice descrivendo il ruolo svolto dal rispettivo file o funzione o classe o chi per esso all'interno dell'architettura del programma, in modo che io possa facilmente orientarmi con uno sguardo ad alto livello
- commenta estensivamente sia file che codice descrivendo il ruolo svolto dal rispettivo file o 
funzione o classe o chi per esso all'interno dell'architettura del programma, in modo che io poss
a facilmente orientarmi con uno sguardo ad alto livello
- il prodotto deve risultare NON invasivo, non considerare mai soluzioni automatiche di reconfor
m a cascata se non specificato da una feature gestita dall'UI dello scanner per esempio, le autom
azioni in una nota devono essere sempre circoscritte alla nota stessa