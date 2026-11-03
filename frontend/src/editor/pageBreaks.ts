export interface BreakItem {
  top: number;
  bottom: number;
  keepWithNext?: boolean;
  rows?: { top: number; bottom: number }[];
}

export interface PageBreak {
  index: number;
  row?: number;
  remaining: number;
}

interface Unit {
  item: number;
  row: number | undefined;
  top: number;
  bottom: number;
  keepWithNext: boolean;
}

function flatten(items: BreakItem[]): Unit[] {
  const units: Unit[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.rows && it.rows.length >= 1) {
      for (let r = 0; r < it.rows.length; r++) {
        units.push({ item: i, row: r, top: it.rows[r].top, bottom: it.rows[r].bottom, keepWithNext: false });
      }
    } else {
      units.push({ item: i, row: undefined, top: it.top, bottom: it.bottom, keepWithNext: !!it.keepWithNext });
    }
  }
  return units;
}

function makeBreak(u: Unit, remaining: number): PageBreak {
  if (u.row !== undefined && u.row >= 1) {
    return { index: u.item, row: u.row, remaining };
  }
  return { index: u.item, remaining };
}

export function computeBreaks(items: BreakItem[], pageH: number): PageBreak[] {
  if (items.length === 0 || pageH <= 0) return [];

  const units = flatten(items);
  const breaks: PageBreak[] = [];

  let pageStart = units[0].top;
  let lastBottom = pageStart;
  let firstOnPageIdx = 0;
  let forceBreakNext = false;

  for (let j = 0; j < units.length; j++) {
    const u = units[j];

    // Previous unit overflowed → this unit starts a new page at lastBottom.
    if (forceBreakNext) {
      pageStart = lastBottom;
      firstOnPageIdx = j;
      forceBreakNext = false;
    }

    // Does this unit fit on the current page?
    if (u.bottom - pageStart <= pageH) {
      lastBottom = u.bottom;
      continue;
    }

    // Doesn't fit.

    // Case A: this unit is the first on the page → overflows; accept, flag next.
    if (j === firstOnPageIdx) {
      lastBottom = u.bottom;
      forceBreakNext = true;
      continue;
    }

    // Case B: not first → emit a break.
    let breakAt = j;

    // keepWithNext on previous unit (plain item only, not first on page):
    if (
      j - 1 >= 0 &&
      units[j - 1].keepWithNext &&
      units[j - 1].row === undefined &&
      j - 1 !== firstOnPageIdx
    ) {
      breakAt = j - 1;
    }

    // Compute remaining: space left on the old page after the unit before breakAt.
    // The "lastBottom at the time of break" is the bottom of the unit before breakAt
    // on the current page. If breakAt is the first unit on the page (shouldn't happen
    // in case B since breakAt > firstOnPageIdx), fall back to pageStart.
    // Actually: remaining = pageH - (lastBottom - pageStart) where lastBottom is
    // the bottom of the last unit placed before breakAt on this page.
    // If breakAt === firstOnPageIdx + 1, the last placed unit is firstOnPageIdx.
    // Generally, the last placed unit before breakAt is breakAt - 1.
    // But if breakAt - 1 < firstOnPageIdx, use pageStart.
    const lastBefore = breakAt - 1 >= firstOnPageIdx ? units[breakAt - 1].bottom : pageStart;
    const remaining = pageH - (lastBefore - pageStart);

    breaks.push(makeBreak(units[breakAt], remaining));

    // New page starts at the break unit's top.
    pageStart = units[breakAt].top;
    lastBottom = units[breakAt].bottom;
    firstOnPageIdx = breakAt;

    // Check if the break unit overflows the new page.
    if (units[breakAt].bottom - units[breakAt].top > pageH) {
      forceBreakNext = true;
    } else {
      // Re-check unit j on the new page (it might fit now).
      // Only needed if breakAt < j (i.e., we moved the break).
      if (breakAt < j) {
        if (u.bottom - pageStart <= pageH) {
          lastBottom = u.bottom;
        }
        // If it still doesn't fit, we'd need another break, but that would be
        // handled on the next iteration. For keepWithNext, the moved break
        // should make the current unit fit. If not, we just continue and
        // the next iteration will handle it.
      }
    }
  }

  return breaks;
}
