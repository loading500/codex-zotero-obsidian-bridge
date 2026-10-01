#!/bin/sh
set -eu
cd "$(dirname "$0")"
node test-core.js
rm -f codex-zotero-obsidian-bridge.xpi
zip -qr codex-zotero-obsidian-bridge.xpi \
  manifest.json prefs.js bootstrap.js bridge-core.js bridge.js style.css icons
unzip -t codex-zotero-obsidian-bridge.xpi
