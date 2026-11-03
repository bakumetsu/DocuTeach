"""Unit tests for LLM components (no network)."""

from __future__ import annotations

from pathlib import Path
from typing import cast
from unittest.mock import MagicMock

import pytest

from docuteach.config import Settings, load_settings
from docuteach.errors import ApiError
from docuteach.llm.client import LlmClient
from docuteach.llm.slots import SlotTable
from docuteach.llm.stream import ChatMessage, ChatRequest, LlmService, Ref
from docuteach.skills.registry import SKILLS, get_skill
from docuteach.skills.validate import validate_output

# ---------------------------------------------------------------------------
# SlotTable
# ---------------------------------------------------------------------------


def test_slot_assign_two_chats() -> None:
    table = SlotTable(2)
    assert table.assign("a") == 0
    assert table.assign("b") == 1


def test_slot_same_chat_same_slot() -> None:
    table = SlotTable(2)
    assert table.assign("a") == 0
    assert table.assign("a") == 0


def test_slot_evicts_lru_idle() -> None:
    table = SlotTable(2)
    table.assign("a")
    table.assign("b")
    # "a" is LRU idle; "c" should evict "a" and take its slot
    slot = table.assign("c")
    assert slot == 0
    pending = table.take_erase_pending()
    assert pending == [0]


def test_slot_all_generating_returns_none() -> None:
    table = SlotTable(2)
    table.assign("a")
    table.assign("b")
    table.begin("a")
    table.begin("b")
    assert table.assign("c") is None


def test_slot_release_idempotent() -> None:
    table = SlotTable(2)
    table.assign("a")
    assert table.release("a") == 0
    assert table.release("a") is None


def test_slot_total_one_second_evicts_first() -> None:
    table = SlotTable(1)
    table.assign("a")
    table.assign("b")
    assert table.slot_of("b") == 0
    assert table.slot_of("a") is None


def test_slot_set_total_shrink_drops_higher() -> None:
    table = SlotTable(3)
    table.assign("a")
    table.assign("b")
    table.assign("c")
    table.set_total(1)
    assert table.slot_of("a") == 0
    assert table.slot_of("b") is None
    assert table.slot_of("c") is None


# ---------------------------------------------------------------------------
# validate_output
# ---------------------------------------------------------------------------


def test_validate_teacher_note_valid() -> None:
    text = '::: teacher {tag="CCQ"}\nWhat is the tense?\n:::'
    assert validate_output("teacherNote", text) is None


def test_validate_note_without_tag_invalid() -> None:
    text = "::: teacher\nWhat is the tense?\n:::"
    assert validate_output("teacherNote", text) is not None


def test_validate_note_plus_extra_paragraph_invalid() -> None:
    text = '::: teacher {tag="CCQ"}\nWhat is the tense?\n:::\n\nExtra paragraph.'
    assert validate_output("teacherNote", text) is not None


def test_validate_blanks_valid() -> None:
    text = "1. She {{went}} to school.\n2. He {{ate}} an apple.\n3. They {{played}} football."
    assert validate_output("blanks", text) is None


def test_validate_blanks_two_items_invalid() -> None:
    text = "1. She {{went}} to school.\n2. He {{ate}} an apple."
    assert validate_output("blanks", text) == "list_size"


def test_validate_blanks_item_lacking_blank_invalid() -> None:
    text = "1. She went to school.\n2. He {{ate}} an apple.\n3. They {{played}} football."
    assert validate_output("blanks", text) == "item_no_blank"


def test_validate_text_paragraphs_valid() -> None:
    text = "First paragraph.\n\nSecond paragraph."
    assert validate_output("text", text) is None


def test_validate_text_containing_teacher_note_invalid() -> None:
    text = 'First paragraph.\n\n::: teacher {tag="CCQ"}\nQ?\n:::'
    assert validate_output("text", text) == "text_only"


def test_validate_fenced_code_block_invalid() -> None:
    text = "```python\nprint('hi')\n```"
    assert validate_output("text", text) in ("raw_block", "parser_warning")


def test_validate_front_matter_invalid() -> None:
    text = "---\ntitle: test\n---\n\nBody."
    assert validate_output("text", text) == "front_matter"


def test_validate_note_too_long() -> None:
    content = "x" * 4001
    text = f'::: teacher {{tag="CCQ"}}\n{content}\n:::'
    assert len(text.strip()) > 4000
    assert validate_output("teacherNote", text) == "note_too_long"


