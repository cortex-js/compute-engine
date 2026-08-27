import { ComputeEngine } from '../../src/compute-engine';
import {
  beginBroadcastCell,
  endBroadcastCell,
  inBroadcastCell,
} from '../../src/compute-engine/boxed-expression/broadcast-cell-widening';

/**
 * A number literal's type is withheld — the bare tier answers instead — while
 * the interpreter computes a broadcast cell. The window exists to keep the
 * interpreter from deriving a per-cell literal type that nobody reads, so the
 * two things worth pinning are that it still WIDENS where it should, and that
 * it never becomes visible to a caller.
 *
 * These pins fail if the seam is removed (no widening at all) and if it is
 * over-applied (widening escaping into a value a caller can read).
 */
describe('broadcast cell widening', () => {
  const ce = new ComputeEngine();

  describe('precision is preserved outside the window', () => {
    test('a bare literal keeps its literal type', () => {
      expect(ce.box(2).type.toString()).toBe('2');
      expect(ce.box(0.5).type.toString()).toBe('0.5');
      expect(ce.box(0.754).type.toString()).toBe('0.754');
    });

    test('an exact rational keeps its singleton-range literal type', () => {
      expect(ce.parse('\\frac{1}{2}').evaluate().type.toString()).toBe(
        'finite_rational<0.5..0.5>'
      );
    });

    test('elements drained from a broadcast keep their literal types', () => {
      // The classification read a caller makes on a resolved collection. The
      // cells were produced INSIDE the window, so this is what a memo poisoned
      // by the window would break.
      const m = ce.box([
        'Map',
        ['Function', ['Divide', 'x', 4], 'x'],
        ['Range', 1, 3],
      ]);
      const els = [...(m.evaluate() as any).each()];
      expect(els.map((e) => e.type.toString())).toEqual([
        'finite_rational<0.25..0.25>',
        'finite_rational<0.5..0.5>',
        'finite_rational<0.75..0.75>',
      ]);
    });

    test('tuple components of drained cells stay precise', () => {
      // Point classification reads the CLOSED literal type of a component, so
      // the precision has to survive one level down as well.
      const m = ce.box([
        'Map',
        ['Function', ['Tuple', ['Divide', 'x', 2], 1], 'x'],
        ['Range', 1, 2],
      ]);
      const els = [...(m.evaluate() as any).each()];
      expect(els.map((e) => e.ops[0].type.toString())).toEqual([
        'finite_rational<0.5..0.5>',
        '1',
      ]);
    });

    test('typing a list of literal tuples leaves the tuples precise', () => {
      // Deriving a list's shape reads each cell's type. That read is widened
      // only for a NUMBER-LITERAL leaf: a composite cell computes and caches
      // its type, and that memo is not covered by the no-memo-write rule, so a
      // widened component would outlive the window.
      //
      // An invariant pin, not a reproduced bug: the storage boundary widens a
      // stored composite type to its tiers anyway, so today both a leaf-only
      // and an ambient window give these same answers. It fails if that
      // storage-boundary widening changes and the read here is ambient again.
      const lst = ce.box(['List', ['Tuple', 0.5, 2], ['Tuple', 1.5, 3]]);
      expect(lst.type.toString()).toBe(
        'list<tuple<finite_real, finite_integer>^2>'
      );
      const tuple = lst.ops[0];
      expect(tuple.type.toString()).toBe('tuple<finite_real, finite_integer>');
      expect(tuple.ops.map((o) => o.type.toString())).toEqual(['0.5', '2']);
    });
  });

  describe('the window itself', () => {
    test('is closed by default and re-entrant', () => {
      expect(inBroadcastCell(ce)).toBe(false);
      beginBroadcastCell(ce);
      expect(inBroadcastCell(ce)).toBe(true);
      beginBroadcastCell(ce);
      endBroadcastCell(ce);
      // Still open: a nested broadcast closing its own window must not
      // re-expose literal types to the outer one.
      expect(inBroadcastCell(ce)).toBe(true);
      endBroadcastCell(ce);
      expect(inBroadcastCell(ce)).toBe(false);
    });

    test('is tracked per engine', () => {
      // A handler running for one engine may synchronously touch another
      // engine's literals; those must keep answering precisely.
      const other = new ComputeEngine();
      beginBroadcastCell(ce);
      try {
        expect(inBroadcastCell(ce)).toBe(true);
        expect(inBroadcastCell(other)).toBe(false);
        expect(other.box(0.5).type.toString()).toBe('0.5');
      } finally {
        endBroadcastCell(ce);
      }
    });

    test('withholds the literal type while open', () => {
      const half = ce.parse('\\frac{1}{2}').evaluate();
      const two = ce.box(2);
      beginBroadcastCell(ce);
      try {
        // The tier, not the value.
        expect(half.type.toString()).toBe('finite_rational');
        expect(two.type.toString()).toBe('finite_integer');
      } finally {
        endBroadcastCell(ce);
      }
    });

    test('does not poison the memo it bypasses', () => {
      // Reading inside the window FIRST is the ordering a memo write under the
      // window would corrupt.
      const x = ce.parse('\\frac{3}{4}').evaluate();
      beginBroadcastCell(ce);
      try {
        expect(x.type.toString()).toBe('finite_rational');
      } finally {
        endBroadcastCell(ce);
      }
      expect(x.type.toString()).toBe('finite_rational<0.75..0.75>');
    });
  });

  describe('the seams that open it', () => {
    const probeEngine = (seen: boolean[]) => {
      const e = new ComputeEngine();
      e.declare('CellProbe', {
        signature: '(number) -> number',
        evaluate: (ops) => {
          seen.push(inBroadcastCell(e));
          return ops[0];
        },
      });
      return e;
    };

    test('the Map drain opens the window around each cell', () => {
      // Pins the SEAM, not just the switch: without the wrapper every
      // observation is `false` and the widening is dead code that still
      // passes every other test here.
      const seen: boolean[] = [];
      const e = probeEngine(seen);
      const m = e.box([
        'Map',
        ['Function', ['CellProbe', 'x'], 'x'],
        ['Range', 1, 3],
      ] as any);
      const els = [...(m.evaluate() as any).each()];
      expect(els).toHaveLength(3);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((x) => x === true)).toBe(true);
      expect(inBroadcastCell(e)).toBe(false);
    });

    test('indexed access opens the window too', () => {
      // `at(i)` computes a cell just as `each()` does. If only one route
      // opened the window, the same element would answer type questions
      // differently depending on how it was reached.
      const seen: boolean[] = [];
      const e = probeEngine(seen);
      const m = e.box([
        'Map',
        ['Function', ['CellProbe', 'x'], 'x'],
        ['Range', 1, 5],
      ] as any);
      const el = (m.evaluate() as any).at(2);
      expect(el?.toString()).toBe('2');
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((x) => x === true)).toBe(true);
      expect(inBroadcastCell(e)).toBe(false);
    });

    test('a cell body that builds a list nests the seams correctly', () => {
      // Shape derivation runs INSIDE the drain's window here, so the two
      // seams overlap. The counter must unwind to zero, and the shape must be
      // the one an un-nested derivation gives.
      const m = ce.box([
        'Map',
        ['Function', ['List', 'x', ['Add', 'x', 1]], 'x'],
        ['Range', 1, 3],
      ] as any);
      const els = [...(m.evaluate() as any).each()];
      expect(els.map((e) => e.toString())).toEqual(['[1,2]', '[2,3]', '[3,4]']);
      expect(els[0].type.toString()).toBe('vector<finite_integer^2>');
      expect(inBroadcastCell(ce)).toBe(false);
    });

    test('a throw from a cell still closes the window', () => {
      const e = new ComputeEngine();
      e.declare('CellBoom', {
        signature: '(number) -> number',
        evaluate: () => {
          throw new Error('boom');
        },
      });
      const m = e.box([
        'Map',
        ['Function', ['CellBoom', 'x'], 'x'],
        ['Range', 1, 3],
      ] as any);
      expect(() => [...(m.evaluate() as any).each()]).toThrow('boom');
      // The `finally` in `computeBroadcastCell` is what makes this hold; a
      // hand-rolled increment/decrement pair would leak the window and widen
      // every literal in the engine from here on.
      expect(inBroadcastCell(e)).toBe(false);
    });
  });

  describe('diagnostics', () => {
    test('a per-element diagnostic names the value, not the tier', () => {
      // The window covers what the interpreter asks itself; a message is read
      // by a person, so it must still name `2.5` rather than `finite_real`.
      const m = ce.box([
        'Map',
        ['Function', ['Add', 'x', 1], ['Typed', 'x', 'integer']],
        ['List', 1, 2.5, 3],
      ] as any);
      expect(m.evaluate().toString()).toBe(
        '[2,Error(ErrorCode("incompatible-type", "integer", "2.5"), 2.5),4]'
      );
    });

    test('a reported type that is not the operand’s is left alone', () => {
      // The recovery only re-reads when the reported text matches what the
      // operand currently answers. A caller naming a DIFFERENT type must get
      // that type through untouched, window or no window.
      const operand = ce.box(2.5);
      beginBroadcastCell(ce);
      try {
        const err = ce.typeError('integer', 'string', operand);
        expect(err.toString()).toContain('string');
        expect(err.toString()).not.toContain('finite_real');
      } finally {
        endBroadcastCell(ce);
      }
    });
  });

  test('broadcast values are unchanged by the widening', () => {
    const m = ce.box([
      'Map',
      ['Function', ['Divide', 'x', 4], 'x'],
      ['Range', 1, 6],
    ]);
    const els = [...(m.evaluate() as any).each()];
    expect(els.map((e) => e.toString())).toEqual([
      '1/4',
      '1/2',
      '3/4',
      '1',
      '5/4',
      '3/2',
    ]);
  });
});
