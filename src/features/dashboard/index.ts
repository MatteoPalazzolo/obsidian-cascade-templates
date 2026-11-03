import { App, Platform, Plugin } from "obsidian";
import { CascadeDashboardModal } from "./CascadeDashboardModal";
import { disposeJournal, initJournal } from "./journalStore";

/**
 * AI: Public entry point of the cascade dashboard.
 *
 * Role in the architecture:
 * `main.ts` (ribbon + command) and the metadata panel call `openDashboard`;
 * the plugin lifecycle owns the journal. Keeping this tiny facade means the
 * modal itself never imports the plugin class and stays a pure UI component.
 */

export function initDashboard(_plugin: Plugin): void {
	// 8 MB on mobile, 32 MB on desktop (feature B budget).
	initJournal(Platform.isMobile ? 8 * 1024 * 1024 : 32 * 1024 * 1024);
}

export function disposeDashboard(): void {
	disposeJournal();
}

/** AI: Opens the dashboard; `focusPath` expands the cascade of that note. */
export function openDashboard(app: App, focusPath?: string): void {
	new CascadeDashboardModal(app, { focusPath }).open();
}
