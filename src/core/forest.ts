import { computeTemplateConformance } from "./conformance";
import { computeMapConformance, type MapConformanceStatus } from "./mapOperations";

/**
 * AI: Pure derivation of the cascade forest (feature B).
 *
 * Role in the architecture:
 * The dashboard never walks the vault by itself: it feeds plain path/property
 * records into this module and receives the whole tree, the conformance of every
 * node, the folder badges, the per-scope counters and the `Issues` groups.
 * Nothing here touches Obsidian, so the rules are testable without a vault and
 * can be reused by the panel, the commands and (D) the interfaces.
 *
 * The reference is injected through `referenceFor(node)`: today it resolves to
 * the nearest ancestor folder template, with interfaces it will resolve to
 * template + declared interfaces. The forest must not assume one reference per
 * folder, otherwise D would force a rewrite of this file and every consumer.
 */

/** AI: Every node has exactly one conformance state. `none` is "not a participant". */
export type ForestState = "ok" | "missing" | "extra" | "none";

/** AI: Counters shown on a row; they always describe the row's action scope. */
export interface ScopeCounts {
	/** Templates missing properties from their parent template. */
	templates: number;
	/** Notes missing at least one key of their reference. */
	notesMissing: number;
	/** Notes carrying keys their reference does not have. */
	notesExtra: number;
}

/** AI: One markdown file handed to the pure forest builder. */
export interface ForestFileInput {
	path: string;
	/** `null` = no frontmatter or not indexed: a note does not participate. */
	props: Map<string, unknown> | null;
}

/** AI: Reference map a node is compared against. */
export interface ReferenceTarget {
	path: string;
	props: Map<string, unknown>;
}

/** AI: Metadata of a node, passed to the injectable reference resolver. */
export interface ReferenceNode {
	path: string;
	kind: "note" | "template";
	props: Map<string, unknown> | null;
}

/** AI: Input of the pure builder. */
export interface ForestInput {
	files: readonly ForestFileInput[];
	/** Name of the template file (`!Template.md` by default). */
	templateFilename: string;
	/**
	 * Seam for D: returns the reference of a node. Defaults to the nearest
	 * ancestor folder template (the current plugin semantics).
	 */
	referenceFor?: (node: ReferenceNode) => ReferenceTarget | null;
}

interface NodeBase {
	path: string;
	name: string;
	state: ForestState;
	counts: ScopeCounts;
}

/** AI: A note or a template file. */
export interface ForestFileNode extends NodeBase {
	kind: "note" | "template";
	props: Map<string, unknown> | null;
	/** Reference path, `null` for a local root template or a note without one. */
	referencePath: string | null;
	/** True when every template from the nearest one to the local root conforms. */
	chainSound: boolean;
	/** Templates only: no ancestor template means this is a local root. */
	localRoot: boolean;
	/**
	 * Cascade folder the file belongs to: its own folder for a template, the
	 * nearest ancestor with a template for a note. `null` = outside every
	 * cascade. With flattened folders this may be several levels above the file.
	 */
	scopeFolder: string | null;
}

/**
 * AI: A cascade folder row. Only folders that contain a template become nodes:
 * a template-less folder is transparent, so consecutive template-less folders
 * collapse into the nearest ancestor that has one (recursively). The physical
 * path is kept because it is what the actions and the labels target.
 */
export interface ForestFolderNode extends NodeBase {
	kind: "folder";
	localRoot: boolean;
	/** Template physically placed in this folder; never `null` for a node. */
	template: ForestFileNode | null;
	/** Cascade folders whose nearest ancestor with a template is this folder. */
	folders: ForestFolderNode[];
	/** Notes of this folder plus the notes of the flattened folders below it. */
	notes: ForestFileNode[];
	/**
	 * Aggregate state of the child folders and notes, excluding this folder's own
	 * template. Used for the cumulative "children errors" badge: `state` mixes
	 * the template with its descendants and cannot tell the two apart.
	 */
	descendantsState: ForestState;
	/** Aggregate state of `notes` only; feeds the `N notes` group badge. */
	notesState: ForestState;
	/** Nearest template for the notes of this folder (display only). */
	referencePath: string | null;
	/** Nearest ancestor cascade folder, `null` for a local root. */
	parentPath: string | null;
}

