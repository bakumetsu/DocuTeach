"""API tests for skill endpoints."""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import httpx
import pytest

from docuteach.config import Settings
from docuteach.skills.format import MAX_FILE_BYTES


def _skill_fields(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "command": "/mine",
        "name": "Mine",
        "description": "A custom skill",
        "insertAs": "text",
        "body": "x" * 30,
    }
    base.update(overrides)
    return base


def _json(resp: httpx.Response) -> dict[str, Any]:
    return cast(dict[str, Any], resp.json())


def _json_list(resp: httpx.Response) -> list[Any]:
    return cast(list[Any], resp.json())


def _skill_dir(settings: Settings) -> Path:
    return settings.data_dir / "skills"


VALID_IMPORT_TEXT = (
    "---\n"
    "command: /imports\n"
    "name: Imports\n"
    "description: An imported skill\n"
    "insertAs: text\n"
    "---\n"
    "Imported body content.\n"
)


async def _builtin_slug(client: httpx.AsyncClient) -> str:
    resp = await client.get("/api/skills/manage")
    items = _json_list(resp)
    for item in items:
        if item.get("source") == "builtin":
            cmd = item.get("command", "")
            if isinstance(cmd, str) and cmd.startswith("/"):
                return cmd.lstrip("/")
    pytest.skip("no built-in skills available")


# 1 ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_manage_lists_builtins(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/skills/manage")
    assert resp.status_code == 200
    items = _json_list(resp)
    assert any(item.get("source") == "builtin" for item in items)


# 2 ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_create_custom_and_conflict(client: httpx.AsyncClient) -> None:
    fields = _skill_fields()
    resp = await client.post("/api/skills", json=fields)
    assert resp.status_code == 200

    resp = await client.get("/api/skills")
    assert resp.status_code == 200
    items = _json_list(resp)
    mine = [item for item in items if item.get("command") == "/mine"]
    assert mine, "custom skill /mine not listed"
    assert mine[0].get("source") == "custom"

    resp = await client.post("/api/skills", json=fields)
    assert resp.status_code == 409
    assert _json(resp)["code"] == "skill_exists"

    fields["replace"] = True
    resp = await client.post("/api/skills", json=fields)
    assert resp.status_code == 200


# 3 ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_create_bad_fields(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/skills",
        json={"command": "/x", "description": "d", "insertAs": "text", "body": "b"},
    )
    assert resp.status_code == 422

    resp = await client.post("/api/skills", json=_skill_fields(name="bad\nname"))
    assert resp.status_code == 422
    assert _json(resp)["code"] == "bad_header"

    resp = await client.post("/api/skills", json=_skill_fields(insertAs="bogus"))
    assert resp.status_code == 422


# 4 ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_import_preview_writes_nothing(client: httpx.AsyncClient, settings: Settings) -> None:
    resp = await client.post("/api/skills/import/preview", json={"text": VALID_IMPORT_TEXT})
    assert resp.status_code == 200

    d = _skill_dir(settings)
    d.mkdir(parents=True, exist_ok=True)
    assert list(d.glob("*.md")) == []


@pytest.mark.anyio
async def test_import_preview_too_long(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/skills/import/preview", json={"text": "x" * (MAX_FILE_BYTES + 1)}
    )
    assert resp.status_code == 413
    assert _json(resp)["code"] == "too_long"


@pytest.mark.anyio
async def test_import_preview_garbage(client: httpx.AsyncClient) -> None:
    resp = await client.post("/api/skills/import/preview", json={"text": "\x00binary garbage"})
    assert resp.status_code == 422


# 5 ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_import_commit_clash(client: httpx.AsyncClient) -> None:
    fields = _skill_fields(command="/imports", name="Imports", description="d")
    resp = await client.post("/api/skills", json=fields)
    assert resp.status_code == 200

    resp = await client.post("/api/skills/import/commit", json={"text": VALID_IMPORT_TEXT})
    assert resp.status_code == 409
    assert _json(resp)["code"] == "skill_exists"

    resp = await client.post(
        "/api/skills/import/commit",
        json={"text": VALID_IMPORT_TEXT, "onClash": "replace"},
    )
    assert resp.status_code == 200

    resp = await client.post(
        "/api/skills/import/commit",
        json={"text": VALID_IMPORT_TEXT, "onClash": "rename", "command": "/imports2"},
    )
    assert resp.status_code == 200

    resp = await client.get("/api/skills/manage")
    cmds = {item.get("command") for item in _json_list(resp)}
    assert "/imports" in cmds
    assert "/imports2" in cmds


