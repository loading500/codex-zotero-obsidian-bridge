var CodexZoteroObsidianBridge;
var CodexZoteroObsidianCore;

function log(message) {
  Zotero.debug("Codex Zotero–Obsidian Bridge: " + message);
}

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  Services.scriptloader.loadSubScript(rootURI + "bridge-core.js");
  Services.scriptloader.loadSubScript(rootURI + "bridge.js");
  await CodexZoteroObsidianBridge.startup({ id, version, rootURI });
  log("Started " + version);
}

function onMainWindowLoad({ window }) {
  CodexZoteroObsidianBridge?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  CodexZoteroObsidianBridge?.removeFromWindow(window);
}

function shutdown() {
  CodexZoteroObsidianBridge?.shutdown();
  CodexZoteroObsidianBridge = undefined;
  CodexZoteroObsidianCore = undefined;
}

function install() {}
function uninstall() {}
