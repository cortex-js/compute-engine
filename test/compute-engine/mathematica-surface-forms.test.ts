import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * Mathematica-style surface forms (Tier 1):
 *  - iterator tuples `(i, lo, hi)` / `(i, lo, hi, step)` in the iterator
 *    slot of `Sum`, `Product`, `Integrate` and `Table` (a set `{i, lo, hi}`
 *    is not an iterator), and the order pair `{x, n}` of a higher-order `D`;
 *  - the `\mathrm{D}(f, x, …)` function-call derivative;
 *  - the rule-arrow `Limit(f, x -> x0)` form.
 *
 * A fresh engine avoids cross-test contamination of the shared instance.
 */
const ce = new ComputeEngine();

function evalStr(latex: string): string {
  return ce.parse(latex).evaluate().toString();
}

describe('Iterator tuples in the iterator slot', () => {
  test('Sum with an `(i, lo, hi)` tuple matches the Element form', () => {
    expect(evalStr('\\mathrm{Sum}(i^2, (i, 1, 10))')).toBe('385');
    // Same canonical form and result as the Element/Range spec.
    expect(
      ce.box(['Sum', ['Square', 'i'], ['Tuple', 'i', 1, 10]]).evaluate().json
    ).toEqual(
      ce
        .box(['Sum', ['Square', 'i'], ['Element', 'i', ['Range', 1, 10]]])
        .evaluate().json
    );
  });

  test('Product with an `(i, lo, hi)` tuple', () => {
    expect(evalStr('\\mathrm{Product}(i, (i, 1, 5))')).toBe('120');
  });

  test('Sum with a step: `(i, 0, 10, 2)`', () => {
    expect(evalStr('\\mathrm{Sum}(i, (i, 0, 10, 2))')).toBe('30');
    expect(
      ce.box(['Sum', 'i', ['Tuple', 'i', 0, 10, 2]]).evaluate().toString()
    ).toBe('30');
  });

  test('Sum with symbolic bounds `(k, 1, n)` keeps the bounds', () => {
    // Matches the native `\sum_{k=1}^n k` form (symbolic, closed-form-capable).
    expect(evalStr('\\mathrm{Sum}(k, (k, 1, n))')).toBe(
      evalStr('\\sum_{k=1}^{n} k')
    );
  });

  test('Integrate with an `(x, lo, hi)` tuple is a definite integral', () => {
    expect(evalStr('\\mathrm{Integrate}(x^2, (x, 0, 1))')).toBe('1/3');
    expect(evalStr('\\int_0^1 x^2 dx')).toBe('1/3');
  });

  test('the tuple spelling carries the step', () => {
    // A clause read from its first three operands only would sum
    // `(k, 1, 10, 2)` over every integer from 1 to 10 (55).
    const sum = (head: string, ...rest: (string | number)[]) =>
      ce.box(['Sum', 'k', [head, ...rest] as any] as any).evaluate().toString();
    expect(sum('Tuple', 'k', 1, 10, 2)).toBe('25');
    expect(sum('Tuple', 'k', 10, 1, -2)).toBe('30');
    // The unstepped triple is unchanged.
    expect(sum('Tuple', 'k', 1, 10)).toBe('55');
    expect(sum('Triple', 'k', 1, 10)).toBe('55');
    expect(
      ce.box(['Product', 'k', ['Tuple', 'k', 1, 4, 2]]).evaluate().re
    ).toBe(3);
  });

  test('a 4-element integration spec is an error', () => {
    // Integration bounds have no step slot (it once fell through
    // `canonicalLimits`'s arity chain to `Limits(Nothing, Nothing, lo)` and
    // gave a SIGN-FLIPPED `-1/3`; then it was left out, and the integral was
    // indefinite).
    expect(
      ce
        .box(['Integrate', ['Square', 'x'], ['Tuple', 'x', 0, 1, 5]])
        .evaluate()
        .toString()
    ).toContain('incompatible-type');
    expect(
      ce
        .box(['Integrate', ['Square', 'x'], ['Tuple', 'x', 0, 1]])
        .evaluate()
        .toString()
    ).toBe('1/3');
  });

  test('a set is not an iterator: its elements have no order', () => {
    // `{i, 1, 10}` (Mathematica's list) is a set here: Sum, Product and
    // Integrate give an error instead of reading it as bounds.
    expect(evalStr('\\mathrm{Sum}(i^2, \\{i, 1, 10\\})')).toContain('Error');
    expect(
      ce.box(['Product', 'i', ['Set', 'i', 1, 5]]).evaluate().toString()
    ).toContain('Error');
    expect(
      ce
        .box(['Integrate', ['Square', 'x'], ['Set', 'x', 0, 1]])
        .evaluate()
        .toString()
    ).toContain('Error');
  });

  test('a `Set` outside an iterator slot is still a plain Set', () => {
    expect(ce.parse('\\{1, 2, 3\\}').json).toEqual(['Set', 1, 2, 3]);
    expect(ce.box(['Set', 1, 2, 3]).json).toEqual(['Set', 1, 2, 3]);
  });
});

