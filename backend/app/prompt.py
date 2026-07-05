from __future__ import annotations

from .knowledge import Entry
from .schemas import ChatHistoryMessage


SYSTEM_PROMPT = """
你是一个《星露谷物语》游戏小助手，负责根据资料库回答作物、礼物、任务、社区中心、路线规划等问题。

规则：
- 默认用用户提问的语言回答。
- 回答要自然、简洁、像一个懂游戏的朋友。
- 事实内容必须优先依据 context entries。
- 不要暴露检索过程，不要说“我会先看”“根据命中的资料”“检索到”。
- 如果资料库没有明确内容，可以说“这部分资料库还不够全”，再给出基于已知资料的保守建议。
- 不要编造具体数值、NPC 喜好、任务条件或版本信息。
- 可以给行动建议，但要把不确定的地方说清楚。
""".strip()


def build_messages(
    question: str,
    entries: list[Entry],
    history: list[ChatHistoryMessage],
) -> list[dict[str, str]]:
    context = "\n\n".join(_format_entry(index, entry) for index, entry in enumerate(entries, start=1))
    history_lines = []
    for message in history[-8:]:
        role = "assistant" if message.role == "assistant" else "user"
        content = message.content.strip()
        if content:
            history_lines.append(f"{role}: {content[:800]}")

    user_message = (
        "Conversation history:\n"
        f"{chr(10).join(history_lines) or 'No prior conversation.'}\n\n"
        "Context entries:\n"
        f"{context or 'No context entries.'}\n\n"
        "Answer format:\n"
        "Use three short sections in Chinese when possible: 结论, 理由, 下一步. "
        "Give a practical recommendation first, then 2-3 grounded reasons, then 1-3 next actions.\n\n"
        "Question:\n"
        f"{question}"
    )

    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]


def _format_entry(index: int, entry: Entry) -> str:
    tips = "\n".join(f"- {tip}" for tip in entry.tips)
    return (
        f"[{index}] {entry.title}\n"
        f"type={entry.type}; season={entry.season}; source={entry.source}; "
        f"source_url={entry.source_url}; version={entry.version}; "
        f"updated={entry.updated}; confidence={entry.confidence}\n"
        f"summary: {entry.summary}\n"
        f"tips:\n{tips}"
    )
