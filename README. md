# 星露谷物语 AI 小助手

一个面向《星露谷物语》的游戏攻略小助手原型。它不是普通资料页，而是一个可以被自然语言提问的知识接口：可以问作物收益、村民礼物、社区中心、动物路线、工具升级、矿洞、姜岛、电影院等内容。

当前版本以 Markdown 知识库为核心，前端可本地检索，后端提供 FastAPI 聊天接口、诊断信息和 backlog 维护能力。即使没有 LLM API key，也能使用模板回答。

## 功能亮点

- 像素风农场界面，使用 Stardew Valley 官方截图作氛围背景。
- 支持作物、礼物、任务、路线四类资料筛选。
- 支持春夏秋冬季节筛选。
- Markdown 维护知识库，生成 `knowledge.generated.js` 给前端使用。
- FastAPI 后端读取同一份 Markdown 知识库。
- 回答采用攻略式结构：`结论 / 理由 / 下一步`。
- 回答下方展示参考资料、一键追问、复制回答、查看诊断。
- 资料不足时可以加入 backlog，后续补充 Markdown。
- 前端有本地 fallback；后端不启动时仍可做基础问答。

## 技术栈

- Frontend: HTML + CSS + Vanilla JavaScript
- Backend: FastAPI
- Knowledge Base: Markdown files in `data/`
- Build Scripts: Node.js + Python
- Optional LLM: OpenAI-compatible API, for example DeepSeek

## 本地运行

### 1. 启动前端

在项目根目录运行：

```bash
python -m http.server 4173 --bind 127.0.0.1
```

打开：

```text
http://127.0.0.1:4173
```

### 2. 启动后端

安装依赖：

```bash
python -m pip install -r backend/requirements.txt
```

启动 API：

```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

检查接口：

```text
GET http://127.0.0.1:8000/api/health
GET http://127.0.0.1:8000/api/maintenance
POST http://127.0.0.1:8000/api/chat
```

## 可选 LLM 配置

不配置 LLM 也可以使用，后端会用模板回答。

如需接入 OpenAI-compatible API，在环境中配置：

```text
LLM_API_KEY=your_api_key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
LLM_TIMEOUT=30
```

## 维护知识库

知识库源文件在：

```text
data/crops.md
data/gifts.md
data/quests.md
data/plans.md
data/high-frequency-plans.md
data/animals-and-unlocks.md
data/ancient-fruit.md
```

每条资料使用一个 `##` 标题和 frontmatter：

```markdown
## Chicken Coop 鸡舍与小鸡
---
id: plan-chicken-coop
type: plan
season: all
aliases: chicken, coop, 鸡, 小鸡, 鸡舍, 养鸡
source: Stardew Valley Wiki: Chicken
source_url: https://stardewvalleywiki.com/Chicken
version: 1.6
updated: 2026-07-04
confidence: high
---

养鸡是前期最容易理解的畜牧路线...

tips:
- 如果目标是社区中心，记得保留鸡蛋相关需求。
- 鸡需要每天有饲料或草。
```

修改 Markdown 后重新生成前端知识库：

```bash
node scripts/build-knowledge.js
```

## 测试与校准

前端语法检查：

```bash
node --check app.js
```

后端编译检查：

```bash
python -m compileall backend scripts
```

检索校准：

```bash
python scripts/test-retrieval.py
```

## 演示问题

可以用这些问题快速展示效果：

- 养鸡赚钱吗？
- 温室怎么开？
- Sebastian 喜欢什么？
- 啤酒花怎么赚钱？
- 姜岛怎么开？
- 电影院怎么开？
- 冬天应该做什么？
- 工具什么时候升级？

更多演示问题见 [docs/demo-questions.md](docs/demo-questions.md)。
完整演示和验收流程见 [docs/demo-script.md](docs/demo-script.md)。

## 目录结构

```text
.
├── index.html
├── styles.css
├── app.js
├── knowledge.generated.js
├── data/
├── scripts/
├── backend/
└── docs/
```

## 素材与资料来源

- Stardew Valley official press kit: screenshots and visual reference
- Stardew Valley Wiki: crops, villagers, bundles, animals, tools, fishing, Ginger Island, Movie Theater

本项目是学习和展示用原型。若公开部署，建议在页面或 README 中保留资料来源说明，并避免声称与官方有关联。
