import { App, TFile } from "obsidian";

/**
 * AI: Optional bridge to the Templater community plugin (Sessione G).
 *
 * Role in the architecture:
 * Templates are the source of truth and keep their `<% … %>` expressions raw;
 * notes are instances and need concrete values. Templater only runs on file
 * **creation**, so a reconform/clear would otherwise write the literal
 * expression into the note and nobody would ever evaluate it. This module is
 * the **occasional and partial** bridge that fixes exactly that: it renders a
 * single value through Templater, on demand, only for notes.
 *
 * Deliberate constraints:
 * - No build-time dependency: Templater is looked up at runtime, so the plugin
 *   loads even when Templater is absent.
 * - No public API guarantee: `create_running_config`/`parse_template` are
 *   internal. Every call is feature-detected and wrapped, and any failure
 *   degrades to `null` so the caller keeps the raw value.
 * - Processes only the strings the caller passes: single frontmatter values
 *   during a reconform, or a template body during auto-apply. Never whole
 *   files, and never template files.
 */

/** AI: Plugin id as it appears in Obsidian's plugin registry. */
const TEMPLATER_PLUGIN_ID = "templater-obsidian";

/** AI: Default Templater delimiter; enough to tell "this is a script". */
const TEMPLATER_SYNTAX = /<%/;

/** AI: Script block marker (`<%* … %>`): the block runs JavaScript. */
const TEMPLATER_SCRIPT_SYNTAX = /<%\*/;

/**
 * AI: Run mode passed to Templater's running config. `2` is
 * `RunMode.OverwriteActiveFile`, the closest match to "process this note".
 * Templater does not export the enum, so the numeric value is used.
 */
const TEMPLATER_RUN_MODE_OVERWRITE_FILE = 2;

/** AI: Minimal structural view of the undocumented Templater API we rely on. */
interface TemplaterApi {
	create_running_config(templateFile: TFile | undefined, targetFile: TFile | undefined, runMode: number): unknown;
	parse_template(config: unknown, content: string): Promise<string>;
	/**
	 * AI: Templater's own guard set for files it is creating. Templater's
	 * on-create pass skips any path listed here; C uses it so the template we
	 * create is neither evaluated nor overwritten.
	 */
	files_with_pending_templates?: Set<string>;
}

/** AI: Shape of `app.plugins` (not part of the public Obsidian typings). */
interface PluginsHost {
	plugins?: {
		plugins?: Record<string, { templater?: TemplaterApi; manifest?: { version?: string } } | undefined>;
		manifests?: Record<string, { version?: string } | undefined>;
	};
}

/**
 * AI: True when `value` is a string containing Templater syntax, i.e. a value
 * that only makes sense after being evaluated.
 */
export function hasTemplaterSyntax(value: unknown): value is string {
	return typeof value === "string" && TEMPLATER_SYNTAX.test(value);
}

/**
 * AI: True when `value` contains a Templater script block (`<%* … %>`).
 *
 * Such blocks execute JavaScript with the plugin's privileges; the value is
 * still legitimate template syntax, so the bridge never blocks it. This helper
 * only powers the non-blocking warning in the reconform tooltip (G).
 */
export function hasScriptSyntax(value: unknown): value is string {
	return typeof value === "string" && TEMPLATER_SCRIPT_SYNTAX.test(value);
}

/**
 * AI: Returns Templater's API object when the plugin is installed, enabled and
 * exposes the methods we need; otherwise `null`.
 */
export function getTemplaterApi(app: App): TemplaterApi | null {
	const host = app as unknown as PluginsHost;
	const templater = host.plugins?.plugins?.[TEMPLATER_PLUGIN_ID]?.templater;

	if (!templater) return null;
	if (typeof templater.create_running_config !== "function") return null;
	if (typeof templater.parse_template !== "function") return null;

	return templater;
}

/** AI: True when Templater is available. */
export function isTemplaterAvailable(app: App): boolean {
	return getTemplaterApi(app) !== null;
}

/**
 * AI: How long a template created by the folder menu stays out of Templater's
 * on-create pass. Templater checks the guard at ~300 ms, so 1 s leaves margin.
 */
const PENDING_TEMPLATE_HOLD_MS = 1000;

/**
 * AI: C — registers `path` in Templater's `files_with_pending_templates` set
 * before the file is created.
 *
 * Returns a release function to call in `finally`: it removes the path after
 * ~1 s, so Templater's on-create pass skips the new template. When Templater
 * is absent the release is a no-op; when the set is missing (version mismatch)
 * creation still works and we only log in debug, with no timer fallback.
 */
export function holdTemplaterPendingTemplate(app: App, path: string): () => void {
	const templater = getTemplaterApi(app);
	if (!templater) return () => undefined;

	const pending = templater.files_with_pending_templates;
	if (!pending) {
		console.debug("[cascade-templates] Templater files_with_pending_templates not found");
		return () => undefined;
	}

	pending.add(path);
	return () => {
		window.setTimeout(() => pending.delete(path), PENDING_TEMPLATE_HOLD_MS);
	};
}

/**
 * AI: Version of the installed Templater plugin, or `null` when it is not
 * present. Uses the runtime plugin registry (not part of the public typings),
 * so it is only used for the status line in the settings tab.
 */
export function getTemplaterVersion(app: App): string | null {
	const host = app as unknown as PluginsHost;
	const version = host.plugins?.plugins?.[TEMPLATER_PLUGIN_ID]?.manifest?.version
		?? host.plugins?.manifests?.[TEMPLATER_PLUGIN_ID]?.version;
	return typeof version === "string" && version.length > 0 ? version : null;
}

/**
 * AI: Renders an arbitrary text block through Templater.
 *
 * Used for single frontmatter values, but also for a whole template body when
 * auto-apply runs in "Properties and body" mode: in both cases the caller is
 * responsible for only handing over content that belongs to a NOTE (template
 * files must always keep their expressions raw).
 *
 * Returns `null` on failure so the caller can fall back to the raw text.
 */
export async function evaluateTemplaterContent(app: App, source: string, targetFile: TFile): Promise<string | null> {
	const templater = getTemplaterApi(app);
	if (!templater) return null;

	try {
		const config = templater.create_running_config(undefined, targetFile, TEMPLATER_RUN_MODE_OVERWRITE_FILE);
		const rendered = await templater.parse_template(config, source);
		return typeof rendered === "string" ? rendered : null;
	} catch {
		return null;
	}
}

/**
 * AI: Renders a single value through Templater.
 *
 * Returns the rendered string, or `null` when Templater is unavailable or the
 * evaluation fails. The caller must fall back to the raw value in that case:
 * this function never throws, so a bad expression can never abort a reconform.
 *
 * Note: Templater functions such as `tp.system.prompt` will open their own UI;
 * that is the template author's responsibility.
 */
export async function evaluateTemplaterValue(app: App, source: string, targetFile: TFile): Promise<string | null> {
	return evaluateTemplaterContent(app, source, targetFile);
}
