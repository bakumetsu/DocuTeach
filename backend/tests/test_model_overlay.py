"""Overlay file: round trip, empty write, undo, history cap."""

from __future__ import annotations

import threading
from pathlib import Path

import pytest

from docuteach.errors import ApiError
from docuteach.llm.overlay import Overlay


def test_put_round_trip(tmp_path: Path) -> None:
    ov = Overlay(tmp_path / "overlay.yaml")
    ov.put("my-model", {"cmd": "llama-server -m x.gguf"})
    assert ov.read_entries() == {"my-model": {"cmd": "llama-server -m x.gguf"}}
    assert ov.ids() == ["my-model"]


def test_remove_last_entry_writes_empty_models(tmp_path: Path) -> None:
    path = tmp_path / "overlay.yaml"
    ov = Overlay(path)
    ov.put("my-model", {"cmd": "x"})
    ov.remove("my-model")
    assert path.exists()
    assert path.read_text(encoding="utf-8").strip() == "models: {}"
    assert ov.read_entries() == {}


def test_remove_unknown_is_404(tmp_path: Path) -> None:
    ov = Overlay(tmp_path / "overlay.yaml")
    with pytest.raises(ApiError) as exc:
        ov.remove("nope")
    assert exc.value.status == 404


def test_undo_restores_previous(tmp_path: Path) -> None:
    ov = Overlay(tmp_path / "overlay.yaml")
    ov.put("one-a", {"cmd": "a"})
    ov.put("two-b", {"cmd": "b"})
    ov.undo()
    assert ov.ids() == ["one-a"]
    ov.undo()
    assert ov.read_entries() == {}


def test_undo_with_no_history_is_409(tmp_path: Path) -> None:
    with pytest.raises(ApiError) as exc:
        Overlay(tmp_path / "overlay.yaml").undo()
    assert exc.value.status == 409


def test_invalid_yaml_is_409(tmp_path: Path) -> None:
    path = tmp_path / "overlay.yaml"
    path.write_text("models: [unclosed", encoding="utf-8")
    ov = Overlay(path)
    assert ov.is_invalid()
    with pytest.raises(ApiError) as exc:
        ov.put("my-model", {"cmd": "x"})
    assert exc.value.status == 409


def test_history_cap(tmp_path: Path) -> None:
    path = tmp_path / "overlay.yaml"
    ov = Overlay(path, history_keep=3)
    for i in range(8):
        ov.put(f"model-{i}", {"cmd": str(i)})
    hist = list(path.with_name(path.name + ".history").glob("*.yaml"))
    assert len(hist) == 3


def test_path_with_spaces_and_non_ascii(tmp_path: Path) -> None:
    d = tmp_path / "my dir ü"
    d.mkdir()
    ov = Overlay(d / "overlay.yaml")
    ov.put("my-model", {"cmd": "C:/Program Files/ü/llama-server.exe -m x"})
    assert ov.read_entries()["my-model"]["cmd"] == "C:/Program Files/ü/llama-server.exe -m x"


def test_undo_refuses_damaged_history(tmp_path: Path) -> None:
    path = tmp_path / "overlay.yaml"
    ov = Overlay(path)
    ov.put("one-a", {"cmd": "a"})
    ov.put("two-b", {"cmd": "b"})
    before = path.read_text(encoding="utf-8")
    newest = sorted((tmp_path / "overlay.yaml.history").glob("*.yaml"))[-1]
    newest.write_text("models: [broken", encoding="utf-8")
    with pytest.raises(ApiError) as exc:
        ov.undo()
    assert exc.value.code == "undo_invalid"
    assert path.read_text(encoding="utf-8") == before


def test_put_existing_id_is_409(tmp_path: Path) -> None:
    ov = Overlay(tmp_path / "overlay.yaml")
    ov.put("one-a", {"cmd": "a"})
    with pytest.raises(ApiError) as exc:
        ov.put("one-a", {"cmd": "b"})
    assert exc.value.status == 409
    assert ov.read_entries() == {"one-a": {"cmd": "a"}}


def test_concurrent_put_same_id_only_one_wins(tmp_path: Path) -> None:
    ov = Overlay(tmp_path / "overlay.yaml")
    results: list[int] = []

    def worker() -> None:
        try:
            ov.put("same-id", {"cmd": "a"})
            results.append(200)
        except ApiError as e:
            results.append(e.status)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [200] + [409] * 7