describe('\\mathrm{D} function-call derivative', () => {
  test('D(f, x) is the derivative operator', () => {
    expect(evalStr('\\mathrm{D}(x^3, x)')).toBe('3x^2');
  });

  test('D(f, x, y) is a sequential partial derivative', () => {
    expect(
      ce.parse('\\mathrm{D}(x^2 y^2, x, y)').evaluate().isSame(ce.parse('4xy'))
    ).toBe(true);
  });

  test('D(f, {x, n}) is the n-th derivative', () => {
    expect(evalStr('\\mathrm{D}(x^3, \\{x, 2\\})')).toBe('6x');
    expect(evalStr('\\mathrm{D}(x^4, \\{x, 3\\})')).toBe('24x');
  });

  test('a bare \\mathrm{D} stays the D_upright glyph', () => {
    expect(ce.parse('\\mathrm{D}', { canonical: false }).json).toBe(
      'D_upright'
    );
  });
});

describe('Table (alias for Tabulate) with iterator specs', () => {
  test('Table(i^2, (i, 1, 5)) tabulates the squares', () => {
    expect(evalStr('\\mathrm{Table}(i^2, (i, 1, 5))')).toBe('[1,4,9,16,25]');
  });

  test('Table with a step: (i, 0, 10, 2)', () => {
    expect(evalStr('\\mathrm{Table}(i, (i, 0, 10, 2))')).toBe(
      '[0,2,4,6,8,10]'
    );
  });

  test('Table with a non-unit lower bound: (i, 3, 5)', () => {
    expect(evalStr('\\mathrm{Table}(i^2, (i, 3, 5))')).toBe('[9,16,25]');
  });

  test('Table with two specs is a nested table (row order)', () => {
    expect(evalStr('\\mathrm{Table}(i j, (i, 1, 2), (j, 1, 3))')).toBe(
      '[[1,2,3],[2,4,6]]'
    );
  });

  test('a set is not a Table iterator', () => {
    // The `Set` is an ordinary operand: `Tabulate` rejects it as a dimension.
    const t = ce.box(['Table', 'i', ['Set', 'i', 1, 5]]);
    expect(t.operator).toBe('Tabulate');
    expect(t.isValid).toBe(false);
  });

  test('alias form: Table(fn, n) matches Tabulate(fn, n)', () => {
    const fn = ['Function', ['Square', '_'], '_'];
    expect(
      ce
        .box(['Table', fn, 5])
        .evaluate()
        .isSame(ce.box(['Tabulate', fn, 5]).evaluate())
    ).toBe(true);
  });

  test('searchDefinitions surfaces Tabulate for "table"', () => {
    expect(ce.searchDefinitions('table').map((r) => r.id)).toContain(
      'Tabulate'
    );
  });

  test('Tabulate is a lazy indexed collection — count is O(1), no materialization', () => {
    // A million-element tabulation must NOT be materialized to be bound or
    // counted (the old eager handler hung here).
    const t = ce.box(['Tabulate', ['Function', ['Square', 'i'], 'i'], 1e6]);
    const ev = t.evaluate();
    expect(ev.operator).toBe('Tabulate');
    expect(ev.isCollection).toBe(true);
    expect(ev.count).toBe(1e6);
    // Indexed (serializes as a list `[…]`, not a set `{…}`); elements on demand.
    expect(ev.at(3)?.toString()).toBe('9');
    expect(ev.at(-1)?.toString()).toBe('1000000000000');
  });

  test('the `(i, n)` two-element spec is `(i, 1, n)`', () => {
    expect(
      ce
        .box(['Table', 'i', ['Tuple', 'i', 5]])
        .evaluate()
        .toString()
    ).toBe('[1,2,3,4,5]');
  });

  test('malformed iterator spec stays inert', () => {
    // A spec whose first element is not a symbol is not guessed.
    const expr = ce.box(['Table', 'i', ['Tuple', 5, 1, 3]]);
    expect(expr.operator).toBe('Table');
    expect(expr.evaluate().operator).toBe('Table');
  });
});

