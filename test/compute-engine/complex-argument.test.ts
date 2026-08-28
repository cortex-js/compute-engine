import { engine } from '../utils';

// Regression test for P0-8 (CORRECTNESS_FINDINGS.md / WP-1.1): the
// `Argument` evaluate handler built the operator name `'ArcTan2'`
// (capital "T") instead of the real operator `'Arctan2'`, so
// `Argument(1+i).evaluate()` returned the inert, unevaluated symbol
// `ArcTan2(1,1)` forever. `.N()` was equally broken, and `AbsArg`
// (which delegates to `Argument`) inherited the bug.
describe('Argument', () => {
  it('evaluates Argument(1+i) to the exact value pi/4', () => {
    const result = engine
      .expr(['Argument', ['Complex', 1, 1]])
      .evaluate();
    expect(result.isSame(engine.Pi.div(4))).toBe(true);
    expect(result.toString()).not.toMatch(/ArcTan2/i);
  });

  it('numerically approximates Argument(1+i) to pi/4', () => {
    const result = engine.expr(['Argument', ['Complex', 1, 1]]).N();
    const value = result.re;
    expect(value).not.toBeNaN();
    expect(value).toBeCloseTo(Math.PI / 4, 10);
  });

  it('evaluates Argument(-1) to pi', () => {
    const result = engine.expr(['Argument', -1]).evaluate();
    expect(result.isSame(engine.Pi)).toBe(true);
  });

  it('numerically approximates Argument(-1) to pi', () => {
    const value = engine.expr(['Argument', -1]).N().re;
    expect(value).toBeCloseTo(Math.PI, 10);
  });

  it('evaluates Argument(1) to 0', () => {
    const result = engine.expr(['Argument', 1]).evaluate();
    expect(result.isSame(0)).toBe(true);
  });

  it('evaluates Argument in other quadrants correctly', () => {
    expect(
      engine.expr(['Argument', ['Complex', -1, 1]]).N().re
    ).toBeCloseTo((3 * Math.PI) / 4, 10);
    expect(
      engine.expr(['Argument', ['Complex', 1, -1]]).N().re
    ).toBeCloseTo(-Math.PI / 4, 10);
    expect(
      engine.expr(['Argument', ['Complex', -1, -1]]).N().re
    ).toBeCloseTo((-3 * Math.PI) / 4, 10);
  });

  it('evaluates Argument(NaN) to NaN, not to pi', () => {
    // The zero-imaginary-part branch splits on `op >= 0`, which is false for
    // NaN, so before the guard a NaN operand was reported as if it were on
    // the negative real axis and answered `π`. NaN has no phase angle.
    expect(engine.expr(['Argument', NaN]).evaluate().isNaN).toBe(true);
    expect(engine.expr(['Argument', NaN]).N().isNaN).toBe(true);
    expect(
      engine.expr(['Argument', ['Complex', NaN, 0]]).evaluate().isNaN
    ).toBe(true);
  });
});

describe('Arg (alias for Argument)', () => {
  it('canonicalizes Arg(z) to Argument(z)', () => {
    expect(engine.expr(['Arg', 'ImaginaryUnit']).operator).toBe('Argument');
  });

  it('evaluates Arg(i) to the exact value pi/2', () => {
    const result = engine.expr(['Arg', 'ImaginaryUnit']).evaluate();
    expect(result.isSame(engine.Pi.div(2))).toBe(true);
  });

  it('numerically approximates Arg(1+i) to pi/4', () => {
    const value = engine.expr(['Arg', ['Complex', 1, 1]]).N().re;
    expect(value).toBeCloseTo(Math.PI / 4, 10);
  });

  it('serializes back as Argument (alias is input-side)', () => {
    expect(engine.expr(['Arg', ['Complex', 1, 1]]).toString()).toMatch(
      /Argument/
    );
  });
});

