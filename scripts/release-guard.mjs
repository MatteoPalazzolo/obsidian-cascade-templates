/**
 * release-guard.mjs — precondizioni di release.
 * Eseguito da `npm version` nella fase `preversion`, quindi PRIMA che npm
 * modifichi package.json/lock: se qualcosa fallisce il bump non avviene e
 * non viene creato né commit né tag.
 * Controlli: ambiente (niente publish da container), branch (solo main),
 * verifiche statiche (lint, test).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const RELEASE_BRANCH = "main";

function git(...args) {
	return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function block(reason, hint) {
	console.error(`\n✖ Release bloccata: ${reason}`);
	if (hint) console.error(`  → ${hint}`);
	console.error("");
	process.exit(1);
}

/**
 * Lancia `npm run <script>` ereditando stdio (l'output resta visibile).
 * Usa `npm_execpath` invece del comando `npm`: su Windows `execFileSync("npm")`
 * fallisce con ENOENT perché il binario è `npm.cmd`, e passare da una shell
 * complicherebbe il quoting. `npm_execpath` è impostato da npm stesso quando
 * lo script viene eseguito come lifecycle hook.
 */
function npmRun(script) {
	const npmCli = process.env.npm_execpath;
	const cmd = npmCli ? process.execPath : "npm";
	const args = npmCli ? [npmCli, "run", script] : ["run", script];
	console.log(`\n▶ npm run ${script}`);
	try {
		execFileSync(cmd, args, { stdio: "inherit" });
	} catch {
		block(`\`npm run ${script}\` è fallito`, "correggi gli errori e riprova");
	}
}

// 1. ambiente: niente publish da container/sandbox
if (existsSync("/.dockerenv")) {
	block("impossibile fare publish di una versione dalla sandbox");
}

// 2. branch: le release si taggano solo da main
let branch;
try {
	branch = git("rev-parse", "--abbrev-ref", "HEAD");
} catch {
	block("non sono dentro un repository git.");
}

if (branch !== RELEASE_BRANCH) {
	block(
		`branch corrente "${branch}", le release si taggano solo da "${RELEASE_BRANCH}"`,
		`git switch ${RELEASE_BRANCH}`,
	);
}

// 3. verifiche statiche (costose: per ultime)
npmRun("lint");
npmRun("test");
