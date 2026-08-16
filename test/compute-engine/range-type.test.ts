import { ComputeEngine } from '../../src/compute-engine';

describe('Range dynamic type narrowing', () => {
  const ce = new ComputeEngine();

  test('Range with integer endpoints types as the `range` index span', () => {
    // Since the `range` type landed, a Range that qualifies as an INDEX SPAN
    // (integer bounds, >= 1, ascending, step 1, finite) reports the narrower
    // `range` rather than `indexed_collection<integer>`. It is still an
    // indexed collection of integers — the narrowing loses no element
    // information. See `docs/STRING_ROADMAP.md`, "The `range` type".
    const r = ce.expr(['Range', 1, 9]);
    expect(String(r.type)).toBe('range');
    expect(r.type.matches('indexed_collection<integer>')).toBe(true);
  });

  test('Range with integer step types as indexed_collection<integer>', () => {
    // A STEPPED range is a gather, not a contiguous span, so it keeps the
    // wider type.
    const r = ce.expr(['Range', 1, 9, 2]);
    expect(String(r.type)).toContain('integer');
  });

  test('Range with float step types as indexed_collection<number>', () => {
    const r = ce.expr(['Range', 0, 1, 0.1]);
    expect(String(r.type)).toContain('number');
    expect(String(r.type)).not.toMatch(/integer/);
  });

  test('Range with symbolic step types as indexed_collection<number>', () => {
    ce.declare('s', 'number');
    const r = ce.expr(['Range', 0, 1, ce.symbol('s')]);
    expect(String(r.type)).toContain('number');
  });

  test('Range with fractional lower bound types as number, not integer', () => {
    // Reviewer P2: Range(0.5, 2.5) iterates 0.5, 1.5, 2.5 — element type
    // must be number, not integer.
    const t = String(ce.expr(['Range', 0.5, 2.5]).type);
    expect(t).toContain('number');
    expect(t).not.toMatch(/integer/);
  });

  test('Range with fractional upper bound types as number, not integer', () => {
    const t = String(ce.expr(['Range', 1, 4.5]).type);
    expect(t).toContain('number');
    expect(t).not.toMatch(/integer/);
  });
});

