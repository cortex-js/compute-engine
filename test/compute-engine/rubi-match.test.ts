// Regression test for the Rubi matcher's deadline support
// (scripts/rubi/match.ts). The backtracking AC matcher can, on pathological
// patterns, explore a large space; matchAll threads the driver deadline so
// a single rule's match cannot overrun the driver's timeLimitMs. See
// docs/rubi/RUBI.md §5 (Phase R2, driver-overrun).

import { ComputeEngine } from '../../src/compute-engine';
import { matchAll } from '../../src/compute-engine/rubi/match';
import type { Pat } from '../../src/compute-engine/rubi/match';

let ce: ComputeEngine;

beforeAll(() => {
  ce = new ComputeEngine();
});

describe('matchAll deadline', () => {
  // a Multiply-of-slots pattern against a many-factor product enumerates a
  // large number of binding environments — millions of internal match steps
  // when the env cap is high
  const heavyPat = (): Pat => ({
    kind: 'node',
    op: 'Multiply',
    ac: true,
    ops: Array.from({ length: 9 }, (_, i) => ({
      kind: 'slot' as const,
      name: 's' + i,
    })),
  });
  const heavyExpr = () => ce.box(['Multiply', ...'abcdefghi'.split('')]);

  test('without a deadline, enumeration runs to the cap', () => {
    const envs = matchAll(heavyPat(), heavyExpr(), ce.symbol('x'), 1000);
    expect(envs.length).toBe(1000);
  });

  test('a passed deadline aborts the match with CancellationError', () => {
    let caught: unknown;
    try {
      // deadline already in the past: the first strided check throws
      matchAll(heavyPat(), heavyExpr(), ce.symbol('x'), 100000, Date.now() - 1);
    } catch (e) {
      caught = e;
    }
    expect((caught as Error | undefined)?.constructor.name).toBe(
      'CancellationError'
    );
  });

  test('a future deadline does not disturb a fast match', () => {
    // a small match completes well within the deadline and returns normally
    const pat: Pat = {
      kind: 'node',
      op: 'Multiply',
      ac: true,
      ops: [
        { kind: 'slot', name: 'a' },
        { kind: 'slot', name: 'b' },
      ],
    };
    const envs = matchAll(
      pat,
      ce.box(['Multiply', 'p', 'q']),
      ce.symbol('x'),
      8,
      Date.now() + 60_000
    );
    expect(envs.length).toBeGreaterThan(0);
  });
});
