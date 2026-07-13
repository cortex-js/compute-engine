import { ComputeEngine } from '../../src/compute-engine';
import '../utils';

describe('BUG FIXES', () => {
  describe('Bug #24: forget() should clear assumed values', () => {
    test('forget() clears values from evaluation context', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.expr(['Equal', 'x', 5]));
      expect(ce.expr('x').evaluate().json).toEqual(5);
      
      ce.forget('x');
      expect(ce.expr('x').evaluate().json).toEqual('x');
    });
  });

  describe('Bug #25: Scoped assumptions should clean up on popScope()', () => {
    test('popScope() removes values set by assumptions in that scope', () => {
      const ce = new ComputeEngine();
      expect(ce.expr('y').evaluate().json).toEqual('y');
      
      ce.pushScope();
      ce.assume(ce.expr(['Equal', 'y', 10]));
      expect(ce.expr('y').evaluate().json).toEqual(10);
      
      ce.popScope();
      expect(ce.expr('y').evaluate().json).toEqual('y');
    });
  });

  describe('Bug #178: division by expressions that simplify to 0', () => {
    test('0/(1-1) simplifies to NaN, not 0', () => {
      const ce = new ComputeEngine();
      const simp = ce.parse('\\frac{0}{1-1}', { form: 'raw' }).simplify();
      expect(simp.isNaN).toBe(true);
    });

    test('(1-1)/(1-1) simplifies to NaN, not 1', () => {
      const ce = new ComputeEngine();
      const simp = ce
        .parse('\\frac{1-1}{1-1}', { form: 'raw' })
        .simplify();
      expect(simp.isNaN).toBe(true);
    });

  });

  describe('Bug #178: exp(log(x) ± y) should separate the log term', () => {
    // exp(log₁₀ x) = x^(1/ln 10), which CE may render either as a power
    // `x^{1/\ln(10)}` or as the ln(10)-th root `\sqrt[\ln(10)]{x}` (the latter
    // now that `ln(10)` stays the exact symbol rather than a float). The bug is
    // about separating the log term: no `\log` should remain, and the `\ln(10)`
    // factor (from the base-10 → natural-log conversion) must appear.
    test('exp(log(x)+y) has no remaining log()', () => {
      const ce = new ComputeEngine();
      const latex = ce.parse('\\exp(\\log(x)+y)', { form: 'raw' })
        .simplify().latex;
      expect(latex).toContain('\\exponentialE^{y}');
      expect(latex).toContain('\\ln(10)');
      expect(latex).not.toContain('\\log');
    });

    test('exp(log(x)-y) has no remaining log()', () => {
      const ce = new ComputeEngine();
      const latex = ce.parse('\\exp(\\log(x)-y)', { form: 'raw' })
        .simplify().latex;
      expect(latex).toContain('\\ln(10)');
      expect(latex).not.toContain('\\log');
    });
  });

  describe('Bug #178: xx should simplify to x^2', () => {
    test('xx -> x^2', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('xx', { form: 'raw' }).simplify().latex).toBe('x^2');
    });
  });
});

