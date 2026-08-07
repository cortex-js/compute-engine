import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * Mathematica-style surface forms (Tier 1):
 *  - iterator-triple `Set`s `{i, lo, hi}` / `{i, lo, hi, step}` in the
 *    iterator slot of `Sum`, `Product`, `Integrate`, and higher-order `D`;
 *  - the `\mathrm{D}(f, x, …)` function-call derivative;
 *  - the rule-arrow `Limit(f, x -> x0)` form.
 *
 * A fresh engine avoids cross-test contamination of the shared instance.
 */
const ce = new ComputeEngine();

function evalStr(latex: string): string {
  return ce.parse(latex).evaluate().toString();
}

describe('Iterator-triple Sets in the iterator slot', () => {
  test('Sum with a `{i, lo, hi}` triple matches the Element form', () => {
    expect(evalStr('\\mathrm{Sum}(i^2, \\{i, 1, 10\\})')).toBe('385');
    // Same canonical form and result as the Element/Range spec.
    expect(
      ce.box(['Sum', ['Square', 'i'], ['Set', 'i', 1, 10]]).evaluate().json
    ).toEqual(
      ce
        .box(['Sum', ['Square', 'i'], ['Element', 'i', ['Range', 1, 10]]])
        .evaluate().json
    );
  });

  test('Product with a `{i, lo, hi}` triple', () => {
    expect(evalStr('\\mathrm{Product}(i, \\{i, 1, 5\\})')).toBe('120');
  });

  test('Sum with a step: `{i, 0, 10, 2}`', () => {
    expect(evalStr('\\mathrm{Sum}(i, \\{i, 0, 10, 2\\})')).toBe('30');
    expect(
      ce.box(['Sum', 'i', ['Set', 'i', 0, 10, 2]]).evaluate().toString()
    ).toBe('30');
  });

  test('Sum with symbolic bounds `{k, 1, n}` keeps the bounds', () => {
    // Matches the native `\sum_{k=1}^n k` form (symbolic, closed-form-capable).
    expect(evalStr('\\mathrm{Sum}(k, \\{k, 1, n\\})')).toBe(
      evalStr('\\sum_{k=1}^{n} k')
    );
  });

  test('Integrate with a `{x, lo, hi}` triple is a definite integral', () => {
    expect(evalStr('\\mathrm{Integrate}(x^2, \\{x, 0, 1\\})')).toBe('1/3');
    expect(evalStr('\\int_0^1 x^2 dx')).toBe('1/3');
  });

  test('the tuple spelling carries the step, exactly like the Set spelling', () => {
    // `canonicalIndexingSet`'s Tuple branch used to read only the first three
    // operands, silently DROPPING a step: `Sum(k, (k,1,10,2))` answered 55
    // (the unstepped sum) where `{k,1,10,2}` answered 25.
    const both = (spec: (string | number)[], expected: string) => {
      const [, ...rest] = spec;
      for (const head of ['Set', 'Tuple', 'Triple']) {
        if (head === 'Triple' && rest.length !== 3) continue;
        expect(
          ce.box(['Sum', 'k', [head, ...rest] as any] as any).evaluate().toString()
        ).toBe(expected);
      }
    };
    both(['_', 'k', 1, 10, 2], '25');
    both(['_', 'k', 10, 1, -2], '30');
    // The unstepped triple is unchanged.
    both(['_', 'k', 1, 10], '55');

    expect(
      ce.box(['Product', 'k', ['Tuple', 'k', 1, 4, 2]]).evaluate().toString()
    ).toBe(
      ce.box(['Product', 'k', ['Set', 'k', 1, 4, 2]]).evaluate().toString()
    );
    expect(
      ce.box(['Product', 'k', ['Tuple', 'k', 1, 4, 2]]).evaluate().re
    ).toBe(3);
  });

  test('a 4-element integration spec goes inert in BOTH spellings', () => {
    // Integration bounds have no step slot. The `Set` spelling was already
    // unrecognized (→ indefinite integral); the `Tuple` spelling fell through
    // `canonicalLimits`'s arity chain to `Limits(Nothing, Nothing, lo)` and
    // produced a SIGN-FLIPPED `-1/3`.
    const indefinite = ce
      .box(['Integrate', ['Square', 'x'], ['Set', 'x', 0, 1, 5]])
      .evaluate()
      .toString();
    expect(
      ce
        .box(['Integrate', ['Square', 'x'], ['Tuple', 'x', 0, 1, 5]])
        .evaluate()
        .toString()
    ).toBe(indefinite);
    expect(indefinite).toBe('int(x^2 dx)');
    // The 3-element definite form is unchanged in both spellings.
    for (const head of ['Set', 'Tuple'])
      expect(
        ce
          .box(['Integrate', ['Square', 'x'], [head, 'x', 0, 1] as any])
          .evaluate()
          .toString()
      ).toBe('1/3');
  });

  test('malformed Set in the iterator slot keeps today’s behavior', () => {
    // First element not a symbol → not a triple → stays an error, not a guess.
    const j = ce.parse('\\mathrm{Sum}(i^2, \\{1, 2, 3\\})').json as unknown[];
    expect(j[0]).toBe('Sum');
    expect(JSON.stringify(j)).toContain('Error');
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
  test('Table(i^2, {i, 1, 5}) tabulates the squares', () => {
    expect(evalStr('\\mathrm{Table}(i^2, \\{i, 1, 5\\})')).toBe(
      '[1,4,9,16,25]'
    );
  });

  test('Table with a step: {i, 0, 10, 2}', () => {
    expect(evalStr('\\mathrm{Table}(i, \\{i, 0, 10, 2\\})')).toBe(
      '[0,2,4,6,8,10]'
    );
  });

  test('Table with a non-unit lower bound: {i, 3, 5}', () => {
    expect(evalStr('\\mathrm{Table}(i^2, \\{i, 3, 5\\})')).toBe('[9,16,25]');
  });

  test('Table with two specs is a nested table (row order)', () => {
    expect(evalStr('\\mathrm{Table}(i j, \\{i, 1, 2\\}, \\{j, 1, 3\\})')).toBe(
      '[[1,2,3],[2,4,6]]'
    );
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

  test('malformed iterator spec stays inert', () => {
    // The `{i, n}` two-element shorthand is deliberately out of scope: it must
    // not be guessed as `{i, 1, n}`. The expression stays an inert `Table`.
    const expr = ce.box(['Table', 'i', ['Set', 'i', 5]]);
    expect(expr.operator).toBe('Table');
    expect(expr.evaluate().operator).toBe('Table');
  });
});

describe('Table also accepts the TUPLE spelling of an iterator spec', () => {
  // `Sum`/`Product`/`Integrate`/`D` accept both `{i, lo, hi}` and
  // `(i, lo, hi)`; `Table` used to accept only the brace form and sent the
  // tuple to `Tabulate`, which rejected it with `incompatible-type … tuple<…>`.
  //
  // `Table` is `lazy`, so its operands arrive HELD (raw, unbound) on the
  // `ce.box` and Epsil routes and pre-boxed on the `ce.function` route — all
  // three are probed here (see CLAUDE.md, "lazy: true operators").

  /** Materialize the (lazy) collection a `Table` canonicalizes to. */
  const table = (...ops: any[]) =>
    ce.box(['Table', ...ops] as any).evaluate().toString();

  test('box route: `(k, 1, 5)` matches `{k, 1, 5}`', () => {
    expect(table(['Power', 'k', 2], ['Tuple', 'k', 1, 5])).toBe(
      '[1,4,9,16,25]'
    );
    expect(table(['Power', 'k', 2], ['Tuple', 'k', 1, 5])).toBe(
      table(['Power', 'k', 2], ['Set', 'k', 1, 5])
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

  test('descending, mirroring the Set form', () => {
    expect(table(['Power', 'k', 2], ['Tuple', 'k', 5, 1, -1])).toBe(
      '[25,16,9,4,1]'
    );
    // A `hi < lo` triple counts down in the Set form too.
    expect(table(['Power', 'k', 2], ['Tuple', 'k', 5, 1])).toBe(
      table(['Power', 'k', 2], ['Set', 'k', 5, 1])
    );
  });

  test('the arity-named tuple aliases work too', () => {
    expect(table(['Power', 'i', 2], ['Triple', 'i', 1, 4])).toBe('[1,4,9,16]');
  });

  test('a multi-iterator call may MIX the Set and Tuple spellings', () => {
    expect(
      table(['Multiply', 'i', 'j'], ['Set', 'i', 1, 2], ['Tuple', 'j', 1, 3])
    ).toBe('[[1,2,3],[2,4,6]]');
    expect(
      table(['Multiply', 'i', 'j'], ['Tuple', 'i', 1, 2], ['Set', 'j', 1, 3])
    ).toBe('[[1,2,3],[2,4,6]]');
  });

  test('a malformed tuple spec stays inert, exactly like a malformed Set', () => {
    // Non-symbol first element.
    for (const head of ['Set', 'Tuple']) {
      const bad = ce.box(['Table', ['Power', 'k', 2], [head, 5, 1, 2]] as any);
      expect(bad.operator).toBe('Table');
      expect(bad.evaluate().operator).toBe('Table');
    }
    // Wrong arity (the two-element shorthand is not guessed).
    for (const head of ['Set', 'Tuple']) {
      const bad = ce.box(['Table', ['Power', 'k', 2], [head, 'k', 1]] as any);
      expect(bad.operator).toBe('Table');
      expect(bad.evaluate().operator).toBe('Table');
    }
  });

  test('`Pair`/`Single` are NOT iterator-spec heads — the type error is kept', () => {
    // An iterator spec needs 3 or 4 operands, which a `Pair` (always 2) or a
    // `Single` (always 1) can never have. Recognizing those heads would only
    // downgrade a clear `Tabulate` type error to a silently inert `Table`.
    for (const spec of [['Pair', 'k', 1], ['Single', 'k']] as any[]) {
      const bad = ce.box(['Table', ['Power', 'k', 2], spec] as any);
      expect(bad.operator).toBe('Tabulate');
      expect(bad.isValid).toBe(false);
    }
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
    // Parity with the brace spelling and with the plain alias form.
    expect(cx('Table(k^2, {k,1,5})')).toBe('[1,4,9,16,25]');
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
