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
}

/** AI: Fallbacks applied on top of whatever `data.json` contains. */
export const DEFAULT_SETTINGS: CascadeTemplatesSettings = {
	templateBasename: DEFAULT_TEMPLATE_BASENAME,
	evaluateTemplaterInNotes: false,
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
	settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
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

		const templaterAvailable = isTemplaterAvailable(this.app);
		const templaterDescription = templaterAvailable
			? [
				`When a note is reconformed, evaluate "<% … %>" values coming from ${getTemplateFilename()} through Templater.`,
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
	}
}
