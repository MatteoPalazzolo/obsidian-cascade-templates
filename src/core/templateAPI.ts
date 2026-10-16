import {MarkdownView, Plugin, TAbstractFile, TFile} from "obsidian";
import {isMap, isPair, isScalar, parseDocument, Document as Doc} from 'yaml';
import {getSettings, getTemplateFilename, isTemplateFile} from "../settings";
import {difference, isSubsetOf} from "./setOperations";
import {areMapsEqual, mergeSecondOnFirstMap} from "./mapOperations";
import {evaluateTemplaterValue, hasTemplaterSyntax, isTemplaterAvailable} from "./templaterBridge";

let ctx: Plugin | undefined;

export function init(context: Plugin): void {
	if (ctx) {
		throw new Error("PluginContext già inizializzato! init() va chiamato una sola volta.");
	}
	ctx = context;
}

function getCtx(): Plugin {
	if (!ctx) {
		throw new Error("PluginContext non inizializzato! Chiama init(this) nel metodo onload().");
	}
	return ctx;
}

export async function registerTemplatezListener() {
	getCtx().registerEvent(
		getCtx().app.vault.on("create", async file => {
			if (!(file instanceof TFile) || file.extension !== "md") return;

			// NOTA: create si triggera ad ogni avvio dell'app, non solo quando viene creato un nuovo file
			if (file.name.startsWith("Untitled") && file.stat.size === 0) {
				await applyTemplateToNewFile(file);
			}
		})
	);
}

export function getTemplateOfFile(file: TFile | undefined): TFile | undefined {
	if (!file) return;

	if (file.extension !== "md") return;

	let f: TAbstractFile = file;
	while (f.parent) {
		f = f.parent;
		const folderPath = f.path === "/" ? "" : f.path + "/";
		const templateFile = getCtx().app.vault.getAbstractFileByPath(folderPath + getTemplateFilename());

		if (templateFile instanceof TFile && templateFile.path !== file.path) {
			return templateFile;
		}
	}
}

export function getActiveMarkdownView() {
	return getCtx().app.workspace.getActiveViewOfType(MarkdownView);
}

export function getActiveMarkdownFile() {
	return getActiveMarkdownView()?.file ?? undefined;
}

/**
 * Legge le proprietà del frontmatter dalla cache dei metadata di Obsidian.
 * Versione sincrona, adatta ad operazioni massive (es. scanner).
 *
 * AI: NOTE — Obsidian injects a synthetic `position` key ({ start, end }) into
 * cached frontmatter. Callers that compare/merge key sets must ignore it, so
 * prefer `getFilePropsMapFromCache` over using this raw record directly.
 */
export function getFilePropsFromCache(file: TFile | undefined): Record<string, any> | undefined {
	if (!file) return;
	return getCtx().app.metadataCache.getFileCache(file)?.frontmatter;
}

/**
 * AI: Ordered `Map` view of a file's cached frontmatter.
 *
 * Role in the architecture:
 * Synchronous, cheap accessor used by the scanner and the metadata panel. It
 * reuses the exact same key set/ordering rules as the disk-reading
 * `getFileProps`, so UI and scanner agree on what "the file's properties" are.
 * The synthetic `position` key added by Obsidian is dropped here.
 */
export function getFilePropsMapFromCache(file: TFile | undefined): Map<string, any> {
	const map = new Map<string, any>();

	const props = getFilePropsFromCache(file);
	if (!props) return map;

	for (const [key, value] of Object.entries(props)) {
		if (key === 'position') continue;
		map.set(key, value);
	}

	return map;
}

/**
 * Legge il frontmatter del file preservandone l'ordine esatto di lettura.
 *
 * AI: HARDENING — the parsed root is validated with `isMap` instead of the
 * previous duck-typed `'items' in items && Array.isArray(items.items)` check,
 * so non-mapping frontmatter (scalars/sequences) safely yields an empty Map.
 */
