import { Menu, Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import { getTemplateOfFolder, reconformFile } from "../core/templateAPI";
import { holdTemplaterPendingTemplate } from "../core/templaterBridge";
import { getTemplateFilename } from "../settings";

/**
 * AI: Folder context-menu action that creates the folder template (feature C).
 *
 * Role in the architecture:
 * Creating a template by hand means remembering `templateBasename` and placing
 * the file in the right folder. This module owns the folder-menu entry (desktop
 * right-click, mobile long-press) and the creation runner shared with the
 * command palette; the palette commands themselves live in `templateCommands.ts`
 * so this file stays focused on the folder menu.
 *
 * - no local template and no ancestor → `New root cascade template`;
 * - no local template but an ancestor exists → `New child cascade template`
 *   (it will inherit the parent's properties);
 * - local template already present → disabled `Cascade template already in
 *   folder`, so the entry still signals the state.
 *
 * The file is created empty and its properties are seeded **immediately** with
 * the same `reconformFile(..., "add-missing")` engine as the panel, even when
 * auto-apply is off: this is an explicit action, not an automatic cascade. The
 * body is left to the auto-apply listener, which runs ~200 ms later and is the
 * only place that knows the `off` / `properties` / `full` modes.
 *
 * Templater safety: before `vault.create` the path is registered in Templater's
 * `files_with_pending_templates`, exactly like Templater does for its own
 * templates, so its ~300 ms on-create pass skips the new file. Without that
 * guard Templater would evaluate `<% … %>` and overwrite the fresh template.
 */
export function registerFolderTemplateMenu(plugin: Plugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on("file-menu", (menu, file) => {
			if (!(file instanceof TFolder)) return;
			addFolderTemplateMenuItem(plugin, menu, file);
		})
	);
}

/** AI: Adds the create entry, or the disabled "already exists" one. */
function addFolderTemplateMenuItem(plugin: Plugin, menu: Menu, folder: TFolder): void {
	// const templateName = getTemplateFilename();
	const path = templatePath(folder);

	if (plugin.app.vault.getAbstractFileByPath(path) instanceof TFile) {
		menu.addItem(item => item
			//.setTitle(`Template already exists (${templateName})`)
			.setTitle(`Cascade template already in folder`)
			.setIcon("file")
			// .setSection("cascade-templates")
			.setDisabled(true));
		return;
	}

	// A local template would have hit the branch above; anything found now is
	// an ancestor, so the new template extends the cascade instead of starting
	// a new root.
	const parent = getTemplateOfFolder(folder);
	/*
	const title = parent
		? `New child template (${templateName})`
		: `New root template (${templateName})`;
	*/
	const title = parent
		? `New child cascade template`
		: `New root cascade template`;

	menu.addItem(item => item
		.setTitle(title)
		.setIcon(parent ? "file-plus" : "crown")
		// .setSection("cascade-templates")
		.onClick(() => createFolderTemplateInFolder(plugin, folder)));
}

/**
 * AI: Shared runner for the folder menu and the palette command.
 *
 * The menu already disables itself when the template exists; the command
 * cannot, so it reports the existing file with an error-toned Notice instead
 * of doing nothing. Creation failures use the same neutral Notice in both
 * entry points.
 */
export function createFolderTemplateInFolder(plugin: Plugin, folder: TFolder): void {
	const path = templatePath(folder);

	if (plugin.app.vault.getAbstractFileByPath(path) instanceof TFile) {
		const notice = new Notice(`Cascade template already exists in this folder: ${path}`);
		notice.messageEl.addClass("cascade-templates-notice-error");
		return;
	}

	void createFolderTemplate(plugin, folder).catch(error => {
		console.error("[cascade-templates] Could not create the folder template", error);
		new Notice(`Cascade Templates: could not create template at ${path}.`);
	});
}

/** AI: Vault path of the template inside `folder`, vault root included. */
function templatePath(folder: TFolder): string {
	const name = getTemplateFilename();
	return folder.isRoot() ? name : normalizePath(`${folder.path}/${name}`);
}

/**
 * AI: Initial content of a ROOT template.
 *
 * A root template has no parent to inherit properties from, so it would be
 * created with an empty frontmatter and Obsidian would render no property row
 * to edit. A key with an empty value forces the properties GUI to appear; the
 * user renames or replaces it in place. Child templates do not use it: their
 * parent's properties are seeded immediately by `reconformFile`.
 */
const ROOT_TEMPLATE_PLACEHOLDER = "---\nedit:\n---\n";

/**
 * AI: Creates and opens the template. The re-check guards a race with another
 * tab; the Templater guard is released in `finally` even when creation fails.
 */
async function createFolderTemplate(plugin: Plugin, folder: TFolder): Promise<void> {
	const app = plugin.app;
	const path = templatePath(folder);

	if (app.vault.getAbstractFileByPath(path)) return;

	// `getTemplateOfFolder` walks the ancestors only (the local template does not
	// exist yet), so a hit means this is a child template.
	const initialContent = getTemplateOfFolder(folder) ? "" : ROOT_TEMPLATE_PLACEHOLDER;

	const release = holdTemplaterPendingTemplate(app, path);
	let created: TFile | null = null;
	try {
		created = await app.vault.create(path, initialContent);
	} finally {
		release();
	}

	if (!created) return;

	// Seed only the properties: the body follows auto-apply. A malformed parent
	// must not prevent the file from being opened.
	try {
		await reconformFile(created, "add-missing");
	} catch (error) {
		console.error("[cascade-templates] Could not seed the folder template", error);
	}

	await app.workspace.getLeaf("tab").openFile(created);
}
