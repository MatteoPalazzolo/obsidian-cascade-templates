import { Plugin, PluginSettingTab, type Setting, TAbstractFile } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { DEFAULT_TEMPLATE_BASENAME, TEMPLATE_FILE_EXTENSION } from "./conts";
import { evaluateTemplaterContent, getTemplaterVersion, isTemplaterAvailable } from "./core/templaterBridge";

/**
 * AI: Settings model, persistence and accessors.
 *
 * Role in the architecture:
 * Single source of truth for everything the user can configure. The values are
 * needed **synchronously** all over the code base (template lookup, scanner,
 * metadata panel), so `initSettings(plugin)` loads them once in `onload` and
 * keeps a module-level copy. Every write goes through `updateSettings`, which
 * persists to `data.json` and notifies the subscribers (D3), so nothing has to
 * poll `loadData` again.
 */

/**
 * AI: What happens to a newly created markdown file (D1 / auto-apply).
 *
 * - `off`        → never touch new files.
 * - `properties` → merge the missing properties of the nearest template
 *                   (`add-missing`), leaving the body untouched.
 * - `full`       → also copy the template body (frontmatter still merged, so
 *                   values already on the file win).
 *
 * The mode is uniform for notes and templates: a new nested `!Template.md`
 * inherits properties (always) and body (in `full`), which is the "template
 * inheritance" use case. Templater is only ever applied to notes.
 */
export type AutoApplyMode = "off" | "properties" | "full";

/**
 * AI: How much of the metadata toolbar is shown (D1).
 *
 * - `always`          → status + reconform + Back on every markdown view, with
 *                        the neutral/disabled state when no template applies.
 * - `onlyWithTemplate` → the toolbar is hidden when there is nothing to compare
 *                        against, keeping notes outside the cascade clean.
 */
export type PanelVisibility = "always" | "onlyWithTemplate";

/**
 * AI: Which file kinds the vault scanner visits (Session E).
 *
 * - `notes`     → regular notes compared to their nearest template.
 * - `templates` → `!Template.md` files compared to their parent template.
 */
export interface ScannerTargets {
	notes: boolean;
	templates: boolean;
}

/** AI: User-configurable behaviour of the plugin. */
export interface CascadeTemplatesSettings {
	/**
	 * AI: Base name of the folder template file, WITHOUT extension
	 * (`!Template` → `!Template.md`). Stored without extension so the user never
	 * has to type `.md`; a trailing `.md` is tolerated and stripped.
	 */
	templateBasename: string;

	/**
	 * AI: When true, reconforming a **note** evaluates `<% … %>` values coming
	 * from the template through Templater (Sessione G). Templates are never
	 * evaluated. Default off: without it the raw value is copied verbatim.
	 */
	evaluateTemplaterInNotes: boolean;

	/** AI: Behaviour on new files (D1); see `AutoApplyMode`. */
	autoApply: AutoApplyMode;

	/** AI: Visibility of the injected toolbar when no template applies (D1). */
	panelVisibility: PanelVisibility;

	/**
	 * AI: Folders skipped by the vault scanner (E4). Stored as normalized vault
	 * paths (no leading/trailing slash); a file is skipped when its path is the
	 * folder itself or starts with `folder + "/"`.
	 */
	scannerExcludeFolders: string[];

	/** AI: File kinds visited by the vault scanner (E4). */
	scannerTargets: ScannerTargets;
}

/** AI: Fallbacks applied on top of whatever `data.json` contains. */
export const DEFAULT_SETTINGS: CascadeTemplatesSettings = {
	templateBasename: DEFAULT_TEMPLATE_BASENAME,
	evaluateTemplaterInNotes: true,
	autoApply: "full",
	panelVisibility: "always",
	scannerExcludeFolders: [],
	scannerTargets: { notes: true, templates: true },
};

/** AI: Plugin handle, needed to load/save `data.json`. */
let plugin: Plugin | undefined;

/** AI: Current settings, always fully populated (defaults + stored data). */
let settings: CascadeTemplatesSettings = { ...DEFAULT_SETTINGS };

/** AI: Subscribers notified after every successful write (D3). */
const listeners = new Set<(settings: CascadeTemplatesSettings) => void>();

