import { MarkdownView, Plugin, TFile, Workspace, debounce, setIcon } from "obsidian";
import {
	getFileProps,
	getFilePropsMapFromCache,
	getTemplateOfFile,
	isTemplateCoherentToParentTemplate,
	reconformFile,
	type ReconformMode,
} from "../core/templateAPI";
import { computeMapConformance, type MapConformanceStatus } from "../core/mapOperations";
import { hasHistory, onHistoryChange, push, undo } from "../core/reconformHistory";
import { hasTemplaterSyntax } from "../core/templaterBridge";
import { getSettings, isTemplateFile } from "../settings";

/**
 * AI: Metadata panel toolbar (Sessione C).
 *
 * Role in the architecture:
 * Obsidian renders one metadata/properties panel per `MarkdownView`, so a
 * single global toolbar can only ever serve the active note. This module builds
 * a toolbar **per open markdown view**, so every pane in a split layout gets
 * its own controls.
 *
 * The module owns three things:
 * 1. the per-view lifecycle (create / attach / observe / dispose);
 * 2. the status indicator shown LEFT of the native "Add property" button (C2);
 * 3. the action buttons shown RIGHT of it: the phase-advancing reconform
 *    button (C3) and the stack undo button (C4).
 *
 * DOM contract (verified live on Obsidian 1.x):
 *
 *   .metadata-container
 *     .metadata-properties-heading ...
 *     .metadata-content
 *       .metadata-properties                          <- the property rows
 *       <span class="cascade-templates-status">       <- C2, before the button
 *       .metadata-add-button                          <- NATIVE "Add property"
 *       <div class="cascade-templates-toolbar">       <- C3/C4, after it
 *         <div class="cascade-templates-action"> reconform </div>
 *         <div class="cascade-templates-action"> undo </div>
 *
 * Row layout: [status] [Add property] [reconform] [undo].
 *
 * Conformance semantics:
 * - A NOTE is compared to its nearest ancestor `!Template.md`.
 * - A TEMPLATE is compared to its own nearest ancestor template (parent), via
 *   `isTemplateCoherentToParentTemplate`.
 * - A file with no template to compare against gets a neutral indicator and a
 *   disabled reconform button.
 */

/**
 * AI: Everything the panel owns for a single view. Elements are created once
 * per view and re-attached as needed; their content is driven by `refreshPanel`.
 */
export interface PanelUI {
	view: MarkdownView;
	/** AI: Status indicator, inserted before the native "Add property" button. */
	statusEl: HTMLSpanElement;
	/** AI: Action buttons container, inserted after the native add button. */
	actionsEl: HTMLDivElement;
	/** AI: Dynamic reconform button (C3). */
	reconformEl: HTMLDivElement;
	reconformIconEl: HTMLElement;
	reconformLabelEl: HTMLElement;
	/** AI: Mode currently bound to the reconform button (null = disabled). */
	reconformMode: ReconformMode | null;
	/** AI: Stack undo button (C4). */
	undoEl: HTMLDivElement;
	/** AI: Re-attaches the elements after a panel re-render. */
	observer: MutationObserver | null;
	/** AI: The container currently observed (to detect container replacement). */
	observedContainer: HTMLElement | null;
}

/** AI: Class names shared with `styles.css` (C7). */
const STATUS_CLASS = "cascade-templates-status";
const TOOLBAR_CLASS = "cascade-templates-toolbar";
const ACTION_CLASS = "cascade-templates-action";
const DISABLED_CLASS = "cascade-templates-disabled";
const METADATA_CONTAINER_SELECTOR = ".metadata-container";
const ADD_BUTTON_SELECTOR = ".metadata-add-button";

/** AI: Status modifier classes, all mutually exclusive. */
const STATUS_MODS = ["is-ok", "is-extra", "is-missing", "is-none"];

/** AI: Visual config of the status indicator for a regular note. */
const NOTE_STATUS: Record<MapConformanceStatus, StatusConfig> = {
	ok: { icon: "circle-check-big", label: "In sync with the template", mod: "ok" },
	extra: { icon: "circle-alert", label: "Extra properties compared to the template", mod: "extra" },
	missing: { icon: "circle-x", label: "Missing properties compared to the template", mod: "missing" },
};

