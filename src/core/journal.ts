import { REMOVED, isRemoved, type PropertyChange } from "./frontmatterChanges";
import { areValuesEqual } from "./mapOperations";

/**
 * AI: Dashboard journal (feature B).
 *
 * Role in the architecture:
 * The journal is the only memory of the dashboard operations. It is pure: it
 * owns the target-state model, the byte budget, FIFO eviction and the preflight
 * of a rewind, while the adapter (`DashboardModal`) supplies the current
 * frontmatter read from disk and performs the writes.
 *
 * A file change stores the COMPLETE frontmatter before the write plus the list
 * of the keys the write touched. Restoring a range means writing the value those
 * keys had in the `before` of the oldest entry of the range that touched the
 * file; keys outside `changes` are never overwritten.
 */

export type JournalOrigin = "batch" | "fix-all";

/** AI: Position of a `Fix all` entry inside the macro. */
export interface JournalRoutine {
	id: string;
	step: number;
	total: number;
}

/** AI: What a single file received in one entry. */
export interface JournalFileChange {
	path: string;
	/** Complete frontmatter before the write (also covers keys touched later). */
	before: Map<string, unknown>;
	/** Authoritative list of touched keys; empty for a skipped file. */
	changes: PropertyChange[];
	/** The file was not written (failed during the batch). */
	skipped?: boolean;
}

/** AI: One restorable entry. `Fix all` produces one entry per phase that writes. */
export interface JournalEntry {
	id: string;
	operationId: string;
	origin: JournalOrigin;
	at: number;
	routine?: JournalRoutine;
	/** Human label of the verb that produced the entry (History card). */
	verb?: string;
	files: JournalFileChange[];
}

/** AI: Budget unit: an operation, not an entry. `Fix all` is one unit. */
export interface JournalOperation {
	id: string;
	origin: JournalOrigin;
	at: number;
	routine?: JournalRoutine;
	entries: JournalEntry[];
}

export interface JournalState {
	operations: JournalOperation[];
	nextId: number;
	/** Number of operations dropped from the head because of the budget. */
	truncatedOperations: number;
	budgetBytes: number;
}

/** AI: Input of one new operation, before ids are assigned. */
export interface JournalOperationInput {
	origin: JournalOrigin;
	at?: number;
	routine?: JournalRoutine;
	verb?: string;
	files: JournalFileChange[];
}

export interface AppendResult {
	accepted: boolean;
	/** Entries actually stored (empty when nothing was written). */
	entry: JournalEntry | null;
	evictedOperations: number;
	evictedEntries: number;
	/** The operation alone does not fit the budget: it is not restorable. */
	oversized: boolean;
}

/** AI: One file the rewind must write. */
export interface RewindWrite {
	path: string;
	/** Touched keys and the value they had at the start of the range. */
	patch: Map<string, unknown>;
	conflicts: RewindConflict[];
}

/** AI: A key changed outside the dashboard between the operation and the rewind. */
export interface RewindConflict {
	key: string;
	current: unknown;
	restored: unknown;
}

/** AI: Result of repeating the rewind in memory. */
export interface RewindPlan {
	entryIds: string[];
	writes: RewindWrite[];
	/** Files that no longer exist: skipped with a warning. */
	missingPaths: string[];
	conflictCount: number;
}

export function createJournal(budgetBytes: number): JournalState {
	return { operations: [], nextId: 1, truncatedOperations: 0, budgetBytes };
}

/** AI: Flattens the operations in chronological order (oldest first). */
export function listEntries(state: JournalState): JournalEntry[] {
	const entries: JournalEntry[] = [];
	for (const operation of state.operations) entries.push(...operation.entries);
	return entries;
}

/** AI: Number of restorable entries (the `History (M)` counter). */
export function entryCount(state: JournalState): number {
	return listEntries(state).length;
}

/** AI: Most recent entry, or null when the journal is empty. */
export function lastEntry(state: JournalState): JournalEntry | null {
	const entries = listEntries(state);
	return entries[entries.length - 1] ?? null;
}

