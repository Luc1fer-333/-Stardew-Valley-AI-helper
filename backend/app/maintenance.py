from __future__ import annotations

from pathlib import Path
import re

from .backlog import BACKLOG_PATH
from .knowledge import Entry, load_entries


def build_maintenance_summary() -> dict:
    entries = load_entries()
    backlog_items = _parse_backlog()
    confidence = _count_by(entries, "confidence")
    types = _count_by(entries, "type")
    backlog_status = _count_backlog_status(backlog_items)
    low_confidence = [
        {
            "id": entry.id,
            "title": entry.title,
            "type": entry.type,
            "source": entry.source,
            "updated": entry.updated,
        }
        for entry in entries
        if entry.confidence == "low"
    ][:8]
    recent_backlog = backlog_items[:8]

    return {
        "entries": len(entries),
        "types": types,
        "confidence": confidence,
        "backlog": {
            "total": len(backlog_items),
            "status": backlog_status,
            "recent": recent_backlog,
        },
        "low_confidence": low_confidence,
        "recommendations": _recommendations(confidence, backlog_status, low_confidence),
    }


def _count_by(entries: list[Entry], field: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for entry in entries:
        value = getattr(entry, field) or "unknown"
        counts[value] = counts.get(value, 0) + 1
    return counts


def _parse_backlog(path: Path = BACKLOG_PATH) -> list[dict]:
    if not path.exists():
        return []

    lines = path.read_text(encoding="utf8").replace("\r\n", "\n").split("\n")
    items: list[dict] = []
    index = 0

    while index < len(lines):
        heading = re.match(r"^##\s+(.+)$", lines[index])
        if not heading:
            index += 1
            continue

        title = heading.group(1).strip()
        index += 1
        if index >= len(lines) or lines[index] != "---":
            continue

        index += 1
        meta: dict[str, str] = {}
        while index < len(lines) and lines[index] != "---":
            key, separator, value = lines[index].partition(":")
            if separator:
                meta[key.strip()] = value.strip()
            index += 1

        items.append(
            {
                "title": title,
                "question": meta.get("question", title),
                "type": meta.get("type", "plan"),
                "status": meta.get("status", "todo"),
                "suggested_file": meta.get("suggested_file", ""),
                "draft_file": meta.get("draft_file", ""),
                "draft_id": meta.get("draft_id", ""),
                "asked": meta.get("asked", ""),
            }
        )

        while index < len(lines) and not lines[index].startswith("## "):
            index += 1

    return list(reversed(items))


def _count_backlog_status(items: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        status = item.get("status") or "todo"
        counts[status] = counts.get(status, 0) + 1
    return counts


def _recommendations(
    confidence: dict[str, int],
    backlog_status: dict[str, int],
    low_confidence: list[dict],
) -> list[str]:
    recommendations: list[str] = []
    todo_count = backlog_status.get("todo", 0)
    low_count = confidence.get("low", 0)

    if todo_count:
        recommendations.append(f"Promote {todo_count} backlog todo item(s) into Markdown drafts.")
    if low_count:
        recommendations.append(f"Review {low_count} low-confidence draft(s) before expanding UI polish.")
    if low_confidence:
        recommendations.append(f"Next draft to improve: {low_confidence[0]['title']}.")
    if not recommendations:
        recommendations.append("Knowledge base looks tidy. Next best step: add more high-frequency questions.")

    return recommendations
