// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// Fuzzy matching for the command palette and "go to file": the letters of
// the query must appear in order, and the match that reads most like what
// was typed wins. Runs of consecutive letters and letters at the start of a
// word or path segment count for more than letters scattered mid-word.

const START = 12;
const BOUNDARY = 9;
const CAMEL = 7;
const CONSECUTIVE = 6;
/** Cost of each character skipped between two matched letters. */
const GAP = 1;
/** Cost of each character before the first matched letter, up to a cap. */
const LEAD = 0.3;
const LEAD_CAP = 3;

const SEPARATORS = new Set(["/", "\\", " ", "-", "_", ".", ":"]);

function bonusAt(text: string, index: number): number {
  if (index === 0) return START;
  const before = text[index - 1] ?? "";
  if (SEPARATORS.has(before)) return BOUNDARY;
  const here = text[index] ?? "";
  if (before === before.toLowerCase() && before !== before.toUpperCase() && here !== here.toLowerCase()) return CAMEL;
  return 0;
}

/** The query as matched: lower-case, spaces dropped ("open fold" finds "Open Folder"). */
function needleOf(query: string): string {
  return query.toLowerCase().replace(/\s+/g, "");
}

export interface FuzzyMatch {
  score: number;
  /** Indices in the text of the matched letters, ascending. */
  positions: number[];
}

/**
 * Best match of `query` in `text`, or null when its letters do not all
 * appear in order. An empty query matches everything with score 0.
 * `withPositions` also returns which letters matched, for highlighting;
 * ranking a long list only needs the score, which is cheaper.
 */
export function fuzzyMatch(query: string, text: string, withPositions = false): FuzzyMatch | null {
  const needle = needleOf(query);
  const m = needle.length;
  if (m === 0) return { score: 0, positions: [] };
  const hay = text.toLowerCase();
  const n = hay.length;
  if (m > n) return null;

  // Cheap rejection before any scoring.
  let seek = 0;
  for (let i = 0; i < m; i += 1) {
    seek = hay.indexOf(needle[i]!, seek);
    if (seek < 0) return null;
    seek += 1;
  }

  // best[j]: best score of needle[0..i] with needle[i] matched at text[j].
  let previous = new Float64Array(n).fill(-Infinity);
  let current = new Float64Array(n).fill(-Infinity);
  const from = withPositions ? Array.from({ length: m }, () => new Int32Array(n).fill(-1)) : null;

  for (let i = 0; i < m; i += 1) {
    const letter = needle[i]!;
    // Best of previous[k] + GAP * k over k <= j - 2, and the k that gave it.
    let reach = -Infinity;
    let reachAt = -1;
    current.fill(-Infinity);
    for (let j = i; j < n; j += 1) {
      if (i > 0 && j >= 2) {
        const candidate = previous[j - 2]! + GAP * (j - 2);
        if (candidate > reach) {
          reach = candidate;
          reachAt = j - 2;
        }
      }
      if (hay[j] !== letter) continue;
      const own = 1 + bonusAt(text, j);
      if (i === 0) {
        current[j] = own - Math.min(j * LEAD, LEAD_CAP);
        continue;
      }
      const adjacent = previous[j - 1]! + CONSECUTIVE;
      const jumped = reach - GAP * (j - 1);
      if (adjacent === -Infinity && jumped === -Infinity) continue;
      if (adjacent >= jumped) {
        current[j] = own + adjacent;
        if (from) from[i]![j] = j - 1;
      } else {
        current[j] = own + jumped;
        if (from) from[i]![j] = reachAt;
      }
    }
    [previous, current] = [current, previous];
  }

  let best = -Infinity;
  let end = -1;
  for (let j = m - 1; j < n; j += 1) {
    if (previous[j]! > best) {
      best = previous[j]!;
      end = j;
    }
  }
  if (end < 0) return null;

  const positions: number[] = [];
  if (from) {
    let j = end;
    for (let i = m - 1; i >= 0 && j >= 0; i -= 1) {
      positions.push(j);
      j = from[i]![j]!;
    }
    positions.reverse();
  }
  return { score: best, positions };
}
