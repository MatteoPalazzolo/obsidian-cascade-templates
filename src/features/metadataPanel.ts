import { MarkdownView, Plugin, TFile, Workspace, debounce } from "obsidian";
import {
	computeReconformProps,
	computeTemplateConformance,
	getFileProps,
	getFilePropsMapFromCache,
	getTemplateOfFile,
	reconformFile,
	type ReconformMode,
} from "../core/templateAPI";
import { areMapsEqual, computeMapConformance, type MapConformanceStatus } from "../core/mapOperations";
import { back, clear as clearHistory, hasHistory, onHistoryChange, push } from "../core/reconformHistory";
import { hasTemplaterSyntax } from "../core/templaterBridge";
import { getSettings, isTemplateFile } from "../settings";
import { setIconSafe } from "../utils/icons";

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
 * 3. the action buttons shown RIGHT of it: the cursor-driven reconform button
 *    (C3/H1: it advances one phase per click, starting from the base phase and
 *    stopping on the last one) and the Back button (C4/H2: it reverses the last
 *    press and rewinds the cursor by one phase).
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
 *         <div class="cascade-templates-action"> back </div>
 *
 * Row layout: [status] [Add property] [reconform] [back].
 *
 * Conformance semantics:
 * - A NOTE is compared to its nearest ancestor `!Template.md`.
 * - A TEMPLATE is compared to its own nearest ancestor template (parent), via
 *   `computeTemplateConformance`.
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
	/** AI: Dynamic reconform button (C3), now driven by a per-view cursor (H1). */
	reconformEl: HTMLDivElement;
	reconformIconEl: HTMLElement;
	reconformLabelEl: HTMLElement;
	/**
	 * AI: H1 — cursor position of the reconform button (0..2 = pending phase,
	 * 3 = sequence exhausted / idle). Disjoint from the conformance status.
	 */
	phase: ReconformPhase;
	/** AI: H1 — path of the file the cursor belongs to (resets on file switch). */
	phaseFile: string | null;
	/** AI: Mode currently bound to the button (null = inert or unavailable). */
	reconformMode: ReconformMode | null;
	/** AI: Reconform context (template vs note); null = no template (disabled). */
	reconformIsTemplate: boolean | null;
	/**
	 * AI: H4 — current/reference frontmatter, used to classify the bound phase as
	 * a no-op (a live action that would change nothing). Null when unavailable.
	 *
	 * `reconformCurrent` doubles as the SESSION BASELINE: it is the frontmatter as
	 * of the last refresh, so a content change that makes it diverge means the
	 * note was edited outside the button and the cursor/Back stack must restart.
	 */
	reconformCurrent: Map<string, any> | null;
	reconformReference: Map<string, any> | null;
	/** AI: H3 — G4 Templater warning kept on the reconform tooltip, if any. */
	reconformWarning: string | null;
	/** AI: Back button (C4/H2): reverses the last reconform press. */
	backEl: HTMLDivElement;
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
/** AI: H4 — attenuated look for a live phase that would change nothing (no-op). */
const NOOP_CLASS = "cascade-templates-noop";
/** AI: H5 — fixed-width marker for the reconform button only. */
const RECONFORM_CLASS = "cascade-templates-reconform";
const BACK_CLASS = "cascade-templates-back";
/** AI: D1 — hides the toolbar when the "only when a template applies" policy is on. */
const HIDDEN_CLASS = "cascade-templates-hidden";
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
 * AI: Cursor position of the dynamic reconform button (H1). It is a per-view UI
 * state, deliberately DISJOINT from the conformance status: the sequence always
 * starts at the base phase and advances one step per click.
 *   0 add-missing    → add the template props the file lacks
 *   1 remove-extra   → drop the props the template does not have
 *   2 reset-defaults → overwrite the values with the template defaults
 *   3 exhausted      → no further action: the button keeps the Reset look but
 *                      is hard-disabled until Back rewinds the cursor
 */
type ReconformPhase = 0 | 1 | 2 | 3;

/**
 * AI: The three executable phases, in order. Label/icon/action are looked up by
 * phase index; the button no longer derives its phase from conformance (H1).
 */
// UPDATE --> ALIGN --> RESET --> OFF
// stamp, hammer
const PHASE_CONFIG: PhaseConfig[] = [
	{ mode: "add-missing", icon: "wrench", label: "Update", action: "add the missing properties" },
	{ mode: "remove-extra", icon: "anvil", label: "Align", action: "remove the extra properties" },
	{ mode: "reset-defaults", icon: "brush-cleaning", label: "Reset", action: "reset the properties to defaults" },
];

