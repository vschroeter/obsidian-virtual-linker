import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
    Decoration,
    DecorationSet,
    EditorView,
    PluginSpec,
    PluginValue,
    ViewPlugin,
    ViewUpdate,
    WidgetType,
} from "@codemirror/view";
import { App, parseFrontMatterAliases, TFile, Vault } from "obsidian";

import IntervalTree from '@flatten-js/interval-tree'

export class EmojiWidget extends WidgetType {
    toDOM(view: EditorView): HTMLElement {
        const div = document.createElement("span");

        div.innerText = "👉";

        return div;
    }
}

export class LiveLinkWidget extends WidgetType {

    constructor(public text: string, public linkFile: TFile, public app: App) {
        super();
        // console.log(text, linkFile, app)
    }

    createInternalLinkSpan() {
        // if (!this.app) {
        //     return null;
        // }
        const note = this.linkFile;
        // const linkText = note.basename;
        const linkText = this.text;
        // console.log(note, linkText, this.app)
        let linkHref = "";
        try {
            linkHref = this.app?.metadataCache?.fileToLinktext(note, note.path, true);
        } catch (e) {
            console.error(e)
        }

        const span = document.createElement('span');
        const link = document.createElement('a');

        link.href = linkHref;
        link.textContent = linkText + "🔗";
        link.classList.add('internal-link');

        span.appendChild(link);
        return span;
    }

    toDOM(view: EditorView): HTMLElement {
        // const div = document.createElement("span");

        // // div.innerText = `${this.text}🔗`
        // div.innerText = `${this.text}🔗`

        const div = this.createInternalLinkSpan();

        return div;
    }
}

const decoration = Decoration.replace({
    widget: new EmojiWidget()
});


class CachedFile {
    constructor(public mtime: number, public file: TFile, public aliases: string[], public tags: string[]) { }
}


class LinkerCache {
    activeFilePath?: string;
    files: Map<string, CachedFile> = new Map();
    linkEntries: Map<string, CachedFile[]> = new Map();
    app: App;
    vault: Vault;

    constructor(app: App) {
        this.app = app;
        const { vault } = app;
        this.vault = vault;

        this.updateCache(true);

        // const pattern = /\b(ERB)\b/g;
        const pattern = new RegExp(`\\b(${"ERB"})\\b`)

        const text = "ansteuerbar";
        console.log(text.match(pattern));
    }

    updateCache(force = false) {
        if (!this.app?.workspace?.getActiveFile()) {
            return;
        }

        // We only need to update cache if the active file has changed
        const activeFile = this.app.workspace.getActiveFile()?.path;
        if (activeFile === this.activeFilePath && !force) {
            return;
        }

        this.linkEntries.clear();

        this.activeFilePath = activeFile;

        for (const file of this.vault.getMarkdownFiles()) {
            const cachedFile = this.files.get(file.path);
            if (cachedFile && cachedFile.mtime === file.stat.mtime) {
                continue;
            }

            const metadata = this.app.metadataCache.getFileCache(file);
            const aliases = parseFrontMatterAliases(metadata?.frontmatter);
            const tags = (metadata?.tags || []).map(tag => tag.tag);

            const cacheFile = new CachedFile(file.stat.mtime, file, aliases ? aliases : [], tags ? tags : []);

            this.files.set(file.path, cacheFile);
        }

        // Update the link entries
        for (const file of this.files.values()) {
            this._addEntry(file.file.basename, file);
            for (const alias of file.aliases) {
                this._addEntry(alias, file);
            }
            for (const tag of file.tags) {
                this._addEntry(tag, file);
            }
        }
    }

    _addEntry(name: string, file: CachedFile) {
        let entries = this.linkEntries.get(name);
        if (!entries) {
            entries = [];
            this.linkEntries.set(name, entries);
        }
        entries.push(file);
    }
}


class AutoLinkerPlugin implements PluginValue {
    decorations: DecorationSet;
    app: App;
    vault: Vault;
    linkerCache: LinkerCache;

