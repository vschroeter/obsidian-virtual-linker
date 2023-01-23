# Obsidian Glossary Plugin

This plugin automatically links your glossary / abbreviation entries,
which you have defined in an special glossary folder.

- no manual linking necessary 
- links do not appear in graph view & reference counting
- updates the links automatically while you expand your glossary folder

![Basic Screenshot](images/Screenshot_1.jpg)

## Usage

- In the settings, define the name of your glossary folder (defaults to `Glossary`) and add this folder to your vault.
- For each glossary / abbreviation entry add a new file. This file is exactly like normal files, you can add short or detailed descriptions for this entry.
- In read mode, all found 

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

## How to use for development

- Clone this repo.
- `npm i` or `yarn` to install dependencies
- `npm run dev` to start compilation in watch mode.

It is recommended to use the [Hot Reload Plugin](https://github.com/pjeby/hot-reload) for development.


## Roadmap

- [x] Glossaries can be overwritten by nested glossary folders 
- [ ] Support aliases for glossary entries 
- [ ] Add glossary entry preview in live preview mode
