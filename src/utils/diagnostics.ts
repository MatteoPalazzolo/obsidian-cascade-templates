import { apiVersion } from "obsidian";

/**
 * AI: Runtime diagnostics for fragile, undocumented surfaces.
 *
 * Role in the architecture:
 * Some features rely on Obsidian behaviour that is not part of the public API
 * (internal view methods, the metadata panel DOM, other plugins' internals).
 * Those calls are always feature-detected and degrade gracefully, but graceful
 * degradation used to be SILENT: when a future Obsidian release removed a
 * method, the related action simply stopped working with no trace.
 *
 * This module turns that silence into a single, actionable console warning per
 * capability. Design constraints:
 *
 * - WARN ONLY ON ABSENCE. A successful probe/log adds no information: the call
 *   itself already succeeded. Verbose success logging would only add noise and,
 *   in production, train users to ignore our output.
 * - ONCE PER SESSION, keyed by capability. A click is not a place to spam the
 *   console; one line is enough to be copied into an issue.
 * - NO VAULT DATA. Warnings carry capability names and versions, never file
 *   paths or frontmatter: diagnostics must not leak user content.
 * - PRODUCTION TOO. Unlike a dev-only log, a missing capability is a real
 *   defect users can hit; it is worth one clear line in their console even in
 *   the released build. Verbose/dev-only reports belong to a future dedicated
 *   diagnostics mode, not here.
 *
 * Use it only when the absence is unambiguous and actionable. Some internal
 * assumptions are NOT suitable for probing because their absence is legitimate
 * (e.g. the metadata panel not being mounted, or Obsidian not injecting the
 * synthetic `position` key): warning there would be a false positive and would
 * erode trust in every other warning.
 */

/** AI: Capabilities already reported, so each defect is logged once per session. */
const warned = new Set<string>();

/**
 * AI: Logs `message` once per distinct `key`, as a single plain-text line that
 * is easy to copy into a bug report. The context dictionary is flattened into
 * `key: value` pairs instead of being passed to the console as an object, so
 * collapsed console entries can never hide the diagnostic details.
 *
 * The running Obsidian version is always included; empty context values are
 * skipped (e.g. the plugin version before `init`).
 *
 * The key identifies the CAPABILITY (not the call site), so a missing method is
 * reported once even if several views/actions use it. Extra context should stay
 * small and non-sensitive: plugin version, capability name, an error message.
 */
export function warnOnce(key: string, message: string, context?: Record<string, unknown>): void {
	if (warned.has(key)) return;
	warned.add(key);

	const details = [`obsidian: ${apiVersion}`];
	for (const [name, value] of Object.entries(context ?? {})) {
		if (value === undefined || value === null || value === "") continue;
		details.push(`${name}: ${toText(value)}`);
	}

	console.warn(`[cascade-templates] ${message} · ${details.join(" · ")}`);
}

/** AI: Minimal value renderer for the diagnostic line (no multi-line output). */
function toText(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
