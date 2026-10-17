import { TFile } from "obsidian";
import { AllertLevel, ScannerABC } from "./ScannerABC";
import { computeTemplateConformance, getFilePropsMapFromCache, getTemplateOfFile } from "../core/templateAPI";
import { getSettings, isTemplateFile } from "../settings";

/**
 * AI: Template vs parent scanner (E3).
 *
 * A template is conformant when it includes every property of its parent
 * template; extra properties are expected (a nested template specialises the
 * parent), missing ones are not. Same rule as the status indicator in the
 * metadata panel, so scanner and UI agree.
 *
 * Cache-only and gated by `scannerTargets.templates` (E1/E4).
 */
export class TemplateCoherenceScanner extends ScannerABC {

    // rendering
    scannerName = "Templates missing properties from their parent template";
    allertLevel = AllertLevel.Warning;

    // logic
    autofix = false;

    _scan(file: TFile): boolean {
        if (!getSettings().scannerTargets.templates) return false;
        if (!isTemplateFile(file)) return false;

        const parent = getTemplateOfFile(file);
        if (!parent) return false;

        const conformance = computeTemplateConformance(
            getFilePropsMapFromCache(file),
            getFilePropsMapFromCache(parent),
        );

        return !conformance.isValid;
    }

}
