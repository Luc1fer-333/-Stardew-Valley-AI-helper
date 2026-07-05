from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
USABLE_MATCH_SCORE = 3
STRONG_MATCH_SCORE = 10
GENERIC_SEARCH_TERMS = {
    "怎么",
    "么做",
    "什么",
    "咋办",
    "么办",
    "任务",
    "路线",
    "计划",
    "攻略",
    "作物",
    "礼物",
    "值得",
    "多少",
    "最划",
    "划算",
    "买",
    "种",
    "做",
    "用",
    "quest",
    "plan",
    "route",
    "crop",
    "gift",
    "best",
    "how",
    "what",
}

TYPE_LABELS = {
    "crop": "crop",
    "gift": "gift",
    "quest": "quest",
    "plan": "plan",
}

SEASON_LABELS = {
    "spring": "spring",
    "summer": "summer",
    "fall": "fall",
    "winter": "winter",
    "all": "all",
}

RESPONSE_TEXT = {
    "weak_match": "这题只命中了部分资料，我会先按现有知识库保守回答。",
    "greeting": "你好，我是你的星露谷小助手。你可以问我作物、礼物、社区中心、工具升级、矿洞、钓鱼、赚钱和路线规划。",
    "thanks": "不客气，祝你的农场今天也顺顺利利。",
    "identity": "我是一个基于 Markdown 知识库的《星露谷物语》小助手，会优先根据已有资料回答，也会标记资料缺口。",
    "outside_scope": "这个问题看起来不太像《星露谷物语》资料问题。可以试试问作物、礼物、社区中心、工具、矿洞、钓鱼、赚钱或路线规划。",
    "missing": "这部分资料库还不够完整，我不会硬拿不相关资料回答你。\n\n当前诊断：类型={intent}，最高命中分={top_score:.1f}。可以先加入 backlog，之后再生成 Markdown 草稿补资料。",
    "fallback": "资料库暂时没有足够可靠的答案。",
}

@dataclass(frozen=True)
class Entry:
    id: str
    type: str
    title: str
    season: str
    aliases: list[str]
    summary: str
    tips: list[str]
    source: str
    source_url: str
    version: str
    updated: str
    confidence: str

    def to_source(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "title": self.title,
            "season": self.season,
            "summary": self.summary,
            "source": self.source,
            "source_url": self.source_url,
            "version": self.version,
            "updated": self.updated,
            "confidence": self.confidence,
        }


def load_entries(data_dir: Path = DATA_DIR) -> list[Entry]:
    entries: list[Entry] = []
    for file_path in sorted(data_dir.glob("*.md")):
        if file_path.name == "backlog.md":
            continue
        entries.extend(_parse_markdown_file(file_path))
    return entries


def retrieve(question: str, limit: int = 10) -> list[Entry]:
    if not should_use_knowledge(question):
        return []

    entries = load_entries()
    scored = [
        (score_entry(entry, question), entry)
        for entry in entries
    ]
    ranked = sorted(scored, key=lambda item: item[0], reverse=True)
    matches = [entry for score, entry in ranked if score > 0]

    if matches and score_entry(matches[0], question) >= USABLE_MATCH_SCORE:
        return _expand_matches(question, matches, entries, limit)

    return []


def diagnose_retrieval(question: str, limit: int = 8) -> dict:
    entries = load_entries()
    use_knowledge = should_use_knowledge(question)
    intent = infer_intent(question)
    scored = sorted(
        [
            {
                "score": score_entry(entry, question),
                "entry": entry,
                "reasons": explain_score(entry, question),
            }
            for entry in entries
        ],
        key=lambda item: item["score"],
        reverse=True,
    )
    visible_scored = [item for item in scored if item["score"] > 0][:limit]
    candidates = [
        {
            "id": item["entry"].id,
            "title": item["entry"].title,
            "type": item["entry"].type,
            "season": item["entry"].season,
            "score": item["score"],
            "reasons": item["reasons"],
        }
        for item in visible_scored
    ]
    top_score = scored[0]["score"] if scored else 0

    return {
        "enabled": use_knowledge,
        "intent": intent,
        "threshold": USABLE_MATCH_SCORE,
        "strong_threshold": STRONG_MATCH_SCORE,
        "top_score": top_score,
        "candidate_count": sum(1 for item in scored if item["score"] > 0),
        "message": _diagnostic_message(use_knowledge, intent, top_score),
        "candidates": candidates,
        "backlog_suggestion": build_backlog_suggestion(question, intent),
    }


