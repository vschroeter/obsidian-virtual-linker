import {
	App,
	MarkdownView,
	Menu,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFolder,
} from "obsidian";

import { GlossaryLinker } from "./linker/readModeLinker";
import { liveLinkerPlugin } from "./linker/liveLinker";
import { ExternalUpdateManager } from "linker/linkerCache";
import { LinkerMetaInfoFetcher } from "linker/linkerInfo";

export interface LinkerPluginSettings {
	linkerActivated: boolean;
	suppressSuffixForSubWords: boolean;
	matchOnlyWholeWords: boolean;
	includeAllFiles: boolean;
	linkerDirectories: string[];
	excludedDirectories: string[];
	glossarySuffix: string;
	useMarkdownLinks: boolean;
	applyDefaultLinkStyling: boolean;
	includeHeaders: boolean,
	matchCaseSensitive: boolean;
	tagToIgnoreCase: string;
	tagToMatchCase: string;
	tagToExcludeFile: string;
	tagToIncludeFile: string;
	excludeLinksToOwnNote: boolean;
	fixIMEProblem: boolean;
	excludeLinksInCurrentLine: boolean;
	onlyLinkOnce: boolean;
	excludeLinksToRealLinkedFiles: boolean;
}

const DEFAULT_SETTINGS: LinkerPluginSettings = {
	linkerActivated: true,
	matchOnlyWholeWords: false,
	suppressSuffixForSubWords: false,
	includeAllFiles: true,
	linkerDirectories: ["Glossary"],
	excludedDirectories: [],
	glossarySuffix: "🔗",
	useMarkdownLinks: false,
	applyDefaultLinkStyling: true,
	includeHeaders: true,
	matchCaseSensitive: false,
	tagToIgnoreCase: "linker-ignore-case",
	tagToMatchCase: "linker-match-case",
	tagToExcludeFile: "linker-exclude",
	tagToIncludeFile: "linker-include",
	excludeLinksToOwnNote: true,
	fixIMEProblem: false,
	excludeLinksInCurrentLine: false,
	onlyLinkOnce: true,
	excludeLinksToRealLinkedFiles: true,
};

export default class LinkerPlugin extends Plugin {
	settings: LinkerPluginSettings;
	updateManager = new ExternalUpdateManager();

	async onload() {
		await this.loadSettings();

		// Register the glossary linker for the read mode
		this.registerMarkdownPostProcessor((element, context) => {
			context.addChild(new GlossaryLinker(this.app, this.settings, context, element));
		});

		// Register the live linker for the live edit mode
		this.registerEditorExtension(liveLinkerPlugin(this.app, this.settings, this.updateManager));

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new LinkerSettingTab(this.app, this));

