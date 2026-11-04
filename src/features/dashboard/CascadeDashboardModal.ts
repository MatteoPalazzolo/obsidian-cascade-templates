import { App, Menu, Modal, Notice, TFile, type EventRef } from "obsidian";
import {
	areMapsEqual,
} from "../../core/mapOperations";
import { computeReconformProps, type ReconformMode } from "../../core/conformance";
import { diffProps, REMOVED } from "../../core/frontmatterChanges";
import {
	baseName,
	countIssues,
	collectIssueGroups,
	type Forest,
	type ForestFileNode,
	type ForestFolderNode,
	type ScopeCounts,
} from "../../core/forest";
import {
	appendEntryToOperation,
	appendOperation,
	distinctFolders,
	enforceBudget,
	entryCount,
	estimateOperationBytes,
	listEntries,
	planRewind,
	removeEntries,
	type JournalEntry,
	type JournalFileChange,
	type JournalOperation,
	type RewindPlan,
} from "../../core/journal";
import { applyFrontmatterPatch, getFileProps } from "../../core/templateAPI";
import { areDashboardTabsEnabled, getTemplateFilename } from "../../settings";
import { setIconSafe } from "../../utils/icons";
import { runBatch, type BatchOutcome, type BatchTarget } from "./actions";
import { confirmAction, confirmList, confirmMuted, confirmParagraph } from "./confirm";
import { getJournal } from "./journalStore";
import { buildVaultForest, type VaultForestSnapshot } from "./vaultForest";

/**
 * AI: Cascade dashboard modal (feature B).
 *
 * Role in the architecture:
 * Replaces the flat scanner with a structural dashboard:
 * - `Cascade`: read-only map of local roots, folders, templates and notes;
 * - `Issues`: the actionable list with the typed verbs and the sound-chain gate;
 * - `History`: the in-session journal of dashboard operations.
 *
 * `Issues` and `History` are experimental and live behind the `dashboardTabs`
 * setting. When it is off the modal shows the `Cascade` map directly, with no
 * tab strip and no global actions: the default surface can never write by
 * accident.
 *
 * The modal owns presentation and orchestration only. Pure rules live in
 * `core/forest.ts` and `core/journal.ts`; writes live in `core/templateAPI.ts`
 * and `./actions.ts`.
 */

type TabId = "cascade" | "issues" | "history";

interface RowModel {
	id: string;
	kind: "folder" | "notes" | "note";
	level: number;
	parentId: string | null;
	hasChildren: boolean;
	expanded: boolean;
	label: string;
	folder?: ForestFolderNode;
	node?: ForestFileNode;
	noteCount?: number;
	context: boolean;
}

interface DashboardError {
	tab: "issues" | "history";
	title: string;
	lines: string[];
	/** AI: a rewind failed: the card can retry the same entry. */
	retryEntryId?: string;
	retryLatest?: boolean;
}

interface VerbConfig {
	mode: ReconformMode;
	label: string;
	fullLabel: string;
	icon: string;
}

interface FolderVerb extends VerbConfig {
	nodes: ForestFileNode[];
	blocked: boolean;
}

const TAB_LABELS: Record<TabId, string> = {
	cascade: "Cascade",
	issues: "Issues",
	history: "History",
};

/**
 * AI: Notes are folded into an `N notes` group only when the folder lists more
 * than this many notes. At or below the threshold they are listed directly, and
 * a leaf folder never uses the group: collapsing the folder already hides them.
 */
const NOTES_GROUP_THRESHOLD = 3;

const SNIPPET = `projects/
├── !Template.md
│   ---
│   status:
│   owner:
│   ---
└── alpha/
    └── note.md`;

/** AI: Icon of the status badge; `none` stays absent (attenuated row). */
function stateIcon(node: ForestFileNode | ForestFolderNode): string {
	if (node.kind === "folder" || node.kind === "template") {
		if (node.state === "ok") return "file-check";
		if (node.state === "missing") return "file-x";
		return "circle-dashed";
	}

	if (node.state === "ok") return "circle-check-big";
	if (node.state === "extra") return "circle-alert";
	if (node.state === "missing") return "circle-x";
	return "circle-dashed";
}

function stateLabel(state: string): string {
	switch (state) {
		case "ok":
			return "In sync";
		case "missing":
			return "Missing properties";
		case "extra":
			return "Extra properties";
		default:
			return "No frontmatter";
	}
}

function isTemplatePath(path: string): boolean {
	const name = getTemplateFilename();
	return path === name || path.endsWith(`/${name}`);
}

function formatTime(at: number): string {
	return new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(at));
}

