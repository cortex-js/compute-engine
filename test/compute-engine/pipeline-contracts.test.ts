/**
 * PIPELINE CONTRACTS — the written non-canonical MathJSON pipeline guarantees.
 *
 * ============================================================================
 * THIS SUITE *IS* THE WRITTEN CONTRACT.
 * ============================================================================
 *
 * The Compute Engine has committed, in writing, to a set of guarantees about
 * non-canonical MathJSON pipelines in the consumer integration document
 * (tycho's `COMPUTE_ENGINE.md`). Each test below pins one of those
 * commitments so that the guarantee is *enforced*, not merely aspirational.
 *
 * BREAKING A TEST HERE = BREAKING A CONSUMER-FACING GUARANTEE. It therefore
 * requires (a) a CHANGELOG callout and (b) a consumer notice, per the written
 * commitment — not a quiet snapshot update.
 *
 * A handful of tests are marked `// CONTRACT VIOLATION:` — these document
 * *current* behavior that contradicts (or is more restrictive than) the
 * stated guarantee. They are here so the divergence is tracked; the deciding
 * task lives in ROADMAP.md ("Decide the `At` default-serialization round-trip
 * contract"). Do NOT "fix" them by loosening the assertion silently.
 *
 * Empirical basis: every assertion was derived from executing the probe
 * scripts in scratchpad/contracts/ against the current tree. Fresh
 * ComputeEngine instances are used per describe block to avoid shared-engine
 * state pollution (a known trap); process-global BigDecimal.precision is never
 * touched.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** Top-level head of a MathJSON value, or null for an atom (number/symbol/string). */
function head(json: any): string | null {
  if (Array.isArray(json))
    return typeof json[0] === 'string' ? json[0] : JSON.stringify(json[0]);
  if (json !== null && typeof json === 'object' && 'fn' in json)
    return head((json as any).fn);
  return null;
}

const J = (x: any) => JSON.stringify(x);

