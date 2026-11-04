"""Glue that turns model text into stream events."""

from __future__ import annotations

import collections

from docuteach.edits import EditPayload
from docuteach.edits.check import OpChecker
from docuteach.edits.ops import EditParser, Item, Op, Reply, Skip


class EditRun:
    def __init__(self, payload: EditPayload) -> None:
        self._parser = EditParser()
        self._checker = OpChecker(payload)
        self.edits: int = 0
        self.skipped: int = 0
        self.skip_codes: collections.Counter[str] = collections.Counter()
        self._op_n: int = 0

    # -- public API ----------------------------------------------------------

    @property
    def ended(self) -> bool:
        return self._parser.ended

    def feed(self, text: str) -> list[dict[str, object]]:
        items = self._parser.feed(text)
        return self._convert_items(items)

    def finish(self, complete: bool) -> list[dict[str, object]]:
        items = self._parser.finish(complete)
        return self._convert_items(items)

    def done_event(self) -> dict[str, object]:
        return {
            "type": "done",
            "edits": self.edits,
            "skipped": self.skipped,
            "noChange": self._checker.no_change,
            "largeRewrite": self._checker.large_rewrite(),
        }

    def log_summary(self) -> str:
        codes = ",".join(f"{k}:{v}" for k, v in sorted(self.skip_codes.items()))
        codes_part = f" codes={codes}" if codes else ""
        head = f"edits={self.edits} skipped={self.skipped}"
        return f"{head} no_change={self._checker.no_change}{codes_part}"

    # -- internals -----------------------------------------------------------

    def _convert_items(self, items: list[Item]) -> list[dict[str, object]]:
        events: list[dict[str, object]] = []
        for item in items:
            ev = self._convert(item)
            if ev is not None:
                events.append(ev)
        return events

    def _convert(self, item: Item) -> dict[str, object] | None:
        if isinstance(item, Reply):
            return {"type": "token", "text": item.text}
        if isinstance(item, Op):
            return self._convert_op(item)
        return self._skip_event(item)

    def _convert_op(self, op: Op) -> dict[str, object] | None:
        result = self._checker.check(op)
        if result is None:
            return None
        if isinstance(result, Skip):
            return self._skip_event(result)
        # Checked
        self._op_n += 1
        self.edits += 1
        event: dict[str, object] = {
            "type": "edit",
            "opId": f"op{self._op_n}",
            "kind": op.kind,
            "targets": list(op.targets),
            "flags": list(result.flags),
        }
        if op.anchor is not None:
            event["anchor"] = op.anchor
        if op.side is not None:
            event["side"] = op.side
        if op.markdown is not None:
            event["markdown"] = op.markdown
        return event

    def _skip_event(self, skip: Skip) -> dict[str, object]:
        self.skipped += 1
        self.skip_codes[skip.code] += 1
        return {"type": "edit_skipped", "code": skip.code, "header": skip.header}