describe('the `range` index-span type', () => {
  const ce = new ComputeEngine();
  const typeOf = (expr: any): string => String(ce.expr(expr).type);

  describe('what qualifies as an index span', () => {
    test.each([
      [['Range', 2, 5], 'explicit ascending bounds'],
      [['Range', 1, 1], 'a single index'],
      [['Range', 4], 'the one-argument form, which means 1..n'],
      [['Range', 1, 10, 1], 'an explicit step of 1'],
    ])('%j qualifies (%s)', (expr) => {
      expect(typeOf(expr)).toBe('range');
    });

    test.each([
      [['Range', 1, 10, 2], 'a step other than 1 is a gather, not a span'],
      [['Range', 5, 2], 'descending'],
      [['Range', 1, 0], 'descending — and NOT an empty span: it is [1, 0]'],
      [['Range', 0, 5], '0 is not a valid 1-based index'],
      [['Range', -3, 5], 'negative bounds are not indices'],
      [['Range', 0.5, 2.5], 'fractional bounds iterate halves, not indices'],
      [['Range', 1, 4.5], 'a fractional upper bound'],
      [['Range', 1, 'oo'], 'an infinite span is not a finite index span'],
      [['Range', 'a', 'b'], 'symbolic bounds are not provably a span'],
    ])('%j does NOT qualify (%s)', (expr) => {
      expect(typeOf(expr)).not.toBe('range');
    });
  });

  describe('lattice placement', () => {
    const t = (s: string) => ce.type(s);

    test('a range is an indexed collection of integers', () => {
      expect(t('range').matches('indexed_collection')).toBe(true);
      expect(t('range').matches('indexed_collection<integer>')).toBe(true);
      expect(t('range').matches('collection<number>')).toBe(true);
      expect(t('range').matches('value')).toBe(true);
    });

    test('a range is a SIBLING of list, not a subtype of it', () => {
      // Neither direction holds: a `Range` value is not a `List`, and an
      // arbitrary indexed collection is not an index span.
      expect(t('range').matches('list')).toBe(false);
      expect(t('range').matches('list<integer>')).toBe(false);
      expect(t('indexed_collection<integer>').matches('range')).toBe(false);
      expect(t('list<integer>').matches('range')).toBe(false);
    });

    test('a range is not a collection of the wrong element type', () => {
      expect(t('range').matches('indexed_collection<string>')).toBe(false);
    });
  });

  describe('the narrowing does not perturb downstream typing', () => {
    // The `range` type must behave exactly as `indexed_collection<integer>`
    // did wherever an element type is read; these are the paths that
    // regressed while it was being added (type-variable binding and the
    // shape-preserving Map result).
    test('a type variable binds to the element type through a span', () => {
      expect(String(ce.expr(['Sort', ['Range', 1, 5]]).type)).toBe(
        'list<integer>'
      );
    });

    test('mapping a span yields an ordered collection, not a set', () => {
      const mapped = ce
        .expr(['Map', ['Function', ['Multiply', 'x', 2], 'x'], ['Range', 1, 3]])
        .evaluate();
      expect(mapped.toString()).toBe('[2,4,6]');
    });

    test('a span still enumerates and measures as before', () => {
      expect(ce.expr(['Length', ['Range', 2, 5]]).evaluate().re).toBe(4);
      expect(ce.expr(['Sum', ['Range', 1, 4]]).evaluate().re).toBe(10);
    });

    test('a symbol DECLARED `range` is admissible in a numeric broadcast', () => {
      // `typeCouldBeNumericCollection` gates `checkNumericArgs`; while it did
      // not list `range`, `Multiply(r, 2)` on a declared-`range` symbol
      // reported `incompatible-type` even though the equivalent
      // `indexed_collection<integer>` declaration passed. A literal `Range`
      // call was rescued by a later finite-collection branch, so only the
      // declared-symbol route exposed it.
      const engine = new ComputeEngine();
      engine.declare('r', 'range');
      expect(engine.expr(['Multiply', 'r', 2]).type.toString()).not.toBe(
        'error'
      );
      expect(engine.expr(['Add', 'r', 1]).type.toString()).not.toBe('error');
    });
  });

  describe('no operation may CLAIM `range` for a value that is not a span', () => {
    // `range` admits only contiguous ascending runs of positive integers, so
    // any handler that echoes its operand's type must widen for a span
    // operand. Each case below returned `range` at some point during
    // development, for a value that plainly is not one.
    test('Reverse of a span widens (the result is descending)', () => {
      // Per the per-kind result rule (`docs/STRING_ROADMAP.md`, Phase 0b) a
      // non-list indexed operand results in `list<T>`.
      expect(
        ce.function('Reverse', [ce.expr(['Range', 1, 10])]).type.toString()
      ).toBe('list<integer>');
    });

    test('Map over a span with an unknown-typed callback widens', () => {
      const engine = new ComputeEngine();
      engine.declare('f', 'function');
      // Nothing constrains an unknown-typed lambda's output to an ascending
      // span, so echoing the source type would be a false claim.
      expect(
        engine.expr(['Map', 'f', ['Range', 1, 5]]).type.toString()
      ).not.toBe('range');
    });

    test('arithmetic over a span widens', () => {
      // Scaling, shifting and negating all leave the span shape (stepped,
      // non-positive, or descending results).
      for (const e of [
        ['Multiply', ['Range', 1, 3], 2],
        ['Add', ['Range', 1, 3], -2],
        ['Negate', ['Range', 1, 3]],
      ] as any[])
        expect(ce.expr(e).type.toString()).not.toBe('range');
    });
  });
});