    constructor(view: EditorView, app: App) {
        this.app = app;

        const { vault } = this.app;
        this.vault = vault;

        this.linkerCache = new LinkerCache(app);

        this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
            this.linkerCache.updateCache();
        }
        this.decorations = this.buildDecorations(update.view);
        // console.log("Update")
    }

    destroy() { }

    buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        for (let { from, to } of view.visibleRanges) {

            const text = view.state.doc.sliceString(from, to);
            // console.log(text)


            // For every glossary file and its aliases we now search the text for occurrences

            const additions: { from: number, to: number, widget: WidgetType }[] = [];

            const linkEntries = this.linkerCache.linkEntries;
            for (const [name, files] of linkEntries) {
                const entryPattern = new RegExp(`\\b(${name})\\b`, "i");

                for (const file of files) {
                    let match;
                    
                    // console.log(entryPattern.exec(text))
                    const matches = entryPattern.exec(text);
                    if (matches) {
                        // console.log(matches)

                        const mFrom = matches.index + from;
                        const mTo = mFrom + matches[0].length;

                        additions.push({
                            from: mFrom,
                            to: mTo,
                            widget: new LiveLinkWidget(name, file.file, this.app)
                        });
                    }

                    // while ((match = entryPattern.exec(text)) !== null) {
                    //     const [start, end] = [match.index, match.index + name.length];
                    //     additions.push({
                    //         from: start,
                    //         to: end,
                    //         widget: new LiveLinkWidget(name, file.file, this.app)
                    //     });
                    // }
                    
                    // for (let i = from; i < to; i++) {
                    //     const slice = view.state.doc.sliceString(i, i + name.length);
                    //     if (slice.match(entryPattern)) {
                            
                    //         const match = slice.match(entryPattern);
                    //         console.log(match, entryPattern, slice)

                    //         // builder.add(
                    //         //     i,
                    //         //     i + name.length,
                    //         //     Decoration.replace({
                    //         //         widget: new LiveLinkWidget(name, file.file)
                    //         //     })
                    //         // );
                    //         additions.push({
                    //             from: i,
                    //             to: i + name.length,
                    //             widget: new LiveLinkWidget(name, file.file, this.app)
                    //         });
                    //     }
                    // }
                }
            }

            // Sort additions by from position
            additions.sort((a, b) => a.from - b.from);

            const excludedIntervalTree = new IntervalTree();
            const excludedTypes = [
                "codeblock",
                "code-block",
                "internal-link",
            ]

            syntaxTree(view.state).iterate({
                from,
                to,
                enter(node) {
                    const text = view.state.doc.sliceString(node.from, node.to);
                    // console.log(node, node.type.name, node.from, node.to, text)

                    const type = node.type.name;

                    for (const excludedType of excludedTypes) {
                        if (type.contains(excludedType)) {
                            excludedIntervalTree.insert([node.from, node.to]);
                        }
                    }
                },
            });

            const cursorPos = view.state.selection.main.from;

            additions.forEach(addition => {
                const [from, to] = [addition.from, addition.to];
                const overlaps = excludedIntervalTree.search([from, to]);
                const cursorNearby = (cursorPos >= from - 0 && cursorPos <= to + 0);

                if (overlaps.length === 0 && !cursorNearby) {
                    builder.add(from, to, Decoration.replace({
                        widget: addition.widget
                    }));
                }
            });
        }

        return builder.finish();
    }
}

// const pluginSpec: PluginSpec<EmojiListPlugin> = {
//     decorations: (value: EmojiListPlugin) => value.decorations,
// };

// export const emojiListPlugin = ViewPlugin.fromClass(
//     EmojiListPlugin,
//     pluginSpec
// );

const pluginSpec: PluginSpec<AutoLinkerPlugin> = {
    decorations: (value: AutoLinkerPlugin) => value.decorations,
};

export const liveLinkerPlugin = (app: App) => {
    return ViewPlugin.define((editorView: EditorView) => {
        return (new AutoLinkerPlugin(editorView, app));
    }, pluginSpec)
}



// import { App, getLinkpath, MarkdownPostProcessorContext, MarkdownRenderChild, TFile,
// 	parseFrontMatterAliases } from "obsidian";

// import { GlossaryPluginSettings } from "./main";

// class GlossaryFile {
// 	name: string;
// 	file: TFile;
// 	aliases: string[];

// 	constructor(file: TFile, aliases: string[] = []) {
// 		this.file = file;
// 		this.name = file.basename;
// 		this.aliases = aliases;
// 	}
// }

// export class GlossaryLinker extends MarkdownRenderChild {
// 	text: string;
// 	ctx: MarkdownPostProcessorContext;
// 	app: App;
// 	settings: GlossaryPluginSettings;

// 	glossaryFiles: GlossaryFile[] = [];

// 	constructor(app: App, settings: GlossaryPluginSettings, context: MarkdownPostProcessorContext, containerEl: HTMLElement) {
// 		super(containerEl);
// 		this.settings = settings;
// 		this.app = app;
// 		this.ctx = context;

// 		this.glossaryFiles = this.getGlossaryFiles();

// 		// TODO: Fix this?
// 		// If not called, sometimes (especially for lists) elements are added to the context after they already have been loaded
// 		// within the parent element. This causes the already added links to be removed...?
// 		this.load();
// 	}

