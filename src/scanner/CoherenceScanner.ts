import { TFile } from "obsidian";
import { AllertLevel, ScannerABC } from "./ScannerABC";
import { getFilePropsMapFromCache, getTemplateOfFile } from "../core/templateAPI";
import { computeMapConformance } from "../core/mapOperations";
import { TEMPLATE_FILENAME } from "../conts";

export class CoherenceScanner extends ScannerABC {

    // rendering
    scannerName = "Coerenza delle proprietà tra file e template";
    allertLevel = AllertLevel.Warning;

    // logic
    autofix = false;

    _scan(file: TFile, content: string): boolean {
        if (file.name === TEMPLATE_FILENAME) return false;

        const template = getTemplateOfFile(file);
        if (!template) return false;

        // AI: shared accessor (handles the 'position' key injected by Obsidian).
        const fileProps = getFilePropsMapFromCache(file);
        const templateProps = getFilePropsMapFromCache(template);

        return computeMapConformance(fileProps, templateProps) !== 'ok';
    }

}
