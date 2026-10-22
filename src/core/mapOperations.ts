
export function mergeSecondOnFirstMap(
	templateMap: Map<string, unknown>,
	fileMap: Map<string, unknown>,
	tail = true
): Map<string, unknown> {
	const merged = new Map<string, unknown>();

	// 1. Inserisce prima le proprietà del TEMPLATE (mantenendo il loro ordine)
	for (const [key, templateValue] of templateMap.entries()) {
		if (fileMap.has(key)) {
			// Se il file ha un valore per questa chiave, usa quello del file
			merged.set(key, fileMap.get(key));
		} else {
			// Altrimenti usa il valore di default del template
			merged.set(key, templateValue);
		}
	}

	if (!tail)
		return merged;

	// 2. Accoda in fondo le proprietà del FILE che NON esistono nel template
	for (const [key, fileValue] of fileMap.entries()) {
		if (!merged.has(key)) {
			merged.set(key, fileValue);
		}
	}

	return merged;
}

export type MapConformanceStatus = 'ok' | 'extra' | 'missing';

export function computeMapConformance(
	currentProps: Map<string, unknown>,
	templateProps: Map<string, unknown>
): MapConformanceStatus {
	const currentKeys = new Set(currentProps.keys());
	const templateKeys = new Set(templateProps.keys());

	const hasMissing = [...templateKeys].some(k => !currentKeys.has(k));
	if (hasMissing) return 'missing';

	const hasExtra = [...currentKeys].some(k => !templateKeys.has(k));
	if (hasExtra) return 'extra';

	return 'ok';
}

/**
 * AI: Structural, order-sensitive equality between two property maps.
 *
 * Role in the architecture:
 * Used by `reconformFile` to decide whether an action actually changed the
 * frontmatter. Key order is part of the comparison because the YAML output
 * preserves it, so a pure reordering counts as a change worth writing.
 * Values are compared by identity first, then by JSON representation so nested
 * arrays/objects (e.g. list-valued properties) are handled correctly.
 */
export function areMapsEqual(first: Map<string, unknown>, second: Map<string, unknown>): boolean {
	if (first.size !== second.size) return false;

	const firstEntries = [...first.entries()];
	const secondEntries = [...second.entries()];

	for (let i = 0; i < firstEntries.length; i++) {
		// Both arrays have `first.size` entries (checked above); the guard only
		// satisfies `noUncheckedIndexedAccess`.
		const firstEntry = firstEntries[i];
		const secondEntry = secondEntries[i];
		if (!firstEntry || !secondEntry) return false;

		const [firstKey, firstValue] = firstEntry;
		const [secondKey, secondValue] = secondEntry;

		if (firstKey !== secondKey) return false;
		if (!areValuesEqual(firstValue, secondValue)) return false;
	}

	return true;
}

/** AI: Best-effort deep value comparison, cheap for scalar frontmatter values. */
function areValuesEqual(first: unknown, second: unknown): boolean {
	if (first === second) return true;

	const areObjects = typeof first === 'object' && first !== null
		&& typeof second === 'object' && second !== null;

	return areObjects && JSON.stringify(first) === JSON.stringify(second);
}
