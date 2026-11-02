"""Pydantic models shared across the store layer (camelCase on the wire)."""

from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True)


def now_iso() -> str:
    """Current UTC time as an ISO-8601 string with ``Z`` suffix."""
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class LessonMeta(BaseModel):
    model_config = _CONFIG

    v: int = 1
    id: str
    title: str
    created_at: str
    updated_at: str


class DocRecord(BaseModel):
    model_config = _CONFIG

    id: str
    markdown: str
    updated_at: str


class Checkpoint(BaseModel):
    model_config = _CONFIG

    id: str
    name: str
    created_at: str
    markdown: str
    auto: bool = False


class CheckpointMeta(BaseModel):
    """What a checkpoint ``.json`` file holds on disk."""

    model_config = _CONFIG

    id: str
    name: str
    created_at: str
    auto: bool = False
