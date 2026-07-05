const knowledgeBase = window.STARDEW_KNOWLEDGE || [];
const API_BASE = window.STARDEW_API_BASE
  || (location.protocol.startsWith("http") ? "http://localhost:8000" : "");
const USABLE_MATCH_SCORE = 3;
const STRONG_MATCH_SCORE = 10;
const GENERIC_SEARCH_TERMS = new Set([
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
]);

const uiText = {
  types: {
    crop: "作物",
    gift: "礼物",
    quest: "任务",
    plan: "路线",
  },
  seasons: {
    spring: "春",
    summer: "夏",
    fall: "秋",
    winter: "冬",
    all: "全年",
  },
  confidence: {
    high: "可信度高",
    medium: "待复核",
    low: "草稿",
  },
  weakMatch: "这题只命中了部分资料，我会先按现有知识库保守回答。",
  missingKnowledge: (intent, topScore) =>
    `这部分资料库还不够完整，我不会硬拿不相关资料回答你。\n\n当前诊断：类型=${intent}，最高命中分=${topScore}。可以先加入 backlog，之后再生成 Markdown 草稿补资料。`,
  fallback: "资料库暂时没有足够可靠的答案。",
  greeting: "你好，我是你的星露谷小助手。你可以问我作物、礼物、社区中心、工具升级、矿洞、钓鱼、赚钱和路线规划。",
  thanks: "不客气，祝你的农场今天也顺顺利利。",
  identity: "我是一个基于 Markdown 知识库的《星露谷物语》小助手，会优先根据已有资料回答，也会标记资料缺口。",
  outsideScope: "这个问题看起来不太像《星露谷物语》资料问题。可以试试问作物、礼物、社区中心、工具、矿洞、钓鱼、赚钱或路线规划。",
  backendRequired: "需要后端在线才能写入 backlog",
  backlogWriteFailed: "backlog 写入失败",
  backlogAdded: "已加入 backlog",
  backlogExists: "backlog 里已经有这题",
  draftCreated: (count) => count ? `已生成 ${count} 条 Markdown 草稿` : "没有待生成草稿",
  draftWriteFailed: "草稿生成失败",
  llmFallback: "LLM 暂不可用，已使用模板回答",
  chatCleared: "对话已清空",
  chatClearedMessage: "对话清空啦。现在想查作物、礼物、任务，还是路线规划？",
  answerCopied: "回答已复制",
  copyFailed: "复制失败，可以手动选中文字",
  noteSaved: "已加入路线便签",
  noteDeleted: "便签已删除",
  notesCleared: "路线便签已清空",
  notesCopied: "路线便签已复制",
  localEntries: (count) => `${count} 条本地资料`,
  apiConnected: (entries, mode) => `API 已连接 · ${entries} 条资料 · ${mode}`,
  waitForAnswer: "先等这一条回答完",
  switchedMode: (label) => `已切换到：${label}`,
  switchedSeason: (label) => `季节：${label}`,
  switchedContext: (label) => `状态：${label}`,
};

const typeLabels = uiText.types;
const seasonLabels = uiText.seasons;
const confidenceLabels = uiText.confidence;

let activeMode = "all";
let activeSeason = "spring";
let chatHistory = [];
let isBusy = false;
let backendAvailable = false;
let lastDiagnostics = null;
let lastQuestion = "";
let lastSources = [];
let playerContext = {
  stage: "第一年",
  budget: "预算紧",
  watering: "手浇",
};
let activePreset = "rookie-spring";
const ROUTE_NOTES_KEY = "stardew-helper-route-notes";

const chatLog = document.querySelector("#chatLog");
const chatForm = document.querySelector("#chatForm");
const questionInput = document.querySelector("#questionInput");
const knowledgeList = document.querySelector("#knowledgeList");
const resultCount = document.querySelector("#resultCount");
const sendButton = document.querySelector("#sendButton");
const toast = document.querySelector("#toast");
const statusText = document.querySelector("#statusText");
const entryMetric = document.querySelector("#entryMetric");
const modeMetric = document.querySelector("#modeMetric");
const suggestionsPanel = document.querySelector(".suggestions");
const diagnosticsPanel = document.querySelector("#diagnosticsPanel");
const maintenancePanel = document.querySelector("#maintenancePanel");
const sideTabButtons = document.querySelectorAll("[data-side-tab]");
const sideTabPanels = document.querySelectorAll("[data-tab-panel]");
const playerContextPanel = document.querySelector(".player-context");
const seasonButtons = document.querySelectorAll(".season-chip");
const modeButtons = document.querySelectorAll(".mode-button");
const presetTitle = document.querySelector("#presetTitle");
const presetGoal = document.querySelector("#presetGoal");
const presetRhythm = document.querySelector("#presetRhythm");

let thinkingNode = null;

