import { App, getAllTags, parseFrontMatterAliases, TFile, Vault } from "obsidian";

import { LinkerPluginSettings } from "main";
import { LinkerMetaInfoFetcher } from "./linkerInfo";

export class ExternalUpdateManager {
    registeredCallbacks: Set<Function> = new Set();

    constructor() {}

    registerCallback(callback: Function) {
        this.registeredCallbacks.add(callback);
    }

    update() {
        // Timeout to make sure the cache is updated
        setTimeout(() => {
            for (const callback of this.registeredCallbacks) {
                callback();
            }
        }, 50);
    }
}

export class PrefixNode {
    parent: PrefixNode | undefined;
    children: Map<string, PrefixNode> = new Map();
    files: Set<TFile> = new Set();
    charValue: string = "";
    value: string = "";
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
    fetcher: LinkerMetaInfoFetcher;

    _currentNodes: PrefixNode[] = [];

    setIndexedFilePaths: Set<string> = new Set();
    mapIndexedFilePathsToUpdateTime: Map<string, number> = new Map();
    mapFilePathToLeaveNodes: Map<string, PrefixNode[]> = new Map();

    constructor(public app: App, public settings: LinkerPluginSettings) {
        this.fetcher = new LinkerMetaInfoFetcher(this.app, this.settings);
        this.updateTree();
    }

    getCurrentMatchNodes(index: number, excludedNote?: TFile | null): MatchNode[] {
        const matchNodes: MatchNode[] = [];

        if (excludedNote === undefined && this.settings.excludeLinksToOwnNote) {
            excludedNote = this.app.workspace.getActiveFile();
        }

        // From the current nodes in the trie, get all nodes that have files
        for (const node of this._currentNodes) {
            if (node.files.size === 0) {
                continue;
            }
            const matchNode = new MatchNode();
            matchNode.length = node.value.length;
            matchNode.start = index - matchNode.length;
            matchNode.files = new Set(Array.from(node.files).filter((file) => !excludedNote || file.path !== excludedNote.path));
            matchNode.value = node.value;
            if (matchNode.files.size > 0) {
                matchNodes.push(matchNode);
            }
        }

        // Sort nodes by length
        matchNodes.sort((a, b) => b.length - a.length);

        return matchNodes;
    }