/** AI: Whole forest: the subtrees of the local roots plus what stays outside. */
export interface Forest {
	/** Cascade folders without a cascade ancestor (they own a template). */
	roots: ForestFolderNode[];
	/** Notes not reachable from any local root (no template at all). */
	outsideNotes: ForestFileNode[];
	/** All notes and templates keyed by path. */
	nodes: Map<string, ForestFileNode>;
	/** Cascade folders keyed by path: only folders that directly own a template. */
	folders: Map<string, ForestFolderNode>;
}

export function emptyCounts(): ScopeCounts {
	return { templates: 0, notesMissing: 0, notesExtra: 0 };
}

/** AI: Numeric path order, used for every list in the dashboard. */
const pathCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareVaultPaths(first: string, second: string): number {
	return pathCollator.compare(first, second);
}

/** AI: Parent folder path; the vault root is `""`. */
export function parentFolderPath(path: string): string {
	const index = path.lastIndexOf("/");
	return index < 0 ? "" : path.slice(0, index);
}

/** AI: Basename of a vault path (the root folder has no name of its own). */
export function baseName(path: string): string {
	const index = path.lastIndexOf("/");
	return index < 0 ? path : path.slice(index + 1);
}

/** AI: True for a path that is `folder` itself or one of its descendants. */
export function isInFolder(path: string, folder: string): boolean {
	if (folder === "") return true;
	return path === folder || path.startsWith(folder + "/");
}

/**
 * AI: Default reference resolver (feature B): nearest ancestor folder template.
 *
 * Both a note and a template look upward starting from their own folder; a
 * template skips its own path so it resolves to its parent. The folder →
 * template lookup is memoized, which is what keeps a 10k-note vault from doing
 * one `getAbstractFileByPath` per ancestor for every file.
 */
function createFolderReferenceResolver(
	files: ReadonlyMap<string, ForestFileInput>,
	templateFilename: string
): (node: ReferenceNode) => ReferenceTarget | null {
	const templates = new Set<string>();
	for (const path of files.keys()) {
		if (baseName(path) === templateFilename) templates.add(path);
	}

	const memo = new Map<string, string | null>();

	const walk = (folder: string, skipPath?: string): string | null => {
		const key = `${folder}\u0000${skipPath ?? ""}`;
		const cached = memo.get(key);
		if (cached !== undefined) return cached;

		let current = folder;
		for (;;) {
			const candidate = current === ""
				? templateFilename
				: `${current}/${templateFilename}`;
			if (templates.has(candidate) && candidate !== skipPath) {
				memo.set(key, candidate);
				return candidate;
			}
			if (current === "") break;
			current = parentFolderPath(current);
		}

		memo.set(key, null);
		return null;
	};

	return (node: ReferenceNode): ReferenceTarget | null => {
		const folder = parentFolderPath(node.path);
		const referencePath = node.kind === "template"
			? walk(folder, node.path)
			: walk(folder);

		if (!referencePath) return null;

		// A template without frontmatter still exists and contributes an empty map.
		const props = files.get(referencePath)?.props ?? new Map<string, unknown>();
		return { path: referencePath, props };
	};
}

/** AI: Folder-level conformance badge: missing beats extra, extra beats ok. */
export function aggregateState(states: readonly ForestState[]): ForestState {
	let sawExtra = false;
	let sawOk = false;

	for (const state of states) {
		if (state === "missing") return "missing";
		if (state === "extra") sawExtra = true;
		if (state === "ok") sawOk = true;
	}

	if (sawExtra) return "extra";
	return sawOk ? "ok" : "none";
}

function addCounts(first: ScopeCounts, second: ScopeCounts): ScopeCounts {
	return {
		templates: first.templates + second.templates,
		notesMissing: first.notesMissing + second.notesMissing,
		notesExtra: first.notesExtra + second.notesExtra,
	};
}

function noteCounts(state: ForestState): ScopeCounts {
	return {
		templates: 0,
		notesMissing: state === "missing" ? 1 : 0,
		notesExtra: state === "extra" ? 1 : 0,
	};
}

/** AI: State of a note compared to its effective reference. */
function noteState(props: Map<string, unknown> | null, reference: ReferenceTarget | null): ForestState {
	if (!props || !reference) return "none";

	const status: MapConformanceStatus = computeMapConformance(props, reference.props);
	return status;
}

