import {MarkdownView, Plugin, TAbstractFile, TFile} from "obsidian";
import {isMap, isPair, isScalar, parseDocument, Document as Doc} from 'yaml';
import {getSettings, getTemplateFilename, isTemplateFile} from "../settings";
import {areMapsEqual, mergeSecondOnFirstMap} from "./mapOperations";
import {
	computeReconformProps,
	computeTemplateConformance,
	type ReconformMode,
} from "./conformance";
import {
	evaluateTemplaterContent,
	evaluateTemplaterValue,
	hasTemplaterSyntax,
	isTemplaterAvailable,
} from "./templaterBridge";

// AI: pure computations live in `./conformance`; re-exported for the panel and
// the scanner, which historically imported them from this module.
export { computeReconformProps, computeTemplateConformance } from "./conformance";
export type { ReconformMode } from "./conformance";

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

/**
 * AI: D1 — how long to wait before inspecting a newly created file.
 *
 * Obsidian writes an empty file first and the creator may fill it right after
 * (Templater, "new note from template", another plugin). 600 ms leaves room for
 * Templater's own on-create pass (300 ms plus parsing): at 300 ms the two
 * timers tied and Templater's late write could wipe the properties we had just
 * merged. The delay also leaves room for a Base row editor to write its initial
 * frontmatter.
 */
const AUTO_APPLY_SETTLE_MS = 600;

/** AI: Auto-apply timers still pending, cleared on unload (non-invasive). */
const pendingAutoApply = new Set<number>();

/** AI: Cancels pending auto-apply work; call from `onunload`. */
export function disposeTemplateAPI(): void {
	for (const timer of pendingAutoApply) window.clearTimeout(timer);
	pendingAutoApply.clear();
}

/**
 * AI: Auto-apply listener (D1).
 *
 * A newly created markdown file gets the nearest template's properties (and,
 * optionally, its body). The trigger is deliberately language-independent and
 * view-independent:
 *
 * 1. only `.md` files, and only once the workspace layout is ready — the
 *    initial vault indexing also emits `create` for existing files;
 * 2. a short settle delay, then a **blank body** test (after the frontmatter):
 *    synced/imported notes normally carry content and are skipped, while notes
 *    created from a Base (which may pre-fill frontmatter, never the body) pass;
 * 3. the blank test is repeated atomically inside `vault.process`, so a file
 *    the user started typing in during the delay is left untouched.
 *
 * No filename heuristics (`Untitled` is localized) and no "was it opened in a
 * view" requirement (Bases edit notes inline without a markdown view).
 */