export async function getFileProps(file: TFile | undefined): Promise<Map<string, any>> {
	const map = new Map<string, any>();
	if (!file) return map;

	const content = await getCtx().app.vault.read(file);
	const doc = parseDocument(content);
	const contents = doc.contents;

	// The frontmatter root must be a YAML mapping; otherwise there is nothing to read.
	if (!isMap(contents)) return map;

	for (const pair of contents.items) {
		// Skip malformed entries that are not valid key/value pairs.
		if (!isPair(pair) || !pair.key) continue;

		// Keys are stored as scalars; fall back to string coercion for exotic nodes.
		const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);

		// Convert the value node into a native JavaScript value.
		const value = pair.value ? pair.value.toJSON() : null;

		// Insert preserving the exact reading order.
		map.set(key, value);
	}

	return map;
}

/**
 * AI: Writes the given properties as the file's frontmatter, preserving the
 * `Map` insertion order and rebuilding the markdown body untouched.
 *
 * HARDENING (Rischio 2): the previous implementation did
 * `for (const [key, value] of Object.entries(newPropsMap)) doc.set(...)`, which
 * is a no-op because `Object.entries` on a `Map` is always empty; the whole
 * result depended on `new Doc(map)` alone. Here the `YAMLMap` is filled
 * explicitly by iterating `map.entries()`.
 *
 * Frontmatter formatting: an empty map removes the block entirely, otherwise
 * the canonical `---` / yaml / `---` block is emitted and the body is appended
 * as-is (a leading blank line after the block is preserved when present).
 */
export async function setFileProps(file: TFile | undefined, newPropsMap: Map<string, any>): Promise<void> {
	if (!file) return;

	// Build the YAML document explicitly from the ordered Map.
	const doc = new Doc();
	for (const [key, value] of newPropsMap.entries()) {
		doc.set(key, value);
	}

	const rawContent = await getCtx().app.vault.read(file);
	// Normalize the body: no leading blank line, so the spacing after the block
	// is decided by a single place below instead of by whatever was in the file.
	const markdownBody = stripFrontmatter(rawContent).replace(/^\r?\n/, '');

	// `doc.toString()` already terminates with a newline; an empty map drops the
	// block entirely. A blank line always separates the block from the body.
	const finalContent = newPropsMap.size > 0
		? `---\n${doc.toString()}---\n\n${markdownBody}`
		: markdownBody;

	await getCtx().app.vault.modify(file, finalContent);
}

/**
 * AI: Removes a leading YAML frontmatter block from `content`, tolerating both
 * LF and CRLF line endings. Anything that does not start with `---` is returned
 * unchanged, so files without frontmatter keep their body intact.
 */
function stripFrontmatter(content: string): string {
	const match = content.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n)?/);
	if (!match) return content;
	return content.slice(match[0].length);
}

/**
 * AI: Single entry point for the metadata panel's reconform actions.
 *
 * Role in the architecture:
 * The UI exposes one dynamic button that advances along three phases; instead
 * of duplicating the merge logic in the feature layer, each phase maps to a
 * `mode` here:
 *   - `add-missing`    → Conform: template defaults + existing file values + extras.
 *   - `remove-extra`   → Align:   only the template keys, keeping shared values.
 *   - `reset-defaults` → Clear:   exactly the template defaults (overwrites values).
 *
 * Returns `true` only when the file actually changed, so the caller can decide
 * whether to refresh the panel (and whether to push a Back snapshot).
 */
export type ReconformMode = 'add-missing' | 'remove-extra' | 'reset-defaults';

/**
 * AI: Pure computation of the frontmatter a reconform phase would produce.
 *
 * Shared by `reconformFile` (which writes the result) and by the metadata panel
 * (H4), which uses it to detect whether the current phase is a no-op without
 * touching the file. Keeping the merge in one place guarantees they agree.
 */
export function computeReconformProps(
	templateProps: Map<string, any>,
	currentProps: Map<string, any>,
	mode: ReconformMode
): Map<string, any> {
	switch (mode) {
		case 'add-missing':
			return mergeSecondOnFirstMap(templateProps, currentProps, true);
		case 'remove-extra':
			return mergeSecondOnFirstMap(templateProps, currentProps, false);
		case 'reset-defaults':
			return new Map(templateProps);
	}
}

