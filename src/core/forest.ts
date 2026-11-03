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
}

/** AI: A folder row; the template is a child of the folder, never one of the notes. */
export interface ForestFolderNode extends NodeBase {
	kind: "folder";
	localRoot: boolean;
	/** Template physically placed in this folder, if any. */
	template: ForestFileNode | null;
	folders: ForestFolderNode[];
	notes: ForestFileNode[];
	/** Nearest template for the notes of this folder (display only). */
	referencePath: string | null;
}

/** AI: Whole forest: the subtrees of the local roots plus what stays outside. */
export interface Forest {
	roots: ForestFolderNode[];
	/** Notes not reachable from any local root (no template at all). */
	outsideNotes: ForestFileNode[];
	/** All notes and templates keyed by path. */
	nodes: Map<string, ForestFileNode>;
	/** All folders keyed by path (`""` is the vault root). */
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
 * 1. collect every folder mentioned by a file path;
 * 2. resolve each node against the injected reference;
 * 3. compute conformance and chain soundness for every file;
 * 4. attach files to folders, then folder to folder;
 * 5. promote the folders whose template has no ancestor to local roots.
 */
export function buildForest(input: ForestInput): Forest {
	const files = new Map<string, ForestFileInput>();
	for (const file of input.files) files.set(file.path, file);

	const templateFor = input.referenceFor ?? createFolderReferenceResolver(files, input.templateFilename);

	const folderPaths = new Set<string>([""]);
	for (const path of files.keys()) {
		let folder = parentFolderPath(path);
		for (;;) {
			folderPaths.add(folder);
			if (folder === "") break;
			folder = parentFolderPath(folder);
		}
	}

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

	// Folder tree. Folders are created for every ancestor, even when they hold
	// no file directly, because the cascade is a structural map.
	const folders = new Map<string, ForestFolderNode>();
	const folderNode = (path: string): ForestFolderNode => {
		const existing = folders.get(path);
		if (existing) return existing;

		const node: ForestFolderNode = {
			kind: "folder",
			path,
			name: path === "" ? "/" : baseName(path),
			state: "none",
			counts: emptyCounts(),
			localRoot: false,
			template: null,
			folders: [],
			notes: [],
			referencePath: null,
		};
		folders.set(path, node);
		return node;
	};

	for (const path of folderPaths) folderNode(path);

	// Attach files to their folder.
	for (const node of nodes.values()) {
		const folder = folderNode(parentFolderPath(node.path));
		if (node.kind === "template") {
			folder.template = node;
		} else {
			folder.notes.push(node);
		}
	}

	// Attach folders to their parent, sorted by path.
	const childFolders = new Map<string, ForestFolderNode[]>();
	for (const folder of folders.values()) {
		if (folder.path === "") continue;
		const parent = folderNode(parentFolderPath(folder.path));
		const list = childFolders.get(parent.path) ?? [];
		list.push(folder);
		childFolders.set(parent.path, list);
	}
	for (const [parentPath, list] of childFolders) {
		const parent = folderNode(parentPath);
		list.sort((first, second) => compareVaultPaths(first.path, second.path));
		parent.folders = list;
	}
	for (const folder of folders.values()) {
		folder.notes.sort((first, second) => compareVaultPaths(first.path, second.path));
		const reference = templateFor({
			path: folder.path === "" ? input.templateFilename : `${folder.path}/${input.templateFilename}`,
			kind: "template",
			props: null,
		});
		folder.referencePath = folder.template?.path ?? reference?.path ?? null;
	}

	// Counters and badges are bottom-up: a folder describes its whole subtree.
	const visited = new Set<string>();
	const finalizeFolder = (folder: ForestFolderNode): ScopeCounts => {
		if (visited.has(folder.path)) return folder.counts;

		let counts = folder.template?.counts ?? emptyCounts();
		const states: ForestState[] = [];
		if (folder.template) states.push(folder.template.state);

		for (const child of folder.folders) {
			counts = addCounts(counts, finalizeFolder(child));
			states.push(child.state);
		}
		for (const note of folder.notes) {
			counts = addCounts(counts, note.counts);
			states.push(note.state);
		}

		folder.counts = counts;
		folder.state = aggregateState(states);
		visited.add(folder.path);
		return counts;
	};

	for (const folder of folders.values()) finalizeFolder(folder);

	// A local root is a folder whose own template has no ancestor. Its whole
	// subtree is the forest universe: folders under another local root cannot
	// exist by definition (a nested template always has an ancestor).
	const roots: ForestFolderNode[] = [];
	for (const [folderPath, templatePath] of folderTemplates) {
		const template = nodes.get(templatePath);
		if (!template?.localRoot) continue;
		const root = folderNode(folderPath);
		root.localRoot = true;
		roots.push(root);
	}
	roots.sort((first, second) => compareVaultPaths(first.path, second.path));

	const outsideNotes: ForestFileNode[] = [];
	for (const node of nodes.values()) {
		if (node.kind !== "note") continue;
		if (node.referencePath) continue;
		outsideNotes.push(node);
	}
	outsideNotes.sort((first, second) => compareVaultPaths(first.path, second.path));

	return { roots, outsideNotes, nodes, folders };
}

/** AI: Ancestor folder paths of a file, root excluded, for breadcrumbs. */
export function folderTrail(path: string): string[] {
	const trail: string[] = [];
	let folder = parentFolderPath(path);
	while (folder !== "") {
		trail.unshift(folder);
		folder = parentFolderPath(folder);
	}
	return trail;
}