def explain_score(entry: Entry, query: str) -> list[str]:
    normalized_query = normalize(query)
    intent = infer_intent(query)
    reasons: list[str] = []

    if entry.type == intent:
        reasons.append(f"intent:{intent}")

    if not normalized_query:
        return reasons

    haystack = normalize(
        " ".join(
            [
                entry.title,
                entry.type,
                entry.season,
                TYPE_LABELS.get(entry.type, ""),
                SEASON_LABELS.get(entry.season, ""),
                entry.summary,
                entry.source,
                *entry.aliases,
                *entry.tips,
            ]
        )
    )

    for alias in entry.aliases:
        normalized_alias = normalize(alias)
        if (
            normalized_alias
            and not is_generic_search_term(normalized_alias)
            and normalized_alias in normalized_query
        ):
            reasons.append(f"alias:{alias}")

    seen_tokens: set[str] = set()
    for token in tokenize(normalized_query):
        if is_generic_search_term(token):
            continue
        if token in seen_tokens or token not in haystack:
            continue
        seen_tokens.add(token)
        reasons.append(f"token:{token}")
        if len(seen_tokens) >= 8:
            break

    return reasons or ["no strong signal"]


def _diagnostic_message(use_knowledge: bool, intent: str, top_score: float) -> str:
    if not use_knowledge:
        return "knowledge-disabled"
    if top_score >= STRONG_MATCH_SCORE:
        return "strong-match"
    if top_score >= USABLE_MATCH_SCORE:
        return "weak-match"
    return "missing-knowledge"


def build_backlog_suggestion(question: str, intent: str) -> dict:
    normalized = normalize(question)
    guessed_intent = intent or _guess_backlog_intent(normalized)
    file_by_intent = {
        "crop": "data/crops.md",
        "gift": "data/gifts.md",
        "quest": "data/quests.md",
        "plan": "data/plans.md",
    }
    topic = re.sub(r"\s+", " ", str(question)).strip() or "Untitled question"

    return {
        "suggested_file": file_by_intent.get(guessed_intent, "data/plans.md"),
        "intent": guessed_intent or "plan",
        "source_hint": _source_hint_for(topic),
        "topic": topic[:80],
    }


def _guess_backlog_intent(normalized: str) -> str:
    if re.search(r"gift|love|like|birthday|npc|villager", normalized, re.I):
        return "gift"
    if re.search(r"bundle|quest|center|room|unlock", normalized, re.I):
        return "quest"
    if re.search(r"crop|seed|fruit|vegetable|bean|melon|berry", normalized, re.I):
        return "crop"
    return "plan"


def _source_hint_for(topic: str) -> str:
    page = re.sub(r"[^a-zA-Z0-9 ]+", " ", topic).strip()
    page = re.sub(r"\s+", " ", page).title()
    return f"Stardew Valley Wiki: {page}" if page else "Stardew Valley Wiki"


def build_answer(question: str, matches: list[Entry], diagnostics: dict | None = None) -> str:
    if not matches:
        if diagnostics and diagnostics.get("enabled"):
            return make_missing_knowledge_answer(question, diagnostics)
        return make_general_answer(question)

    top = matches[0]
    lines: list[str] = []
    if diagnostics and diagnostics.get("message") == "weak-match":
        lines.extend([
            RESPONSE_TEXT["weak_match"],
            "",
        ])

    lines.extend([
        f"结论：{_answer_conclusion(top)}",
        "",
        "理由：",
        f"- {top.summary}",
    ])

    for tip in top.tips[:2]:
        lines.append(f"- {tip}")

    decision_notes = _question_decision_notes(question, top, matches)
    if decision_notes:
        lines.extend(["", "针对你的问法："])
        for note in decision_notes:
            lines.append(f"- {note}")

    next_steps = _answer_next_steps(top, matches)
    if next_steps:
        lines.extend(["", "下一步："])
        for step in next_steps:
            lines.append(f"- {step}")

    return "\n".join(lines)


