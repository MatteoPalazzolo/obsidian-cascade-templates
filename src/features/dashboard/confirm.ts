import { App, ConfirmationModal } from "obsidian";

/**
 * AI: Native confirmation dialog for dashboard operations and rewinds.
 *
 * Role in the architecture:
 * Every bulk write and every rewind that can overwrite a manual edit asks
 * before acting. The dialog is the app's own `ConfirmationModal`, so the X,
 * Escape and button row are native on desktop and mobile.
 */

export interface ConfirmOptions {
	title: string;
	content: DocumentFragment;
	cta: string;
	cancel?: string;
}

export function confirmAction(app: App, options: ConfirmOptions): Promise<boolean> {
	return new Promise<boolean>(resolve => {
		let settled = false;
		const finish = (value: boolean): void => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		const modal = new ConfirmationModal(app);
		modal
			.setTitle(options.title)
			.setContent(options.content)
			.addButton(button => button
				.setButtonText(options.cta)
				.setCta()
				.onClick(() => finish(true)))
			.addCancelButton(options.cancel ?? "Cancel");

		modal.setCloseCallback(() => finish(false));
		modal.open();
	});
}

/** AI: One paragraph of the dialog body. */
export function confirmParagraph(text: string): HTMLParagraphElement {
	return createEl("p", { text });
}

/** AI: A muted line (numbers, warnings, skip notes). */
export function confirmMuted(text: string): HTMLDivElement {
	return createDiv({ cls: "ct-confirm-muted", text });
}

/** AI: Bulleted list, used for the rewind diff and the missing-file warning. */
export function confirmList(items: readonly string[]): HTMLUListElement {
	const list = createEl("ul", { cls: "ct-confirm-list" });
	for (const item of items) list.createEl("li", { text: item });
	return list;
}
