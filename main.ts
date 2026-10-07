import {Plugin} from 'obsidian';
import {
	init as initTemplateAPIModule,
	registerTemplatezListener,
} from 'src/core/templateAPI';
import * as ReconformButton from 'src/features/reconformButton';
import * as TemplateStatusIcon from 'src/features/templateStatusIcon';
import { TemplateScannerModal } from 'src/scanner/TemplateScannerModal';


export default class extends Plugin {

	async onload() {
		// https://lucide.dev/

		// init modules
		initTemplateAPIModule(this);
		ReconformButton.init(this);
		TemplateStatusIcon.init(this);

		this.addRibbonIcon('scan-eye', 'Template Scanner', () => new TemplateScannerModal(this.app).open());

		this.app.workspace.onLayoutReady(() => {
			void registerTemplatezListener();
			ReconformButton.refreshButton();
			void TemplateStatusIcon.refreshIcon();
		});
	}

	onunload() {
		ReconformButton.clear();
		TemplateStatusIcon.clear();
	}

}
