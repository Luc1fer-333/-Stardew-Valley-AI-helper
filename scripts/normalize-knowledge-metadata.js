const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const defaultVersion = "1.6";
const defaultUpdated = "2026-07-03";

function wikiUrlFor(source, type) {
  if (!source.startsWith("Stardew Valley Wiki:")) return "";

  const rawPage = source.replace("Stardew Valley Wiki:", "").trim();
  const firstPage = rawPage.split(",")[0].trim();
  const page = type === "quest" && rawPage.includes("Bundles") ? "Bundles" : firstPage;

  return `https://stardewvalleywiki.com/${encodeURIComponent(page.replace(/\s+/g, "_"))}`;
}

function normalizeFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const output = [];
  let index = 0;

  while (index < lines.length) {
    output.push(lines[index]);

    if (!lines[index].startsWith("## ")) {
      index += 1;
      continue;
    }

    index += 1;
    if (lines[index] !== "---") continue;

    const frontmatter = [lines[index]];
    index += 1;

    while (index < lines.length && lines[index] !== "---") {
      frontmatter.push(lines[index]);
      index += 1;
    }

    const fields = Object.fromEntries(
      frontmatter
        .slice(1)
        .map((line) => line.split(/:(.*)/s).slice(0, 2))
        .filter(([key, value]) => key && value !== undefined)
        .map(([key, value]) => [key.trim(), value.trim()]),
    );

    const source = fields.source || "";
    const type = fields.type || "plan";
    const additions = {
      source_url: wikiUrlFor(source, type),
      version: defaultVersion,
      updated: defaultUpdated,
      confidence: source.startsWith("Stardew Valley Wiki:") ? "high" : "medium",
    };

    for (const [key, value] of Object.entries(additions)) {
      if (!fields[key]) {
        frontmatter.push(`${key}: ${value}`);
      }
    }

    if (index < lines.length) {
      frontmatter.push(lines[index]);
      index += 1;
    }

    output.push(...frontmatter);
  }

  fs.writeFileSync(filePath, output.join("\n"), "utf8");
}

for (const file of fs.readdirSync(dataDir).filter((name) => name.endsWith(".md") && name !== "backlog.md").sort()) {
  normalizeFile(path.join(dataDir, file));
}

console.log("Knowledge metadata normalized.");
