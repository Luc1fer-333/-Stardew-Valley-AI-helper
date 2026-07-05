from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .backlog import append_backlog_item
from .config import get_settings
from .knowledge import build_answer, diagnose_retrieval, load_entries, retrieve
from .llm import LLMError, chat_completion
from .maintenance import build_maintenance_summary
from .prompt import build_messages
from .promote import promote_backlog_items
from .schemas import (
    BacklogRequest,
    BacklogResponse,
    ChatRequest,
    ChatResponse,
    HealthResponse,
    PromoteBacklogResponse,
    SourceItem,
)


app = FastAPI(title="Stardew Helper API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "null",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        status="ok",
        entries=len(load_entries()),
        llm_enabled=settings.llm_enabled,
    )


@app.get("/api/maintenance")
def maintenance() -> dict:
    return build_maintenance_summary()


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    retrieval_question = request.retrieval_question or request.question
    diagnostics = diagnose_retrieval(retrieval_question)
    matches = retrieve(retrieval_question)
    settings = get_settings()
    mode = "template"
    answer = build_answer(retrieval_question, matches, diagnostics)

    if settings.llm_enabled and diagnostics.get("message") in {"strong-match", "weak-match"}:
        try:
            answer = chat_completion(
                settings,
                build_messages(retrieval_question, matches, request.history),
            )
            mode = "llm"
        except LLMError:
            mode = "template_fallback"

    if mode == "llm" and diagnostics.get("message") == "weak-match":
        answer = (
            "这题只命中了部分资料，我先按现有知识库给一个保守回答。\n\n"
            f"{answer}"
        )

    return ChatResponse(
        answer=answer,
        sources=[SourceItem(**entry.to_source()) for entry in matches],
        mode=mode,
        diagnostics=diagnostics,
    )


@app.post("/api/backlog", response_model=BacklogResponse)
def backlog(request: BacklogRequest) -> BacklogResponse:
    result = append_backlog_item(
        question=request.question,
        intent=request.intent,
        suggested_file=request.suggested_file,
        source_hint=request.source_hint,
    )
    return BacklogResponse(**result)


@app.post("/api/backlog/promote", response_model=PromoteBacklogResponse)
def promote_backlog() -> PromoteBacklogResponse:
    return PromoteBacklogResponse(**promote_backlog_items())
