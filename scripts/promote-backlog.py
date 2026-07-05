from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.promote import promote_backlog_items  # noqa: E402


def main() -> int:
    result = promote_backlog_items()
    promoted = result.get("promoted", [])
    if not promoted:
        print(result.get("message", "No backlog items promoted."))
        return 0

    for item in promoted:
        action = "exists" if item.get("existed") else "drafted"
        print(
            f"{action}: {item.get('question')} -> "
            f"{item.get('draft_file')}#{item.get('draft_id')}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
