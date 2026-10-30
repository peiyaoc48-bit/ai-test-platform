"""用例集、批量运行、JUnit 导出，以及 CI 触发脚本的退出码。"""
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import allure
import pytest

from common.assertions import assert_status

pytestmark = [allure.feature("用例集与 CI"), pytest.mark.slow]
ROOT = Path(__file__).resolve().parents[2]

PASS_STEPS = [{"type": "api", "content": 'url: "{{DEMO_API}}/todos"\nexpect: { status: 401 }'}]
FAIL_STEPS = [{"type": "api", "content": 'url: "{{DEMO_API}}/todos"\nexpect: { status: 200 }'}]


@pytest.fixture
def suite_factory(api):
    created = []

    def make(name, case_ids):
        resp = api.post("/api/suites", json={"name": name, "caseIds": case_ids})
        assert_status(resp, 201)
        created.append(resp.json()["id"])
        return resp.json()

    yield make
    for sid in created:
        api.delete(f"/api/suites/{sid}")


@allure.story("批量运行")
def test_suite_run_and_junit(api, case_factory, suite_factory):
    ok = case_factory(name="集-通过", url="", steps=PASS_STEPS)
    bad = case_factory(name="集-失败", url="", steps=FAIL_STEPS)
    suite = suite_factory("接口回归", [ok["id"], bad["id"]])

    resp = api.post(f"/api/suites/{suite['id']}/run", json={"trigger": "ci"})
    assert_status(resp, 202)
    batch = api.wait_batch(resp.json()["batchId"])
    assert batch["status"] == "failed"
    assert (batch["total"], batch["passed"], batch["failed"]) == (2, 1, 1)
    assert batch["trigger"] == "ci"

    junit = api.get(f"/api/batches/{batch['id']}/junit")
    assert_status(junit, 200)
    root = ET.fromstring(junit.content)  # 能被标准 XML 解析器解析
    suite_el = root.find("testsuite")
    assert suite_el.get("tests") == "2" and suite_el.get("failures") == "1"
    failed = [tc for tc in suite_el.iter("testcase") if tc.find("failure") is not None]
    assert [tc.get("name") for tc in failed] == ["集-失败"]
    assert "状态码期望 200，实际 401" in failed[0].find("failure").text


@allure.story("参数校验")
@pytest.mark.parametrize("body, msg", [
    ({"name": "", "caseIds": [1]}, "名称不能为空"),
    ({"name": "x", "caseIds": []}, "至少选择一个用例"),
    ({"name": "x", "caseIds": [999999]}, "不存在"),
    ({"name": "x", "caseIds": "1,2"}, "至少选择一个用例"),
])
def test_suite_validation(api, body, msg):
    resp = api.post("/api/suites", json=body)
    assert_status(resp, 400)
    assert msg in resp.json()["error"]


@allure.story("CI 触发脚本")
@pytest.mark.parametrize("steps, exit_code", [(PASS_STEPS, 0), (FAIL_STEPS, 1)], ids=["全部通过退出 0", "有失败退出 1"])
def test_ci_script_exit_code(api, base_url, case_factory, suite_factory, tmp_path, steps, exit_code):
    case = case_factory(name="CI-用例", url="", steps=steps)
    suite = suite_factory(f"CI-{exit_code}", [case["id"]])
    junit = tmp_path / "junit.xml"
    proc = subprocess.run(
        ["npx", "tsx", "scripts/ci-run.ts", "--server", base_url, "--suite", str(suite["id"]), "--junit", str(junit), "--timeout", "60"],
        cwd=ROOT, capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == exit_code, proc.stdout + proc.stderr
    assert "共 1 个用例" in proc.stdout
    assert ET.parse(junit).getroot().tag == "testsuites"


@allure.story("CI 触发脚本")
def test_ci_script_unknown_suite(base_url):
    proc = subprocess.run(
        ["npx", "tsx", "scripts/ci-run.ts", "--server", base_url, "--suite", "不存在的用例集"],
        cwd=ROOT, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 2
    assert "找不到用例集" in proc.stderr
