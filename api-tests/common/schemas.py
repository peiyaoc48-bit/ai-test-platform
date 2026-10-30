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
