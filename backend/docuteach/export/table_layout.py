"""Column width weights for export tables."""

from __future__ import annotations


def column_weights(lengths: list[list[int]], cols: int) -> list[int]:
    weights: list[int] = []
    for j in range(cols):
        longest = 0
        for row_lengths in lengths:
            if j < len(row_lengths):
                longest = max(longest, row_lengths[j])
        weights.append(max(6, min(40, longest)))
    return weights
