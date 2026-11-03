import { createJournal, type JournalState } from "../../core/journal";

/**
 * AI: Plugin-level journal storage for the dashboard.
 *
 * Role in the architecture:
 * The journal is NOT owned by the modal: closing and reopening the dashboard
 * must keep the history, and only `onunload` may drop it. This module is the
 * single accessor so the modal, the ribbon command and the lifecycle all see the
 * same instance.
 */

let journal: JournalState | null = null;

export function initJournal(budgetBytes: number): JournalState {
	journal = createJournal(budgetBytes);
	return journal;
}

export function getJournal(): JournalState {
	// The dashboard cannot open before `initJournal`; the lazy fallback keeps the
	// pure module testable without booting the plugin.
	journal ??= createJournal(32 * 1024 * 1024);
	return journal;
}

export function disposeJournal(): void {
	journal = null;
}
