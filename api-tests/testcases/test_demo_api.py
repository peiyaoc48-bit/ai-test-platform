"""演示站点后端（/demo-api）：登录鉴权 + 待办增删改查。

典型的接口测试关注点：鉴权（无 token / 伪造 token / 退出后失效）、接口关联（登录拿 token
→ 后续请求带上）、参数校验、资源不存在、会话之间的数据隔离。
"""
import allure
import pytest

from common.assertions import assert_fast, assert_status
from conftest import load_yaml

pytestmark = allure.feature("演示站点接口")


@pytest.fixture
def auth(api) -> dict:
    """登录并返回带 token 的请求头（接口关联）。每个用例拿到独立会话。"""
    resp = api.post("/demo-api/login", json={"username": "demo", "password": "demo123"})
    assert_status(resp, 200)
    return {"Authorization": f"Bearer {resp.json()['token']}"}


@pytest.mark.smoke
@allure.story("登录")
def test_login_success(api):
    resp = api.post("/demo-api/login", json={"username": "demo", "password": "demo123"})
    assert_status(resp, 200)
    assert_fast(resp, 300)
    body = resp.json()
    assert len(body["token"]) == 32 and body["username"] == "demo"
    assert body["expiresIn"] > 0


@allure.story("登录")
@pytest.mark.parametrize("item", load_yaml("demo_login.yaml"), ids=lambda i: i["id"])
def test_login_failures(api, item):
    resp = api.post("/demo-api/login", json=item["body"])
    assert_status(resp, item["status"])
    assert resp.json()["error"] == item["error"]
    assert "token" not in resp.json()


@allure.story("鉴权")
@pytest.mark.parametrize("headers", [
    {},
    {"Authorization": "Bearer 0123456789abcdef0123456789abcdef"},
    {"Authorization": "Token abc"},
    {"Authorization": "Bearer"},
], ids=["无 token", "伪造 token", "错误的鉴权方案", "Bearer 后为空"])
def test_requests_without_valid_token_are_401(api, headers):
    for method, path in [("GET", "/demo-api/todos"), ("POST", "/demo-api/todos"), ("GET", "/demo-api/me")]:
        resp = api.request(method, path, headers=headers, json={"text": "x"} if method == "POST" else None)
        assert_status(resp, 401)


@allure.story("鉴权")
def test_logout_invalidates_token(api, auth):
    assert_status(api.get("/demo-api/me", headers=auth), 200)
    assert_status(api.post("/demo-api/logout", headers=auth), 204)
    assert_status(api.get("/demo-api/me", headers=auth), 401)


@pytest.mark.smoke
@allure.story("待办增删改查")
def test_todo_crud(api, auth):
    initial = api.get("/demo-api/todos", headers=auth).json()
    assert initial["total"] == 2 and initial["done"] == 1

    created = api.post("/demo-api/todos", headers=auth, json={"text": "  接口测试待办  "})
    assert_status(created, 201)
    todo = created.json()
    assert todo == {"id": todo["id"], "text": "接口测试待办", "done": False}

    patched = api.request("PATCH", f"/demo-api/todos/{todo['id']}", headers=auth, json={"done": True})
    assert_status(patched, 200)
    assert patched.json()["done"] is True

    listed = api.get("/demo-api/todos", headers=auth).json()
    assert listed["total"] == 3 and listed["done"] == 2
    assert {"id": todo["id"], "text": "接口测试待办", "done": True} in listed["items"]

    assert_status(api.delete(f"/demo-api/todos/{todo['id']}", headers=auth), 204)
    assert_status(api.delete(f"/demo-api/todos/{todo['id']}", headers=auth), 404)
    assert api.get("/demo-api/todos", headers=auth).json()["total"] == 2


@allure.story("参数校验")
@pytest.mark.parametrize("body, msg", [
    ({"text": ""}, "不能为空"),
    ({"text": "   "}, "不能为空"),
    ({}, "不能为空"),
    ({"text": 123}, "不能为空"),
    ({"text": "x" * 101}, "不能超过 100"),
])
def test_create_todo_validation(api, auth, body, msg):
    resp = api.post("/demo-api/todos", headers=auth, json=body)
    assert_status(resp, 400)
    assert msg in resp.json()["error"]


@allure.story("参数校验")
def test_text_length_boundary(api, auth):
    assert_status(api.post("/demo-api/todos", headers=auth, json={"text": "x" * 100}), 201)


@allure.story("参数校验")
def test_patch_validation_and_not_found(api, auth):
    resp = api.request("PATCH", "/demo-api/todos/1", headers=auth, json={"done": "yes"})
    assert_status(resp, 400)
    assert "布尔值" in resp.json()["error"]
    assert_status(api.request("PATCH", "/demo-api/todos/999", headers=auth, json={"done": True}), 404)


@allure.story("数据隔离")
def test_sessions_are_isolated(api, auth):
    other = api.post("/demo-api/login", json={"username": "demo", "password": "demo123"}).json()["token"]
    api.post("/demo-api/todos", headers=auth, json={"text": "只属于会话 A"})
    b_items = api.get("/demo-api/todos", headers={"Authorization": f"Bearer {other}"}).json()["items"]
    assert all(t["text"] != "只属于会话 A" for t in b_items)
