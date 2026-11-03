/**
 * AI: Pure model of the panel's reconform session (feature B).
 *
 * Role in the architecture:
 * The cursor and the Back stack are a property of the NOTE, not of the view:
 * two tabs showing the same note share one session, while a different note has
 * its own. This module keeps that state pure; `reconformHistory` is the I/O
 * adapter that applies it to Obsidian views and files.
 *
 * A session ends when the stack empties, when no tab shows the note any more,
 * or when an external write changes the frontmatter. Ending is not a revert:
 * it only forgets the memory, the current file state is untouched.
 */

/** AI: One Back step: the frontmatter and the cursor before a press. */
export interface SessionSnapshot {
	props: Map<string, unknown>;
	phase: number;
}

/** AI: Session state shared by every view showing the same path. */
export interface SessionState {
	stack: SessionSnapshot[];
	phase: number;
}

export function createSession(): SessionState {
	return { stack: [], phase: 0 };
}

/** AI: Pushes an unconditional snapshot (even a no-op press leaves a step). */
export function sessionPush(session: SessionState, props: Map<string, unknown>, phase: number): void {
	session.stack.push({ props: new Map(props), phase });
}

/** AI: Pops the most recent snapshot; the cursor follows the restored phase. */
export function sessionBack(session: SessionState): SessionSnapshot | null {
	const snapshot = session.stack.pop();
	if (!snapshot) return null;
	session.phase = snapshot.phase;
	return snapshot;
}

/** AI: Moves the cursor without touching the stack. */
export function sessionSetPhase(session: SessionState, phase: number): void {
	session.phase = phase;
}

/** AI: Ends the session: no stack, cursor back to the base phase. */
export function sessionEnd(session: SessionState): void {
	session.stack = [];
	session.phase = 0;
}

/** AI: True when there is at least one step to restore. */
export function sessionHasHistory(session: SessionState): boolean {
	return session.stack.length > 0;
}

/**
 * AI: Drops the sessions of notes that no tab shows any more.
 * `visible` is derived from the open views, not counted with a reference
 * counter, so a leaked increment can never keep a session alive forever.
 */
export function sweepSessions(sessions: Map<string, SessionState>, visible: ReadonlySet<string>): string[] {
	const removed: string[] = [];
	for (const path of sessions.keys()) {
		if (!visible.has(path)) {
			sessions.delete(path);
			removed.push(path);
		}
	}
	return removed;
}
