"""Skill file format parser (stdlib only)."""

from __future__ import annotations

import re
from dataclasses import dataclass

MAX_FILE_BYTES = 16 * 1024
RESERVED_COMMANDS: frozenset[str] = frozenset({"/edit"})
INSERT_AS: tuple[str, ...] = ("teacherNote", "blanks", "text")
ALLOWED_KEYS: tuple[str, ...] = ("command", "name", "description", "insertAs", "tag")

COMMAND_RE = re.compile(r"^/[a-z][a-z0-9-]{1,23}$")


@dataclass(frozen=True)
class SkillSpec:
    command: str
    name: str
    description: str
    insert_as: str
    tag: str
    body: str


class SkillFormatError(ValueError):
    code: str
    reason: str

    def __init__(self, code: str, reason: str) -> None:
        self.code = code
        self.reason = reason
        super().__init__(reason)


def slug_for(command: str) -> str:
    return command.lstrip("/")


def parse_skill(raw: bytes) -> SkillSpec:
    if len(raw) > MAX_FILE_BYTES:
        raise SkillFormatError("too_long", "The file is larger than 16 KB.")

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise SkillFormatError("bad_encoding", "The file is not valid UTF-8.") from None

    if text.startswith("\ufeff"):
        text = text[1:]

    for ch in text:
        if ch in "\n\r\t":
            continue
        if ord(ch) < 32 or ch == "\x7f":
            raise SkillFormatError("bad_chars", "The file contains a control character.")

    text = text.replace("\r\n", "\n")
    lines = text.split("\n")

    if not lines or lines[0] != "---":
        raise SkillFormatError("bad_header", "The first line must be ---.")

    fields: dict[str, str] = {}
    i = 1
    while i < len(lines):
        line = lines[i]
        if line == "---":
            break
        if ":" not in line:
            raise SkillFormatError("bad_header", "Each header line must be key: value.")
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not value:
            raise SkillFormatError("bad_header", f"The value for '{key}' is empty.")
        if key not in ALLOWED_KEYS:
            raise SkillFormatError("unknown_key", f"Unknown key '{key}'.")
        if key in fields:
            raise SkillFormatError("duplicate_key", f"Duplicate key '{key}'.")
        fields[key] = value
        i += 1
    else:
        raise SkillFormatError("bad_header", "The header is not closed with ---.")

    for req in ("command", "name", "description", "insertAs"):
        if req not in fields:
            raise SkillFormatError("missing_field", f"Missing required field '{req}'.")

    command = fields["command"]
    if not COMMAND_RE.match(command):
        raise SkillFormatError(
            "bad_command",
            "Command must be / followed by a letter, then 1-23 alphanumerics or hyphens.",
        )
    if command in RESERVED_COMMANDS:
        raise SkillFormatError("reserved_command", f"Command '{command}' is reserved.")

    name = fields["name"]
    description = fields["description"]
    insert_as = fields["insertAs"]

    if not 1 <= len(name) <= 40:
        raise SkillFormatError("too_long", "Name must be 1 to 40 characters.")
    if not 1 <= len(description) <= 120:
        raise SkillFormatError("too_long", "Description must be 1 to 120 characters.")
    if insert_as not in INSERT_AS:
        raise SkillFormatError("bad_insert_as", "insertAs must be teacherNote, blanks, or text.")

    tag_val = fields.get("tag")
    if tag_val is not None:
        if insert_as != "teacherNote":
            raise SkillFormatError("bad_tag", "Tag is only allowed when insertAs is teacherNote.")
        if not 1 <= len(tag_val) <= 24:
            raise SkillFormatError("bad_tag", "Tag must be 1 to 24 characters.")
        if '"' in tag_val or "\n" in tag_val:
            raise SkillFormatError("bad_tag", "Tag must not contain quotes or newlines.")
    else:
        tag_val = name

    body = "\n".join(lines[i + 1 :]).strip()
    if not 20 <= len(body) <= 4000:
        raise SkillFormatError("bad_body", "The prompt must be 20 to 4,000 characters.")

    return SkillSpec(
        command=command,
        name=name,
        description=description,
        insert_as=insert_as,
        tag=tag_val,
        body=body,
    )
