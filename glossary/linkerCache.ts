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


export class PrefixNode {
    parent: PrefixNode | undefined;
    children: Map<string, PrefixNode> = new Map();
    files: Set<TFile> = new Set();
    charValue: string = "";
    value: string = "";

    // get value(): string {
    //     let node: PrefixNode | undefined = this;
    //     let value = "";
    //     while (node) {
    //         value = node.charValue + value;
    //         node = node.parent;
    //     }
    //     return value;
    // }
}

export class MatchNode {
    start: number = 0;
    length: number = 0;
    files: Set<TFile> = new Set();
    value: string = "";

    get end(): number {
        return this.start + this.length;
    }
}

export class PrefixTree {
    root: PrefixNode = new PrefixNode();
    // _current: PrefixNode = this.root;
    _currentNodes: PrefixNode[] = [];

    constructor(public app: App, public settings: GlossaryLinkerPluginSettings) {
        this.updateTree();
    }

    getCurrentMatchNodes(index: number): MatchNode[] {
        const matchNodes: MatchNode[] = [];

        for (const node of this._currentNodes) {
            if (node.files.size === 0) {
                continue;
            }
            const matchNode = new MatchNode();
            matchNode.length = node.value.length;
            matchNode.start = index - matchNode.length;
            matchNode.files = node.files;
            matchNode.value = node.value;
            matchNodes.push(matchNode);
        }
        return matchNodes;
    }

    addFile(name: string, file: TFile) {
        let node = this.root;
        for (let char of name) {
            char = char.toLowerCase();
            let child = node.children.get(char);
            if (!child) {
                child = new PrefixNode();
                child.parent = node;
                child.charValue = char;
                child.value = node.value + char;
                node.children.set(char, child);
            }
            node = child;
        }
        node.files.add(file);
    }

    updateTree() {
        this.root = new PrefixNode();
        const includeAllFiles = this.settings.includeAllFiles || this.settings.linkerDirectories.length === 0;
        const includeDirPattern = new RegExp(`(^|\/)(${this.settings.linkerDirectories.join("|")})\/`);

        for (const file of this.app.vault.getMarkdownFiles()) {
            // Skip files that are not in the linker directories
            if (!includeAllFiles && !includeDirPattern.test(file.path)) {
                continue;
            }

            const metadata = this.app.metadataCache.getFileCache(file);
            const aliases = parseFrontMatterAliases(metadata?.frontmatter);
            const tags = (metadata?.tags || []).map(tag => tag.tag);

            this.addFile(file.basename, file);
            if (aliases) {
                for (const alias of aliases) {
                    this.addFile(alias, file);
                }
            }
            if (tags) {
                for (const tag of tags) {
                    this.addFile(tag, file);
                }
            }
        }
    }

    findFiles(prefix: string): Set<TFile> {
        let node: PrefixNode | undefined = this.root;
        for (const char of prefix) {
            node = node.children.get(char.toLowerCase());
            if (!node) {
                return new Set();
            }
        }
        return node.files;
    }

    resetSearch() {
        // this._current = this.root;
        this._currentNodes = [this.root];
    }

    pushChar(char: string) {
        const newNodes: PrefixNode[] = [];
        char = char.toLowerCase();
        if (PrefixTree.checkWordBoundary(char)) {
            newNodes.push(this.root);
        }

        for (const node of this._currentNodes) {
            const child = node.children.get(char);
            if (child) {
                newNodes.push(child);
            }
        }
        this._currentNodes = newNodes;
    }

    static checkWordBoundary(char: string): boolean {
        const pattern = /[\n\t\r\s,.!"`´()\[\]'{}|~]/;
        return pattern.test(char);
    }


}


export class CachedFile {
    constructor(public mtime: number, public file: TFile, public aliases: string[], public tags: string[]) { }
}

export class LinkerCache {
    activeFilePath?: string;
    // files: Map<string, CachedFile> = new Map();
    // linkEntries: Map<string, CachedFile[]> = new Map();
    vault: Vault;
    cache: PrefixTree;

    constructor(public app: App, public settings: GlossaryLinkerPluginSettings) {
        const { vault } = app;
        this.vault = vault;
        this.cache = new PrefixTree(app, settings);
        this.updateCache(true);

    }

    reset() { 
        this.cache.resetSearch();
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
        // console.log("Updating cache")
        this.cache.updateTree();
        // this.linkEntries.clear();

        this.activeFilePath = activeFile;

        // const includeAllFiles = this.settings.includeAllFiles || this.settings.linkerDirectories.length === 0;
        // const includeDirPattern = new RegExp(`(^|\/)(${this.settings.linkerDirectories.join("|")})\/`);

        // for (const file of this.vault.getMarkdownFiles()) {

        //     // Skip the active file
        //     if (file.path === activeFile) {
        //         continue;
        //     }

        //     // Skip files that are not in the linker directories
        //     if (!includeAllFiles && !includeDirPattern.test(file.path)) {
        //         continue;
        //     }

        //     const cachedFile = this.files.get(file.path);
        //     if (cachedFile && cachedFile.mtime === file.stat.mtime) {
        //         continue;
        //     }

        //     const metadata = this.app.metadataCache.getFileCache(file);
        //     const aliases = parseFrontMatterAliases(metadata?.frontmatter);
        //     const tags = (metadata?.tags || []).map(tag => tag.tag);

        //     const cacheFile = new CachedFile(file.stat.mtime, file, aliases ? aliases : [], tags ? tags : []);

        //     this.files.set(file.path, cacheFile);
        // }

        // // Update the link entries
        // for (const file of this.files.values()) {
        //     this._addEntry(file.file.basename, file);
        //     for (const alias of file.aliases) {
        //         this._addEntry(alias, file);
        //     }
        //     for (const tag of file.tags) {
        //         this._addEntry(tag, file);
        //     }
        // }

        // console.log("Link entries", this.linkEntries)
    }

    // _addEntry(name: string, file: CachedFile) {
    //     let entries = this.linkEntries.get(name);
    //     if (!entries) {
    //         entries = [];
    //         this.linkEntries.set(name, entries);
    //     }
    //     entries.push(file);
    // }
}


