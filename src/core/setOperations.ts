/**
 * AI: Pure set helpers used across the template engine.
 *
 * Role in the architecture:
 * This module is the drop-in replacement for the TC39 Set methods
 * (`Set.prototype.intersection`, `union`, `difference`, `symmetricDifference`,
 * `isSubsetOf`, `isSupersetOf`). Those methods were previously declared through
 * the ambient augmentation in `types/set-methods.d.ts`, but they only exist on
 * recent JavaScript engines: relying on them crashes Obsidian on older mobile
 * WebViews (iOS/Android), where the plugin is expected to work since
 * `manifest.json` sets `isDesktopOnly: false`.
 *
 * Everything here is a pure function (no Obsidian/plugin context, no side
 * effects) and only uses ES6 iteration over `Set`, which is universally
 * available. Keeping it dependency-free also makes it trivially unit-testable.
 */

/** AI: Elements that are present in BOTH sets (A ∩ B). */
export function intersection<T>(a: Set<T>, b: Set<T>): Set<T> {
	const result = new Set<T>();
	for (const value of a) {
		if (b.has(value)) result.add(value);
	}
	return result;
}

/** AI: Elements that are present in AT LEAST ONE set (A ∪ B). */
export function union<T>(a: Set<T>, b: Set<T>): Set<T> {
	const result = new Set<T>(a);
	for (const value of b) result.add(value);
	return result;
}

/** AI: Elements of `a` that are NOT in `b` (A \ B). */
export function difference<T>(a: Set<T>, b: Set<T>): Set<T> {
	const result = new Set<T>();
	for (const value of a) {
		if (!b.has(value)) result.add(value);
	}
	return result;
}

/** AI: Elements present in exactly one of the two sets (A △ B). */
export function symmetricDifference<T>(a: Set<T>, b: Set<T>): Set<T> {
	const result = new Set<T>();
	for (const value of a) {
		if (!b.has(value)) result.add(value);
	}
	for (const value of b) {
		if (!a.has(value)) result.add(value);
	}
	return result;
}

/** AI: `true` when every element of `a` is contained in `b` (A ⊆ B). */
export function isSubsetOf<T>(a: Set<T>, b: Set<T>): boolean {
	for (const value of a) {
		if (!b.has(value)) return false;
	}
	return true;
}

/** AI: `true` when every element of `b` is contained in `a` (A ⊇ B). */
export function isSupersetOf<T>(a: Set<T>, b: Set<T>): boolean {
	return isSubsetOf(b, a);
}
