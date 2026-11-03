import { App, Notice } from "obsidian";

/**
 * AI: Per-device, per-vault consent for the Templater bridge (feature G).
 *
 * Role in the architecture:
 * The bridge is the only feature that executes template code, so its permission
 * must not travel with the vault. `data.json` is synced; `loadLocalStorage` /
 * `saveLocalStorage` are vault-specific values of the device, so this module is
 * the only place that reads and writes the consent.
 *
 * Deliberate constraints:
 * - **No cache.** Templater reads its own local settings on every call; doing
 *   the same avoids invalidation bugs between windows.
 * - **`stored === true`.** The value is validated, never trusted through a
 *   cast: anything else (missing key, old data, corrupted storage) means off.
 * - **Storage failure = off.** Every access is wrapped; a platform without
 *   local storage simply keeps the bridge disabled.
 * - No `window.localStorage` fallback: the API has been public since 1.8.7 and
 *   the plugin floor is 1.13.0.
 */

/** AI: Vault-scoped key of the consent flag. Absent = disabled. */
const FLAG_KEY = "cascade-templates:evaluate-templater-in-notes";

/** AI: Vault-scoped marker so the update Notice is shown once per device. */
const NOTICE_KEY = "cascade-templates:templater-notice-shown";

/**
 * AI: True only when this device/vault has an explicit, stored consent.
 * Called once per write operation by the two resolution paths, which is why
 * there is no cache: the value can change from another window or tab.
 */
export function isTemplaterEvaluationEnabled(app: App): boolean {
	try {
		return app.loadLocalStorage(FLAG_KEY) === true;
	} catch {
		return false;
	}
}

/**
 * AI: Stores (or clears) the consent for this device/vault. A failed write
 * leaves the bridge disabled, which is the safe direction.
 */
export function setTemplaterEvaluationEnabled(app: App, enabled: boolean): void {
	try {
		app.saveLocalStorage(FLAG_KEY, enabled);
	} catch {
		// Storage unavailable: the in-memory caller may still think it succeeded,
		// but the next read returns false, so nothing dangerous runs.
	}
}

/**
 * AI: One-time Notice after the update that made the bridge opt-in.
 *
 * The previous default was ON and lived in the synced `data.json`, so the new
 * default OFF must not happen silently. The marker is written **before** the
 * Notice so a reload cannot repeat it; if storage is unavailable the Notice is
 * skipped rather than shown on every startup.
 */
export function maybeShowTemplaterNotice(app: App): void {
	try {
		if (app.loadLocalStorage(NOTICE_KEY) === true) return;
		app.saveLocalStorage(NOTICE_KEY, true);
	} catch {
		return;
	}

	new Notice(
		"Cascade Templates: Templater evaluation in notes is now opt-in and stored per device. " +
		"Enable \"Templater bridge\" in the plugin settings if you want expressions evaluated.",
		10000
	);
}