# ---------------------------------------------------------------------------
# registry
# ---------------------------------------------------------------------------


def test_registry_three_active_skills() -> None:
    active = [s for s in SKILLS if s.status == "active"]
    assert len(active) == 3
    assert [s.insert_as for s in active] == ["teacherNote", "blanks", "teacherNote"]


def test_registry_three_planned_skills() -> None:
    planned = [s for s in SKILLS if s.status == "planned"]
    assert len(planned) == 3


def test_registry_unknown_skill_none() -> None:
    assert get_skill("/nope") is None


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


def test_settings_default_model_allowlist() -> None:
    s = Settings(data_dir=Path("/tmp"), log_dir=Path("/tmp"))
    assert s.model_allowlist == ["byteshape"]


def test_load_settings_model_allowlist(tmp_path: Path) -> None:
    env = {
        "DOCUTEACH_MODEL_ALLOWLIST": "a, b",
        "DOCUTEACH_DATA_DIR": str(tmp_path),
        "DOCUTEACH_LOG_DIR": str(tmp_path),
    }
    s = load_settings(env)
    assert s.model_allowlist == ["a", "b"]


# ---------------------------------------------------------------------------
# LlmService.build_messages
# ---------------------------------------------------------------------------


def _make_service(settings: Settings) -> LlmService:
    client: LlmClient = cast(LlmClient, MagicMock())
    return LlmService(settings, client)


def test_build_messages_trims_oldest_first() -> None:
    settings = Settings(data_dir=Path("/tmp"), log_dir=Path("/tmp"))
    svc = _make_service(settings)
    msgs = [
        ChatMessage(role="user", content="A" * 100),
        ChatMessage(role="assistant", content="B" * 100),
        ChatMessage(role="user", content="C" * 100),
    ]
    req = ChatRequest(chatId="c1", model="byteshape", messages=msgs)
    result = svc.build_messages(req, 250)
    assert result[0]["role"] == "system"
    assert len(result) < 4
    # Oldest messages (A, B) trimmed; only C remains
    assert result[-1]["content"] == "C" * 100


def test_build_messages_prompt_too_long() -> None:
    settings = Settings(data_dir=Path("/tmp"), log_dir=Path("/tmp"))
    svc = _make_service(settings)
    req = ChatRequest(
        chatId="c1",
        model="byteshape",
        messages=[ChatMessage(role="user", content="hello")],
    )
    with pytest.raises(ApiError) as exc_info:
        svc.build_messages(req, 10)
    assert exc_info.value.code == "prompt_too_long"
    assert exc_info.value.status == 413


def test_build_messages_refs_and_selection_fenced() -> None:
    settings = Settings(data_dir=Path("/tmp"), log_dir=Path("/tmp"))
    svc = _make_service(settings)
    refs = [Ref(name="Lesson", text="Some content")]
    req = ChatRequest(
        chatId="c1",
        model="byteshape",
        messages=[ChatMessage(role="user", content="hello")],
        selection="selected text",
        refs=refs,
    )
    result = svc.build_messages(req, 100_000)
    system = result[0]["content"]
    assert "```" in system
    assert "Reference Lesson" in system
    assert "Some content" in system
    assert "Selection" in system
    assert "selected text" in system


def test_build_messages_unknown_skill() -> None:
    settings = Settings(data_dir=Path("/tmp"), log_dir=Path("/tmp"))
    svc = _make_service(settings)
    req = ChatRequest(
        chatId="c1",
        model="byteshape",
        skill="/nonexistent",
        messages=[ChatMessage(role="user", content="hello")],
    )
    with pytest.raises(ApiError) as exc_info:
        svc.build_messages(req, 100_000)
    assert exc_info.value.code == "skill_unknown"


def test_build_messages_planned_skill() -> None:
    settings = Settings(data_dir=Path("/tmp"), log_dir=Path("/tmp"))
    svc = _make_service(settings)
    req = ChatRequest(
        chatId="c1",
        model="byteshape",
        skill="/homework",
        messages=[ChatMessage(role="user", content="hello")],
    )
    with pytest.raises(ApiError) as exc_info:
        svc.build_messages(req, 100_000)
    assert exc_info.value.code == "skill_planned"
