import { TFile } from "obsidian";
import type { ReconformMode } from "../../core/conformance";
import type { JournalFileChange } from "../../core/journal";
import { getFileProps, reconformFile } from "../../core/templateAPI";
import { isInFolder } from "../../core/forest";

/**
 * AI: Sequential batch executor for the dashboard verbs.
 *
 * Role in the architecture:
 * The modal decides WHAT to touch; this module only applies one homogeneous
 * phase and returns the material the journal needs. It never touches the UI.
 *
 * Failure policy:
 * - notes are independent leaves: a failure is reported and the batch continues;
 * - templates form a dependency chain: once a template fails, its whole folder
 *   subtree is skipped while the siblings proceed.
 *
 * Every successful write is journaled with its `before` map and its change list;
 * failed files are kept as `skipped` so a retry knows they were attempted but
 * have nothing to restore.
 */

export interface BatchTarget {
	file: TFile;
	mode: ReconformMode;
	kind: "note" | "template";
}

export interface BatchError {
	path: string;
	message: string;
}

export interface BatchOutcome {
	files: JournalFileChange[];
	errors: BatchError[];
	attempted: number;
}

export type BatchProgress = (done: number, total: number, path: string) => void;

function depth(path: string): number {
	let count = 0;
	for (const char of path) if (char === "/") count++;
	return count;
}

/** AI: Templates shallow-first (a child target depends on its parent's state). */
export function sortBatchTargets(targets: readonly BatchTarget[]): BatchTarget[] {
	const copy = [...targets];
	copy.sort((first, second) => {
		if (first.kind !== second.kind) return first.kind === "template" ? -1 : 1;
		if (first.kind === "template") return depth(first.file.path) - depth(second.file.path);
		return first.file.path.localeCompare(second.file.path, undefined, { numeric: true });
	});
	return copy;
}

export async function runBatch(
	targets: readonly BatchTarget[],
	onProgress?: BatchProgress
): Promise<BatchOutcome> {
	const ordered = sortBatchTargets(targets);
	const files: JournalFileChange[] = [];
	const errors: BatchError[] = [];
	const failedFolders: string[] = [];
	let done = 0;

	for (const target of ordered) {
		done++;
		onProgress?.(done, ordered.length, target.file.path);

		if (target.kind === "template" && failedFolders.some(folder => isInFolder(target.file.path, folder))) {
			files.push(await skippedFile(target.file));
			continue;
		}

		try {
			const result = await reconformFile(target.file, target.mode);
			if (result.changed) {
				files.push({
					path: target.file.path,
					before: result.before,
					changes: result.changes,
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push({ path: target.file.path, message });
			files.push(await skippedFile(target.file));
			if (target.kind === "template") {
				const index = target.file.path.lastIndexOf("/");
				failedFolders.push(index < 0 ? "" : target.file.path.slice(0, index));
			}
		}
	}

	return { files, errors, attempted: ordered.length };
}

/** AI: A skipped record with the best-effort current frontmatter (never restored). */
async function skippedFile(file: TFile): Promise<JournalFileChange> {
	let before = new Map<string, unknown>();
	try {
		before = await getFileProps(file);
	} catch {
		// The file may have disappeared during the batch; an empty map is enough
		// because skipped files are excluded from every rewind.
	}
	return { path: file.path, before, changes: [], skipped: true };
}
