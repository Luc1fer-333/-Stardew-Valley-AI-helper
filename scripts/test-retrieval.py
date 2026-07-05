from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.knowledge import build_answer, diagnose_retrieval, retrieve  # noqa: E402


CASES = [
    ("Marnie gift", "strong-match"),
    ("Penny gift", "strong-match"),
    ("summer money", "strong-match"),
    ("spring plan", "strong-match"),
    ("greenhouse bundle", "strong-match"),
    ("crafts room bundle", "strong-match"),
    ("skull cavern plan", "strong-match"),
    ("rainy day plan", "strong-match"),
    ("tool upgrade timing", "strong-match"),
    ("watering can upgrade", "strong-match"),
    ("quality sprinkler", "strong-match"),
    ("first week fishing", "strong-match"),
    ("mines elevator", "strong-match"),
    ("winter seeds", "strong-match"),
    ("what to do in winter", "strong-match"),
    ("winter seeds route", "strong-match"),
    ("egg festival strawberry", "strong-match"),
    ("stardew valley fair tokens", "strong-match"),
    ("night market", "strong-match"),
    ("fish tank blockers", "strong-match"),
    ("skull cavern preparation", "strong-match"),
    ("sprinkler materials", "strong-match"),
    ("build silo", "strong-match"),
    ("stable timing", "strong-match"),
    ("strawberry", "strong-match"),
    ("草莓", "strong-match"),
    ("草莓值得买吗", "strong-match"),
    ("blueberry", "strong-match"),
    ("ancient fruit", "strong-match"),
    ("ancient seeds", "strong-match"),
    ("greenhouse ancient fruit", "strong-match"),
    ("seed maker ancient fruit", "strong-match"),
    ("volcano dungeon", "strong-match"),
    ("ginger island", "strong-match"),
    ("willy boat repair", "strong-match"),
    ("golden walnut", "strong-match"),
    ("island farm", "strong-match"),
    ("chicken coop", "strong-match"),
    ("养鸡赚钱吗", "strong-match"),
    ("cow milk cheese", "strong-match"),
    ("pig truffle oil", "strong-match"),
    ("hops pale ale keg", "strong-match"),
    ("movie theater unlock", "strong-match"),
    ("willy boat repair materials", "strong-match"),
    ("温室怎么开", "strong-match"),
    ("Qi quest", "strong-match"),
    ("catfish", "strong-match"),
    ("sturgeon", "strong-match"),
    ("fish pond", "strong-match"),
    ("farmhouse upgrade", "strong-match"),
    ("hello", "knowledge-disabled"),
    ("thanks", "knowledge-disabled"),
    ("who are you", "knowledge-disabled"),
    ("best wife", "knowledge-disabled"),
]


TOP_ID_CASES = [
    ("buy strawberry seeds", "plan-egg-festival-strawberry"),
    ("egg festival strawberry", "plan-egg-festival-strawberry"),
    ("strawberry", "crop-strawberry"),
    ("Qi quest", "quest-mr-qi-special-orders"),
    ("catfish", "fish-catfish"),
    ("sturgeon", "fish-sturgeon"),
    ("fish pond", "plan-fish-pond"),
    ("farmhouse upgrade", "plan-farmhouse-upgrade"),
]


def main() -> int:
    failures = []
    counts: dict[str, int] = {}

    print("Retrieval calibration report")
    print("=" * 72)

    for question, expected in CASES:
        diagnostics = diagnose_retrieval(question)
        actual = diagnostics["message"]
        counts[actual] = counts.get(actual, 0) + 1
        matches = retrieve(question)
        first = matches[0].id if matches else "-"
        top_score = diagnostics["top_score"]
        status = "OK" if actual == expected else "FAIL"
        print(
            f"{status:4} | {actual:18} | expected={expected:18} | "
            f"score={top_score:4.1f} | first={first:28} | {question}"
        )
        if actual != expected:
            failures.append((question, expected, actual))

    print("-" * 72)
    print("Counts:", ", ".join(f"{key}={value}" for key, value in sorted(counts.items())))

    top_id_failures = []
    print("\nTop-id calibration")
    print("=" * 72)
    for question, expected_id in TOP_ID_CASES:
        matches = retrieve(question)
        actual_id = matches[0].id if matches else "-"
        status = "OK" if actual_id == expected_id else "FAIL"
        print(f"{status:4} | first={actual_id:32} | expected={expected_id:32} | {question}")
        if actual_id != expected_id:
            top_id_failures.append((question, expected_id, actual_id))

    if top_id_failures:
        print("\nTop-id failures:")
        for question, expected_id, actual_id in top_id_failures:
            print(f"- {question}: expected first {expected_id}, got {actual_id}")
        return 1

    if failures:
        print("\nFailures:")
        for question, expected, actual in failures:
            print(f"- {question}: expected {expected}, got {actual}")
        return 1

    sample_answer = build_answer("养鸡赚钱吗", retrieve("养鸡赚钱吗"), diagnose_retrieval("养鸡赚钱吗"))
    for heading in ("结论：", "理由：", "下一步："):
        if heading not in sample_answer:
            print(f"\nFailure: answer template missing {heading}")
            return 1

    print("\nAll retrieval calibration checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
