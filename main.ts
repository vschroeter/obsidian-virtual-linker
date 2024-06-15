import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";

import { GlossaryLinker } from "./glossary/readModeLinker";
import { liveLinkerPlugin } from "./glossary/liveLinker";

// Remember to rename these classes and interfaces!

export interface GlossaryLinkerPluginSettings {
	includeAllFiles: boolean;
	linkerDirectories: string[];
}

const DEFAULT_SETTINGS: GlossaryLinkerPluginSettings = {
	includeAllFiles: true,
	linkerDirectories: ["Glossary"],
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
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
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

		containerEl.createEl("h2", { text: "Settings for auto linker / glossary plugin." });

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
	}
}