    private addFileWithName(name: string, file: TFile) {
        let node = this.root;

        // For each character in the name, add a node to the trie
        for (let char of name) {
            // char = char.toLowerCase();
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

        // The last node is a leaf node, add the file to the node
        node.files.add(file);

        // Store the leaf node for the file to be able to remove it later
        const path = file.path;
        this.mapFilePathToLeaveNodes.set(path, [node, ...(this.mapFilePathToLeaveNodes.get(path) ?? [])]);
        // console.log("Adding file", file, name);
    }

    private addFileToTree(file: TFile) {
        const path = file.path;
        // Remove the old nodes of the file
        this.removeFileFromTree(file);

        // Add the file to the set of indexed files
        this.setIndexedFilePaths.add(path);
        this.mapIndexedFilePathsToUpdateTime.set(path, file.stat.mtime);

        // Get the virtual linker related metadata of the file
        const metaInfo = this.fetcher.getMetaInfo(file);

        // Get the tags of the file
        // and normalize them by removing the # in front of tags
        const tags = (getAllTags(this.app.metadataCache.getFileCache(file)!!) ?? [])
            .filter((tag) => tag.trim().length > 0)
            .map((tag) => (tag.startsWith("#") ? tag.slice(1) : tag));

        const includeFile = metaInfo.includeFile;
        const excludeFile = metaInfo.excludeFile;

        const isInIncludedDir = metaInfo.isInIncludedDir;
        const isInExcludedDir = metaInfo.isInExcludedDir;

        // console.log({
        //     file: file.path,
        //     tags: tags,
        //     includeFile,
        //     excludeFile,
        //     isInIncludedDir,
        //     isInExcludedDir,
        //     includeAllFiles: metaInfo.includeAllFiles
        // });

        if (excludeFile || (isInExcludedDir && !includeFile)) {
            return;
        }

        // Skip files that are not in the linker directories
        if (!includeFile && !isInIncludedDir && !metaInfo.includeAllFiles) {
            return;
        }

        const metadata = this.app.metadataCache.getFileCache(file);
        const aliases = metadata?.frontmatter?.aliases ?? [];

        let names = [file.basename]; //
        if (aliases) {
            names.push(...aliases);
        }

        names = names.filter((name) => name && name.trim().length > 0);

        // console.log(aliases, tags, names);

        // Check if the file should match case sensitive
        if (this.settings.matchCaseSensitive) {
            if (tags.includes(this.settings.tagToIgnoreCase)) {
                const lowerCaseNames = names.map((name) => name.toLowerCase());
                names.push(...lowerCaseNames);
            }
        } else {
            if (!tags.includes(this.settings.tagToMatchCase)) {
                const lowerCaseNames = names.map((name) => name.toLowerCase());
                names.push(...lowerCaseNames);
            }
        }

        for (const name of names) {
            this.addFileWithName(name, file);
        }
    }

    private removeFileFromTree(file: TFile | string) {
        const path = typeof file === "string" ? file : file.path;

        // Get the leaf nodes of the file
        const nodes = this.mapFilePathToLeaveNodes.get(path) ?? [];
        for (const node of nodes) {
            // Remove the file from the node
            node.files = new Set([...node.files].filter((f) => f.path !== path));
        }

        // If the nodes have no files or children, remove them from the tree
        for (let i = nodes.length - 1; i >= 0; i--) {
            const node = nodes[i];
            let currentNode = node;
            while (currentNode.files.size === 0 && currentNode.children.size === 0) {
                const parent = currentNode.parent;
                if (!parent || parent === this.root) {
                    break;
                }
                parent.children.delete(currentNode.charValue);
                currentNode = parent;
            }
        }

        // Remove the file from the set of indexed files
        this.setIndexedFilePaths.delete(path);
        this.mapFilePathToLeaveNodes.delete(path);

        // Remove the update time of the file
        this.mapIndexedFilePathsToUpdateTime.delete(path);
    }

    private fileIsUpToDate(file: TFile) {
        const mtime = file.stat.mtime;
        const path = file.path;
        return this.mapIndexedFilePathsToUpdateTime.has(path) && this.mapIndexedFilePathsToUpdateTime.get(path) === mtime;
    }

    updateTree(updateFiles?: (string | undefined)[]) {
        this.fetcher.refreshSettings();

        const currentVaultFiles = new Set<string>();
        let files = new Array<TFile>();
        const allFiles = this.app.vault.getMarkdownFiles();

        // If the number of files has changed, update all files
        if (allFiles.length != this.setIndexedFilePaths.size || !updateFiles || updateFiles.length == 0) {
            files = allFiles;
        } else {
            // If files are provided, only update the provided files
            files = updateFiles
                .map((f) => (f ? this.app.vault.getAbstractFileByPath(f) : null))
                .filter((f) => f !== null && f instanceof TFile) as TFile[];
        }

        for (const file of files) {
            currentVaultFiles.add(file.path);

            // Get the update time of the file
            const mtime = file.stat.mtime;

            // Check if the file has been updated
            if (this.fileIsUpToDate(file)) {
                continue;
            }
            // console.log("Updating", file, file.stat.mtime, this.mapIndexedFilePathsToUpdateTime.get(file.path));

            // Otherwise, add the file to the tree
            this.addFileToTree(file);
        }

        // Remove files that are no longer in the vault
        const filesToRemove = [...this.setIndexedFilePaths].filter((f) => !currentVaultFiles.has(f));
        // console.log("Removing", filesToRemove);
        filesToRemove.forEach((f) => this.removeFileFromTree(f));
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
        const chars = [char];
        if (!this.settings.matchCaseSensitive) {
            chars.push(char.toLowerCase());
        }

        chars.forEach((c) => {
            // char = char.toLowerCase();
            if (!this.settings.matchOnlyWholeWords || PrefixTree.checkWordBoundary(c)) {
                newNodes.push(this.root);
            }

            for (const node of this._currentNodes) {
                const child = node.children.get(c);
                if (child) {
                    if (!newNodes.includes(child)) {
                        newNodes.push(child);
                    }
                }
            }
        });
        this._currentNodes = newNodes;
    }

    static checkWordBoundary(char: string): boolean {
        const pattern = /[\/\n\t\r\s,.!"`´()\[\]'{}|~\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
        return pattern.test(char);
    }
}

export class CachedFile {
    constructor(public mtime: number, public file: TFile, public aliases: string[], public tags: string[]) {}
}

export class LinkerCache {
    static instance: LinkerCache;

    activeFilePath?: string;
    // files: Map<string, CachedFile> = new Map();
    // linkEntries: Map<string, CachedFile[]> = new Map();
    vault: Vault;
    cache: PrefixTree;

    constructor(public app: App, public settings: LinkerPluginSettings) {
        const { vault } = app;
        this.vault = vault;
        // console.log("Creating LinkerCache");
        this.cache = new PrefixTree(app, settings);
        this.updateCache(true);
    }

    static getInstance(app: App, settings: LinkerPluginSettings) {
        if (!LinkerCache.instance) {
            LinkerCache.instance = new LinkerCache(app, settings);
        }
        return LinkerCache.instance;
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
        // console.log("Updating cache", force);
        this.cache.updateTree(force ? undefined : [activeFile, this.activeFilePath]);

        this.activeFilePath = activeFile;
    }
}
