const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const core = require("./bridge-core.js");

async function fetchAll(itemType) {
  const first = await fetch(`http://localhost:23119/api/users/0/items?itemType=${itemType}&limit=100&start=0&format=json`);
  if (!first.ok) throw new Error(`Local Zotero API returned ${first.status}`);
  const total = Number(first.headers.get("total-results") || 0);
  const rows = await first.json();
  for (let start = 100; start < total; start += 100) {
    const response = await fetch(`http://localhost:23119/api/users/0/items?itemType=${itemType}&limit=100&start=${start}&format=json`);
    rows.push(...await response.json());
  }
  return rows;
}

function indexedNotes() {
  const registryPath = path.join(os.homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const notes = [];
  for (const vault of Object.values(registry.vaults || {})) {
    const directory = path.join(vault.path, "02_Literature");
    if (!fs.existsSync(directory)) continue;
    for (const filename of fs.readdirSync(directory)) {
      if (!filename.endsWith(".md")) continue;
      const key = core.extractZoteroKey(fs.readFileSync(path.join(directory, filename), "utf8"));
      if (key) notes.push({ key, vault: path.basename(vault.path) });
    }
  }
  return notes;
}

(async () => {
  const notes = indexedNotes();
  const indexedKeys = new Set(notes.map((note) => note.key));
  const [attachments, annotations, zoteroNotes] = await Promise.all([
    fetchAll("attachment"), fetchAll("annotation"), fetchAll("note")
  ]);
  const attachmentParents = new Map(attachments.map((item) => [item.key, item.data.parentItem]));
  const affected = new Set();
  let annotationCount = 0;
  let personalCommentCount = 0;
  for (const annotation of annotations) {
    const topKey = attachmentParents.get(annotation.data.parentItem);
    if (!indexedKeys.has(topKey)) continue;
    affected.add(topKey);
    annotationCount++;
    if ((annotation.data.annotationComment || "").trim()) personalCommentCount++;
  }
  let zoteroNoteCount = 0;
  for (const note of zoteroNotes) {
    if (!indexedKeys.has(note.data.parentItem)) continue;
    affected.add(note.data.parentItem);
    zoteroNoteCount++;
  }
  const affectedByVault = {};
  for (const note of notes) {
    if (affected.has(note.key)) affectedByVault[note.vault] = (affectedByVault[note.vault] || 0) + 1;
  }
  console.log(JSON.stringify({
    indexedLiteratureNotes: notes.length,
    notesThatWouldReceiveManagedBlock: affected.size,
    affectedByVault,
    zoteroChildNotes: zoteroNoteCount,
    pdfAnnotations: annotationCount,
    annotationsWithPersonalComments: personalCommentCount
  }, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