describe('Table accepts the TUPLE spelling of an iterator spec', () => {
  // `Sum`/`Product`/`Integrate` read `(i, lo, hi)`; so does `Table`.
  //
  // `Table` is `lazy`, so its operands arrive HELD (raw, unbound) on the
  // `ce.box` and Epsil routes and pre-boxed on the `ce.function` route — all
  // three are probed here (see ARCHITECTURE.md, "lazy: true operators").

  /** Materialize the (lazy) collection a `Table` canonicalizes to. */
  const table = (...ops: any[]) =>
    ce.box(['Table', ...ops] as any).evaluate().toString();

  test('box route: `(k, 1, 5)`', () => {
    expect(table(['Power', 'k', 2], ['Tuple', 'k', 1, 5])).toBe(
      '[1,4,9,16,25]'
    );
  });

  test('the index symbol is not canonicalized (`i` stays an index, not `i`)', () => {
    // The whole reason `Table` is lazy: a canonicalized `i` would fold to the
    // imaginary unit before the handler could read it as an iterator index.
    expect(table(['Power', 'i', 2], ['Tuple', 'i', 1, 5])).toBe(
      '[1,4,9,16,25]'
    );
  });

  test('with a step: `(k, 1, 10, 2)`', () => {
    expect(table('k', ['Tuple', 'k', 1, 10, 2])).toBe('[1,3,5,7,9]');
  });

  test('descending, with a negative step', () => {
    expect(table(['Power', 'k', 2], ['Tuple', 'k', 5, 1, -1])).toBe(
      '[25,16,9,4,1]'
    );
  });

  test('the arity-named tuple aliases work too', () => {
    expect(table(['Power', 'i', 2], ['Triple', 'i', 1, 4])).toBe('[1,4,9,16]');
  });

  test('a multi-iterator call may MIX tuple and `in` iterators', () => {
    expect(
      table(
        ['Multiply', 'i', 'j'],
        ['Element', 'i', ['Range', 1, 2]],
        ['Tuple', 'j', 1, 3]
      )
    ).toBe('[[1,2,3],[2,4,6]]');
    expect(
      table(
        ['Multiply', 'i', 'j'],
        ['Tuple', 'i', 1, 2],
        ['Element', 'j', ['List', 1, 2, 3]]
      )
    ).toBe('[[1,2,3],[2,4,6]]');
  });

  test('a malformed tuple spec stays inert', () => {
    // Non-symbol first element.
    const bad = ce.box(['Table', ['Power', 'k', 2], ['Tuple', 5, 1, 2]] as any);
    expect(bad.operator).toBe('Table');
    expect(bad.evaluate().operator).toBe('Table');
    // Wrong arity: one operand, or more than four.
    for (const spec of [
      ['Tuple', 'k'],
      ['Tuple', 'k', 1, 10, 2, 7],
    ]) {
      const bad = ce.box(['Table', ['Power', 'k', 2], spec] as any);
      expect(bad.operator).toBe('Table');
      expect(bad.evaluate().operator).toBe('Table');
    }
  });

  test('`Pair` is an iterator-spec head (`{k, n}`), `Single` is not', () => {
    // An iterator spec has 2, 3 or 4 operands, so the 2-tuple alias `Pair` is
    // the `(k, n)` spelling. A `Single` (always 1 operand) can never be a
    // spec: recognizing it would only downgrade a clear `Tabulate` type error
    // to a silently inert `Table`.
    expect(table(['Power', 'k', 2], ['Pair', 'k', 3])).toBe('[1,4,9]');
    const bad = ce.box(['Table', ['Power', 'k', 2], ['Single', 'k']] as any);
    expect(bad.operator).toBe('Tabulate');
    expect(bad.isValid).toBe(false);
  });

  test('the plain alias form is untouched: an integer is NOT an iterator spec', () => {
    const fn = ['Function', ['Square', '_'], '_'];
    expect(ce.box(['Table', fn, 5]).operator).toBe('Tabulate');
    expect(ce.box(['Table', fn, 5, 2]).operator).toBe('Tabulate');
  });

  test('ce.function route (pre-boxed operands)', () => {
    const body = ce.box(['Power', 'k', 2], { canonical: false });
    const spec = ce.box(['Tuple', 'k', 1, 5], { canonical: false });
    expect(ce.function('Table', [body, spec]).evaluate().toString()).toBe(
      '[1,4,9,16,25]'
    );
  });

  test('Epsil route: `Table(k^2, (k,1,5))`', () => {
    const cx = (source: string) => {
      const e = new ComputeEngine();
      const { value, diagnostics } = executeEpsil(e, source);
      expect(diagnostics).toEqual([]);
      return value.toString();
    };
    expect(cx('Table(k^2, (k,1,5))')).toBe('[1,4,9,16,25]');
    expect(cx('Table(k^2, (k,1,10,2))')).toBe('[1,9,25,49,81]');
    // Parity with the `in` iterator and with the plain alias form.
    expect(cx('Table(k^2, k in 1..5)')).toBe('[1,4,9,16,25]');
    expect(cx('Table(k^2, 5)')).toBe('[1,4,9,16,25]');
  });
});

describe('Limit with a rule-arrow argument', () => {
  test('Limit(f, x -> x0) evaluates the two-sided limit', () => {
    expect(evalStr('\\mathrm{Limit}(\\frac{\\sin x}{x}, x\\to 0)')).toBe('1');
    // Matches the native `\lim` form.
    expect(evalStr('\\lim_{x\\to 0}\\frac{\\sin x}{x}')).toBe('1');
  });
});