// ===========================================================================
// CONTRACT 2a: ce.box(json, {canonical:false}).json structural fidelity
// ===========================================================================
describe('CONTRACT 2a: box(json, {canonical:false}).json structural fidelity', () => {
  // --- byte-identical cases: .json is exactly the input MathJSON ---------
  const identical: [string, any][] = [
    ['int', 42],
    ['neg int', -3],
    ['float', 3.14],
    ['big float', 1e30],
    ['rational-ish Divide', ['Divide', 1, 3]],
    ['Rational head', ['Rational', 1, 3]],
    ['symbol', 'x'],
    ['string shorthand', "'hello'"],
    ['Add', ['Add', 'x', 1]],
    ['nested', ['Multiply', 2, ['Add', 'x', ['Power', 'y', 2]]]],
    ['Sequence in Add (not flattened)', ['Add', ['Sequence', 1, 2], 'x']],
    ['Delimiter', ['Delimiter', ['Sequence', 'x', 'y']]],
    ['InvisibleOperator', ['InvisibleOperator', 2, 'x']],
    ['Subscript', ['Subscript', 'a', 1]],
    ['At', ['At', 'a', 1]],
    ['Which', ['Which', ['Less', 'x', 0], 1, 'True', 2]],
    ['Tuple', ['Tuple', 1, 2]],
    ['List', ['List', 1, 2, 3]],
    ['Lambda fn', ['Function', ['Add', 'x', 1], 'x']],
    ['Sum bounds', ['Sum', ['Power', 'k', 2], ['Tuple', 'k', 1, 10]]],
    ['Degrees', ['Degrees', 45]],
    ['unknown head preserved', ['FooBar', 1, 'x']],
    ['empty fn args', ['Foo']],
    ['bigint-ish num str', { num: '123456789012345678901234567890' }],
  ];

  test.each(identical)('byte-identical: %s', (_name, json) => {
    const ce = new ComputeEngine();
    expect(J(ce.box(json as any, { canonical: false }).json)).toBe(J(json));
  });

  // --- documented normalization cases (LOCKED, not identity) -------------
  test('object-form sym → shorthand symbol', () => {
    const ce = new ComputeEngine();
    expect(ce.box({ sym: 'alpha' } as any, { canonical: false }).json).toBe(
      'alpha'
    );
  });

  test('object-form str → shorthand string', () => {
    const ce = new ComputeEngine();
    expect(ce.box({ str: 'hello' } as any, { canonical: false }).json).toBe(
      "'hello'"
    );
  });

  test('object-form fn → bare array shorthand', () => {
    const ce = new ComputeEngine();
    expect(
      J(ce.box({ fn: ['Add', 'x', 1] } as any, { canonical: false }).json)
    ).toBe(J(['Add', 'x', 1]));
  });

  test('object-form sym/str normalized recursively inside a container', () => {
    const ce = new ComputeEngine();
    const out = ce.box(
      [
        'Dictionary',
        ['Tuple', { str: 'a' }, 1],
        ['Tuple', { str: 'b' }, 2],
      ] as any,
      { canonical: false }
    ).json;
    expect(J(out)).toBe(
      J(['Dictionary', ['Tuple', "'a'", 1], ['Tuple', "'b'", 2]])
    );
  });

  test('{num:"NaN"} normalizes to "NaN" symbol', () => {
    const ce = new ComputeEngine();
    expect(ce.box({ num: 'NaN' } as any, { canonical: false }).json).toBe('NaN');
  });

  test('num-object trailing-zero / excess-precision trimmed', () => {
    const ce = new ComputeEngine();
    const out = ce.box(
      { num: '3.14159265358979323846264338327950288419716939937510' } as any,
      { canonical: false }
    ).json;
    // Trailing zero trimmed to significant digits.
    expect(out).toEqual({
      num: '3.1415926535897932384626433832795028841971693993751',
    });
  });

  test('d-suffix num-object collapses to a machine number', () => {
    const ce = new ComputeEngine();
    expect(ce.box({ num: '1.23d' } as any, { canonical: false }).json).toBe(
      1.23
    );
  });

  // --- explicit preservation assertions ----------------------------------
  test('Sequence is NOT flattened into its parent', () => {
    const ce = new ComputeEngine();
    const out = ce.box(['Add', ['Sequence', 1, 2], 'x'] as any, {
      canonical: false,
    }).json;
    expect(head(out)).toBe('Add');
    expect(J(out)).toBe(J(['Add', ['Sequence', 1, 2], 'x']));
  });

  test('Delimiter / InvisibleOperator preserved as distinct heads', () => {
    const ce = new ComputeEngine();
    expect(
      head(
        ce.box(['Delimiter', ['Sequence', 'x', 'y']] as any, {
          canonical: false,
        }).json
      )
    ).toBe('Delimiter');
    expect(
      head(
        ce.box(['InvisibleOperator', 2, 'x'] as any, { canonical: false }).json
      )
    ).toBe('InvisibleOperator');
  });

  test('Subscript and At stay distinct heads (no collapse)', () => {
    const ce = new ComputeEngine();
    expect(
      head(ce.box(['Subscript', 'a', 1] as any, { canonical: false }).json)
    ).toBe('Subscript');
    expect(head(ce.box(['At', 'a', 1] as any, { canonical: false }).json)).toBe(
      'At'
    );
  });

  test('unknown head is preserved verbatim (no rejection)', () => {
    const ce = new ComputeEngine();
    const out = ce.box(['FooBar', 1, 'x'] as any, { canonical: false }).json;
    expect(J(out)).toBe(J(['FooBar', 1, 'x']));
  });

  test('operand order is preserved (no canonical reordering)', () => {
    const ce = new ComputeEngine();
    const out = ce.box(['Add', 'x', 1] as any, { canonical: false }).json;
    // Canonical Add would fold/reorder; non-canonical keeps ["Add","x",1].
    expect(J(out)).toBe(J(['Add', 'x', 1]));
  });

  test('Rational head is NOT rewritten to Divide (distinct heads preserved)', () => {
    const ce = new ComputeEngine();
    expect(
      head(ce.box(['Rational', 1, 3] as any, { canonical: false }).json)
    ).toBe('Rational');
    expect(
      head(ce.box(['Divide', 1, 3] as any, { canonical: false }).json)
    ).toBe('Divide');
  });
});

