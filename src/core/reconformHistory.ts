import { MarkdownView, Plugin, TFile, Workspace } from "obsidian";
import { areMapsEqual } from "./mapOperations";
import {
	createSession,
	sessionBack,
	sessionEnd,
	sessionHasHistory,
	sessionPush,
	sessionSetPhase,
	sweepSessions,
	type SessionSnapshot,
	type SessionState,
} from "./reconformSession";
import { getFileProps, setFileProps } from "./templateAPI";

/**
 * AI: Back history for the metadata panel (feature B, path-keyed sessions).
 *
 * Role in the architecture:
 * This module is the I/O adapter around the pure `reconformSession` model. The
 * session belongs to the NOTE, not to the view: two tabs showing the same note
 * share the stack and the cursor, while a different note has its own session.
 * That is why the map is keyed by path instead of `MarkdownView`.
 *
 * Lifecycle:
 * - the stack is dropped when the note is no longer shown by any tab;
 * - an external frontmatter write ends the session (the panel calls
 *   `endSession` when it detects a real content change);
 * - closing the last tab of a note forgets it, so reopening starts empty;
 * - `onunload` clears the listeners; the map dies with the plugin instance.
 */

/** AI: One Back step: frontmatter and cursor before a press. */
export interface ReconformSnapshot extends SessionSnapshot {
	file: TFile;
}

/** AI: Callback fired whenever a note's stack changes (push/back/end/prune). */
export type HistoryChangeListener = (view: MarkdownView, hasHistory: boolean) => void;

/** AI: Sessions keyed by note path. */
const sessions = new Map<string, SessionState>();

/** AI: Subscribers of stack changes; used by the Back button to stay in sync. */
const listeners = new Set<HistoryChangeListener>();

/** AI: Workspace handle, set by `registerHistoryLifecycle` in `onload`. */
let workspace: Workspace | undefined;

/** AI: Open markdown views, used to fan a per-note change out to every tab. */
function openViews(): MarkdownView[] {
	if (!workspace) return [];
	const views: MarkdownView[] = [];
	// Includes popout windows and floating leaves: a session must survive when
	// the only tab showing the note lives outside the main area.
	workspace.iterateAllLeaves(leaf => {
		if (leaf.view instanceof MarkdownView && leaf.view.file) views.push(leaf.view);
	});
	return views;
}

/** AI: Paths currently shown by at least one markdown view. */
function visiblePaths(): Set<string> {
	const paths = new Set<string>();
	for (const view of openViews()) {
		const path = view.file?.path;
		if (path) paths.add(path);
	}
	return paths;
}

/** AI: Drops the sessions of notes no tab shows any more. */
function sweep(): void {
	sweepSessions(sessions, visiblePaths());
}

/** AI: Session of the note shown by `view`, or null without a markdown file. */
function sessionOf(view: MarkdownView, create: boolean): SessionState | null {
	const path = view.file?.path;
	if (!path) return null;

	const existing = sessions.get(path);
	if (existing) return existing;
	if (!create) return null;

	const created = createSession();
	sessions.set(path, created);
	return created;
}

/** AI: Notifies every tab showing `path` (the session is shared by all of them). */
function notifyPath(path: string): void {
	const hasHistory = sessionHasHistory(sessions.get(path) ?? createSession());
	for (const view of openViews()) {
		if (view.file?.path !== path) continue;
		for (const listener of [...listeners]) listener(view, hasHistory);
	}
}

function notify(view: MarkdownView): void {
	const path = view.file?.path;
	if (path) notifyPath(path);
}

function notifyAllOpen(): void {
	for (const view of openViews()) notify(view);
}

/**
 * AI: Snapshots the given frontmatter + cursor phase for the note shown by
 * `view`. The snapshot is UNCONDITIONAL: even a no-op press leaves a step,
 * because the cursor always advances and Back must rewind it.
 */
export function push(view: MarkdownView, props: Map<string, unknown>, phase: number): void {
	const session = sessionOf(view, true);
	const file = view.file;
	if (!session || !file) return;

	sessionPush(session, props, phase);
	notify(view);
}

/**
 * AI: Rewinds one step of the note shown by `view`, restores the frontmatter
 * and returns the snapshot so the UI can restore the cursor phase.
 *
 * The disk write is skipped when the snapshot matches what is already on disk
 * (a no-op press reversed): the cursor still rewinds, no needless `modify()`.
 */
export async function back(view: MarkdownView): Promise<ReconformSnapshot | null> {
	const session = sessionOf(view, false);
	const file = view.file;
	if (!session || !file) return null;

	const snapshot = sessionBack(session);
	if (!snapshot) return null;

	const currentProps = await getFileProps(file);
	if (!areMapsEqual(currentProps, snapshot.props)) {
		await setFileProps(file, snapshot.props);
	}

	if (!sessionHasHistory(session)) sessionSetPhase(session, 0);

	notify(view);
	return { ...snapshot, file };
}

/** AI: `true` when the note shown by `view` has at least one step to rewind. */
export function hasHistory(view: MarkdownView): boolean {
	const session = sessionOf(view, false);
	return session ? sessionHasHistory(session) : false;
}

/** AI: Shared cursor phase of the note shown by `view` (0 when no session). */
export function getPhase(view: MarkdownView): number {
	const session = sessionOf(view, false);
	return session?.phase ?? 0;
}

/** AI: Writes the cursor phase on the note's session, so tabs stay in sync. */
export function setPhase(view: MarkdownView, phase: number): void {
	const session = sessionOf(view, true);
	if (!session) return;
	sessionSetPhase(session, phase);
	notify(view);
}

/** AI: Ends the session of the note shown by `view` (stack + cursor). */
export function endSession(view: MarkdownView): void {
	const path = view.file?.path;
	if (!path) return;
	const session = sessions.get(path);
	if (!session) return;
	sessionEnd(session);
	notifyPath(path);
}

/** AI: Backward-compatible alias used by the panel. */
export function clear(view: MarkdownView): void {
	endSession(view);
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
 * AI: Eager pruning (feature B). Detects file replacement, closed tabs and
 * layout churn as soon as they happen, so the Back button of every affected
 * view updates without waiting for a UI call.
 */
export function registerHistoryLifecycle(plugin: Plugin): void {
	workspace = plugin.app.workspace;

	plugin.registerEvent(
		workspace.on("file-open", () => {
			sweep();
			notifyAllOpen();
		})
	);

	plugin.registerEvent(
		workspace.on("layout-change", () => {
			sweep();
			notifyAllOpen();
		})
	);
}

/** AI: Releases the listeners subscribed by the UI (called from `onunload`). */
export function disposeHistory(): void {
	listeners.clear();
	sessions.clear();
	workspace = undefined;
}
