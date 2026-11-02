"""接口契约（JSON Schema）。前后端字段一旦改名或类型变化，契约测试会第一时间发现。"""

STEP = {
    "type": "object",
    "required": ["type", "content"],
    "properties": {
        "type": {"enum": ["ai_action", "ai_assert", "ai_query", "code", "api"]},
        "content": {"type": "string", "minLength": 1},
    },
}

CASE = {
    "type": "object",
    "required": ["id", "name", "description", "url", "steps", "createdAt", "updatedAt"],
    "properties": {
        "id": {"type": "integer", "minimum": 1},
        "name": {"type": "string", "minLength": 1},
        "description": {"type": "string"},
        "url": {"type": "string"},
        "steps": {"type": "array", "minItems": 1, "items": STEP},
        "createdAt": {"type": "string"},
        "updatedAt": {"type": "string"},
    },
}

RUN_STATUS = {"enum": ["queued", "running", "passed", "failed", "error", "skipped"]}
STEP_STATUS = {"enum": ["pending", "running", "passed", "healed", "failed", "skipped", "not_run"]}

RUN = {
    "type": "object",
    "required": ["id", "caseId", "caseName", "status", "durationMs", "passed", "failed", "skipped", "total",
                 "aiCalls", "tokens", "url", "steps"],
    "properties": {
        "id": {"type": "integer"},
        "status": RUN_STATUS,
        "durationMs": {"type": "integer", "minimum": 0},
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["index", "type", "content", "status", "durationMs", "aiCalls", "tokens"],
                "properties": {"status": STEP_STATUS, "screenshot": {"type": ["string", "null"]}},
            },
        },
    },
}

STATS = {
    "type": "object",
    "required": ["totalRuns", "passedRuns", "failedRuns", "passRate", "avgDurationMs", "aiCalls", "tokens", "daily"],
    "properties": {
        "passRate": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
        "daily": {"type": "array"},
    },
}

ERROR = {"type": "object", "required": ["error"], "properties": {"error": {"type": "string", "minLength": 1}}}

# —— 用例工坊 ——
PROPORTION = {
    "type": "object",
    "required": ["k", "n", "rate", "ci"],
    "properties": {
        "k": {"type": "integer", "minimum": 0},
        "n": {"type": "integer", "minimum": 0},
        "rate": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
        "ci": {"oneOf": [{"type": "null"}, {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "number", "minimum": 0, "maximum": 1}}]},
    },
}

REQ_POINT = {
    "type": "object",
    "required": ["id", "code", "title", "detail", "priority", "sourceExcerpt", "excerptFound", "status"],
    "properties": {
        "code": {"type": "string", "pattern": r"^REQ-\d{3,}$"},
        "priority": {"enum": ["P0", "P1", "P2"]},
        "excerptFound": {"type": "boolean"},
        "status": {"enum": ["active", "removed"]},
    },
}

DRAFT = {
    "type": "object",
    "required": ["id", "batchId", "name", "url", "steps", "pointIds", "confidence", "verdict", "discardReason", "final", "editStats", "caseId"],
    "properties": {
        "steps": {"type": "array", "minItems": 1, "items": STEP},
        "pointIds": {"type": "array", "items": {"type": "integer"}},
        "confidence": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
        "verdict": {"enum": ["pending", "accepted", "edited", "discarded"]},
        "discardReason": {"enum": [None, "duplicate", "out_of_scope", "not_executable", "vague_assert", "low_value", "other"]},
        "caseId": {"type": ["integer", "null"]},
    },
}

GEN_BATCH = {
    "type": "object",
    "required": ["id", "seq", "requirementId", "scope", "model", "promptVersion", "inputHash", "tokens", "stats", "drafts", "points"],
    "properties": {
        "promptVersion": {"type": "string", "pattern": r"^v\d+$"},
        "inputHash": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
        "stats": {
            "type": "object",
            "required": ["total", "reviewed", "accepted", "edited", "discarded", "adoption", "direct", "firstRun", "reasons", "newlyLinked"],
            "properties": {"adoption": PROPORTION, "direct": PROPORTION, "firstRun": PROPORTION},
        },
        "drafts": {"type": "array", "items": DRAFT},
        "points": {"type": "array", "items": REQ_POINT},
    },
}

COVERAGE = {
    "type": "object",
    "required": ["requirementId", "total", "counts", "p0Uncovered", "rows", "timeline"],
    "properties": {
        "counts": {
            "type": "object",
            "required": ["uncovered", "linked", "verified", "failed"],
            "additionalProperties": {"type": "integer", "minimum": 0},
        },
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["point", "status", "cases"],
                "properties": {"point": REQ_POINT, "status": {"enum": ["uncovered", "linked", "verified", "failed"]}},
            },
        },
    },
}