// ===========================================================================
// CONTRACT 2b: non-canonical LaTeX .latex round-trip
// ===========================================================================
describe('CONTRACT 2b: non-canonical .latex round-trip fidelity', () => {
  // parse nc -> .latex -> parse nc -> json must be equal.
  const roundTrips = [
    '2+3',
    '2x',
    'x(a+b)',
    '2\\pi r',
    '\\frac{a}{b}',
    'a_1',
    'a_{n+1}',
    'x_{i,j}',
    '\\sin x',
    '\\sin^2 x',
    '\\cos(\\theta)+i\\sin(\\theta)',
    '\\sum_{k=1}^{10} k^2',
    '\\int_0^1 x^2 dx',
    '\\begin{cases} 1 & x < 0 \\\\ 2 & x \\geq 0 \\end{cases}',
    '\\operatorname{foo}(x, y)',
    '\\operatorname{gcd}(6, 4)',
    '[x^2 \\text{ for } x \\in [1..10]]',
    '1..250',
    '[1..250]',
    '(1,2)',
    '(1,2,3)',
    '\\{1, 2, 3\\}',
    '30\\degree',
    '45^\\circ',
    '|x|',
    '\\sqrt{x+1}',
    '\\sqrt[3]{x}',
    'f(x) := x^2 + 1',
    'x \\mapsto x^2',
    '\\lfloor x \\rfloor',
    'e^{i\\pi}',
    '\\text{hello}',
    '3.1\\times10^{5}',
    '-x^2',
    'a \\le b < c',
    '\\frac{d}{dx} \\sin x',
    'x=1..5',
    "f'(2)",
    '\\left(a+b\\right)^2',
  ];

  test.each(roundTrips)('round-trips: %s', (latex) => {
    const ce = new ComputeEngine();
    const e1 = ce.parse(latex, { canonical: false });
    const e2 = ce.parse(e1.latex, { canonical: false });
    expect(J(e2.json)).toBe(J(e1.json));
  });

  // --- former exception class (i): At with an undeclared base ------------
  // CLOSED by the bracket default: `At` now serializes as `a[1]`, which
  // parses back to `At` regardless of the base's declared type. The lossy
  // subscript form remains only as an opt-in (`indexStyle: 'subscript'`).
  describe('former exception (i): At round-trips by default (bracket serialization)', () => {
    test('a[1] serializes to a[1] and round-trips to At over an undeclared base', () => {
      const ce = new ComputeEngine();
      const e1 = ce.parse('a[1]', { canonical: false });
      expect(J(e1.json)).toBe(J(['At', 'a', 1]));
      expect(e1.latex).toBe('a[1]');
      const e2 = ce.parse(e1.latex, { canonical: false });
      expect(J(e2.json)).toBe(J(e1.json)); // ["At","a",1] both ways
    });

    test('RESIDUAL EXCEPTION: opt-in subscript style is lossy over an undeclared base', () => {
      const ce = new ComputeEngine();
      const e1 = ce.parse('a[1]', { canonical: false });
      const subLatex = (e1 as any).toLatex({
        indexStyle: () => 'subscript',
      });
      expect(subLatex).toBe('a_1');
      // Reparsing a_1 gives the symbol "a_1", NOT ["At","a",1].
      const e2 = ce.parse(subLatex, { canonical: false });
      expect(e2.json).toBe('a_1');
      expect(J(e2.json)).not.toBe(J(e1.json));
    });

    test('a declared collection base round-trips through subscript v_1 too', () => {
      const ce = new ComputeEngine();
      ce.declare('v', { type: 'list<number>' } as any);
      const e1 = ce.parse('v[1]', { canonical: false });
      expect(J(e1.json)).toBe(J(['At', 'v', 1]));
      const subLatex = (e1 as any).toLatex({ indexStyle: () => 'subscript' });
      expect(subLatex).toBe('v_1');
      const e2 = ce.parse(subLatex, { canonical: false });
      expect(J(e2.json)).toBe(J(['At', 'v', 1]));
    });
  });

  // --- exception class (ii): a[2][3] fails loudly at nc parse ------------
  test('exception (ii): a[2][3] fails loudly (produces an Error node) at nc parse', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('a[2][3]', { canonical: false });
    // The failure is visible in the parse output, not silently accepted.
    expect(J(e.json)).toContain('Error');
    expect(e.errors.length).toBeGreaterThan(0);
  });

  // --- exception class (iii): stable fixed point after one round-trip ----
  describe('exception (iii): negative-literal-exponent reaches a stable fixed point', () => {
    // These are NOT identities on the first round-trip (Power+Negate rewrites
    // to Divide via the LaTeX \frac serialization) but ARE fixed points
    // thereafter. The CONTRACT is the fixed-point property, not initial
    // identity.
    const fixedPoint = ['2^{-3}', 'x^{-2}', '10^{-5}'];

    test.each(fixedPoint)(
      'serialize→parse→serialize→parse is a fixed point: %s',
      (latex) => {
        const ce = new ComputeEngine();
        const e0 = ce.parse(latex, { canonical: false });
        const e1 = ce.parse(e0.latex, { canonical: false });
        const e2 = ce.parse(e1.latex, { canonical: false });
        // First round-trip is allowed to differ from the source...
        // ...but from the first round-trip onward the json is stable.
        expect(J(e2.json)).toBe(J(e1.json));
      }
    );

    test('2^{-3} specifically: source ≠ first round-trip, then stable', () => {
      const ce = new ComputeEngine();
      const e0 = ce.parse('2^{-3}', { canonical: false });
      expect(J(e0.json)).toBe(J(['Power', 2, ['Negate', 3]]));
      const e1 = ce.parse(e0.latex, { canonical: false });
      expect(J(e1.json)).toBe(J(['Divide', 1, ['Power', 2, 3]]));
      expect(J(e1.json)).not.toBe(J(e0.json)); // not an initial identity
      const e2 = ce.parse(e1.latex, { canonical: false });
      expect(J(e2.json)).toBe(J(e1.json)); // fixed point reached
    });

    // Small-float class: these ARE already first-round identities, and remain
    // fixed points. Lock that they do not drift.
    test.each(['1.5e-10', '0.0001', '5\\times10^{-8}'])(
      'small-float class is a stable fixed point: %s',
      (latex) => {
        const ce = new ComputeEngine();
        const e0 = ce.parse(latex, { canonical: false });
        const e1 = ce.parse(e0.latex, { canonical: false });
        const e2 = ce.parse(e1.latex, { canonical: false });
        expect(J(e1.json)).toBe(J(e0.json));
        expect(J(e2.json)).toBe(J(e1.json));
      }
    );
  });
});

