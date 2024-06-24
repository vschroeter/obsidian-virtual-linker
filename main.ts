import {
	App,
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
} from "obsidian";

import { GlossaryLinker } from "./linker/readModeLinker";
import { liveLinkerPlugin } from "./linker/liveLinker";

export interface LinkerPluginSettings {
	suppressSuffixForSubWords: boolean;
	matchOnlyWholeWords: boolean;
	includeAllFiles: boolean;
	linkerDirectories: string[];
	glossarySuffix: string;
	useMarkdownLinks: boolean;
	applyDefaultLinkStyling: boolean;
	includeHeaders: boolean,
	matchCaseSensitive: boolean;
	tagToIgnoreCase: string;
	tagToMatchCase: string;
	tagToExcludeFile: string;
	tagToIncludeFile: string;
}

const DEFAULT_SETTINGS: LinkerPluginSettings = {
	matchOnlyWholeWords: false,
	suppressSuffixForSubWords: false,
	includeAllFiles: true,
	linkerDirectories: ["Glossary"],
	glossarySuffix: "🔗",
	useMarkdownLinks: false,
	applyDefaultLinkStyling: true,
	includeHeaders: true,
	matchCaseSensitive: false,
	tagToIgnoreCase: "linker-ignore-case",
	tagToMatchCase: "linker-match-case",
	tagToExcludeFile: "linker-exclude",
	tagToIncludeFile: "linker-include"
};

export default class LinkerPlugin extends Plugin {
	settings: LinkerPluginSettings;

	async onload() {
		await this.loadSettings();

		// Register the glossary linker for the read mode
		this.registerMarkdownPostProcessor((element, context) => {
			context.addChild(new GlossaryLinker(this.app, this.settings, context, element));
		});

		// Register the live linker for the live edit mode
		this.registerEditorExtension(liveLinkerPlugin(this.app, this.settings));

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new LinkerSettingTab(this.app, this));

		// Context menu item to convert virtual links to real links
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source) => this.addContextMenuItem(menu, file, source)));
	}

	addContextMenuItem(menu: Menu, file: TAbstractFile, source: string) {
		// addContextMenuItem(a: any, b: any, c: any) {
		// Capture the MouseEvent when the context menu is triggered   // Define a named function to capture the MouseEvent

		const that = this;
		const app: App = this.app;
		const settings = this.settings;

		function contextMenuHandler(event: MouseEvent) {
			// Access the element that triggered the context menu
			const targetElement = event.target;

			// Check, if the element has the "virtual-link" class
			if (targetElement instanceof HTMLElement && targetElement.classList.contains('virtual-link-a')) {
				menu.addItem((item) => {
					item.setTitle("[Virtual Linker] Convert to real link")
						.setIcon("link")
						.onClick(() => {
							// Get from and to position from the element
							const from = parseInt(targetElement.getAttribute('from') || '-1');
							const to = parseInt(targetElement.getAttribute('to') || '-1');

							// Get the shown text
							const text = targetElement.getAttribute('origin-text') || '';
							const target = file;
							const activeFile = app.workspace.getActiveFile();
							const activeFilePath = activeFile?.path;


							// Create the replacement
							let replacement = "";
							if (settings.useMarkdownLinks) {
								replacement = `[${text}](${target.path})`;
							} else {
								replacement = `[[${target.path}|${text}]]`;
							}

							if (!activeFile) {
								console.error('No active file');
								return;
							}

							// Replace the text
							const editor = app.workspace.getActiveViewOfType(MarkdownView)?.editor;
							const fromEditorPos = editor?.offsetToPos(from);
							const toEditorPos = editor?.offsetToPos(to);

							if (!fromEditorPos || !toEditorPos) {
								console.warn('No editor positions');
								return;
							}

							editor?.replaceRange(replacement, fromEditorPos, toEditorPos);
						});
				});
			}

			// Remove the listener to prevent multiple triggers
			document.removeEventListener('contextmenu', contextMenuHandler);
		}

		// Capture the MouseEvent when the context menu is triggered
		document.addEventListener('contextmenu', contextMenuHandler, { once: true });
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);

		// Load markdown links from obsidian settings
		// At the moment obsidian does not provide a clean way to get the settings through an API
		// So we read the app.json settings file directly
		// We also Cannot use the vault API because it only reads the vault files not the .obsidian folder 
		const fileContent = await this.app.vault.adapter.read(this.app.vault.configDir + '/app.json');
		const appSettings = JSON.parse(fileContent);
		this.settings.useMarkdownLinks = appSettings.useMarkdownLinks;

	}


	/** Update plugin settings. */
	async updateSettings(settings: Partial<LinkerPluginSettings> = <Partial<LinkerPluginSettings>>{}) {
		Object.assign(this.settings, settings);
		await this.saveData(this.settings);
	}
}

class LinkerSettingTab extends PluginSettingTab {
	constructor(app: App, public plugin: LinkerPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl).setName("Matching behavior").setHeading();

		new Setting(containerEl)
			.setName("Virtual link suffix")
			.setDesc("The suffix to add to auto generated virtual links.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.glossarySuffix)
					.onChange(async (value) => {
						// console.log("New glossary suffix: " + value);
						await this.plugin.updateSettings({ glossarySuffix: value });
					})
			);