/** AI: Visual config of the status indicator for a template file. */
const TEMPLATE_STATUS = {
	coherent: { icon: "file-check", label: "Template conforms to its parent template", mod: "ok" },
	divergent: { icon: "file-x", label: "Template is missing properties from its parent template", mod: "missing" },
};

/** AI: Neutral indicator: there is nothing meaningful to compare against. */
const STATUS_NEUTRAL: StatusConfig = { icon: "circle-dashed", label: "No template found", mod: "none" };

/** AI: Neutral indicator specific to a template with no ancestor template. */
const STATUS_NO_PARENT: StatusConfig = { icon: "circle-dashed", label: "No parent template", mod: "none" };

/**
 * AI: The three phases of the dynamic reconform button.
 *
 * The phase is derived from the current conformance status, so after every
 * click the button recomputes itself and "advances" along the sequence
 * missing → extra → ok:
 *   1. add-missing    (status missing) → add the template props the file lacks
 *   2. remove-extra   (status extra)   → drop the props the template does not have
 *   3. reset-defaults (status ok)      → overwrite values with the template defaults
 */
const PHASE_CONFIG: Record<MapConformanceStatus, PhaseConfig> = {
	missing: { mode: "add-missing", icon: "list-restart", label: "Add missing", action: "add the missing properties" },
	extra: { mode: "remove-extra", icon: "list-x", label: "Remove extra", action: "remove the extra properties" },
	ok: { mode: "reset-defaults", icon: "eraser", label: "Clear", action: "reset the properties to the defaults" },
};

/** AI: Status indicator description. */
interface StatusConfig {
	icon: string;
	label: string;
	mod: string;
}

/** AI: Dynamic reconform button description. */
interface PhaseConfig {
	mode: ReconformMode;
	icon: string;
	label: string;
	action: string;
}

/**
 * AI: Primary lookup, keyed by view. A `WeakMap` means a closed view frees its
 * panel automatically, but it is not enumerable, hence the registry below.
 */
const panels = new WeakMap<MarkdownView, PanelUI>();

/**
 * AI: Enumerable companion to `panels`, needed to prune closed views and to
 * dispose everything from `onunload`. Kept in sync with the WeakMap.
 */
const trackedViews = new Set<MarkdownView>();

/** AI: Workspace handle captured at init time (same pattern as templateAPI). */
let workspace: Workspace | undefined;

/** AI: Unsubscribe handle of the history listener, released by `clear()`. */
let unsubscribeHistory: (() => void) | null = null;

/**
 * AI: Wires the panel to workspace and metadata events. Call once from `onload`.
 * The debounce coalesces the event bursts produced by layout changes.
 */
export function init(plugin: Plugin): void {
	workspace = plugin.app.workspace;
	const scheduleSync = debounce(() => syncAll(), 40, true);

	plugin.registerEvent(workspace.on("active-leaf-change", () => scheduleSync()));
	plugin.registerEvent(workspace.on("file-open", () => scheduleSync()));
	plugin.registerEvent(workspace.on("layout-change", () => scheduleSync()));

	// A frontmatter change refreshes the views showing that file, and also the
	// views whose template is the file that changed.
	const scheduleRefreshFor = debounce((changed: TFile) => refreshViewsForFile(changed), 200, true);
	plugin.registerEvent(plugin.app.metadataCache.on("changed", (changed) => scheduleRefreshFor(changed)));

	// Keep the undo buttons in sync with the history stacks (B3).
	unsubscribeHistory = onHistoryChange((view) => {
		const ui = panels.get(view);
		if (ui) updateUndoState(ui);
	});
}

/**
 * AI: Removes every injected element and disconnects every observer/listener.
 * Call from `onunload`.
 */
export function clear(): void {
	unsubscribeHistory?.();
	unsubscribeHistory = null;

	for (const view of [...trackedViews]) detach(view);
	trackedViews.clear();
}

