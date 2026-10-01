(function (global, factory) {
  const api = factory();
  global.CodexZoteroObsidianCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(this, function () {
  "use strict";

  const BEGIN = "<!-- BEGIN CODEX-ZOTERO-IMPORTANT-NOTES -->";
  const END = "<!-- END CODEX-ZOTERO-IMPORTANT-NOTES -->";

  function extractZoteroKey(markdown) {
    const frontmatter = String(markdown).match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
    if (!frontmatter) return null;
    const match = frontmatter[1].match(/^zotero_key:\s*["']?([^"'\s]+)["']?\s*$/m);
    return match ? match[1] : null;
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function quoteLines(text, prefix = "> ") {
    return cleanText(text)
      .split("\n")
      .map((line) => prefix + line)
      .join("\n");
  }

  function colorName(color) {
    const colors = {
      "#ffd400": "黄色",
      "#ff6666": "红色",
      "#5fb236": "绿色",
      "#2ea8e5": "蓝色",
      "#a28ae5": "紫色",
      "#e56eee": "洋红色",
      "#f19837": "橙色",
      "#aaaaaa": "灰色"
    };
    return colors[String(color || "").toLowerCase()] || "标记";
  }

  function typeName(type) {
    return ({
      highlight: "高亮",
      underline: "下划线",
      note: "便笺",
      image: "区域/图片",
      ink: "手写",
      text: "文字"
    })[type] || "批注";
  }

  function annotationHeading(annotation) {
    const page = annotation.pageLabel ? `第 ${annotation.pageLabel} 页` : "未标页码";
    return `${page} · ${colorName(annotation.color)}${typeName(annotation.type)}`;
  }

  function renderTags(tags) {
    if (!tags || !tags.length) return "";
    return `\n> 标签：${tags.map((tag) => `\`${cleanText(tag)}\``).join(" ")}`;
  }

  function renderPersonalAnnotation(annotation) {
    const parts = [
      `> [!important] ${annotationHeading(annotation)}`,
      quoteLines(annotation.comment || "（无文字评论）")
    ];
    if (cleanText(annotation.text)) {
      parts.push(">", "> 原文：", quoteLines(annotation.text));
    }
    parts.push(`> [跳回 Zotero 原文](${annotation.uri})${renderTags(annotation.tags)}`);
    return parts.join("\n");
  }

  function renderPlainAnnotation(annotation) {
    const parts = [
      `> [!quote] ${annotationHeading(annotation)}`,
      quoteLines(annotation.text || `（${typeName(annotation.type)}批注，无可导出的文本）`),
      `> [跳回 Zotero 原文](${annotation.uri})${renderTags(annotation.tags)}`
    ];
    return parts.join("\n");
  }

  function renderZoteroNote(note) {
    const title = cleanText(note.title) || "Zotero 条目笔记";
    return [
      `> [!important] ${title}`,
      quoteLines(note.body || "（空笔记）"),
      note.itemURI ? `> [在 Zotero 中打开文献](${note.itemURI})` : ""
    ].filter(Boolean).join("\n");
  }

  function renderGeneratedNote(note) {
    const title = cleanText(note.title) || "Zotero One 自动笔记";
    const body = cleanText(note.body || "（空笔记）").replace(/<\/details>/gi, "&lt;/details&gt;");
    return [
      "<details>",
      `<summary>${title}</summary>`,
      "",
      body,
      "",
      note.itemURI ? `[在 Zotero 中打开文献](${note.itemURI})` : "",
      "</details>"
    ].filter((line) => line !== "").join("\n");
  }

  function renderManagedBlock(data) {
    const notes = data.notes || [];
    const personalNotes = notes.filter((note) => !note.generated);
    const generatedNotes = notes.filter((note) => note.generated);
    const annotations = data.annotations || [];
    const personal = annotations.filter((annotation) => cleanText(annotation.comment));
    const plain = annotations.filter((annotation) => !cleanText(annotation.comment));
    const sections = [
      BEGIN,
      "## ⭐ Zotero 重点笔记（自动同步）",
      "",
      "> [!warning] 这是你在 Zotero 中记录的重要内容",
      "> 条目笔记和个人批注优先显示；本区块由黑色 Obsidian 按钮维护，请在 Zotero 中修改。",
      ""
    ];

    if (personalNotes.length || personal.length) {
      sections.push("### 我写下的笔记与批注", "");
      for (const note of personalNotes) sections.push(renderZoteroNote(note), "");
      for (const annotation of personal) sections.push(renderPersonalAnnotation(annotation), "");
    }

    if (plain.length) {
      sections.push("### 原文高亮与其他标记", "");
      for (const annotation of plain) sections.push(renderPlainAnnotation(annotation), "");
    }

    if (generatedNotes.length) {
      sections.push("### Zotero One 自动笔记（折叠保存）", "");
      sections.push("以下内容完整保留，但不与人工重点混排。", "");
      for (const note of generatedNotes) sections.push(renderGeneratedNote(note), "");
    }

    if (!notes.length && !annotations.length) {
      sections.push("*当前没有 Zotero 条目笔记或 PDF 批注。*", "");
    }

    sections.push(END);
    return sections.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  function replaceOrInsertManagedBlock(markdown, block) {
    const source = String(markdown);
    const beginCount = source.split(BEGIN).length - 1;
    const endCount = source.split(END).length - 1;
    if (beginCount > 1 || endCount > 1 || beginCount !== endCount) {
      throw new Error("Managed Zotero block markers are missing or duplicated");
    }
    if (beginCount === 1) {
      const pattern = new RegExp(BEGIN + "[\\s\\S]*?" + END);
      return source.replace(pattern, block);
    }

    const frontmatter = source.match(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/);
    const searchStart = frontmatter ? frontmatter[0].length : 0;
    const h1Pattern = /^#\s+.+$/gm;
    h1Pattern.lastIndex = searchStart;
    const h1 = h1Pattern.exec(source);
    const insertAt = h1 ? h1.index + h1[0].length : searchStart;
    const before = source.slice(0, insertAt).replace(/\s*$/, "");
    const after = source.slice(insertAt).replace(/^\s*/, "");
    return `${before}\n\n${block}\n\n${after}`.replace(/\s*$/, "\n");
  }

  function buildObsidianURI(vaultName, relativePath) {
    return "obsidian://open?vault=" + encodeURIComponent(vaultName)
      + "&file=" + encodeURIComponent(String(relativePath).replace(/\.md$/i, ""));
  }

  function yamlString(value) {
    return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
  }

  function sanitizeFilename(value) {
    const cleaned = String(value || "Untitled")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim();
    return cleaned || "Untitled";
  }

  function hasUsableItemTitle(value) {
    return cleanText(value).length > 0;
  }

  function matchingRoutes(routes, ancestorKeys) {
    const keys = ancestorKeys instanceof Set ? ancestorKeys : new Set(ancestorKeys || []);
    return (routes || []).filter((route) => route && keys.has(route.rootCollectionKey));
  }

  function noteFilename(title, key, occupiedNames) {
    const base = sanitizeFilename(title);
    const occupied = occupiedNames instanceof Set ? occupiedNames : new Set(occupiedNames || []);
    const preferred = `${base}.md`;
    if (!occupied.has(preferred)) return preferred;
    const fallback = `${base} (${key}).md`;
    if (!occupied.has(fallback)) return fallback;
    return null;
  }

  function renderLiteratureTemplate(template, data) {
    let output = String(template);
    const replacements = {
      title: data.title,
      cn_title: data.cnTitle,
      author1: (data.authors || [""])[0],
      year: data.year || "",
      journal: data.journal,
      if: data.impactFactor || "—",
      jcr: data.jcr || "—",
      cas: data.cas || "—",
      doi: data.doi,
      key: data.key,
      citekey: data.citekey,
      date: data.date
    };
    for (const [name, value] of Object.entries(replacements)) {
      output = output.replace(new RegExp(`{{${name}}}`, "g"), String(value ?? ""));
    }
    const authors = (data.authors || []).length ? data.authors : [""];
    output = output.replace(
      /authors:\s*\n(?:\s+-\s+"?[^\n]*"?\s*\n)+/,
      `authors:\n${authors.map((author) => `  - ${yamlString(author)}`).join("\n")}\n`
    );
    if (!data.cnTitleReviewed) {
      output = output.replace(/^(中文标题:\s*).*$/m, `$1""`);
      if (/^cn_title_status:/m.test(output)) {
        output = output.replace(/^cn_title_status:.*$/m, "cn_title_status: pending");
      } else {
        output = output.replace(/^(中文标题:.*)$/m, "$1\ncn_title_status: pending");
      }
    }
    return output.replace(/\r\n?/g, "\n").replace(/\s*$/, "\n");
  }

  return {
    BEGIN,
    END,
    extractZoteroKey,
    renderManagedBlock,
    replaceOrInsertManagedBlock,
    buildObsidianURI,
    yamlString,
    sanitizeFilename,
    matchingRoutes,
    noteFilename,
    hasUsableItemTitle,
    renderLiteratureTemplate,
    cleanText
  };
});
