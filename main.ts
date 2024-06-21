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

import { GlossaryLinker } from "./glossary/readModeLinker";
import { liveLinkerPlugin } from "./glossary/liveLinker";

import { promises as fs } from 'fs';

// Remember to rename these classes and interfaces!

export interface GlossaryLinkerPluginSettings {
	includeAllFiles: boolean;
	linkerDirectories: string[];
	glossarySuffix: string;
	useMarkdownLinks: boolean;
}

const DEFAULT_SETTINGS: GlossaryLinkerPluginSettings = {
	includeAllFiles: true,
	linkerDirectories: ["Glossary"],
	glossarySuffix: "🔗",
	useMarkdownLinks: false,
};

export default class GlossaryLinkerPlugin extends Plugin {
	settings: GlossaryLinkerPluginSettings;

	async onload() {
		await this.loadSettings();

		const { vault } = this.app;

		this.registerMarkdownPostProcessor((element, context) => {
			context.addChild(new GlossaryLinker(this.app, this.settings, context, element));
		});

		this.registerEditorExtension(liveLinkerPlugin(this.app, this.settings));

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new LinkerSettingTab(this.app, this));

		// Context menu item to convert virtual links to real links
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source) => this.addContextMenuItem(menu, file, source)));
	}

	addContextMenuItem(menu: Menu, file: TAbstractFile, source: string) {
		// addContextMenuItem(a: any, b: any, c: any) {
		// Capture the MouseEvent when the context menu is triggered   // Define a named function to capture the MouseEvent

		const app: App = this.app;
		const settings = this.settings;

		function contextMenuHandler(event: MouseEvent) {
			// Access the element that triggered the context menu
			const targetElement = event.target;

			// Check, if the element has the "virtual-link" class
			if (targetElement instanceof HTMLElement && targetElement.classList.contains('virtual-link')) {
				// console.log('Virtual Link clicked:', targetElement);
				menu.addItem((item) => {
					item.setTitle("[Virtual Linker] Convert to real link")
						.setIcon("link")
						.onClick(() => {
							// Your custom action here
							new Notice("Custom menu item clicked!");

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
			} else {
				// console.log('No virtual link clicked:', targetElement);
			}

			// Remove the listener to prevent multiple triggers
			document.removeEventListener('contextmenu', contextMenuHandler);
		}

		// Capture the MouseEvent when the context menu is triggered
		// console.log("ADD event listener")
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
		const vaultPath = (this.app.vault.adapter as any).basePath
		const path = vaultPath + "/" + this.app.vault.configDir + '/app.json';
		const fileContent = await fs.readFile(path, 'utf-8')
		const appSettings = JSON.parse(fileContent);
		this.settings.useMarkdownLinks = appSettings.useMarkdownLinks;
		// console.log("App settings: ", appSettings);
	}


	/** Update plugin settings. */
	async updateSettings(settings: Partial<GlossaryLinkerPluginSettings> = <Partial<GlossaryLinkerPluginSettings>>{}) {
			Object.assign(this.settings, settings);
			await this.saveData(this.settings);
		}
}

class LinkerSettingTab extends PluginSettingTab {
	constructor(app: App, public plugin: GlossaryLinkerPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Settings for virtual linker / glossary plugin." });

		new Setting(containerEl)
			.setName("Include all files")
			.setDesc("Include all files for the glossary linker.")
			.addToggle((toggle) =>
				toggle
					// .setValue(true)
					.setValue(this.plugin.settings.includeAllFiles)
					.onChange(async (value) => {
						console.log("Include all files: " + value);
						// this.plugin.settings.includeAllFiles = value;
						await this.plugin.updateSettings({ includeAllFiles: value });
						this.display();
					})
			);

		if (!this.plugin.settings.includeAllFiles) {
			new Setting(containerEl)
				.setName("Glossary linker directories")
				.setDesc("Directories to include for the glossary linker (separated by new lines).")
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
							console.log("New folder name: " + value, this.plugin.settings.linkerDirectories);
							await this.plugin.updateSettings();
						});

					// Set size
					text.inputEl.style.width = '300px'
					text.inputEl.style.height = '100px'
				});
		}

		new Setting(containerEl)
			.setName("Glossary suffix")
			.setDesc("The suffix to add to auto generated glossary links.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.glossarySuffix)
					.onChange(async (value) => {
						console.log("New glossary suffix: " + value);
						await this.plugin.updateSettings({ glossarySuffix: value });
					})
			);
	}
}