/** AI: A template is `missing` only for absent parent keys; extra is expected. */
function templateState(
	props: Map<string, unknown> | null,
	reference: ReferenceTarget | null
): ForestState {
	if (!reference) return "ok";
	const comparison = computeTemplateConformance(props ?? new Map<string, unknown>(), reference.props);
	return comparison.isValid ? "ok" : "missing";
}

/** AI: Total number of files reported in `Issues` / `Fix all`. */
export function countIssues(forest: Forest): number {
	let count = 0;
	for (const node of forest.nodes.values()) {
		if (node.kind === "note" && node.state !== "ok" && node.state !== "none") count++;
		if (node.kind === "template" && node.state === "missing") count++;
	}
	return count;
}

/** AI: The three issue groups, in the order the dashboard shows them. */
export interface IssueGroups {
	templates: ForestFileNode[];
	notesMissing: ForestFileNode[];
	notesExtra: ForestFileNode[];
}

export function collectIssueGroups(forest: Forest): IssueGroups {
	const groups: IssueGroups = { templates: [], notesMissing: [], notesExtra: [] };

	for (const node of forest.nodes.values()) {
		if (node.kind === "template" && node.state === "missing") {
			groups.templates.push(node);
		} else if (node.kind === "note") {
			if (node.state === "missing") groups.notesMissing.push(node);
			if (node.state === "extra") groups.notesExtra.push(node);
		}
	}

	const byPath = (first: ForestFileNode, second: ForestFileNode): number =>
		compareVaultPaths(first.path, second.path);

	groups.templates.sort(byPath);
	groups.notesMissing.sort(byPath);
	groups.notesExtra.sort(byPath);
	return groups;
}

/**
 * AI: Builds the forest from plain file records.
 *
 * Algorithm:
 * 1. resolve each node against the injected reference;
 * 2. compute conformance and chain soundness for every file;
 * 3. create a node only for the folders that own a template, and attach every
 *    note to the nearest ancestor that does (template-less folders flatten);
 * 4. link the cascade folders to their nearest cascade ancestor;
 * 5. promote the folders without a cascade ancestor to local roots.
 */
