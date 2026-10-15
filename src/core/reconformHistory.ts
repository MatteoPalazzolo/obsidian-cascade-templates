import { MarkdownView, Plugin, TFile } from "obsidian";
import { setFileProps } from "./templateAPI";

/**
 * AI: Undo memory for the metadata panel.
 *
 * Role in the architecture (Sessione B):
 * This module is the "memory" behind the UI's undo button, kept separate from
 * the features layer so it can be reasoned about (and reverted) on its own.
 * Every reconform action pushes a snapshot of the frontmatter *before* the
 * change; the undo button pops the last snapshot and writes it back.
 *
 * Scoping rules (B2):
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

/** AI: One undo step: the frontmatter as it was before an action, plus its file. */
export interface ReconformSnapshot {
	file: TFile;
	props: Map<string, any>;
}

/** AI: Callback fired whenever a view's stack changes (push/undo/clear/prune). */
export type HistoryChangeListener = (view: MarkdownView, hasHistory: boolean) => void;

/**
 * AI: Per-view snapshot stacks. A `WeakMap` is what makes "closed view ⇒
 * forgotten history" free: once Obsidian drops the view, the entry (and the
 * `TFile` references it holds) becomes garbage-collectable.
 */
const stacks = new WeakMap<MarkdownView, ReconformSnapshot[]>();

/** AI: Subscribers of stack changes; used by the undo button to stay in sync. */
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

/** AI: Tells every listener the current undo availability of `view`. */
function notify(view: MarkdownView): void {
	const hasHistory = (stacks.get(view)?.length ?? 0) > 0;
	// Iterate over a copy: a listener could (un)subscribe while being called.
	for (const listener of [...listeners]) listener(view, hasHistory);
}

/**
 * AI: Snapshots the given frontmatter for `view` before an action is applied.
 *
 * The caller passes the state read *before* mutating the note; the Map is
 * copied so later mutations of the caller's Map cannot rewrite the past.
 * Call it only when the action will actually change something, otherwise the
 * stack would collect no-op steps.
 */
export function push(view: MarkdownView, props: Map<string, any>): void {
	const file = view.file;
	if (!file) return;

	// A file switch invalidates whatever was stacked for the previous note.
	pruneAndNotify(view);

	const stack = stacks.get(view) ?? [];
	stack.push({ file, props: new Map(props) });
	stacks.set(view, stack);

	notify(view);
}

/**
 * AI: Pops the most recent snapshot of `view` and writes it back to disk.
 * Returns `true` when an undo actually happened.
 */
export async function undo(view: MarkdownView): Promise<boolean> {
	pruneAndNotify(view);

	const stack = stacks.get(view);
	if (!stack || stack.length === 0) return false;

	const snapshot = stack.pop();
	if (!snapshot) return false;

	if (stack.length === 0) stacks.delete(view);

	await setFileProps(snapshot.file, snapshot.props);

	notify(view);
	return true;
}

/** AI: `true` when `view` has at least one undoable step left. */
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
 * the undo button of the affected view updates without waiting for a UI call.
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
