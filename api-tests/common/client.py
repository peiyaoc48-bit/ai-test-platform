"""平台接口客户端：封装 requests，统一超时、日志与 Allure 附件。

用例层只调用这里的业务方法（create_case / run_case ...），
不直接拼 URL，接口地址变化时只改这一处。
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

import requests

try:  # Allure 为可选依赖：没装也能跑
    import allure
except ImportError:  # pragma: no cover
    allure = None

log = logging.getLogger("api")


class ApiClient:
    def __init__(self, base_url: str, timeout: float = 10):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()

    # —— 通用请求 ——
    def request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        kwargs.setdefault("timeout", self.timeout)
        resp = self.session.request(method, url, **kwargs)
        log.info("%s %s -> %s (%.0f ms)", method, url, resp.status_code, resp.elapsed.total_seconds() * 1000)
        self._attach(method, url, kwargs.get("json"), resp)
        return resp

    def get(self, path: str, **kw: Any) -> requests.Response:
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw: Any) -> requests.Response:
        return self.request("POST", path, **kw)

    def put(self, path: str, **kw: Any) -> requests.Response:
        return self.request("PUT", path, **kw)

    def delete(self, path: str, **kw: Any) -> requests.Response:
        return self.request("DELETE", path, **kw)

    # —— 业务方法 ——
    def create_case(self, payload: dict) -> requests.Response:
        return self.post("/api/cases", json=payload)

    def get_case(self, case_id: int) -> requests.Response:
        return self.get(f"/api/cases/{case_id}")

    def update_case(self, case_id: int, payload: dict) -> requests.Response:
        return self.put(f"/api/cases/{case_id}", json=payload)

    def delete_case(self, case_id: int) -> requests.Response:
        return self.delete(f"/api/cases/{case_id}")

    def run_case(self, case_id: int) -> requests.Response:
        return self.post(f"/api/cases/{case_id}/run")

    def get_run(self, run_id: int) -> requests.Response:
        return self.get(f"/api/runs/{run_id}")

    def wait_run(self, run_id: int, timeout: float = 60, interval: float = 0.3) -> dict:
        """异步接口的标准测法：提交后轮询，直到进入终态或超时。"""
        deadline = time.monotonic() + timeout
        while True:
            run = self.get_run(run_id).json()
            if run["status"] not in ("queued", "running"):
                return run
            if time.monotonic() > deadline:
                raise TimeoutError(f"运行 #{run_id} 在 {timeout}s 内未结束，当前状态 {run['status']}")
            time.sleep(interval)

    def _attach(self, method: str, url: str, body: Any, resp: requests.Response) -> None:
        if allure is None:
            return
        try:
            resp_body = json.dumps(resp.json(), ensure_ascii=False, indent=2)
        except ValueError:
            resp_body = resp.text[:2000]
        allure.attach(
            f"{method} {url}\n\n请求体：\n{json.dumps(body, ensure_ascii=False, indent=2) if body is not None else '（无）'}"
            f"\n\n响应 {resp.status_code}：\n{resp_body}",
            name=f"{method} {url.replace(self.base_url, '')} -> {resp.status_code}",
            attachment_type=allure.attachment_type.TEXT,
        )