/** AI: End of the sequence; the cursor clamps here and stays idle. */
const PHASE_DONE = PHASE_CONFIG.length as ReconformPhase;

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

	// Keep the Back buttons in sync with the history stacks (B3) and, per H1,
	// restart the cursor whenever the stack empties (back / file switch / clear).
	unsubscribeHistory = onHistoryChange((view, viewHasHistory) => {
		const ui = panels.get(view);
		if (!ui) return;
		if (!viewHasHistory) resetCursor(ui);
		updateBackState(ui);
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

	const reconform = createActionButton("list-restart", "Reconform");
	reconform.el.classList.add(RECONFORM_CLASS);
	const backBtn = createActionButton("undo-2", "Back", true);
	backBtn.el.classList.add(BACK_CLASS);
	actionsEl.append(reconform.el, backBtn.el);

	const ui: PanelUI = {
		view,
		statusEl,
		actionsEl,
		reconformEl: reconform.el,
		reconformIconEl: reconform.iconEl,
		reconformLabelEl: reconform.labelEl,
		reconformMode: null,
		reconformIsTemplate: null,
		reconformCurrent: null,
		reconformReference: null,
		reconformWarning: null,
		phase: 0,
		phaseFile: null,
		backEl: backBtn.el,
		observer: null,
		observedContainer: null,
	};

	reconform.el.addEventListener("click", (event) => void handleReconformClick(event, ui));
	backBtn.el.addEventListener("click", (event) => void handleBackClick(event, ui));

	panels.set(view, ui);
	return ui;
}

/**
 * AI: Builds a button that mimics the native "Add property" text button
 * (`text-button-icon` + `text-button-label`), but under our own class so the
 * native add button selector never matches it.
 */
function createActionButton(icon: string, label: string, flipped=false): {
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
	setIconSafe(iconEl, icon);

	const labelEl = document.createElement("span");
	labelEl.classList.add("text-button-label");
	labelEl.setText(label);

	if (flipped) {
		el.append(labelEl, iconEl);
	} else {
		el.append(iconEl, labelEl);
	}

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
 * AI: Recomputes the whole toolbar of a view (status + reconform cursor + Back).
 *
 * A note and a template share the same reference (the nearest ancestor
 * `!Template.md`); only the status semantics differ:
 * - note → `computeMapConformance` against that template;
 * - template → `computeTemplateConformance` against its parent template.
 *
 * `fresh` forces a disk read instead of using the metadata cache. It is used
 * after an explicit action: `vault.modify` resolves before Obsidian refreshes
 * the metadata cache, so reading the cache right after a write would show the
 * OLD status and the button would not advance in place.
 *
 * `contentChanged` marks a refresh caused by a real file-content change (the
 * `metadataCache` "changed" event). Only then do we compare the frontmatter with
 * the session baseline: a divergence means the note was edited outside the
 * button, so the reconform session (cursor + Back stack) restarts.
 */
async function refreshPanel(ui: PanelUI, fresh = false, contentChanged = false): Promise<void> {
	// The cursor belongs to the file shown by the view: a different file resets
	// it before anything is recomputed.
	ensureCursor(ui);

	// AI: D1 — "only when a template applies" keeps the panel out of unrelated
	// notes; the default "always" preserves the neutral state.
	const hideWithoutTemplate = getSettings().panelVisibility === "onlyWithTemplate";

	const file = ui.view.file;
	if (!file) {
		setPanelVisible(ui, !hideWithoutTemplate);
		setStatus(ui, STATUS_NEUTRAL);
		setReconformUnavailable(ui, "No file is open in this view");
		updateBackState(ui);
		return;
	}

	const isTemplate = isTemplateFile(file);
	const reference = getTemplateOfFile(file);
	if (!reference) {
		setPanelVisible(ui, !hideWithoutTemplate);
		setStatus(ui, isTemplate ? STATUS_NO_PARENT : STATUS_NEUTRAL);
		setReconformUnavailable(ui, isTemplate
			? "This template has no parent template"
			: "No template applies to this note");
		updateBackState(ui);
		return;
	}

	setPanelVisible(ui, true);

	const currentProps = fresh ? await getFileProps(file) : getFilePropsMapFromCache(file);
	const referenceProps = fresh ? await getFileProps(reference) : getFilePropsMapFromCache(reference);

	// The view may have switched file while reading from disk: drop the result.
	if (ui.view.file !== file) return;

	// AI: a manual property edit ends the reconform session. Our own writes also
	// emit "changed", but they run a `fresh` refresh first (below) which adopts
	// the new props as the baseline, so this comparison only fires for a real
	// external edit. `reconformCurrent` is that baseline (see PanelUI).
	if (contentChanged && !fresh && ui.reconformCurrent !== null && !areMapsEqual(ui.reconformCurrent, currentProps)) {
		clearHistory(ui.view);
	}

	if (isTemplate) {
		const comparison = computeTemplateConformance(currentProps, referenceProps);
		setStatus(ui, comparison.isValid ? TEMPLATE_STATUS.coherent : TEMPLATE_STATUS.divergent, reference.path);
	} else {
		const status = computeMapConformance(currentProps, referenceProps);
		setStatus(ui, NOTE_STATUS[status], reference.path);
	}

	// AI: G4 guardrail. If the setting is off, the expressions would be pasted as
	// literal text: keep the warning on the reconform tooltip.
	ui.reconformWarning = isTemplate ? null : templaterWarning(referenceProps);

	// H1: the status indicator above is derived from conformance; the button
	// follows the cursor instead. H4 passes the maps along so each phase can be
	// classified as active / no-op.
	setReconformAvailable(ui, isTemplate, currentProps, referenceProps);

	updateBackState(ui);
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

/**
 * AI: D1 — shows/hides the injected toolbar without detaching it, so switching
 * the setting back restores the exact same elements and state.
 */
function setPanelVisible(ui: PanelUI, visible: boolean): void {
	ui.statusEl.classList.toggle(HIDDEN_CLASS, !visible);
	ui.actionsEl.classList.toggle(HIDDEN_CLASS, !visible);
}

/** AI: Applies a status indicator configuration, with the reference path (H3). */
function setStatus(ui: PanelUI, config: StatusConfig, referencePath?: string): void {
	ui.statusEl.empty();
	setIconSafe(ui.statusEl, config.icon);
	ui.statusEl.classList.remove(...STATUS_MODS);
	ui.statusEl.classList.add(`is-${config.mod}`);

	// H3: the indicator tooltip carries the state AND the path of the template it
	// was compared against (omitted for the neutral "no template" states).
	const label = referencePath ? `${config.label} — ${referencePath}` : config.label;
	ui.statusEl.setAttribute("aria-label", label);
}

/**
 * AI: Marks the reconform button as usable and renders its current cursor phase.
 * `isTemplate` only affects the tooltip wording (parent vs template); the maps
 * let the button classify each phase as a real action or a no-op (H4).
 */
function setReconformAvailable(
	ui: PanelUI,
	isTemplate: boolean,
	currentProps: Map<string, any>,
	referenceProps: Map<string, any>
): void {
	ui.reconformIsTemplate = isTemplate;
	ui.reconformCurrent = currentProps;
	ui.reconformReference = referenceProps;
	renderReconform(ui);
}

/**
 * AI: H1/H4/H5 — paints the button from the cursor position, independently of
 * conformance, using the three-level convention:
 *   1. active   → no modifier: a live action that would change something;
 *   2. no-op    → attenuated (NOOP_CLASS): live, but it would change nothing;
 *   3. disabled → hard-disabled (DISABLED_CLASS): no template, or end of the
 *                 sequence (the button keeps the Reset look until Back rewinds).
 * No-op while no template is available (`setReconformUnavailable` decides that).
 */
function renderReconform(ui: PanelUI): void {
	if (ui.reconformIsTemplate === null) return;

	const config = phaseConfig(ui.phase);
	const mode = phaseMode(ui.phase);
	ui.reconformMode = mode;

	// End of the sequence: `mode` is null, so it is exactly the "exhausted" case.
	const exhausted = mode === null;
	ui.reconformEl.classList.toggle(DISABLED_CLASS, exhausted);
	ui.reconformEl.setAttribute("aria-disabled", String(exhausted));

	// H4: a live phase that would leave the frontmatter untouched is attenuated.
	ui.reconformEl.classList.toggle(NOOP_CLASS, isNoop(ui, mode));

	ui.reconformIconEl.empty();
	setIconSafe(ui.reconformIconEl, config.icon);
	ui.reconformLabelEl.setText(config.label);

	const base = reconformTooltip(ui.reconformIsTemplate, config.action);
	ui.reconformEl.setAttribute("aria-label", ui.reconformWarning ? `${base} — ${ui.reconformWarning}` : base);
}

/**
 * AI: H4 — `true` when the given phase would leave the frontmatter unchanged (a
 * "no-op" press). Computed with the same merge `reconformFile` uses, so the
 * attenuation matches what the press will actually do.
 */
function isNoop(ui: PanelUI, mode: ReconformMode | null): boolean {
	if (mode === null || ui.reconformCurrent === null || ui.reconformReference === null) return false;
	const result = computeReconformProps(ui.reconformReference, ui.reconformCurrent, mode);
	return areMapsEqual(ui.reconformCurrent, result);
}

/** AI: Visual/action config of a phase; the last phase is shown while idle. */
function phaseConfig(phase: ReconformPhase): PhaseConfig {
	return PHASE_CONFIG[Math.min(phase, PHASE_CONFIG.length - 1)];
}

/** AI: Mode bound to a phase, or null once the cursor is exhausted (inert). */
function phaseMode(phase: ReconformPhase): ReconformMode | null {
	return phase < PHASE_DONE ? PHASE_CONFIG[phase].mode : null;
}

/**
 * AI: H1 — the cursor is a per-view UI state, but a NEW file replacing the
 * current one in the same view must restart it (same B2 trigger as the Back
 * stack). The path is the anchor: Obsidian may hand back a different TFile
 * instance for the same file.
 */
function ensureCursor(ui: PanelUI): void {
	const path = ui.view.file?.path ?? null;
	if (path !== ui.phaseFile) {
		ui.phase = 0;
		ui.phaseFile = path;
		// Drop the previous file's props so a stale no-op classification cannot
		// flash before the next refresh recomputes them.
		ui.reconformCurrent = null;
		ui.reconformReference = null;
	}
}

/** AI: H1 — restarts the sequence from the base phase and repaints the button. */
function resetCursor(ui: PanelUI): void {
	ui.phase = 0;
	renderReconform(ui);
}

/** AI: Hard-disables the reconform button when there is no template to work from. */
function setReconformUnavailable(ui: PanelUI, reason: string): void {
	ui.reconformMode = null;
	ui.reconformIsTemplate = null;
	ui.reconformCurrent = null;
	ui.reconformReference = null;
	ui.reconformWarning = null;
	ui.reconformEl.classList.remove(NOOP_CLASS);
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

/** AI: Enables/disables the Back button based on the view's history stack. */
function updateBackState(ui: PanelUI): void {
	const enabled = hasHistory(ui.view);
	ui.backEl.classList.toggle(DISABLED_CLASS, !enabled);
	ui.backEl.setAttribute("aria-disabled", String(!enabled));
}

/**
 * AI: Runs the phase currently bound to the reconform button (H1).
 *
 * H2 snapshot semantics: the frontmatter AND the cursor phase are captured
 * BEFORE the press and pushed UNCONDITIONALLY, so Back always has one step to
 * reverse even when the action changed nothing on disk.
 */
async function handleReconformClick(event: MouseEvent, ui: PanelUI): Promise<void> {
	event.preventDefault();

	// Keep the cursor coherent with the file before reading its bound mode.
	ensureCursor(ui);

	const mode = ui.reconformMode;
	const file = ui.view.file;
	// Inert: no template available, or the sequence already reached the end.
	if (!mode || !file) return;

	const propsBefore = await getFileProps(file);
	const phaseBefore = ui.phase;

	await reconformFile(file, mode);

	// The view may have switched file while reading/writing: don't stack a step
	// that belongs to a different note.
	if (ui.view.file?.path !== file.path) return;

	push(ui.view, propsBefore, phaseBefore);

	// H1: advance one phase per live click, even when the action was a no-op,
	// then clamp at the end so the sequence always starts at the base and stops
	// on the last phase.
	ui.phase = Math.min(ui.phase + 1, PHASE_DONE) as ReconformPhase;

	// Fresh: the metadata cache is not yet updated right after the write.
	await refreshPanel(ui, true);
}

/**
 * AI: Rewinds the last reconform press (H2): restores the frontmatter captured
 * before it and moves the cursor back to its previous phase.
 */
async function handleBackClick(event: MouseEvent, ui: PanelUI): Promise<void> {
	event.preventDefault();

	const restored = await back(ui.view);
	if (!restored) return;

	// Back rewinds the cursor to the phase it had before the reversed press.
	ui.phase = restored.phase as ReconformPhase;

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
		if (ui) void refreshPanel(ui, false, true);
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
