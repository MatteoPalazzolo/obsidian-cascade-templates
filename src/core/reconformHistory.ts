import { MarkdownView, Plugin, TFile } from "obsidian";
import { areMapsEqual } from "./mapOperations";
import { getFileProps, setFileProps } from "./templateAPI";

/**
 * AI: Back history for the metadata panel (B2, rewritten for the H1-H2 cursor).
 *
 * Role in the architecture:
 * This module is the "memory" behind the panel's Back button, kept separate
 * from the features layer so it can be reasoned about (and reverted) on its own.
 *
 * Semantics (the phase cursor model):
 * - The reconform button walks a fixed sequence (Add missing → Remove extra →
 *   Clear). EVERY live press pushes a snapshot, even when the press was a no-op.
 * - A snapshot captures the frontmatter AND the cursor phase as they were
 *   BEFORE the press. Back therefore reverses the last reconform press and
 *   steps the cursor back by one phase. When the props did not change, the disk
 *   write is skipped but the cursor still moves.
 * - One independent stack per `MarkdownView`, so two panes showing two files
 *   never share history.
 * - The stack survives tab switches and active-leaf changes: moving focus
 *   around must NOT erase it.
 * - The stack is dropped only when the view is closed (the `WeakMap` key
 *   becomes unreachable and the whole entry is collected) or when a different
 *   file replaces the current one in that same view.
 *
 * The "file replaced" case is handled lazily: every API call re-checks the
 * view's current file against the file the snapshots belong to, and drops the
 * stack on mismatch. `registerHistoryLifecycle` additionally wires workspace
 * events so the drop is detected eagerly and listeners are notified (B3).
 */

/**
 * AI: One Back step: the frontmatter and the cursor phase as they were before a
 * press, plus the file they belong to.
 */
export interface ReconformSnapshot {
	file: TFile;
	props: Map<string, any>;
	/** AI: Cursor phase before the press that created this snapshot (0..2). */
	phase: number;
}

/** AI: Callback fired whenever a view's stack changes (push/back/clear/prune). */
export type HistoryChangeListener = (view: MarkdownView, hasHistory: boolean) => void;

/**
 * AI: Per-view snapshot stacks. A `WeakMap` is what makes "closed view ⇒
 * forgotten history" free: once Obsidian drops the view, the entry (and the
 * `TFile` references it holds) becomes garbage-collectable.
 */
const stacks = new WeakMap<MarkdownView, ReconformSnapshot[]>();

/** AI: Subscribers of stack changes; used by the Back button to stay in sync. */
const listeners = new Set<HistoryChangeListener>();

/**
 * AI: Drops the stack of `view` when it now points at a different file.
 * Returns `true` when something was actually discarded.
 */
function pruneStale(view: MarkdownView): boolean {
	const stack = stacks.get(view);
	if (!stack || stack.length === 0) return false;

	const currentFile = view.file;
	const snapshotFile = stack[stack.length - 1].file;

	// Same path ⇒ same note (Obsidian may hand back a distinct TFile instance
	// for the same file, so compare paths, not object identity).
	const stillSameFile = currentFile !== null && currentFile.path === snapshotFile.path;

	if (!stillSameFile) {
		stacks.delete(view);
		return true;
	}
	return false;
}

/** AI: Prune + notify in one step, used by the event-driven paths. */
function pruneAndNotify(view: MarkdownView): void {
	if (pruneStale(view)) notify(view);
}

/** AI: Tells every listener the current Back availability of `view`. */
function notify(view: MarkdownView): void {
	const hasHistory = (stacks.get(view)?.length ?? 0) > 0;
	// Iterate over a copy: a listener could (un)subscribe while being called.
	for (const listener of [...listeners]) listener(view, hasHistory);
}

/**
 * AI: Snapshots the given frontmatter + cursor phase for `view` before an action.
 *
 * The caller passes the state read *before* mutating the note; the Map is
 * copied so later mutations of the caller's Map cannot rewrite the past.
 *
 * This is deliberately UNCONDITIONAL: even a no-op press leaves a step on the
 * stack, because the cursor always advances and Back must be able to rewind it.
 */
export function push(view: MarkdownView, props: Map<string, any>, phase: number): void {
	const file = view.file;
	if (!file) return;

	// A file switch invalidates whatever was stacked for the previous note.
	pruneAndNotify(view);

	const stack = stacks.get(view) ?? [];
	stack.push({ file, props: new Map(props), phase });
	stacks.set(view, stack);

	notify(view);
}

/**
 * AI: Rewinds one step of `view`: pops the most recent snapshot, restores the
 * frontmatter and returns the snapshot so the UI can restore the cursor phase.
 *
 * The disk write is skipped when the snapshot matches what is already on disk
 * (a no-op press reversed): the cursor still rewinds, no needless `modify()`.
 * Returns `null` when there is nothing left to rewind.
 */
export async function back(view: MarkdownView): Promise<ReconformSnapshot | null> {
	pruneAndNotify(view);

	const stack = stacks.get(view);
	if (!stack || stack.length === 0) return null;

	const snapshot = stack.pop();
	if (!snapshot) return null;

	if (stack.length === 0) stacks.delete(view);

	const currentProps = await getFileProps(snapshot.file);
	if (!areMapsEqual(currentProps, snapshot.props)) {
		await setFileProps(snapshot.file, snapshot.props);
	}

	notify(view);
	return snapshot;
}

/** AI: `true` when `view` has at least one step left to rewind. */
export function hasHistory(view: MarkdownView): boolean {
	pruneAndNotify(view);
	return (stacks.get(view)?.length ?? 0) > 0;
}

/** AI: Forgets the whole history of a single view (e.g. after a full reset). */
export function clear(view: MarkdownView): void {
	if (stacks.delete(view)) notify(view);
}

/**
 * AI: Subscribes to stack changes. Returns an unsubscribe function; the UI
 * calls it from `onunload`/`clear` so no dangling callbacks survive a reload.
 */
export function onHistoryChange(listener: HistoryChangeListener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * AI: Eager pruning (B2/B3). Detects file replacement as soon as it happens so
 * the Back button of the affected view updates without waiting for a UI call.
 *
 * - `file-open`: the pane that just received a file is the active one.
 * - `layout-change`: covers splits/closes and any other layout churn for every
 *   currently open markdown view.
 *
 * Closing a view needs no explicit handling: the `WeakMap` entry goes away with
 * the view itself.
 */
export function registerHistoryLifecycle(plugin: Plugin): void {
	const workspace = plugin.app.workspace;

	plugin.registerEvent(
		workspace.on("file-open", () => {
			const view = workspace.getActiveViewOfType(MarkdownView);
			if (view) pruneAndNotify(view);
		})
	);

	plugin.registerEvent(
		workspace.on("layout-change", () => {
			for (const leaf of workspace.getLeavesOfType("markdown")) {
				if (leaf.view instanceof MarkdownView) pruneAndNotify(leaf.view);
			}
		})
	);
}

/** AI: Releases the listeners subscribed by the UI (called from `onunload`). */
export function disposeHistory(): void {
	listeners.clear();
}
