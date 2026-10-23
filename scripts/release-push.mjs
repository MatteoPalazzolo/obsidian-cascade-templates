/**
 * release-push.mjs — push della release.
 * Eseguito in `postversion`: commit e tag esistono già in locale.
 * Pusha branch corrente + SOLO il tag appena creato, in modo atomico
 * (o passano entrambi o nessuno dei due), indipendente dal prefisso
 * configurato in .npmrc (`tag-version-prefix`).
 */
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const targetVersion = process.env.npm_package_version;

if (!targetVersion) {
	console.error("✖ npm_package_version non definita: lo script va lanciato tramite `npm version`, non direttamente con node.");
	process.exit(1);
}

const tags = git("tag", "--points-at", "HEAD").split("\n").filter(Boolean);
const tag = tags.find((t) => t === targetVersion || t === `v${targetVersion}`);
if (!tag) {
	console.error(`✖ Nessun tag (${targetVersion}) su HEAD: release non pushata.`);
	process.exit(1);
}

execFileSync("git", ["push", "--atomic", "origin", "HEAD", `refs/tags/${tag}`], {
	stdio: "inherit",
});
