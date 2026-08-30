/**
 * A memo must not serve an answer derived with the assumptions in force to a
 * read made while they are hidden, or the other way round.
 *
 * The engine hides its assumptions from a computation whose result is going to
 * be STORED (`ce._factSuppressionDepth`), so the same node answers two
 * different questions depending on which side of that window it is read from.
 * Every generation-keyed memo therefore keys on `ce._cacheGeneration()` — the
 * `any` invalidation axis doubled, plus one while the assumptions are hidden —
 * and a `CachedValue` entry carries one cell per side.
 *
 * These tests pin the memo half of that design: the composite key itself, the
 * two cells and their in-flight terminator, the healing of a memo that had no
 * key at all, and the answers a read gets on each side of a window.
 *
 * The store's own mechanics are pinned by `fact-store-phase1.test.ts`, what a
 * fact contributes to a type by `fact-store-phase2.test.ts`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import {
  cachedValue,
  type CachedValue,
} from '../../src/compute-engine/boxed-expression/cache';

import '../utils'; // For snapshot serializers

/** Read `fn()` with the engine's assumptions hidden, the way the fact-index
 * build hides them. */
function withoutFacts<T>(ce: ComputeEngine, fn: () => T): T {
  ce._factSuppressionDepth += 1;
  try {
    return fn();
  } finally {
    ce._factSuppressionDepth -= 1;
  }
}

describe('the composite cache generation', () => {
  test('carries the axis in the high bits and the suppression state in the low bit', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assume(ce.parse('x > 3'));
    const live = ce._cacheGeneration();
    expect(live % 2).toBe(0);
    expect(live >> 1).toBe(ce._anyVersion);

    withoutFacts(ce, () => {
      expect(ce._cacheGeneration()).toBe(live + 1);
      expect(ce._cacheGeneration() >> 1).toBe(ce._anyVersion);
    });

    // The depth is the only thing that moved, so the key comes back to where
    // it was: hiding the facts advances no invalidation axis.
    expect(ce._cacheGeneration()).toBe(live);
  });

  test('does not split the entry when there is nothing to hide', () => {
    // A bracket around a write is opened whether or not anything is assumed,
    // and with an empty store it hides nothing: every reader answers the same
    // on both sides. Splitting the entry anyway would cost a second derivation
    // of every node a write reads, and — worse — leave the LIVE cell of such a
    // node cold, taking away the previous value a self-referential derivation
    // terminates on.
    const ce = new ComputeEngine();
    const live = ce._cacheGeneration();
    withoutFacts(ce, () => expect(ce._cacheGeneration()).toBe(live));
    expect(ce._factSuppressionDepth).toBe(0);

    // The bit appears as soon as there is a fact to hide, and goes away again
    // when it is forgotten.
    ce.declare('y', 'real');
    ce.assume(ce.parse('y > 3'));
    withoutFacts(ce, () => expect(ce._cacheGeneration() % 2).toBe(1));
    ce.forget('y');
    withoutFacts(ce, () => expect(ce._cacheGeneration() % 2).toBe(0));
  });

  test('an assumption advances the axis half', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const before = ce._cacheGeneration();
    ce.assume(ce.parse('x > 3'));
    expect(ce._cacheGeneration() >> 1).toBeGreaterThan(before >> 1);
  });
});

