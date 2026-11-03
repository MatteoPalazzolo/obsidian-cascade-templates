import { areValuesEqual } from "./mapOperations";

/**
 * AI: Frontmatter change records shared by the dashboard journal and by
 * `reconformFile`.
 *
 * Role in the architecture:
 * A property is either present with a value or explicitly removed. The journal
 * needs to distinguish "this key was not touched" from "this key was deleted by
 * Align", so removal is represented by the `REMOVED` sentinel instead of
 * `undefined` (which is also a legitimate YAML value).
 */

/** AI: Explicit "the key no longer exists" marker (removal is a state, not a value). */
export const REMOVED = Symbol("cascade-templates.removed");

/** AI: One key written by an operation, with its resulting value. */
export interface PropertyChange {
	key: string;
	/** New value, or the `REMOVED` sentinel when the key was deleted. */
	after: unknown;
}

/** AI: True when a change removes the key from the frontmatter. */
export function isRemoved(value: unknown): value is typeof REMOVED {
	return value === REMOVED;
}

/**
 * AI: Authoritative list of the keys changed between two frontmatter maps.
 *
 * Order is not treated as a property change: the journal only tracks values and
 * presence. A pure reordering is still a write, but it touches no key, so an
 * undo of that operation has nothing to restore (frontmatter order is not user
 * data in the same sense as a value).
 */
export function diffProps(
	before: Map<string, unknown>,
	after: Map<string, unknown>
): PropertyChange[] {
	const changes: PropertyChange[] = [];

	for (const [key, value] of after.entries()) {
		if (!before.has(key) || !areValuesEqual(before.get(key), value)) {
			changes.push({ key, after: value });
		}
	}

	for (const key of before.keys()) {
		if (!after.has(key)) changes.push({ key, after: REMOVED });
	}

	// A pure reordering is still a write: record every key so the operation
	// exists and can be consumed by an undo (the values themselves are equal).
	if (changes.length === 0) {
		const beforeKeys = [...before.keys()];
		const afterKeys = [...after.keys()];
		if (beforeKeys.some((key, index) => afterKeys[index] !== key)) {
			for (const [key, value] of after.entries()) changes.push({ key, after: value });
		}
	}

	return changes;
}

/**
 * AI: Applies a set of value/removal changes to a map, preserving the order of
 * the untouched keys and appending newly added keys in change order.
 */
export function applyPropertyChanges(
	current: Map<string, unknown>,
	changes: readonly PropertyChange[]
): Map<string, unknown> {
	const next = new Map(current);

	for (const change of changes) {
		if (isRemoved(change.after)) {
			next.delete(change.key);
		} else {
			next.set(change.key, change.after);
		}
	}

	return next;
}
