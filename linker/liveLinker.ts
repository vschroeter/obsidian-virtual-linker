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
import { App, MarkdownView, TFile, Vault } from "obsidian";

import IntervalTree from '@flatten-js/interval-tree'
import { LinkerPluginSettings } from "main";
import { ExternalUpdateManager, LinkerCache, PrefixTree } from "./linkerCache";

function isDescendant(parent: HTMLElement, child: HTMLElement, maxDepth: number = 10) {
    let node = child.parentNode;
    let depth = 0;
    while (node != null && depth < maxDepth) {
        if (node === parent) {
            return true;
        }
        node = node.parentNode;
        depth++;
    }
    return false;
}

export class LiveLinkWidget extends WidgetType {

    constructor(
        public text: string,
        public linkFile: TFile,
        public from: number,
        public to: number,
        public isSubWord: boolean,
        public app: App,
        private settings: LinkerPluginSettings) {
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
        link.textContent = linkText;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("from", this.from.toString());
        link.setAttribute("to", this.to.toString());
        link.setAttribute("origin-text", this.text);
        link.classList.add('internal-link', 'virtual-link-a');
        span.classList.add('glossary-entry', 'virtual-link');
        if (this.settings.applyDefaultLinkStyling) {
            span.classList.add("virtual-link-default");
        }


        span.appendChild(link);

        if ((this.settings.glossarySuffix?.length ?? 0) > 0) {
            if (!this.isSubWord || !this.settings.suppressSuffixForSubWords) {
                let icon = document.createElement("sup");
                icon.textContent = this.settings.glossarySuffix;
                icon.classList.add("linker-suffix-icon");
                span.appendChild(icon);
            }
        }


        return span;
    }

    toDOM(view: EditorView): HTMLElement {
        const div = this.createInternalLinkSpan();
        return div;
    }
}


class AutoLinkerPlugin implements PluginValue {
    decorations: DecorationSet;
    app: App;
    vault: Vault;
    linkerCache: LinkerCache;

    settings: LinkerPluginSettings;



    private lastCursorPos: number = 0;
    private lastActiveFile: string = "";
    private lastViewUpdate: ViewUpdate | null = null;

    viewUpdateDomToFileMap: Map<HTMLElement, TFile | undefined | null> = new Map();

    constructor(view: EditorView, app: App, settings: LinkerPluginSettings, updateManager: ExternalUpdateManager) {
        this.app = app;
        this.settings = settings;

        const { vault } = this.app;
        this.vault = vault;

        this.linkerCache = LinkerCache.getInstance(app, this.settings);

        this.decorations = this.buildDecorations(view);


        updateManager.registerCallback(() => {
            if (this.lastViewUpdate) {
                this.update(this.lastViewUpdate, true);
            }
        });

    }


    update(update: ViewUpdate, force: boolean = false) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

        // Method to check if the update is on the active view
        let updateIsOnActiveView = false;
        if (this.settings.excludeLinksInCurrentLine || this.settings.excludeLinksToOwnNote) {
            const domFromUpdate = update.view.dom;
            const domFromWorkspace = activeView?.contentEl;
            updateIsOnActiveView = domFromWorkspace ? isDescendant(domFromWorkspace, domFromUpdate, 3) : false;

            // We store this information to be able to map the view updates to a obsidian file
            if (updateIsOnActiveView) {
                this.viewUpdateDomToFileMap.set(domFromUpdate, activeView?.file);
            }
        }

        const cursorPos = update.view.state.selection.main.from;
        const activeFile = this.app.workspace.getActiveFile()?.path;
        const fileChanged = activeFile != this.lastActiveFile;

        if (force || this.lastCursorPos != cursorPos || update.docChanged || fileChanged || update.viewportChanged) {
            this.lastCursorPos = cursorPos;
            this.linkerCache.updateCache(force);
            this.decorations = this.buildDecorations(update.view, updateIsOnActiveView);
            this.lastActiveFile = activeFile ?? "";
        }