describe('the two cells of a cache entry', () => {
  test('neither side evicts the other', () => {
    let computes = 0;
    const slot: CachedValue<number> = { value: null, generation: -1 };
    const read = (generation: number): number =>
      cachedValue(slot, generation, () => {
        computes += 1;
        return generation;
      });

    // Generation 4 is the live side of axis 2, generation 5 the hidden side.
    expect(read(4)).toBe(4);
    expect(read(5)).toBe(5);
    expect(computes).toBe(2);

    // Alternating between the two sides costs nothing: each side keeps its
    // own answer. With one cell every crossing would be a recomputation.
    expect(read(4)).toBe(4);
    expect(read(5)).toBe(5);
    expect(read(4)).toBe(4);
    expect(read(5)).toBe(5);
    expect(computes).toBe(2);
  });

  test('an answer from one side is never served to the other outside a computation', () => {
    const slot: CachedValue<string> = { value: null, generation: -1 };
    expect(cachedValue(slot, 4, () => 'live')).toBe('live');
    expect(cachedValue(slot, 5, () => 'hidden')).toBe('hidden');
    expect(cachedValue(slot, 4, () => 'recomputed')).toBe('live');
  });

  test('a re-entrant read of an empty cell is served the other one', () => {
    const slot: CachedValue<string> = { value: null, generation: -1 };
    expect(cachedValue(slot, 4, () => 'live')).toBe('live');

    let inner: string | undefined;
    // A first read of the hidden side, which re-enters itself. Its own cell
    // has never held anything, so without the terminator the recursion has
    // nothing to bottom out on.
    const outer = cachedValue(slot, 5, () => {
      inner = cachedValue(slot, 5, () => {
        throw new Error('the re-entrant read must not recompute');
      });
      return 'hidden';
    });
    expect(inner).toBe('live');
    expect(outer).toBe('hidden');
  });

  test('the terminator works in the other direction too', () => {
    const slot: CachedValue<string> = { value: null, generation: -1 };
    expect(cachedValue(slot, 5, () => 'hidden')).toBe('hidden');

    let inner: string | undefined;
    cachedValue(slot, 4, () => {
      inner = cachedValue(slot, 4, () => {
        throw new Error('the re-entrant read must not recompute');
      });
      return 'live';
    });
    expect(inner).toBe('hidden');
  });

  test('the terminator compares the axis half, so an older answer is not served', () => {
    const slot: CachedValue<string> = { value: null, generation: -1 };
    expect(cachedValue(slot, 4, () => 'live at axis 2')).toBe('live at axis 2');

    let inner: string | undefined;
    // The hidden side of axis 3. The other cell holds an axis-2 answer, which
    // is an answer to a different question, so the re-entrant read computes.
    cachedValue(slot, 7, () => {
      inner = cachedValue(slot, 7, () => 'hidden at axis 3');
      return 'outer at axis 3';
    });
    expect(inner).toBe('hidden at axis 3');
  });

  test('a re-entrant read of a cell that already has a value keeps being served it', () => {
    const slot: CachedValue<string> = { value: null, generation: -1 };
    expect(cachedValue(slot, 4, () => 'axis 2')).toBe('axis 2');

    let inner: string | undefined;
    // The classic same-cell window: the key is stamped before the
    // computation runs, so a re-entrant read is answered with the value the
    // cell still holds from the previous axis.
    cachedValue(slot, 6, () => {
      inner = cachedValue(slot, 6, () => {
        throw new Error('the re-entrant read must not recompute');
      });
      return 'axis 3';
    });
    expect(inner).toBe('axis 2');
  });
});

describe('a read on each side of a window', () => {
  test('a function expression answers fact-bearing, fact-free, fact-bearing', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.assume(ce.parse('x > 3'))).toBe('ok');
    const e = ce.box(['Add', 'x', 1]);

    expect(e.type.toString()).toBe('real<4<..>');
    // The same node, with the assumptions hidden: the live answer above must
    // not be served here.
    expect(withoutFacts(ce, () => e.type.toString())).toBe('real');
    // And the fact-free answer must not outlive the window.
    expect(e.type.toString()).toBe('real<4<..>');
  });

  test('alternating reads keep answering correctly', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.assume(ce.parse('x > 3'))).toBe('ok');
    const e = ce.box(['Add', 'x', 1]);

    for (let i = 0; i < 4; i++) {
      expect(e.type.toString()).toBe('real<4<..>');
      expect(withoutFacts(ce, () => e.type.toString())).toBe('real');
    }
  });

  test('a symbol answers on each side', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.assume(ce.parse('x > 3'))).toBe('ok');
    expect(ce.box('x').type.toString()).toBe('real<3<..>');
    expect(withoutFacts(ce, () => ce.box('x').type.toString())).toBe('real');
    expect(ce.box('x').type.toString()).toBe('real<3<..>');
  });
});

