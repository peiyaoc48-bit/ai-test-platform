"""环境接口：增删改查、参数校验、按环境解析变量与运行快照。"""
import allure
import pytest

from common.assertions import assert_status

pytestmark = allure.feature("环境接口")


@pytest.fixture
def env_factory(api):
    created = []

    def make(**overrides):
        body = {"name": "接口测试环境", "baseUrl": "", "vars": {}, **overrides}
        resp = api.post("/api/environments", json=body)
        assert_status(resp, 201)
        created.append(resp.json()["id"])
        return resp.json()

    yield make
    for eid in created:
        api.delete(f"/api/environments/{eid}")


@allure.story("增删改查")
def test_environment_crud(api, env_factory):
    env = env_factory(name="测试环境", baseUrl="http://localhost:5174", vars={"API": "http://localhost:8081"},
                      permissions=["camera"], localStorage={"agreed": "1"}, stepTimeoutMs=90000)
    assert env["permissions"] == ["camera"] and env["stepTimeoutMs"] == 90000
    updated = api.put(f"/api/environments/{env['id']}", json={**env, "vars": {"API": "http://10.0.0.1:8081"}})
    assert_status(updated, 200)
    assert updated.json()["vars"] == {"API": "http://10.0.0.1:8081"}
    assert env["id"] in [e["id"] for e in api.get("/api/environments").json()]
    assert_status(api.delete(f"/api/environments/{env['id']}"), 204)
    assert_status(api.get(f"/api/environments/{env['id']}"), 404)


@allure.story("参数校验")
@pytest.mark.parametrize("body, msg", [
    ({"name": ""}, "环境名称不能为空"),
    ({"name": "x", "baseUrl": "ftp://a"}, "基础地址"),
    ({"name": "x", "vars": {"BASE_URL": "a"}}, "内置变量"),
    ({"name": "x", "vars": {"a-b": "1"}}, "名称不合法"),
    ({"name": "x", "launchArgs": "--a"}, "以 -- 开头"),
    ({"name": "x", "permissions": ["admin"]}, "权限只能是"),
    ({"name": "x", "stepTimeoutMs": 999999}, "1000 ~ 600000"),
])
def test_environment_validation(api, body, msg):
    resp = api.post("/api/environments", json=body)
    assert_status(resp, 400)
    assert msg in resp.json()["error"]


@allure.story("按环境运行")
@pytest.mark.slow
def test_run_resolves_env_vars_and_keeps_snapshot(api, base_url, env_factory, case_factory):
    env = env_factory(name="演示（环境变量）", vars={"API": f"{base_url}/demo-api", "PASSWORD": "demo123"})
    case = case_factory(url="", steps=[{
        "type": "api",
        "content": 'method: POST\nurl: "{{API}}/login"\njson: { username: demo, password: "{{PASSWORD}}" }\nexpect: { status: 200 }',
    }])
    run_id = api.post(f"/api/cases/{case['id']}/run", json={"envId": env["id"]}).json()["runId"]
    run = api.wait_run(run_id)
    assert run["status"] == "passed", run
    assert run["envName"] == "演示（环境变量）"
    assert run["env"]["vars"]["API"].endswith("/demo-api")


@allure.story("按环境运行")
@pytest.mark.slow
def test_missing_variable_in_api_step_fails_with_clear_message(api, case_factory):
    case = case_factory(url="", steps=[{"type": "api", "content": 'url: "{{API}}/todos"'}])
    run = api.wait_run(api.run_case(case["id"]).json()["runId"])
    assert run["status"] == "failed"
    assert "变量 {{API}} 未定义" in run["steps"][0]["error"]


@allure.story("按环境运行")
def test_unknown_env_is_rejected(api, case_factory):
    case = case_factory()
    resp = api.post(f"/api/cases/{case['id']}/run", json={"envId": 999999})
    assert_status(resp, 400)
    assert "不存在" in resp.json()["error"]