export function registerTemplatezListener(): void {
	const plugin = getCtx();

	plugin.registerEvent(
		plugin.app.vault.on("create", file => {
			if (!(file instanceof TFile) || file.extension !== "md") return;
			if (getSettings().autoApply === "off") return;

			// Initial indexing must never template pre-existing files.
			if (!plugin.app.workspace.layoutReady) return;

			const timer = window.setTimeout(() => {
				pendingAutoApply.delete(timer);
				void autoApplyTemplateToNewFile(file).catch(() => undefined);
			}, AUTO_APPLY_SETTLE_MS);

			pendingAutoApply.add(timer);
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
 * AI: Ordered `Map` of the properties found in raw markdown content.
 *
 * Pure parser shared by `getFileProps` (disk) and by auto-apply, which needs to
 * inspect the exact string it is about to rewrite inside `vault.process`.
 * Only the YAML mapping root is read; any other shape yields an empty Map.
 */
export function parseFrontmatterProps(content: string): Map<string, any> {
	const map = new Map<string, any>();
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
 * Legge il frontmatter del file preservandone l'ordine esatto di lettura.
 *
 * AI: HARDENING — the parsed root is validated with `isMap` instead of the
 * previous duck-typed `'items' in items && Array.isArray(items.items)` check,
 * so non-mapping frontmatter (scalars/sequences) safely yields an empty Map.
 */
export async function getFileProps(file: TFile | undefined): Promise<Map<string, any>> {
	if (!file) return new Map();
	const content = await getCtx().app.vault.read(file);
	return parseFrontmatterProps(content);
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

	const rawContent = await getCtx().app.vault.read(file);
	const markdownBody = stripFrontmatter(rawContent).replace(/^\r?\n/, '');
	await getCtx().app.vault.modify(file, composeFileContent(newPropsMap, markdownBody));
}

/**
 * AI: Serializes a property map and a body into the canonical frontmatter form.
 *
 * Single place shared by `setFileProps` and by auto-apply's "Properties and
 * body" mode, so both emit exactly the same shape:
 * - an empty map removes the block entirely;
 * - otherwise `---` / yaml / `---` followed by one blank line and the body;
 * - `nullStr: ""` serializes a null value as an empty entry (`key:`) instead of
 *   the default explicit `key: null`, matching Obsidian's own empty property form;
 * - one leading blank line in the body is normalized away, since the canonical
 *   blank line after the block is added here.
 */
export function composeFileContent(props: Map<string, any>, body: string): string {
	const doc = new Doc();
	for (const [key, value] of props.entries()) {
		doc.set(key, value);
	}

	const markdownBody = body.replace(/^\r?\n/, '');
	return props.size > 0
		? `---\n${doc.toString({ nullStr: "" })}---\n\n${markdownBody}`
		: markdownBody;
}

/**
 * AI: True when the file has no markdown body after its frontmatter block.
 *
 * This is the auto-apply gate: a note that already contains text (typed by the
 * user, synced, or produced by Templater) is never touched, while a Base row
 * that only carries frontmatter still counts as "new".
 */
function hasEmptyBody(content: string): boolean {
	return stripFrontmatter(content).trim() === "";
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
 * AI: Applies one reconform phase to a file on disk.
 *
 * Returns `true` only when the file actually changed, so the caller can decide
 * whether to refresh the panel (and whether to push a Back snapshot).
 */
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

/**
 * AI: Optional Templater step of auto-apply's "Properties and body" mode.
 *
 * Same contract as `resolveTemplaterExpressions`: only notes, only when the
 * setting is on, feature-detected, and raw text on any failure. Templates never
 * reach this function (the target is checked first), so their body stays a
 * literal source even when a parent body is inherited.
 */
async function resolveAutoApplyBody(file: TFile, body: string): Promise<string> {
	if (!getSettings().evaluateTemplaterInNotes) return body;
	if (isTemplateFile(file)) return body;

	const app = getCtx().app;
	if (!isTemplaterAvailable(app)) return body;
	if (!hasTemplaterSyntax(body)) return body;

	const rendered = await evaluateTemplaterContent(app, body, file);
	return rendered ?? body;
}

/**
 * AI: Applies the nearest template to a newly created file (D1).
 *
 * Two gates protect the user's content:
 * 1. the body must still be empty right after the settle delay;
 * 2. the same test runs again **inside** `vault.process`, atomically with the
 *    write, so typing during the delay cancels the action.
 *
 * Frontmatter is always merged with `add-missing` semantics (existing values
 * win), because even a "new" file may already carry properties (e.g. a Base
 * row). The body is only touched in `full` mode, and only because it is blank.
 *
 * Templates are handled exactly like notes: a new nested `!Template.md`
 * inherits its parent's properties and, in `full`, its body. Templater is
 * skipped for them, so inherited `<% … %>` expressions stay raw.
 */
async function autoApplyTemplateToNewFile(file: TFile): Promise<void> {
	const mode = getSettings().autoApply;
	if (mode === "off") return;

	const app = getCtx().app;
	const templateFile = getTemplateOfFile(file);
	if (!templateFile) return;

	let content: string;
	try {
		content = await app.vault.read(file);
	} catch {
		// Deleted or moved while waiting for the settle delay.
		return;
	}
	if (!hasEmptyBody(content)) return;

	const templateContent = await app.vault.read(templateFile);
	const templateProps = parseFrontmatterProps(templateContent);

	// Evaluate only the template side: current values always win in the merge,
	// so they must not be rendered or replaced.
	const resolvedProps = await resolveTemplaterExpressions(file, templateProps);
	const body = mode === "full"
		? await resolveAutoApplyBody(file, stripFrontmatter(templateContent))
		: null;

	await app.vault.process(file, data => {
		if (!hasEmptyBody(data)) return data;

		const currentProps = parseFrontmatterProps(data);
		const nextProps = mergeSecondOnFirstMap(resolvedProps, currentProps, true);

		// A full apply with no template body is just a property merge: skip the
		// write when neither side changes.
		if (areMapsEqual(currentProps, nextProps) && (mode !== "full" || !body)) return data;

		// The body is blank here by definition; `full` replaces it with the
		// template body, `properties` keeps whatever is there (nothing).
		return composeFileContent(nextProps, mode === "full" ? body ?? "" : stripFrontmatter(data));
	});
}

/**
 * AI: Template-vs-parent conformance now lives in `./conformance`; the disk
 * wrapper stays here because it resolves the parent template.
 */
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
