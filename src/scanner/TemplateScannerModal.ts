import { App, Modal } from 'obsidian';
import { ScannerABC } from './ScannerABC';
import { CoherenceScanner } from './CoherenceScanner';

export class TemplateScannerModal extends Modal {

    scannerList: ScannerABC[];

    constructor(app: App) {
        super(app);
        this.scannerList = [
            new CoherenceScanner(this),
        ];
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.addClass("ScannerModal");
        contentEl.createEl('h3', { text: 'Template Scanner' });

        await this.runAllScanner();
        this.scannerList.forEach(
            scanner => scanner.render(contentEl)
        );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private async runAllScanner() {
        const files = this.app.vault.getMarkdownFiles();
        for (const f of files) {
            const content = await this.app.vault.read(f);
            for (const scanner of this.scannerList) {
                scanner.scan(f, content);
            }
        }
    }

}
