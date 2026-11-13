import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSweepLine } from '../src/sweep_line.js';
import { computeIntervalUnion } from '../src/cpp_bridge.js';

describe('Sweep-Line Interval Union & Self-Time Engine', () => {

  test('no children returns parent duration as self-time', () => {
    const parent = { start: 1000, end: 2000 };
    const res = calculateSweepLine(parent, []);
    assert.equal(res.parentDuration, 1000);
    assert.equal(res.childUnionDuration, 0);
    assert.equal(res.selfTime, 1000);
    assert.equal(res.mergedIntervals.length, 0);
  });

  test('single child inside parent calculates correct self-time', () => {
    const parent = { start: 100, end: 500 };
    const children = [{ start: 200, end: 350 }];
    const res = calculateSweepLine(parent, children);
    assert.equal(res.parentDuration, 400);
    assert.equal(res.childUnionDuration, 150);
    assert.equal(res.selfTime, 250);
    assert.deepEqual(res.mergedIntervals, [{ start: 200, end: 350 }]);
  });

  test('multiple disjoint children sum union correctly', () => {
    const parent = { start: 0, end: 1000 };
    const children = [
      { start: 100, end: 200 },
      { start: 400, end: 600 }
    ];
    const res = calculateSweepLine(parent, children);
    assert.equal(res.parentDuration, 1000);
    assert.equal(res.childUnionDuration, 300);
    assert.equal(res.selfTime, 700);
    assert.equal(res.mergedIntervals.length, 2);
  });

  test('concurrent overlapping children are merged without double-counting', () => {
    const parent = { start: 100, end: 600 };
    const children = [
      { start: 200, end: 400 },
      { start: 300, end: 500 }
    ];
    const res = calculateSweepLine(parent, children);
    assert.equal(res.parentDuration, 500);
    assert.equal(res.childUnionDuration, 300); // [200, 500]
    assert.equal(res.selfTime, 200);
    assert.deepEqual(res.mergedIntervals, [{ start: 200, end: 500 }]);
  });

  test('nested children are completely absorbed', () => {
    const parent = { start: 0, end: 1000 };
    const children = [
      { start: 100, end: 800 },
      { start: 200, end: 400 },
      { start: 300, end: 500 }
    ];
    const res = calculateSweepLine(parent, children);
    assert.equal(res.childUnionDuration, 700);
    assert.equal(res.selfTime, 300);
    assert.deepEqual(res.mergedIntervals, [{ start: 100, end: 800 }]);
  });

  test('contiguous adjacent intervals are merged', () => {
    const parent = { start: 0, end: 1000 };
    const children = [
      { start: 100, end: 200 },
      { start: 200, end: 300 },
      { start: 300, end: 400 }
    ];
    const res = calculateSweepLine(parent, children);
    assert.equal(res.childUnionDuration, 300);
    assert.equal(res.selfTime, 700);
    assert.deepEqual(res.mergedIntervals, [{ start: 100, end: 400 }]);
  });

  test('child out-of-bounds are clipped to parent interval', () => {
    const parent = { start: 100, end: 500 };
    const children = [
      { start: 50, end: 200 },
      { start: 400, end: 600 },
      { start: 700, end: 900 }
    ];
    const res = calculateSweepLine(parent, children);
    assert.equal(res.parentDuration, 400);
    assert.equal(res.childUnionDuration, 200);
    assert.equal(res.selfTime, 200);
    assert.deepEqual(res.mergedIntervals, [
      { start: 100, end: 200 },
      { start: 400, end: 500 }
    ]);
  });

  test('cpp_bridge transparently returns computed self-time', () => {
    const parent = { start: 10, end: 110 };
    const children = [{ start: 20, end: 70 }];
    const res = computeIntervalUnion(parent, children);
    assert.equal(res.parentDuration, 100);
    assert.equal(res.childUnionDuration, 50);
    assert.equal(res.selfTime, 50);
    assert.ok(res.engine === 'cpp20' || res.engine === 'javascript_fallback');
  });
});