/** AI: Public "recompute everything now" hook, used after `onLayoutReady`. */
export function refreshAll(): void {
	syncAll();
}

/**
 * AI: Reconciles the toolbar set with the currently open markdown views:
 * ensures one panel per view and tears down the panels of closed views.
 */
function syncAll(): void {
	if (!workspace) return;

	const openViews = new Set<MarkdownView>();
	for (const leaf of workspace.getLeavesOfType("markdown")) {
		if (leaf.view instanceof MarkdownView) {
			openViews.add(leaf.view);
			syncView(leaf.view);
		}
	}

	for (const view of [...trackedViews]) {
		if (!openViews.has(view)) detach(view);
	}
}

/**
 * AI: Ensures the toolbar of a single view exists and sits in the right spot.
 * Silently skips views whose metadata panel is not mounted (yet): the next
 * event or observer callback will retry.
 */
function syncView(view: MarkdownView): void {
	const container = view.containerEl.querySelector<HTMLElement>(METADATA_CONTAINER_SELECTOR);
	if (!container) return;

	// The FIRST `.metadata-add-button` is the native one; our own buttons use a
	// different class so this query stays unambiguous.
	const addButton = container.querySelector<HTMLElement>(ADD_BUTTON_SELECTOR);
	if (!addButton) return;

	const ui = panels.get(view) ?? createPanel(view);
	trackedViews.add(view);

	attach(ui, addButton);
	observe(ui, container);
	void refreshPanel(ui);
}

/** AI: Creates the elements of a view's toolbar and registers them. */
function createPanel(view: MarkdownView): PanelUI {
	const statusEl = document.createElement("span");
	statusEl.classList.add(STATUS_CLASS);

	const actionsEl = document.createElement("div");
	actionsEl.classList.add(TOOLBAR_CLASS);

	const reconform = createActionButton("list-restart", "Add missing");
	const undoBtn = createActionButton("undo-2", "Undo");
	actionsEl.append(reconform.el, undoBtn.el);

	const ui: PanelUI = {
		view,
		statusEl,
		actionsEl,
		reconformEl: reconform.el,
		reconformIconEl: reconform.iconEl,
		reconformLabelEl: reconform.labelEl,
		reconformMode: null,
		undoEl: undoBtn.el,
		observer: null,
		observedContainer: null,
	};

	reconform.el.addEventListener("click", (event) => void handleReconformClick(event, ui));
	undoBtn.el.addEventListener("click", (event) => void handleUndoClick(event, ui));

	panels.set(view, ui);
	return ui;
}

/**
 * AI: Builds a button that mimics the native "Add property" text button
 * (`text-button-icon` + `text-button-label`), but under our own class so the
 * native add button selector never matches it.
 */
function createActionButton(icon: string, label: string): {
	el: HTMLDivElement;
	iconEl: HTMLElement;
	labelEl: HTMLElement;
} {
	const el = document.createElement("div");
	el.classList.add(ACTION_CLASS, "text-icon-button");
	el.setAttribute("role", "button");
	el.setAttribute("tabindex", "0");

	const iconEl = document.createElement("span");
	iconEl.classList.add("text-button-icon");
	setIcon(iconEl, icon);

	const labelEl = document.createElement("span");
	labelEl.classList.add("text-button-label");
	labelEl.setText(label);

	el.append(iconEl, labelEl);
	return { el, iconEl, labelEl };
}

/**
 * AI: Places the two elements around the native add button, idempotently.
 * `after`/`before` move an already-parented node instead of duplicating it.
 */
function attach(ui: PanelUI, addButton: HTMLElement): void {
	if (addButton.previousElementSibling !== ui.statusEl) {
		addButton.before(ui.statusEl);
	}
	if (ui.actionsEl.previousElementSibling !== addButton) {
		addButton.after(ui.actionsEl);
	}
}

/**
 * AI: Keeps a scoped observer on the view's metadata container so the toolbar
 * survives the panel being re-rendered. The container itself can be replaced
 * by Obsidian, so the observer is re-created when the target changes.
 */
