import { App, ConfirmationModal, type ConfirmationButton } from "obsidian";

/**
 * AI: Informed-consent dialog for the Templater bridge (feature G).
 *
 * Role in the architecture:
 * The bridge evaluates `<% … %>` (and `<%* … %>`, which runs JavaScript) while
 * writing to a note. Enabling it is a security decision, not a preference, so
 * the toggle must not flip on a single click: this modal states the risk, asks
 * for an explicit acknowledgement and only then writes the per-device flag.
 *
 * Implementation notes:
 * - Built on the native `ConfirmationModal` (Obsidian 1.13+), so the X, Esc,
 *   the button row and the mobile layout are the app's own, not a replica.
 * - The `Enable` button starts disabled and is released only by the checkbox.
 * - The promise resolves `true` only from that button. Closing by X, Esc or
 *   `Cancel` resolves `false`, and the caller writes nothing.
 */
export function confirmTemplaterConsent(app: App): Promise<boolean> {
	return new Promise<boolean>(resolve => {
		let enableButton: ConfirmationButton | undefined;
		let settled = false;

		// A button click closes the modal too, so the close callback would fire
		// right after `finish(true)`; the guard keeps the first answer.
		const finish = (confirmed: boolean): void => {
			if (settled) return;
			settled = true;
			resolve(confirmed);
		};

		const modal = new ConfirmationModal(app);
		modal
			.setTitle("Enable Templater evaluation in notes")
			.setContent(consentText())
			.addCheckbox("I understand the risks", value => {
				enableButton?.setDisabled(!value);
			})
			.addButton(button => {
				enableButton = button;
				button
					.setButtonText("Enable")
					.setCta()
					.setDisabled(true)
					.onClick(() => finish(true));
			})
			.addCancelButton("Cancel");

		modal.setCloseCallback(() => finish(false));
		modal.open();
	});
}

/**
 * AI: Body of the dialog. The danger is stated first, then the trust boundary,
 * then the storage scope and the graceful degradation contract.
 */
function consentText(): DocumentFragment {
	return createFragment(fragment => {
		fragment.createEl("p", {
			text:
				"This can be dangerous if your templates contain unsafe content: \"<%* … %>\" blocks run " +
				"arbitrary JavaScript, and expressions can read or modify files in your vault.",
		});
		fragment.createEl("p", {
			text:
				"Only enable this if you trust the current and future contents of this vault, including " +
				"files you may later download, copy, or sync from other people.",
		});
		fragment.createEl("p", {
			text:
				"This setting is stored on this device for this vault only; enable it separately on each " +
				"device where you use this vault. This plugin calls Templater's internal API; if Templater " +
				"is disabled or updated incompatibly, expressions are written verbatim.",
		});
	});
}
