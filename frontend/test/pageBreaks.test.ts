// frontend/test/pageBreaks.test.ts
import { describe, it, expect } from 'vitest';
import { computeBreaks, type BreakItem } from '../src/editor/pageBreaks';

describe('computeBreaks', () => {
  it('returns [] for empty items', () => {
    expect(computeBreaks([], 800)).toEqual([]);
  });

  it('returns [] when pageH <= 0', () => {
    const items: BreakItem[] = [{ top: 0, bottom: 100 }];
    expect(computeBreaks(items, 0)).toEqual([]);
    expect(computeBreaks(items, -1)).toEqual([]);
  });

  it('returns [] when all items fit on one page', () => {
    const items: BreakItem[] = [
      { top: 0, bottom: 100 },
      { top: 100, bottom: 250 },
      { top: 250, bottom: 400 },
    ];
    expect(computeBreaks(items, 800)).toEqual([]);
  });

  it('produces one break with correct remaining', () => {
    const items: BreakItem[] = [
      { top: 0, bottom: 200 },
      { top: 200, bottom: 400 },
      { top: 400, bottom: 600 },
    ];
    const breaks = computeBreaks(items, 500);
    expect(breaks).toEqual([
      { index: 2, remaining: 100 }, // page0: 0..500, item1 ends at 400, 500-400=100
    ]);
  });

  it('keepWithNext moves the break before the heading', () => {
    const items: BreakItem[] = [
      { top: 0, bottom: 200 },
      { top: 200, bottom: 350, keepWithNext: true }, // heading
      { top: 350, bottom: 500 },
      { top: 500, bottom: 700 },
    ];
    // pageH=400: page0=0..400
    // item0 fits (200<=400), item1 fits (350<=400), item2 doesn't fit (500>400)
    // keepWithNext on item1 → break before item1
    const breaks = computeBreaks(items, 400);
    expect(breaks).toEqual([
      { index: 1, remaining: 200 }, // 400-200=200
      { index: 3, remaining: 100 }, // page 2 starts at 200; item 3 ends at 700
    ]);
  });

  it('keepWithNext does not apply when heading is already first on page', () => {
    const items: BreakItem[] = [
      { top: 0, bottom: 200, keepWithNext: true },
      { top: 200, bottom: 300 },
      { top: 300, bottom: 500 },
    ];
    const breaks = computeBreaks(items, 250);
    // item0 has keepWithNext but is first on its page, so the break stays before item1
    expect(breaks[0]).toEqual({ index: 1, remaining: 50 });
  });

  it('oversize block overflows the page', () => {
    const items: BreakItem[] = [
      { top: 0, bottom: 100 },
      { top: 100, bottom: 900 }, // taller than pageH
      { top: 900, bottom: 1000 },
    ];
    const breaks = computeBreaks(items, 500);
    // page0=0..500: item0 fits (100<=500). item1 bottom=900>500, doesn't fit, not first on page.
    // Break before item1: remaining=500-100=400.
    // page1: pageTop=100, range 100..600. item1 is first on page. bottom=900>600, overflows.
    // page2: pageTop=900, range 900..1400. item2 fits.
    expect(breaks).toEqual([
      { index: 1, remaining: 400 },
    ]);
  });

  it('table splits between rows', () => {
    const items: BreakItem[] = [
      {
        top: 0,
        bottom: 600,
        rows: [
          { top: 0, bottom: 100 },
          { top: 100, bottom: 200 },
          { top: 200, bottom: 300 },
          { top: 300, bottom: 400 },
          { top: 400, bottom: 500 },
          { top: 500, bottom: 600 },
        ],
      },
    ];
    const breaks = computeBreaks(items, 400);
    // page0=0..400: rows 0,1,2,3 fit (bottoms 100,200,300,400 all <=400). row4 bottom=500>400.
    // Break at row 4: remaining=400-400=0.
    expect(breaks).toEqual([
      { index: 0, row: 4, remaining: 0 },
    ]);
  });

  it('table with a first row that does not fit moves whole table', () => {
    const items: BreakItem[] = [
      { top: 0, bottom: 200 },
      {
        top: 200,
        bottom: 500,
        rows: [
          { top: 200, bottom: 350 },
          { top: 350, bottom: 500 },
        ],
      },
      { top: 500, bottom: 600 },
    ];
    const breaks = computeBreaks(items, 300);
    // page0=0..300: item0 fits (200<=300). Table row0 bottom=350>300, doesn't fit.
    // Table not first on page → normal break before table (index=1).
    // remaining=300-200=100.
    // page1: pageTop=200, range 200..500. Table first on page. row0 bottom=350<=500. row1 bottom=500<=500.
    // Whole table fits.
    expect(breaks).toEqual([
      { index: 1, remaining: 100 },
      { index: 2, remaining: 0 }, // item 2 ends at 600, past page 2 (200..500)
    ]);
  });

  it('produces breaks across three pages', () => {
    const items: BreakItem[] = [
      { top: 0, bottom: 300 },
      { top: 300, bottom: 600 },
      { top: 600, bottom: 900 },
      { top: 900, bottom: 1200 },
    ];
    const breaks = computeBreaks(items, 500);
    // page0=0..500: item0 fits(300<=500). item1 bottom=600>500, doesn't fit.
    // Break before item1: remaining=500-300=200.
    // page1: pageTop=300, range 300..800. item1 fits(600<=800). item2 bottom=900>800, doesn't fit.
    // Break before item2: remaining=800-600=200.
    // page2: pageTop=600, range 600..1100. item2 fits(900<=1100). item3 bottom=1200>1100, doesn't fit.
    // Break before item3: remaining=1100-900=200.
    // page3: pageTop=900, range 900..1400. item3 fits.
    expect(breaks).toEqual([
      { index: 1, remaining: 200 },
      { index: 2, remaining: 200 },
      { index: 3, remaining: 200 },
    ]);
  });

  it('processes 2000 items in under 50 ms', () => {
    const items: BreakItem[] = [];
    for (let k = 0; k < 2000; k++) {
      items.push({ top: k * 10, bottom: k * 10 + 10 });
    }
    const start = performance.now();
    const breaks = computeBreaks(items, 800);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    expect(breaks.length).toBeGreaterThan(0);
  });
});
