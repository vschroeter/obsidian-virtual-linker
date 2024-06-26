import { App, parseFrontMatterAliases, TFile, Vault } from "obsidian";

import { LinkerPluginSettings } from "main";


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
    _currentNodes: PrefixNode[] = [];

    constructor(public app: App, public settings: LinkerPluginSettings) {
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
        node.files.add(file);
    }

    updateTree() {
        this.root = new PrefixNode();
        const includeAllFiles = this.settings.includeAllFiles || this.settings.linkerDirectories.length === 0;
        const includeDirPattern = new RegExp(`(^|\/)(${this.settings.linkerDirectories.join("|")})\/`);

        for (const file of this.app.vault.getMarkdownFiles()) {

            // Get the tags of the file
            const frontmatterTags = this.app.metadataCache.getFileCache(file)?.frontmatter?.tags ?? [];
            const inlineTags = (this.app.metadataCache.getFileCache(file)?.tags ?? []).map(tag => tag.tag).map(tag => tag.startsWith("#") ? tag.slice(1) : tag);
            const tags = [...frontmatterTags, ...inlineTags].filter(tag => tag && tag.trim().length > 0);

            const includeFile = tags.includes(this.settings.tagToIncludeFile);
            const excludeFile = tags.includes(this.settings.tagToExcludeFile);

            if (excludeFile) {
                continue;
            }

            // Skip files that are not in the linker directories
            if (!includeFile && !includeAllFiles && !includeDirPattern.test(file.path)) {
                continue;
            }

            const metadata = this.app.metadataCache.getFileCache(file);
            // const aliases = parseFrontMatterAliases(metadata?.frontmatter);
            const aliases = metadata?.frontmatter?.aliases ?? [];
            // const tags = (metadata?.tags || []).map(tag => tag.tag);


            let names = [file.basename] // 
            if (aliases) {
                names.push(...aliases);
            }

            names = names.filter(name => name && name.trim().length > 0);

            // console.log(aliases, tags, names);

            // Check if the file should match case sensitive
            if (this.settings.matchCaseSensitive) {
                if (tags.includes(this.settings.tagToIgnoreCase)) {
                    const lowerCaseNames = names.map(name => name.toLowerCase());
                    names.push(...lowerCaseNames);
                }
            } else {
                if (!tags.includes(this.settings.tagToMatchCase)) {
                    const lowerCaseNames = names.map(name => name.toLowerCase());
                    names.push(...lowerCaseNames);
                }
            }

            for (const name of names) {
                this.addFile(name, file);
            }

            // this.addFile(file.basename, file);
            // if (aliases) {
            //     for (const alias of aliases) {
            //         this.addFile(alias, file);
            //     }
            // }
            // if (tags) {
            //     for (const tag of tags) {
            //         this.addFile(tag, file);
            //     }
            // }
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
        const chars = [char]
        if (!this.settings.matchCaseSensitive) {
            chars.push(char.toLowerCase());
        }

        chars.forEach(c => {
            // char = char.toLowerCase();
            if (!this.settings.matchOnlyWholeWords || PrefixTree.checkWordBoundary(c)) {
                newNodes.push(this.root);
            }

            for (const node of this._currentNodes) {
                const child = node.children.get(c);
                if (child) {
                    newNodes.push(child);
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
    constructor(public mtime: number, public file: TFile, public aliases: string[], public tags: string[]) { }
}

export class LinkerCache {
    activeFilePath?: string;
    // files: Map<string, CachedFile> = new Map();
    // linkEntries: Map<string, CachedFile[]> = new Map();
    vault: Vault;
    cache: PrefixTree;

    constructor(public app: App, public settings: LinkerPluginSettings) {
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
        this.cache.updateTree();

        this.activeFilePath = activeFile;
    }

}


