# Cascade Templates

A modular cascading templating system for [Obsidian](https://obsidian.md).

Each folder can hold a `!Template.md` file. A note inherits the closest template found walking up its parent folders, so templates cascade down the vault hierarchy and can be overridden per folder.

## Installation

Manual installation:

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Put them in `<your-vault>/.obsidian/plugins/cascade-templates/`.
3. Enable "Cascade Templates" in Settings → Community plugins.

With [BRAT](https://github.com/TfTHacker/obsidian42-brat), add the repository URL and install the plugin from there.

## Usage

1. Create a `!Template.md` in a folder and give it the properties that every note in that folder should have.
2. Notes in that folder, and in its subfolders, inherit that template. A nested `!Template.md` overrides it and adds its own properties.
3. When you create a new empty note, the nearest template's properties are applied automatically. This can be disabled or limited in the settings.
4. The properties panel shows whether the note is aligned with its template and offers a single button that walks through Fill, Align and Reset. Back undoes the last step.

Nested templates can inherit from their parent too: run Fill on a new `!Template.md` to copy the parent's properties.

## Features

### Cascading templates

A template applies to the folder that contains it and to all its descendants, until a nested `!Template.md` takes over. This makes it possible to build progressively more specific schemas while keeping shared properties defined once.

### Auto-apply on new notes

When a new note (or a new nested `!Template.md`) is created with an empty body, the associated template's properties are merged in automatically. Optionally the template body is copied too. Files that already carry content, such as notes arriving from sync or import, are left alone. Auto-apply can be turned off in the settings.

### Template status icon

While a note is open, the metadata panel shows an icon describing its relation to the associated template:

- conforming to the template
- containing extra properties
- missing properties required by the template

### Reconform from template

A single button in the metadata panel walks through three steps: Fill (add missing properties), Align (drop extra properties) and Reset (restore the template defaults). Back undoes the last step and rewinds the button. The toolbar can be hidden on notes that have no template.

## How it works

Property handling is YAML frontmatter based and preserves the original ordering of keys. The core modules are:

- `src/core/templateAPI.ts` - template resolution and frontmatter read/write
- `src/core/conformance.ts` - pure conformance and reconform rules
- `src/core/mapOperations.ts` - merge and conformance logic
- `src/features/` - metadata panel integration

## Development

```cli
npm install
npm run dev
```

Build with `npm run build`. Run the pure-core tests with `npm test`.

## License

MIT. See [LICENSE](LICENSE).
