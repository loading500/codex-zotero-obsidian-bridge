const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const xpi = path.join(root, "codex-zotero-obsidian-bridge.xpi");
const hash = crypto.createHash("sha256").update(fs.readFileSync(xpi)).digest("hex");
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const update = {
  addons: {
    [manifest.applications.zotero.id]: {
      updates: [{
        version: manifest.version,
        update_link: `https://github.com/loading500/codex-zotero-obsidian-bridge/releases/download/v${manifest.version}/codex-zotero-obsidian-bridge.xpi`,
        update_hash: `sha256:${hash}`,
        applications: {
          zotero: {
            strict_min_version: manifest.applications.zotero.strict_min_version,
            strict_max_version: manifest.applications.zotero.strict_max_version
          }
        }
      }]
    }
  }
};
fs.writeFileSync(path.join(dist, "updates.json"), JSON.stringify(update, null, 2) + "\n");
fs.writeFileSync(path.join(dist, "codex-zotero-obsidian-bridge.xpi.sha256"), `${hash}  codex-zotero-obsidian-bridge.xpi\n`);
console.log(hash);