def _answer_conclusion(entry: Entry) -> str:
    if entry.type == "crop":
        return f"{entry.title} 可以纳入种植计划，但要看季节、资金和是否需要留样。"
    if entry.type == "gift":
        return f"{entry.title} 这类送礼问题可以按高好感礼物优先，先选容易稳定获得的物品。"
    if entry.type == "quest":
        return f"{entry.title} 建议提前规划材料，别等到需要提交时才回头找。"
    return f"{entry.title} 可以作为当前路线参考，优先做成本低、能推进长期目标的部分。"


def _answer_next_steps(entry: Entry, matches: list[Entry]) -> list[str]:
    steps = list(entry.tips[2:4])

    if not steps:
        if entry.type == "crop":
            steps.append("先确认当前季节和剩余天数，再决定种多少。")
        elif entry.type == "gift":
            steps.append("先准备一两个容易获得的喜欢礼物，生日再送高价值礼物。")
        elif entry.type == "quest":
            steps.append("把需要提交的物品先各留一份，避免卖掉后返工。")
        else:
            steps.append("先完成最便宜、最能打开后续路线的一步。")

    if len(matches) > 1:
        steps.append(f"可以顺手看看：{matches[1].title}。")

    return steps[:3]


def _question_decision_notes(question: str, entry: Entry, matches: list[Entry]) -> list[str]:
    normalized = normalize(question)
    explicit_question = normalized.split("玩家状态", 1)[0]
    context = normalize(" ".join([entry.id, entry.title, *(match.id for match in matches[:3])]))
    notes: list[str] = []

    if _asks_amount(explicit_question):
        if "strawberry" in context or "草莓" in context:
            if "预算紧" in normalized:
                notes.append("你现在是预算紧档位，草莓先买一小片更稳；优先别牺牲背包、工具和后续种子预算。")
            if "手浇" in normalized:
                notes.append("你现在是手浇档位，草莓数量要按每天浇水压力来控，别让后半个春天都被浇水吃掉。")
            if "有洒水器" in normalized:
                notes.append("你已经有洒水器时，可以比手浇档更积极扩草莓，因为每天省下来的时间能继续钓鱼、下矿和送礼。")
            notes.extend([
                "第一年蛋节买草莓时，优先按“每天浇得动”来定数量；手浇新手可以先控制在 20-40 粒左右，资金紧张就先 10-20 粒。",
                "如果你已经有较多体力、洒水器或明确想冲收益，可以再加量；但不要把所有钱都压进草莓，背包、工具和后续种子也要留预算。",
            ])
        elif entry.type == "crop":
            notes.append("种多少先看剩余天数、浇水压力和现金流；不确定时先小片试种，等收益和体力稳定后再扩大。")
        elif "silo" in context or "筒仓" in context:
            notes.append("筒仓通常先建 1 个就够开动物路线；等动物变多、冬天前干草压力变大，再考虑继续补。")
        elif "stable" in context or "马厩" in context:
            notes.append("马厩不需要多建，重点是确认硬木和铁锭不会挤占更急的工具、背包、鸡舍或洒水器预算。")

    if _asks_no_sprinkler(explicit_question):
        notes.append("没有洒水器时，核心不是不能种，而是别种到每天浇水把钓鱼、下矿和送礼时间吃光；先保守扩张会更舒服。")
        if "strawberry" in context or "草莓" in context:
            notes.append("草莓没有洒水器也可以买，但建议买能稳定浇完的一片，别为了收益把整个春天后半段都变成浇水模拟器。")

    if _asks_budget(explicit_question):
        notes.append("预算紧张时先保留一部分现金给种子、背包、工具或关键建筑；高收益路线也要避免一次性把现金流压空。")
        if "strawberry" in context or "草莓" in context:
            notes.append("如果蛋节前钱不多，少买草莓也没关系；土豆、防风草、钓鱼和矿洞资源照样能把第一年春天接起来。")

    if _asks_timing(explicit_question):
        if "strawberry" in context or "egg-festival" in context:
            notes.append("草莓种子第一年通常在春 13 蛋节买，买完回家立刻种下；如果要极限收益，第二年春 1 提前种会更强。")
        elif "silo" in context or "筒仓" in context:
            notes.append("筒仓最好放在鸡舍或牛棚前面建，这样割草时能顺手存干草，不会冬天才发现饲料不够。")
        elif "stable" in context or "马厩" in context:
            notes.append("马厩适合中期建：当你每天跑图明显浪费时间，并且硬木不再卡关键升级时，就很值得。")

    if _asks_materials(explicit_question):
        if "sprinkler" in context or "洒水器" in context:
            notes.append("优质洒水器路线重点留铁锭、金锭和精炼石英；精炼石英可以用石英烧，也可以通过回收垃圾慢慢攒。")
        elif "skull" in context or "骷髅" in context:
            notes.append("骷髅洞穴准备优先看食物、炸弹、楼梯和回家手段；材料不够时先在普通矿洞和农场经济里补资源。")

    return _unique_notes(notes)[:3]


