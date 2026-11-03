import { Plugin, PluginSettingTab, type Setting, TAbstractFile, TFile } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { DEFAULT_TEMPLATE_BASENAME, TEMPLATE_FILE_EXTENSION } from "./conts";
import { evaluateTemplaterContent, getTemplaterVersion, isTemplaterAvailable } from "./core/templaterBridge";
import {
	isTemplaterEvaluationEnabled,
	setTemplaterEvaluationEnabled,
} from "./core/templaterConsent";
import { confirmTemplaterConsent } from "./features/TemplaterConsentModal";

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

/** AI: Notifies the subscribers with the current settings, without writing. */
function notifySettingsListeners(): void {
	for (const listener of [...listeners]) listener(settings);
}

/** AI: Merges a patch, persists it and notifies the listeners. */
export async function updateSettings(patch: Partial<CascadeTemplatesSettings>): Promise<void> {
	settings = { ...settings, ...patch };
	await plugin?.saveData(settings);
	notifySettingsListeners();
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
 * AI: Control key of the Templater toggle. The value does **not** come from
 * `data.json` any more (G): it is read from the vault-specific local storage
 * through `getControlValue` / `setControlValue`, so it can never travel with a
 * synced vault. Keeping the old key name only identifies the row.
 */
const BRIDGE_CONTROL_KEY = "evaluateTemplaterInNotes";

/**
 * AI: Result of the capability probe, cached for the plugin session only.
 *
 * - `idle`        → never probed in this session.
 * - `checking`    → probe in flight; toggle disabled.
 * - `ok`          → Templater evaluated the probe expression; toggle enabled.
 * - `failed`      → Templater is there but evaluation failed.
 * - `no-target`   → no active/first markdown note to run the probe against.
 * - `unavailable` → Templater plugin not installed/enabled; toggle disabled.
 *
 * The cache is invalidated when `getTemplaterVersion()` changes, which is how
 * enabling/disabling or updating Templater gets picked up without polling.
 * It lives at module level so reopening the settings tab does not re-probe.
 */
type BridgeProbeState = "idle" | "checking" | "ok" | "failed" | "no-target" | "unavailable";

let bridgeProbeState: BridgeProbeState = "idle";
let bridgeProbeVersion: string | null = null;
let bridgeProbeInFlight = false;

/**
 * AI: Description of the Templater toggle. The per-device note is always
 * visible (it is part of the informed consent), and turns into a warning once
 * the bridge is enabled so the user cannot forget the other devices.
 */
function bridgeToggleDescription(enabled: boolean): DocumentFragment {
	return createFragment(fragment => {
		fragment.append(
			"Requires the Templater community plugin (v2.x or later); without it this option stays disabled. " +
			"When a note is reconformed or created with \"Properties and body\", evaluate \"<% … %>\" values " +
			"coming from the template. Never applied to template files."
		);
		fragment.createEl("br");
		const note = fragment.createSpan({
			text:
				"This setting is stored on this device for this vault only and must be enabled separately " +
				"on each device.",
		});
		if (enabled) note.addClass("mod-warning");
	});
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
				desc: "What a new file receives from its reference template; existing properties are always kept. The folder menu's template action always inherits properties.",
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
				name: "Templater bridge",
				desc: bridgeToggleDescription(isTemplaterEvaluationEnabled(this.app)),
				control: {
					type: "toggle",
					key: BRIDGE_CONTROL_KEY,
					// AI: Enabled only after the capability probe passed. The
					// predicate is re-evaluated on every DOM refresh, so the probe
					// result reaches the row without a full re-render.
					disabled: () => !this.bridgeReady(),
				},
			},
			{
				name: "Templater bridge test",
				desc: "Check that Templater can evaluate an expression in this vault.",
				// AI: The only imperative row. The probe result is not a setting and
				// is never persisted; the description changes with the probe state.
				render: (setting: Setting) => this.renderBridgeStatus(setting),
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
	 * AI: Reads a `control` value. The Templater toggle bypasses `data.json`
	 * and reads the per-device consent from local storage (G); every other row
	 * reads the module-level settings store. Obsidian calls this on every
	 * render of the row.
	 */
	getControlValue(key: string): unknown {
		if (key === BRIDGE_CONTROL_KEY) return isTemplaterEvaluationEnabled(this.app);
		return getSettings()[key as keyof CascadeTemplatesSettings];
	}

	/**
	 * AI: Writes a `control` value. The Templater toggle goes through the
	 * consent modal first and writes local storage only after confirmation;
	 * every other row keeps the normal settings path (persistence + listeners).
	 * Overriding this also replaces Obsidian's automatic `saveData()`.
	 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === BRIDGE_CONTROL_KEY) {
			await this.setBridgeEnabled(value === true);
			return;
		}
		await updateSettings({ [key]: value });
	}

	/**
	 * AI: True when the bridge can be enabled: Templater is available and the
	 * probe succeeded. Used both as the toggle's `disabled` predicate and as a
	 * guard in `setBridgeEnabled`.
	 */
	private bridgeReady(): boolean {
		return isTemplaterAvailable(this.app) && bridgeProbeState === "ok";
	}

	/**
	 * AI: Applies a toggle change. Enabling always asks for consent first and
	 * writes nothing when the modal is dismissed; disabling is immediate. The
	 * `update()` calls re-read storage so a cancelled modal visually flips the
	 * toggle back and the per-device warning follows the real value.
	 */
	private async setBridgeEnabled(enabled: boolean): Promise<void> {
		if (!enabled) {
			setTemplaterEvaluationEnabled(this.app, false);
			notifySettingsListeners();
			this.update();
			return;
		}

		if (!this.bridgeReady() || !(await confirmTemplaterConsent(this.app))) {
			this.update();
			return;
		}

		setTemplaterEvaluationEnabled(this.app, true);
		// Consent is not part of `data.json`, so `updateSettings` cannot fan it
		// out: notify the panels explicitly so the reconform tooltip follows.
		notifySettingsListeners();
		this.update();
	}

	/**
	 * AI: Draws the probe status line and, when a result exists, the
	 * `Test again` action. Called from the row's `render`, i.e. only when the
	 * settings tab is actually displayed: this is what keeps the probe out of
	 * the search-index registration path.
	 */
	private renderBridgeStatus(setting: Setting): void {
		if (!isTemplaterAvailable(this.app)) {
			bridgeProbeState = "unavailable";
			setting.setDesc("Templater not detected — option unavailable");
			return;
		}

		this.requestProbe(false);

		if (bridgeProbeState === "idle" || bridgeProbeState === "checking") {
			setting.setDesc("Checking…");
			return;
		}

		if (bridgeProbeState === "no-target") {
			setting.setDesc("Create a note first to verify the bridge");
		} else if (bridgeProbeState === "failed") {
			setting.setDesc(`${this.detectedLabel()} — bridge verification failed`);
		} else {
			setting.setDesc(`${this.detectedLabel()} — bridge verified`);
		}

		setting.addButton(button => button
			.setButtonText("Test again")
			.onClick(() => {
				this.requestProbe(true);
				// Safe here: this is a click handler, not a row render.
				this.update();
			}));
	}

	/**
	 * AI: Starts the probe when needed. `force` comes from `Test again`; the
	 * automatic path runs once per plugin session and reruns when Templater's
	 * version changes. The actual evaluation is deferred so `update()` never
	 * rebuilds the definitions from inside a row render.
	 */
	private requestProbe(force: boolean): void {
		if (bridgeProbeInFlight) return;

		if (!isTemplaterAvailable(this.app)) {
			bridgeProbeState = "unavailable";
			return;
		}

		const version = getTemplaterVersion(this.app);
		// Re-probe when Templater's version changed, and always after an earlier
		// "unavailable" (Templater may have been enabled without changing a
		// version we could read).
		const alreadyValid = bridgeProbeState !== "idle"
			&& bridgeProbeState !== "unavailable"
			&& bridgeProbeVersion === version;
		if (!force && alreadyValid) return;

		bridgeProbeState = "checking";
		bridgeProbeVersion = version;
		bridgeProbeInFlight = true;

		window.setTimeout(() => {
			void this.runProbe();
		}, 0);
	}

	/**
	 * AI: Evaluates a trivial expression through Templater. The target is the
	 * active note when it is markdown, otherwise the first markdown file; a
	 * vault without notes yields the explicit `no-target` state instead of a
	 * failure. The probe never writes and never touches user content.
	 */
	private async runProbe(): Promise<void> {
		try {
			const target = this.probeTarget();
			if (!target) {
				bridgeProbeState = "no-target";
				return;
			}

			if (!isTemplaterAvailable(this.app)) {
				bridgeProbeState = "unavailable";
				return;
			}

			const rendered = await evaluateTemplaterContent(this.app, "<% 1 + 1 %>", target);
			bridgeProbeState = rendered === null ? "failed" : "ok";
		} finally {
			bridgeProbeInFlight = false;
			this.update();
		}
	}

	/** AI: Active markdown note, else the first markdown file, else `null`. */
	private probeTarget(): TFile | null {
		const active = this.app.workspace.getActiveFile();
		if (active?.extension === "md") return active;
		return this.app.vault.getMarkdownFiles()[0] ?? null;
	}

	/** AI: `Templater detected vX`, or a version-less fallback. */
	private detectedLabel(): string {
		const version = getTemplaterVersion(this.app);
		return version ? `Templater detected v${version}` : "Templater detected";
	}
}