function normalize(text) {
  return String(text).trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inferIntent(query) {
  const q = normalize(query);
  if (/\b(bundle|quest|community center|pantry|boiler room|fish tank|movie theater|cinema|missing bundle|willy boat|boat repair)\b|任务|社区中心|温室|电影院|修船|姜岛/i.test(q)) return "quest";
  if (/\b(money|profit|plan|route|tool|upgrade|mine|mines|fishing|sprinkler|animal|animals|chicken|coop|barn|cow|duck|rabbit|pig|truffle|keg|hops|pale ale)\b|赚钱|规划|路线|工具|升级|钓鱼|矿洞|洒水器|动物|畜牧|鸡|鸡舍|牛棚|奶牛|鸭|兔|猪|松露|小桶|酒桶|啤酒花|淡啤酒/i.test(q)) return "plan";
  if (/\b(crop|crops|seed|seeds|fruit)\b|作物|种子|水果/i.test(q)) return "crop";
  if (/(绀肩墿|鍠滄|閫亅濂芥劅|鐢熸棩|杩絴gift|love|like)/i.test(q)) return "gift";
  if (/(绀惧尯|浠诲姟|浣滅墿鍖厊鑼舵按闂磡娓╁|bundle|quest|涓績)/i.test(q)) return "quest";
  if (/(璧氶挶|鏀剁泭|缂洪挶|閽变笉澶焲money|profit)/i.test(q)) return "plan";
  if (/(绉峾浣滅墿|鏄澶弢绉媩鍐瑋crop)/i.test(q)) return "crop";
  if (/(浠婂ぉ|闆ㄥぉ|涓嬮洦|鐭縷宸ュ叿|姘村６|璁″垝|璺嚎|鍋氫粈涔坾plan|mine)/i.test(q)) return "plan";
  return "";
}

function isGreeting(query) {
  const q = normalize(query);
  return /^(hello|hi|hey|你好|嗨)[!！。?？\s]*$/i.test(q);
}

function isThanks(query) {
  return /(谢谢|感谢|thanks|thank you)/i.test(normalize(query));
}

function isIdentityQuestion(query) {
  return /(你是谁|你能做什么|介绍一下你|what can you do|who are you)/i.test(normalize(query));
}
function shouldUseKnowledge(query) {
  const q = normalize(query);
  if (!q) return false;
  if (isGreeting(q) || isThanks(q) || isIdentityQuestion(q)) return false;
  if (inferIntent(q)) return true;
  if (/seed|seeds|fruit|greenhouse|ginger island|island farm|willy boat|boat repair|golden walnut|walnut|volcano|dungeon|starfruit|ancient fruit|winter seeds|tool upgrade|upgrade tools|watering can|pickaxe|blacksmith|quality sprinkler|sprinkler|fishing|mines elevator|movie theater|cinema|missing bundle|animal|animals|chicken|coop|barn|cow|duck|rabbit|pig|truffle|egg|milk|cheese|mayonnaise|keg|hops|pale ale/i.test(q)) return true;
  if (hasDirectKnowledgeMatch(q)) return true;
  return /(星露谷|stardew|stardew valley|农场|村民|npc|社区中心|温室|作物|礼物|矿洞|钓鱼|姜岛|joja|鹈鹕镇|皮埃尔|罗宾|玛妮|法师|fish tank|sprinkler|skull cavern|vault|bundle|pantry|boiler room|crafts room|bulletin board|fishing|mines|farm|villager)/i.test(q);
}

function hasDirectKnowledgeMatch(query) {
  return knowledgeBase.some((entry) => scoreEntry(entry, query) >= USABLE_MATCH_SCORE);
}

function isGenericSearchTerm(term) {
  const normalized = normalize(term);
  if (/^[\u4e00-\u9fff]$/.test(normalized)) return true;
  return GENERIC_SEARCH_TERMS.has(normalized);
}

function scoreEntry(entry, query, options = {}) {
  const q = normalize(query);
  const intent = inferIntent(query);
  const haystack = normalize([
    entry.title,
    entry.type,
    entry.season,
    typeLabels[entry.type],
    seasonLabels[entry.season],
    entry.summary,
    entry.source,
    ...entry.aliases,
    ...entry.tips,
  ].join(" "));

  let score = 0;
  let meaningfulHit = false;
  if (entry.type === intent) score += 5;
  if (entry.type === activeMode) score += options.useActiveFilters ? 2 : 0.5;
  if (entry.season === activeSeason || entry.season === "all") {
    score += options.useActiveFilters ? 1 : 0.25;
  }
  if (!q) return score;

  const titleNormalized = normalize(entry.title || "");
  if (q.length >= 8 && titleNormalized.includes(q)) {
    score += 20;
    meaningfulHit = true;
  }
  for (const token of tokenize(q)) {
    if (!isGenericSearchTerm(token) && token.length >= 3 && titleNormalized.includes(token)) {
      score += 8;
      meaningfulHit = true;
    }
  }

  for (const alias of entry.aliases) {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias || isGenericSearchTerm(normalizedAlias)) continue;
    if (q.includes(normalizedAlias)) {
      score += 8;
      meaningfulHit = true;
      if (titleNormalized.includes(normalizedAlias)) score += 12;
      if (/^[a-z0-9 -]+$/.test(normalizedAlias) && normalizedAlias.length >= 3) {
        score += 10;
      }
      if (normalizedAlias.length >= 8) {
        score += Math.min(20, normalizedAlias.length);
      }
    }
  }

  for (const token of tokenize(q)) {
    if (isGenericSearchTerm(token)) continue;
    if (haystack.includes(token)) {
      score += 2;
      meaningfulHit = true;
    }
  }

  return meaningfulHit ? score : 0;
}

function tokenize(text) {
  const normalized = normalize(text);
  const words = normalized.match(/[a-z0-9]+/g) || [];
  const chinese = Array.from(normalized).filter((char) => /[\u4e00-\u9fff]/.test(char));
  const bigrams = [];
  for (let i = 0; i < chinese.length - 1; i += 1) {
    bigrams.push(chinese[i] + chinese[i + 1]);
  }
  return [...words, ...chinese, ...bigrams].filter(Boolean);
}

function retrieve(query, limit = 10) {
  if (!shouldUseKnowledge(query)) return [];

  const ranked = knowledgeBase
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length && ranked[0].score >= USABLE_MATCH_SCORE) {
    return expandMatches(query, ranked.map(({ entry }) => entry), limit);
  }

  return [];
}

function expandMatches(query, matches, limit) {
  const expanded = [];
  const seen = new Set();
  const add = (entry) => {
    if (seen.has(entry.id) || expanded.length >= limit) return;
    seen.add(entry.id);
    expanded.push(entry);
  };

  matches.forEach(add);

  const intent = inferIntent(query) || matches[0]?.type || "";
  if (intent) {
    knowledgeBase
      .filter((entry) => entry.type === intent)
      .forEach(add);
  }

  relatedTypes(intent).forEach((type) => {
    knowledgeBase
      .filter((entry) => entry.type === type)
      .forEach(add);
  });

  return expanded.slice(0, limit);
}

function relatedTypes(intent) {
  if (intent === "gift") return ["plan", "crop"];
  if (intent === "quest") return ["crop", "plan"];
  if (intent === "crop") return ["quest", "plan"];
  if (intent === "plan") return ["crop", "quest", "gift"];
  return ["plan", "crop", "quest", "gift"];
}

function defaultEntries() {
  return knowledgeBase.filter((entry) => {
    const modeOk = activeMode === "all" || entry.type === activeMode;
    const seasonOk = entry.season === "all" || entry.season === activeSeason;
    return modeOk && seasonOk;
  });
}

const suggestionCatalog = {
  all: {
    spring: ["第一年春天怎么规划？", "草莓值得买吗？", "养鸡赚钱吗？", "温室怎么开？"],
    summer: ["夏天怎么赚钱？", "蓝莓和甜瓜哪个好？", "啤酒花怎么赚钱？", "工具什么时候升级？"],
    fall: ["秋天种南瓜还是蔓越莓？", "秋季作物包要留什么？", "猪和松露赚钱吗？", "电影院怎么开？"],
    winter: ["冬天做什么？", "夜市买什么？", "鱼缸有哪些卡关鱼？", "温室种什么最好？"],
  },
  crop: {
    spring: ["草莓值得买吗？", "春天第一周怎么种？", "花椰菜要留吗？", "金星防风草怎么准备？"],
    summer: ["蓝莓和甜瓜哪个好？", "啤酒花怎么赚钱？", "杨桃什么时候种？", "夏季作物包要留什么？"],
    fall: ["南瓜值得大面积种吗？", "蔓越莓赚钱吗？", "秋季作物包要留什么？", "远古水果适合温室吗？"],
    winter: ["冬季种子值得种吗？", "冬天做什么？", "温室种什么最好？", "远古种子怎么处理？"],
  },
  gift: {
    spring: ["Penny 喜欢什么？", "Sebastian 喜欢什么？", "Shane 喜欢什么？", "谁适合前期送礼？"],
    summer: ["Haley 喜欢什么？", "Maru 喜欢什么？", "Shane 喜欢辣椒吗？", "夏天送礼怎么安排？"],
    fall: ["Leah 喜欢什么？", "Robin 喜欢什么？", "Abigail 喜欢什么？", "生日送礼怎么准备？"],
    winter: ["Wizard 喜欢什么？", "Krobus 喜欢什么？", "冬天适合刷谁好感？", "通用礼物有哪些？"],
  },
  quest: {
    spring: ["温室怎么开？", "春季作物包要留什么？", "工艺室先交什么？", "社区中心先做哪个房间？"],
    summer: ["夏季作物包要留什么？", "锅炉房怎么做？", "鱼缸怎么做？", "巴士怎么解锁？"],
    fall: ["秋季作物包要留什么？", "高品质作物包怎么准备？", "公告板难点是什么？", "电影院怎么开？"],
    winter: ["温室还差什么？", "姜岛怎么开？", "威利修船要什么材料？", "遗失的收集包是什么？"],
  },
  plan: {
    spring: ["第一年春天怎么规划？", "养鸡赚钱吗？", "雨天做什么？", "什么时候升级水壶？"],
    summer: ["夏天怎么赚钱？", "啤酒花怎么赚钱？", "洒水器什么时候做？", "矿洞怎么推进？"],
    fall: ["猪和松露赚钱吗？", "南瓜还是蔓越莓？", "加工品怎么赚钱？", "沙漠怎么准备？"],
    winter: ["冬天做什么？", "骷髅洞穴怎么准备？", "筒仓什么时候建？", "马厩值不值得建？"],
  },
};

