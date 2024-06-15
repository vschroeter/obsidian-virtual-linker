import { App, getLinkpath, MarkdownPostProcessorContext, MarkdownRenderChild, TFile,
	parseFrontMatterAliases } from "obsidian";

import { GlossaryLinkerPluginSettings } from "../main";

class GlossaryFile {
	name: string;
	file: TFile;
	aliases: string[];

	constructor(file: TFile, aliases: string[] = []) {
		this.file = file;
		this.name = file.basename;
		this.aliases = aliases;
	}
}

export class GlossaryLinker extends MarkdownRenderChild {
	text: string;
	ctx: MarkdownPostProcessorContext;
	app: App;
	settings: GlossaryLinkerPluginSettings;

	glossaryFiles: GlossaryFile[] = [];

	constructor(app: App, settings: GlossaryLinkerPluginSettings, context: MarkdownPostProcessorContext, containerEl: HTMLElement) {
		super(containerEl);
		this.settings = settings;
		this.app = app;
		this.ctx = context;

		this.glossaryFiles = this.getGlossaryFiles();

		// TODO: Fix this?
		// If not called, sometimes (especially for lists) elements are added to the context after they already have been loaded
		// within the parent element. This causes the already added links to be removed...?
		this.load();
	}

	getGlossaryFiles(): GlossaryFile[] {
		const includeAllFiles = this.settings.includeAllFiles || this.settings.linkerDirectories.length === 0;
        const includeDirPattern = new RegExp(`(^|\/)(${this.settings.linkerDirectories.join("|")})\/`);
		const files = this.app.vault.getMarkdownFiles().filter((file) => {
			if (includeAllFiles) return true;
			return includeDirPattern.test(file.path) && this.ctx.sourcePath != file.path
		});

		let gFiles = files.map((file) => {
			let aliases = parseFrontMatterAliases(app.metadataCache.getFileCache(file)?.frontmatter)
			return new GlossaryFile(file, aliases ? aliases : []);
		});

		// Sort the files by their name length
		return gFiles.sort((a, b) => b.name.length - a.name.length);
	}

	getClosestLinkPath(glossaryName: string): TFile | null {
		const destName = this.ctx.sourcePath.replace(/(.*).md/, "$1");
		let currentDestName = destName;

		let currentPath = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(glossaryName), currentDestName);

		if (currentPath == null) return null;

		while (currentDestName.includes("/")) {
			currentDestName = currentDestName.replace(/\/[^\/]*?$/, "");

			const newPath = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(glossaryName), currentDestName);

			if ((newPath?.path?.length || 0) > currentPath?.path?.length) {
				currentPath = newPath;
				console.log("Break at New path: ", currentPath);
				break;
			}
		}

		return currentPath;
	}

	onload() {
		// return;
		const tags = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "span", "em", "strong"]; //"div"

		for (const tag of tags) {
			const nodeList = this.containerEl.getElementsByTagName(tag);
			const children = this.containerEl.children;
			// if (nodeList.length === 0) continue;
			// if (nodeList.length != 0) console.log(tag, nodeList.length);
			for (let index = 0; index <= nodeList.length; index++) {
				const item = index == nodeList.length ? this.containerEl : nodeList.item(index)!;

				for (const glossaryFile of this.glossaryFiles) {
					// continue;
					const glossaryEntryName = glossaryFile.name;

					let possibleNames = [glossaryEntryName];
					for (let alias of glossaryFile.aliases) {
						possibleNames.push(alias.trim());
					}

					let glossaryEntryNames = possibleNames.join('|');
					const entryPattern = new RegExp(`\\b(${glossaryEntryNames})\\b`, "i");

					for (let childNodeIndex = 0; childNodeIndex < item.childNodes.length; childNodeIndex++) {
						const childNode = item.childNodes[childNodeIndex];

						if (childNode.nodeType === Node.TEXT_NODE) {
							let text = childNode.textContent || "";

							const match = text.match(entryPattern);
							// while text includes glossary entry name
							if (match) {
								// Get position of glossary entry name
								const pos = match.index!;

								// get linkpath
								const destName = this.ctx.sourcePath.replace(/(.*).md/, "$1");
								// const destName = this.ctx.sourcePath;

								const linkpath = this.getClosestLinkPath(glossaryEntryName);

								const replacementText = match[0];

								// create link
								let el = this.containerEl.createEl("a");
								// let el = document.createElement("a");
								el.text = `${replacementText}` + this.settings.glossarySuffix;
								el.href = `${linkpath?.path}`;
								// el.setAttribute("data-href", glossaryEntryName);
								el.setAttribute("data-href", `${linkpath?.path}`);
								el.classList.add("internal-link");
								el.classList.add("glossary-entry");
								el.target = "_blank";
								el.rel = "noopener";

								// let icon = document.createElement("sup");
								// icon.textContent = "🔎";
								// icon.classList.add("glossary-icon");

								const parent = childNode.parentElement;
								parent?.insertBefore(document.createTextNode(text.slice(0, pos)), childNode);
								parent?.insertBefore(el, childNode);
								// parent?.insertBefore(icon, childNode);
								parent?.insertBefore(document.createTextNode(text.slice(pos + replacementText.length)), childNode);
								parent?.removeChild(childNode);
								childNodeIndex += 1;
							}
						}
					}
				}
			}

			// this.containerEl.replaceWith(this.containerEl);
		}
	}
}



