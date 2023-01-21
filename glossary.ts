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

		// console.log("Settings: ", this.settings);
		// console.log("Files: ", this.app.vault.getMarkdownFiles());
		this.glossaryFiles = this.getGlossaryFiles();
		// console.log("Glossary Files: ", this.glossaryFiles);
		console.log(containerEl);

		// TODO: Fix this?
		// If not called, sometimes (especially for lists) elements are added to the context after they already have been loaded
		// within the parent element. This causes the already added links to be removed...?
		this.load();
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

	getClosestLinkPath(glossaryName: string): TFile | null {
		const destName = this.ctx.sourcePath.replace(/(.*).md/, "$1");
		let currentDestName = destName;

		let currentPath = app.metadataCache.getFirstLinkpathDest(
			getLinkpath(glossaryName),
			currentDestName
		);

		if (currentPath == null) return null;

		while (currentDestName.includes("/")) {
			currentDestName = currentDestName.replace(/\/[^\/]*?$/, "");

			const newPath = app.metadataCache.getFirstLinkpathDest(
				getLinkpath(glossaryName),
				currentDestName
			);

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

		for (const tag of tags) {
			const nodeList = this.containerEl.getElementsByTagName(tag);
			const children = this.containerEl.children;
			// if (nodeList.length === 0) continue;
			if (nodeList.length != 0) console.log(tag, nodeList.length);
			for (let index = 0; index <= nodeList.length; index++) {
				const item =
					index == nodeList.length
						? this.containerEl
						: nodeList.item(index);
				// let inner = item.textContent || "";

				// if (index == nodeList.length) {
				// 	var x = 0;
				// 	console.log(["Children of container:", item.childNodes.length]);
				// }

				// item.childNodes.forEach((childNode) => {

				for (const glossaryFile of this.glossaryFiles) {
					// continue;
					const glossaryEntryName = glossaryFile.name;
					const entryPattern = new RegExp(
						`\\b${glossaryEntryName}\\b`
					);

					for (
						let childNodeIndex = 0;
						childNodeIndex < item.childNodes.length;
						childNodeIndex++
					) {
						const childNode = item.childNodes[childNodeIndex];

						if (childNode.nodeType === Node.TEXT_NODE) {
							let text = childNode.textContent || "";

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

								const linkpath = this.getClosestLinkPath(glossaryEntryName);

								// create link
								let el = this.containerEl.createEl("a");
								// let el = document.createElement("a");
								el.text = `${glossaryEntryName}`;
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
								// console.log("Children after replacement:", [
								// 	parent,
								// 	parent?.children,
								// ]);
								// break;
							}
						}
					}
				}
			}

			// this.containerEl.innerHTML = this.containerEl.replaceWith(refEl);
			this.containerEl.replaceWith(this.containerEl);
		}
	}
}
