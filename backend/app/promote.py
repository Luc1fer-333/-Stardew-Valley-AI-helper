from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
import re

from .backlog import BACKLOG_PATH


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_VERSION = "1.6"


@dataclass
class BacklogItem:
    title: str
    start: int
    end: int
    meta_start: int
    meta_end: int
    meta: dict[str, str]


def promote_backlog_items() -> dict:
    if not BACKLOG_PATH.exists():
        return {"promoted": [], "count": 0, "message": "No backlog file."}

    lines = BACKLOG_PATH.read_text(encoding="utf8").replace("\r\n", "\n").split("\n")
    items = parse_backlog(lines)
    todo_items = [item for item in items if item.meta.get("status") == "todo"]
    promoted: list[dict] = []

    for item in todo_items:
        target_path = ROOT / item.meta.get("suggested_file", "data/plans.md")
        draft = build_draft(item)
        entry_id = draft["id"]
        exists = target_path.exists() and f"id: {entry_id}" in target_path.read_text(encoding="utf8")

        if not exists:
            append_draft(target_path, draft["content"])

        mark_item_drafted(lines, item, target_path, entry_id)
        promoted.append(
            {
                "question": item.meta.get("question", item.title),
                "draft_file": relative(target_path),
                "draft_id": entry_id,
                "existed": exists,
            }
        )

    if promoted:
        BACKLOG_PATH.write_text("\n".join(lines), encoding="utf8")

    return {
        "promoted": promoted,
        "count": len(promoted),
        "message": f"Promoted {len(promoted)} backlog item(s).",
    }


def parse_backlog(lines: list[str]) -> list[BacklogItem]:
    items: list[BacklogItem] = []
    index = 0

    while index < len(lines):
        heading = re.match(r"^##\s+(.+)$", lines[index])
        if not heading:
            index += 1
            continue

        title = heading.group(1).strip()
        start = index
        index += 1
        if index >= len(lines) or lines[index] != "---":
            continue

        meta_start = index + 1
        index += 1
        meta: dict[str, str] = {}
        while index < len(lines) and lines[index] != "---":
            key, separator, value = lines[index].partition(":")
            if separator:
                meta[key.strip()] = value.strip()
            index += 1

        meta_end = index
        if index < len(lines):
            index += 1

        while index < len(lines) and not lines[index].startswith("## "):
            index += 1

        items.append(
            BacklogItem(
                title=title,
                start=start,
                end=index,
                meta_start=meta_start,
                meta_end=meta_end,
                meta=meta,
            )
        )

    return items


def build_draft(item: BacklogItem) -> dict[str, str]:
    question = item.meta.get("question", item.title).strip()
    entry_type = item.meta.get("type", "plan").strip() or "plan"
    source = item.meta.get("source_hint", source_hint_from_question(question)).strip()
    title = title_from_question(question)
    entry_id = f"{entry_type}-{slugify(title)}"
    source_url = wiki_url_for(source)
    aliases = aliases_for(question, title)

    content = "\n".join(
        [
            "",
            f"## {title}",
            "---",
            f"id: {entry_id}",
            f"type: {entry_type}",
            "season: all",
            f"aliases: {aliases}",
            f"source: {source}",
            f"source_url: {source_url}",
            f"version: {DEFAULT_VERSION}",
            f"updated: {date.today().isoformat()}",
            "confidence: low",
            "---",
            "",
            f"{title} 是从 backlog 自动生成的资料草稿，当前还需要补充准确条件、流程和注意事项。",
            "",
            "tips:",
            "- TODO: 补充触发条件、地点、季节、时间或解锁要求。",
            "- TODO: 补充玩家决策建议，比如什么时候优先做、什么时候可以后放。",
            "- TODO: 补充常见别名和问法，提升检索命中。",
            "",
        ]
    )

    return {"id": entry_id, "content": content}


def append_draft(target_path: Path, content: str) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    current = target_path.read_text(encoding="utf8") if target_path.exists() else ""
    separator = "\n" if current and not current.endswith("\n") else ""
    target_path.write_text(f"{current}{separator}{content}", encoding="utf8")


def mark_item_drafted(lines: list[str], item: BacklogItem, target_path: Path, entry_id: str) -> None:
    for index in range(item.meta_start, item.meta_end):
        if lines[index].startswith("status:"):
            lines[index] = "status: drafted"
            break

    additions = {
        "drafted": date.today().isoformat(),
        "draft_file": relative(target_path),
        "draft_id": entry_id,
    }
    existing_keys = {
        lines[index].partition(":")[0].strip()
        for index in range(item.meta_start, item.meta_end)
        if ":" in lines[index]
    }
    insert_at = item.meta_end
    for key, value in additions.items():
        if key not in existing_keys:
            lines.insert(insert_at, f"{key}: {value}")
            insert_at += 1


def title_from_question(question: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff ]+", " ", question).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned:
        return "Untitled"
    return " ".join(part.capitalize() for part in cleaned.split(" "))


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", value.lower()).strip("-")
    return slug or "untitled"


def aliases_for(question: str, title: str) -> str:
    values = [question.strip(), title.strip()]
    seen: set[str] = set()
    aliases: list[str] = []
    for value in values:
        normalized = value.lower()
        if value and normalized not in seen:
            seen.add(normalized)
            aliases.append(value)
    return ", ".join(aliases)


def source_hint_from_question(question: str) -> str:
    page = re.sub(r"[^a-zA-Z0-9 ]+", " ", question).strip()
    page = re.sub(r"\s+", " ", page).title()
    return f"Stardew Valley Wiki: {page}" if page else "Stardew Valley Wiki"


def wiki_url_for(source: str) -> str:
    if not source.startswith("Stardew Valley Wiki:"):
        return ""
    page = source.replace("Stardew Valley Wiki:", "", 1).strip()
    if not page:
        return ""
    return f"https://stardewvalleywiki.com/{page.replace(' ', '_')}"


def relative(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")