		// Toggle setting for case sensitivity
		new Setting(containerEl)
			.setName("Case sensitive")
			.setDesc("If activated, the matching is case sensitive.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.matchCaseSensitive)
					.onChange(async (value) => {
						// console.log("Case sensitive: " + value);
						await this.plugin.updateSettings({ matchCaseSensitive: value });
						this.display();
					})
			);

		if (this.plugin.settings.matchCaseSensitive) {
			// Text setting for tag to ignore case
			new Setting(containerEl)
				.setName("Tag to ignore case")
				.setDesc("By adding this tag to a file, the linker will ignore the case for the file.")
				.addText((text) =>
					text
						.setValue(this.plugin.settings.tagToIgnoreCase)
						.onChange(async (value) => {
							// console.log("New tag to ignore case: " + value);
							await this.plugin.updateSettings({ tagToIgnoreCase: value });
						})
				);
		} else {
			// Text setting for tag to match case
			new Setting(containerEl)
				.setName("Tag to match case")
				.setDesc("By adding this tag to a file, the linker will match the case for the file.")
				.addText((text) =>
					text
						.setValue(this.plugin.settings.tagToMatchCase)
						.onChange(async (value) => {
							// console.log("New tag to match case: " + value);
							await this.plugin.updateSettings({ tagToMatchCase: value });
						})
				);
		}


		// If headers should be matched or not
		new Setting(containerEl)
			.setName("Include headers")
			.setDesc("If activated, headers (so your lines beginning with at least one `#`) are included for virtual links.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeHeaders)
					.onChange(async (value) => {
						// console.log("Include headers: " + value);
						await this.plugin.updateSettings({ includeHeaders: value });
					})
			);

		// Toggle setting to match only whole words or any part of the word
		new Setting(containerEl)
			.setName("Match only whole words")
			.setDesc("If activated, only whole words are matched. Otherwise, every part of a word is found.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.matchOnlyWholeWords)
					.onChange(async (value) => {
						// console.log("Match only whole words: " + value);
						await this.plugin.updateSettings({ matchOnlyWholeWords: value });
						this.display();
					})
			);
		// Toggle setting to suppress suffix for sub words
		if (!this.plugin.settings.matchOnlyWholeWords) {
			new Setting(containerEl)
				.setName("Suppress suffix for sub words")
				.setDesc("If activated, the suffix is not added to links for subwords, but only for complete matches.")
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.suppressSuffixForSubWords)
						.onChange(async (value) => {
							// console.log("Suppress suffix for sub words: " + value);
							await this.plugin.updateSettings({ suppressSuffixForSubWords: value });
						})
				);
		}


		new Setting(containerEl).setName("Matched files").setHeading();

		new Setting(containerEl)
			.setName("Include all files")
			.setDesc("Include all files for the virtual linker.")
			.addToggle((toggle) =>
				toggle
					// .setValue(true)
					.setValue(this.plugin.settings.includeAllFiles)
					.onChange(async (value) => {
						// console.log("Include all files: " + value);
						await this.plugin.updateSettings({ includeAllFiles: value });
						this.display();
					})
			);

		if (!this.plugin.settings.includeAllFiles) {
			new Setting(containerEl)
				.setName("Glossary linker directories")
				.setDesc("Directories to include for the virtual linker (separated by new lines).")
				.addTextArea((text) => {
					let setValue = "";
					try {
						setValue = this.plugin.settings.linkerDirectories.join("\n");
					} catch (e) {
						console.warn(e);
					}

					text.setPlaceholder("List of directory names (separated by new line)")
						.setValue(setValue)
						.onChange(async (value) => {
							this.plugin.settings.linkerDirectories = value.split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
							// console.log("New folder name: " + value, this.plugin.settings.linkerDirectories);
							await this.plugin.updateSettings();
						});

					// Set default size
					text.inputEl.addClass('linker-settings-text-box')
				});
		}

		if (!this.plugin.settings.includeAllFiles) {
			// Text setting for tag to include file
			new Setting(containerEl)
				.setName("Tag to include file")
				.setDesc("Tag to explicitly include the file for the linker.")
				.addText((text) =>
					text
						.setValue(this.plugin.settings.tagToIncludeFile)
						.onChange(async (value) => {
							// console.log("New tag to include file: " + value);
							await this.plugin.updateSettings({ tagToIncludeFile: value });
						})
				);
		}


		// Text setting for tag to ignore file
		new Setting(containerEl)
			.setName("Tag to ignore file")
			.setDesc("Tag to ignore the file for the linker.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.tagToExcludeFile)
					.onChange(async (value) => {
						// console.log("New tag to ignore file: " + value);
						await this.plugin.updateSettings({ tagToExcludeFile: value });
					})
			);



		new Setting(containerEl).setName("Link style").setHeading();

		// Toggle setting to apply default link styling
		new Setting(containerEl)
			.setName("Apply default link styling")
			.setDesc("If toggled, the default link styling will be applied to virtual links. Furthermore, you can style the links yourself with a CSS-snippet at `VaultFolder/.obsidian/snippets/virtualLinks.css` affecting the class `virtual-link`.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.applyDefaultLinkStyling)
					.onChange(async (value) => {
						// console.log("Apply default link styling: " + value);
						await this.plugin.updateSettings({ applyDefaultLinkStyling: value });
					})
			);



	}
}


