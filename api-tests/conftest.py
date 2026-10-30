"""pytest 全局夹具。

- 默认自动启动一个独立的平台实例（临时数据目录、端口 3197、不配置模型），测完关闭；
- 设置环境变量 API_BASE_URL 时改为测试已有环境（例如测试环境、CI 中已启动的服务）。
"""
from __future__ import annotations

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
            if requests.get(f"{url}/api/config", timeout=2).ok:
                return
        except requests.ConnectionError:
            pass
        time.sleep(0.5)
    raise RuntimeError(f"平台在 {timeout}s 内没有启动：{url}")


@pytest.fixture(scope="session")
def base_url():
    if os.environ.get("API_BASE_URL"):
        url = os.environ["API_BASE_URL"].rstrip("/")
        _wait_ready(url)
        yield url
        return

    port = os.environ.get("API_TEST_PORT", "3197")
    data_dir = tempfile.mkdtemp(prefix="api-tests-")
    env = {
        **os.environ,
        "PORT": port,
        "DATA_DIR": data_dir,
        "MIDSCENE_MODEL_API_KEY": "",  # 显式置空，避免读到开发者本地 .env 里的真实 key
    }
    proc = subprocess.Popen(
        ["npx", "tsx", "server/index.ts"], cwd=ROOT, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        _wait_ready(url)
        yield url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(data_dir, ignore_errors=True)


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
