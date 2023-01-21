import {
	App,
	getLinkpath,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	TFile,
} from "obsidian";

import { GlossaryPluginSettings } from "./main";

class GlossaryFile {
	name: string;
	file: TFile;

	constructor(file: TFile) {
		this.file = file;
		this.name = file.basename;
	}
}

export class GlossaryLinker extends MarkdownRenderChild {
	static ALL_EMOJIS: Record<string, string> = {
		":+1:": "👍",
		":sunglasses:": "😎",
		":smile:": "😄",
	};

	static ABBS = ["Abb"];

	text: string;
	ctx: MarkdownPostProcessorContext;
	app: App;
	settings: GlossaryPluginSettings;

	glossaryFiles: GlossaryFile[] = [];

	constructor(
		app: App,
		settings: GlossaryPluginSettings,
		context: MarkdownPostProcessorContext,
		containerEl: HTMLElement
	) {
		super(containerEl);
		this.settings = settings;
		this.app = app;
		this.ctx = context;

		console.log("Settings: ", this.settings);
		// console.log("Files: ", this.app.vault.getMarkdownFiles());
		this.glossaryFiles = this.getGlossaryFiles();
		console.log("Glossary Files: ", this.glossaryFiles);
	}

	getGlossaryFiles(): GlossaryFile[] {
		const pattern = new RegExp(
			`(^|\/)${this.settings.glossaryFolderName}\/`
		);
		const files = this.app.vault.getMarkdownFiles().filter((file) => {
			return pattern.test(file.path);
		});

		let gFiles = files.map((file) => new GlossaryFile(file));
		
		// Sort the files by their name length
		return gFiles.sort((a, b) => b.name.length - a.name.length);
	}

	getClosestLinkPath() {
		const destName = this.ctx.sourcePath.replace(/(.*).md/, "$1");
		let currentDestName = destName;

		while (currentDestName.includes("/")) {
			console.log("DestName:", currentDestName);
			console.log(
				"Linkpath:",
				app.metadataCache.getFirstLinkpathDest(
					getLinkpath(abbr),
					currentDestName
				)?.path
			);
			currentDestName = currentDestName.replace(/\/[^\/]*?$/, "");
		}
	}

