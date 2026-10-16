import { getIcon, setIcon } from "obsidian";

/**
 * AI: Icon rendering that tolerates Lucide version drift.
 *
 * Role in the architecture:
 * `setIcon` resolves a name against the Lucide set bundled in the RUNNING
 * Obsidian, which changes between releases. An unknown name renders nothing,
 * silently. Since the project declares a `minAppVersion` and must keep working
 * on every newer release too, all icon rendering goes through here: a name that
 * does not exist degrades to a guaranteed fallback instead of an empty element.
 */

/** AI: last-resort icon, part of the oldest and most stable Lucide subset. */
export const FALLBACK_ICON = "circle";

/**
 * AI: Returns `name` when it exists in the running Obsidian, otherwise the
 * fallback. Use it where the name must be chosen BEFORE rendering (e.g. the
 * ribbon icon, whose element is created by Obsidian itself).
 */
export function resolvableIcon(name: string, fallback: string = FALLBACK_ICON): string {
	return getIcon(name) ? name : fallback;
}

/** AI: `setIcon` with the same safety net, for elements we own. */
export function setIconSafe(el: HTMLElement, name: string, fallback: string = FALLBACK_ICON): void {
	setIcon(el, resolvableIcon(name, fallback));
}
