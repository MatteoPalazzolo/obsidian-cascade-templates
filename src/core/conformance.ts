import { difference, isSubsetOf } from "./setOperations";
import { mergeSecondOnFirstMap } from "./mapOperations";

/**
 * AI: Pure frontmatter conformance and reconform computations.
 *
 * Role in the architecture:
 * These functions decide what a note/template *should* look like, without
 * touching Obsidian: no vault, no cache, no UI. `templateAPI` re-exports them
 * for the panel and the scanner, and F4 tests import this module directly.
 */

/** AI: The three executable reconform phases, in cursor order. */
export type ReconformMode = 'add-missing' | 'remove-extra' | 'reset-defaults';

/**
 * AI: Pure computation of the frontmatter a reconform phase would produce.
 *
 * Shared by `reconformFile` (which writes the result) and by the metadata panel
 * (H4), which uses it to detect whether a phase is a no-op without touching the
 * file. Keeping the merge in one place guarantees they agree.
 */
export function computeReconformProps(
	templateProps: Map<string, any>,
	currentProps: Map<string, any>,
	mode: ReconformMode
): Map<string, any> {
	switch (mode) {
		case 'add-missing':
			return mergeSecondOnFirstMap(templateProps, currentProps, true);
		case 'remove-extra':
			return mergeSecondOnFirstMap(templateProps, currentProps, false);
		case 'reset-defaults':
			return new Map(templateProps);
	}
}

/**
 * AI: Pure template-vs-parent conformance.
 *
 * A template is valid when it includes every property of its parent
 * (`neededProps` empty); `extraProps` reports the properties it adds on its own.
 * The synthetic `position` key is ignored defensively even when callers pass a
 * raw cache record.
 */
export function computeTemplateConformance(
	templateProps: Map<string, any>,
	parentProps: Map<string, any>
): { isValid: boolean, neededProps: Set<string>, extraProps: Set<string> } {

	const templatePropsSet = new Set(templateProps.keys());
	const parentPropsSet = new Set(parentProps.keys());

	// Rimuove 'position' che è una chiave inserita automaticamente da Obsidian nella cache
	templatePropsSet.delete('position');
	parentPropsSet.delete('position');

	// AI: pure helpers instead of the TC39 Set methods (see setOperations.ts).
	return {
		isValid: isSubsetOf(parentPropsSet, templatePropsSet),
		neededProps: difference(parentPropsSet, templatePropsSet),
		extraProps: difference(templatePropsSet, parentPropsSet),
	};
}
