import { engine as ce } from '../utils';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';
import { stochasticEqual } from '../../src/compute-engine/boxed-expression/stochastic-equal';

// The stochastic sampler backs the PROVER tier only: `IdenticallyEqual`
// (`\equiv`) / `.isIdenticallyEqual()`. Arithmetic `=` / `.isEqual()` is the
// cheap tier and is inert on a free-variable identity — pinned alongside the
// first case below. See docs/LANGUAGE-MODEL.md.
describe('STOCHASTIC EQUALITY', () => {
  it('trig identity: sin²(x) + cos²(x) = 1', () => {
    const a = ce.parse('\\sin^2(x) + \\cos^2(x)');
    const b = ce.parse('1');
    expect(a.isIdenticallyEqual(b)).toBe(true);
    // The arithmetic tier does not sample: it stays inert.
    expect(a.isEqual(b)).toBe(undefined);
  });

  it('algebraic: (x²-1)/(x-1) = x+1', () => {
    const a = ce.parse('\\frac{x^2-1}{x-1}');
    const b = ce.parse('x+1');
    expect(a.isIdenticallyEqual(b)).toBe(true);
  });

  it('multi-variable: (x+y)² = x²+2xy+y²', () => {
    const a = ce.parse('(x+y)^2');
    const b = ce.parse('x^2 + 2xy + y^2');
    expect(a.isIdenticallyEqual(b)).toBe(true);
  });

  it('multi-variable: machine-float cancellation is not a disagreement', () => {
    // With these seeds, a random sample point has x ≈ -y. There the compiled
    // `x^2 + 2xy + y^2` adds terms near 1e6 to get a result near 1, and its
    // rounding error is larger than the tolerance. The sampler must check such
    // a point again at engine precision, and not report a disagreement (which
    // `isIdenticallyEqual` turns into `undefined`).
    const a = ce.parse('(x+y)^2');
    const b = ce.parse('x^2 + 2xy + y^2');
    for (const seed of [316, 360, 391, 752, 845])
      expect(withRandomSeedFrame(ce, seed, () => a.isIdenticallyEqual(b))).toBe(
        true
      );
  });

  it('cancellation at every sample point falls back to the symbolic proof', () => {
    // In machine floats, the second form has an error of about 2 at every
    // sample point (terms near 1e16, result below 1e6). Only a few points
    // are checked again at engine precision, so the sampler cannot confirm
    // the disagreement and answers `undefined`; the symbolic proof then
    // shows the identity.
    const a = ce.parse('x^2');
    const b = ce.parse('(x+10^8)^2 - 10^{16} - 2 \\cdot 10^8 x');
    expect(stochasticEqual(a, b)).toBe(undefined);
    expect(a.isIdenticallyEqual(b)).toBe(true);
  });

  it('a real disagreement is still found', () => {
    // `isIdenticallyEqual` hides the sampler's `false` (see the next test),
    // so check the sampler directly: the check again at engine precision
    // must not hide a real disagreement.
    expect(stochasticEqual(ce.parse('x^2'), ce.parse('x^3'))).toBe(false);
    expect(
      stochasticEqual(ce.parse('(x+y)^2'), ce.parse('x^2 + xy + y^2'))
    ).toBe(false);
  });

  it('not an identity: x² vs x³ is undefined (not false)', () => {
    // Sampling refutes only identity-in-all-variables. Under the
    // "truth under constraints" contract (decision D9), `x² = x³` is
    // satisfiable (e.g. assume(x = 1)), so the answer is indeterminate —
    // never a definitive `false`.
    const a = ce.parse('x^2');
    const b = ce.parse('x^3');
    expect(a.isIdenticallyEqual(b)).toBe(undefined);
  });

  it('different unknowns that cancel: x - x + y = y', () => {
    const a = ce.parse('x - x + y');
    const b = ce.parse('y');
    expect(a.isIdenticallyEqual(b)).toBe(true);
  });

  it('double angle: sin(2x) = 2sin(x)cos(x)', () => {
    const a = ce.parse('\\sin(2x)');
    const b = ce.parse('2\\sin(x)\\cos(x)');
    expect(a.isIdenticallyEqual(b)).toBe(true);
  });

  it('constant expressions with unknowns: 0·x = 0', () => {
    const a = ce.parse('0 \\cdot x');
    const b = ce.parse('0');
    expect(a.isIdenticallyEqual(b)).toBe(true);
  });
});

