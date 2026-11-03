import { App, Menu, Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import { getTemplateOfFolder, reconformFile } from "../core/templateAPI";
import { holdTemplaterPendingTemplate } from "../core/templaterBridge";
import { getTemplateFilename } from "../settings";

/**
 * AI: Entry points that create the folder template (feature C).
 *
 * Role in the architecture:
 * Creating a template by hand means remembering `templateBasename` and placing
 * the file in the right folder. This module exposes the same action from two
 * places, so it stays discoverable on desktop and mobile:
 *
 * - folder menu: right-click on a folder (long-press on mobile);
 * - command palette: the folder of the active note.
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

/**
 * AI: Registers the command-palette entry for the same action.
 *
 * "Current folder" is the folder of the active note: the palette has no folder
 * selection, so the command is disabled (native `checkCallback` behaviour)
 * when no file view is active instead of silently guessing the vault root.
 * The menu stays the primary entry point because it can target any folder.
 */
export function registerFolderTemplateCommand(plugin: Plugin): void {
	plugin.addCommand({
		id: "create-folder-template",
		name: "Create cascade template in current folder",
		checkCallback: checking => {
			const folder = activeFileFolder(plugin.app);
			if (!folder) return false;
			if (!checking) runCreateFolderTemplate(plugin, folder);
			return true;
		},
	});
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
		.setIcon("file-plus")
		// .setSection("cascade-templates")
		.onClick(() => runCreateFolderTemplate(plugin, folder)));
}

/** AI: Folder of the active note, or undefined when no file view is active. */
function activeFileFolder(app: App): TFolder | undefined {
	const parent = app.workspace.getActiveFile()?.parent;
	return parent instanceof TFolder ? parent : undefined;
}

/**
 * AI: Shared runner for the menu and the palette command.
 *
 * The menu already disables itself when the template exists; the command
 * cannot, so it reports the existing file instead of doing nothing. Creation
 * failures are reported with the same Notice in both entry points.
 */
function runCreateFolderTemplate(plugin: Plugin, folder: TFolder): void {
	const path = templatePath(folder);

	if (plugin.app.vault.getAbstractFileByPath(path) instanceof TFile) {
		new Notice(`Cascade template already in this folder: ${path}`);
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
 * AI: Creates and opens the template. The re-check guards a race with another
 * tab; the Templater guard is released in `finally` even when creation fails.
 */
async function createFolderTemplate(plugin: Plugin, folder: TFolder): Promise<void> {
	const app = plugin.app;
	const path = templatePath(folder);

	if (app.vault.getAbstractFileByPath(path)) return;

	const release = holdTemplaterPendingTemplate(app, path);
	let created: TFile | null = null;
	try {
		created = await app.vault.create(path, "");
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
