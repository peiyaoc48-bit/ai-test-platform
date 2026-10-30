"""AI 生成用例接口：未配置模型时的提示与入参校验（不消耗真实 token）。"""
import allure
import pytest

from common.assertions import assert_status

pytestmark = allure.feature("AI 生成用例接口")


@allure.story("未配置模型")
def test_generate_without_model(api):
    resp = api.post("/api/generate", json={"requirement": "用户可以登录并添加待办事项，错误密码时提示"})
    assert_status(resp, 400)
    assert resp.json()["code"] == "MODEL_NOT_CONFIGURED"
    assert ".env" in resp.json()["error"], "提示里应告诉用户怎么配置"


@allure.story("参数校验")
@pytest.mark.parametrize("body, msg", [
    ({"requirement": "太短"}, "至少写 10 个字"),
    ({}, "至少写 10 个字"),
    ({"requirement": "x" * 8001}, "不能超过 8000"),
    ({"requirement": "用户可以登录并添加待办事项", "url": "file:///etc/passwd"}, "URL 不合法"),
])
def test_generate_validation(api, body, msg):
    resp = api.post("/api/generate", json=body)
    assert_status(resp, 400)
    assert msg in resp.json()["error"]