function observe(ui: PanelUI, container: HTMLElement): void {
	if (ui.observedContainer === container) return;

	ui.observer?.disconnect();
	ui.observedContainer = container;

	ui.observer = new MutationObserver(() => {
		// The observed container may have been detached: nothing to do.
		if (!container.isConnected) return;

		// The add button may be a brand new node after a re-render, re-query it.
		const addButton = container.querySelector<HTMLElement>(ADD_BUTTON_SELECTOR);
		if (!addButton) return;

		// Only re-attach: the elements keep their content, so there is no need
		// to recompute the status on every panel mutation (that would mean a
		// disk read per keystroke). Status changes are driven by the
		// metadataCache listener instead.
		attach(ui, addButton);
	});

	ui.observer.observe(container, { childList: true, subtree: true });
}

/**
 * AI: Recomputes the whole toolbar of a view.
 *
 * `fresh` forces a disk read instead of using the metadata cache. It is used
 * after an explicit action: `vault.modify` resolves before Obsidian refreshes
 * the metadata cache, so reading the cache right after a write would show the
 * OLD status and the button would not advance in place.
 */
async function refreshPanel(ui: PanelUI, fresh = false): Promise<void> {
	const file = ui.view.file;
	if (!file) {
		setStatus(ui, STATUS_NEUTRAL);
		setReconformUnavailable(ui, "No file is open in this view");
		updateUndoState(ui);
		return;
	}

	if (isTemplateFile(file)) {
		await refreshTemplatePanel(ui, file);
	} else {
		await refreshNotePanel(ui, file, fresh);
	}

	updateUndoState(ui);
}

/** AI: Status/actions of a regular note, compared to its template. */
async function refreshNotePanel(ui: PanelUI, file: TFile, fresh: boolean): Promise<void> {
	const template = getTemplateOfFile(file);
	if (!template) {
		setStatus(ui, STATUS_NEUTRAL);
		setReconformUnavailable(ui, "No template applies to this note");
		return;
	}

	const currentProps = fresh ? await getFileProps(file) : getFilePropsMapFromCache(file);
	const templateProps = fresh ? await getFileProps(template) : getFilePropsMapFromCache(template);

	// The view may have switched file while reading from disk: drop the result.
	if (ui.view.file !== file) return;

	const status = computeMapConformance(currentProps, templateProps);

	setStatus(ui, NOTE_STATUS[status]);
	setReconform(ui, status, false);

	// AI: G4 guardrail. If the setting is off, the expressions would be pasted
	// as literal text: say it in the tooltip instead of silently doing it.
	const warning = templaterWarning(templateProps);
	if (warning) {
		ui.reconformEl.setAttribute("aria-label", `${ui.reconformEl.getAttribute("aria-label")} — ${warning}`);
	}
}

/**
 * AI: G4 — non-invasive warning shown on the reconform button when the template
 * carries Templater expressions but evaluating them is disabled.
 */
function templaterWarning(templateProps: Map<string, any>): string | null {
	if (getSettings().evaluateTemplaterInNotes) return null;

	const hasExpression = [...templateProps.values()].some(hasTemplaterSyntax);
	return hasExpression
		? "The template contains Templater expressions; enable \"Evaluate Templater scripts in notes\" to render them"
		: null;
}

/** AI: Status/actions of a template file, compared to its parent template. */
async function refreshTemplatePanel(ui: PanelUI, file: TFile): Promise<void> {
	const parentTemplate = getTemplateOfFile(file);
	if (!parentTemplate) {
		setStatus(ui, STATUS_NO_PARENT);
		setReconformUnavailable(ui, "This template has no parent template");
		return;
	}

	const comparison = await isTemplateCoherentToParentTemplate(file);

	// The view may have switched file while reading from disk: drop the result.
	if (ui.view.file !== file) return;

	// "needed" wins over "extra": the important direction is that a template
	// includes every property of its parent.
	const status: MapConformanceStatus = comparison.neededProps.size > 0
		? "missing"
		: comparison.extraProps.size > 0 ? "extra" : "ok";

	setStatus(ui, comparison.isValid ? TEMPLATE_STATUS.coherent : TEMPLATE_STATUS.divergent);
	setReconform(ui, status, true);
}