describe('Range runtime iteration', () => {
  const ce = new ComputeEngine();

  function values(expr: any): number[] {
    const out: number[] = [];
    for (const v of expr.each()) out.push(v.re);
    return out;
  }

  test('Range(1, 5) → [1, 2, 3, 4, 5]', () => {
    expect(values(ce.expr(['Range', 1, 5]))).toEqual([1, 2, 3, 4, 5]);
  });

  test('Range(5, 1) → [5, 4, 3, 2, 1] (auto-direction)', () => {
    expect(values(ce.expr(['Range', 5, 1]))).toEqual([5, 4, 3, 2, 1]);
  });

  test('Range(10, 0, -2) → [10, 8, 6, 4, 2, 0]', () => {
    expect(values(ce.expr(['Range', 10, 0, -2]))).toEqual([10, 8, 6, 4, 2, 0]);
  });

  test('Range(0, 1, -1) → empty (sign mismatch)', () => {
    expect(values(ce.expr(['Range', 0, 1, -1]))).toEqual([]);
  });

  test('Range(5, 1, 1) → empty (sign mismatch with explicit step)', () => {
    expect(values(ce.expr(['Range', 5, 1, 1]))).toEqual([]);
  });

  test('Range(0, 1, 0.25) → 5 fractional values', () => {
    const out = values(ce.expr(['Range', 0, 1, 0.25]));
    expect(out.length).toBe(5);
    out.forEach((v, k) => expect(v).toBeCloseTo(k * 0.25, 10));
  });

  test('Range(0, 1, 0) → empty (zero step)', () => {
    expect(values(ce.expr(['Range', 0, 1, 0]))).toEqual([]);
  });

  test('Range.at(n) returns undefined past end for sign-mismatched range', () => {
    const r = ce.expr(['Range', 0, 1, -1]);
    expect((r as any).at(1)).toBeUndefined();
  });
});

describe('Range collection handlers', () => {
  const ce = new ComputeEngine();

  test('count: empty range with sign-mismatched explicit step returns 0', () => {
    expect(ce.expr(['Range', 5, 1, 1]).count).toBe(0);
    expect(ce.expr(['Range', 0, 1, -1]).count).toBe(0);
  });

  test('count: normal ranges agree with iteration length', () => {
    expect(ce.expr(['Range', 1, 5]).count).toBe(5);
    expect(ce.expr(['Range', 5, 1]).count).toBe(5);
    expect(ce.expr(['Range', 0, 1, 0.25]).count).toBe(5);
  });

  test('contains: integer target on integer range', () => {
    const r = ce.expr(['Range', 0, 10, 2]);
    expect(r.contains(ce.number(4))).toBe(true);
    expect(r.contains(ce.number(3))).toBe(false); // off-grid
    expect(r.contains(ce.number(11))).toBe(false); // past upper
  });

  test('contains: fractional target on fractional range', () => {
    const r = ce.expr(['Range', 0, 1, 0.25]);
    expect(r.contains(ce.number(0.5))).toBe(true);
    expect(r.contains(ce.number(0.3))).toBe(false); // off-grid
    expect(r.contains(ce.number(1))).toBe(true);
  });

  test('contains: returns false for empty (sign-mismatched) range', () => {
    const r = ce.expr(['Range', 0, 1, -1]);
    expect(r.contains(ce.number(0))).toBe(false);
    expect(r.contains(ce.number(1))).toBe(false);
  });

  test('elttype: integer range claims an integer element type', () => {
    // An index span reports the narrower type NAME (`range`), but its
    // elements are still integers — the narrowing loses no element
    // information, so membership in `indexed_collection<integer>` is the
    // assertion that matters here.
    expect(ce.expr(['Range', 1, 9]).type.matches('indexed_collection<integer>'))
      .toBe(true);
    // A stepped range is not a span, so it still spells its element type.
    expect(String(ce.expr(['Range', 1, 9, 2]).type)).toContain('integer');
  });

  test('elttype: fractional-step range claims number element type', () => {
    const t = String(ce.expr(['Range', 0, 1, 0.25]).type);
    expect(t).toContain('number');
    expect(t).not.toMatch(/integer/);
  });
});