describe('a dictionary literal heals when a fact is retracted', () => {
  test('the synthesized record type follows the assumptions', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'real');
    expect(ce.assume(ce.parse('q > 3'))).toBe('ok');

    const d = ce.box({ dict: { a: ce.symbol('q') } });
    expect(d.type.toString()).toBe('record{a: real<3<..>}');

    // The memo had no key at all before, so this answer used to stand for the
    // life of the literal.
    ce.forget('q');
    expect(d.type.toString()).toBe('record{a: real}');
  });

  test('the literal answers on each side of a window', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'real');
    expect(ce.assume(ce.parse('q > 3'))).toBe('ok');

    const d = ce.box({ dict: { a: ce.symbol('q') } });
    expect(d.type.toString()).toBe('record{a: real<3<..>}');
    expect(withoutFacts(ce, () => d.type.toString())).toBe('record{a: real}');
    expect(d.type.toString()).toBe('record{a: real<3<..>}');
  });
});

describe('recursion that crosses a window', () => {
  test('a self-recursive definition terminates and keeps its type', () => {
    const ce = new ComputeEngine();
    ce.declare('rx', 'real');
    expect(ce.assume(ce.parse('rx > 3'))).toBe('ok');

    ce.pushScope();
    try {
      ce.declare('sr_f', 'function');
      ce.assign(
        'sr_f',
        ce.expr([
          'Function',
          [
            'Block',
            [
              'If',
              ['Equal', 'sr_n', 0],
              'rx',
              ['sr_f', ['Subtract', 'sr_n', 1]],
            ],
          ],
          'sr_n',
        ])
      );

      const call = ce.expr(['sr_f', 3]);
      expect(call.type.toString()).toBe('number');
      // The derivation re-enters the same nodes, and on this side of the
      // window their cells are empty: it terminates through the value the
      // live side is holding for them.
      expect(withoutFacts(ce, () => call.type.toString())).toBe('number');
      expect(call.type.toString()).toBe('number');
      expect(ce.expr(['sr_f', 3]).evaluate().symbol).toBe('rx');
    } finally {
      ce.popScope();
    }
  });

  test('a mutually recursive pair terminates and keeps its type', () => {
    const ce = new ComputeEngine();
    ce.declare('rx', 'real');
    expect(ce.assume(ce.parse('rx > 3'))).toBe('ok');

    ce.pushScope();
    try {
      ce.declare('mr_isEven', 'function');
      ce.declare('mr_isOdd', 'function');
      ce.assign(
        'mr_isEven',
        ce.expr([
          'Function',
          [
            'Block',
            [
              'If',
              ['Equal', 'mr_en', 0],
              'rx',
              ['mr_isOdd', ['Subtract', 'mr_en', 1]],
            ],
          ],
          'mr_en',
        ])
      );
      ce.assign(
        'mr_isOdd',
        ce.expr([
          'Function',
          [
            'Block',
            [
              'If',
              ['Equal', 'mr_on', 0],
              ['Negate', 'rx'],
              ['mr_isEven', ['Subtract', 'mr_on', 1]],
            ],
          ],
          'mr_on',
        ])
      );

      const call = ce.expr(['mr_isEven', 4]);
      expect(call.type.toString()).toBe('number');
      expect(withoutFacts(ce, () => call.type.toString())).toBe('number');
      expect(call.type.toString()).toBe('number');
      expect(ce.expr(['mr_isEven', 4]).evaluate().symbol).toBe('rx');
      expect(ce.expr(['mr_isOdd', 3]).evaluate().symbol).toBe('rx');
    } finally {
      ce.popScope();
    }
  });

  test('a definition read for the first time inside a window terminates', () => {
    const ce = new ComputeEngine();
    ce.declare('rx', 'real');
    expect(ce.assume(ce.parse('rx > 3'))).toBe('ok');

    ce.pushScope();
    try {
      ce.declare('sr_g', 'function');
      ce.assign(
        'sr_g',
        ce.expr([
          'Function',
          [
            'Block',
            [
              'If',
              ['Equal', 'sr_m', 0],
              'rx',
              ['sr_g', ['Subtract', 'sr_m', 1]],
            ],
          ],
          'sr_m',
        ])
      );

      // No live read first: the whole derivation happens with the assumptions
      // hidden, so the terminator has only its own cells to work with.
      const call = ce.expr(['sr_g', 3]);
      expect(withoutFacts(ce, () => call.type.toString())).toBe('number');
      expect(call.type.toString()).toBe('number');
    } finally {
      ce.popScope();
    }
  });
});
