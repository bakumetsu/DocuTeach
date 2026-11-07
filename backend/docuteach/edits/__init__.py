"""AI lesson edits: request model, op parser, checks and prompt."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

MAX_INSTRUCTION_CHARS = 2000


class EditPart(BaseModel):
    k: int
    n: int
    outline: list[str]


class EditBlock(BaseModel):
    id: str = Field(pattern=r"^b[0-9]+$")
    kind: str
    md: str
    role: Literal["edit", "context"]


class EditPayload(BaseModel):
    instruction: str = Field(max_length=MAX_INSTRUCTION_CHARS)
    scope: Literal["selection", "section", "lesson"]
    allowProtected: bool = False
    part: EditPart | None = None
    blocks: list[EditBlock]

    @model_validator(mode="after")
    def _validate_blocks(self) -> EditPayload:
        ids = [b.id for b in self.blocks]
        if len(ids) != len(set(ids)):
            raise ValueError("block ids must be unique")
        if not any(b.role == "edit" for b in self.blocks):
            raise ValueError("at least one block must have role 'edit'")
        return self


__all__ = [
    "EditPart",
    "EditBlock",
    "EditPayload",
    "MAX_INSTRUCTION_CHARS",
]