	onload() {
		// return;
		const tags = [
			"p",
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
			"li",
			"td",
			"th",
			"span",
		]; //"div"

		const nodeLists = tags.map((tag) =>
			this.containerEl.querySelectorAll(tag)
		);

		const tagFilter = /<(\w+\b).*?>.*?<\/\1>/;

		for (const nodeList of nodeLists) {
			for (let index = 0; index < nodeList.length; index++) {
				const item = nodeList.item(index);
				// let inner = item.textContent || "";

				// item.childNodes.forEach((childNode) => {

				for (const glossaryFile of this.glossaryFiles) {
					// continue;
					const glossaryEntryName = glossaryFile.name;
					const entryPattern = new RegExp(`\\b${glossaryEntryName}\\b`);

					for (
						let childNodeIndex = 0;
						childNodeIndex < item.childNodes.length;
						childNodeIndex++
					) {
						const childNode = item.childNodes[childNodeIndex];

						if (childNode.nodeType === Node.TEXT_NODE) {
							let text = childNode.textContent || "";
							// console.log([item.children, item.childNodes, item.textContent]);
							console.log([text, childNode]);

							const match = text.match(entryPattern);
							// while text includes glossary entry name
							// if (text.includes(glossaryEntryName, startpos)) {
							if (match) {
								// Get position of glossary entry name
								const pos = match.index!;

								// get linkpath
								const destName = this.ctx.sourcePath.replace(
									/(.*).md/,
									"$1"
								);
								// const destName = this.ctx.sourcePath;

								const linkpath =
									app.metadataCache.getFirstLinkpathDest(
										getLinkpath(glossaryEntryName),
										destName
									);

								let currentDestName = destName;

								while (currentDestName.includes("/")) {
									console.log("DestName:", currentDestName);
									console.log(
										"Linkpath:",
										app.metadataCache.getFirstLinkpathDest(
											getLinkpath(glossaryEntryName),
											currentDestName
										)?.path
									);
									currentDestName = currentDestName.replace(
										/\/[^\/]*?$/,
										""
									);
								}

								// create link
								let el = document.createElement("a");
								el.text = `${glossaryEntryName}`;
								el.href = `${linkpath?.path}`;
								el.setAttribute("data-href", glossaryEntryName);
								el.classList.add("internal-link");
								el.classList.add("glossary-entry");
								el.target = "_blank";
								el.rel = "noopener";

								// let icon = document.createElement("sup");
								// icon.textContent = "🔎";
								// icon.classList.add("glossary-icon");

								const parent = childNode.parentElement;
								parent?.insertBefore(
									document.createTextNode(text.slice(0, pos)),
									childNode
								);
								parent?.insertBefore(el, childNode);
								// parent?.insertBefore(icon, childNode);
								parent?.insertBefore(
									document.createTextNode(
										text.slice(
											pos + glossaryEntryName.length
										)
									),
									childNode
								);
								parent?.removeChild(childNode);
								childNodeIndex += 1;
								console.log("Children after replacement:", [
									parent,
									parent?.children,
								]);
								// break;
							}
						}
					}
				}
				// });

				continue;
				for (const glossaryFile of this.glossaryFiles) {
					const glossaryEntryName = glossaryFile.name;

					let startpos = 0;

					// while text includes glossary entry name
					while (inner.includes(glossaryEntryName, startpos)) {
						// get next matches of tagFilter
						const match = inner.slice(startpos).match(tagFilter);

						// Get position of glossary entry name
						const pos = inner.indexOf(glossaryEntryName, startpos);
						console.log("Pos:", pos);
						console.log(
							`Search for ${glossaryEntryName} in:`,
							inner.slice(startpos),
							item.textContent
						);
						console.log(
							"Match:",
							match,
							match?.index,
							match?.[0].length
						);

						// if abbreviation is inside a tag, increase startpos and continue
						if (match) {
							const tag = match[0];
							const tagStart = match.index || 0;
							const tagEnd = tagStart + tag.length;
							if (pos > tagStart && pos < tagEnd) {
								console.warn("Entry in Tag:", match);
								startpos += tagEnd;
								continue;
							}
						}

						// get linkpath
						const destName = this.ctx.sourcePath.replace(
							/(.*).md/,
							"$1"
						);
						// const destName = this.ctx.sourcePath;

						const linkpath = app.metadataCache.getFirstLinkpathDest(
							getLinkpath(glossaryEntryName),
							destName
						);

						let currentDestName = destName;

						while (currentDestName.includes("/")) {
							console.log("DestName:", currentDestName);
							console.log(
								"Linkpath:",
								app.metadataCache.getFirstLinkpathDest(
									getLinkpath(glossaryEntryName),
									currentDestName
								)?.path
							);
							currentDestName = currentDestName.replace(
								/\/[^\/]*?$/,
								""
							);
						}

						// create link
						const refEl = item.createEl("a", {}, (el) => {
							el.text = glossaryEntryName;
							el.href = `${linkpath?.path}`;
							el.setAttribute("data-href", glossaryEntryName);
							el.classList.add("internal-link");
							el.target = "_blank";
							el.rel = "noopener";
							return el;
						});

						// replace abbreviation with link
						inner =
							inner.slice(0, pos) +
							refEl.outerHTML +
							inner.slice(pos + glossaryEntryName.length);
						startpos = pos + refEl.outerHTML.length;
					}

					item.innerHTML = inner;
					// item.textContent = inner;
				}

				// const isAbbreviation = Abbreviation.ABBS.includes(this.text);

				// const refEl = this.containerEl.createEl("a", {}, (el) => {
				// 	// @ts-ignore
				// 	const destName = this.ctx.sourcePath.replace(/(.*).md/, "$1");
				// 	const linkpath = app.metadataCache.getFirstLinkpathDest(
				// 		getLinkpath(this.text),
				// 		destName
				// 	);
				// 	// console.log(linkpath);

				// 	el.text = this.text;
				// 	el.href = `${linkpath?.path}`;
				// 	el.setAttribute("data-href", this.text);
				// 	el.classList.add("internal-link");
				// 	el.target = "_blank";
				// 	el.rel = "noopener";
				// 	return el;
				// });
			}

			// this.containerEl.innerHTML = this.containerEl.replaceWith(refEl);
		}
	}
}
