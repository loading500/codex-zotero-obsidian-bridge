# Codex Zotero–Obsidian Bridge

A local Zotero 9 plugin for opening, creating, and incrementally updating Obsidian literature notes. It can run beside other Zotero plugins and only rewrites its own marked block.

## Routing

The plugin discovers Obsidian vaults from the local Obsidian registry. A vault participates when it contains `02_Literature`; notes are indexed by the `zotero_key` YAML field.

Creation routes are intentionally kept outside this repository. By default, create a JSON file at the platform-specific Zotero application-support path named `codex-zotero-obsidian-routes.json`:

```json
{
  "routes": [
    {
      "rootCollectionKey": "AAAAAAAA",
      "vaultName": "research-vault",
      "label": "Research project"
    }
  ]
}
```

Each configured root collection is matched against the selected item's collection ancestors. If more than one route matches, the plugin asks which vault to use.

## Behavior

- Adds a black Obsidian button to Zotero's main toolbar and PDF reader, plus a context-menu command.
- Synchronizes Zotero item notes, personal annotation comments, and other highlights before opening a note.
- Debounces incremental updates by 0.7 seconds.
- Writes only between `CODEX-ZOTERO-IMPORTANT-NOTES` markers and preserves the rest of the Markdown file.
- Makes one backup per vault and day before its first managed-block rewrite.
- Creates a missing note from `_templates/Literature.md` without overwriting an existing file.
- Uses a reviewed `.cn_titles.json` title when available; otherwise it keeps the original Zotero title and marks the Chinese title as pending.
- Stores collection-to-vault routes only in the local configuration file.

The plugin performs local filesystem and Zotero-database operations. It uses the local Better BibTeX JSON-RPC endpoint only to resolve a citation key.

## Build and test

```sh
node test-core.js
./build.sh
```

`preflight.js` and `impact-preflight.js` are local diagnostic utilities and are excluded from release builds. Zotero `9.0.*` is the only declared compatibility range.

## License

MIT
