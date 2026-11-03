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
 * - Built on the native `ConfirmationModal` (Obsidian 1.13+), so the X, Esc
 *   and the button row are the app's own, not a replica.
 * - The `Enable` button starts disabled and is released only by the checkbox.
 * - `addCheckbox` renders the acknowledgement in the footer; on mobile the
 *   footer stacks bottom-up, so the checkbox ends up below `Enable`. Since the
 *   acknowledgement must be read before the action, the row is moved into the
 *   content (the move uses node snapshots, so it does not depend on the app's
 *   internal wrapper markup).
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
			.addButton(button => {
				enableButton = button;
				button
					.setButtonText("Enable")
					.setCta()
					.setDisabled(true)
					.onClick(() => finish(true));
			})
			.addCancelButton("Cancel");

		const footer = modal.buttonContainerEl;
		const footerBefore = new Set<Node>(Array.from(footer.childNodes));
		const modalBefore = new Set<Node>(Array.from(modal.modalEl.childNodes));

		modal.addCheckbox("I understand the risks", value => {
			enableButton?.setDisabled(!value);
		});
		liftCheckboxRow(modal.contentEl, footerBefore, footer);
		liftCheckboxRow(modal.contentEl, modalBefore, modal.modalEl);

		// Snapshot before opening: the confirmation row may be rendered during
		// `open()` rather than by `addCheckbox`.
		const footerBeforeOpen = new Set<Node>(Array.from(footer.childNodes));
		const modalBeforeOpen = new Set<Node>(Array.from(modal.modalEl.childNodes));

		modal.setCloseCallback(() => finish(false));
		modal.open();

		const lift = (): void => {
			liftCheckboxRow(modal.contentEl, footerBeforeOpen, footer);
			liftCheckboxRow(modal.contentEl, modalBeforeOpen, modal.modalEl);
		};
		lift();
		window.setTimeout(lift, 0);
	});
}

/**
 * AI: Moves the nodes added to `source` since the `known` snapshot that contain
 * a checkbox but no button. This keeps the acknowledgement above the button
 * row on every platform without depending on the app's wrapper markup.
 */
function liftCheckboxRow(target: HTMLElement, known: Set<Node>, source: HTMLElement): boolean {
	let moved = false;
	for (const node of Array.from(source.childNodes)) {
		if (known.has(node) || !isCheckboxRow(node)) continue;
		target.appendChild(node);
		moved = true;
	}
	return moved;
}

/** AI: True for a checkbox row, false for the footer once it holds buttons. */
function isCheckboxRow(node: Node): boolean {
	if (!node.instanceOf(HTMLElement)) return false;
	if (node.querySelector("button")) return false;
	return node.matches('input[type="checkbox"]')
		|| node.querySelector('input[type="checkbox"]') !== null;
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