// ===========================================================================
// CONTRACT 3: transform-then-canonicalize-once ≡ parse-of-final-LaTeX
// ===========================================================================
describe('CONTRACT 3: transform then canonicalize-once equals parse of final form', () => {
  test('route comparison 1: quadratic subs (x → a+1)', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('x^2 + 2x + 1', { canonical: false });
    const sub = e.subs({ x: ce.parse('a+1', { canonical: false }) });
    const routeA = ce.box(sub.json).evaluate();
    const routeB = ce.parse('(a+1)^2 + 2(a+1) + 1').evaluate();
    expect(J(routeA.json)).toBe(J(routeB.json));
  });

  test('route comparison 2: raw JSON rewrite (x → π/4) inside sin+cos', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\sin(x) + \\cos(x)', { canonical: false });
    const json = JSON.parse(JSON.stringify(e.json));
    const walk = (n: any): any =>
      n === 'x' ? ['Divide', 'Pi', 4] : Array.isArray(n) ? n.map(walk) : n;
    const routeA = ce.box(walk(json)).evaluate();
    const routeB = ce.parse('\\sin(\\pi/4) + \\cos(\\pi/4)').evaluate();
    expect(J(routeA.json)).toBe(J(routeB.json));
  });

  test('route comparison 3: Sum bound subs (n → 10)', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\sum_{k=1}^{n} k^2', { canonical: false });
    const sub = e.subs({ n: ce.box(10, { canonical: false }) });
    const routeA = ce.box(sub.json).evaluate();
    const routeB = ce.parse('\\sum_{k=1}^{10} k^2').evaluate();
    expect(J(routeA.json)).toBe(J(routeB.json));
  });

  test('route comparison 4: cases/Which subs (x → -3)', () => {
    const ce = new ComputeEngine();
    const e = ce.parse(
      '\\begin{cases} x^2 & x < 0 \\\\ 2x & x \\geq 0 \\end{cases}',
      { canonical: false }
    );
    const sub = e.subs({ x: ce.box(-3, { canonical: false }) });
    const routeA = ce.box(sub.json).evaluate();
    const routeB = ce.parse(
      '\\begin{cases} (-3)^2 & -3 < 0 \\\\ 2(-3) & -3 \\geq 0 \\end{cases}'
    ).evaluate();
    expect(J(routeA.json)).toBe(J(routeB.json));
  });

  test('route comparison 5: poison case — a[1] with a → list built over a fn call', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x^2 + 1'));
    const e = ce.parse('a[1]', { canonical: false });
    const repl = ce.box(['List', ['Add', ['f', 2], 1], 5], { canonical: false });
    const sub = e.subs({ a: repl });
    const routeA = ce.box(sub.json); // canonicalize once at consumption
    const routeB = ce.parse('[f(2)+1, 5][1]');
    expect(J(routeA.json)).toBe(J(routeB.json));
    expect(routeA.errors.length).toBe(0);
    expect(routeA.evaluate().toString()).toBe('6');
    expect(routeB.evaluate().toString()).toBe('6');
  });

  test('route comparison 6: poison-2 convergence — nc route and canonical-first route both surface the same incompatible-type error', () => {
    // A scalar substituted for a base that At requires to be an indexed
    // collection converges to the same Error node whether the pipeline is
    // canonical-first or non-canonical-then-canonicalize-once.
    const ceA = new ComputeEngine();
    ceA.assign('f', ceA.parse('x \\mapsto x^2 + 1'));
    const eA = ceA.parse('a[1]'); // canonical-first: a is baked
    const subA = eA.subs({ a: ceA.box(['Add', ['f', 2], 1]) });

    const ceB = new ComputeEngine();
    ceB.assign('f', ceB.parse('x \\mapsto x^2 + 1'));
    const eB = ceB.parse('a[1]', { canonical: false });
    const subB = eB.subs({ a: ceB.box(['Add', ['f', 2], 1], { canonical: false }) });
    const canonB = ceB.box(subB.json); // canonicalize once

    expect(J(subA.json)).toContain('incompatible-type');
    expect(J(canonB.json)).toContain('incompatible-type');
    expect(J(canonB.json)).toBe(J(subA.json)); // routes converge
  });

  // --- .subs-on-non-canonical properties ---------------------------------
  test('subs keeps the result non-canonical', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('x^2 + 2x + 1', { canonical: false });
    const sub = e.subs({ x: ce.parse('a+1', { canonical: false }) });
    expect(sub.isCanonical).toBe(false);
  });

  test('subs does not canonicalize as a side effect (2x + x stays unfolded)', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('2x + x', { canonical: false });
    expect(J(e.json)).toBe(J(['Add', ['InvisibleOperator', 2, 'x'], 'x']));
    const sub = e.subs({ x: ce.box('y', { canonical: false }) });
    // Canonical Add would fold to 3y; non-canonical must not.
    expect(J(sub.json)).toBe(J(['Add', ['InvisibleOperator', 2, 'y'], 'y']));
    expect(sub.isCanonical).toBe(false);
  });

  test('subs substitutes inside InvisibleOperator/Delimiter structures', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('g(x) + 1', { canonical: false });
    const sub = e.subs({ x: ce.box(2, { canonical: false }) });
    expect(J(sub.json)).toBe(
      J(['Add', ['InvisibleOperator', 'g', ['Delimiter', 2]], 1])
    );
    expect(sub.isCanonical).toBe(false);
  });

  test('subs does not retype symbols in the engine scope', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('g(x) + 1', { canonical: false });
    expect(ce.box('g').type.toString()).toBe('unknown');
    e.subs({ x: ce.box(2, { canonical: false }) });
    // The remaining free symbol keeps its engine-scope type after subs.
    expect(ce.box('g').type.toString()).toBe('unknown');
    expect(ce.box('x').type.toString()).toBe('unknown');
  });

  // --- CONTRACT 3 addendum: warm-engine order independence ----------------
  // A juxtaposition parse (`2x` → Multiply, not Tuple) must not depend on
  // whether the engine was previously warmed by canonicalizing an expression
  // that widened `x`'s inferred type. Regression for the order-dependent
  // wrong-parse where boxing `Max(x, 2x-1)` inferred `x : value` (the widest
  // value type, from Max's `(value*)` signature) and the invisible-operator
  // juxtaposition gate then mis-read that wide type as collection/point
  // evidence, emitting `Tuple(2,x)` for every subsequent parse in the engine.
  test('warm-engine order independence: 2x stays Multiply after a value-widening box/parse', () => {
    const expected = J(['Multiply', 2, 'x']);

    // Cold engine: baseline.
    {
      const ce = new ComputeEngine();
      expect(J(ce.parse('2x').json)).toBe(expected);
    }

    // Order A: box the non-canonical Max json first, then parse 2x.
    {
      const ce = new ComputeEngine();
      const nc = ce.parse('\\max(x, 2x-1)', { canonical: false });
      ce.box(nc.json); // canonicalize; widens x to `value`
      expect(J(ce.parse('2x').json)).toBe(expected);
    }

    // Order B: canonical-parse Max first, then parse 2x.
    {
      const ce = new ComputeEngine();
      ce.parse('\\max(x, 2x-1)'); // canonical parse widens x to `value`
      expect(J(ce.parse('2x').json)).toBe(expected);
    }

    // Even a symbol *directly declared* `value` juxtaposes as multiplication.
    {
      const ce = new ComputeEngine();
      ce.declare('w', 'value');
      expect(J(ce.parse('2w').json)).toBe(J(['Multiply', 2, 'w']));
    }
  });
});

