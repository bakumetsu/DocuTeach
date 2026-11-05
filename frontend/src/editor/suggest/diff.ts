export interface DiffSeg { text: string; changed: boolean }
export interface WordDiff { old: DiffSeg[]; next: DiffSeg[] }

function tokenize(s: string): string[] {
  if (s === '') return [];
  return Array.from(s.matchAll(/\s+|[^\s]+/gu), m => m[0]);
}

function isWs(t: string): boolean {
  return /^\s+$/u.test(t);
}

export function wordDiff(oldText: string, newText: string): WordDiff {
  if (oldText === newText) {
    if (oldText === '') return { old: [], next: [] };
    return { old: [{ text: oldText, changed: false }], next: [{ text: newText, changed: false }] };
  }

  const oT = tokenize(oldText);
  const nT = tokenize(newText);
  const n = oT.length;
  const m = nT.length;

  if (n * m > 250000) {
    return {
      old: oldText === '' ? [] : [{ text: oldText, changed: true }],
      next: newText === '' ? [] : [{ text: newText, changed: true }],
    };
  }

  // LCS DP table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oT[i] === nT[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Backtrack to mark LCS membership
  const oL = new Array<boolean>(n).fill(false);
  const nL = new Array<boolean>(m).fill(false);
  {
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (oT[i] === nT[j]) { oL[i] = true; nL[j] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { i++; }
      else { j++; }
    }
  }

  // Mark changed, then apply whitespace-between-changed rule
  function markChanged(tokens: string[], inLcs: boolean[]): boolean[] {
    const ch = tokens.map((_, k) => !inLcs[k]);
    for (let k = 0; k < tokens.length; k++) {
      if (inLcs[k] && isWs(tokens[k]) && k > 0 && k < tokens.length - 1 && ch[k - 1] && !inLcs[k + 1]) ch[k] = true;
    }
    return ch;
  }

  function segs(tokens: string[], ch: boolean[]): DiffSeg[] {
    if (tokens.length === 0) return [];
    const out: DiffSeg[] = [];
    let txt = tokens[0];
    let cur = ch[0];
    for (let k = 1; k < tokens.length; k++) {
      if (ch[k] === cur) { txt += tokens[k]; }
      else { out.push({ text: txt, changed: cur }); txt = tokens[k]; cur = ch[k]; }
    }
    out.push({ text: txt, changed: cur });
    return out;
  }

  return {
    old: segs(oT, markChanged(oT, oL)),
    next: segs(nT, markChanged(nT, nL)),
  };
}
