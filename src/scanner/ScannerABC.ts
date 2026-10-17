import { Modal, Notice, TFile } from "obsidian";
import { setIconSafe } from "../utils/icons";

export enum AllertLevel {
    Suggestion,
    Info,
    Warning,
    Error
}

type AllertLevelStyle = { className: string, primaryColor: string, secondaryColor: string, iconName: string }
const ALLERT_LEVEL_STYLE: Record<AllertLevel, AllertLevelStyle> = {
    [AllertLevel.Suggestion]: {
        className: "suggestion",
        primaryColor: "#a3e635", // Verde chiaro (Suggerimento)
        secondaryColor: "#65a30d", // Verde scuro
        iconName: "message-circle-more"
    },
    [AllertLevel.Info]: {
        className: "info",
        primaryColor: "#3b82f6", // Blu acceso (Informazione)
        secondaryColor: "#1e40af", // Blu scuro
        iconName: "info"
    },
    [AllertLevel.Warning]: {
        className: "warning",
        primaryColor: "#facc15", // Giallo (Attenzione)
        secondaryColor: "#b45309", // Arancione scuro
        iconName: "triangle-alert"
    },
    [AllertLevel.Error]: {
        className: "error",
        primaryColor: "#ef4444", // Rosso acceso (Errore)
        secondaryColor: "#991b1b", // Rosso scuro
        iconName: "circle-x"
    }
};


export abstract class ScannerABC {
    
    // rendering
    abstract readonly scannerName: string;
    abstract readonly allertLevel: AllertLevel;

    // logic
    abstract readonly autofix: boolean;
    positive: TFile[] = [];
    modal: Modal;

    constructor(modal: Modal) {
        this.modal = modal;
    }

    scan(file: TFile): boolean {
        if (this._scan(file)) {
            this.positive.push(file);
            return true;
        }
        return false;
    }

    fix(target: TFile): boolean {
        new Notice("Autofix is not available yet.");
        throw new Error("Autofix is not available yet.");
    }

    render(parent: HTMLElement) {
        
        const {
            className,
            primaryColor,
            secondaryColor,
            iconName
        } = ALLERT_LEVEL_STYLE[this.allertLevel];

        const detailsEl = parent.createEl("details", { cls: className });
        detailsEl.style.setProperty("--main-color", primaryColor);
        detailsEl.style.setProperty("--side-color", secondaryColor);

        const summaryEl = detailsEl.createEl("summary");
        setIconSafe(summaryEl, iconName);
        summaryEl.createSpan({ text: this.scannerName, cls: 'title' })

        // AI: two-digit counter, e.g. 03 / 12. Kept for both scanners.
        summaryEl.createSpan({ text: this.positive.length.toString().padStart(2, '0'), cls: 'clickable-icon' });

        if (this.autofix) {
            const fixBtnEl = summaryEl.createSpan({ cls: 'clickable-icon btn-fix' });
            setIconSafe(fixBtnEl, "recycle");
            fixBtnEl.onclick = e => {
                e.preventDefault();
                this.positive.forEach( f => this.fix(f) );
                this.modal.close();
            }
        }
        
        this.positive.
            // sort by name in ascending order 
            // https://stackoverflow.com/questions/43311121/sort-an-array-of-objects-in-typescript
            sort((a, b) => (a.basename < b.basename ? -1 : 1)).
            forEach( f => {
                const itemEl = detailsEl.createDiv({ cls: 'item-container' });
                const fileNameEl = itemEl.createEl("a", { text: f.basename, cls: 'internal-link name' });
                fileNameEl.title = f.path;

                fileNameEl.onclick = e => {
                    e.preventDefault();
                    void this.modal.app.workspace.getLeaf(false).openFile(f);
                    this.modal.close();
                }

                if (this.autofix) {
                    const fixBtnEl = itemEl.createSpan({ cls: 'btn-fix clickable-icon' });
                    setIconSafe(fixBtnEl, "recycle");
                    fixBtnEl.onclick = e => {
                        e.preventDefault();
                        this.fix(f);
                        this.modal.close();
                    }
                }

            });

    }

    abstract _scan(file: TFile): boolean;

}