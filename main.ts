import {debounce, Plugin} from 'obsidian';
import {
	disposeTemplateAPI,
	init as initTemplateAPIModule,
	registerTemplatezListener,
} from 'src/core/templateAPI';
import {
	disposeHistory,
	registerHistoryLifecycle,
} from 'src/core/reconformHistory';
import * as MetadataPanel from 'src/features/metadataPanel';
import { TemplateScannerModal } from 'src/scanner/TemplateScannerModal';
import {
	CascadeTemplatesSettingTab,
	initSettings,
	onSettingsChange,
} from 'src/settings';
import { resolvableIcon } from 'src/utils/icons';


export default class extends Plugin {

	async onload() {
		// https://lucide.dev/

		// Settings first: the template file name is read synchronously by the
		// other modules, so it must be loaded before they can do anything.
		await initSettings(this);

		// init modules
		initTemplateAPIModule(this);
		registerHistoryLifecycle(this);
		MetadataPanel.init(this);

		this.addSettingTab(new CascadeTemplatesSettingTab(this));

		// D3: a settings change must be reflected by the visible panels.
		// Debounced because the text field fires on every keystroke.
		const refreshPanels = debounce(() => MetadataPanel.refreshAll(), 200, true);
		this.register(onSettingsChange(() => refreshPanels()));

		this.addRibbonIcon(resolvableIcon('scan-eye', 'search'), 'Template Scanner', () => new TemplateScannerModal(this.app).open());

		this.app.workspace.onLayoutReady(() => {
			registerTemplatezListener();
			MetadataPanel.refreshAll();
		});
	}

	onunload() {
		disposeTemplateAPI();
		MetadataPanel.clear();
		disposeHistory();
	}

}
