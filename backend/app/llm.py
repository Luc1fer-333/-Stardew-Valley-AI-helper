from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import Settings


class LLMError(RuntimeError):
    pass


def chat_completion(settings: Settings, messages: list[dict[str, str]]) -> str:
    if not settings.llm_enabled:
        raise LLMError("LLM is not configured")

    url = settings.llm_base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 900,
    }
    request = Request(
        url,
        data=json.dumps(payload).encode("utf8"),
        headers={
            "Authorization": f"Bearer {settings.llm_api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=settings.llm_timeout) as response:
            data = json.loads(response.read().decode("utf8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise LLMError("LLM request failed") from exc

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError("Unexpected LLM response") from exc

    if not isinstance(content, str) or not content.strip():
        raise LLMError("Empty LLM response")

    return content.strip()