// ===========================================================================
// CONTRACT 4: re-binding rules (correctness only — NO timing assertions)
// ===========================================================================
describe('CONTRACT 4: re-binding of a cached boxed expression', () => {
  // --- cases where a cached boxed expression SEES a later binding ---------
  test('cached boxed sees a later assign (k := 2)', () => {
    const ce = new ComputeEngine();
    ce.declare('k', { type: 'number', value: 1 } as any);
    const json = ['Add', ['Multiply', 2, 'k'], 1];
    const cached = ce.box(json as any);
    expect(cached.evaluate().toString()).toBe('3');
    ce.assign('k', 2);
    expect(cached.evaluate().toString()).toBe('5'); // cached reflects k=2
    expect(ce.box(json as any).evaluate().toString()).toBe('5');
  });

  test('cached boxed sees a late assign to a previously-unknown symbol', () => {
    const ce = new ComputeEngine();
    const json = ['Add', 'q', 1];
    const cached = ce.box(json as any);
    expect(cached.evaluate().toString()).toBe('q + 1');
    ce.assign('q', 41);
    expect(cached.evaluate().toString()).toBe('42');
    expect(ce.box(json as any).evaluate().toString()).toBe('42');
  });

  test('cached boxed sees a function reassignment (f := x+1, then f := x^2)', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x + 1'));
    const json = ['f', 10];
    const cached = ce.box(json as any);
    expect(cached.evaluate().toString()).toBe('11');
    ce.assign('f', ce.parse('x \\mapsto x^2'));
    expect(cached.evaluate().toString()).toBe('100');
    expect(ce.box(json as any).evaluate().toString()).toBe('100');
  });

  test('cached boxed (in parent scope) sees a nested-scope shadow of k', () => {
    const ce = new ComputeEngine();
    ce.declare('k', { type: 'integer', value: 3 } as any);
    const json = ['Add', ['Multiply', 2, 'k'], 1];
    const cached = ce.box(json as any);
    expect(cached.evaluate().toString()).toBe('7');
    ce.pushScope();
    ce.declare('k', { type: 'real', value: 0.5 } as any);
    expect(ce.box(json as any).evaluate().toString()).toBe('2'); // re-boxed
    expect(cached.evaluate().toString()).toBe('2'); // cached shadows too
    ce.popScope();
  });

  // --- cases where re-boxing is REQUIRED (documented staleness) -----------
  test('re-box REQUIRED: x/x folds to 1 at canonicalization; x:=0 makes cached stale', () => {
    const ce = new ComputeEngine();
    const json = ['Divide', 'x', 'x'];
    const cached = ce.box(json as any); // canonicalizes to 1 (generic-symbol fold)
    expect(cached.json).toBe(1);
    ce.assign('x', 0);
    // Cached already folded to 1 — it cannot observe the 0/0 = NaN.
    expect(cached.evaluate().toString()).toBe('1');
    // Re-boxing after the assignment yields NaN.
    expect(ce.box(json as any).evaluate().toString()).toBe('NaN');
  });

  test('re-box REQUIRED: Subscript(a,1) stays a symbol until a is a collection', () => {
    const ce = new ComputeEngine();
    const json = ['Subscript', 'a', 1];
    const cached = ce.box(json as any);
    expect(cached.json).toBe('a_1'); // symbol, a not known to be a collection
    ce.assign('a', ce.box(['List', 7, 8, 9]));
    // Cached stays the symbol a_1 (canonical form was fixed at box time).
    expect(cached.json).toBe('a_1');
    // Re-boxing after the assignment resolves to an At element access.
    const reboxed = ce.box(json as any);
    expect(J(reboxed.json)).toBe(J(['At', 'a', 1]));
    expect(reboxed.evaluate().toString()).toBe('7');
  });

  test('re-box REQUIRED: juxtaposition g(2) — multiplication vs application', () => {
    const ce = new ComputeEngine();
    const json = ['InvisibleOperator', 'g', ['Delimiter', 2]];
    const cached = ce.box(json as any); // g unknown → Multiply(2,g) → "2g"
    expect(cached.evaluate().toString()).toBe('2g');
    ce.assign('g', ce.parse('x \\mapsto x + 100'));
    // Cached stays the multiplication form.
    expect(cached.evaluate().toString()).toBe('2g');
    // Re-boxing resolves to function application g(2) = 102.
    const reboxed = ce.box(json as any);
    expect(J(reboxed.json)).toBe(J(['g', 2]));
    expect(reboxed.evaluate().toString()).toBe('102');
  });

  test('same-scope redeclare after forget throws', () => {
    const ce = new ComputeEngine();
    ce.declare('k', { type: 'integer', value: 3 } as any);
    ce.forget('k');
    expect(() =>
      ce.declare('k', { type: 'real', value: 0.5 } as any)
    ).toThrow(/already declared/i);
  });
});