const contextPresets = {
  "rookie-spring": {
    label: "新手春天",
    goal: "先稳住春季现金流，别让浇水和预算压垮节奏。",
    rhythm: "先问草莓和春季赚钱，再看雨天、筒仓和工具。",
    mode: "all",
    season: "spring",
    context: {
      stage: "第一年",
      budget: "预算紧",
      watering: "手浇",
    },
    suggestions: ["草莓买多少？", "第一年春天怎么赚钱？", "雨天做什么？", "筒仓什么时候建？"],
  },
  "greenhouse-rush": {
    label: "冲温室",
    goal: "围绕社区中心留样，把温室需要的作物和动物产品提前排好。",
    rhythm: "先查茶水间和高品质作物包，再补秋季、冬季和动物路线。",
    mode: "quest",
    season: "fall",
    context: {
      stage: "第一年",
      budget: "预算够",
      watering: "有洒水器",
    },
    suggestions: ["温室怎么开？", "高品质作物包怎么准备？", "秋季作物包要留什么？", "冬天怎么冲温室？"],
  },
  "midgame-money": {
    label: "中期赚钱",
    goal: "把时间从手动农活里解放出来，转向加工品、动物和温室收益。",
    rhythm: "先问啤酒花、小桶和动物，再规划温室与长期现金流。",
    mode: "plan",
    season: "summer",
    context: {
      stage: "中期",
      budget: "预算够",
      watering: "有洒水器",
    },
    suggestions: ["啤酒花怎么赚钱？", "猪和松露赚钱吗？", "小桶怎么做？", "温室种什么最好？"],
  },
};

function currentSuggestionPool() {
  if (activePreset && contextPresets[activePreset]?.suggestions) {
    return contextPresets[activePreset].suggestions;
  }
  const modePool = suggestionCatalog[activeMode] || suggestionCatalog.all;
  return modePool[activeSeason] || modePool.spring || suggestionCatalog.all.spring;
}

function setSuggestions(questions) {
  if (!suggestionsPanel) return;
  suggestionsPanel.innerHTML = questions
    .slice(0, 4)
    .map((question) => `<button type="button" data-question="${escapeHtml(question)}">${escapeHtml(question)}</button>`)
    .join("");
}

function refreshSuggestions({ matches = [], diagnostics = null } = {}) {
  const followUps = buildFollowUps(matches, diagnostics);
  const pool = [...followUps, ...currentSuggestionPool()];
  const seen = new Set();
  const questions = pool.filter((question) => {
    const key = normalize(question);
    if (!key || key === normalize(lastQuestion) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  setSuggestions(questions.length ? questions : currentSuggestionPool());
}

function setActiveMode(mode) {
  activeMode = mode;
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
}

function setActiveSeason(season) {
  activeSeason = season;
  seasonButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.season === season);
  });
}

function setPlayerContext(nextContext) {
  playerContext = { ...playerContext, ...nextContext };
  if (!playerContextPanel) return;
  for (const [group, value] of Object.entries(playerContext)) {
    playerContextPanel
      .querySelectorAll(`button[data-context-group="${group}"]`)
      .forEach((button) => button.classList.toggle("active", button.dataset.contextValue === value));
  }
}

function setActivePreset(presetId) {
  activePreset = presetId;
  playerContextPanel
    ?.querySelectorAll("button[data-preset]")
    .forEach((button) => button.classList.toggle("active", button.dataset.preset === presetId));
  renderPresetSummary();
}

function clearActivePreset() {
  activePreset = "";
  playerContextPanel
    ?.querySelectorAll("button[data-preset]")
    .forEach((button) => button.classList.remove("active"));
  renderPresetSummary();
}

function renderPresetSummary() {
  if (!presetTitle || !presetGoal || !presetRhythm) return;

  const preset = activePreset ? contextPresets[activePreset] : null;
  if (preset) {
    presetTitle.textContent = preset.label;
    presetGoal.textContent = preset.goal;
    presetRhythm.textContent = preset.rhythm;
    return;
  }

  presetTitle.textContent = "自定义状态";
  presetGoal.textContent = `${seasonLabels[activeSeason] || activeSeason} · ${playerContext.stage} · ${playerContext.budget} · ${playerContext.watering}`;
  presetRhythm.textContent = "推荐问题会按当前分类、季节和上一轮问答动态调整。";
}

function applyContextPreset(presetId) {
  const preset = contextPresets[presetId];
  if (!preset) return;

  setActivePreset(presetId);
  setActiveMode(preset.mode);
  setActiveSeason(preset.season);
  setPlayerContext(preset.context);
  renderKnowledge(defaultEntries());
  refreshSuggestions({ matches: lastSources, diagnostics: lastDiagnostics });
  if (diagnosticsPanel) diagnosticsPanel.hidden = true;
  showToast(uiText.switchedContext(preset.label));
}

function renderKnowledge(entries) {
  const list = entries.length ? entries : defaultEntries();
  resultCount.textContent = String(list.length);
  knowledgeList.innerHTML = list
    .map((entry) => {
      const sourceUrl = entry.source_url || "";
      const confidence = confidenceLabels[entry.confidence] || entry.confidence || "";
      const sourceLabel = entry.source || "来源";
      const metaItems = [
        `<span>${seasonLabels[entry.season]}</span>`,
        entry.version ? `<span>v${entry.version}</span>` : "",
        entry.updated ? `<span>更新 ${entry.updated}</span>` : "",
        confidence ? `<span>${confidence}</span>` : "",
        sourceUrl
          ? `<a class="source-link" href="${sourceUrl}" target="_blank" rel="noreferrer">${sourceLabel}</a>`
          : `<span>${sourceLabel}</span>`,
      ].filter(Boolean);

      return `
        <article class="knowledge-card ${entry === list[0] ? "primary" : ""} confidence-${escapeHtml(entry.confidence || "unknown")}" data-entry-id="${escapeHtml(entry.id || "")}">
          <header>
            <strong>${entry.title}</strong>
            <span class="tag">${typeLabels[entry.type]}</span>
          </header>
          <p>${entry.summary}</p>
          <div class="meta-line">${metaItems.join("")}</div>
        </article>
      `;
    })
    .join("");
}

function buildLocalMaintenanceSummary() {
  const confidence = countBy(knowledgeBase, "confidence");
  const types = countBy(knowledgeBase, "type");
  const lowConfidence = knowledgeBase
    .filter((entry) => entry.confidence === "low")
    .slice(0, 8)
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      type: entry.type,
      source: entry.source,
      updated: entry.updated,
    }));

  return {
    entries: knowledgeBase.length,
    types,
    confidence,
    backlog: {
      total: 0,
      status: {},
      recent: [],
    },
    low_confidence: lowConfidence,
    recommendations: lowConfidence.length
      ? [`还有 ${lowConfidence.length} 条低可信草稿需要复核。`]
      : ["API 离线时无法读取 backlog 状态。"],
  };
}

