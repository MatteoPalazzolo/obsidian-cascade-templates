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
import { maybeShowTemplaterNotice } from 'src/core/templaterConsent';
import * as MetadataPanel from 'src/features/metadataPanel';
import { registerFolderTemplateMenu } from 'src/features/folderTemplateMenu';
import {
	CascadeTemplatesSettingTab,
	initSettings,
	onSettingsChange,
} from 'src/settings';


export default class extends Plugin {

	// `Plugin.onload()` is typed `Promise<void> | void` since the 1.13 baseline,
	// so the async implementation needs no lint suppression: Obsidian awaits it.
	async onload() {
		// https://lucide.dev/

		// Settings first: the template file name is read synchronously by the
		// other modules, so it must be loaded before they can do anything.
		await initSettings(this);

		// G: the bridge used to be opt-out and synced with the vault; tell the
		// user once (per device) that consent is now local and off by default.
		maybeShowTemplaterNotice(this.app);

		// init modules
		initTemplateAPIModule(this);
		registerHistoryLifecycle(this);
		MetadataPanel.init(this);
		registerFolderTemplateMenu(this);

		this.addSettingTab(new CascadeTemplatesSettingTab(this));

		// D3: a settings change must be reflected by the visible panels.
		// Debounced because the text field fires on every keystroke.
		const refreshPanels = debounce(() => MetadataPanel.refreshAll(), 200, true);
		this.register(onSettingsChange(() => refreshPanels()));

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
