# Cascade Templates

A modular cascading templating system for [Obsidian](https://obsidian.md).

Each folder can hold a `!Template.md` file. A note inherits the closest template found walking up its parent folders, so templates cascade down the vault hierarchy and can be overridden per folder.

## Features

### Cascading templates
Place a `!Template.md` in a folder. Any note inside that folder (or in one of its subfolders without a more specific template) is associated to it.

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

### Template scanner
A scanner that walks the vault and lists notes whose frontmatter is not coherent with their template, plus templates missing properties from their parent template. Folders can be excluded and the scan can be limited to notes, templates or both.

## How it works

Property handling is YAML frontmatter based and preserves the original ordering of keys. The core modules are:

- `src/core/templateAPI.ts` - template resolution and frontmatter read/write
- `src/core/mapOperations.ts` - merge and conformance logic
- `src/features/` - UI integrations (status icon, reconform button)
- `src/scanner/` - vault-wide coherence scanner

## Development

```cli
npm install
npm run dev
```

Build with `npm run build`.
