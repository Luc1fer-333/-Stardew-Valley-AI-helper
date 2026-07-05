from pydantic import BaseModel, Field


class ChatHistoryMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    question: str
    retrieval_question: str = ""
    history: list[ChatHistoryMessage] = []


class SourceItem(BaseModel):
    id: str
    type: str
    title: str
    season: str
    summary: str
    source: str
    source_url: str = ""
    version: str = ""
    updated: str = ""
    confidence: str = ""


class DiagnosticCandidate(BaseModel):
    id: str
    title: str
    type: str
    season: str
    score: float
    reasons: list[str]


class RetrievalDiagnostics(BaseModel):
    enabled: bool
    intent: str = ""
    threshold: float
    strong_threshold: float = 10
    top_score: float
    candidate_count: int
    message: str
    candidates: list[DiagnosticCandidate]
    backlog_suggestion: dict | None = None


class ChatResponse(BaseModel):
    answer: str
    sources: list[SourceItem]
    mode: str
    diagnostics: RetrievalDiagnostics | None = None


class HealthResponse(BaseModel):
    status: str
    entries: int
    llm_enabled: bool


class BacklogRequest(BaseModel):
    question: str
    intent: str = ""
    suggested_file: str = ""
    source_hint: str = ""


class BacklogResponse(BaseModel):
    status: str
    added: bool
    path: str
    message: str


class PromotedDraft(BaseModel):
    question: str
    draft_file: str
    draft_id: str
    existed: bool = False


class PromoteBacklogResponse(BaseModel):
    promoted: list[PromotedDraft]
    count: int
    message: str
