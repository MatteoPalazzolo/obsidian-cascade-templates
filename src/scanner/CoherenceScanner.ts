import { TFile } from "obsidian";
import { AllertLevel, ScannerABC } from "./ScannerABC";
import { getFilePropsMapFromCache, getTemplateOfFile } from "../core/templateAPI";
import { computeMapConformance } from "../core/mapOperations";
import { getSettings, isTemplateFile } from "../settings";

/**
 * AI: Note vs template scanner (E1/E4).
 *
 * Reads only `metadataCache` — no `vault.read` per file — and respects the
 * `scannerTargets.notes` setting. Templates are handled by the dedicated
 * `TemplateCoherenceScanner`.
 */
export class CoherenceScanner extends ScannerABC {

    // rendering
    scannerName = "Notes not conforming to their template";
    allertLevel = AllertLevel.Warning;

    // logic
    autofix = false;

    _scan(file: TFile): boolean {
        if (!getSettings().scannerTargets.notes) return false;
        if (isTemplateFile(file)) return false;

        const template = getTemplateOfFile(file);
        if (!template) return false;

        // AI: shared accessor (handles the 'position' key injected by Obsidian).
        const fileProps = getFilePropsMapFromCache(file);
        const templateProps = getFilePropsMapFromCache(template);

        return computeMapConformance(fileProps, templateProps) !== 'ok';
    }

}
