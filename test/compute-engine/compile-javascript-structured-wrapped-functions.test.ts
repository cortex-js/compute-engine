import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { MathJsonExpression } from '../../src/math-json/types';

// The `numeric-kernel` profile on a real scalar function under `Conjugate`,
// `Real`, `Imaginary`, `Argument` or `Abs`, as an operand of a product, of
// a quotient and of a negation, in both modes. Each program either compiles
// to the doubles of the existing compiler (`cse: false, constantFold:
// false`) or declines with `outside-profile`: never an internal error.
// `Conjugate` of a real operand is that operand (the form `identity` of
// the lowering), so `x · Conjugate(Haversine(2y))` reaches the grouping of
// the haversine in the product, and declines as `x · Haversine(2y)` does;
// its emission failed before.

type Json = MathJsonExpression;

const HEADS = [
  'Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc', 'Sinh', 'Cosh', 'Tanh', 'Coth',
  'Sech', 'Csch', 'Arctan', 'Arsinh', 'Gamma', 'Erf', 'Erfc', 'Digamma',
  'Haversine', 'Arcsin', 'Arccos', 'Arcosh', 'Artanh', 'Sign', 'Ceil',
  'Floor', 'Round', 'Truncate', 'Fract', 'Exp', 'Ln', 'Sqrt', 'Abs',
  'Arccot', 'Arcsch', 'Arccsc', 'Arcsec', 'Arcoth', 'Arsech',
];
const WRAPPERS = ['Conjugate', 'Real', 'Imaginary', 'Argument', 'Abs'];
const PARENTS: [string, (w: Json) => Json][] = [
  ['x·w', (w) => ['Multiply', 'x', w]],
  ['x/w', (w) => ['Divide', 'x', w]],
  ['−w', (w) => ['Negate', w]],
];
const POINTS = [
  { x: 0.7, y: 0.3 },
  { x: -1.2, y: 1.9 },
  { x: 2, y: -0.45 },
];

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
    return false;
  const [p, q] = [a as { re: number; im: number }, b as { re: number; im: number }];
  return Object.is(p.re, q.re) && Object.is(p.im, q.im);
}

describe('STRUCTURED FUNCTIONS: a real function under Conjugate, Real, Imaginary, Argument, Abs', () => {
  for (const mode of ['strict', 'complex'] as const)
    test(`${mode} mode: the doubles of the existing compiler or a decline`, () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.declare('y', 'real');
      const failures: string[] = [];
      let admitted = 0;
      for (const head of HEADS)
        for (const wrapper of WRAPPERS)
          for (const [, parent] of PARENTS) {
            const json = parent([wrapper, [head, ['Multiply', 2, 'y']]]);
            const expr = ce.box(json);
            let profile: CompilationResult<'javascript'>;
            try {
              profile = compile(expr, {
                profile: 'numeric-kernel',
                fallback: false,
                mode,
              }) as CompilationResult<'javascript'>;
            } catch (e) {
              const code = (e as { diagnostic?: { code?: string } }).diagnostic?.code;
              if (code !== 'outside-profile')
                failures.push(`${JSON.stringify(json)}: ${(e as Error).message}`);
              continue;
            }
            admitted += 1;
            const existing = compile(expr, {
              cse: false,
              constantFold: false,
              fallback: false,
              mode,
            }) as CompilationResult<'javascript'>;
            for (const v of POINTS) {
              const a = (existing.run as unknown as (v: object) => unknown)(v);
              const b = (profile.run as unknown as (v: object) => unknown)(v);
              if (!same(a, b))
                failures.push(`${JSON.stringify(json)} at ${JSON.stringify(v)}: ${JSON.stringify(b)}, existing ${JSON.stringify(a)}`);
            }
          }
      expect(failures).toEqual([]);
      expect(admitted).toBeGreaterThan(100);
    });

  test('x · Conjugate(Haversine(2y)) declines as x · Haversine(2y) does', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    for (const json of [
      ['Multiply', 'x', ['Conjugate', ['Haversine', ['Multiply', 2, 'y']]]],
      ['Multiply', 'x', ['Haversine', ['Multiply', 2, 'y']]],
    ] as Json[])
      expect(() =>
        compile(ce.box(json), { profile: 'numeric-kernel', fallback: false })
      ).toThrow(
        'Haversine of 2y as an operand of Multiply is not in the profile'
      );
  });
});