// ===========================================================================
// CONTRACT 5: compile-from-boxed parity
// ===========================================================================
describe('CONTRACT 5: compile from a re-boxed non-canonical expression matches compile from parse', () => {
  const corpus: [string, Record<string, number>[]][] = [
    ['x^2 + 3x + 1', [{ x: 2 }, { x: -1.5 }]],
    ['\\sin(x) + \\cos(2x)', [{ x: 0.7 }]],
    ['\\frac{x+1}{x-1}', [{ x: 3 }]],
    ['\\sqrt{x^2+1}', [{ x: 2 }]],
    ['e^{-x^2}', [{ x: 0.5 }]],
    ['\\tan(x) \\cdot \\ln(x+2)', [{ x: 1.1 }]],
    ['\\sum_{k=1}^{10} k^2', [{}]],
    ['\\sum_{k=1}^{n} k', [{ n: 5 }]],
    ['|x - 3|', [{ x: 1 }]],
    ['\\lfloor x \\rfloor + \\lceil x \\rceil', [{ x: 2.3 }]],
    ['\\begin{cases} x^2 & x < 0 \\\\ 2x & x \\geq 0 \\end{cases}', [{ x: -2 }, { x: 3 }]],
    ['L[2]', [{}]],
    ['f(x) + 1', [{ x: 3 }]],
    ['x \\operatorname{mod} 3', [{ x: 7 }]],
    ['2x', [{ x: 5 }]],
    ['x(x+1)', [{ x: 4 }]],
  ];

  test.each(corpus)(
    'run-value parity: %s',
    (latex, points) => {
      const ce = new ComputeEngine();
      ce.assign('f', ce.parse('x \\mapsto x^2 + 1'));
      ce.assign('L', ce.box(['List', 10, 20, 30]));

      // Route A: canonical parse.
      const eA = ce.parse(latex);
      // Route B: carry non-canonical json, box canonical at consumption.
      const ncJson = ce.parse(latex, { canonical: false }).json;
      const eB = ce.box(JSON.parse(JSON.stringify(ncJson)));

      const cA = compile(eA);
      const cB = compile(eB);

      // Do NOT compare code strings — gensym names differ. Compare run values.
      for (const pt of points) {
        const rA = cA?.run?.(pt);
        const rB = cB?.run?.(pt);
        expect(J(rB)).toBe(J(rA));
      }
    }
  );

  test('run-value parity: \\max(x, 2x-1)', () => {
    const ce = new ComputeEngine();
    const eA = ce.parse('\\max(x, 2x-1)');
    const ncJson = ce.parse('\\max(x, 2x-1)', { canonical: false }).json;
    const eB = ce.box(JSON.parse(JSON.stringify(ncJson)));
    const cA = compile(eA);
    const cB = compile(eB);
    for (const pt of [{ x: 0.3 }, { x: 4 }])
      expect(J(cB?.run?.(pt))).toBe(J(cA?.run?.(pt)));
  });

  test('sharp edge: compiling a non-canonical InvisibleOperator expression fails (success=false), not silently succeeds', () => {
    const ce = new ComputeEngine();
    const eNC = ce.parse('2x', { canonical: false }); // ["InvisibleOperator",2,"x"]
    const c = compile(eNC) as any;
    // Current contract: compile fails closed on the raw InvisibleOperator head.
    expect(c.success).toBe(false);
  });
});