        this.lastViewUpdate = update;
    }



    destroy() { }

    buildDecorations(view: EditorView, viewIsActive: boolean = true): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        if (!this.settings.linkerActivated) {
            return builder.finish();
        }

        const dom = view.dom;
        const mappedFile = this.viewUpdateDomToFileMap.get(dom);

        for (let { from, to } of view.visibleRanges) {

            this.linkerCache.reset();
            const text = view.state.doc.sliceString(from, to);

            // For every glossary file and its aliases we now search the text for occurrences
            const additions: { id: number, file: TFile, from: number, to: number, widget: WidgetType }[] = [];

            let id = 0;
            // Iterate over every char in the text
            for (let i = 0; i <= text.length; i) {
                // Do this to get unicode characters as whole chars and not only half of them
                const codePoint = text.codePointAt(i)!;
                const char = i < text.length ? String.fromCodePoint(codePoint) : "\n";

                // If we are at a word boundary, get the current fitting files
                const isWordBoundary = PrefixTree.checkWordBoundary(char);
                if (!this.settings.matchOnlyWholeWords || isWordBoundary) {
                    const currentNodes = this.linkerCache.cache.getCurrentMatchNodes(i, this.settings.excludeLinksToOwnNote ? mappedFile : null);
                    if (currentNodes.length > 0) {
                        for (const node of currentNodes) {
                            const nFrom = node.start;
                            const nTo = node.end;
                            const name = text.slice(nFrom, nTo);

                            const aFrom = from + nFrom;
                            const aTo = from + nTo;

                            // TODO: Handle multiple files
                            // const file: TFile = node.files.values().next().value;
                            node.files.forEach((file) => {
                                additions.push({
                                    id: id++,
                                    from: aFrom,
                                    to: aTo,
                                    file: file,
                                    widget: new LiveLinkWidget(name, file, aFrom, aTo, !isWordBoundary, this.app, this.settings)
                                });
                            });

                        }
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

            // We want to exclude some syntax nodes from being decorated,
            // such as code blocks and manually added links
            const excludedIntervalTree = new IntervalTree();
            const excludedTypes = [
                "codeblock",
                "code-block",
                "internal-link",
                "link",
            ]

            if (!this.settings.includeHeaders) {
                excludedTypes.push("header-")
            }

            // We also want to exclude links to files that are already linked by a real link
            const explicitlyLinkedFiles = new Set<TFile>();
            const app = this.app;
            syntaxTree(view.state).iterate({
                from,
                to,
                enter(node) {
                    // const text = view.state.doc.sliceString(node.from, node.to);
                    const type = node.type.name;
                    for (const excludedType of excludedTypes) {
                        if (type.contains(excludedType)) {
                            excludedIntervalTree.insert([node.from, node.to]);
                            
                            // internal-link --> Apples ... without the exact path
                            // internal-link_link-has-alias --> Dir/File.md
                            if (type.contains("internal-link_link-has-alias") || type.endsWith("internal-link")) {
                                const text = view.state.doc.sliceString(node.from, node.to);
                                const linkedFile = app.metadataCache.getFirstLinkpathDest(text, mappedFile?.path ?? "")
                                // console.log(node.type.name, node.from, node.to, text, linkedFile)
                                if (linkedFile) {
                                    explicitlyLinkedFiles.add(linkedFile);
                                }

                            }
                        }
                    }

                },
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

            // Delete additions that overlap
            // Additions are sorted by from position and after that by length, we want to keep longer additions
            for (let i = 0; i < additions.length; i++) {
                const addition = additions[i];
                if (additionsToDelete.has(addition.id)) {
                    continue;
                }

                // Check if the addition is inside an excluded block
                const overlaps = excludedIntervalTree.search([addition.from, addition.to]);
                if (overlaps.length > 0) {
                    additionsToDelete.set(addition.id, true);
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
    
                        if (otherAddition.file === addition.file) {
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


            // Get the cursor position
            const cursorPos = view.state.selection.main.from;

            // Get the line start and end positions if we want to exclude links in the current line
            const excludeLine = viewIsActive && this.settings.excludeLinksInCurrentLine;
            const lineStart = view.state.doc.lineAt(cursorPos).from;
            const lineEnd = view.state.doc.lineAt(cursorPos).to;

            filteredAdditions.forEach(addition => {
                const [from, to] = [addition.from, addition.to];
                const cursorNearby = (cursorPos >= from - 0 && cursorPos <= to + 0);

                const additionIsInCurrentLine = from >= lineStart && to <= lineEnd;

                if (!cursorNearby && (!excludeLine || !additionIsInCurrentLine)) {
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

export const liveLinkerPlugin = (app: App, settings: LinkerPluginSettings, updateManager: ExternalUpdateManager) => {
    return ViewPlugin.define((editorView: EditorView) => {
        return (new AutoLinkerPlugin(editorView, app, settings, updateManager));
    }, pluginSpec)
}

