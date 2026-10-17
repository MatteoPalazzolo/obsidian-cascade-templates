import { Plugin, PluginSettingTab, Setting, TAbstractFile } from "obsidian";
import { DEFAULT_TEMPLATE_BASENAME, TEMPLATE_FILE_EXTENSION } from "./conts";
import { isTemplaterAvailable } from "./core/templaterBridge";

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
	evaluateTemplaterInNotes: false,
	autoApply: "properties",
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
 * Fields write through `updateSettings`, so persistence and UI refresh are
 * handled by the same path as any other change.
 */
export class CascadeTemplatesSettingTab extends PluginSettingTab {
	constructor(host: Plugin) {
		super(host.app, host);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Template file name")
			.setDesc(
				`Base name (without extension) of the folder template file. ` +
				`Default: ${DEFAULT_TEMPLATE_BASENAME} → ${DEFAULT_TEMPLATE_BASENAME}.${TEMPLATE_FILE_EXTENSION}`
			)
			.addText(text => text
				.setPlaceholder(DEFAULT_TEMPLATE_BASENAME)
				.setValue(getSettings().templateBasename)
				.onChange(async value => {
					await updateSettings({ templateBasename: value });
				}));

		new Setting(containerEl)
			.setName("Apply the template to new files")
			.setDesc(
				`A file created inside Obsidian (note or ${getTemplateFilename()}) receives the nearest ` +
				`template's properties. "Properties and body" also copies the template body; existing ` +
				`properties are kept. Templates always inherit raw expressions; Templater evaluation ` +
				`only applies to notes.`
			)
			.addDropdown(dropdown => dropdown
				.addOption("off", "Off")
				.addOption("properties", "Properties only")
				.addOption("full", "Properties and body")
				.setValue(getSettings().autoApply)
				.onChange(async value => {
					await updateSettings({ autoApply: value as AutoApplyMode });
				}));

		const templaterAvailable = isTemplaterAvailable(this.app);
		const templaterDescription = templaterAvailable
			? [
				`When a note is reconformed or created with "Properties and body", evaluate "<% … %>"`,
				`values coming from ${getTemplateFilename()} through Templater.`,
				`Never applied to template files. Enable only if you trust your templates: "<%* … %>" runs code.`,
			].join(" ")
			: "Templater is not installed or enabled: template expressions are copied verbatim into notes.";

		new Setting(containerEl)
			.setName("Evaluate Templater scripts in notes")
			.setDesc(templaterDescription)
			.addToggle(toggle => toggle
				.setValue(getSettings().evaluateTemplaterInNotes)
				.setDisabled(!templaterAvailable)
				.onChange(async value => {
					await updateSettings({ evaluateTemplaterInNotes: value });
				}));

		new Setting(containerEl)
			.setName("Show the properties toolbar")
			.setDesc(
				`Whether the status icon, reconform and Back buttons are shown on every markdown view, ` +
				`or only when a template applies to the file.`
			)
			.addDropdown(dropdown => dropdown
				.addOption("always", "Always")
				.addOption("onlyWithTemplate", "Only when a template applies")
				.setValue(getSettings().panelVisibility)
				.onChange(async value => {
					await updateSettings({ panelVisibility: value as PanelVisibility });
				}));
	}
}
