import { App, Plugin, TFile, TFolder, Notice } from "obsidian";
import { getTemplateOfFile } from "../core/templateAPI";
import { createFolderTemplateInFolder } from "./folderTemplateMenu";

/**
 * AI: Command-palette entries for template actions (feature C).
 *
 * Role in the architecture:
 * The folder menu can target any folder, but the palette only knows the active
 * note. This module maps the two template actions onto that context:
 *
 * - `Create cascade template in current folder` → the folder of the active
 *   note, reusing the runner shared with the folder menu;
 * - `Navigate to parent template` → the reference template of the active note
 *   (nearest ancestor template; for a template, its parent template), opened
 *   in a new tab so the current note is not replaced.
 *
 * Both commands are gated with `checkCallback`: without an active note (or
 * without a template to navigate to) they are disabled instead of falling back
 * to the vault root or showing an error.
 */
export function registerTemplateCommands(plugin: Plugin): void {
	plugin.addCommand({
		id: "create-folder-template",
		name: "Create cascade template in current folder",
		checkCallback: checking => {
			const folder = activeFileFolder(plugin.app);
			if (!folder) return false;
			if (!checking) createFolderTemplateInFolder(plugin, folder);
			return true;
		},
	});

	plugin.addCommand({
		id: "navigate-to-current-template",
		name: "Navigate to parent template",
		checkCallback: checking => {
			const folder = activeFileFolder(plugin.app);
			if (!folder) return false;

			if (!checking) {
				const target = currentTemplate(plugin.app);	
				if (!target) {
					const notice = new Notice(`This is already the local root.`);
					notice.messageEl.addClass("cascade-templates-notice-error");
					return true;
				};
				void openTemplate(plugin.app, target);
			}

			return true;
		},
	});
}

/** AI: Folder of the active note, or undefined when no file view is active. */
function activeFileFolder(app: App): TFolder | undefined {
	const parent = app.workspace.getActiveFile()?.parent;
	return parent instanceof TFolder ? parent : undefined;
}

/**
 * AI: Template the active note points at, resolved at invocation time.
 *
 * `getTemplateOfFile` is the same resolver used by the metadata panel and skips
 * the file itself: a note resolves to its nearest ancestor template, a template
 * to its parent template. Non-markdown files have no reference template.
 */
function currentTemplate(app: App): TFile | undefined {
	return getTemplateOfFile(app.workspace.getActiveFile() ?? undefined);
}

/** AI: Opens the template in a new tab, mirroring the create action. */
async function openTemplate(app: App, template: TFile): Promise<void> {
	try {
		await app.workspace.getLeaf("tab").openFile(template);
	} catch (error) {
		console.error("[cascade-templates] Could not open the reference template", error);
	}
}
