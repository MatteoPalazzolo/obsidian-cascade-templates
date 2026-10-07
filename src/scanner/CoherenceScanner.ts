import { TFile } from "obsidian";
import { AllertLevel, ScannerABC } from "./ScannerABC";
import { getFilePropsFromCache, getTemplateOfFile } from "../core/templateAPI";
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

        const toMap = (props: Record<string, any> = {}) => {
            const map = new Map<string, any>();
            for (const [key, value] of Object.entries(props)) {
                // 'position' è inserita automaticamente da Obsidian nella cache
                if (key === 'position') continue;
                map.set(key, value);
            }
            return map;
        };

        const fileProps = toMap(getFilePropsFromCache(file));
        const templateProps = toMap(getFilePropsFromCache(template));

        return computeMapConformance(fileProps, templateProps) !== 'ok';
    }

}
