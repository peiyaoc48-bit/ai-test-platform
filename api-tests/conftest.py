"""pytest 全局夹具。

- 默认自动启动一个独立的平台实例（临时数据目录、端口 3197、不配置模型），测完关闭；
- 设置环境变量 API_BASE_URL 时改为测试已有环境（例如测试环境、CI 中已启动的服务）；
- 用例工坊的用例另起一个指向本地假模型的实例（workshop 夹具）。
"""
from __future__ import annotations

import contextlib
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import pytest
import requests
import yaml

from common.client import ApiClient

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(__file__).resolve().parent / "data"


def _wait_ready(url: str, timeout: float = 60) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if requests.get(url, timeout=2).ok:
                return
        except requests.ConnectionError:
            pass
        time.sleep(0.5)
    raise RuntimeError(f"平台在 {timeout}s 内没有启动：{url}")


@contextlib.contextmanager
def _launch(cmd: list[str], port: str, env: dict, ready_url: str):
    """启动一个子进程（平台或假模型），等就绪后交给用例，结束时关闭。"""
    proc = subprocess.Popen(cmd, cwd=ROOT, env={**os.environ, **env}, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        _wait_ready(ready_url)
        yield
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


@contextlib.contextmanager
def _platform(port: str, extra_env: dict):
    data_dir = tempfile.mkdtemp(prefix="api-tests-")
    url = f"http://127.0.0.1:{port}"
    try:
        with _launch(["npx", "tsx", "server/index.ts"], port, {"PORT": port, "DATA_DIR": data_dir, **extra_env}, f"{url}/api/config"):
            yield url
    finally:
        shutil.rmtree(data_dir, ignore_errors=True)


@pytest.fixture(scope="session")
def base_url():
    if os.environ.get("API_BASE_URL"):
        url = os.environ["API_BASE_URL"].rstrip("/")
        _wait_ready(url + "/api/config")
        yield url
        return
    # 显式置空模型 key，避免读到开发者本地 .env 里的真实 key
    with _platform(os.environ.get("API_TEST_PORT", "3197"), {"MIDSCENE_MODEL_API_KEY": ""}) as url:
        yield url


@pytest.fixture(scope="session")
def workshop_base_url():
    """用例工坊需要大模型：另起一个平台实例，指向本地假模型（e2e/mock-llm.ts），不消耗真实 token。"""
    if os.environ.get("API_BASE_URL"):
        pytest.skip("测试已有环境时不跑用例工坊（需要假模型）")
    llm_port = os.environ.get("MOCK_LLM_PORT", "3295")
    with _launch(["npx", "tsx", "e2e/mock-llm.ts"], llm_port, {"MOCK_LLM_PORT": llm_port}, f"http://127.0.0.1:{llm_port}/health"):
        with _platform(os.environ.get("WORKSHOP_TEST_PORT", "3194"), {
            "MIDSCENE_MODEL_BASE_URL": f"http://127.0.0.1:{llm_port}/v1",
            "MIDSCENE_MODEL_API_KEY": "mock-key",
            "MIDSCENE_MODEL_NAME": "mock-model",
            "GEN_MODEL_NAME": "mock-model",
        }) as url:
            yield url


@pytest.fixture(scope="session")
def workshop(workshop_base_url) -> ApiClient:
    return ApiClient(workshop_base_url)


@pytest.fixture(scope="session")
def api(base_url) -> ApiClient:
    return ApiClient(base_url)


@pytest.fixture
def case_factory(api):
    """造数据 + 自动清理：用例里创建的测试用例在用例结束后删除，互不干扰。"""
    created: list[int] = []

    def make(**overrides) -> dict:
        payload = {
            "name": "接口测试-临时用例",
            "description": "由 api-tests 创建",
            "url": "{{DEMO}}/index.html",
            "steps": [{"type": "code", "content": "await page.title()"}],
            **overrides,
        }
        resp = api.create_case(payload)
        assert resp.status_code == 201, resp.text
        case = resp.json()
        created.append(case["id"])
        return case

    yield make
    for case_id in created:
        api.delete_case(case_id)  # 已在用例中删除的会返回 404，忽略即可


def load_yaml(name: str):
    return yaml.safe_load((DATA / name).read_text(encoding="utf-8"))
