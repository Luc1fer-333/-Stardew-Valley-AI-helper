from __future__ import annotations

from datetime import date
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
BACKLOG_PATH = ROOT / "data" / "backlog.md"


def append_backlog_item(
    question: str,
    intent: str = "",
    suggested_file: str = "",
    source_hint: str = "",
) -> dict:
    normalized_question = _normalize_question(question)
    if not normalized_question:
        return {
            "status": "ignored",
            "added": False,
            "path": str(BACKLOG_PATH),
            "message": "Question is empty.",
        }

    BACKLOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not BACKLOG_PATH.exists():
        BACKLOG_PATH.write_text("# Knowledge Backlog\n\n", encoding="utf8")

    text = BACKLOG_PATH.read_text(encoding="utf8")
    marker = f"question_key: {normalized_question}"
    if marker in text:
        return {
            "status": "exists",
            "added": False,
            "path": str(BACKLOG_PATH),
            "message": "Already in backlog.",
        }

    title = _title_from_question(question)
    entry = "\n".join(
        [
            f"## {title}",
            "---",
            f"question_key: {normalized_question}",
            f"question: {question.strip()}",
            f"type: {intent or 'plan'}",
            f"suggested_file: {suggested_file or 'data/plans.md'}",
            f"source_hint: {source_hint or _source_hint_from_question(question)}",
            f"asked: {date.today().isoformat()}",
            "status: todo",
            "---",
            "",
            "notes:",
            "- 待补充准确资料、别名和来源。",
            "",
        ]
    )

    separator = "" if text.endswith("\n") else "\n"
    BACKLOG_PATH.write_text(f"{text}{separator}{entry}", encoding="utf8")
    return {
        "status": "added",
        "added": True,
        "path": str(BACKLOG_PATH),
        "message": "Added to backlog.",
    }


def _normalize_question(question: str) -> str:
    return re.sub(r"\s+", " ", question.strip().lower())


def _title_from_question(question: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff ]+", " ", question).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:60] or "Untitled question"


def _source_hint_from_question(question: str) -> str:
    page = re.sub(r"[^a-zA-Z0-9 ]+", " ", question).strip()
    page = re.sub(r"\s+", " ", page).title()
    return f"Stardew Valley Wiki: {page}" if page else "Stardew Valley Wiki"