// Regressions distilled from test/playground.ts: behaviors that were once
// broken there and are now fixed. Kept here so they don't silently regress.
describe('Playground regressions', () => {
  test('-i evaluates to the imaginary unit, not NaN (machine precision)', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const r = ce.expr(['Negate', 'i']).evaluate();
    expect(r.isNaN).toBe(false);
    expect(r.json).toEqual(['Complex', 0, -1]);
  });

  test('\\lbrack and \\left\\lbrack parse as half-open intervals', () => {
    // Previously these errored; they should match the ASCII `[` behavior.
    const ce = new ComputeEngine();
    const expected = ['Interval', 5, ['Open', 7]];
    expect(ce.parse('[5,7)').json).toEqual(expected);
    expect(ce.parse('\\lbrack5,7)').json).toEqual(expected);
    expect(ce.parse('\\left\\lbrack5,7\\right)').json).toEqual(expected);
  });

  test('1/(2 sqrt 3) is rationalized to sqrt(3)/6', () => {
    // The 1/2 should be distributed and the denominator rationalized, rather
    // than left as 1/(2√3).
    const ce = new ComputeEngine();
    const canonical = ce.parse('\\frac{1}{2\\sqrt{3}}').canonical;
    // `√3/6` is a number literal (an ExactNumericValue). It serializes in the
    // natural Divide form, which re-boxes to the same literal (RT-P1-1).
    expect(canonical.json).toEqual(['Divide', ['Sqrt', 3], 6]);
    expect(canonical.latex).toBe('\\frac{\\sqrt{3}}{6}');
  });

  test('subscript of a list parses as element access (At) inside a sum', () => {
    // When the subscripted base is a collection, `e_p` is At, not a product.
    const ce = new ComputeEngine();
    ce.declare('e', 'list');
    expect(ce.parse('\\sum_{p=0}^3x_{p}e_{p}').json).toEqual([
      'Sum',
      ['Multiply', 'x_p', ['At', 'e', 'p']],
      ['Limits', 'p', 0, 3],
    ]);
  });

  describe('CORRECTNESS_FINDINGS #30: subs descends into collection/tensor elements', () => {
    test('subs reaches List (BoxedTensor) elements — Median/Mean lists', () => {
      const ce = new ComputeEngine();
      expect(
        ce.box(['Median', ['List', 'a', 'b', 'c']]).subs({ a: ce.number(1) }).json
      ).toEqual(['Median', ['List', 1, 'b', 'c']]);
      expect(
        ce.box(['Mean', ['List', 'a', 'b', 'c']]).subs({ a: ce.number(1) }).has('a')
      ).toBe(false);
    });

    test('subs reaches a plain List and a nested matrix', () => {
      const ce = new ComputeEngine();
      expect(ce.box(['List', 'a', 'b']).subs({ a: ce.number(1) }).json).toEqual([
        'List',
        1,
        'b',
      ]);
      expect(
        ce
          .box(['List', ['List', 'a', 'b'], ['List', 'c', 'd']])
          .subs({ a: ce.number(1), d: ce.number(9) }).json
      ).toEqual(['List', ['List', 1, 'b'], ['List', 'c', 9]]);
    });

    test('subs reaches definite-integral bounds', () => {
      const ce = new ComputeEngine();
      const r = ce.parse('\\int_a^b x \\, dx').subs({ a: ce.number(0) });
      expect(r.has('a')).toBe(false);
      expect(r.has('b')).toBe(true);
    });
  });

  describe('CORRECTNESS_FINDINGS #30: interpreted Power(0,0) is consistently NaN', () => {
    test('literal and value-bound-symbol 0^0 agree (NaN) under both evaluate() and N()', () => {
      const ce = new ComputeEngine();
      expect(ce.box(['Power', 0, 0]).evaluate().isNaN).toBe(true);
      expect(ce.box(['Power', 0, 0]).N().isNaN).toBe(true);

      const ce2 = new ComputeEngine();
      ce2.assign('x', 0);
      ce2.assign('y', 0);
      expect(ce2.box(['Power', 'x', 'y']).evaluate().isNaN).toBe(true);
      // Regression: this used to return 1 (Math.pow(0,0)) — inconsistent with
      // the literal and the symbolic evaluate() result.
      expect(ce2.box(['Power', 'x', 'y']).N().isNaN).toBe(true);
    });

    test('ordinary powers are unaffected', () => {
      const ce = new ComputeEngine();
      expect(ce.box(['Power', 2, 0]).N().re).toBe(1);
      expect(ce.box(['Power', 0, 2]).N().re).toBe(0);
      expect(ce.box(['Power', 2, 3]).N().re).toBe(8);
    });
  });

  describe('CORRECTNESS_FINDINGS #29: timeouts are bounded and well-typed', () => {
    // The public contract (locked by timeout.test.ts across the API): when the
    // time limit expires, evaluate()/N() throw CancellationError — never a raw
    // internal error, and never an unbounded hang. This case used to burn
    // ~18 minutes of CPU in the limit engine before the deadline sweep.
    test('a deliberately slow expression with a tiny time limit completes fast, inert or CancellationError', () => {
      const ce = new ComputeEngine();
      ce.timeLimit = 50;
      // A hard iterated-exponential (Gruntz-class) limit the engine cannot
      // resolve quickly: x·ln(x)·ln(x·eˣ − x²)² / ln(ln(x² + 2·exp(exp(3x³ln x)))).
      const tower = ['Exp', ['Exp', ['Multiply', 3, ['Power', 'x', 3], ['Ln', 'x']]]];
      const numer = [
        'Multiply',
        'x',
        ['Ln', 'x'],
        [
          'Power',
          ['Ln', ['Subtract', ['Multiply', 'x', ['Exp', 'x']], ['Power', 'x', 2]]],
          2,
        ],
      ];
      const denom = [
        'Ln',
        ['Ln', ['Add', ['Power', 'x', 2], ['Multiply', 2, tower]]],
      ];
      const body = ['Divide', numer, denom];
      const slow = ce.box(['Limit', ['Function', body, 'x'], 'PositiveInfinity']);
      // Bounded: returns (inert) or throws CancellationError — nothing else,
      // and within a small multiple of the time limit (was an ~18 min hang).
      const start = Date.now();
      for (const run of [() => slow.evaluate(), () => slow.N()]) {
        try {
          run();
        } catch (e) {
          expect((e as Error).constructor.name).toBe('CancellationError');
        }
      }
      expect(Date.now() - start).toBeLessThan(10_000);
    });
  });

  describe('Ellipsis in a numeric context must not throw (MathNet corpus)', () => {
    // ContinuationPlaceholder is a constant with type 'unknown';
    // checkNumericArgs → BoxedSymbol.infer() used to attempt to narrow its
    // type, and the type setter throws for constants.
    test('\\dots as an Add operand parses without throwing', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('(1!)^2 + (2!)^2 + \\dots + (2018!)^2');
      expect(expr.isValid).toBe(true);
    });

    test('\\ldots in a sum of powers parses without throwing', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('1^{1987} + 2^{1987} + \\ldots + n^{1987}');
      expect(expr.isValid).toBe(true);
    });

    test('infer() is a no-op on constants', () => {
      const ce = new ComputeEngine();
      const placeholder = ce.symbol('ContinuationPlaceholder');
      expect(placeholder.infer('integer')).toBe(false);
      expect(placeholder.type.toString()).toBe('unknown');
    });
  });

  describe('parse() must not blow up exponentially on repeated `]`', () => {
    // The reversed-bracket ISO interval `]a, b[` opens on `]` — a token that
    // also closes ordinary index brackets (`a[6]`). A stray `]` therefore
    // speculatively parsed as an interval open, and because the body parse was
    // unbounded and re-entrant, each of the many `]` tokens in input like
    // `a[6]a[6]…` fanned out another full-tail parse: exponential (a garbage
    // LaTeX string a few hundred code points long hung the parser for tens of
    // seconds). Reported by Tycho (Gemini-Nano on-device eval output scoring).
    test('reversed-bracket interval notation still parses', () => {
      const ce = new ComputeEngine();
      expect(ce.parse(']0, 1[', { canonical: false }).json).toEqual([
        'Interval',
        ['Open', 0],
        ['Open', 1],
      ]);
      expect(ce.parse(']a, b[', { canonical: false }).json).toEqual([
        'Interval',
        ['Open', 'a'],
        ['Open', 'b'],
      ]);
    });

    test('index bracket after a symbol still parses', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('a[6]', { canonical: false }).json).toEqual([
        'At',
        'a',
        6,
      ]);
      expect(ce.parse('a[b=c]', { canonical: false }).json).toEqual([
        'At',
        'a',
        ['Equal', 'b', 'c'],
      ]);
    });

    test('repeated `]` groups parse in polynomial time', () => {
      const ce = new ComputeEngine();
      const start = Date.now();
      // 200 repeats of a symbol-indexing group — every group ends in `]`.
      // Before the fix this was tens of seconds even at ~14 groups.
      const expr = ce.parse('a[b=c]'.repeat(200), { canonical: false });
      expect(expr.isValid).toBe(true);
      expect(Date.now() - start).toBeLessThan(5_000);
    });
  });

  // A self-referential binding (`a := a + 1` over an unbound `a`) forms a
  // value cycle: the stored value mentions the symbol it defines. `evaluate()`
  // always terminated (it substitutes one level), but `.N()` — and the
  // collection-shape queries reached from numeric `Add` — used to follow the
  // cycle without a guard and overflow the stack. Reported by Tycho (surfaced
  // through `.latex` on a cortex read-back, which calls `.N()`).
  describe('self-referential binding does not overflow the stack', () => {
    test('.N() on `a := a + 1` stays symbolic', () => {
      const ce = new ComputeEngine();
      ce.assign('a', ce.parse('a + 1'));
      expect(() => ce.box('a').N()).not.toThrow();
      expect(ce.box('a').N().json).toEqual('a');
      expect(ce.box('a').N().latex).toEqual('a');
      // collection-shape queries reached from numeric Add must not recurse
      expect(() => ce.box('a').isFiniteCollection).not.toThrow();
    });

    test('degenerate `a := a` stays symbolic', () => {
      const ce = new ComputeEngine();
      ce.assign('a', ce.symbol('a'));
      expect(() => ce.box('a').N()).not.toThrow();
      expect(ce.box('a').N().json).toEqual('a');
    });

    test('non-self-referential bindings still resolve', () => {
      const ce = new ComputeEngine();
      ce.assign('y', ce.parse('2x'));
      expect(ce.box('y').evaluate().json).toEqual(['Multiply', 2, 'x']);
      ce.assign('x', ce.number(3));
      expect(ce.box('y').N().json).toEqual(6);
    });

    test('reassigning away from a self-reference clears the guard', () => {
      const ce = new ComputeEngine();
      ce.assign('a', ce.parse('a + 1'));
      expect(ce.box('a').N().json).toEqual('a');
      ce.assign('a', ce.number(7));
      expect(ce.box('a').N().json).toEqual(7);
    });
  });
});
