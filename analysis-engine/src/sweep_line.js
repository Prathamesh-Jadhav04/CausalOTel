/**
 * Pure JavaScript implementation of the O(N log N) Sweep-Line Interval Union algorithm
 * for calculating span self-time with child interval clipping.
 */

export function calculateSweepLine(parent, children = []) {
  let parentStart = Number(parent.start);
  let parentEnd = Number(parent.end);

  if (parentEnd < parentStart) {
    const tmp = parentStart;
    parentStart = parentEnd;
    parentEnd = tmp;
  }

  const parentDuration = parentEnd - parentStart;

  // 1. Clip child intervals to parent bounds [parentStart, parentEnd]
  const clipped = [];
  for (const child of children) {
    let cs = Number(child.start);
    let ce = Number(child.end);
    if (ce < cs) {
      const tmp = cs;
      cs = ce;
      ce = tmp;
    }

    const clippedStart = Math.max(parentStart, cs);
    const clippedEnd = Math.min(parentEnd, ce);

    if (clippedStart < clippedEnd) {
      clipped.push({ start: clippedStart, end: clippedEnd });
    }
  }

  if (clipped.length === 0) {
    return {
      parentDuration,
      childUnionDuration: 0,
      selfTime: parentDuration,
      mergedIntervals: []
    };
  }

  // 2. Sort intervals by start ascending
  clipped.sort((a, b) => a.start - b.start || a.end - b.end);

  // 3. Sweep-Line Union
  const merged = [];
  let current = { ...clipped[0] };

  for (let i = 1; i < clipped.length; i++) {
    const next = clipped[i];
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  // 4. Calculate total child union duration
  let childUnionDuration = 0;
  for (const m of merged) {
    childUnionDuration += (m.end - m.start);
  }

  const selfTime = Math.max(0, parentDuration - childUnionDuration);

  return {
    parentDuration,
    childUnionDuration,
    selfTime,
    mergedIntervals: merged
  };
}

export default {
  calculateSweepLine
};