// The compiled sample evaluator is in the `'strict'` mode: with `x: real`,
// `Sqrt(x)` is computed in the real lane, and a complex value gives `NaN`.
// A complex projection can remove that `NaN` before it reaches the result:
// strict code for `Imaginary(Sqrt(x))` is the literal `0`, but the
// interpreter gives `1` at `x = -1`. An expression with a projection over an
// operand that is not a number literal is evaluated with the interpreter.
describe('STOCHASTIC EQUALITY WITH A COMPLEX PROJECTION', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('x', 'real');
  });
  afterAll(() => ce.popScope());

  it('Imaginary(Sqrt(x)) = 0 is false', () => {
    expect(
      stochasticEqual(ce.box(['Imaginary', ['Sqrt', 'x']]), ce.box(0))
    ).toBe(false);
    expect(
      stochasticEqual(ce.box(['Abs', ['Imaginary', ['Sqrt', 'x']]]), ce.box(0))
    ).toBe(false);
    expect(stochasticEqual(ce.box(['Imaginary', ['Ln', 'x']]), ce.box(0))).toBe(
      false
    );
  });

  it('Real, Argument and Conjugate of Sqrt(x) are not confirmed as real', () => {
    const sqrtX = ce.box(['Sqrt', 'x']);
    expect(stochasticEqual(ce.box(['Real', ['Sqrt', 'x']]), sqrtX)).toBe(false);
    expect(
      stochasticEqual(ce.box(['Argument', ['Sqrt', 'x']]), ce.box(0))
    ).toBe(false);
    expect(stochasticEqual(ce.box(['Conjugate', ['Sqrt', 'x']]), sqrtX)).toBe(
      false
    );
  });

  it('a true identity with a projection is still confirmed', () => {
    expect(stochasticEqual(ce.box(['Imaginary', 'x']), ce.box(0))).toBe(true);
    expect(
      stochasticEqual(
        ce.box(['Imaginary', ['Sqrt', 'x']]),
        ce.box(['Sqrt', ['Max', 0, ['Negate', 'x']]])
      )
    ).toBe(true);
  });
});

// A side is evaluated with its compiled code only when every node is a number
// literal, a symbol, or a head whose strict lowering propagates `NaN`. A head
// that consumes a `NaN` (the compiled `Coalesce` reads `NaN` as absent), or a
// call of a user function, can remove the `NaN` of a complex intermediate, so
// such a side is evaluated with the interpreter.
describe('STOCHASTIC EQUALITY WITH A HEAD THAT CONSUMES NaN', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('x', 'real');
  });
  afterAll(() => ce.popScope());

  it('Coalesce(Sqrt(x), 0) = Sqrt(Max(0, x)) is false', () => {
    expect(
      stochasticEqual(
        ce.box(['Coalesce', ['Sqrt', 'x'], 0]),
        ce.box(['Sqrt', ['Max', 0, 'x']])
      )
    ).toBe(false);
  });

  it('a call of a user function is evaluated with the interpreter', () => {
    ce.pushScope();
    try {
      ce.box([
        'Assign',
        'f',
        ['Function', ['Imaginary', ['Sqrt', 't']], ['Typed', 't', "'real'"]],
      ]).evaluate();
      expect(stochasticEqual(ce.box(['f', 'x']), ce.box(0))).toBe(false);
    } finally {
      ce.popScope();
    }
  });

  it('a true identity over heads that propagate NaN is still confirmed', () => {
    expect(
      stochasticEqual(ce.parse('\\sin(x)^2 + \\cos(x)^2'), ce.box(1))
    ).toBe(true);
    expect(stochasticEqual(ce.parse('e^{2x}'), ce.parse('(e^x)^2'))).toBe(
      true
    );
  });
});
