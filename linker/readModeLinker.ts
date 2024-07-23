import {
	App, getLinkpath, MarkdownPostProcessorContext, MarkdownRenderChild, TFile
} from "obsidian";

import { LinkerPluginSettings } from "../main";
import { LinkerCache, PrefixTree } from "./linkerCache";

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
	settings: LinkerPluginSettings;
	linkerCache: LinkerCache;


	constructor(app: App, settings: LinkerPluginSettings, context: MarkdownPostProcessorContext, containerEl: HTMLElement) {
		super(containerEl);
		this.settings = settings;
		this.app = app;
		this.ctx = context;

        this.linkerCache = LinkerCache.getInstance(app, settings);

		// TODO: Fix this?
		// If not called, sometimes (especially for lists) elements are added to the context after they already have been loaded
		// within the parent element. This causes the already added links to be removed...?
		this.load();
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
				// console.log("Break at New path: ", currentPath);
				break;
			}
		}

		return currentPath;
	}

	onload() {
		
        if (!this.settings.linkerActivated) {
            return;
		}
		
		// return;
		const tags = ["p", "li", "td", "th", "span", "em", "strong"]; //"div"
		if (this.settings.includeHeaders) {
			tags.push("h1", "h2", "h3", "h4", "h5", "h6");
		}
		
		// TODO: Onload is called on the divs separately, so this sets are not stored between divs
		// Since divs can be rendered in arbitrary order, storing information about already linked files is not easy
		// Maybe there is a good and performant solution to this problem
		const linkedFiles = new Set<TFile>();
		const explicitlyLinkedFiles = new Set<TFile>();

		for (const tag of tags) {
			// console.log("Tag: ", tag);
			const nodeList = this.containerEl.getElementsByTagName(tag);
			const children = this.containerEl.children;
			// if (nodeList.length === 0) continue;
			// if (nodeList.length != 0) console.log(tag, nodeList.length);
			for (let index = 0; index <= nodeList.length; index++) {
				const item = index == nodeList.length ? this.containerEl : nodeList.item(index)!;

				for (let childNodeIndex = 0; childNodeIndex < item.childNodes.length; childNodeIndex++) {
					const childNode = item.childNodes[childNodeIndex];

					if (childNode.nodeType === Node.TEXT_NODE) {
						let text = childNode.textContent || "";
						if (text.length === 0) continue;

						this.linkerCache.reset();

						const additions: { id: number, from: number, to: number, text: string, file: TFile, isSubWord: boolean }[] = [];

						let id = 0;
						// Iterate over every char in the text
						for (let i = 0; i <= text.length; i) {
							// Do this to get unicode characters as whole chars and not only half of them
							const codePoint = text.codePointAt(i)!;
							const char = i < text.length ? String.fromCodePoint(codePoint) : "\n";

							// If we are at a word boundary, get the current fitting files
							const isWordBoundary = PrefixTree.checkWordBoundary(char);
							if (!this.settings.matchOnlyWholeWords || isWordBoundary) {
								const currentNodes = this.linkerCache.cache.getCurrentMatchNodes(i);
								if (currentNodes.length > 0) {

									// TODO: Handle multiple matches
									const node = currentNodes[0];
									const nFrom = node.start;
									const nTo = node.end;
									const name = text.slice(nFrom, nTo);

									// TODO: Handle multiple files
									const file = node.files.values().next().value;

									additions.push({
										id: id++,
										from: nFrom,
										to: nTo,
										text: name,
										file: file,
										isSubWord: !isWordBoundary
									});
								}
							}

							// Push the char to get the next nodes in the prefix tree
							this.linkerCache.cache.pushChar(char);
							i += char.length;
						}

						// Sort additions by from position
						additions.sort((a, b) => {
							if (a.from === b.from) {
								return b.to - a.to;
							}
							return a.from - b.from
						});

						const filteredAdditions = [];
						const additionsToDelete: Map<number, boolean> = new Map();

						// Delete additions that links to already linked files
						if (this.settings.excludeLinksToRealLinkedFiles) {
							for (const addition of additions) {
								if (explicitlyLinkedFiles.has(addition.file)) {
									additionsToDelete.set(addition.id, true);
								}
							}
						}

						// Delete all additions to already virtually linked files
						if (this.settings.onlyLinkOnce) {
							for (const addition of additions) {
								if (linkedFiles.has(addition.file)) {
									additionsToDelete.set(addition.id, true);
								}
							}
						}


						// Delete additions that overlap
						// Additions are sorted by from position and after that by length, we want to keep longer additions
						for (let i = 0; i < additions.length; i++) {
							const addition = additions[i];
							if (additionsToDelete.has(addition.id)) {
								continue;
							}

							// Set all overlapping additions to be deleted
							for (let j = i + 1; j < additions.length; j++) {
								const otherAddition = additions[j];
								if (otherAddition.from >= addition.to) {
									break;
								}
								additionsToDelete.set(otherAddition.id, true);
							}

							// Set all additions that link to the same file to be deleted
							if (this.settings.onlyLinkOnce) {
								for (let j = i + 1; j < additions.length; j++) {
									const otherAddition = additions[j];
									if (additionsToDelete.has(otherAddition.id)) {
										continue;
									}

									if (otherAddition.file.path === addition.file.path) {
										additionsToDelete.set(otherAddition.id, true);
									}
								}
							}
						}

						for (const addition of additions) {
							if (!additionsToDelete.has(addition.id)) {
								filteredAdditions.push(addition);
							}
						}

						const parent = childNode.parentElement;
						let lastTo = 0;
						// console.log("Parent: ", parent);

						for (let addition of filteredAdditions) {
							linkedFiles.add(addition.file);

							// get linkpath
							const destName = this.ctx.sourcePath.replace(/(.*).md/, "$1");
							// const destName = this.ctx.sourcePath;

							// const linkpath = this.getClosestLinkPath(glossaryEntryName);
							const linkpath = addition.file.path;

							const replacementText = addition.text;
							// console.log("Replacement text: ", replacementText);

							// create link
							let span = document.createElement("span");
							span.classList.add("glossary-entry", "virtual-link");
							if (this.settings.applyDefaultLinkStyling) {
								span.classList.add("virtual-link-default");
							}

							let link = this.containerEl.createEl("a");
							// let el = document.createElement("a");
							link.text = `${replacementText}`; // + this.settings.glossarySuffix;
							link.href = `${linkpath}`;
							// el.setAttribute("data-href", glossaryEntryName);
							link.setAttribute("data-href", `${linkpath}`);
							link.classList.add("internal-link");
							// link.classList.add("glossary-entry");
							link.classList.add("virtual-link-a");

							link.target = "_blank";
							link.rel = "noopener";

							span.appendChild(link);

							if ((this.settings.glossarySuffix?.length ?? 0) > 0) {
								if ((this.settings.glossarySuffix?.length ?? 0) > 0) {
									if (!addition.isSubWord || !this.settings.suppressSuffixForSubWords) {
										let icon = document.createElement("sup");
										icon.textContent = this.settings.glossarySuffix;
										icon.classList.add("linker-suffix-icon");

										span.appendChild(icon);
									}
								}
							}

							if (addition.from > 0) {
								parent?.insertBefore(document.createTextNode(text.slice(lastTo, addition.from)), childNode);
							}


							parent?.insertBefore(span, childNode);

							lastTo = addition.to;
						}
						const textLength = text.length;
						if (lastTo < textLength) {
							parent?.insertBefore(document.createTextNode(text.slice(lastTo)), childNode);
						}
						parent?.removeChild(childNode);
						childNodeIndex += 1;
					}
				}
			}
		}
	}
}



