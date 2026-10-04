const assert = require("node:assert/strict");
const manifest = require("./manifest.json");
const packageMetadata = require("./package.json");
const core = require("./bridge-core.js");

assert.equal(manifest.version, packageMetadata.version);
assert.equal(manifest.version, "0.2.1");
assert.equal(manifest.applications.zotero.strict_min_version, "9.0");
assert.equal(manifest.applications.zotero.strict_max_version, "10.0.*");
assert.equal(
  manifest.applications.zotero.update_url,
  "https://github.com/loading500/codex-zotero-obsidian-bridge/releases/latest/download/updates.json"
);

const original = `---
title: "Paper"
zotero_key: "ABCDEFGH"
---

# Paper

## TL;DR
Keep me.
`;

assert.equal(core.extractZoteroKey(original), "ABCDEFGH");
const block = core.renderManagedBlock({
  notes: [
    { title: "关键判断", body: "这是我写的条目笔记。", itemURI: "zotero://select/library/items/ABCDEFGH", generated: false },
    { title: "AI 文献解读", body: "自动生成的长篇内容。", itemURI: "zotero://select/library/items/ABCDEFGH", generated: true }
  ],
  annotations: [
    { type: "highlight", text: "important result", comment: "这是最重要的结果", color: "#ff6666", pageLabel: "7", uri: "zotero://open-pdf/library/items/PDFPDF12?page=7&annotation=ANNOTE12", tags: ["重点"] },
    { type: "highlight", text: "method detail", comment: "", color: "#ffd400", pageLabel: "9", uri: "zotero://open-pdf/library/items/PDFPDF12?page=9&annotation=ANNOTE13", tags: [] }
  ]
});
const updated = core.replaceOrInsertManagedBlock(original, block);
assert.ok(updated.indexOf("## ⭐ Zotero 重点笔记") < updated.indexOf("## TL;DR"));
assert.ok(updated.indexOf("这是我写的条目笔记") < updated.indexOf("method detail"));
assert.ok(updated.indexOf("method detail") < updated.indexOf("自动生成的长篇内容"));
assert.ok(updated.includes("<details>"));
assert.ok(updated.includes("Keep me."));
assert.equal(core.replaceOrInsertManagedBlock(updated, block), updated);
assert.equal(
  core.buildObsidianURI("example-vault", "02_Literature/Test Paper.md"),
  "obsidian://open?vault=example-vault&file=02_Literature%2FTest%20Paper"
);
assert.equal(core.sanitizeFilename('A/B: C?'), "A B C");
assert.equal(core.hasUsableItemTitle("  Original title  "), true);
assert.equal(core.hasUsableItemTitle(" \n\t "), false);
assert.deepEqual(
  core.matchingRoutes([{ rootCollectionKey: "AAAAAAAA" }, { rootCollectionKey: "BBBBBBBB" }], new Set(["BBBBBBBB"])),
  [{ rootCollectionKey: "BBBBBBBB" }]
);
assert.equal(core.noteFilename("Reviewed title", "ABCDEFGH", new Set()), "Reviewed title.md");
assert.equal(core.noteFilename("Reviewed title", "ABCDEFGH", new Set(["Reviewed title.md"])), "Reviewed title (ABCDEFGH).md");
assert.equal(core.noteFilename("Reviewed title", "ABCDEFGH", new Set(["Reviewed title.md", "Reviewed title (ABCDEFGH).md"])), null);
const rendered = core.renderLiteratureTemplate(`---
title: "{{title}}"
中文标题: "{{cn_title}}"
authors:
  - "{{author1}}"
zotero_key: "{{key}}"
---
# {{title}}
`, {
  title: "Original Title",
  cnTitle: "",
  cnTitleReviewed: false,
  authors: ["Doe, Jane", "Li, Ming"],
  key: "ABCDEFGH"
});
assert.ok(rendered.includes('cn_title_status: pending'));
assert.ok(rendered.includes('  - "Doe, Jane"\n  - "Li, Ming"'));
assert.ok(rendered.includes('zotero_key: "ABCDEFGH"'));
const reviewed = core.renderLiteratureTemplate(`---
title: "{{title}}"
中文标题: "{{cn_title}}"
authors:
  - "{{author1}}"
zotero_key: "{{key}}"
---
# {{title}}
`, {
  title: "Original Title",
  cnTitle: "审核中文题名",
  cnTitleReviewed: true,
  authors: ["Doe, Jane"],
  key: "ABCDEFGH"
});
assert.ok(reviewed.includes('中文标题: "审核中文题名"'));
assert.ok(!reviewed.includes("cn_title_status: pending"));
assert.throws(
  () => core.replaceOrInsertManagedBlock(`---\nzotero_key: ABCDEFGH\n---\n# T\n${core.BEGIN}\na\n${core.BEGIN}\nb\n${core.END}` , block),
  /markers are missing or duplicated/
);
console.log("bridge-core tests passed");
