from __future__ import annotations

from collections import OrderedDict


class SlotTable:
    def __init__(self, total: int) -> None:
        assert total >= 1
        self._total: int = total
        self._mapping: OrderedDict[str, int] = OrderedDict()
        self._generating: set[str] = set()
        self._erase_pending: list[int] = []

    def set_total(self, total: int) -> None:
        self._total = max(1, total)
        to_remove = [cid for cid, slot in self._mapping.items() if slot >= self._total]
        for cid in to_remove:
            del self._mapping[cid]
            self._generating.discard(cid)

    def assign(self, chat_id: str) -> int | None:
        if chat_id in self._mapping:
            self._mapping.move_to_end(chat_id)
            return self._mapping[chat_id]

        used_slots: set[int] = set(self._mapping.values())
        for i in range(self._total):
            if i not in used_slots:
                self._mapping[chat_id] = i
                return i

        for cid in list(self._mapping.keys()):
            if cid not in self._generating:
                slot = self._mapping.pop(cid)
                self._generating.discard(cid)
                self._erase_pending.append(slot)
                self._mapping[chat_id] = slot
                return slot

        return None

    def begin(self, chat_id: str) -> None:
        if chat_id not in self._mapping:
            raise KeyError(chat_id)
        self._generating.add(chat_id)

    def end(self, chat_id: str) -> None:
        self._generating.discard(chat_id)

    def is_generating(self, chat_id: str) -> bool:
        return chat_id in self._generating

    def release(self, chat_id: str) -> int | None:
        if chat_id not in self._mapping:
            return None
        slot = self._mapping.pop(chat_id)
        self._generating.discard(chat_id)
        return slot

    def slot_of(self, chat_id: str) -> int | None:
        return self._mapping.get(chat_id)

    def take_erase_pending(self) -> list[int]:
        result = self._erase_pending
        self._erase_pending = []
        return result