function countBy(items, field) {
  return items.reduce((counts, item) => {
    const value = item[field] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function renderMaintenance(summary) {
  if (!maintenancePanel || !summary) return;

  const confidence = summary.confidence || {};
  const backlogStatus = summary.backlog?.status || {};
  const lowConfidence = summary.low_confidence || [];
  const recentBacklog = summary.backlog?.recent || [];
  const recommendations = summary.recommendations || [];
  const routeNotes = loadRouteNotes();

  maintenancePanel.innerHTML = `
    <div class="maintenance-header">
      <div>
        <p class="eyebrow">Maintenance</p>
        <h3>知识库维护</h3>
      </div>
      <span>${summary.entries || 0}</span>
    </div>
    <div class="maintenance-stats">
      ${maintenanceStat("高", confidence.high || 0)}
      ${maintenanceStat("中", confidence.medium || 0)}
      ${maintenanceStat("低", confidence.low || 0)}
      ${maintenanceStat("待补", backlogStatus.todo || 0)}
      ${maintenanceStat("草稿", backlogStatus.drafted || 0)}
    </div>
    <div class="maintenance-section">
      <strong>下一步建议</strong>
      ${recommendations.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
    </div>
    <div class="maintenance-section">
      <div class="maintenance-section-title">
        <strong>路线便签</strong>
        ${routeNotes.length ? `
          <div class="route-note-actions">
            <button type="button" data-action="copy-notes">复制</button>
            <button type="button" data-action="clear-notes">清空</button>
          </div>
        ` : ""}
      </div>
      ${routeNotes.length
        ? routeNotes.map(routeNoteItem).join("")
        : "<p>暂无便签。可以在回答下方点“加入便签”。</p>"}
    </div>
    <div class="maintenance-section">
      <strong>低可信草稿</strong>
      ${lowConfidence.length
        ? lowConfidence.map((item) => maintenanceItem(item.title, `${item.type} 路 ${item.id}`)).join("")
        : "<p>暂无低可信草稿。</p>"}
    </div>
    <div class="maintenance-section">
      <strong>最近 backlog</strong>
      ${recentBacklog.length
        ? recentBacklog.map((item) => maintenanceItem(item.question, `${item.status} 路 ${item.suggested_file || item.draft_file || "no file"}`)).join("")
        : "<p>暂无 backlog 条目。</p>"}
    </div>
  `;
}

function maintenanceStat(label, value) {
  return `
    <div class="maintenance-stat">
      <b>${value}</b>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function maintenanceItem(title, meta) {
  return `
    <div class="maintenance-item">
      <span>${escapeHtml(title || "Untitled")}</span>
      <em>${escapeHtml(meta || "")}</em>
    </div>
  `;
}

function routeNoteItem(item) {
  return `
    <div class="maintenance-item route-note" data-note-id="${escapeHtml(item.id || "")}">
      <div>
        <span>${escapeHtml(item.question || "当前回答")}</span>
        <em>${escapeHtml(item.preview || "")}</em>
      </div>
      <button type="button" data-action="delete-note" data-note-id="${escapeHtml(item.id || "")}" aria-label="删除便签">×</button>
    </div>
  `;
}

function loadRouteNotes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROUTE_NOTES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function saveRouteNotes(notes) {
  localStorage.setItem(ROUTE_NOTES_KEY, JSON.stringify(notes.slice(0, 6)));
}

function addRouteNote(question, answer) {
  const cleanedQuestion = String(question || "当前回答").trim();
  const preview = String(answer || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  const note = {
    id: `${Date.now()}`,
    question: cleanedQuestion,
    preview: preview || "已保存一条路线建议。",
  };
  const existing = loadRouteNotes().filter((item) => item.question !== note.question);
  saveRouteNotes([note, ...existing]);
}

function formatRouteNotes(notes) {
  return notes
    .map((item, index) => `${index + 1}. ${item.question || "当前回答"}\n${item.preview || ""}`)
    .join("\n\n");
}

async function copyRouteNotes() {
  const notes = loadRouteNotes();
  if (!notes.length) return;
  try {
    await navigator.clipboard.writeText(formatRouteNotes(notes));
    showToast(uiText.notesCopied);
  } catch {
    showToast(uiText.copyFailed);
  }
}

function deleteRouteNote(noteId) {
  if (!noteId) return;
  saveRouteNotes(loadRouteNotes().filter((item) => item.id !== noteId));
  loadMaintenance();
  showToast(uiText.noteDeleted);
}

function clearRouteNotes() {
  saveRouteNotes([]);
  loadMaintenance();
  showToast(uiText.notesCleared);
}

async function loadMaintenance() {
  if (!API_BASE) {
    renderMaintenance(buildLocalMaintenanceSummary());
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/maintenance`);
    if (!response.ok) throw new Error("maintenance unavailable");
    renderMaintenance(await response.json());
  } catch {
    renderMaintenance(buildLocalMaintenanceSummary());
  }
}

function diagnoseLocalRetrieval(question, matches) {
  const candidates = knowledgeBase
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      type: entry.type,
      season: entry.season,
      score: scoreEntry(entry, question),
      reasons: explainLocalScore(entry, question),
    }))
    .sort((a, b) => b.score - a.score)
    .filter((entry) => entry.score > 0)
    .slice(0, 8);
  const topScore = candidates[0]?.score || 0;

  return {
    enabled: shouldUseKnowledge(question),
    intent: inferIntent(question),
    threshold: USABLE_MATCH_SCORE,
    strong_threshold: STRONG_MATCH_SCORE,
    top_score: topScore,
    candidate_count: matches.filter(Boolean).length,
    message: !shouldUseKnowledge(question)
      ? "knowledge-disabled"
      : topScore >= STRONG_MATCH_SCORE
        ? "strong-match"
        : topScore >= USABLE_MATCH_SCORE
          ? "weak-match"
          : "missing-knowledge",
    candidates,
    backlog_suggestion: buildLocalBacklogSuggestion(question),
  };
}

function buildLocalBacklogSuggestion(question) {
  const intent = inferIntent(question) || guessBacklogIntent(question);
  const files = {
    crop: "data/crops.md",
    gift: "data/gifts.md",
    quest: "data/quests.md",
    plan: "data/plans.md",
  };
  const topic = String(question).trim() || "Untitled question";
  const sourceTopic = topic
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return {
    intent,
    suggested_file: files[intent] || "data/plans.md",
    source_hint: sourceTopic ? `Stardew Valley Wiki: ${sourceTopic}` : "Stardew Valley Wiki",
    topic,
  };
}

function guessBacklogIntent(question) {
  const q = normalize(question);
  if (/gift|love|like|birthday|npc|villager/i.test(q)) return "gift";
  if (/bundle|quest|center|room|unlock/i.test(q)) return "quest";
  if (/crop|seed|fruit|vegetable|bean|melon|berry/i.test(q)) return "crop";
  return "plan";
}

function explainLocalScore(entry, question) {
  const q = normalize(question);
  const intent = inferIntent(question);
  const reasons = [];

  if (entry.type === intent) reasons.push(`intent:${intent}`);

  for (const alias of entry.aliases || []) {
    const normalizedAlias = normalize(alias);
    if (normalizedAlias && !isGenericSearchTerm(normalizedAlias) && q.includes(normalizedAlias)) {
      reasons.push(`alias:${alias}`);
    }
  }

  const haystack = normalize([
    entry.title,
    entry.type,
    entry.season,
    typeLabels[entry.type],
    seasonLabels[entry.season],
    entry.summary,
    entry.source,
    ...(entry.aliases || []),
    ...(entry.tips || []),
  ].join(" "));

  const seen = new Set();
  for (const token of tokenize(q)) {
    if (isGenericSearchTerm(token)) continue;
    if (seen.has(token) || !haystack.includes(token)) continue;
    seen.add(token);
    reasons.push(`token:${token}`);
    if (seen.size >= 8) break;
  }

  return reasons.length ? reasons : ["no strong signal"];
}

