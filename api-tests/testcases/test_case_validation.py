"""用例参数校验：数据驱动，数据见 data/case_validation.yaml。"""
import allure
import pytest

from common.assertions import assert_schema, assert_status
from common.schemas import ERROR
from conftest import load_yaml

pytestmark = allure.feature("用例管理接口")

VALID = {"name": "校验用例", "url": "{{DEMO}}/index.html", "steps": [{"type": "code", "content": "1"}]}
CASES = load_yaml("case_validation.yaml")


@allure.story("参数校验")
@pytest.mark.parametrize("item", CASES, ids=[c["id"] for c in CASES])
def test_invalid_payload_returns_400(api, item):
    payload = {**VALID, **item.get("patch", {})}
    if "remove" in item:
        payload.pop(item["remove"])
    resp = api.create_case(payload)
    assert_status(resp, 400)
    assert_schema(resp.json(), ERROR)
    assert item["error"] in resp.json()["error"]


@allure.story("参数校验")
@pytest.mark.parametrize("url", ["https://example.com/a?b=1", "http://127.0.0.1:8080", "{{DEMO}}/todos.html"])
def test_valid_urls_accepted(api, case_factory, url):
    assert case_factory(url=url)["url"] == url


@allure.story("参数校验")
def test_step_limit_boundary(api, case_factory):
    """边界值：50 步可以，51 步不行。"""
    step = {"type": "ai_action", "content": "点击"}
    assert len(case_factory(steps=[step] * 50)["steps"]) == 50
    resp = api.create_case({**VALID, "steps": [step] * 51})
    assert_status(resp, 400)
    assert "不能超过 50" in resp.json()["error"]