		// Context menu item to convert virtual links to real links
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source) => this.addContextMenuItem(menu, file, source)));

		this.addCommand({
			id: "activate-virtual-linker",
			name: "Activate Virtual Linker",
			checkCallback: (checking) => {
				if (!this.settings.linkerActivated) {
					if (!checking) {
						this.updateSettings({ linkerActivated: true });
						this.updateManager.update();
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: "deactivate-virtual-linker",
			name: "Deactivate Virtual Linker",
			checkCallback: (checking) => {
				if (this.settings.linkerActivated) {
					if (!checking) {
						this.updateSettings({ linkerActivated: false });
						this.updateManager.update();
					}
					return true;
				}
				return false;
			}
		});
	}

	addContextMenuItem(menu: Menu, file: TAbstractFile, source: string) {
		// addContextMenuItem(a: any, b: any, c: any) {
		// Capture the MouseEvent when the context menu is triggered   // Define a named function to capture the MouseEvent

		if (!file) {
			return;
		}

		// console.log('Context menu', menu, file, source);

		const that = this;
		const app: App = this.app;
		const updateManager = this.updateManager;
		const settings = this.settings;

		const fetcher = new LinkerMetaInfoFetcher(app, settings);
		// Check, if the file has the linker-included tag

		const isDirectory = app.vault.getAbstractFileByPath(file.path) instanceof TFolder;

		if (!isDirectory) {
			const metaInfo = fetcher.getMetaInfo(file);

			function contextMenuHandler(event: MouseEvent) {
				// Access the element that triggered the context menu
				const targetElement = event.target;

				if (!targetElement || !(targetElement instanceof HTMLElement)) {
					console.error('No target element');
					return;
				}

				// Check, if we are clicking on a virtual link inside a note or a note in the file explorer
				const isVirtualLink = targetElement.classList.contains('virtual-link-a');


				// Check, if the element has the "virtual-link" class
				if (isVirtualLink) {
					menu.addItem((item) => {

						// Item to convert a virtual link to a real link
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

			if (!metaInfo.excludeFile && (metaInfo.includeAllFiles || metaInfo.includeFile || metaInfo.isInIncludedDir)) {
				// Item to exclude a virtual link from the linker
				// This action adds the settings.tagToExcludeFile to the file
				menu.addItem((item) => {
					item.setTitle("[Virtual Linker] Exclude this file")
						.setIcon("trash")
						.onClick(async () => {
							// Get the shown text
							const target = file;

							// Get the file
							const targetFile = app.vault.getFileByPath(target.path);

							if (!targetFile) {
								console.error('No target file');
								return;
							}

							// Add the tag to the file
							const fileCache = app.metadataCache.getFileCache(targetFile);
							const frontmatter = fileCache?.frontmatter || {};

							const tag = settings.tagToExcludeFile;
							let tags = frontmatter['tags'];

							if (typeof tags === 'string') {
								tags = [tags];
							}

							if (!Array.isArray(tags)) {
								tags = [];
							}

							if (!tags.includes(tag)) {
								await app.fileManager.processFrontMatter(targetFile, (frontMatter) => {

									if (!frontMatter.tags) {
										frontMatter.tags = new Set();
									}
									const currentTags = [...frontMatter.tags];

									frontMatter.tags = new Set([...currentTags, tag]);

									// Remove include tag if it exists
									const includeTag = settings.tagToIncludeFile;
									if (frontMatter.tags.has(includeTag)) {
										frontMatter.tags.delete(includeTag);
									}

								});

								updateManager.update();
							}
						});
				});
			}
			else if (!metaInfo.includeFile && (!metaInfo.includeAllFiles || metaInfo.excludeFile || metaInfo.isInExcludedDir)) {
				//Item to include a virtual link from the linker
				// This action adds the settings.tagToIncludeFile to the file
				menu.addItem((item) => {
					item.setTitle("[Virtual Linker] Include this file")
						.setIcon("plus")
						.onClick(async () => {
							// Get the shown text
							const target = file;

							// Get the file
							const targetFile = app.vault.getFileByPath(target.path);

							if (!targetFile) {
								console.error('No target file');
								return;
							}

							// Add the tag to the file
							const fileCache = app.metadataCache.getFileCache(targetFile);
							const frontmatter = fileCache?.frontmatter || {};

							const tag = settings.tagToIncludeFile;
							let tags = frontmatter['tags'];

							if (typeof tags === 'string') {
								tags = [tags];
							}

							if (!Array.isArray(tags)) {
								tags = [];
							}

							if (!tags.includes(tag)) {
								await app.fileManager.processFrontMatter(targetFile, (frontMatter) => {

									if (!frontMatter.tags) {
										frontMatter.tags = new Set();
									}
									const currentTags = [...frontMatter.tags];

									frontMatter.tags = new Set([...currentTags, tag]);

									// Remove exclude tag if it exists
									const excludeTag = settings.tagToExcludeFile;
									if (frontMatter.tags.has(excludeTag)) {
										frontMatter.tags.delete(excludeTag);
									}

								});

								updateManager.update();
							}
						});
				});
			}

			// Capture the MouseEvent when the context menu is triggered
			document.addEventListener('contextmenu', contextMenuHandler, { once: true });
		}
		else {

			// Check if the directory is in the linker directories
			const path = file.path + '/';
			const isInIncludedDir = fetcher.includeDirPattern.test(path);
			const isInExcludedDir = fetcher.excludeDirPattern.test(path);

			// If the directory is in the linker directories, add the option to exclude it
			if ((fetcher.includeAllFiles && !isInExcludedDir) || (isInIncludedDir)) {
				menu.addItem((item) => {
					item.setTitle("[Virtual Linker] Exclude this directory")
						.setIcon("trash")
						.onClick(async () => {
							// Get the shown text
							const target = file;

							// Get the file
							const targetFolder = app.vault.getAbstractFileByPath(target.path) as TFolder;

							if (!targetFolder) {
								console.error('No target folder');
								return;
							}

							const newExcludedDirs = Array.from(new Set([...settings.excludedDirectories, targetFolder.name]));
							const newIncludedDirs = settings.linkerDirectories.filter((dir) => dir !== targetFolder.name);
							await this.updateSettings({ linkerDirectories: newIncludedDirs, excludedDirectories: newExcludedDirs });

							updateManager.update();
						});
				});
			} else if ((!fetcher.includeAllFiles && !isInIncludedDir) || isInExcludedDir) {
				// If the directory is in the excluded directories, add the option to include it
				menu.addItem((item) => {
					item.setTitle("[Virtual Linker] Include this directory")
						.setIcon("plus")
						.onClick(async () => {
							// Get the shown text
							const target = file;

							// Get the file
							const targetFolder = app.vault.getAbstractFileByPath(target.path) as TFolder;

							if (!targetFolder) {
								console.error('No target folder');
								return;
							}

							const newExcludedDirs = settings.excludedDirectories.filter((dir) => dir !== targetFolder.name);
							const newIncludedDirs = Array.from(new Set([...settings.linkerDirectories, targetFolder.name]));
							await this.updateSettings({ linkerDirectories: newIncludedDirs, excludedDirectories: newExcludedDirs });

							updateManager.update();
						});
				});
			}

		}
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
		this.updateManager.update();
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

		// Toggle to activate or deactivate the linker
		new Setting(containerEl)
			.setName("Activate Virtual Linker")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.linkerActivated)
					.onChange(async (value) => {
						// console.log("Linker activated: " + value);
						await this.plugin.updateSettings({ linkerActivated: value });
					})
			);

		// Toggle to only link once
		new Setting(containerEl)
			.setName("Only link once")
			.setDesc("If activated, there will not be several identical virtual links in the same note (Wikipedia style).")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.onlyLinkOnce)
					.onChange(async (value) => {
						// console.log("Only link once: " + value);
						await this.plugin.updateSettings({ onlyLinkOnce: value });
					})
			);

		// Toggle to exclude links to real linked files
		new Setting(containerEl)
			.setName("Exclude links to real linked files")
			.setDesc("If activated, there will be no links to files that are already linked in the note by real links.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.excludeLinksToRealLinkedFiles)
					.onChange(async (value) => {
						// console.log("Exclude links to real linked files: " + value);
						await this.plugin.updateSettings({ excludeLinksToRealLinkedFiles: value });
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

		// Toggle setting to exclude links in the current line start for fixing IME
		new Setting(containerEl)
			.setName("Fix IME problem")
			.setDesc("If activated, there will be no links in the current line start which is followed immediately by the Input Method Editor (IME). This is the recommended setting if you are using IME (input method editor) for typing, e.g. for chinese characters, because instant linking might interfere with IME.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.fixIMEProblem)
					.onChange(async (value) => {
						// console.log("Exclude links in current line: " + value);
						await this.plugin.updateSettings({ fixIMEProblem: value });
					})
			);

		// Toggle setting to exclude links in the current line
		new Setting(containerEl)
			.setName("Avoid linking in current line")
			.setDesc("If activated, there will be no links in the current line.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.excludeLinksInCurrentLine)
					.onChange(async (value) => {
						// console.log("Exclude links in current line: " + value);
						await this.plugin.updateSettings({ excludeLinksInCurrentLine: value });
					})
			);


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
		} else {
			new Setting(containerEl)
				.setName("Excluded directories")
				.setDesc("Directories to exclude for the virtual linker (separated by new lines).")
				.addTextArea((text) => {
					let setValue = "";
					try {
						setValue = this.plugin.settings.excludedDirectories.join("\n");
					} catch (e) {
						console.warn(e);
					}

					text.setPlaceholder("List of directory names (separated by new line)")
						.setValue(setValue)
						.onChange(async (value) => {
							this.plugin.settings.excludedDirectories = value.split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
							// console.log("New folder name: " + value, this.plugin.settings.excludedDirectories);
							await this.plugin.updateSettings();
						});

					// Set default size
					text.inputEl.addClass('linker-settings-text-box')
				});
		}

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

		// Toggle setting to exclude links to the active file
		new Setting(containerEl)
			.setName("Exclude self-links to the current note")
			.setDesc("If toggled, links to the note itself are excluded from the linker. (This might not work in preview windows.)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.excludeLinksToOwnNote)
					.onChange(async (value) => {
						// console.log("Exclude links to active file: " + value);
						await this.plugin.updateSettings({ excludeLinksToOwnNote: value });
					})
			);


		new Setting(containerEl).setName("Link style").setHeading();

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

		// Toggle setting to apply default link styling
		new Setting(containerEl)
			.setName("Apply default link styling")
			.setDesc("If toggled, the default link styling will be applied to virtual links. Furthermore, you can style the links yourself with a CSS-snippet affecting the class `virtual-link`. (Find the CSS snippet directory at Appearance -> CSS Snippets -> Open snippets folder)")
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