// ===========================================================================
// CONTRACT 6: non-canonical shape vocabulary
// ===========================================================================
describe('CONTRACT 6: documented non-canonical head vocabulary', () => {
  // Each entry: [latex, expected top-level head]. `null` means an atom
  // (bare number/symbol/string), not a function application.
  const shapes: [string, string | null][] = [
    ['2x + 3y(z+1)', 'Add'],
    ['a[1]', 'At'],
    ['a_1', null], // bare symbol "a_1"
    ['a_{n+1}', 'Subscript'],
    ['\\sin^2 x', 'Power'],
    ["f'(2)", 'Apply'],
    ['(1,2)', 'Delimiter'],
    ['(1,2,3)', 'Delimiter'],
    ['\\{1,2\\}', 'Set'],
    ['[x^2 \\text{ for } x \\in [1..10]]', 'List'], // trailing-qualifier ForAll in a List — NOT a comprehension (see pin below)
    ['1..250', 'Range'],
    ['\\begin{cases} 1 & x<0 \\\\ 2 \\end{cases}', 'Which'],
    ['\\sum_{k=1}^{10} k^2', 'Sum'],
    ['\\int_0^1 x^2 dx', 'Integrate'],
    ['\\operatorname{foo}(x,y)', 'InvisibleOperator'],
    ['30\\degree', 'Degrees'],
    ['3\\,\\mathrm{m}', 'InvisibleOperator'],
    ['x \\mapsto x^2', 'Function'],
    ['f(x) := x^2+1', 'Assign'],
    ['\\frac{d}{dx}\\sin x', 'D'],
    ['|x|+\\lfloor y \\rfloor', 'Add'],
    ['\\sqrt[3]{x}', 'Root'],
    ['x=1..5', 'Equal'],
    ['\\text{hello } x', 'InvisibleOperator'],
  ];

  test.each(shapes)('%s → head', (latex, expectedHead) => {
    const ce = new ComputeEngine();
    const e = ce.parse(latex, { canonical: false });
    expect(head(e.json)).toBe(expectedHead);
  });

  // Structural sub-shape assertions that pin documented conventions.
  //
  // The `∈` spelling is NOT a comprehension: `for x \in …` is the
  // trailing-qualifier annotation form (as in `x^2 \text{ for } x \in \R`),
  // so inside a list literal it stays List(ForAll(…)) — an inert quantified
  // statement — through EVERY route (non-canonical parse, canonical parse,
  // canonical box; probed 2026-07-17, published 0.83.2 and source agree).
  // The comprehension surface syntax is the `=` binding (`for x = L`,
  // Desmos convention), which emits the Comprehension head already in the
  // raw AST — there is no List(ForAll)→Comprehension desugar stage anywhere.
  test('the ∈ qualifier spelling stays List(ForAll(Element(...), body)) — not a comprehension', () => {
    const ce = new ComputeEngine();
    const shape = [
      'List',
      ['ForAll', ['Element', 'x', ['Range', 1, 10]], ['Power', 'x', 2]],
    ];
    const nc = ce.parse('[x^2 \\text{ for } x \\in [1..10]]', {
      canonical: false,
    });
    expect(J(nc.json)).toBe(J(shape));
    // Canonical parse and canonical box agree with the non-canonical shape:
    // no route performs a Comprehension conversion (contract 5 has no
    // exception here).
    const can = ce.parse('[x^2 \\text{ for } x \\in [1..10]]');
    expect(J(can.json)).toBe(J(shape));
    expect(J(ce.box(nc.json).json)).toBe(J(shape));
  });

  test('the = binding comprehension has a Comprehension head even non-canonically', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('[x^2 \\text{ for } x = 1..10]', { canonical: false });
    expect(J(e.json)).toBe(
      J(['Comprehension', ['Power', 'x', 2], ['Element', 'x', ['Range', 1, 10]]])
    );
  });

  test('Delimiter carries a string-argument convention for tuple syntax', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('(1,2)', { canonical: false });
    expect(J(e.json)).toBe(J(['Delimiter', ['Sequence', 1, 2], "'(,)'"]));
  });

  test("f'(2) is Apply(Derivative(f,1), 2)", () => {
    const ce = new ComputeEngine();
    const e = ce.parse("f'(2)", { canonical: false });
    expect(J(e.json)).toBe(J(['Apply', ['Derivative', 'f', 1], 2]));
  });

  test('unit juxtaposition is InvisibleOperator(3, __unit__(m))', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('3\\,\\mathrm{m}', { canonical: false });
    expect(J(e.json)).toBe(J(['InvisibleOperator', 3, ['__unit__', 'm']]));
  });

  // Error shapes: the latex dictionaries are under concurrent edit, so pin
  // only the invariant (an Error node is produced), not the exact head.
  test.each(['2+', '\\left(a+\\right)'])(
    'malformed input surfaces an Error node: %s',
    (latex) => {
      const ce = new ComputeEngine();
      const e = ce.parse(latex, { canonical: false });
      expect(J(e.json)).toContain('Error');
    }
  );
});
