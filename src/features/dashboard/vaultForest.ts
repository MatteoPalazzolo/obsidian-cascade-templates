import { App, TFile } from "obsidian";
import { buildForest, type Forest, type ForestFileInput } from "../../core/forest";
import { getFilePropsMapFromCache } from "../../core/templateAPI";
import { getTemplateFilename } from "../../settings";

/**
 * AI: Adapter between the vault and the pure forest.
 *
 * Role in the architecture:
 * The only place where the dashboard touches Obsidian to build its tree. It
 * reads `metadataCache` only (never the disk) and hands plain path/property
 * records to `buildForest`. The `files` map keeps the `TFile` handles so an
 * action can target a node without another lookup.
 */

export interface VaultForestSnapshot {
	forest: Forest;
	files: Map<string, TFile>;
	/** Markdown files with no metadata cache entry yet. */
	pending: number;
}

export function buildVaultForest(app: App): VaultForestSnapshot {
	const templateFilename = getTemplateFilename();
	const files = new Map<string, TFile>();
	const inputs: ForestFileInput[] = [];
	let pending = 0;

	for (const file of app.vault.getMarkdownFiles()) {
		files.set(file.path, file);
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) pending++;

		const isTemplate = file.name === templateFilename;
		const props = cache?.frontmatter
			? getFilePropsMapFromCache(file)
			: (isTemplate ? new Map<string, unknown>() : null);

		inputs.push({ path: file.path, props });
	}

	return {
		forest: buildForest({ files: inputs, templateFilename }),
		files,
		pending,
	};
}
