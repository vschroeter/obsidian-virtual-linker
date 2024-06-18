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
import { App, getLinkpath, parseFrontMatterAliases, TFile, Vault } from "obsidian";

import IntervalTree from '@flatten-js/interval-tree'
import { GlossaryLinkerPluginSettings } from "main";
import { LinkerCache, PrefixTree } from "./linkerCache";

export class LiveLinkWidget extends WidgetType {

    constructor(public text: string, public linkFile: TFile, public app: App, private settings: GlossaryLinkerPluginSettings) {
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
        let linkHref = "";
        try {
            linkHref = note.path;
        } catch (e) {
            console.error(e)
        }

        const span = document.createElement('span');
        const link = document.createElement('a');

        link.href = linkHref;
        link.textContent = linkText + this.settings.glossarySuffix;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.classList.add('internal-link', 'glossary-entry');

        span.appendChild(link);
        return span;
    }

    toDOM(view: EditorView): HTMLElement {
        const div = this.createInternalLinkSpan();

        return div;
    }
}


// class CachedFile {
//     constructor(public mtime: number, public file: TFile, public aliases: string[], public tags: string[]) { }
// }


// class LinkerCache {
//     activeFilePath?: string;
//     files: Map<string, CachedFile> = new Map();
//     linkEntries: Map<string, CachedFile[]> = new Map();
//     vault: Vault;

//     constructor(public app: App, public settings: GlossaryLinkerPluginSettings) {
//         const { vault } = app;
//         this.vault = vault;
//         this.updateCache(true);
//     }

//     updateCache(force = false) {
//         if (!this.app?.workspace?.getActiveFile()) {
//             return;
//         }

//         // We only need to update cache if the active file has changed
//         const activeFile = this.app.workspace.getActiveFile()?.path;
//         if (activeFile === this.activeFilePath && !force) {
//             return;
//         }
//         // console.log("Updating cache")
//         this.linkEntries.clear();

//         this.activeFilePath = activeFile;

//         const includeAllFiles = this.settings.includeAllFiles || this.settings.linkerDirectories.length === 0;
//         const includeDirPattern = new RegExp(`(^|\/)(${this.settings.linkerDirectories.join("|")})\/`);

//         for (const file of this.vault.getMarkdownFiles()) {

//             // Skip the active file
//             if (file.path === activeFile) {
//                 continue;
//             }

//             // Skip files that are not in the linker directories
//             if (!includeAllFiles && !includeDirPattern.test(file.path)) {
//                 continue;
//             }

//             const cachedFile = this.files.get(file.path);
//             if (cachedFile && cachedFile.mtime === file.stat.mtime) {
//                 continue;
//             }

//             const metadata = this.app.metadataCache.getFileCache(file);
//             const aliases = parseFrontMatterAliases(metadata?.frontmatter);
//             const tags = (metadata?.tags || []).map(tag => tag.tag);

//             const cacheFile = new CachedFile(file.stat.mtime, file, aliases ? aliases : [], tags ? tags : []);

//             this.files.set(file.path, cacheFile);
//         }

//         // Update the link entries
//         for (const file of this.files.values()) {
//             this._addEntry(file.file.basename, file);
//             for (const alias of file.aliases) {
//                 this._addEntry(alias, file);
//             }
//             for (const tag of file.tags) {
//                 this._addEntry(tag, file);
//             }
//         }

//         console.log("Link entries", this.linkEntries)
//     }

//     _addEntry(name: string, file: CachedFile) {
//         let entries = this.linkEntries.get(name);
//         if (!entries) {
//             entries = [];
//             this.linkEntries.set(name, entries);
//         }
//         entries.push(file);
//     }
// }


class AutoLinkerPlugin implements PluginValue {
    decorations: DecorationSet;
    app: App;
    vault: Vault;
    linkerCache: LinkerCache;

    settings: GlossaryLinkerPluginSettings;

    private lastCursorPos: number = 0;
    private lastActiveFile: string = "";

    constructor(view: EditorView, app: App, settings: GlossaryLinkerPluginSettings) {
        this.app = app;
        this.settings = settings;

        const { vault } = this.app;
        this.vault = vault;

        this.linkerCache = new LinkerCache(app, this.settings);

        this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
        const cursorPos = update.view.state.selection.main.from;
        const activeFile = this.app.workspace.getActiveFile()?.path;
        const fileChanged = activeFile != this.lastActiveFile;

        if (this.lastCursorPos != cursorPos || update.docChanged || fileChanged || update.viewportChanged) {
            this.lastCursorPos = cursorPos;
            this.linkerCache.updateCache();
            this.decorations = this.buildDecorations(update.view);
            this.lastActiveFile = activeFile ?? "";
            // console.log("Update", cursorPos)
        }
    }



    destroy() { }

    buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        for (let { from, to } of view.visibleRanges) {

            console.log("Visible range", from, to, this.linkerCache)
            this.linkerCache.reset();
            const text = view.state.doc.sliceString(from, to);
            const textHasUnicode = /[^\x00-\x7F]/.test(text);
            // console.log(text)

            // For every glossary file and its aliases we now search the text for occurrences
            const additions: { id: number, from: number, to: number, widget: WidgetType }[] = [];

            let id = 0;
            // Iterate over every char in the text
            for (let i = 0; i <= text.length; i++) {
                const char = i < text.length ? text[i] : "\n";
                // console.log("Char", char)

                // If we are at a word boundary, get the current fitting files
                if (PrefixTree.checkWordBoundary(char)) {
                    // console.log("Word boundary")
                    const currentNodes = this.linkerCache.cache.getCurrentMatchNodes(i);
                    // console.log("Current nodes", currentNodes, this.linkerCache.cache._currentNodes.length)
                    if (currentNodes.length > 0) {
                        console.log("Current nodes", currentNodes)

                        // TODO: Handle multiple matches
                        const node = currentNodes[0];
                        const nFrom = node.start;
                        const nTo = node.end;
                        const name = text.slice(nFrom, nTo);

                        // TODO: Handle multiple files
                        const file = node.files.values().next().value;

                        additions.push({
                            id: id++,
                            from: from + nFrom,
                            to: from + nTo,
                            widget: new LiveLinkWidget(name, file, this.app, this.settings)
                        });


                        // const names = currentNodes.map(node => node.name);
                        // for (const name of names) {
                        //     const files = this.linkerCache.linkEntries.get(name);
                        //     if (files) {
                        //         for (const file of files) {
                        //             const mFrom = from + i - name.length;
                        //             const mTo = from + i;
                        //             const originalText = view.state.doc.sliceString(mFrom, mTo);

                        //             additions.push({
                        //                 from: mFrom,
                        //                 to: mTo,
                        //                 // widget: new LiveLinkWidget(name, file.file, this.app, this.settings)
                        //                 widget: new LiveLinkWidget(originalText, file.file, this.app, this.settings)
                        //             });
                        //         }
                        //     }
                        // }
                    }
                }

                this.linkerCache.cache.pushChar(char);

            }

            // return;

            // const linkEntries = this.linkerCache.linkEntries;
            // for (const [name, files] of linkEntries) {
            //     let entryPattern: RegExp;
            //     if (textHasUnicode) {
            //         // Pattern to handle unicode characters
            //         entryPattern = new RegExp(`(?<![\\p{L}\\p{N}])(${name})(?![\\p{L}\\p{N}])`, "ugi");
            //     } else {
            //         entryPattern = new RegExp(`\\b(${name})\\b`, "ugi");
            //     }
            //     for (const file of files) {
            //         // Find all matches in the text
            //         const matches = [...text.matchAll(entryPattern)];

            //         matches.forEach(match => {
            //             if (match !== undefined) {
            //                 const mFrom = (match?.index ?? 0) + from;
            //                 const mTo = mFrom + match[0].length;
            //                 const originalText = view.state.doc.sliceString(mFrom, mTo);

            //                 additions.push({
            //                     from: mFrom,
            //                     to: mTo,
            //                     // widget: new LiveLinkWidget(name, file.file, this.app, this.settings)
            //                     widget: new LiveLinkWidget(originalText, file.file, this.app, this.settings)
            //                 });
            //             }
            //         })

            //         // TODO: Handle multiple files
            //         break;
            //     }
            // }

            // Sort additions by from position
            additions.sort((a, b) => {
                if (a.from === b.from) {
                    return b.to - a.to;
                }
                return a.from - b.from
            });

            // Delete additions that overlap
            // Additions are sorted by from position and after that by length, we want to keep longer additions
            const filteredAdditions = [];
            const additionsToDelete: Map<number, boolean> = new Map();
            for (let i = 0; i < additions.length; i++) {
                const addition = additions[i];
                for (let j = i + 1; j < additions.length; j++) {
                    const otherAddition = additions[j];
                    if (otherAddition.from >= addition.to) {
                        break;
                    }

                    additionsToDelete.set(otherAddition.id, true);
                }
            }

            for (const addition of additions) {
                if (!additionsToDelete.has(addition.id)) {
                    filteredAdditions.push(addition);
                }
            }

            // We want to exclude some syntax nodes from being decorated,
            // such as code blocks and manually added links
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

            filteredAdditions.forEach(addition => {
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


const pluginSpec: PluginSpec<AutoLinkerPlugin> = {
    decorations: (value: AutoLinkerPlugin) => value.decorations,
};

export const liveLinkerPlugin = (app: App, settings: GlossaryLinkerPluginSettings) => {
    return ViewPlugin.define((editorView: EditorView) => {
        return (new AutoLinkerPlugin(editorView, app, settings));
    }, pluginSpec)
}

