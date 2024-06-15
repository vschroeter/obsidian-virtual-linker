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
            // linkHref = this.app?.metadataCache?.fileToLinktext(note, note.path, false);
            // const fileLink = this.app?.metadataCache?.fileToLinktext(note, note.path, false);
            // linkHref = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(note.path), note.path);
            linkHref = note.path;
        } catch (e) {
            console.error(e)
        }

        const span = document.createElement('span');
        const link = document.createElement('a');

        link.href = linkHref;
        link.textContent = linkText + "🔗";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
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


class CachedFile {
    constructor(public mtime: number, public file: TFile, public aliases: string[], public tags: string[]) { }
}


class LinkerCache {
    activeFilePath?: string;
    files: Map<string, CachedFile> = new Map();
    linkEntries: Map<string, CachedFile[]> = new Map();
    vault: Vault;

    constructor(public app: App, public settings: GlossaryLinkerPluginSettings) {
        const { vault } = app;
        this.vault = vault;
        this.updateCache(true);
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

        const includeAllFiles = this.settings.includeAllFiles || this.settings.linkerDirectories.length === 0;
        const includeDirPattern = new RegExp(`(^|\/)(${this.settings.linkerDirectories.join("|")})\/`);

        for (const file of this.vault.getMarkdownFiles()) {

            // Skip the active file
            if (file.path === activeFile) {
                continue;
            }

            // Skip files that are not in the linker directories
            if (!includeAllFiles && !includeDirPattern.test(file.path)) {
                continue;
            }

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

    settings: GlossaryLinkerPluginSettings;

    private lastCursorPos: number = 0;

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
        if (this.lastCursorPos != cursorPos || update.docChanged || update.viewportChanged) {
            this.lastCursorPos = cursorPos;
            this.linkerCache.updateCache();
            this.decorations = this.buildDecorations(update.view);
            // console.log("Update", cursorPos)
        }
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
                }
            }

            // Sort additions by from position
            additions.sort((a, b) => a.from - b.from);

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


const pluginSpec: PluginSpec<AutoLinkerPlugin> = {
    decorations: (value: AutoLinkerPlugin) => value.decorations,
};

export const liveLinkerPlugin = (app: App, settings: GlossaryLinkerPluginSettings) => {
    return ViewPlugin.define((editorView: EditorView) => {
        return (new AutoLinkerPlugin(editorView, app, settings));
    }, pluginSpec)
}

