import { App, Modal } from 'obsidian';
import { ScannerABC } from './ScannerABC';
import { CoherenceScanner } from './CoherenceScanner';
import { TemplateCoherenceScanner } from './TemplateCoherenceScanner';
import { isScannerExcluded } from '../settings';

/**
 * AI: Vault scanner modal (Session E).
 *
 * Runs every scanner in one pass over `getMarkdownFiles()`, filtered by the
 * settings (E4): excluded folders are skipped and each scanner decides whether
 * it applies to the file kind. All reads come from `metadataCache`, so the scan
 * no longer touches the disk (E1).
 *
 * The UI is intentionally minimal for this first version: a scanned-count line,
 * one collapsible block per scanner with results, and an empty state.
 */
export class TemplateScannerModal extends Modal {

    scannerList: ScannerABC[];

    constructor(app: App) {
        super(app);
        this.scannerList = [
            new CoherenceScanner(this),
            new TemplateCoherenceScanner(this),
        ];
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.addClass("ScannerModal");
        contentEl.createEl('h3', { text: 'Template Scanner' });

        // Let the modal paint before the synchronous cache walk (E1).
        const summaryEl = contentEl.createEl('p', { cls: 'scanner-summary', text: 'Scanning...' });
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        if (!contentEl.isConnected) return;

        const scanned = this.runAllScanner();
        summaryEl.setText(`${scanned} markdown files scanned.`);

        const withResults = this.scannerList.filter(scanner => scanner.positive.length > 0);
        if (withResults.length === 0) {
            contentEl.createEl('p', { cls: 'scanner-empty', text: 'No issues found.' });
            return;
        }

        withResults.forEach(scanner => scanner.render(contentEl));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    /** AI: One pass over the vault; returns how many files were actually scanned. */
    private runAllScanner(): number {
        const files = this.app.vault.getMarkdownFiles().filter(file => !isScannerExcluded(file.path));

        for (const file of files) {
            for (const scanner of this.scannerList) {
                scanner.scan(file);
            }
        }

        return files.length;
    }

}
