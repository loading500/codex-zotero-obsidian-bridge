const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const core = require("./bridge-core.js");

const registryPath = path.join(os.homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const records = [];

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(target);
    return /\.md$/i.test(entry.name) ? [target] : [];
  });
}

for (const vault of Object.values(registry.vaults || {})) {
  const notesPath = path.join(vault.path, "02_Literature");
  if (!fs.existsSync(notesPath)) continue;
  for (const notePath of markdownFiles(notesPath)) {
    const key = core.extractZoteroKey(fs.readFileSync(notePath, "utf8"));
    if (key) records.push({ vault: path.basename(vault.path), notePath, key });
  }
}

const grouped = Map.groupBy(records, (record) => record.key);
const duplicates = [...grouped.values()].filter((matches) => matches.length > 1);
const counts = Object.fromEntries(
  [...Map.groupBy(records, (record) => record.vault)].map(([vault, notes]) => [vault, notes.length])
);

(async () => {
  let unresolved = 0;
  for (let i = 0; i < records.length; i += 20) {
    await Promise.all(records.slice(i, i + 20).map(async (record) => {
      const response = await fetch(`http://localhost:23119/api/users/0/items/${record.key}?format=json`);
      if (!response.ok) unresolved++;
    }));
  }
  console.log(JSON.stringify({ vaults: counts, indexedNotes: records.length, duplicateKeys: duplicates.length, unresolvedItems: unresolved }, null, 2));
  if (duplicates.length || unresolved) process.exitCode = 1;
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