export async function reconformFile(file: TFile | undefined, mode: ReconformMode): Promise<boolean> {
	if (!file) return false;

	const templateFile = getTemplateOfFile(file);
	if (!templateFile) return false;

	const currentProps = await getFileProps(file);
	const templateProps = await getFileProps(templateFile);

	const nextProps = computeReconformProps(templateProps, currentProps, mode);

	// Nothing to write: skip the modify() to avoid needless cache churn/events.
	if (areMapsEqual(currentProps, nextProps)) return false;

	// AI: only pay the (possibly side-effecting) Templater step when the merge
	// already changed something — see the helper below.
	const resolvedProps = await resolveTemplaterExpressions(file, nextProps);

	if (areMapsEqual(currentProps, resolvedProps)) return false;

	await setFileProps(file, resolvedProps);
	return true;
}

/**
 * AI: Optional Templater step of the reconform (Sessione G).
 *
 * Runs only when ALL of these hold: the setting is enabled, the file is a note
 * (templates keep their expressions raw — they are the source), Templater is
 * available and the value is a string containing `<%`. Every value that cannot
 * be rendered keeps its raw form, so the operation never breaks the note.
 */
async function resolveTemplaterExpressions(file: TFile, props: Map<string, any>): Promise<Map<string, any>> {
	if (!getSettings().evaluateTemplaterInNotes) return props;
	if (isTemplateFile(file)) return props;

	const app = getCtx().app;
	if (!isTemplaterAvailable(app)) return props;
	if (![...props.values()].some(hasTemplaterSyntax)) return props;

	const resolved = new Map<string, any>();
	for (const [key, value] of props.entries()) {
		if (!hasTemplaterSyntax(value)) {
			resolved.set(key, value);
			continue;
		}

		const rendered = await evaluateTemplaterValue(app, value, file);
		resolved.set(key, rendered ?? value);
	}

	return resolved;
}

export async function applyTemplateToNewFile(file: TFile) {
	const templateFile = getTemplateOfFile(file);
	if (!templateFile) return;

	const templateContent = await getCtx().app.vault.read(templateFile);
	await getCtx().app.vault.modify(file, templateContent);
}

/**
 * AI: Pure template-vs-parent conformance, shared by
 * `isTemplateCoherentToParentTemplate` (disk reads) and the metadata panel
 * (H4), which needs the raw maps anyway to classify a phase as no-op.
 *
 * A template is valid when it includes every property of its parent
 * (neededProps empty); extraProps reports the properties it adds on its own.
 */
export function computeTemplateConformance(
	templateProps: Map<string, any>,
	parentProps: Map<string, any>
): { isValid: boolean, neededProps: Set<string>, extraProps: Set<string> } {

	const templatePropsSet = new Set(templateProps.keys());
	const parentPropsSet = new Set(parentProps.keys());

	// Rimuove 'position' che è una chiave inserita automaticamente da Obsidian nella cache
	templatePropsSet.delete('position');
	parentPropsSet.delete('position');

	// AI: pure helpers instead of the TC39 Set methods (see setOperations.ts).
	return {
		isValid: isSubsetOf(parentPropsSet, templatePropsSet),
		neededProps: difference(parentPropsSet, templatePropsSet),
		extraProps: difference(templatePropsSet, parentPropsSet),
	};
}

export async function isTemplateCoherentToParentTemplate(
	templateFile: TFile
): Promise<{ isValid: boolean, neededProps: Set<string>, extraProps: Set<string> }> {

	const parentTemplateFile = getTemplateOfFile(templateFile);
	if (!parentTemplateFile) {
		return { isValid: true, neededProps: new Set(), extraProps: new Set() };
	}

	const templateProps = await getFileProps(templateFile);
	const parentProps = await getFileProps(parentTemplateFile);

	return computeTemplateConformance(templateProps, parentProps);
}
