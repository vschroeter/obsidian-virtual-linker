# Obsidian Virtual Linker Plugin (Glossary Plugin)

This plugin automatically generates virtual links for text within your notes that match with the titles or aliases of other notes in your vault.

Features:
- create a glossary like functionality
- works in **edit mode** and **read mode**
- created links are **always up to date** 
- **no manual linking** necessary 
- works with **aliases** of notes
- links do not appear in graph view & reference counting
- updates the links automatically while you expand your vault or type new text
- convert the virtual links to real links in the context menu

Usage demo (literally just typing text ;-):
![Demo](media/LinkerDemo.gif)

## Usage

By default, the plugin will automatically link all notes of your vault.
All occurrences of a note title or alias will be linked in your current note text.
If you only want to include notes of a specific folder, you can define this folder in the settings.

> [!Note]
> The auto generated links are post-processed, so they neither change your note text to hard-coded links enclosed in brackets not 
> appear in the graph view or reference counting.

## Manually installing the plugin

- Copy over `main.js` & `manifest.json` (find them under `Releases`) to your vault `VaultFolder/.obsidian/plugins/virtual-linker/`.


## Settings

### Virtual Link Suffix

Any created virtual link will be appended with this suffix. This is useful to distinguish between real and virtual links.
By default, the suffix is "🔗".

## Matched files

You can toggle the matching of files between:
- "Match all files": All files in your vault are matched.
- "Match only files in a specific folder": Only files in a specific folder are matched. You can specify the folder in the settings. This is useful if you want to only create virtual links to notes in a dedicated glossary directory.

Furthermore, you can explicitly include or exclude specific files from being matched, by adding a tag to the file. You can change the tag in the settings, by default it is:
- `linker-include` to explicitly include a file
- `linker-exclude` to explicitly exclude a file

### Case sensitivity
You can toggle the case sensitivity of the matching. By default, the matching is case insensitive.
You can also explicitly change the case sensitivity of a specific file by adding a tag to the file. You can change the tag in the settings, by default it is:
- `linker-match-case` to make the matching case sensitive
- `linker-ignore-case` to make the matching case insensitive

### Matching mode

You can toggle the matching mode between:
- "Matching only whole words": Only whole words are matched. E.g. "Note" will not match "Notebook".
- "Matching any part of a word": Any part of a word is matched. E.g. "Note" will match "Notebook".

If you choose "Matching any part of a word", you furthermore have the option to suppress the link suffix for these matches to avoid cluttering your text.

### Styling of the links

By default (and if the default styling is toggled on in the settings), the links appear a little bit darker than your normal links.
You can turn off this default styling in the settings.

To apply custom styling to the links, you can add a CSS-snippet at `VaultFolder/.obsidian/snippets/virtualLinks.css` file.

```css
/* E.g. to change the color of all link texts to red */
.virtual-link a{ 
    color: red !important;
}
```

## How to use for development

- Clone this repo (into `your-vault/.obsidian/plugins/`).
- `yarn` to install dependencies
- `yarn dev` to start compilation in watch mode.
- `yarn build` to compile your `main.ts` into `main.js`.

It is recommended to use the [Hot Reload Plugin](https://github.com/pjeby/hot-reload) for development.