function renderDiagnostics(diagnostics, question = "") {
  if (!diagnosticsPanel || !diagnostics) return;

  const candidates = diagnostics.candidates || [];
  const visibleCandidates = candidates.slice(0, 5);
  const suggestion = diagnostics.backlog_suggestion || {};
  const showBacklog = diagnostics.message === "missing-knowledge";
  diagnosticsPanel.hidden = false;
  diagnosticsPanel.innerHTML = `
    <div class="diagnostics-header">
      <strong>检索诊断</strong>
      <span>${escapeHtml(diagnostics.message || "unknown")}</span>
    </div>
    <div class="diagnostics-stats">
      <span>intent: ${escapeHtml(diagnostics.intent || "none")}</span>
      <span>top: ${Number(diagnostics.top_score || 0).toFixed(1)}</span>
      <span>hits: ${diagnostics.candidate_count || 0}</span>
      <span>usable: ${diagnostics.threshold}</span>
      <span>strong: ${diagnostics.strong_threshold || STRONG_MATCH_SCORE}</span>
    </div>
    <div class="diagnostics-list">
      ${visibleCandidates.map((item) => `
        <div class="diagnostic-row">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.type)} 路 ${escapeHtml(item.season)}</span>
          </div>
          <b>${Number(item.score || 0).toFixed(1)}</b>
          <p>${(item.reasons || []).map(escapeHtml).join(" / ")}</p>
        </div>
      `).join("")}
    </div>
    ${showBacklog ? `
      <div class="backlog-suggestion">
        <strong>待补资料建议</strong>
        <p>问题：${escapeHtml(question)}</p>
        <p>建议文件：${escapeHtml(suggestion.suggested_file || "data/plans.md")}</p>
        <p>来源提示：${escapeHtml(suggestion.source_hint || "Stardew Valley Wiki")}</p>
        <button type="button" class="backlog-button" data-action="add-backlog">加入 backlog</button>
        <button type="button" class="backlog-button" data-action="promote-backlog">生成 Markdown 草稿</button>
      </div>
    ` : ""}
  `;
}

function addMessage(role, content, options = {}) {
  chatHistory.push({ role, content });
  const node = document.createElement("div");
  node.className = `message ${role}`;
  if (options.question) node.dataset.question = options.question;
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = content;
  node.appendChild(body);

  if (role === "assistant") {
    renderAssistantExtras(node, options);
  }

  chatLog.appendChild(node);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderAssistantExtras(node, { sources = [], diagnostics = null } = {}) {
  const usableSources = sources.filter(Boolean).slice(0, 3);
  const followUps = buildFollowUps(usableSources, diagnostics);

  const extras = document.createElement("div");
  extras.className = "assistant-extras";

  if (diagnostics) {
    extras.appendChild(renderAnswerStatus(diagnostics, sources));
  }

  const actions = document.createElement("div");
  actions.className = "assistant-actions";
  actions.innerHTML = `
    <button type="button" data-action="copy-answer">复制回答</button>
    <button type="button" data-action="save-note">加入便签</button>
    ${diagnostics ? '<button type="button" data-action="show-diagnostics">查看诊断</button>' : ""}
    ${diagnostics?.message === "missing-knowledge" ? '<button type="button" data-action="add-backlog">加入待补</button><button type="button" data-action="promote-backlog">生成草稿</button>' : ""}
  `;
  extras.appendChild(actions);

  if (usableSources.length) {
    const sourceList = document.createElement("div");
    sourceList.className = "assistant-sources";
    const label = document.createElement("span");
    label.textContent = "参考资料";
    sourceList.appendChild(label);

    usableSources.forEach((source, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.sourceId = source.id || "";
      button.textContent = `${index + 1}. ${source.title}`;
      sourceList.appendChild(button);
    });

    extras.appendChild(sourceList);
  }

  if (followUps.length) {
    const followList = document.createElement("div");
    followList.className = "assistant-followups";
    const label = document.createElement("span");
    label.textContent = "继续问";
    followList.appendChild(label);
    followUps.forEach((question) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.question = question;
      button.textContent = question;
      followList.appendChild(button);
    });
    extras.appendChild(followList);
  }

  node.appendChild(extras);
}

function renderAnswerStatus(diagnostics, sources = []) {
  const status = document.createElement("div");
  const message = diagnostics.message || "unknown";
  status.className = `answer-status ${message}`;

  const label = document.createElement("strong");
  label.textContent = answerStatusLabel(message);
  status.appendChild(label);

  const meta = document.createElement("span");
  const topScore = Number(diagnostics.top_score || 0).toFixed(1);
  const hitCount = sources.length || diagnostics.candidate_count || 0;
  meta.textContent = `命中 ${hitCount} 条 · 最高分 ${topScore}`;
  status.appendChild(meta);

  return status;
}

function answerStatusLabel(message) {
  if (message === "strong-match") return "资料命中可靠";
  if (message === "weak-match") return "资料部分命中";
  if (message === "missing-knowledge") return "资料待补";
  if (message === "knowledge-disabled") return "闲聊模式";
  return "检索完成";
}

async function copyAnswerFromMessage(messageNode) {
  const text = messageNode?.querySelector(".message-body")?.textContent || "";
  if (!text.trim()) return;

  try {
    await navigator.clipboard.writeText(text);
    showToast(uiText.answerCopied);
  } catch {
    showToast(uiText.copyFailed);
  }
}

function saveAnswerNoteFromMessage(messageNode) {
  const answer = messageNode?.querySelector(".message-body")?.textContent || "";
  const question = messageNode?.dataset.question || lastQuestion || "当前回答";
  if (!answer.trim()) return;

  addRouteNote(question, answer);
  loadMaintenance();
  switchSideTab("maintenance");
  showToast(uiText.noteSaved);
}

function buildFollowUps(sources, diagnostics = null) {
  if (!sources.length) {
    if (diagnostics?.message === "missing-knowledge") {
      return ["把这题加入待补资料库", "换个更具体的问法试试"];
    }
    return [];
  }

  const top = sources[0];
  const followUps = [...topicFollowUps(top)];
  if (!followUps.length) {
    if (top.type === "crop") followUps.push(`${top.title} 值得种吗？`, `${top.title} 要留给任务吗？`);
    if (top.type === "gift") followUps.push(`${top.title} 送礼要注意什么？`, "谁适合前期送礼？");
    if (top.type === "quest") followUps.push(`${top.title} 需要提前准备什么？`, "社区中心先做哪个房间？");
    if (top.type === "plan") followUps.push(`${top.title} 按天怎么做？`, "这条路线需要先准备什么？");
  }

  if (sources[1]) followUps.push(`${sources[1].title} 也讲讲`);
  return uniqueQuestions(followUps).slice(0, 3);
}

