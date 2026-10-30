"""常用断言：失败时把响应体一起打印出来，定位更快。"""
from __future__ import annotations

import jsonschema
import requests


def assert_status(resp: requests.Response, expected: int) -> None:
    assert resp.status_code == expected, f"期望状态码 {expected}，实际 {resp.status_code}，响应：{resp.text[:500]}"


def assert_schema(data: object, schema: dict) -> None:
    try:
        jsonschema.validate(data, schema)
    except jsonschema.ValidationError as e:
        raise AssertionError(f"契约校验失败：{e.message}（路径 {list(e.absolute_path)}）") from None


def assert_fast(resp: requests.Response, max_ms: float) -> None:
    ms = resp.elapsed.total_seconds() * 1000
    assert ms <= max_ms, f"响应耗时 {ms:.0f} ms，超过阈值 {max_ms} ms"
