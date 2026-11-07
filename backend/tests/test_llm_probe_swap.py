"""Probes of the installed llama-swap (D-11 section 8). Needs the real server: pytest -m llm.

Only 127.0.0.1 is called. The one-model unload is probed with an unknown id so the
user's loaded model stays loaded; the successful unload was probed by hand (see the T-42 report).
"""

import json
import urllib.error
import urllib.request
from typing import Any

import pytest

pytestmark = pytest.mark.llm

BASE = "http://127.0.0.1:8080"


def _post(path: str) -> tuple[int, dict[str, Any]]:
    req = urllib.request.Request(BASE + path, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, {}
    except urllib.error.HTTPError as err:
        body: dict[str, Any] = json.loads(err.read() or b"{}")
        return err.code, body


def test_running_route_lists_models() -> None:
    with urllib.request.urlopen(BASE + "/running", timeout=10) as resp:
        data = json.load(resp)
    assert isinstance(data["running"], list)


def test_one_model_unload_route_exists_and_rejects_unknown_id() -> None:
    status, body = _post("/api/models/unload/no-such-model")
    assert status == 404
    assert body["error"]["code"] == "not_found"