function topicFollowUps(entry) {
  const id = entry.id || "";
  const title = entry.title || "";
  const followUpsById = {
    "crop-strawberry": ["蛋节草莓怎么买最划算？", "草莓买多少合适？", "春天第一年怎么赚钱？"],
    "plan-egg-festival-strawberry": ["草莓买多少合适？", "没有洒水器还要买草莓吗？", "春天第一年怎么赚钱？"],
    "plan-winter-routine": ["冬季种子值得种吗？", "冬天应该下矿还是钓鱼？", "夜市买什么？"],
    "plan-winter-seeds-route": ["冬天做什么？", "冬季采集包要留什么？", "温室怎么开？"],
    "plan-stardew-valley-fair-tokens": ["展览会陈列放什么？", "星星币优先换什么？", "秋天南瓜还是蔓越莓？"],
    "plan-night-market-route": ["潜水艇钓鱼值得去吗？", "夜市买什么？", "冬天做什么？"],
    "plan-fish-tank-blockers": ["鲶鱼怎么钓？", "鲟鱼在哪里钓？", "鱼缸怎么做？"],
    "plan-skull-cavern-preparation": ["沙漠怎么解锁？", "炸弹和楼梯怎么准备？", "铱矿怎么刷？"],
    "plan-sprinkler-materials": ["优质洒水器什么时候做？", "精炼石英怎么获得？", "矿洞怎么推进？"],
    "plan-silo-timing": ["建鸡舍前要做什么？", "干草怎么存？", "养鸡赚钱吗？"],
    "plan-stable-timing": ["马厩值不值得早建？", "硬木怎么获得？", "中期优先建什么？"],
    "plan-chicken-coop": ["筒仓什么时候建？", "鸡蛋怎么赚钱？", "动物路线怎么开始？"],
    "plan-barn-milk": ["奶酪怎么赚钱？", "牛棚值不值得早建？", "动物路线怎么开始？"],
    "plan-pig-truffle": ["猪什么时候买？", "松露油怎么做？", "秋冬养猪要注意什么？"],
    "plan-hops-pale-ale": ["小桶怎么做？", "夏天怎么赚钱？", "啤酒花种多少合适？"],
    "quest-fish-tank": ["鱼缸有哪些卡关鱼？", "鲶鱼怎么钓？", "社区中心先做哪个房间？"],
    "quest-greenhouse-unlock-route": ["高品质作物包怎么准备？", "温室种什么最好？", "冬天怎么冲温室？"],
    "quest-willy-boat-repair": ["姜岛怎么开？", "铱锭怎么准备？", "火山地牢怎么打？"],
  };

  if (followUpsById[id]) return followUpsById[id];
  if (/草莓|strawberry/i.test(title)) return followUpsById["crop-strawberry"];
  if (/冬|winter/i.test(title)) return ["冬天做什么？", "冬季种子值得种吗？", "夜市买什么？"];
  if (/鱼缸|fish tank/i.test(title)) return followUpsById["plan-fish-tank-blockers"];
  if (/骷髅|skull/i.test(title)) return followUpsById["plan-skull-cavern-preparation"];
  if (/洒水器|sprinkler/i.test(title)) return followUpsById["plan-sprinkler-materials"];
  return [];
}