/** AI: Applies a status indicator configuration. */
function setStatus(ui: PanelUI, config: StatusConfig): void {
	ui.statusEl.empty();
	setIcon(ui.statusEl, config.icon);
	ui.statusEl.classList.remove(...STATUS_MODS);
	ui.statusEl.classList.add(`is-${config.mod}`);
	ui.statusEl.setAttribute("aria-label", config.label);
}

/** AI: Binds a reconform phase to the button and enables it. */
function setReconform(ui: PanelUI, status: MapConformanceStatus, isTemplate: boolean): void {
	const config = PHASE_CONFIG[status];

	ui.reconformMode = config.mode;
	ui.reconformEl.classList.remove(DISABLED_CLASS);
	ui.reconformEl.removeAttribute("aria-disabled");

	ui.reconformIconEl.empty();
	setIcon(ui.reconformIconEl, config.icon);
	ui.reconformLabelEl.setText(config.label);

	ui.reconformEl.setAttribute("aria-label", reconformTooltip(isTemplate, config.action));
}

/** AI: Disables the reconform button when there is no template to work from. */
function setReconformUnavailable(ui: PanelUI, reason: string): void {
	ui.reconformMode = null;
	ui.reconformEl.classList.add(DISABLED_CLASS);
	ui.reconformEl.setAttribute("aria-disabled", "true");
	ui.reconformEl.setAttribute("aria-label", reason);
}

/**
 * AI: Contextual tooltip (C5): templates are reconformed against their parent
 * template, notes against their template.
 */
function reconformTooltip(isTemplate: boolean, action: string): string {
	return isTemplate
		? `Reconform from parent template: ${action}`
		: `Reconform from template: ${action}`;
}

/** AI: Enables/disables the undo button based on the view's history stack. */
function updateUndoState(ui: PanelUI): void {
	const enabled = hasHistory(ui.view);
	ui.undoEl.classList.toggle(DISABLED_CLASS, !enabled);
	ui.undoEl.setAttribute("aria-disabled", String(!enabled));
}

/**
 * AI: Runs the phase currently bound to the reconform button.
 * Snapshot semantics (B1): the frontmatter is captured BEFORE the change and
 * pushed onto the history stack only when the file actually changed.
 */
async function handleReconformClick(event: MouseEvent, ui: PanelUI): Promise<void> {
	event.preventDefault();

	const mode = ui.reconformMode;
	const file = ui.view.file;
	if (!mode || !file) return;

	const snapshot = await getFileProps(file);
	const changed = await reconformFile(file, mode);
	if (changed) push(ui.view, snapshot);

	// Fresh: the metadata cache is not yet updated right after the write.
	await refreshPanel(ui, true);
}

/** AI: Restores the previous snapshot and recomputes the toolbar. */
async function handleUndoClick(event: MouseEvent, ui: PanelUI): Promise<void> {
	event.preventDefault();

	if (!hasHistory(ui.view)) return;

	await undo(ui.view);
	await refreshPanel(ui, true);
}

/** AI: Refreshes the panels of the views showing (or inheriting) `file`. */
function refreshViewsForFile(file: TFile): void {
	for (const view of [...trackedViews]) {
		const current = view.file;
		if (!current) continue;

		const isShown = current.path === file.path;
		const usesAsTemplate = getTemplateOfFile(current)?.path === file.path;
		if (!isShown && !usesAsTemplate) continue;

		const ui = panels.get(view);
		if (ui) void refreshPanel(ui);
	}
}

/** AI: Removes a view's toolbar from the DOM and forgets it. */
function detach(view: MarkdownView): void {
	trackedViews.delete(view);

	const ui = panels.get(view);
	if (!ui) return;

	ui.observer?.disconnect();
	ui.statusEl.remove();
	ui.actionsEl.remove();
	panels.delete(view);
}