// 	getGlossaryFiles(): GlossaryFile[] {
// 		const pattern = new RegExp(`(^|\/)${this.settings.glossaryFolderName}\/`);
// 		const files = this.app.app.getMarkdownFiles().filter((file) => {
// 			return pattern.test(file.path) && this.ctx.sourcePath != file.path;
// 		});

// 		let gFiles = files.map((file) => {
// 			let aliases = parseFrontMatterAliases(app.metadataCache.getFileCache(file)?.frontmatter)
// 			return new GlossaryFile(file, aliases ? aliases : []);
// 		});

// 		// Sort the files by their name length
// 		return gFiles.sort((a, b) => b.name.length - a.name.length);
// 	}

// 	getClosestLinkPath(glossaryName: string): TFile | null {
// 		const destName = this.ctx.sourcePath.replace(/(.*).md/, "$1");
// 		let currentDestName = destName;

// 		let currentPath = app.metadataCache.getFirstLinkpathDest(getLinkpath(glossaryName), currentDestName);

// 		if (currentPath == null) return null;

// 		while (currentDestName.includes("/")) {
// 			currentDestName = currentDestName.replace(/\/[^\/]*?$/, "");

// 			const newPath = app.metadataCache.getFirstLinkpathDest(getLinkpath(glossaryName), currentDestName);

// 			if ((newPath?.path?.length || 0) > currentPath?.path?.length) {
// 				currentPath = newPath;
// 				console.log("Break at New path: ", currentPath);
// 				break;
// 			}
// 		}

// 		return currentPath;
// 	}

// 	onload() {
// 		// return;
// 		const tags = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "span", "em", "strong"]; //"div"

// 		for (const tag of tags) {
// 			const nodeList = this.containerEl.getElementsByTagName(tag);
// 			const children = this.containerEl.children;
// 			// if (nodeList.length === 0) continue;
// 			// if (nodeList.length != 0) console.log(tag, nodeList.length);
// 			for (let index = 0; index <= nodeList.length; index++) {
// 				const item = index == nodeList.length ? this.containerEl : nodeList.item(index)!;

// 				for (const glossaryFile of this.glossaryFiles) {
// 					// continue;
// 					const glossaryEntryName = glossaryFile.name;

// 					let possibleNames = [glossaryEntryName];
// 					for (let alias of glossaryFile.aliases) {
// 						possibleNames.push(alias.trim());
// 					}

// 					let glossaryEntryNames = possibleNames.join('|');
// 					const entryPattern = new RegExp(`\\b(${glossaryEntryNames})\\b`, "i");

// 					for (let childNodeIndex = 0; childNodeIndex < item.childNodes.length; childNodeIndex++) {
// 						const childNode = item.childNodes[childNodeIndex];

// 						if (childNode.nodeType === Node.TEXT_NODE) {
// 							let text = childNode.textContent || "";

// 							const match = text.match(entryPattern);
// 							// while text includes glossary entry name
// 							if (match) {
// 								// Get position of glossary entry name
// 								const pos = match.index!;

// 								// get linkpath
// 								const destName = this.ctx.sourcePath.replace(/(.*).md/, "$1");
// 								// const destName = this.ctx.sourcePath;

// 								const linkpath = this.getClosestLinkPath(glossaryEntryName);

// 								const replacementText = match[0];

// 								// create link
// 								let el = this.containerEl.createEl("a");
// 								// let el = document.createElement("a");
// 								el.text = `${replacementText}`;
// 								el.href = `${linkpath?.path}`;
// 								// el.setAttribute("data-href", glossaryEntryName);
// 								el.setAttribute("data-href", `${linkpath?.path}`);
// 								el.classList.add("internal-link");
// 								el.classList.add("glossary-entry");
// 								el.target = "_blank";
// 								el.rel = "noopener";

// 								// let icon = document.createElement("sup");
// 								// icon.textContent = "🔎";
// 								// icon.classList.add("glossary-icon");

// 								const parent = childNode.parentElement;
// 								parent?.insertBefore(document.createTextNode(text.slice(0, pos)), childNode);
// 								parent?.insertBefore(el, childNode);
// 								// parent?.insertBefore(icon, childNode);
// 								parent?.insertBefore(document.createTextNode(text.slice(pos + replacementText.length)), childNode);
// 								parent?.removeChild(childNode);
// 								childNodeIndex += 1;
// 							}
// 						}
// 					}
// 				}
// 			}

// 			// this.containerEl.replaceWith(this.containerEl);
// 		}
// 	}
// }