function uniqueQuestions(questions) {
  const seen = new Set();
  return questions.filter((question) => {
    const key = normalize(question);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function highlightKnowledgeCard(entryId) {
  if (!entryId) return;
  switchSideTab("knowledge");
  const card = [...knowledgeList.querySelectorAll("[data-entry-id]")]
    .find((item) => item.dataset.entryId === entryId);
  if (!card) return;
  knowledgeList.querySelectorAll(".knowledge-card.inspecting")
    .forEach((item) => item.classList.remove("inspecting"));
  card.classList.add("inspecting");
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  window.setTimeout(() => card.classList.remove("inspecting"), 1500);
}

function showThinking() {
  hideThinking();
  thinkingNode = document.createElement("div");
  thinkingNode.className = "message assistant thinking";
  thinkingNode.innerHTML = "<span></span><span></span><span></span>";
  chatLog.appendChild(thinkingNode);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function hideThinking() {
  if (!thinkingNode) return;
  thinkingNode.remove();
  thinkingNode = null;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 1300);
}

function pulseButton(button) {
  if (!button) return;
  button.classList.add("is-pressed");
  window.setTimeout(() => button.classList.remove("is-pressed"), 160);
}

function switchSideTab(tabName) {
  sideTabButtons.forEach((button) => {
    const isActive = button.dataset.sideTab === tabName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  sideTabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === tabName);
  });
}

function makeAnswer(question, matches, diagnostics = null) {
  if (!matches.length) {
    if (diagnostics?.enabled) return makeMissingKnowledgeAnswer(diagnostics);
    return makeGeneralAnswer(question);
  }

  const top = matches[0];
  const lines = [];
  if (diagnostics?.message === "weak-match") {
    lines.push(uiText.weakMatch);
    lines.push("");
  }

  lines.push(`结论：${answerConclusion(top)}`);
  lines.push("");
  lines.push("理由：");
  lines.push(`- ${top.summary}`);

  for (const tip of (top.tips || []).slice(0, 2)) {
    lines.push(`- ${tip}`);
  }

  const decisionNotes = questionDecisionNotes(question, top, matches);
  if (decisionNotes.length) {
    lines.push("");
    lines.push("针对你的问法：");
    decisionNotes.forEach((note) => lines.push(`- ${note}`));
  }

  const nextSteps = answerNextSteps(top, matches);
  if (nextSteps.length) {
    lines.push("");
    lines.push("下一步：");
    nextSteps.forEach((step) => lines.push(`- ${step}`));
  }

  return lines.join("\n");
}

function answerConclusion(entry) {
  if (entry.type === "crop") {
    return `${entry.title} 可以纳入种植计划，但要看季节、资金和是否需要留样。`;
  }
  if (entry.type === "gift") {
    return `${entry.title} 这类送礼问题可以按高好感礼物优先，先选容易稳定获得的物品。`;
  }
  if (entry.type === "quest") {
    return `${entry.title} 建议提前规划材料，别等到需要提交时才回头找。`;
  }
  return `${entry.title} 可以作为当前路线参考，优先做成本低、能推进长期目标的部分。`;
}

function answerNextSteps(entry, matches) {
  const tips = (entry.tips || []).slice(2, 4);
  const steps = tips.length ? [...tips] : [];

  if (!steps.length) {
    if (entry.type === "crop") steps.push("先确认当前季节和剩余天数，再决定种多少。");
    if (entry.type === "gift") steps.push("先准备一两个容易获得的喜欢礼物，生日再送高价值礼物。");
    if (entry.type === "quest") steps.push("把需要提交的物品先各留一份，避免卖掉后返工。");
    if (entry.type === "plan") steps.push("先完成最便宜、最能打开后续路线的一步。");
  }

  if (matches[1]) {
    steps.push(`可以顺手看看：${matches[1].title}。`);
  }

  return steps.slice(0, 3);
}

function questionDecisionNotes(question, entry, matches) {
  const q = normalize(question);
  const context = normalize([
    entry.id,
    entry.title,
    playerContextText(),
    ...matches.slice(0, 3).map((match) => match.id || ""),
  ].join(" "));
  const notes = [];

  if (asksAmount(q)) {
    if (context.includes("strawberry") || context.includes("草莓")) {
      if (context.includes("预算紧")) {
        notes.push("你现在是预算紧档位，草莓先买一小片更稳；优先别牺牲背包、工具和后续种子预算。");
      }
      if (context.includes("手浇")) {
        notes.push("你现在是手浇档位，草莓数量要按每天浇水压力来控，别让后半个春天都被浇水吃掉。");
      }
      if (context.includes("有洒水器")) {
        notes.push("你已经有洒水器时，可以比手浇档更积极扩草莓，因为每天省下来的时间能继续钓鱼、下矿和送礼。");
      }
      notes.push("第一年蛋节买草莓时，优先按“每天浇得动”来定数量；手浇新手可以先控制在 20-40 粒左右，资金紧张就先 10-20 粒。");
      notes.push("如果你已经有较多体力、洒水器或明确想冲收益，可以再加量；但不要把所有钱都压进草莓，背包、工具和后续种子也要留预算。");
    } else if (entry.type === "crop") {
      notes.push("种多少先看剩余天数、浇水压力和现金流；不确定时先小片试种，等收益和体力稳定后再扩大。");
    } else if (context.includes("silo") || context.includes("筒仓")) {
      notes.push("筒仓通常先建 1 个就够开动物路线；等动物变多、冬天前干草压力变大，再考虑继续补。");
    } else if (context.includes("stable") || context.includes("马厩")) {
      notes.push("马厩不需要多建，重点是确认硬木和铁锭不会挤占更急的工具、背包、鸡舍或洒水器预算。");
    }
  }

  if (asksNoSprinkler(q)) {
    notes.push("没有洒水器时，核心不是不能种，而是别种到每天浇水把钓鱼、下矿和送礼时间吃光；先保守扩张会更舒服。");
    if (context.includes("strawberry") || context.includes("草莓")) {
      notes.push("草莓没有洒水器也可以买，但建议买能稳定浇完的一片，别为了收益把整个春天后半段都变成浇水模拟器。");
    }
  }

  if (asksBudget(q)) {
    notes.push("预算紧张时先保留一部分现金给种子、背包、工具或关键建筑；高收益路线也要避免一次性把现金流压空。");
    if (context.includes("strawberry") || context.includes("草莓")) {
      notes.push("如果蛋节前钱不多，少买草莓也没关系；土豆、防风草、钓鱼和矿洞资源照样能把第一年春天接起来。");
    }
  }

  if (asksTiming(q)) {
    if (context.includes("strawberry") || context.includes("egg-festival")) {
      notes.push("草莓种子第一年通常在春 13 蛋节买，买完回家立刻种下；如果要极限收益，第二年春 1 提前种会更强。");
    } else if (context.includes("silo") || context.includes("筒仓")) {
      notes.push("筒仓最好放在鸡舍或牛棚前面建，这样割草时能顺手存干草，不会冬天才发现饲料不够。");
    } else if (context.includes("stable") || context.includes("马厩")) {
      notes.push("马厩适合中期建：当你每天跑图明显浪费时间，并且硬木不再卡关键升级时，就很值得。");
    }
  }

  if (asksMaterials(q)) {
    if (context.includes("sprinkler") || context.includes("洒水器")) {
      notes.push("优质洒水器路线重点留铁锭、金锭和精炼石英；精炼石英可以用石英烧，也可以通过回收垃圾慢慢攒。");
    } else if (context.includes("skull") || context.includes("骷髅")) {
      notes.push("骷髅洞穴准备优先看食物、炸弹、楼梯和回家手段；材料不够时先在普通矿洞和农场经济里补资源。");
    }
  }

  return uniqueQuestions(notes).slice(0, 3);
}

function asksAmount(q) {
  return /买多少|种多少|几个|多少个|how many|amount|数量/i.test(q);
}

function asksNoSprinkler(q) {
  return /没有洒水器|没洒水器|无洒水器|no sprinkler|without sprinkler/i.test(q);
}

function asksBudget(q) {
  return /预算|钱不够|没钱|缺钱|budget|poor|not enough money/i.test(q);
}

function asksTiming(q) {
  return /什么时候|哪天|几号|时机|when|timing/i.test(q);
}

function asksMaterials(q) {
  return /材料|需要什么|怎么准备|material|materials|prepare/i.test(q);
}

function makeFallbackAnswer(question) {
  const intent = inferIntent(question);
  if (intent) return `这看起来像 ${intent} 类问题，但当前资料还没有足够强的命中。`;
  return uiText.fallback;
}

function makeMissingKnowledgeAnswer(diagnostics) {
  const intent = diagnostics.intent || "unknown";
  const topScore = Number(diagnostics.top_score || 0).toFixed(1);
  return uiText.missingKnowledge(intent, topScore);
}

function makeGeneralAnswer(question) {
  if (isGreeting(question)) {
    return uiText.greeting;
  }
  if (isThanks(question)) {
    return uiText.thanks;
  }
  if (isIdentityQuestion(question)) {
    return uiText.identity;
  }
  return uiText.outsideScope;
}

function contextualizeQuestion(question) {
  const context = playerContextText();
  if (!shouldContextualizeQuestion(question)) {
    if (!shouldAttachPlayerContext(question)) return question;
    return context ? `${question} ${context}` : question;
  }

  const topicText = lastSources
    .slice(0, 3)
    .map((source) => [source.id, source.title, source.type].filter(Boolean).join(" "))
    .join(" ");
  return [question, context, topicText, lastQuestion ? `上一题 ${lastQuestion}` : ""]
    .filter(Boolean)
    .join(" ");
}

function shouldAttachPlayerContext(question) {
  if (!playerContextText()) return false;
  if (!shouldUseKnowledge(question)) return false;
  const directScore = maxKnowledgeScore(question);
  if (inferIntent(question) && directScore < STRONG_MATCH_SCORE) return false;
  if (directScore <= 0 && inferIntent(question)) return false;
  return true;
}

function playerContextText() {
  const values = [
    `当前季节 ${seasonLabels[activeSeason] || activeSeason}`,
    playerContext.stage,
    playerContext.budget,
    playerContext.watering,
  ].filter(Boolean);
  return values.length ? `玩家状态 ${values.join(" ")}` : "";
}

function shouldContextualizeQuestion(question) {
  const q = normalize(question);
  if (!q || !lastSources.length) return false;
  if (isGreeting(q) || isThanks(q) || isIdentityQuestion(q)) return false;
  const directScore = maxKnowledgeScore(q);
  if (directScore >= STRONG_MATCH_SCORE) return false;

  const compact = q.replace(/\s+/g, "");
  const looksShort = compact.length <= 18;
  const looksReferential = /^(那|这个|这个呢|它|他|她|没有|如果|要是|买多少|种多少|什么时候|怎么|需要|还要|可以|值不值|值得|预算|多少钱|how about|what about|then|and if)/i.test(q);
  const asksContinuation = /(呢|吗|咋办|怎么办|怎么做|买多少|种多少|没有|预算|洒水器|材料|值得|要不要|优先|下一步)/i.test(q);

  if (!looksReferential && inferIntent(q)) return false;
  if (directScore <= 0 && !looksReferential) return false;
  return looksShort && (looksReferential || asksContinuation);
}

function maxKnowledgeScore(query) {
  return knowledgeBase.reduce((max, entry) => Math.max(max, scoreEntry(entry, query)), 0);
}
async function askBackend(question, retrievalQuestion = question) {
  if (!API_BASE) return null;

  const history = chatHistory
    .slice(-8)
    .map(({ role, content }) => ({ role, content }));

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, retrieval_question: retrievalQuestion, history }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function addCurrentQuestionToBacklog(options = {}) {
  if (!API_BASE || !lastDiagnostics || !lastQuestion) {
    if (!options.quiet) showToast(uiText.backendRequired);
    return false;
  }

  const suggestion = lastDiagnostics.backlog_suggestion || {};
  try {
    const response = await fetch(`${API_BASE}/api/backlog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: lastQuestion,
        intent: suggestion.intent || lastDiagnostics.intent || "plan",
        suggested_file: suggestion.suggested_file || "data/plans.md",
        source_hint: suggestion.source_hint || "Stardew Valley Wiki",
      }),
    });
    if (!response.ok) {
      if (!options.quiet) showToast(uiText.backlogWriteFailed);
      return false;
    }
    const result = await response.json();
    if (!options.quiet) showToast(result.added ? uiText.backlogAdded : uiText.backlogExists);
    loadMaintenance();
    return true;
  } catch {
    if (!options.quiet) showToast(uiText.backlogWriteFailed);
    return false;
  }
}

async function promoteCurrentBacklogDraft() {
  if (!API_BASE) {
    showToast(uiText.backendRequired);
    return;
  }

  const ready = await addCurrentQuestionToBacklog({ quiet: true });
  if (!ready) return;

  try {
    const response = await fetch(`${API_BASE}/api/backlog/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      showToast(uiText.draftWriteFailed);
      return;
    }
    const result = await response.json();
    showToast(uiText.draftCreated(result.count || 0));
    loadMaintenance();
  } catch {
    showToast(uiText.draftWriteFailed);
  }
}

async function checkBackend() {
  if (!API_BASE) return;
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    if (!response.ok) return;
    const data = await response.json();
    backendAvailable = true;
    const mode = data.llm_enabled ? "LLM" : "模板";
    statusText.textContent = uiText.apiConnected(data.entries, mode);
    if (entryMetric) entryMetric.textContent = `${data.entries} 条`;
    if (modeMetric) modeMetric.textContent = `${mode}在线`;
  } catch {
    backendAvailable = false;
  }
}

async function ask(question) {
  if (isBusy) {
    showToast(uiText.waitForAnswer);
    return;
  }
  isBusy = true;
  sendButton.disabled = true;
  addMessage("user", question);
  showThinking();

  const retrievalQuestion = contextualizeQuestion(question);
  const backendResponse = await askBackend(question, retrievalQuestion);
  const matches = backendResponse?.sources?.length
    ? backendResponse.sources
    : retrieve(retrievalQuestion);
  const mode = backendResponse?.mode || "local";
  const diagnostics = backendResponse?.diagnostics || diagnoseLocalRetrieval(retrievalQuestion, matches);
  const answer = backendResponse?.answer || makeAnswer(question, matches, diagnostics);
  lastQuestion = question;
  lastDiagnostics = diagnostics;
  lastSources = matches;

  window.setTimeout(() => {
    hideThinking();
    renderKnowledge(matches);
    renderDiagnostics(diagnostics, question);
    addMessage("assistant", answer, { sources: matches, diagnostics, question });
    refreshSuggestions({ matches, diagnostics });
    if (mode === "template_fallback") {
      showToast(uiText.llmFallback);
    }
    isBusy = false;
    sendButton.disabled = false;
    questionInput.focus();
  }, 760);
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    pulseButton(button);
    clearActivePreset();
    setActiveMode(button.dataset.mode);
    renderKnowledge(defaultEntries());
    refreshSuggestions();
    if (diagnosticsPanel) diagnosticsPanel.hidden = true;
    showToast(uiText.switchedMode(button.textContent));
  });
});