def _asks_amount(normalized: str) -> bool:
    return bool(re.search(r"买多少|种多少|几个|多少个|how many|amount|数量", normalized, re.I))


def _asks_no_sprinkler(normalized: str) -> bool:
    return bool(re.search(r"没有洒水器|没洒水器|无洒水器|手浇|no sprinkler|without sprinkler", normalized, re.I))


def _asks_budget(normalized: str) -> bool:
    return bool(re.search(r"预算|钱不够|没钱|缺钱|budget|poor|not enough money", normalized, re.I))


def _asks_timing(normalized: str) -> bool:
    return bool(re.search(r"什么时候|哪天|几号|时机|when|timing", normalized, re.I))


def _asks_materials(normalized: str) -> bool:
    return bool(re.search(r"材料|需要什么|怎么准备|material|materials|prepare", normalized, re.I))


def _unique_notes(notes: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for note in notes:
        if note in seen:
            continue
        seen.add(note)
        unique.append(note)
    return unique

def score_entry(entry: Entry, query: str) -> float:
    normalized_query = normalize(query)
    intent = infer_intent(query)
    haystack = normalize(
        " ".join(
            [
                entry.title,
                entry.type,
                entry.season,
                TYPE_LABELS.get(entry.type, ""),
                SEASON_LABELS.get(entry.season, ""),
                entry.summary,
                entry.source,
                *entry.aliases,
                *entry.tips,
            ]
        )
    )

    score = 0.0
    meaningful_hit = False
    if entry.type == intent:
        score += 5

    if not normalized_query:
        return score

    title_normalized = normalize(entry.title)
    if len(normalized_query) >= 8 and normalized_query in title_normalized:
        score += 20
        meaningful_hit = True
    for token in tokenize(normalized_query):
        if (
            not is_generic_search_term(token)
            and len(token) >= 3
            and token in title_normalized
        ):
            score += 8
            meaningful_hit = True

    for alias in entry.aliases:
        normalized_alias = normalize(alias)
        if not normalized_alias or is_generic_search_term(normalized_alias):
            continue
        if normalized_alias in normalized_query:
            score += 8
            meaningful_hit = True
            if normalized_alias in title_normalized:
                score += 12
            if re.fullmatch(r"[a-z0-9 -]{3,}", normalized_alias):
                score += 10
            if len(normalized_alias) >= 8:
                score += min(20, len(normalized_alias))

    for token in tokenize(normalized_query):
        if is_generic_search_term(token):
            continue
        if token in haystack:
            score += 2
            meaningful_hit = True

    return score if meaningful_hit else 0.0


def is_generic_search_term(term: str) -> bool:
    normalized = normalize(term)
    if re.fullmatch(r"[\u4e00-\u9fff]", normalized):
        return True
    return normalized in GENERIC_SEARCH_TERMS


def _expand_matches(
    question: str,
    matches: list[Entry],
    entries: list[Entry],
    limit: int,
) -> list[Entry]:
    expanded: list[Entry] = []
    seen: set[str] = set()

    def add(entry: Entry) -> None:
        if entry.id in seen or len(expanded) >= limit:
            return
        seen.add(entry.id)
        expanded.append(entry)

    for entry in matches:
        add(entry)

    intent = infer_intent(question) or (matches[0].type if matches else "")
    if intent:
        for entry in entries:
            if entry.type == intent:
                add(entry)

    for related_type in _related_types(intent):
        for entry in entries:
            if entry.type == related_type:
                add(entry)

    return expanded[:limit]


def _related_types(intent: str) -> list[str]:
    if intent == "gift":
        return ["plan", "crop"]
    if intent == "quest":
        return ["crop", "plan"]
    if intent == "crop":
        return ["quest", "plan"]
    if intent == "plan":
        return ["crop", "quest", "gift"]
    return ["plan", "crop", "quest", "gift"]


def infer_intent(query: str) -> str:
    normalized = normalize(query)
    if re.search(r"\b(gift|gifts|love|like|birthday)\b|礼物|喜欢|好感|生日", normalized, re.I):
        return "gift"
    if re.search(r"\b(bundle|quest|community center|pantry|boiler room|fish tank|movie theater|cinema|missing bundle|willy boat|boat repair)\b|任务|社区中心|温室|电影院|修船|姜岛", normalized, re.I):
        return "quest"
    if re.search(r"\b(money|profit|plan|route|tool|upgrade|mine|mines|fishing|sprinkler|animal|animals|chicken|coop|barn|cow|duck|rabbit|pig|truffle|keg|hops|pale ale)\b|赚钱|规划|路线|工具|升级|钓鱼|矿洞|洒水器|动物|畜牧|鸡|鸡舍|牛棚|奶牛|鸭|兔|猪|松露|小桶|酒桶|啤酒花|淡啤酒", normalized, re.I):
        return "plan"
    if re.search(r"\b(crop|crops|seed|seeds|fruit)\b|作物|种子|水果", normalized, re.I):
        return "crop"
    if re.search(r"绀肩墿|鍠滄|閫亅濂芥劅|鐢熸棩|杩絴gift|love|like", normalized, re.I):
        return "gift"
    if re.search(r"绀惧尯|浠诲姟|浣滅墿鍖厊鑼舵按闂磡娓╁|bundle|quest|涓績", normalized, re.I):
        return "quest"
    if re.search(r"璧氶挶|鏀剁泭|缂洪挶|閽变笉澶焲money|profit", normalized, re.I):
        return "plan"
    if re.search(r"绉峾浣滅墿|鏄澶弢绉媩鍐瑋crop", normalized, re.I):
        return "crop"
    if re.search(r"浠婂ぉ|闆ㄥぉ|涓嬮洦|鐭縷宸ュ叿|姘村６|璁″垝|璺嚎|鍋氫粈涔坾plan|mine", normalized, re.I):
        return "plan"
    return ""


def is_greeting(query: str) -> bool:
    normalized = normalize(query)
    return bool(re.fullmatch(r"(hello|hi|hey|你好|嗨)[!！。?？\s]*", normalized, re.I))


def is_thanks(query: str) -> bool:
    normalized = normalize(query)
    return bool(re.search(r"谢谢|感谢|thanks|thank you", normalized, re.I))


def is_identity_question(query: str) -> bool:
    normalized = normalize(query)
    return bool(re.search(r"你是谁|你能做什么|介绍一下你|what can you do|who are you", normalized, re.I))


def should_use_knowledge(query: str) -> bool:
    normalized = normalize(query)
    if not normalized:
        return False
    if is_greeting(normalized) or is_thanks(normalized) or is_identity_question(normalized):
        return False
    if infer_intent(normalized):
        return True
    if re.search(
        r"seed|seeds|fruit|greenhouse|ginger island|island farm|willy boat|boat repair|golden walnut|walnut|volcano|dungeon|starfruit|ancient fruit|winter seeds|tool upgrade|upgrade tools|watering can|pickaxe|blacksmith|quality sprinkler|sprinkler|fishing|mines elevator",
        normalized,
        re.I,
    ):
        return True
    if _has_direct_knowledge_match(normalized):
        return True
    return bool(
        re.search(
            r"星露谷|stardew|stardew valley|农场|村民|npc|社区中心|温室|作物|礼物|矿洞|钓鱼|姜岛|joja|鹈鹕镇|皮埃尔|罗宾|玛妮|法师|fish tank|sprinkler|skull cavern|vault|bundle|pantry|boiler room|crafts room|bulletin board|fishing|mines|farm|villager",
            normalized,
            re.I,
        )
    )


def _has_direct_knowledge_match(query: str) -> bool:
    return any(score_entry(entry, query) >= USABLE_MATCH_SCORE for entry in load_entries())


def make_general_answer(question: str) -> str:
    if is_greeting(question):
        return RESPONSE_TEXT["greeting"]
    if is_thanks(question):
        return RESPONSE_TEXT["thanks"]
    if is_identity_question(question):
        return RESPONSE_TEXT["identity"]
    return RESPONSE_TEXT["outside_scope"]


def make_missing_knowledge_answer(question: str, diagnostics: dict) -> str:
    intent = diagnostics.get("intent") or "unknown"
    top_score = diagnostics.get("top_score") or 0
    return RESPONSE_TEXT["missing"].format(intent=intent, top_score=top_score)


def make_fallback_answer(question: str) -> str:
    intent = infer_intent(question)
    if intent:
        return f"这看起来像 {intent} 类问题，但当前资料还没有足够强的命中。"
    return RESPONSE_TEXT["fallback"]

def normalize(text: str) -> str:
    return str(text).strip().lower()


def tokenize(text: str) -> list[str]:
    normalized = normalize(text)
    words = re.findall(r"[a-z0-9]+", normalized)
    chinese = [char for char in normalized if "\u4e00" <= char <= "\u9fff"]
    bigrams = [
        chinese[index] + chinese[index + 1]
        for index in range(len(chinese) - 1)
    ]
    return [*words, *chinese, *bigrams]


def _parse_markdown_file(file_path: Path) -> list[Entry]:
    text = file_path.read_text(encoding="utf8").replace("\r\n", "\n")
    lines = text.split("\n")
    entries: list[Entry] = []
    index = 0

    while index < len(lines):
        heading = re.match(r"^##\s+(.+)$", lines[index])
        if not heading:
            index += 1
            continue

        title = heading.group(1).strip()
        meta, index = _parse_frontmatter(lines, index + 1)
        body: list[str] = []

        while index < len(lines) and not lines[index].startswith("## "):
            body.append(lines[index])
            index += 1

        summary_lines: list[str] = []
        tips: list[str] = []
        in_tips = False
        for raw_line in body:
            line = raw_line.strip()
            if not line:
                continue
            if line == "tips:":
                in_tips = True
                continue
            if in_tips and line.startswith("- "):
                tips.append(line[2:].strip())
                continue
            if not in_tips:
                summary_lines.append(line)

        entries.append(
            Entry(
                id=meta.get("id") or re.sub(r"\s+", "-", title.lower()),
                type=meta.get("type") or "plan",
                title=title,
                season=meta.get("season") or "all",
                aliases=[
                    alias.strip()
                    for alias in re.split(r"[,，、；;锛屻€侊紱\ufffd]+", meta.get("aliases") or "")
                    if alias.strip()
                ],
                summary=" ".join(summary_lines),
                tips=tips,
                source=meta.get("source") or "",
                source_url=meta.get("source_url") or "",
                version=meta.get("version") or "1.6",
                updated=meta.get("updated") or "",
                confidence=meta.get("confidence") or "medium",
            )
        )

    return entries


def _parse_frontmatter(lines: list[str], index: int) -> tuple[dict[str, str], int]:
    meta: dict[str, str] = {}
    if index >= len(lines) or lines[index] != "---":
        return meta, index

    index += 1
    while index < len(lines) and lines[index] != "---":
        key, separator, value = lines[index].partition(":")
        if separator:
            meta[key.strip()] = value.strip()
        index += 1

    return meta, index + 1




