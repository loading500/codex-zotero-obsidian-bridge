CodexZoteroObsidianBridge = {
  id: null,
  version: null,
  rootURI: null,
  noteIndex: new Map(),
  observerID: null,
  readerToolbarHandler: null,
  syncTimer: null,
  pendingKeys: new Set(),
  syncing: Promise.resolve(),
  windowElementIDs: [
    "codex-zotero-obsidian-stylesheet",
    "codex-zotero-obsidian-toolbar-button",
    "codex-zotero-obsidian-itemmenu-separator",
    "codex-zotero-obsidian-itemmenu"
  ],

  async startup({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    await this.rebuildIndex();
    this.addToAllWindows();
    this.registerReaderToolbar();
    this.registerNotifier();
    if (this.pref("syncOnStartup", true)) this.scheduleAll(1400);
  },

  shutdown() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.observerID) Zotero.Notifier.unregisterObserver(this.observerID);
    if (this.readerToolbarHandler) {
      Zotero.Reader.unregisterEventListener("renderToolbar", this.readerToolbarHandler);
    }
    this.removeFromAllWindows();
    this.noteIndex.clear();
  },

  pref(name, fallback) {
    const value = Zotero.Prefs.get(`extensions.codex-zotero-obsidian-bridge.${name}`, true);
    return value === undefined ? fallback : value;
  },

  log(message) {
    Zotero.debug("Codex Zotero–Obsidian Bridge: " + message);
  },

  homePath() {
    return Services.dirsvc.get("Home", Ci.nsIFile).path;
  },

  routeConfigPath() {
    const configured = this.pref("routeConfigPath", "");
    return configured || PathUtils.join(
      this.homePath(), "Library", "Application Support", "Zotero",
      "codex-zotero-obsidian-routes.json"
    );
  },

  async loadRoutes() {
    const path = this.routeConfigPath();
    if (!(await IOUtils.exists(path))) return [];
    try {
      const parsed = JSON.parse(await IOUtils.readUTF8(path));
      return Array.isArray(parsed.routes) ? parsed.routes.filter((route) =>
        route && route.rootCollectionKey && route.vaultName
      ) : [];
    } catch (error) {
      this.log(`Cannot read route configuration ${path}: ${error}`);
      return [];
    }
  },

  async discoverVaults() {
    const registryPath = PathUtils.join(
      this.homePath(), "Library", "Application Support", "obsidian", "obsidian.json"
    );
    if (!(await IOUtils.exists(registryPath))) return [];
    const registry = JSON.parse(await IOUtils.readUTF8(registryPath));
    const notesSubdir = this.pref("notesSubdir", "02_Literature");
    const vaults = [];
    for (const entry of Object.values(registry.vaults || {})) {
      if (!entry.path) continue;
      const notesPath = PathUtils.join(entry.path, notesSubdir);
      if (!(await IOUtils.exists(notesPath))) continue;
      const normalized = entry.path.replace(/[\\/]+$/, "");
      vaults.push({
        name: normalized.split(/[\\/]/).pop(),
        path: entry.path,
        notesSubdir,
        notesPath
      });
    }
    return vaults;
  },

  async markdownFiles(directory) {
    const files = [];
    for (const child of await IOUtils.getChildren(directory)) {
      const stat = await IOUtils.stat(child);
      if (stat.type === "directory") files.push(...await this.markdownFiles(child));
      else if (/\.md$/i.test(child)) files.push(child);
    }
    return files;
  },

  async rebuildIndex() {
    const next = new Map();
    for (const vault of await this.discoverVaults()) {
      for (const path of await this.markdownFiles(vault.notesPath)) {
        let markdown;
        try {
          markdown = await IOUtils.readUTF8(path);
        } catch (error) {
          this.log(`Cannot read note ${path}: ${error}`);
          continue;
        }
        const key = CodexZoteroObsidianCore.extractZoteroKey(markdown);
        if (!key) continue;
        const relativePath = path.slice(vault.path.replace(/[\\/]+$/, "").length + 1);
        const record = { ...vault, path, relativePath };
        if (!next.has(key)) next.set(key, []);
        next.get(key).push(record);
      }
    }
    this.noteIndex = next;
    this.log(`Indexed ${[...next.values()].flat().length} notes across ${new Set([...next.values()].flat().map(x => x.name)).size} vaults`);
    return next;
  },

  addToAllWindows() {
    for (const win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) this.addToWindow(win);
    }
  },

  addToWindow(win) {
    const doc = win.document;
    if (doc.getElementById("codex-zotero-obsidian-toolbar-button")) return;
    const HTML_NS = "http://www.w3.org/1999/xhtml";
    const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

    const stylesheet = doc.createElementNS(HTML_NS, "link");
    stylesheet.id = "codex-zotero-obsidian-stylesheet";
    stylesheet.rel = "stylesheet";
    stylesheet.type = "text/css";
    stylesheet.href = this.rootURI + "style.css";
    doc.documentElement.appendChild(stylesheet);

    const toolbar = doc.getElementById("zotero-items-toolbar");
    if (toolbar) {
      const button = doc.createElementNS(XUL_NS, "toolbarbutton");
      button.id = "codex-zotero-obsidian-toolbar-button";
      button.className = "zotero-tb-button";
      button.setAttribute("tabindex", "-1");
      button.setAttribute("label", "Codex Obsidian");
      button.setAttribute("tooltiptext", "打开并同步 Codex Obsidian 项目笔记");
      button.addEventListener("command", () => this.openSelected(win));
      const spacer = toolbar.querySelector("spacer[flex='1']");
      toolbar.insertBefore(button, spacer || null);
    }

    const itemMenu = doc.getElementById("zotero-itemmenu");
    if (itemMenu) {
      const separator = doc.createElementNS(XUL_NS, "menuseparator");
      separator.id = "codex-zotero-obsidian-itemmenu-separator";
      itemMenu.appendChild(separator);
      const menuitem = doc.createElementNS(XUL_NS, "menuitem");
      menuitem.id = "codex-zotero-obsidian-itemmenu";
      menuitem.setAttribute("label", "打开 Codex Obsidian 项目笔记");
      menuitem.className = "menuitem-iconic";
      menuitem.addEventListener("command", () => this.openSelected(win));
      itemMenu.appendChild(menuitem);
    }
  },

  removeFromWindow(win) {
    for (const id of this.windowElementIDs) win.document.getElementById(id)?.remove();
  },

  removeFromAllWindows() {
    for (const win of Zotero.getMainWindows()) this.removeFromWindow(win);
  },

  registerReaderToolbar() {
    this.readerToolbarHandler = ({ reader, doc, append }) => {
      if (doc.getElementById("codex-zotero-obsidian-reader-button")) return;
      const button = doc.createElement("button");
      button.id = "codex-zotero-obsidian-reader-button";
      button.title = "打开并同步 Codex Obsidian 项目笔记";
      button.setAttribute("aria-label", button.title);
      button.style.cssText = "background:transparent;border:0;padding:4px;display:flex;align-items:center;cursor:pointer";
      const image = doc.createElement("img");
      image.src = this.rootURI + "icons/obsidian-black.svg";
      image.alt = "";
      image.width = 20;
      image.height = 20;
      button.appendChild(image);
      button.addEventListener("click", () => this.openForItem(reader._item));
      append(button);
    };
    Zotero.Reader.registerEventListener("renderToolbar", this.readerToolbarHandler, this.id);
  },

  registerNotifier() {
    this.observerID = Zotero.Notifier.registerObserver({
      notify: async (event, type, ids) => {
        if (type !== "item") return;
        if (event === "delete" || event === "trash") {
          this.scheduleAll();
          return;
        }
        for (const id of ids) {
          const item = await Zotero.Items.getAsync(id);
          if (!item) continue;
          const top = this.resolveTopItem(item);
          if (top && this.noteIndex.has(top.key)) this.scheduleKey(top.key);
        }
      }
    }, ["item"], "codex-zotero-obsidian-bridge");
  },

  resolveTopItem(item) {
    let current = item;
    const visited = new Set();
    while (current?.parentID && !visited.has(current.id)) {
      visited.add(current.id);
      current = Zotero.Items.get(current.parentID);
    }
    return current || null;
  },

  async openSelected(win) {
    const selected = win.ZoteroPane.getSelectedItems();
    if (!selected?.length) {
      Zotero.alert(win, "Codex Obsidian", "请先选择一篇文献、附件或批注。");
      return;
    }
    await this.openForItem(selected[0], win);
  },

  async openForItem(item, win = Zotero.getMainWindow()) {
    const top = this.resolveTopItem(item);
    if (!top) return;
    let records = this.noteIndex.get(top.key) || [];
    if (!records.length || !(await IOUtils.exists(records[0].path))) {
      await this.rebuildIndex();
      records = this.noteIndex.get(top.key) || [];
    }
    if (!records.length) {
      const created = await this.createMissingNote(top, win);
      if (!created) return;
      records = this.noteIndex.get(top.key) || [];
    }
    await this.syncTopItem(top);
    const record = records.length === 1 ? records[0] : this.chooseRecord(records, win);
    if (!record) return;
    Zotero.launchURL(CodexZoteroObsidianCore.buildObsidianURI(record.name, record.relativePath));
  },

  async collectionAncestorKeys(top) {
    const keys = new Set();
    for (const collectionID of top.getCollections?.() || []) {
      let collection = Zotero.Collections.get(collectionID);
      const seen = new Set();
      while (collection && !seen.has(collection.id)) {
        seen.add(collection.id);
        keys.add(collection.key);
        collection = collection.parentID ? Zotero.Collections.get(collection.parentID) : null;
      }
    }
    return keys;
  },

  chooseRoute(routes, win, title) {
    if (!routes.length) return null;
    if (routes.length === 1) return routes[0];
    const labels = routes.map((route) => `${route.label || route.vaultName} — ${route.vaultName}`);
    const selected = { value: 0 };
    const ok = Services.prompt.select(
      win, "选择 Obsidian 项目", `请选择《${title}》要创建到的项目：`,
      labels.length, labels, selected
    );
    return ok ? routes[selected.value] : null;
  },

  async getCitationKey(key) {
    try {
      const response = await fetch("http://127.0.0.1:23119/better-bibtex/json-rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "item.citationkey", params: [[key]], id: 1 })
      });
      if (!response.ok) return "";
      const payload = await response.json();
      return payload?.result?.[key] || "";
    } catch (_) {
      return "";
    }
  },

  creatorNames(top) {
    return (top.getCreators?.() || []).map((creator) => {
      if (creator.name) return creator.name;
      return [creator.lastName, creator.firstName].filter(Boolean).join(", ");
    }).filter(Boolean);
  },

  metricFields(top) {
    const catalog = String(top.getField("libraryCatalog") || "").trim();
    const metric = catalog.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*\((Q[1-4])\)\s*$/i);
    const casRaw = String(top.getField("callNumber") || "").trim();
    const cas = /^[1-4]$/.test(casRaw) ? `${casRaw} 区` : "—";
    return {
      impactFactor: metric ? metric[1] : "—",
      jcr: metric ? metric[2].toUpperCase() : "—",
      cas
    };
  },

  async createMissingNote(top, win) {
    await top.loadAllData();
    const title = String(top.getField("title") || "").trim();
    if (!CodexZoteroObsidianCore.hasUsableItemTitle(title)) {
      Zotero.alert(
        win,
        "Codex Obsidian",
        "当前条目的题名尚未保存。请先在 Zotero 中完成题名并按 Enter 或移开焦点，然后再试；Bridge 未创建占位笔记。"
      );
      return null;
    }
    const routes = await this.loadRoutes();
    if (!routes.length) {
      Zotero.alert(win, "Codex Obsidian", `没有可用的项目路由配置，无法为《${title}》创建笔记。`);
      return null;
    }
    const ancestorKeys = await this.collectionAncestorKeys(top);
    const matched = CodexZoteroObsidianCore.matchingRoutes(routes, ancestorKeys);
    const route = this.chooseRoute(matched.length ? matched : routes, win, title);
    if (!route) return null;
    const vault = (await this.discoverVaults()).find((candidate) => candidate.name === route.vaultName);
    if (!vault) {
      Zotero.alert(win, "Codex Obsidian", `没有发现 Obsidian 库“${route.vaultName}”或其 02_Literature 目录。`);
      return null;
    }
    const templatePath = PathUtils.join(vault.path, "_templates", "Literature.md");
    if (!(await IOUtils.exists(templatePath))) {
      Zotero.alert(win, "Codex Obsidian", `缺少模板：${templatePath}`);
      return null;
    }
    let cnMap = {};
    const cnMapPath = PathUtils.join(vault.path, ".cn_titles.json");
    if (await IOUtils.exists(cnMapPath)) {
      try { cnMap = JSON.parse(await IOUtils.readUTF8(cnMapPath)); } catch (_) {}
    }
    const cnTitle = String(cnMap[top.key] || "").trim();
    const rawDate = String(top.getField("date") || "");
    const year = rawDate.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/)?.[1] || "";
    const doi = String(top.getField("DOI") || "").trim();
    const journal = top.getField("publicationTitle") || top.getField("bookTitle") || "";
    const template = await IOUtils.readUTF8(templatePath);
    const rendered = CodexZoteroObsidianCore.renderLiteratureTemplate(template, {
      title,
      cnTitle,
      cnTitleReviewed: Boolean(cnTitle),
      authors: this.creatorNames(top),
      year,
      journal,
      doi,
      key: top.key,
      citekey: await this.getCitationKey(top.key),
      date: new Date().toISOString().slice(0, 10),
      ...this.metricFields(top)
    });
    const occupied = new Set((await IOUtils.getChildren(vault.notesPath)).map((path) => PathUtils.filename(path)));
    const filename = CodexZoteroObsidianCore.noteFilename(cnTitle || title, top.key, occupied);
    if (!filename) {
      Zotero.alert(win, "Codex Obsidian", `目标文件及其 key 后缀版本均已存在，未覆盖：${cnTitle || title}`);
      return null;
    }
    const notePath = PathUtils.join(vault.notesPath, filename);
    await Zotero.File.putContentsAsync(notePath, rendered);
    await this.rebuildIndex();
    await this.syncTopItem(top);
    return notePath;
  },

  chooseRecord(records, win) {
    const labels = records.map((record) => `${record.name} — ${record.relativePath.replace(/^02_Literature[\\/]/, "")}`);
    const selected = { value: 0 };
    const ok = Services.prompt.select(
      win, "选择 Obsidian 项目", "这篇文献存在于多个项目，请选择要打开的笔记：",
      labels.length, labels, selected
    );
    return ok ? records[selected.value] : null;
  },

  scheduleKey(key, delay = null) {
    this.pendingKeys.add(key);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    const wait = delay ?? Number(this.pref("syncDelayMs", 700));
    this.syncTimer = setTimeout(() => this.flushPending(), wait);
  },

  scheduleAll(delay = null) {
    for (const key of this.noteIndex.keys()) this.pendingKeys.add(key);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    const wait = delay ?? Number(this.pref("syncDelayMs", 700));
    this.syncTimer = setTimeout(() => this.flushPending(), wait);
  },

  async flushPending() {
    this.syncTimer = null;
    const keys = [...this.pendingKeys];
    this.pendingKeys.clear();
    this.syncing = this.syncing.then(async () => {
      for (const key of keys) {
        const item = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, key);
        if (item) await this.syncTopItem(item);
      }
    }).catch((error) => Zotero.logError(error));
    await this.syncing;
  },

  async syncTopItem(top) {
    const records = this.noteIndex.get(top.key) || [];
    if (!records.length) return { changed: 0, skipped: true };
    await top.loadAllData();
    const data = await this.collectImportantContent(top);
    const block = CodexZoteroObsidianCore.renderManagedBlock(data);
    let changed = 0;
    for (const record of records) {
      const current = await IOUtils.readUTF8(record.path);
      const alreadyManaged = current.includes(CodexZoteroObsidianCore.BEGIN);
      if (!alreadyManaged && !data.notes.length && !data.annotations.length) continue;
      const updated = CodexZoteroObsidianCore.replaceOrInsertManagedBlock(current, block);
      if (updated === current) continue;
      await this.backupOncePerDay(record);
      await Zotero.File.putContentsAsync(record.path, updated);
      changed++;
    }
    return { changed, notes: data.notes.length, annotations: data.annotations.length };
  },

  async collectImportantContent(top) {
    const itemURI = this.itemURI(top);
    const notes = [];
    for (const noteID of top.getNotes(false)) {
      const note = Zotero.Items.get(noteID);
      if (!note) continue;
      await note.loadAllData();
      notes.push({
        title: note.getNoteTitle(),
        body: this.htmlNoteToText(note.getNote()),
        itemURI,
        generated: this.isZoteroOneGeneratedNote(note.getNote(), note.getNoteTitle())
      });
    }

    const annotations = [];
    for (const attachmentID of top.getAttachments(false)) {
      const attachment = Zotero.Items.get(attachmentID);
      if (!attachment?.isFileAttachment()) continue;
      await attachment.loadAllData();
      const embeddedNote = this.htmlNoteToText(attachment.getNote());
      if (embeddedNote) {
        notes.push({
          title: attachment.getNoteTitle() || "附件笔记",
          body: embeddedNote,
          itemURI,
          generated: this.isZoteroOneGeneratedNote(attachment.getNote(), attachment.getNoteTitle())
        });
      }
      for (const annotation of attachment.getAnnotations(false)) {
        await annotation.loadAllData();
        let position = {};
        try { position = JSON.parse(annotation.annotationPosition || "{}"); } catch (_) {}
        const pageIndex = Number.isInteger(position.pageIndex) ? position.pageIndex : null;
        const uri = this.annotationURI(attachment, annotation, pageIndex, position);
        annotations.push({
          type: annotation.annotationType,
          text: annotation.annotationText,
          comment: annotation.annotationComment,
          color: annotation.annotationColor,
          pageLabel: annotation.annotationPageLabel,
          pageIndex,
          sortIndex: annotation.annotationSortIndex || "",
          uri,
          tags: annotation.getTags().map((tag) => tag.tag)
        });
      }
    }
    annotations.sort((a, b) => (a.sortIndex || "").localeCompare(b.sortIndex || ""));
    return { notes, annotations };
  },

  itemURI(item) {
    const library = Zotero.Libraries.get(item.libraryID);
    const segment = library.libraryType === "user" ? "library" : `groups/${library.groupID}`;
    return `zotero://select/${segment}/items/${item.key}`;
  },

  annotationURI(attachment, annotation, pageIndex, position) {
    const library = Zotero.Libraries.get(attachment.libraryID);
    const segment = library.libraryType === "user" ? "library" : `groups/${library.groupID}`;
    let uri = `zotero://open-pdf/${segment}/items/${attachment.key}`;
    const params = [];
    if (position.type === "FragmentSelector" && position.value) params.push(`cfi=${encodeURIComponent(position.value)}`);
    else if (position.type === "CssSelector" && position.value) params.push(`sel=${encodeURIComponent(position.value)}`);
    else if (pageIndex !== null) params.push(`page=${pageIndex + 1}`);
    params.push(`annotation=${encodeURIComponent(annotation.key)}`);
    return uri + "?" + params.join("&");
  },

  htmlNoteToText(html) {
    if (!html) return "";
    let normalized = String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    try { normalized = Zotero.Utilities.unescapeHTML(normalized); } catch (_) {}
    return CodexZoteroObsidianCore.cleanText(normalized);
  },

  isZoteroOneGeneratedNote(html, title) {
    const sample = `${title || ""}\n${this.htmlNoteToText(html).slice(0, 1200)}`;
    return /(?:🤖️?\s*AI\s*文献解读|AI\s*🤖\s*全文翻译|📙\s*生词>{3,}|#🤖️?\/AI文献阅读)/i.test(sample);
  },

  async backupOncePerDay(record) {
    const date = new Date().toISOString().slice(0, 10);
    const backupRoot = PathUtils.join(record.path.slice(0, record.path.length - record.relativePath.length), ".codex-zotero-backups", date);
    const backupPath = PathUtils.join(backupRoot, ...record.relativePath.split(/[\\/]/));
    const parent = PathUtils.parent(backupPath);
    await IOUtils.makeDirectory(parent, { createAncestors: true, ignoreExisting: true });
    if (!(await IOUtils.exists(backupPath))) await IOUtils.copy(record.path, backupPath);
  }
};