export function buildForest(input: ForestInput): Forest {
	const files = new Map<string, ForestFileInput>();
	for (const file of input.files) files.set(file.path, file);

	const templateFor = input.referenceFor ?? createFolderReferenceResolver(files, input.templateFilename);

	const nodes = new Map<string, ForestFileNode>();
	const folderTemplates = new Map<string, string>();

	for (const [path, file] of files) {
		const isTemplate = baseName(path) === input.templateFilename;
		const kind = isTemplate ? "template" : "note";
		const node: ForestFileNode = {
			kind,
			path,
			name: baseName(path),
			props: file.props,
			state: "none",
			counts: emptyCounts(),
			referencePath: null,
			chainSound: false,
			localRoot: false,
			scopeFolder: null,
		};

		const reference = templateFor({ path, kind, props: file.props });
		node.referencePath = reference?.path ?? null;
		node.state = kind === "template"
			? templateState(file.props, reference)
			: noteState(file.props, reference);
		node.counts = kind === "template"
			? { templates: node.state === "missing" ? 1 : 0, notesMissing: 0, notesExtra: 0 }
			: noteCounts(node.state);

		if (isTemplate) {
			node.localRoot = reference === null;
			folderTemplates.set(parentFolderPath(path), path);
		}

		nodes.set(path, node);
	}

	// Chain soundness: a note is alignable only when every template from its
	// nearest reference down to the local root is conformant.
	const soundMemo = new Map<string, boolean>();
	const isTemplateSound = (path: string | null): boolean => {
		if (!path) return true;
		const memoized = soundMemo.get(path);
		if (memoized !== undefined) return memoized;

		const node = nodes.get(path);
		if (!node || node.kind !== "template") {
			soundMemo.set(path, true);
			return true;
		}

		const sound = node.state !== "missing" && isTemplateSound(node.referencePath);
		soundMemo.set(path, sound);
		return sound;
	};

	for (const node of nodes.values()) {
		node.chainSound = node.kind === "template"
			? node.state !== "missing" && isTemplateSound(node.referencePath)
			: isTemplateSound(node.referencePath);
	}

	// Cascade folder tree. A folder is a node only when it directly contains a
	// template; a template-less folder is transparent. Consecutive transparent
	// folders collapse recursively into the nearest ancestor that has a
	// template, and the notes they hold move up with them.
	const folders = new Map<string, ForestFolderNode>();
	const folderNode = (path: string): ForestFolderNode => {
		const existing = folders.get(path);
		if (existing) return existing;

		const templatePath = folderTemplates.get(path);
		const template = templatePath ? nodes.get(templatePath) ?? null : null;
		const node: ForestFolderNode = {
			kind: "folder",
			path,
			name: path === "" ? "/" : baseName(path),
			state: "none",
			counts: emptyCounts(),
			localRoot: template?.localRoot ?? false,
			template,
			folders: [],
			notes: [],
			descendantsState: "none",
			notesState: "none",
			referencePath: template?.path ?? null,
			parentPath: null,
		};
		folders.set(path, node);
		return node;
	};

	for (const folderPath of folderTemplates.keys()) folderNode(folderPath);

	// Nearest cascade folder for a path: the path itself when it owns a template,
	// otherwise its closest ancestor that does. `null` means no cascade at all.
	const scopeFolderFor = (path: string): ForestFolderNode | null => {
		let current = path;
		for (;;) {
			const found = folders.get(current);
			if (found) return found;
			if (current === "") return null;
			current = parentFolderPath(current);
		}
	};

	// Attach files: a template lives in its own folder, a note belongs to the
	// nearest cascade folder above it (possibly several physical levels up).
	for (const node of nodes.values()) {
		if (node.kind === "template") {
			node.scopeFolder = parentFolderPath(node.path);
			continue;
		}

		const scope = scopeFolderFor(parentFolderPath(node.path));
		if (!scope) {
			node.scopeFolder = null;
			continue;
		}
		node.scopeFolder = scope.path;
		scope.notes.push(node);
	}

	// Link cascade folders to their nearest cascade ancestor, sorted by path.
	const roots: ForestFolderNode[] = [];
	for (const folder of folders.values()) {
		const parent = folder.path === "" ? null : scopeFolderFor(parentFolderPath(folder.path));
		folder.parentPath = parent?.path ?? null;
		if (parent) {
			parent.folders.push(folder);
		} else {
			roots.push(folder);
		}
	}
	for (const folder of folders.values()) {
		folder.folders.sort((first, second) => compareVaultPaths(first.path, second.path));
		folder.notes.sort((first, second) => compareVaultPaths(first.path, second.path));
	}
	roots.sort((first, second) => compareVaultPaths(first.path, second.path));

	// Counters and badges are bottom-up: a folder describes its whole subtree.
	// `state` includes the folder's own template; `descendantsState` excludes it,
	// so the UI can show "this template" and "its children" as separate badges.
	// `notesState` isolates the notes for the `N notes` group badge.
	const visited = new Set<string>();
	const finalizeFolder = (folder: ForestFolderNode): ScopeCounts => {
		if (visited.has(folder.path)) return folder.counts;

		let counts = folder.template?.counts ?? emptyCounts();
		const states: ForestState[] = [];
		const descendantStates: ForestState[] = [];
		const noteStates: ForestState[] = [];
		if (folder.template) states.push(folder.template.state);

		for (const child of folder.folders) {
			counts = addCounts(counts, finalizeFolder(child));
			states.push(child.state);
			descendantStates.push(child.state);
		}
		for (const note of folder.notes) {
			counts = addCounts(counts, note.counts);
			states.push(note.state);
			descendantStates.push(note.state);
			noteStates.push(note.state);
		}

		folder.counts = counts;
		folder.state = aggregateState(states);
		folder.descendantsState = aggregateState(descendantStates);
		folder.notesState = aggregateState(noteStates);
		visited.add(folder.path);
		return counts;
	};

	for (const folder of folders.values()) finalizeFolder(folder);

	const outsideNotes: ForestFileNode[] = [];
	for (const node of nodes.values()) {
		if (node.kind !== "note") continue;
		if (node.referencePath) continue;
		outsideNotes.push(node);
	}
	outsideNotes.sort((first, second) => compareVaultPaths(first.path, second.path));

	return { roots, outsideNotes, nodes, folders };
}