/**
 * AI: Loads the persisted settings. Must be awaited at the very beginning of
 * `onload`, before anything calls `getTemplateFilename()`.
 */
export async function initSettings(host: Plugin): Promise<void> {
	plugin = host;
	const stored = (await host.loadData()) as Partial<CascadeTemplatesSettings> | null;
	settings = normalizeSettings(stored);
}

/**
 * AI: Merges stored data with the defaults and discards values that are no
 * longer valid (e.g. a corrupted `data.json`), so the rest of the code can
 * always switch on the unions above without extra guards.
 */
function normalizeSettings(stored: Partial<CascadeTemplatesSettings> | null): CascadeTemplatesSettings {
	const merged = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };

	if (merged.autoApply !== "off" && merged.autoApply !== "properties" && merged.autoApply !== "full") {
		merged.autoApply = DEFAULT_SETTINGS.autoApply;
	}
	if (merged.panelVisibility !== "always" && merged.panelVisibility !== "onlyWithTemplate") {
		merged.panelVisibility = DEFAULT_SETTINGS.panelVisibility;
	}

	merged.scannerExcludeFolders = normalizeFolders(merged.scannerExcludeFolders);

	const targets = merged.scannerTargets;
	merged.scannerTargets = {
		notes: targets?.notes !== false,
		templates: targets?.templates !== false,
	};

	return merged;
}

/**
 * AI: Normalizes a folder list: trims entries, converts backslashes, strips
 * leading/trailing slashes and drops empty/duplicate values. Used both when
 * loading `data.json` and when reading the settings textarea (E4).
 */
export function normalizeFolders(folders: unknown): string[] {
	if (!Array.isArray(folders)) return [];

	const normalized = new Set<string>();
	for (const entry of folders) {
		if (typeof entry !== "string") continue;
		const path = entry.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
		if (path) normalized.add(path);
	}
	return [...normalized];
}

/**
 * AI: Parses the scanner exclusion textarea (one folder per line).
 * Exposed so the settings tab and `normalizeFolders` share the same rules.
 */
export function parseFolderList(value: string): string[] {
	return normalizeFolders(value.split(/\r?\n/));
}

/**
 * AI: True when the scanner must skip `path` because it lives in one of the
 * excluded folders (E4). Case-insensitive so Windows/mobile behave the same.
 */
export function isScannerExcluded(path: string): boolean {
	const normalized = path.toLowerCase();
	return settings.scannerExcludeFolders.some(folder => {
		const prefix = folder.toLowerCase();
		return normalized === prefix || normalized.startsWith(prefix + "/");
	});
}

/** AI: Read-only view of the current settings. */
export function getSettings(): Readonly<CascadeTemplatesSettings> {
	return settings;
}

/** AI: Merges a patch, persists it and notifies the listeners. */
export async function updateSettings(patch: Partial<CascadeTemplatesSettings>): Promise<void> {
	settings = { ...settings, ...patch };
	await plugin?.saveData(settings);
	for (const listener of [...listeners]) listener(settings);
}

