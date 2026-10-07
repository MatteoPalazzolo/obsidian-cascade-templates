import { TFile } from "obsidian";
import { AllertLevel, ScannerABC } from "./!ScannerABC";

export class TodoScanner extends ScannerABC {
    
    // rendering
    scannerName = "TODO";
    allertLevel = AllertLevel.Info;
    
    // logic
    autofix = false;

    _scan(file: TFile, content: string): boolean {
        return /#TO\//.test(content);
    }

}