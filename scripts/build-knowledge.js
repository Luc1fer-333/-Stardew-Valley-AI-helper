const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const outputPath = path.join(root, "knowledge.generated.js");

function parseFrontmatter(lines, startIndex) {
  const meta = {};
  let index = startIndex;

  if (lines[index] !== "---") {
    return { meta, nextIndex: index };
  }

  index += 1;
  while (index < lines.length && lines[index] !== "---") {
    const line = lines[index];
    const separator = line.indexOf(":");
    if (separator !== -1) {
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      meta[key] = value;
    }
    index += 1;
  }

  return { meta, nextIndex: index + 1 };
}

function splitAliases(value) {
  return (value || "")
    .split(/[,，、；;锛屻€侊紱\ufffd]+/)
    .map((alias) => alias.trim())
    .filter(Boolean);
}

function parseMarkdownFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const entries = [];
  let index = 0;

  while (index < lines.length) {
    const heading = lines[index].match(/^##\s+(.+)$/);
    if (!heading) {
      index += 1;
      continue;
    }

    const title = heading[1].trim();
    const parsed = parseFrontmatter(lines, index + 1);
    const meta = parsed.meta;
    index = parsed.nextIndex;

    const body = [];
    while (index < lines.length && !lines[index].startsWith("## ")) {
      body.push(lines[index]);
      index += 1;
    }

    const summaryLines = [];
    const tips = [];
    let inTips = false;

    for (const rawLine of body) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line === "tips:") {
        inTips = true;
        continue;
      }
      if (inTips && line.startsWith("- ")) {
        tips.push(line.slice(2).trim());
        continue;
      }
      if (!inTips) summaryLines.push(line);
    }

    entries.push({
      id: meta.id || title.toLowerCase().replace(/\s+/g, "-"),
      type: meta.type || "plan",
      title,
      season: meta.season || "all",
      aliases: splitAliases(meta.aliases),
      summary: summaryLines.join(" "),
      tips,
      source: meta.source || "",
      source_url: meta.source_url || "",
      version: meta.version || "1.6",
      updated: meta.updated || "",
      confidence: meta.confidence || "medium",
    });
  }

  return entries;
}

const entries = fs
  .readdirSync(dataDir)
  .filter((file) => file.endsWith(".md") && file !== "backlog.md")
  .sort()
  .flatMap((file) => parseMarkdownFile(path.join(dataDir, file)));

const output = [
  "// This file is generated from data/*.md by scripts/build-knowledge.js.",
  "// Edit Markdown files, then run: node scripts/build-knowledge.js",
  `window.STARDEW_KNOWLEDGE = ${JSON.stringify(entries, null, 2)};`,
  "",
].join("\n");

fs.writeFileSync(outputPath, output, "utf8");
console.log(`Built ${entries.length} entries into ${outputPath}`);

