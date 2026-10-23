import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

if (!targetVersion) {
	console.error("✖ npm_package_version non definita: lo script va lanciato tramite `npm version`, non direttamente con node.");
	process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(targetVersion)) {
	console.error(`✖ Versione non valida: "${targetVersion}" (atteso x.y.z, senza prefisso "v").`);
	process.exit(1);
}

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