# 6 ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_delete_custom_and_restore(client: httpx.AsyncClient) -> None:
    resp = await client.post("/api/skills", json=_skill_fields())
    assert resp.status_code == 200

    resp = await client.delete("/api/skills/mine")
    assert resp.status_code == 200
    trash_id = _json(resp)["trashId"]
    assert isinstance(trash_id, str) and trash_id

    resp = await client.post(f"/api/skills/trash/{trash_id}/restore")
    assert resp.status_code == 200

    resp = await client.get("/api/skills/manage")
    cmds = {item.get("command") for item in _json_list(resp)}
    assert "/mine" in cmds


# 7 ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_delete_builtin_hides(client: httpx.AsyncClient, settings: Settings) -> None:
    slug = await _builtin_slug(client)

    resp = await client.delete(f"/api/skills/{slug}")
    assert resp.status_code == 200
    trash_id = _json(resp)["trashId"]
    assert trash_id == f"hide__{slug}"

    resp = await client.get("/api/skills")
    cmds = {item.get("command") for item in _json_list(resp)}
    assert f"/{slug}" not in cmds

    resp = await client.post(f"/api/skills/trash/{trash_id}/restore")
    assert resp.status_code == 200

    resp = await client.get("/api/skills")
    cmds = {item.get("command") for item in _json_list(resp)}
    assert f"/{slug}" in cmds


# 8 ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_reset_builtin_after_override(client: httpx.AsyncClient, settings: Settings) -> None:
    slug = await _builtin_slug(client)
    cmd = f"/{slug}"

    override = _skill_fields(command=cmd, name="Override", description="ovr", replace=True)
    resp = await client.post("/api/skills", json=override)
    assert resp.status_code == 200

    skill_md = _skill_dir(settings) / f"{slug}.md"
    assert skill_md.exists()

    resp = await client.post(f"/api/skills/{slug}/reset")
    assert resp.status_code == 200
    assert _json(resp)["ok"] is True

    assert not skill_md.exists()


# 9 ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_restore_defaults(client: httpx.AsyncClient) -> None:
    resp = await client.post("/api/skills/restore-defaults")
    assert resp.status_code == 200
    assert _json(resp) == {"ok": True}


# 10 --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_export_file_custom(client: httpx.AsyncClient) -> None:
    resp = await client.post("/api/skills", json=_skill_fields())
    assert resp.status_code == 200

    resp = await client.get("/api/skills/mine/file")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/markdown")
    cd = resp.headers["content-disposition"]
    assert "attachment" in cd
    assert 'filename="mine.md"' in cd
    assert "filename*=UTF-8''mine.md" in cd
    assert resp.content.startswith(b"---")


# 11 --------------------------------------------------------------------------


@pytest.mark.anyio
@pytest.mark.parametrize("slug", ["_x", ".hidden"])
async def test_delete_bad_slug(client: httpx.AsyncClient, slug: str) -> None:
    resp = await client.delete(f"/api/skills/{slug}")
    assert resp.status_code == 400
    assert _json(resp)["code"] == "bad_slug"


# 12 --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_broken_file_export_and_delete(client: httpx.AsyncClient, settings: Settings) -> None:
    d = _skill_dir(settings)
    d.mkdir(parents=True, exist_ok=True)
    (d / "weird.md").write_text("garbage that is not a skill", encoding="utf-8")

    resp = await client.get("/api/skills/weird/file")
    assert resp.status_code == 409
    assert _json(resp)["code"] == "broken"

    resp = await client.delete("/api/skills/weird")
    assert resp.status_code == 200
    assert _json(resp)["trashId"]


@pytest.mark.anyio
async def test_restore_trash_rejects_bad_slug(client: httpx.AsyncClient) -> None:
    resp = await client.post("/api/skills/trash/a..b__123/restore")
    assert resp.status_code == 400
    assert _json(resp)["code"] == "bad_slug"
