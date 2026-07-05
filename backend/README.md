# Stardew Helper Backend

FastAPI backend for the Stardew Valley assistant.

The backend reads the same Markdown knowledge base used by the frontend, exposes chat and maintenance endpoints, and can optionally call an OpenAI-compatible LLM. Without LLM settings, it returns template-based guide answers.

## Install

From the project root:

```bash
python -m pip install -r backend/requirements.txt
```

## Run

From the project root:

```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

## Optional LLM Config

Set these environment variables if you want LLM answers:

```text
LLM_API_KEY=your_api_key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
LLM_TIMEOUT=30
```

If these are not set, `/api/chat` still works with the template fallback.

## Endpoints

```text
GET  /api/health
GET  /api/maintenance
POST /api/chat
POST /api/backlog
```

Example chat request:

```http
POST /api/chat
Content-Type: application/json

{
  "question": "养鸡赚钱吗？",
  "history": []
}
```

## Checks

From the project root:

```bash
python -m compileall backend scripts
python scripts/test-retrieval.py
```
