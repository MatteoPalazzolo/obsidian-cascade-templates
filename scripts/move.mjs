/**
 * move.mjs — build di produzione + deploy locale del plugin.
 * Eseguito da `npm run move` sulla macchina Windows dello sviluppatore.
 *
 * Ruolo nell'architettura:
 * Il repository è la sorgente; Obsidian però carica il plugin da una cartella
 * `plugins/<id>` del vault. Questo script chiude il cerchio: esegue il build
 * completo (`npm run build` = typecheck + bundle esbuild in miniatura) e copia
 * i soli artefatti che Obsidian legge davvero (`manifest.json`, `main.js`,
 * `styles.css`) nella cartella del vault di test, che è sincronizzata col cloud.
 *
 * Controlli (in ordine, i più economici per primi):
 * 1. ambiente: niente deploy dalla sandbox/container (non ha senso e non ha
 *    accesso alle cartelle Windows);
 * 2. piattaforma: il percorso di destinazione è specifico di Windows;
 * 3. build: se fallisce non viene copiato nulla (nessun artefatto stantio);
 * 4. artefatti: esistenza e dimensione > 0, poi copia con verifica finale.
 *
 * La cartella di destinazione può essere sovrascritta con la variabile
 * d'ambiente `CASCADE_DEPLOY_DIR` (utile per provare un secondo vault),
 * altrimenti si usa `DEFAULT_TARGET`.
 */
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

/** Radice del progetto (questo file vive in `scripts/`). */
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** File che compongono il plugin caricato da Obsidian. */
const ARTIFACTS = ["manifest.json", "main.js", "styles.css"];

/** Cartella vault di test (OneDrive) in cui Obsidian legge il plugin. */
const DEFAULT_TARGET =
	"C:\\Users\\palam\\OneDrive\\OneSyncFiles\\obsidian\\valut_test\\.obsidian\\plugins\\obsidian-cascade-templates";

const target = process.env.CASCADE_DEPLOY_DIR || DEFAULT_TARGET;

/** Errore leggibile e non ambiguo: spiega cosa fare, poi esce con codice 1. */
function block(reason, hint) {
	console.error(`\n✖ Deploy bloccato: ${reason}`);
	if (hint) console.error(`  → ${hint}`);
	console.error("");
	process.exit(1);
}

/** Formatta una dimensione in byte come KB con un decimale. */
function kb(bytes) {
	return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Lancia `npm run <script>` ereditando stdio (l'output del build resta visibile).
 * Su Windows `execFileSync("npm")` fallisce con ENOENT perché il binario è
 * `npm.cmd`: si usa `npm_execpath` (impostato da npm per gli script) e, se
 * manca, si ripiega su `.cmd`. Se qualcosa fallisce il deploy si ferma.
 */
function npmRun(script) {
	const npmCli = process.env.npm_execpath;
	const cmd = npmCli
		? process.execPath
		: process.platform === "win32"
			? "npm.cmd"
			: "npm";
	const args = npmCli ? [npmCli, "run", script] : ["run", script];

	console.log(`\n▶ npm run ${script}`);
	try {
		execFileSync(cmd, args, { stdio: "inherit" });
	} catch {
		block(
			`\`npm run ${script}\` è fallito`,
			"correggi gli errori di typecheck/build e riprova",
		);
	}
}

// 1. ambiente: la sandbox non ha accesso alle cartelle Windows del vault
if (existsSync("/.dockerenv")) {
	block("impossibile fare deploy dalla sandbox/container");
}

// 2. piattaforma: destinazione e percorso di questo comando sono Windows-only
if (process.platform !== "win32") {
	block(
		`deploy previsto solo su Windows (piattaforma corrente: "${process.platform}")`,
	);
}

// 3. build: gli artefatti copiati devono essere quelli appena generati
npmRun("build");

// 4. artefatti: validazione prima di toccare la destinazione
const sources = ARTIFACTS.map((name) => join(PROJECT_ROOT, name));
for (const [i, name] of ARTIFACTS.entries()) {
	const src = sources[i];
	if (!existsSync(src)) {
		block(`artefatto mancante: ${src}`, "il build non ha prodotto tutti i file");
	}
	const size = statSync(src).size;
	if (size === 0) {
		block(`artefatto vuoto: ${src}`, "ricostruisci il progetto");
	}
}

// 5. copia (la cartella di destinazione viene creata se non esiste ancora)
mkdirSync(target, { recursive: true });

console.log(`\n▶ copia in ${target}`);
for (const [i, name] of ARTIFACTS.entries()) {
	const dest = join(target, name);
	copyFileSync(sources[i], dest);

	// verifica post-copia: dimensione identica, così un copy troncato non passa
	const srcSize = statSync(sources[i]).size;
	const destSize = statSync(dest).size;
	if (destSize !== srcSize) {
		block(
			`copia incompleta di ${name} (${kb(destSize)} invece di ${kb(srcSize)})`,
			"chiudi Obsidian che tiene il file aperto e riprova",
		);
	}
	console.log(`  ✔ ${name.padEnd(14)} ${kb(destSize).padStart(8)}`);
}

console.log("\n✔ Deploy completato: riavvia Obsidian o disabilita/riabilita il plugin.\n");