// `Re` and `Im` were undefined operators, so `["Re", z]` stayed inert forever
// while `Real`/`Imaginary` were the heads that actually compute. They are now
// canonical-rewrite aliases, built like `Arg` → `Argument` above.
describe('Re / Im (aliases for Real / Imaginary)', () => {
  // An exact complex operand, so the tests also witness that the alias reaches
  // the exact component channel rather than a machine projection.
  const z = [
    'Add',
    ['Rational', 1, 3],
    ['Multiply', ['Rational', 2, 5], 'ImaginaryUnit'],
  ];

  it('canonicalizes Re(z) to Real(z) and Im(z) to Imaginary(z)', () => {
    expect(engine.expr(['Re', z]).operator).toBe('Real');
    expect(engine.expr(['Im', z]).operator).toBe('Imaginary');
  });

  it('evaluates to the exact components', () => {
    expect(engine.expr(['Re', z]).evaluate().toString()).toBe('1/3');
    expect(engine.expr(['Im', z]).evaluate().toString()).toBe('2/5');
  });

  it('agrees with the preferred heads on a Gaussian integer', () => {
    expect(engine.expr(['Re', ['Complex', 3, 4]]).evaluate().toString()).toBe(
      '3'
    );
    expect(engine.expr(['Im', ['Complex', 3, 4]]).evaluate().toString()).toBe(
      '4'
    );
  });

  it('parses \\Re and \\Im to the preferred heads, and round-trips', () => {
    expect(engine.parse('\\Re(1+i)').json).toEqual([
      'Real',
      ['Complex', 1, 1],
    ]);
    expect(engine.parse('\\Im(1+i)').json).toEqual([
      'Imaginary',
      ['Complex', 1, 1],
    ]);
    // The serializer already emits the standard commands, so a parse of the
    // serialization is the same expression.
    const re = engine.expr(['Real', ['Complex', 1, 1]]);
    expect(re.latex).toBe('\\Re(1+\\imaginaryI)');
    expect(engine.parse(re.latex).json).toEqual(re.json);
  });

  it('resolves the function-style spellings now that the heads exist', () => {
    expect(engine.parse('\\operatorname{Re}(z)').json).toEqual(['Real', 'z']);
    expect(engine.parse('\\operatorname{Im}(z)').json).toEqual([
      'Imaginary',
      'z',
    ]);
  });
});

// An alias must fail where the name it stands for fails, and claim what that
// name claims. Building the target with `ce._fn()` skipped signature
// validation, so `Re(1, 2)` silently dropped the extra operand and answered
// `1` while `Real(1, 2)` reported it; and an alias that declared only the
// narrow `(number) -> real` signature claimed `real` for `Re(NaN)` on the
// structural route (where the canonical rewrite has not run), a type that
// does not admit NaN. All three aliases in `library/complex.ts` are checked
// together, `Arg` included.
describe('Re / Im / Arg agree with their targets', () => {
  const aliases: [string, string][] = [
    ['Re', 'Real'],
    ['Im', 'Imaginary'],
    ['Arg', 'Argument'],
  ];

  it('rejects the same argument lists the target rejects', () => {
    for (const [alias, target] of aliases) {
      for (const ops of [[1, 2], []]) {
        const a = engine.expr([alias, ...ops] as any).evaluate();
        const t = engine.expr([target, ...ops] as any).evaluate();
        expect(a.isValid).toBe(false);
        expect(a.toString()).toBe(t.toString());
      }
    }
  });

  it('makes the same type claim on the STRUCTURAL route', () => {
    for (const [alias, target] of aliases) {
      for (const z of [
        engine.NaN,
        engine.PositiveInfinity,
        engine.expr(['Complex', 1, 2]),
      ]) {
        const a = engine.function(alias, [z], { form: 'structural' });
        const t = engine.function(target, [z], { form: 'structural' });
        expect(a.type.toString()).toBe(t.type.toString());
      }
    }
  });
});

describe('AbsArg', () => {
  it('produces a sane (magnitude, argument) tuple for 1+i', () => {
    const result = engine.expr(['AbsArg', ['Complex', 1, 1]]).evaluate();
    expect(result.toString()).not.toMatch(/ArcTan2/i);
    const [abs, arg] = result.ops!;
    expect(abs.isSame(engine.expr(2).sqrt())).toBe(true);
    expect(arg.isSame(engine.Pi.div(4))).toBe(true);
  });

  it('numerically approximates both magnitude and argument', () => {
    const result = engine.expr(['AbsArg', ['Complex', 1, 1]]).N();
    const [abs, arg] = result.ops!;
    expect(abs.re).toBeCloseTo(Math.SQRT2, 10);
    expect(arg.re).toBeCloseTo(Math.PI / 4, 10);
  });
});