/** AI: Content address of a value, stable enough for byte interning. */
function valueSignature(value: unknown): string {
	if (isRemoved(value)) return "\u0000removed";
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

function mapSignature(map: Map<string, unknown>): string {
	return [...map.entries()]
		.map(([key, value]) => `${key}\u0001${valueSignature(value)}`)
		.join("\u0002");
}

/**
 * AI: Estimated weight of a file list.
 *
 * The same map content is counted once per call (interning): a cascade often
 * writes identical frontmatter, and without deduplication the budget would be
 * exhausted by two global operations.
 */
export function estimateFilesBytes(files: readonly JournalFileChange[]): number {
	const seen = new Set<string>();
	let bytes = 0;

	const add = (signature: string): void => {
		if (seen.has(signature)) return;
		seen.add(signature);
		// UTF-16 string length × 2 ≈ bytes held by the runtime.
		bytes += signature.length * 2;
	};

	for (const file of files) {
		add(mapSignature(file.before));
		for (const change of file.changes) {
			add(`${file.path}\u0001${change.key}\u0001${valueSignature(change.after)}`);
		}
	}

	return bytes;
}

/** AI: Current weight of the journal, interning identical fragments globally. */
export function journalBytes(state: JournalState): number {
	const seen = new Set<string>();
	let bytes = 0;

	const add = (signature: string): void => {
		if (seen.has(signature)) return;
		seen.add(signature);
		bytes += signature.length * 2;
	};

	for (const entry of listEntries(state)) {
		for (const file of entry.files) {
			add(mapSignature(file.before));
			for (const change of file.changes) {
				add(`${file.path}\u0001${change.key}\u0001${valueSignature(change.after)}`);
			}
		}
	}

	return bytes;
}

/** AI: Estimated weight of one operation submitted to `appendOperation`. */
export function estimateOperationBytes(files: readonly JournalFileChange[]): number {
	return estimateFilesBytes(files);
}

function removeOldestOperation(state: JournalState): number {
	const oldest = state.operations.shift();
	return oldest?.entries.length ?? 0;
}

/**
 * AI: Appends an operation and applies FIFO eviction from the head.
 *
 * The budget is per operation: if only part of a `Fix all` fits, the whole
 * macro is dropped, never half of it. An operation larger than the whole budget
 * is rejected before being stored and is reported as `oversized` (the caller
 * must have warned the user that it will not be undoable).
 */
export function appendOperation(state: JournalState, input: JournalOperationInput): AppendResult {
	if (input.files.length === 0) {
		return {
			accepted: false,
			entry: null,
			evictedOperations: 0,
			evictedEntries: 0,
			oversized: false,
		};
	}

	const size = estimateOperationBytes(input.files);
	if (size > state.budgetBytes) {
		return {
			accepted: false,
			entry: null,
			evictedOperations: 0,
			evictedEntries: 0,
			oversized: true,
		};
	}

	let evictedOperations = 0;
	let evictedEntries = 0;
	while (state.operations.length > 0 && journalBytes(state) + size > state.budgetBytes) {
		evictedEntries += removeOldestOperation(state);
		evictedOperations++;
	}

	const operationId = `op-${state.nextId++}`;
	const entry: JournalEntry = {
		id: `entry-${state.nextId++}`,
		operationId,
		origin: input.origin,
		at: input.at ?? Date.now(),
		routine: input.routine,
		verb: input.verb,
		files: input.files.map(file => ({
			path: file.path,
			before: new Map(file.before),
			changes: file.changes.map(change => ({ key: change.key, after: change.after })),
			skipped: file.skipped === true,
		})),
	};

	state.operations.push({
		id: operationId,
		origin: input.origin,
		at: entry.at,
		routine: input.routine,
		entries: [entry],
	});
	state.truncatedOperations += evictedOperations;

	return { accepted: true, entry, evictedOperations, evictedEntries, oversized: false };
}

/**
 * AI: Adds an entry to an existing operation (`Fix all` phases 2 and 3).
 * Returns `false` when the operation has already been evicted.
 */
export function appendEntryToOperation(
	state: JournalState,
	operationId: string,
	fileList: JournalFileChange[],
	routine?: JournalRoutine,
	verb?: string
): JournalEntry | null {
	if (fileList.length === 0) return null;

	const operation = state.operations.find(candidate => candidate.id === operationId);
	if (!operation) return null;

	const entry: JournalEntry = {
		id: `entry-${state.nextId++}`,
		operationId,
		origin: operation.origin,
		at: Date.now(),
		routine,
		verb,
		files: fileList.map(file => ({
			path: file.path,
			before: new Map(file.before),
			changes: file.changes.map(change => ({ key: change.key, after: change.after })),
			skipped: file.skipped === true,
		})),
	};

	operation.entries.push(entry);
	return entry;
}

/**
 * AI: Re-applies the budget after entries were added to an existing operation
 * (`Fix all`). It evicts from the head; if the operation that just grew is the
 * only one left and still exceeds the budget, it is dropped whole and reported
 * as `droppedOperations`.
 */
export function enforceBudget(state: JournalState): {
	evictedOperations: number;
	evictedEntries: number;
	droppedOperations: number;
} {
	let evictedOperations = 0;
	let evictedEntries = 0;

	while (state.operations.length > 0 && journalBytes(state) > state.budgetBytes) {
		const isOnlyOperation = state.operations.length === 1;
		evictedEntries += removeOldestOperation(state);
		evictedOperations++;

		if (isOnlyOperation) {
			state.truncatedOperations += evictedOperations;
			return { evictedOperations, evictedEntries, droppedOperations: 1 };
		}
	}

	state.truncatedOperations += evictedOperations;
	return { evictedOperations, evictedEntries, droppedOperations: 0 };
}

/** AI: Removes the entries with the given ids; empty operations disappear. */
export function removeEntries(state: JournalState, ids: readonly string[]): number {
	const removing = new Set(ids);
	let removed = 0;

	for (const operation of state.operations) {
		const kept = operation.entries.filter(entry => !removing.has(entry.id));
		removed += operation.entries.length - kept.length;
		operation.entries = kept;
	}
	state.operations = state.operations.filter(operation => operation.entries.length > 0);

	return removed;
}

/** AI: Distinct parent folders of the written files. */
export function distinctFolders(paths: readonly string[]): number {
	const folders = new Set<string>();
	for (const path of paths) {
		const index = path.lastIndexOf("/");
		folders.add(index < 0 ? "" : path.slice(0, index));
	}
	return folders.size;
}

/**
 * AI: Repeats a rewind in memory without writing.
 *
 * `current` is the frontmatter currently on disk for each path, `existing` the
 * paths that still resolve to a file. The plan contains only the files that
 * actually need a write, so a retry after a partial rewind does not report
 * already-restored files as conflicts.
 */
export function planRewind(
	state: JournalState,
	fromEntryId: string,
	current: ReadonlyMap<string, Map<string, unknown>>,
	existing: ReadonlySet<string>
): RewindPlan {
	const entries = listEntries(state);
	const start = entries.findIndex(entry => entry.id === fromEntryId);
	if (start < 0) {
		return { entryIds: [], writes: [], missingPaths: [], conflictCount: 0 };
	}

	const range = entries.slice(start);
	const touchedPaths = new Set<string>();
	for (const entry of range) {
		for (const file of entry.files) {
			if (file.skipped || file.changes.length === 0) continue;
			touchedPaths.add(file.path);
		}
	}

	const missingPaths: string[] = [];
	const writes: RewindWrite[] = [];

	for (const path of touchedPaths) {
		const currentProps = current.get(path) ?? new Map<string, unknown>();

		if (!existing.has(path)) {
			missingPaths.push(path);
			continue;
		}

		let oldestBefore: Map<string, unknown> | null = null;
		const keys = new Set<string>();
		const lastAfter = new Map<string, unknown>();

		for (const entry of range) {
			for (const file of entry.files) {
				if (file.path !== path || file.skipped) continue;
				if (file.changes.length === 0) continue;
				oldestBefore ??= file.before;
				for (const change of file.changes) {
					keys.add(change.key);
					lastAfter.set(change.key, change.after);
				}
			}
		}

		if (!oldestBefore || keys.size === 0) continue;

		const patch = new Map<string, unknown>();
		const conflicts: RewindConflict[] = [];
		let needsWrite = false;

		for (const key of keys) {
			const target = oldestBefore.has(key) ? oldestBefore.get(key) : REMOVED;
			patch.set(key, target);

			const currentValue = currentProps.has(key) ? currentProps.get(key) : REMOVED;
			if (!valuesMatch(currentValue, target)) needsWrite = true;

			const last = lastAfter.has(key) ? lastAfter.get(key) : REMOVED;
			if (!valuesMatch(currentValue, last) && !valuesMatch(currentValue, target)) {
				conflicts.push({
					key,
					current: isRemoved(currentValue) ? REMOVED : currentValue,
					restored: target,
				});
			}
		}

		if (!needsWrite) continue;
		writes.push({ path, patch, conflicts });
	}

	const conflictCount = writes.reduce((total, write) => total + write.conflicts.length, 0);
	return {
		entryIds: range.map(entry => entry.id),
		writes,
		missingPaths,
		conflictCount,
	};
}

/** AI: `REMOVED` equals a missing key; values compare structurally otherwise. */
function valuesMatch(first: unknown, second: unknown): boolean {
	if (isRemoved(first) || isRemoved(second)) return isRemoved(first) && isRemoved(second);
	return areValuesEqual(first, second);
}