function formatValue(value: unknown): string {
	if (value === REMOVED) return "(removed)";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

function truncate(text: string, max = 60): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export class CascadeDashboardModal extends Modal {
	private snapshot: VaultForestSnapshot | null = null;
	private tab: TabId = "cascade";
	private busy = false;
	private busyLabel = "";
	private loading = true;
	private waitingCount = 0;
	private error: DashboardError | null = null;
	private expanded = new Set<string>();
	private activeRowId: string | null = null;
	private pendingFocusId: string | null = null;
	private issuesExpanded = false;
	private rootsInitialized = false;
	private loadStarted = false;
	private indexTimer: number | null = null;
	private metadataRefs: EventRef[] = [];
	private rowElements = new Map<string, HTMLElement>();
	private progressTextEl: HTMLElement | null = null;
	private closed = false;
	private indexCheckTimer: number | null = null;
	private subtreeCache = new Map<string, {
		templates: ForestFileNode[];
		notesMissing: ForestFileNode[];
		notesExtra: ForestFileNode[];
	}>();

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		this.closed = false;
		this.modalEl.addClass("CascadeDashboardModal");
		this.setTitle("Cascade dashboard");
		this.installGuards();
		void this.load();
	}

	onClose(): void {
		this.closed = true;
		this.disposeIndexWait();
		this.contentEl.empty();
	}

	// ---------------------------------------------------------------- loading

	/**
	 * AI: Waits for the metadata cache only when it is actually incomplete.
	 * After the timeout a non-indexed file is treated as a note without
	 * frontmatter, so the dashboard never gets stuck behind a slow index.
	 */
	private async load(): Promise<void> {
		if (this.loadStarted) return;
		this.loadStarted = true;

		this.loading = true;
		this.waitingCount = this.countPending();
		if (this.waitingCount > 0) {
			this.render();
			this.metadataRefs.push(
				this.app.metadataCache.on("resolve", () => this.scheduleIndexCheck()),
				this.app.metadataCache.on("resolved", () => this.scheduleIndexCheck())
			);
			this.indexTimer = window.setTimeout(() => this.finishLoading(), 3000);
			return;
		}

		this.finishLoading();
	}

	private countPending(): number {
		let pending = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!this.app.metadataCache.getFileCache(file)) pending++;
		}
		return pending;
	}

	/**
	 * AI: `resolve` fires once per file: coalescing the count avoids a full
	 * vault walk for every indexed note on a large vault.
	 */
	private scheduleIndexCheck(): void {
		if (this.indexCheckTimer !== null) return;
		this.indexCheckTimer = window.setTimeout(() => {
			this.indexCheckTimer = null;
			this.checkIndexing();
		}, 120);
	}

	private checkIndexing(): void {
		const pending = this.countPending();
		this.waitingCount = pending;
		if (pending === 0) {
			this.finishLoading();
		} else {
			this.waitingCount = pending;
			if (this.loading) this.render();
		}
	}

	private finishLoading(): void {
		this.disposeIndexWait();
		this.loading = false;
		this.rebuildForest();
		if (!this.rootsInitialized && this.snapshot) {
			this.rootsInitialized = true;
			for (const root of this.snapshot.forest.roots) this.expanded.add(`f:${root.path}`);
		}
		this.render();
	}

	private disposeIndexWait(): void {
		if (this.indexTimer !== null) {
			window.clearTimeout(this.indexTimer);
			this.indexTimer = null;
		}
		if (this.indexCheckTimer !== null) {
			window.clearTimeout(this.indexCheckTimer);
			this.indexCheckTimer = null;
		}
		for (const ref of this.metadataRefs) this.app.metadataCache.offref(ref);
		this.metadataRefs = [];
	}

	private rebuildForest(): void {
		this.subtreeCache.clear();
		try {
			this.snapshot = buildVaultForest(this.app);
		} catch (error) {
			console.error("[cascade-templates] Could not build the cascade forest", error);
			this.snapshot = null;
		}
	}

	// --------------------------------------------------------------- rendering

	private render(): void {
		if (this.closed) return;

		const root = createDiv({ cls: "ct-dashboard" });
		const tabsEnabled = areDashboardTabsEnabled();

		if (tabsEnabled) {
			this.renderHeader(root);
			this.renderTabs(root);
		} else {
			this.tab = "cascade";
		}

		if (this.busy) this.renderProgress(root);

		const body = createDiv({ cls: "ct-dashboard-body" });
		root.append(body);

		if (this.loading) {
			this.renderWaiting(body);
		} else if (!this.snapshot) {
			body.createEl("p", { cls: "ct-empty-text", text: "The vault could not be read." });
		} else if (this.tab === "issues" && tabsEnabled) {
			this.renderIssues(body);
		} else if (this.tab === "history" && tabsEnabled) {
			this.renderHistory(body);
		} else {
			this.renderCascade(body);
		}

		this.contentEl.empty();
		this.contentEl.append(root);
		this.restoreFocus();
	}

	private renderHeader(parent: HTMLElement): void {
		const header = createDiv({ cls: "ct-dashboard-header" });
		const forest = this.snapshot?.forest;

		const fixAll = createEl("button", { cls: "ct-fix-all mod-cta" });
		const icon = createSpan({ cls: "ct-fix-all-icon" });
		setIconSafe(icon, "sparkles");
		fixAll.append(icon);
		fixAll.createSpan({ text: `Fix all (${forest ? countIssues(forest) : 0})` });
		const issues = forest ? countIssues(forest) : 0;
		fixAll.disabled = this.busy || issues === 0;
		fixAll.setAttribute("aria-label", issues === 0 ? "No issues to fix" : "Fix all issues");
		fixAll.addEventListener("click", () => void this.runFixAll());
		header.append(fixAll);

		const undo = createEl("button", { cls: "ct-undo clickable-icon" });
		setIconSafe(undo, "undo-2");
		const canUndo = entryCount(getJournal()) > 0 && !this.busy;
		undo.disabled = !canUndo;
		undo.setAttribute("aria-label", "Undo the last dashboard operation");
		undo.title = "Undo last batch";
		undo.addEventListener("click", () => {
			const entries = listEntries(getJournal());
			const last = entries[entries.length - 1];
			if (last) void this.undoFrom(last.id, true);
		});
		header.append(undo);

		parent.append(header);
	}

	private renderProgress(parent: HTMLElement): void {
		const progress = createDiv({ cls: "ct-progress" });
		progress.createDiv({ cls: "ct-progress-line" });
		this.progressTextEl = progress.createDiv({ cls: "ct-progress-text", text: this.busyLabel });
		parent.append(progress);
	}

	private renderTabs(parent: HTMLElement): void {
		const journal = getJournal();
		const issues = this.snapshot ? countIssues(this.snapshot.forest) : 0;
		const history = entryCount(journal);
		const counts: Record<TabId, number | null> = {
			cascade: null,
			issues,
			history,
		};

		const nav = createDiv({ cls: "ct-dashboard-tabs" });
		nav.setAttribute("role", "tablist");

		for (const id of ["cascade", "issues", "history"] as const) {
			const count = counts[id];
			const label = count === null ? TAB_LABELS[id] : `${TAB_LABELS[id]} (${count})`;
			const tab = createEl("button", { cls: "ct-dashboard-tab", text: label });
			tab.setAttribute("role", "tab");
			tab.setAttribute("aria-selected", String(this.tab === id));
			tab.classList.toggle("is-active", this.tab === id);
			const disabled = this.busy || (count === 0 && this.tab !== id);
			tab.disabled = disabled;
			tab.setAttribute("aria-disabled", String(disabled));
			tab.addEventListener("click", () => {
				if (disabled) return;
				this.tab = id;
				this.render();
			});
			nav.append(tab);
		}

		parent.append(nav);
	}

	private renderWaiting(parent: HTMLElement): void {
		const empty = createDiv({ cls: "ct-empty" });
		empty.createEl("h4", { text: "Waiting for indexing…" });
		empty.createEl("p", {
			cls: "ct-empty-text",
			text: `${this.waitingCount} markdown file${this.waitingCount === 1 ? "" : "s"} still to index.`,
		});
		parent.append(empty);
	}

	private restoreFocus(): void {
		const id = this.pendingFocusId;
		if (!id) return;
		this.pendingFocusId = null;
		const row = this.rowElements.get(id);
		if (!row) return;
		row.focus({ preventScroll: true });
		row.scrollIntoView({ block: "nearest" });
	}

	// ------------------------------------------------------------------ cascade

	private renderCascade(parent: HTMLElement): void {
		if (!this.snapshot) return;
		const forest = this.snapshot.forest;

		if (forest.roots.length === 0) {
			this.renderEmptyGuide(parent);
			return;
		}

		const rows = this.buildCascadeRows(forest);
		this.renderTree(parent, rows, false);

		if (forest.outsideNotes.length > 0) {
			parent.createEl("p", {
				cls: "ct-outside",
				text: `${forest.outsideNotes.length} note${forest.outsideNotes.length === 1 ? " is" : "s are"} outside any cascade`,
			});
		}
	}

	private renderEmptyGuide(parent: HTMLElement): void {
		const empty = createDiv({ cls: "ct-empty" });
		empty.createEl("h4", { text: "No cascade found" });
		empty.createEl("p", {
			cls: "ct-empty-text",
			text: "A cascade starts from a folder that contains the template file. Nothing is created for you: the folder is the decision.",
		});

		const steps = empty.createEl("ol", { cls: "ct-guide-steps" });
		steps.createEl("li", { text: "Choose the root folder of the cascade." });
		steps.createEl("li", { text: `Create ${getTemplateFilename()} inside it with the properties to inherit.` });
		steps.createEl("li", { text: "Notes in that folder and below inherit those properties." });

		const pre = empty.createEl("pre", { cls: "ct-guide-snippet" });
		const snippet = SNIPPET.replace("!Template.md", getTemplateFilename());
		pre.createEl("code", { text: snippet });

		const copy = createEl("button", { cls: "ct-guide-copy", text: "Copy example" });
		copy.addEventListener("click", () => {
			const clipboard = navigator.clipboard;
			if (!clipboard) {
				new Notice("Could not copy the example.");
				return;
			}
			void clipboard.writeText(snippet).then(
				() => new Notice("Example copied to the clipboard."),
				() => new Notice("Could not copy the example.")
			);
		});
		empty.append(copy);
		parent.append(empty);
	}

	private buildCascadeRows(forest: Forest): RowModel[] {
		const rows: RowModel[] = [];
		const pushFolder = (folder: ForestFolderNode, level: number, parentId: string | null): void => {
			const folderId = `f:${folder.path}`;
			// A folder row is also the template row, so it only expands when it has
			// child folders or notes below it.
			const hasChildren = folder.folders.length > 0 || folder.notes.length > 0;
			const expanded = this.expanded.has(folderId);
			rows.push({
				id: folderId,
				kind: "folder",
				level,
				parentId,
				hasChildren,
				expanded,
				label: folderRowLabel(folder),
				folder,
				context: false,
			});

			if (!expanded) return;

			for (const child of folder.folders) pushFolder(child, level + 1, folderId);

			if (folder.notes.length > 0) {
				// Only a folder that also shows child template folders needs the
				// group, and only past the threshold: otherwise the notes are just
				// listed under the folder that already hides them when collapsed.
				const grouped = folder.folders.length > 0
					&& folder.notes.length > NOTES_GROUP_THRESHOLD;

				if (!grouped) {
					for (const note of folder.notes) {
						rows.push(this.fileRow(note, level + 1, folderId, note.state === "none"));
					}
					return;
				}

				const groupId = `g:${folder.path}`;
				// The group row is the collapsed state only: once expanded it makes
				// room for the notes themselves. Closing the folder recompacts it,
				// which is the only way back to the group.
				if (this.expanded.has(groupId)) {
					for (const note of folder.notes) {
						rows.push(this.fileRow(note, level + 1, folderId, note.state === "none"));
					}
					return;
				}

				rows.push({
					id: groupId,
					kind: "notes",
					level: level + 1,
					parentId: folderId,
					hasChildren: true,
					expanded: false,
					label: `${folder.notes.length} note${folder.notes.length === 1 ? "" : "s"}`,
					folder,
					noteCount: folder.notes.length,
					context: false,
				});
			}
		};

		for (const root of forest.roots) pushFolder(root, 0, null);
		return rows;
	}

	private fileRow(node: ForestFileNode, level: number, parentId: string, context: boolean): RowModel {
		return {
			id: `n:${node.path}`,
			kind: "note",
			level,
			parentId,
			hasChildren: false,
			expanded: false,
			label: node.name,
			node,
			context,
		};
	}

	// ------------------------------------------------------------------ issues

	private renderIssues(parent: HTMLElement): void {
		if (!this.snapshot) return;
		const forest = this.snapshot.forest;

		if (this.error?.tab === "issues") this.renderErrorCard(parent, this.error);

		if (countIssues(forest) === 0) {
			this.renderEmptyState(parent, "No issues", "Every note under a cascade matches its reference.");
			return;
		}

		// One tree for all issue kinds: the three groups used to repeat the same
		// ancestors three times and hid the fact that the verbs act on a folder
		// subtree. The folder rows carry the bulk verbs; the file rows keep the
		// single-file ones.
		const groups = collectIssueGroups(forest);
		const nodes = [...groups.templates, ...groups.notesMissing, ...groups.notesExtra];
		this.ensureIssuesExpanded(nodes);
		this.renderTree(parent, this.buildIssueRows(nodes), true);
	}

	private ensureIssuesExpanded(nodes: readonly ForestFileNode[]): void {
		if (this.issuesExpanded) return;
		this.issuesExpanded = true;

		const forest = this.snapshot?.forest;
		if (!forest) return;

		// Folders without a template are flattened, so the physical trail of a
		// note no longer maps to rows. Expand from the node's cascade folder up.
		for (const node of nodes) {
			let scope = node.scopeFolder;
			while (scope !== null) {
				this.expanded.add(`f:${scope}`);
				this.expanded.add(`g:${scope}`);
				scope = forest.folders.get(scope)?.parentPath ?? null;
			}
		}
	}

	private buildIssueRows(nodes: ForestFileNode[]): RowModel[] {
		if (!this.snapshot) return [];
		const matching = new Set(nodes.map(node => node.path));
		const rows: RowModel[] = [];

		const relevantFolders = new Map<string, boolean>();
		const folderRelevant = (folder: ForestFolderNode): boolean => {
			const memo = relevantFolders.get(folder.path);
			if (memo !== undefined) return memo;

			let relevant = folder.template !== null && matching.has(folder.template.path);
			if (!relevant) relevant = folder.notes.some(note => matching.has(note.path));
			if (!relevant) relevant = folder.folders.some(child => folderRelevant(child));
			if (!relevant) relevant = folder.localRoot && this.folderContainsMatch(folder, matching);
			relevantFolders.set(folder.path, relevant);
			return relevant;
		};

		const pushFolder = (folder: ForestFolderNode, level: number, parentId: string | null): void => {
			if (!folderRelevant(folder)) return;

			const folderId = `f:${folder.path}`;
			const expanded = this.expanded.has(folderId);
			// Only relevant content expands; the folder template has no row of its
			// own and is fixed by the folder bulk verb.
			const hasChildren = folder.notes.some(note => matching.has(note.path))
				|| folder.folders.some(child => folderRelevant(child));
			rows.push({
				id: folderId,
				kind: "folder",
				level,
				parentId,
				hasChildren,
				expanded,
				label: folderRowLabel(folder),
				folder,
				context: false,
			});

			if (!expanded) return;

			for (const child of folder.folders) pushFolder(child, level + 1, folderId);

			const notes = folder.notes.filter(note => matching.has(note.path));
			if (notes.length > 0) {
				// The group separates notes from the child folder rows. When no child
				// row is visible (leaf in this view) or the count is small, the notes
				// are listed directly under their folder.
				const grouped = folder.folders.some(child => folderRelevant(child))
					&& notes.length > NOTES_GROUP_THRESHOLD;

				if (!grouped) {
					for (const note of notes) {
						rows.push(this.fileRow(note, level + 1, folderId, false));
					}
					return;
				}

				const groupId = `g:${folder.path}`;
				// Expanded groups leave the room to the notes, as in the map.
				if (this.expanded.has(groupId)) {
					for (const note of notes) {
						rows.push(this.fileRow(note, level + 1, folderId, false));
					}
					return;
				}

				rows.push({
					id: groupId,
					kind: "notes",
					level: level + 1,
					parentId: folderId,
					hasChildren: true,
					expanded: false,
					label: `${notes.length} note${notes.length === 1 ? "" : "s"}`,
					folder,
					noteCount: notes.length,
					context: true,
				});
			}
		};

		for (const root of this.snapshot.forest.roots) pushFolder(root, 0, null);
		return rows;
	}

	private folderContainsMatch(folder: ForestFolderNode, matching: ReadonlySet<string>): boolean {
		if (folder.template && matching.has(folder.template.path)) return true;
		if (folder.notes.some(note => matching.has(note.path))) return true;
		return folder.folders.some(child => this.folderContainsMatch(child, matching));
	}

	// ------------------------------------------------------------------- tree

	private renderTree(parent: HTMLElement, rows: RowModel[], interactive: boolean): void {
		this.rowElements.clear();
		const tree = createDiv({ cls: "ct-tree" });
		tree.setAttribute("role", "tree");

		const active = rows.some(row => row.id === this.activeRowId) ? this.activeRowId : rows[0]?.id ?? null;
		this.activeRowId = active;

		for (const row of rows) {
			const el = this.createRow(row, interactive);
			this.rowElements.set(row.id, el);
			tree.append(el);
		}

		this.wireTree(tree, rows, interactive);
		parent.append(tree);
	}

	private createRow(row: RowModel, interactive: boolean): HTMLElement {
		const el = createDiv({ cls: "ct-tree-row" });
		el.dataset.rowId = row.id;
		el.dataset.parentId = row.parentId ?? "";
		el.dataset.level = String(row.level);
		el.dataset.hasChildren = String(row.hasChildren);
		el.style.setProperty("--ct-depth", String(row.level));
		el.setAttribute("role", "treeitem");
		el.setAttribute("aria-level", String(row.level + 1));
		el.setAttribute("tabindex", row.id === this.activeRowId ? "0" : "-1");
		if (row.hasChildren) el.setAttribute("aria-expanded", String(row.expanded));
		el.classList.toggle("is-context", row.context);
		el.classList.toggle("is-busy", this.busy);

		// The chevron is only a state indicator: the whole row is the expand
		// target, so the tiny arrow never has to be hit precisely (and touch
		// devices get a card-sized surface). `aria-expanded` on the row carries
		// the semantics for assistive tech.
		const toggle = createDiv({ cls: "ct-tree-toggle" });
		if (row.hasChildren) {
			setIconSafe(toggle, row.expanded ? "chevron-down" : "chevron-right");
			toggle.setAttribute("aria-hidden", "true");
		} else {
			toggle.classList.add("is-empty");
		}
		el.append(toggle);

		const icon = createSpan({ cls: "ct-tree-icon" });
		setIconSafe(icon, this.rowIcon(row));
		el.append(icon);

		const name = createSpan({ cls: "ct-row-name", text: row.label });
		// Flattened folders and notes from a flattened subfolder lose their
		// structural context, so the full path stays available on hover.
		if (row.node) {
			name.addClass("is-link");
			name.title = row.node.path;
			name.addEventListener("click", event => {
				event.stopPropagation();
				void this.openPath(row.node?.path);
			});
		} else if (row.kind === "folder" && row.folder?.template) {
			// Opening the template is a deliberate gesture: a plain click belongs
			// to the row (expand/collapse), Ctrl/Cmd+click navigates.
			const templatePath = row.folder.template.path;
			name.title = `Ctrl/Cmd+click to open ${templatePath}`;
			name.addEventListener("click", event => {
				if (!event.ctrlKey && !event.metaKey) return;
				event.stopPropagation();
				void this.openPath(templatePath);
			});
		} else if (row.folder) {
			name.title = row.folder.path === "" ? "/" : row.folder.path;
		}
		el.append(name);

		if (row.folder && row.kind !== "notes" && !row.context) {
			el.append(this.createCounts(row.folder.counts, row.folder.state));
		}

		if (row.kind === "folder" && row.folder && row.folder.state !== "none") {
			const badge = createSpan({ cls: `ct-badge is-${row.folder.state}` });
			setIconSafe(badge, stateIcon(row.folder));
			badge.setAttribute("aria-label", stateLabel(row.folder.state));
			badge.title = stateLabel(row.folder.state);
			el.append(badge);
		}

		if (row.node && row.node.state !== "none") {
			el.append(this.createBadge(row.node));
		}

		if (interactive && row.node) {
			el.append(this.createRowActions(row.node));
		}

		if (row.kind === "folder" && row.folder?.template) {
			// The card takes a second line only when the bulk verbs are there; the
			// menu alone stays on the row.
			if (interactive) el.classList.add("has-folder-actions");
			el.append(this.createFolderActions(row.folder, interactive));
		}

		el.addEventListener("click", () => {
			this.activeRowId = row.id;
			for (const [id, element] of this.rowElements) {
				element.setAttribute("tabindex", id === row.id ? "0" : "-1");
			}
			el.focus({ preventScroll: true });
			// The whole card expands/collapses a folder. Buttons and links inside
			// the row stop propagation, so they never reach this handler.
			if (row.hasChildren) this.toggleRow(row);
		});

		return el;
	}

	private rowIcon(row: RowModel): string {
		// A folder row represents its template, not a folder: the icon stays
		// constant and the chevron is the only expansion signal.
		if (row.kind === "folder") return "file";
		if (row.kind === "notes") return "files";
		return "file-text";
	}

	private createCounts(counts: ScopeCounts, state: string): HTMLElement {
		const el = createSpan({ cls: "ct-row-counts" });
		for (const [label, value, kind] of [
			["T", counts.templates, "templates"],
			["Nm", counts.notesMissing, "missing"],
			["Ne", counts.notesExtra, "extra"],
		] as const) {
			const part = el.createSpan({ cls: `ct-count is-${kind}`, text: `${label} ${value}` });
			part.title = label === "T"
				? "Templates to update in this scope"
				: label === "Nm"
					? "Notes missing properties in this scope"
					: "Notes with extra properties in this scope";
		}
		el.setAttribute("aria-label", `Scope state: ${stateLabel(state)}`);
		return el;
	}

	private createBadge(node: ForestFileNode): HTMLElement {
		const badge = createSpan({ cls: `ct-badge is-${node.state}` });
		setIconSafe(badge, stateIcon(node));
		badge.setAttribute("aria-label", stateLabel(node.state));
		badge.title = stateLabel(node.state);
		return badge;
	}

	private createRowActions(node: ForestFileNode): HTMLElement {
		const container = createDiv({ cls: "ct-row-actions" });
		const verb = primaryVerb(node);

		if (verb) {
			const blocked = !node.chainSound && verb.mode === "remove-extra";
			const action = createDiv({ cls: "ct-row-action text-icon-button" });
			action.setAttribute("role", "button");
			action.setAttribute("tabindex", "-1");
			action.setAttribute("aria-disabled", String(blocked || this.busy));
			action.classList.toggle("is-blocked", blocked);
			const icon = createSpan({ cls: "text-button-icon" });
			setIconSafe(icon, verb.icon);
			const label = createSpan({ cls: "text-button-label", text: verb.label });
			action.append(icon, label);
			action.title = blocked ? "Align is locked: update the template chain first" : verb.fullLabel;
			action.addEventListener("click", event => {
				event.stopPropagation();
				if (blocked || this.busy) return;
				void this.runVerb([node], verb.mode, verb.fullLabel, false);
			});
			container.append(action);
		}

		const more = createDiv({ cls: "ct-row-more clickable-icon" });
		setIconSafe(more, "more-horizontal");
		more.setAttribute("role", "button");
		more.setAttribute("tabindex", "-1");
		more.setAttribute("aria-label", "More actions");
		more.addEventListener("click", event => {
			event.stopPropagation();
			this.openRowMenu(node, event, undefined, true);
		});
		container.append(more);
		return container;
	}

	private createFolderActions(folder: ForestFolderNode, interactive: boolean): HTMLElement {
		const container = createDiv({ cls: "ct-folder-actions" });

		if (interactive) {
			for (const verb of this.folderVerbs(folder)) {
				const disabled = verb.nodes.length === 0;
				const action = createDiv({ cls: "ct-folder-action text-icon-button" });
				action.setAttribute("role", "button");
				action.setAttribute("tabindex", "-1");
				action.setAttribute("aria-disabled", String(disabled || verb.blocked || this.busy));
				action.classList.toggle("is-blocked", verb.blocked);
				action.classList.toggle("is-disabled", disabled || this.busy);
				const icon = createSpan({ cls: "text-button-icon" });
				setIconSafe(icon, verb.icon);
				const label = createSpan({ cls: "text-button-label", text: verb.fullLabel });
				action.append(icon, label);
				action.title = verb.blocked
					? "Align is locked: update the template chain first"
					: `${verb.fullLabel} in this folder and below (${verb.nodes.length})`;
				action.addEventListener("click", event => {
					event.stopPropagation();
					if (disabled || verb.blocked || this.busy) return;
					void this.runVerb(verb.nodes, verb.mode, verb.fullLabel, true);
				});
				container.append(action);
			}
		}

		// The menu is the mouse-only way to reach the template (and, on phones,
		// the bulk verbs). It exists in every tab, including the read-only map.
		const more = createDiv({ cls: "ct-folder-more clickable-icon" });
		setIconSafe(more, "more-horizontal");
		more.setAttribute("role", "button");
		more.setAttribute("tabindex", "-1");
		more.setAttribute("aria-label", "Folder actions");
		more.addEventListener("click", event => {
			event.stopPropagation();
			this.openFolderMenu(folder, event, undefined, interactive);
		});
		container.append(more);

		return container;
	}

	/** AI: Bulk verbs for one folder subtree; only the files that need it. */
	private folderVerbs(folder: ForestFolderNode): FolderVerb[] {
		const nodes = this.folderSubtree(folder);
		const alignBlocked = nodes.notesExtra.some(node => !node.chainSound);

		return [
			{
				mode: "add-missing",
				label: "Update templates",
				fullLabel: "Update templates",
				icon: "wrench",
				nodes: nodes.templates,
				blocked: false,
			},
			{
				mode: "add-missing",
				label: "Update notes",
				fullLabel: "Update notes",
				icon: "wrench",
				nodes: nodes.notesMissing,
				blocked: false,
			},
			{
				mode: "remove-extra",
				label: "Align notes",
				fullLabel: "Align notes",
				icon: "anvil",
				nodes: nodes.notesExtra,
				blocked: alignBlocked,
			},
		];
	}

	/**
	 * AI: The subtree of a folder, cached per forest snapshot. Without the cache
	 * every visible folder row would walk the same nodes again on each render.
	 */
	private folderSubtree(folder: ForestFolderNode): {
		templates: ForestFileNode[];
		notesMissing: ForestFileNode[];
		notesExtra: ForestFileNode[];
	} {
		const cached = this.subtreeCache.get(folder.path);
		if (cached) return cached;

		const result = {
			templates: [] as ForestFileNode[],
			notesMissing: [] as ForestFileNode[],
			notesExtra: [] as ForestFileNode[],
		};

		const visit = (current: ForestFolderNode): void => {
			if (current.template?.state === "missing") result.templates.push(current.template);
			for (const note of current.notes) {
				if (note.state === "missing") result.notesMissing.push(note);
				if (note.state === "extra") result.notesExtra.push(note);
			}
			for (const child of current.folders) visit(child);
		};
		visit(folder);

		const byPath = (first: ForestFileNode, second: ForestFileNode): number =>
			first.path.localeCompare(second.path, undefined, { numeric: true });
		result.templates.sort(byPath);
		result.notesMissing.sort(byPath);
		result.notesExtra.sort(byPath);

		this.subtreeCache.set(folder.path, result);
		return result;
	}

	private openFolderMenu(
		folder: ForestFolderNode,
		event: Event,
		anchor: HTMLElement | undefined,
		withVerbs: boolean
	): void {
		const menu = new Menu();

		if (folder.template) {
			const templatePath = folder.template.path;
			menu.addItem(item => item
				.setTitle(`Open template (${folder.template?.name ?? templatePath})`)
				.setIcon("file")
				.onClick(() => void this.openPath(templatePath)));
			if (withVerbs) menu.addSeparator();
		}

		if (!withVerbs) {
			this.showMenu(menu, event, anchor);
			return;
		}

		for (const verb of this.folderVerbs(folder)) {
			const disabled = verb.nodes.length === 0;
			menu.addItem(item => item
				.setTitle(verb.blocked
					? `${verb.fullLabel} (chain not sound)`
					: `${verb.fullLabel} (${verb.nodes.length})`)
				.setIcon(verb.icon)
				.setDisabled(disabled || verb.blocked || this.busy)
				.onClick(() => {
					if (disabled || verb.blocked || this.busy) return;
					void this.runVerb(verb.nodes, verb.mode, verb.fullLabel, true);
				}));
		}

		this.showMenu(menu, event, anchor);
	}

	private showMenu(menu: Menu, event: Event, anchor?: HTMLElement): void {
		const target = anchor ?? event.currentTarget;
		if (target instanceof HTMLElement) {
			const rect = target.getBoundingClientRect();
			menu.showAtPosition({ x: rect.left, y: rect.bottom });
		} else {
			menu.showAtMouseEvent(event as MouseEvent);
		}
	}

	private toggleRow(row: RowModel): void {
		if (!row.hasChildren) return;
		const collapsing = this.expanded.has(row.id);
		const expandingGroup = row.kind === "notes" && !collapsing;

		if (collapsing) {
			this.expanded.delete(row.id);
			// Closing a folder compacts everything nested in it, so reopening it
			// starts from folders and note groups collapsed.
			if (row.kind === "folder" && row.folder) this.recompact(row.folder);
		} else {
			this.expanded.add(row.id);
		}

		// Expanding a notes group deletes its row, so focus moves to the folder
		// instead of leaving the tree without an active item.
		const focusId = expandingGroup && row.folder ? `f:${row.folder.path}` : row.id;
		this.activeRowId = focusId;
		this.pendingFocusId = focusId;
		this.render();
	}

	/** AI: Clears the expansion state of a folder and of everything below it. */
	private recompact(folder: ForestFolderNode): void {
		this.expanded.delete(`f:${folder.path}`);
		this.expanded.delete(`g:${folder.path}`);
		for (const child of folder.folders) this.recompact(child);
	}

	private wireTree(tree: HTMLElement, rows: RowModel[], interactive: boolean): void {
		const visible = (): HTMLElement[] => rows
			.map(row => this.rowElements.get(row.id))
			.filter((element): element is HTMLElement => element !== undefined);

		tree.addEventListener("focusin", event => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			const row = target.closest<HTMLElement>(".ct-tree-row");
			if (!row?.dataset.rowId) return;
			this.activeRowId = row.dataset.rowId;
			for (const element of visible()) {
				element.setAttribute("tabindex", element === row ? "0" : "-1");
			}
		});

		tree.addEventListener("keydown", event => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			const current = target.closest<HTMLElement>(".ct-tree-row");
			if (!current) return;
			const currentRow = rows.find(row => row.id === current.dataset.rowId);
			if (!currentRow) return;

			const elements = visible();
			const index = elements.indexOf(current);
			const moveTo = (next: HTMLElement | undefined): void => {
				if (!next?.dataset.rowId) return;
				this.activeRowId = next.dataset.rowId;
				next.focus();
			};

			switch (event.key) {
				case "ArrowDown":
					event.preventDefault();
					moveTo(elements[index + 1]);
					break;
				case "ArrowUp":
					event.preventDefault();
					moveTo(elements[index - 1]);
					break;
				case "ArrowRight": {
					event.preventDefault();
					if (currentRow.hasChildren && !currentRow.expanded) {
						this.toggleRow(currentRow);
					} else if (currentRow.hasChildren) {
						moveTo(elements[index + 1]);
					}
					break;
				}
				case "ArrowLeft": {
					event.preventDefault();
					if (currentRow.hasChildren && currentRow.expanded) {
						this.toggleRow(currentRow);
					} else {
						const parent = currentRow.parentId
							? this.rowElements.get(currentRow.parentId)
							: undefined;
						moveTo(parent);
					}
					break;
				}
				case "Enter":
					event.preventDefault();
					if (currentRow.node) {
						this.openRowMenu(currentRow.node, event, current, interactive);
					} else if (currentRow.kind === "folder" && currentRow.folder) {
						this.openFolderMenu(currentRow.folder, event, current, interactive);
					}
					break;
				case " ":
					event.preventDefault();
					if (currentRow.hasChildren) this.toggleRow(currentRow);
					break;
				default:
					break;
			}
		});
	}

	private openRowMenu(
		node: ForestFileNode,
		event: Event,
		anchor: HTMLElement | undefined,
		withVerb: boolean
	): void {
		const menu = new Menu();
		menu.addItem(item => item
			.setTitle("Open file")
			.setIcon("external-link")
			.setDisabled(this.busy)
			.onClick(() => void this.openPath(node.path)));

		const verb = primaryVerb(node);
		if (withVerb && verb) {
			const blocked = !node.chainSound && verb.mode === "remove-extra";
			menu.addItem(item => item
				.setTitle(blocked ? `${verb.fullLabel} (chain not sound)` : verb.fullLabel)
				.setIcon(verb.icon)
				.setDisabled(blocked || this.busy)
				.onClick(() => {
					if (!blocked && !this.busy) void this.runVerb([node], verb.mode, verb.fullLabel, false);
				}));
		}

		this.showMenu(menu, event, anchor);
	}

	private async openPath(path: string | undefined): Promise<void> {
		if (this.busy || !path) return;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		this.close();
		await this.app.workspace.getLeaf("tab").openFile(file);
	}

	// ---------------------------------------------------------------- history

	private renderHistory(parent: HTMLElement): void {
		const journal = getJournal();
		const entries = listEntries(journal);

		if (this.error?.tab === "history") this.renderErrorCard(parent, this.error);

		parent.createEl("p", {
			cls: "ct-history-warning",
			text: "Session-only journal — not a backup. Keep a copy of your vault elsewhere.",
		});

		if (entries.length === 0) {
			this.renderEmptyState(
				parent,
				"Nothing to restore",
				"History lists dashboard operations only. The Back button of a note keeps its own local session and never appears here."
			);
			return;
		}

		const truncated = journal.truncatedOperations;
		if (truncated > 0) {
			parent.createEl("p", {
				cls: "ct-history-truncated",
				text: `${truncated} older operation${truncated === 1 ? " is" : "s are"} no longer restorable`,
			});
		}

		const operations = [...journal.operations].reverse();
		for (const operation of operations) {
			const operationEntries = [...operation.entries].reverse();
			if (operationEntries.length > 1) {
				parent.append(this.renderFixAllHeader(operation));
			}
			for (const entry of operationEntries) {
				parent.append(this.renderHistoryCard(entry, entries));
			}
		}
	}

	private renderFixAllHeader(operation: JournalOperation): HTMLElement {
		const header = createDiv({ cls: "ct-history-group" });
		const total = operation.routine?.total ?? operation.entries.length;
		const count = operation.entries.length;
		const label = count < total
			? `Fix all · ${count} of ${total} operations`
			: `Fix all · ${count} operations`;
		header.createSpan({ cls: "ct-history-group-label", text: label });
		return header;
	}

	private renderHistoryCard(entry: JournalEntry, allEntries: readonly JournalEntry[]): HTMLElement {
		const card = createDiv({ cls: "ct-history-card" });
		const top = createDiv({ cls: "ct-history-top" });
		top.createSpan({ cls: "ct-history-verb", text: entryLabel(entry) });
		top.createSpan({ cls: "ct-history-time", text: formatTime(entry.at) });
		card.append(top);

		const written = entry.files.filter(file => !file.skipped);
		const templates = written.filter(file => isTemplatePath(file.path)).length;
		const notes = written.length - templates;
		const folders = distinctFolders(written.map(file => file.path));

		card.createDiv({
			cls: "ct-history-stats",
			text: `Templates modified: ${templates} · Notes modified: ${notes} · Folders involved: ${folders}`,
		});

		const newer = Math.max(0, allEntries.length - 1 - allEntries.indexOf(entry));
		const undo = createEl("button", {
			cls: "ct-history-undo",
			text: newer === 0 ? "Undo" : `Undo this and ${newer} newer operation${newer === 1 ? "" : "s"}`,
		});
		undo.disabled = this.busy;
		undo.addEventListener("click", () => void this.undoFrom(entry.id, newer === 0));
		card.append(undo);

		return card;
	}

	// ----------------------------------------------------------------- errors

	private renderErrorCard(parent: HTMLElement, error: DashboardError): void {
		const card = createDiv({ cls: "ct-error-card" });
		const top = createDiv({ cls: "ct-error-top" });
		top.createSpan({ cls: "ct-error-title", text: error.title });
		const dismiss = createDiv({ cls: "ct-error-dismiss clickable-icon" });
		setIconSafe(dismiss, "x");
		dismiss.setAttribute("role", "button");
		dismiss.setAttribute("tabindex", "0");
		dismiss.setAttribute("aria-label", "Dismiss error");
		dismiss.addEventListener("click", () => {
			this.error = null;
			this.render();
		});
		dismiss.addEventListener("keydown", event => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			this.error = null;
			this.render();
		});
		top.append(dismiss);
		card.append(top);
		for (const line of error.lines) card.createEl("p", { cls: "ct-error-line", text: line });
		if (error.retryEntryId) {
			const retry = createEl("button", { cls: "ct-error-retry", text: "Retry undo" });
			retry.disabled = this.busy;
			retry.addEventListener("click", () => {
				if (error.retryEntryId) void this.undoFrom(error.retryEntryId, error.retryLatest === true);
			});
			card.append(retry);
		}
		parent.append(card);
	}

	private renderEmptyState(parent: HTMLElement, title: string, text: string): void {
		const empty = createDiv({ cls: "ct-empty" });
		empty.createEl("h4", { text: title });
		empty.createEl("p", { cls: "ct-empty-text", text });
		parent.append(empty);
	}

	// ---------------------------------------------------------------- actions

	private async runVerb(
		nodes: readonly ForestFileNode[],
		mode: ReconformMode,
		label: string,
		bulk: boolean
	): Promise<void> {
		if (this.busy || !this.snapshot) return;

		const estimate = this.estimateFiles(nodes, mode);
		if (estimate.files.length === 0) {
			new Notice("Nothing to do.");
			return;
		}

		if (bulk) {
			const content = createFragment(fragment => {
				fragment.append(confirmParagraph(`${label} on ${estimate.files.length} file${estimate.files.length === 1 ? "" : "s"}.`));
				fragment.append(confirmMuted("Only the keys of this operation are touched; existing values are kept. Undo is available in History."));
			});
			const confirmed = await confirmAction(this.app, {
				title: label,
				content,
				cta: "Run",
			});
			if (!confirmed) return;
		}

		const budget = await this.checkBudget(estimate.files, label);
		if (!budget.proceed) return;

		this.setBusy(true, label);
		const outcome = await runBatch(
			estimate.targets,
			(done, total, path) => this.updateProgress(`${label} · ${done}/${total} · ${baseName(path)}`)
		);
		this.finishBatch(outcome, label, budget.recordable, "batch");
	}

	/**
	 * AI: Dry run shared by every verb: computes the real target of each node
	 * from the current forest, drops the files that would not change, and
	 * returns the batch targets. No disk access.
	 */
	private estimateFiles(nodes: readonly ForestFileNode[], mode: ReconformMode): {
		targets: BatchTarget[];
		files: JournalFileChange[];
	} {
		const targets: BatchTarget[] = [];
		const files: JournalFileChange[] = [];
		if (!this.snapshot) return { targets, files };

		for (const node of nodes) {
			const file = this.snapshot.files.get(node.path);
			if (!file || node.props === null) continue;
			const reference = this.referenceProps(node);
			if (!reference) continue;

			const next = computeReconformProps(reference, node.props, mode);
			if (areMapsEqual(node.props, next)) continue;

			files.push({
				path: node.path,
				before: new Map(node.props),
				changes: diffProps(node.props, next),
			});
			targets.push({
				file,
				mode,
				kind: node.kind === "template" ? "template" : "note",
			});
		}

		return { targets, files };
	}

	private referenceProps(node: ForestFileNode): Map<string, unknown> | null {
		if (!node.referencePath || !this.snapshot) return null;
		const reference = this.snapshot.forest.nodes.get(node.referencePath);
		if (!reference) return null;
		return reference.props ?? new Map<string, unknown>();
	}

	/**
	 * AI: Budget preflight. The estimate decides the veto; the real size is
	 * checked again after the operation (`finishBatch`).
	 */
	private async checkBudget(
		files: readonly JournalFileChange[],
		label: string
	): Promise<{ proceed: boolean; recordable: boolean }> {
		const journal = getJournal();
		const estimate = estimateOperationBytes(files);

		if (estimate > journal.budgetBytes) {
			const content = createFragment(fragment => {
				fragment.append(confirmParagraph(`${label} is larger than the History budget.`));
				fragment.append(confirmMuted("The operation will run, but it cannot be recorded: it will NOT be undoable. Keep a copy of your vault elsewhere."));
			});
			const proceed = await confirmAction(this.app, {
				title: "Operation cannot be undone",
				content,
				cta: "Run without undo",
			});
			return { proceed, recordable: false };
		}

		if (estimate > journal.budgetBytes / 2) {
			const content = createFragment(fragment => {
				fragment.append(confirmParagraph(`${label} needs a large part of the History budget.`));
				fragment.append(confirmMuted("Older operations will be removed to make room. Proceed to truncate the History and record this operation."));
			});
			const proceed = await confirmAction(this.app, {
				title: "Truncate History?",
				content,
				cta: "Proceed",
			});
			return { proceed, recordable: true };
		}

		return { proceed: true, recordable: true };
	}

	/** AI: Stores the outcome in the journal and refreshes the modal. */
	private finishBatch(
		outcome: BatchOutcome,
		label: string,
		recordable: boolean,
		origin: "batch" | "fix-all"
	): void {
		const written = outcome.files.filter(file => !file.skipped && file.changes.length > 0);

		if (written.length > 0 && recordable) {
			const result = appendOperation(getJournal(), {
				origin,
				files: outcome.files,
				verb: label,
			});
			if (result.oversized) {
				new Notice("The operation completed but is too large to be recorded: it is not undoable.");
			} else if (result.evictedOperations > 0) {
				new Notice(`${result.evictedOperations} older operation${result.evictedOperations === 1 ? " is" : "s are"} no longer restorable.`);
			}
		} else if (written.length > 0 && !recordable) {
			new Notice("The operation completed. It was not recorded and cannot be undone.");
		}

		this.reportOutcome(outcome, written.length, label);
	}

	private reportOutcome(outcome: BatchOutcome, changed: number, label: string): void {
		this.setBusy(false);

		if (outcome.errors.length > 0) {
			this.error = {
				tab: "issues",
				title: `${label}: ${outcome.errors.length} file${outcome.errors.length === 1 ? "" : "s"} failed`,
				lines: outcome.errors.map(error => `${error.path} — ${error.message}`),
			};
			new Notice(`Cascade Templates: ${outcome.errors.length} file(s) failed.`);
		} else if (changed === 0) {
			if (this.error?.tab === "issues") this.error = null;
			new Notice("Nothing to do.");
		} else {
			if (this.error?.tab === "issues") this.error = null;
			new Notice(`${label}: ${changed} file${changed === 1 ? "" : "s"} updated.`);
		}

		void this.refreshAfterWrite();
	}

	private async refreshAfterWrite(): Promise<void> {
		// The metadata cache updates asynchronously after a write; one short
		// settle keeps the map from flashing the pre-write state.
		await new Promise<void>(resolve => window.setTimeout(resolve, 80));
		this.rebuildForest();
		this.render();
	}

	// ---------------------------------------------------------------- fix all

	private async runFixAll(): Promise<void> {
		if (this.busy || !this.snapshot) return;
		const groups = collectIssueGroups(this.snapshot.forest);
		const total = groups.templates.length + groups.notesMissing.length + groups.notesExtra.length;
		if (total === 0) {
			new Notice("No issues to fix.");
			return;
		}

		const content = createFragment(fragment => {
			fragment.append(confirmParagraph("Fix all runs three phases in order:"));
			fragment.append(confirmList([
				`Update templates — ${groups.templates.length} estimated`,
				`Update notes — ${groups.notesMissing.length} estimated`,
				`Align notes — ${groups.notesExtra.length} estimated`,
			]));
			fragment.append(confirmMuted("The last two counts are estimates: they depend on the first phase. The macro is not atomic; each phase that writes is a separate History entry. Keep a copy of your vault elsewhere."));
		});
		const confirmed = await confirmAction(this.app, {
			title: "Fix all",
			content,
			cta: "Fix all",
		});
		if (!confirmed) return;

		const estimate = this.estimateFixAll();
		const budget = await this.checkBudget(estimate.files, "Fix all");
		if (!budget.proceed) return;

		this.setBusy(true, "Fix all · updating templates");
		let operationId: string | null = null;
		let stopped = false;

		// Phase 1: templates, top-down. A failed template skips its subtree.
		const templateTargets = this.estimateFiles(groups.templates, "add-missing").targets;
		if (templateTargets.length > 0) {
			const outcome = await runBatch(
				templateTargets,
				(done, count, path) => this.updateProgress(`Fixing ${done}/${count} · Updating templates · ${baseName(path)}`)
			);
			operationId = this.storeFixAllPhase(operationId, outcome, 1, 3, "Update templates", budget.recordable);
			if (outcome.errors.length > 0) {
				stopped = true;
				this.setErrorForFixAll(outcome);
			}
		}

		if (!stopped) {
			const noteTargets = this.allNotesTargets("add-missing");
			this.setBusy(true, "Fix all · updating notes");
			const outcome = await runBatch(
				noteTargets,
				(done, count, path) => this.updateProgress(`Fixing ${done}/${count} · Updating notes · ${baseName(path)}`)
			);
			operationId = this.storeFixAllPhase(operationId, outcome, 2, 3, "Update notes", budget.recordable);
			if (outcome.errors.length > 0) {
				stopped = true;
				this.setErrorForFixAll(outcome);
			}
		}

		if (!stopped) {
			const noteTargets = this.allNotesTargets("remove-extra");
			this.setBusy(true, "Fix all · aligning notes");
			const outcome = await runBatch(
				noteTargets,
				(done, count, path) => this.updateProgress(`Fixing ${done}/${count} · Aligning notes · ${baseName(path)}`)
			);
			operationId = this.storeFixAllPhase(operationId, outcome, 3, 3, "Align notes", budget.recordable);
			if (outcome.errors.length > 0) {
				stopped = true;
				this.setErrorForFixAll(outcome);
			}
		}

		if (stopped) {
			new Notice("Fix all stopped after an error. You can run it again: every phase is idempotent.");
		} else {
			if (this.error?.tab === "issues") this.error = null;
			if (!budget.recordable && operationId === null) {
				new Notice("Fix all completed. It was not recorded and cannot be undone.");
			} else if (operationId) {
				new Notice("Fix all completed.");
			} else {
				new Notice("Nothing to do.");
			}
		}

		this.setBusy(false);
		await this.refreshAfterWrite();
	}

	private storeFixAllPhase(
		operationId: string | null,
		outcome: BatchOutcome,
		step: number,
		total: number,
		verb: string,
		recordable: boolean
	): string | null {
		const written = outcome.files.filter(file => !file.skipped && file.changes.length > 0);
		if (written.length === 0 || !recordable) return operationId;

		const routine = { id: operationId ?? `fix-all-${Date.now()}`, step, total };
		if (!operationId) {
			const result = appendOperation(getJournal(), {
				origin: "fix-all",
				files: outcome.files,
				routine,
				verb,
			});
			if (result.oversized) {
				new Notice("Fix all is too large to be recorded: the operation is not undoable.");
				return null;
			}
			if (result.evictedOperations > 0) {
				new Notice(`${result.evictedOperations} older operation${result.evictedOperations === 1 ? " is" : "s are"} no longer restorable.`);
			}
			return result.entry?.operationId ?? null;
		}

		const entry = appendEntryToOperation(getJournal(), operationId, outcome.files, routine, verb);
		const budget = enforceBudget(getJournal());
		if (budget.droppedOperations > 0) {
			new Notice("Fix all is too large to keep in history: the operation is not undoable.");
			return null;
		}
		if (budget.evictedOperations > 0) {
			new Notice(`${budget.evictedOperations} older operation${budget.evictedOperations === 1 ? " is" : "s are"} no longer restorable.`);
		}
		return entry ? operationId : null;
	}

	private estimateFixAll(): { files: JournalFileChange[] } {
		if (!this.snapshot) return { files: [] };
		const groups = collectIssueGroups(this.snapshot.forest);
		const files = [
			...this.estimateFiles(groups.templates, "add-missing").files,
			...this.estimateFiles([...this.allNotesNodes()], "add-missing").files,
			...this.estimateFiles([...this.allNotesNodes()], "remove-extra").files,
		];
		return { files };
	}

	private allNotesNodes(): ForestFileNode[] {
		if (!this.snapshot) return [];
		const notes: ForestFileNode[] = [];
		for (const node of this.snapshot.forest.nodes.values()) {
			if (node.kind === "note" && node.referencePath && node.props !== null) notes.push(node);
		}
		return notes;
	}

	private allNotesTargets(mode: ReconformMode): BatchTarget[] {
		return this.estimateFiles(this.allNotesNodes(), mode).targets;
	}

	private setErrorForFixAll(outcome: BatchOutcome): void {
		this.error = {
			tab: "issues",
			title: `Fix all stopped: ${outcome.errors.length} file${outcome.errors.length === 1 ? "" : "s"} failed`,
			lines: outcome.errors.map(error => `${error.path} — ${error.message}`),
		};
	}

	// ------------------------------------------------------------------ undo

	private async undoFrom(entryId: string, latest: boolean): Promise<void> {
		if (this.busy) return;
		this.error = null;

		const journal = getJournal();
		const entries = listEntries(journal);
		const index = entries.findIndex(entry => entry.id === entryId);
		if (index < 0) return;

		const range = entries.slice(index);
		const paths = new Set<string>();
		for (const entry of range) {
			for (const file of entry.files) {
				if (!file.skipped && file.changes.length > 0) paths.add(file.path);
			}
		}

		const current = new Map<string, Map<string, unknown>>();
		const existing = new Set<string>();
		let readFailed = false;
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			existing.add(path);
			try {
				current.set(path, await getFileProps(file));
			} catch {
				// Do not treat a transient read failure as a deleted file: abort
				// the preflight and keep the entries untouched.
				readFailed = true;
				break;
			}
		}

		if (readFailed) {
			this.error = {
				tab: "history",
				title: "Rewind not started",
				lines: ["A file could not be read. No operation was consumed; retry in a moment."],
				retryEntryId: entryId,
				retryLatest: latest,
			};
			this.render();
			return;
		}

		const plan = planRewind(journal, entryId, current, existing);
		if (plan.entryIds.length === 0) return;

		if (!latest || plan.conflictCount > 0 || plan.missingPaths.length > 0) {
			const confirmed = await this.confirmRewind(plan);
			if (!confirmed) return;
		}

		this.setBusy(true, "Restoring…");
		let restored = 0;
		try {
			for (let i = 0; i < plan.writes.length; i++) {
				const write = plan.writes[i];
				if (!write) continue;
				const file = this.app.vault.getAbstractFileByPath(write.path);
				if (!(file instanceof TFile)) continue;
				this.updateProgress(`Restoring ${i + 1}/${plan.writes.length} · ${baseName(write.path)}`);
				await applyFrontmatterPatch(file, write.patch);
				restored++;
			}

			removeEntries(journal, plan.entryIds);
			this.error = null;
			new Notice(`Restored ${restored} file${restored === 1 ? "" : "s"}.`);
			this.setBusy(false);
			await this.refreshAfterWrite();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.error = {
				tab: "history",
				title: "Rewind failed",
				lines: [
					`Restored ${restored} of ${plan.writes.length} files.`,
					`The operation was not consumed and can be retried: ${message}`,
				],
				retryEntryId: entryId,
				retryLatest: latest,
			};
			this.setBusy(false);
			this.render();
		}
	}

	private async confirmRewind(plan: RewindPlan): Promise<boolean> {
		const content = createFragment(fragment => {
			fragment.append(confirmParagraph(
				`Undo ${plan.entryIds.length} operation${plan.entryIds.length === 1 ? "" : "s"} · ` +
				`${plan.writes.length} file${plan.writes.length === 1 ? "" : "s"} · ` +
				`${distinctFolders(plan.writes.map(write => write.path))} folder${distinctFolders(plan.writes.map(write => write.path)) === 1 ? "" : "s"}.`
			));

			if (plan.conflictCount > 0) {
				fragment.append(confirmMuted(`${plan.conflictCount} key${plan.conflictCount === 1 ? " was" : "s were"} changed outside the dashboard and will be restored:`));
				const lines: string[] = [];
				let shown = 0;
				for (const write of plan.writes) {
					for (const conflict of write.conflicts) {
						if (shown >= 10) break;
						lines.push(`${write.path} → ${conflict.key}: ${truncate(formatValue(conflict.current))} → ${truncate(formatValue(conflict.restored))}`);
						shown++;
					}
				}
				fragment.append(confirmList(lines));
				if (plan.conflictCount > shown) {
					fragment.append(confirmMuted(`… and ${plan.conflictCount - shown} more.`));
				}
			}

			if (plan.missingPaths.length > 0) {
				fragment.append(confirmMuted(`${plan.missingPaths.length} file${plan.missingPaths.length === 1 ? "" : "s"} no longer exist and will be skipped:`));
				fragment.append(confirmList(plan.missingPaths.slice(0, 10)));
			}

			fragment.append(confirmMuted("Only the keys touched by these operations are restored; every other property is kept."));
		});

		return confirmAction(this.app, {
			title: plan.conflictCount > 0 ? "Restore over your changes?" : "Undo operations",
			content,
			cta: "Undo",
		});
	}

	// ------------------------------------------------------------------ busy

	private setBusy(busy: boolean, label?: string): void {
		this.busy = busy;
		if (label !== undefined) this.busyLabel = label;
		this.modalEl.classList.toggle("is-busy", busy);
		this.render();
	}

	private updateProgress(text: string): void {
		this.busyLabel = text;
		this.progressTextEl?.setText(text);
	}

	private installGuards(): void {
		this.modalEl.addEventListener("keydown", event => {
			if (!this.busy || event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
		}, true);

		this.containerEl.addEventListener("click", event => {
			if (!this.busy) return;
			if (event.target !== this.containerEl) return;
			event.preventDefault();
			event.stopPropagation();
		}, true);
	}
}