/** AI: Subscribes to settings changes; returns the unsubscribe function. */
export function onSettingsChange(listener: (settings: CascadeTemplatesSettings) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * AI: Normalized base name: trimmed, without extension, never empty.
 * Tolerates the user typing `!Template.md` in the settings.
 */
export function getTemplateBasename(): string {
	const raw = settings.templateBasename?.trim();
	if (!raw) return DEFAULT_TEMPLATE_BASENAME;
	return raw.replace(/\.md$/i, "");
}

/** AI: Actual template file name, extension included (`!Template.md`). */
export function getTemplateFilename(): string {
	return `${getTemplateBasename()}.${TEMPLATE_FILE_EXTENSION}`;
}

/**
 * AI: True when the given file is a template file.
 * Shared by the metadata panel, the scanner and the Templater bridge so the
 * "is this a template?" question has exactly one answer.
 */
export function isTemplateFile(file: TAbstractFile | undefined | null): boolean {
	return !!file && file.name === getTemplateFilename();
}

/**
 * AI: Settings tab (Settings → Community plugins → Cascade Templates).
 *
 * The tab is **declarative** (Obsidian 1.13+): it describes its rows through
 * `getSettingDefinitions()` instead of building them with `new Setting(...)`.
 * That is what makes every named row show up in Obsidian's global settings
 * search, and it is the only implementation we keep — there is no `display()`
 * fallback, because `minAppVersion` is 1.13.0.
 *
 * Our settings live in a module-level store, not in `this.plugin.settings`, so
 * the `getControlValue` / `setControlValue` pair is overridden to read and write
 * through `getSettings()` / `updateSettings()`. `updateSettings` is also the
 * persistence step: overriding the setter replaces Obsidian's automatic
 * `saveData()`, and it still notifies the panels (D3).
 *
 * The row order follows the mental model: what a template is, what new files
 * inherit, then the optional Templater bridge (toggle + test), then the panel.
 */
export class CascadeTemplatesSettingTab extends PluginSettingTab {
	constructor(host: Plugin) {
		super(host.app, host);
	}

	/**
	 * AI: Declarative description of the tab.
	 *
	 * Called on every `update()` and once when the tab is registered for search
	 * indexing, so it must stay cheap: no I/O and no Templater probe. The probe
	 * belongs to the bridge-test `render`, which only runs when the row is
	 * actually drawn.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const templaterAvailable = isTemplaterAvailable(this.app);

		return [
			{
				name: "Template file name",
				desc: `Base name of the folder template file, without extension. Default: ${DEFAULT_TEMPLATE_BASENAME}.`,
				control: {
					type: "text",
					key: "templateBasename",
					placeholder: DEFAULT_TEMPLATE_BASENAME,
				},
			},
			{
				name: "Apply the template to new files",
				desc: "What a new file receives from its reference template; existing properties are always kept.",
				control: {
					type: "dropdown",
					key: "autoApply",
					options: {
						off: "Off",
						properties: "Properties only",
						full: "Properties and body",
					},
				},
			},
			{
				name: "Evaluate template expressions in notes",
				desc: templaterAvailable
					? `Evaluate "<% … %>" values coming from templates when writing to notes; never applied to template files.`
					: "Templater is not installed or not enabled, so expressions are copied verbatim into notes.",
				control: {
					type: "toggle",
					key: "evaluateTemplaterInNotes",
					// AI: Re-evaluated on every DOM refresh; the feature is useless
					// without the Templater plugin, so the toggle stays unavailable.
					disabled: () => !isTemplaterAvailable(this.app),
				},
			},
			{
				name: "Templater bridge test",
				desc: "Check that Templater can evaluate an expression in the active note.",
				// AI: The only imperative row: a button plus a description that the
				// click rewrites locally. The result is not a setting and is never
				// persisted. G will extend this row with the probe states.
				render: (setting: Setting) => {
					setting.addButton(button => button
						.setButtonText("Test")
						.onClick(async () => {
							const target = this.app.workspace.getActiveFile();
							if (!target) {
								setting.setDesc("Open a note before testing");
								return;
							}

							const version = getTemplaterVersion(this.app);
							const detected = version ? `Templater detected v${version}` : "Templater detected";

							if (!isTemplaterAvailable(this.app)) {
								setting.setDesc("Templater not detected");
								return;
							}

							const rendered = await evaluateTemplaterContent(this.app, "<% 1 + 1 %>", target);
							setting.setDesc(rendered === null
								? `${detected} — bridge failed`
								: `${detected} — bridge established`);
						}));
				},
			},
			{
				name: "Show the properties toolbar",
				desc: "Whether the toolbar is shown on every note or only when a template applies.",
				control: {
					type: "dropdown",
					key: "panelVisibility",
					options: {
						always: "Always",
						onlyWithTemplate: "Only when a template applies",
					},
				},
			},
		];
	}

	/**
	 * AI: Reads a `control` value from our module-level store. Obsidian calls
	 * this on every render of the row.
	 */
	getControlValue(key: string): unknown {
		return getSettings()[key as keyof CascadeTemplatesSettings];
	}

	/**
	 * AI: Writes a `control` value through the normal settings path, so
	 * persistence (`data.json`) and the panel refresh (D3) stay in one place.
	 * Overriding this also replaces Obsidian's automatic `saveData()`.
	 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		await updateSettings({ [key]: value });
	}
}