seasonButtons.forEach((button) => {
  button.addEventListener("click", () => {
    pulseButton(button);
    clearActivePreset();
    setActiveSeason(button.dataset.season);
    renderKnowledge(defaultEntries());
    refreshSuggestions();
    if (diagnosticsPanel) diagnosticsPanel.hidden = true;
    showToast(uiText.switchedSeason(button.textContent));
  });
});

suggestionsPanel?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-question]");
  if (!button) return;
  button.classList.add("used");
  window.setTimeout(() => button.classList.remove("used"), 520);
  ask(button.dataset.question || button.textContent);
});

document.querySelectorAll(".info-card").forEach((card) => {
  card.addEventListener("click", () => {
    const question = card.dataset.question;
    if (!question) return;
    card.classList.add("is-pressed");
    window.setTimeout(() => card.classList.remove("is-pressed"), 160);
    ask(question);
  });
});

sideTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    pulseButton(button);
    switchSideTab(button.dataset.sideTab);
  });
});

playerContextPanel?.addEventListener("click", (event) => {
  const presetButton = event.target.closest("button[data-preset]");
  if (presetButton) {
    pulseButton(presetButton);
    applyContextPreset(presetButton.dataset.preset);
    return;
  }

  const button = event.target.closest("button[data-context-group]");
  if (!button) return;
  const group = button.dataset.contextGroup;
  const value = button.dataset.contextValue;
  if (!group || !value) return;

  clearActivePreset();
  playerContext[group] = value;
  playerContextPanel
    .querySelectorAll(`button[data-context-group="${group}"]`)
    .forEach((item) => item.classList.toggle("active", item === button));
  renderPresetSummary();
  pulseButton(button);
  refreshSuggestions({ matches: lastSources, diagnostics: lastDiagnostics });
  showToast(uiText.switchedContext(value));
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;
  pulseButton(sendButton);
  questionInput.value = "";
  ask(question);
});

diagnosticsPanel?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='add-backlog'], [data-action='promote-backlog']");
  if (!button) return;
  pulseButton(button);
  if (button.dataset.action === "promote-backlog") {
    promoteCurrentBacklogDraft();
    return;
  }
  addCurrentQuestionToBacklog();
});

maintenancePanel?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  pulseButton(button);
  if (action === "delete-note") {
    deleteRouteNote(button.dataset.noteId);
    return;
  }
  if (action === "clear-notes") {
    clearRouteNotes();
    return;
  }
  if (action === "copy-notes") {
    copyRouteNotes();
  }
});

chatLog.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    pulseButton(actionButton);
    const action = actionButton.dataset.action;
    if (action === "copy-answer") {
      copyAnswerFromMessage(actionButton.closest(".message"));
      return;
    }
    if (action === "save-note") {
      saveAnswerNoteFromMessage(actionButton.closest(".message"));
      return;
    }
    if (action === "show-diagnostics") {
      switchSideTab("diagnostics");
      return;
    }
    if (action === "add-backlog") {
      addCurrentQuestionToBacklog();
      return;
    }
    if (action === "promote-backlog") {
      promoteCurrentBacklogDraft();
      return;
    }
  }

  const sourceButton = event.target.closest("[data-source-id]");
  if (sourceButton) {
    pulseButton(sourceButton);
    highlightKnowledgeCard(sourceButton.dataset.sourceId);
    return;
  }

  const followButton = event.target.closest("[data-question]");
  if (!followButton) return;
  pulseButton(followButton);
  ask(followButton.dataset.question);
});

document.querySelector("#clearChat").addEventListener("click", () => {
  chatHistory = [];
  chatLog.innerHTML = "";
  hideThinking();
  if (diagnosticsPanel) diagnosticsPanel.hidden = true;
  lastQuestion = "";
  lastDiagnostics = null;
  lastSources = [];
  refreshSuggestions();
  showToast(uiText.chatCleared);
  addMessage("assistant", uiText.chatClearedMessage);
});

statusText.textContent = uiText.localEntries(knowledgeBase.length);
if (entryMetric) entryMetric.textContent = `${knowledgeBase.length} 条`;
if (modeMetric) modeMetric.textContent = "本地模板";
switchSideTab("knowledge");
renderKnowledge(defaultEntries());
refreshSuggestions();
loadMaintenance();
addMessage("assistant", uiText.greeting);
checkBackend();