// ---------------------------------------------------------------- helpers

function folderLabel(folder: ForestFolderNode): string {
	return folder.path === "" ? "Vault root" : folder.path;
}

/**
 * AI: Label of a cascade folder row. A local root shows its full path; every
 * other folder shows the path relative to its cascade parent, which is only
 * longer than the name when flattened folders sit between the two.
 */
function folderRowLabel(folder: ForestFolderNode): string {
	if (folder.parentPath === null) return folderLabel(folder);

	const prefix = folder.parentPath === "" ? "" : `${folder.parentPath}/`;
	return folder.path.startsWith(prefix) ? folder.path.slice(prefix.length) : folder.name;
}

function primaryVerb(node: ForestFileNode): VerbConfig | null {
	if (node.kind === "note" && node.state === "missing") {
		return { mode: "add-missing", label: "Update", fullLabel: "Update note", icon: "wrench" };
	}
	if (node.kind === "note" && node.state === "extra") {
		return { mode: "remove-extra", label: "Align", fullLabel: "Align note", icon: "anvil" };
	}
	return null;
}

function entryLabel(entry: JournalEntry): string {
	if (entry.verb) return entry.verb;
	if (entry.routine) {
		switch (entry.routine.step) {
			case 1:
				return "Update templates";
			case 2:
				return "Update notes";
			default:
				return "Align notes";
		}
	}
	return "Dashboard update";
}
