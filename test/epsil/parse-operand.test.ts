import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil';

// `parse(s)` evaluates to the evaluated parsed expression, as a symbol that
// holds the parsed expression does. An operator that holds its operand
// (`solve`, `D`, `integrate`, `expand`, `limit`) reads the parsed expression
// without evaluating it, so an `Equal` does not collapse to a boolean and an
// unknown with a value stays an unknown.

const PROGRAMS: [name: string, source: string, value: unknown][] = [
  [
    'evaluate of parse',
    String.raw`evaluate(parse(#"1011_2 \cdot 101_2"#))`,
    55,
  ],
  ['parse as a statement', String.raw`parse(#"1011_2 \cdot 101_2"#)`, 55],
  [
    'parse through a let',
    String.raw`let p = parse(#"1011_2 \cdot 101_2"#)` + '\np',
    55,
  ],
  ['parse reads the value of a symbol', 'let x = 3\nparse("x + x")', 6],
  ['parse of a free symbol', 'parse("x + x")', ['Multiply', 2, 'x']],
  ['parse in a function body', 'function f(t) { parse("t^2") }\nf(3)', 9],
  [
    'solve of parse',
    'solve(parse("161_b + 134_b = 315_b"), b)',
    ['List', 0, 8],
  ],
  [
    'solve of parse with an unknown that has a value',
    'let y = 5\nsolve(parse("y^2 = 1"), y)',
    ['List', 1, -1],
  ],
  [
    'D of parse',
    'D(parse("y^3"), y)',
    ['Multiply', 3, ['Power', 'y', 2]],
  ],
  [
    'D of parse of a string symbol',
    'let s = "y^3"\nD(parse(s), y)',
    ['Multiply', 3, ['Power', 'y', 2]],
  ],
  [
    'integrate of parse',
    'integrate(parse("y^2"), y)',
    ['Multiply', ['Rational', 1, 3], ['Power', 'y', 3]],
  ],
  [
    'expand of parse',
    'expand(parse("(y+1)^2"))',
    ['Add', ['Power', 'y', 2], ['Multiply', 2, 'y'], 1],
  ],
  ['limit of parse', String.raw`limit(parse(#"\sin(y)/y"#), y, 0)`, 1],
  [
    'D of parse with a differentiation variable that has a value',
    'let y = 5\nD(parse("y^2"), y)',
    ['Multiply', 2, 'y'],
  ],
  [
    'expand of parse reads the value of a symbol',
    'let a = 2\nexpand(parse("(a*y+1)^2"))',
    ['Add', ['Multiply', 4, ['Power', 'y', 2]], ['Multiply', 4, 'y'], 1],
  ],
  // The parsed expression reads values that the string hides: a second call
  // after a change of `a` reads the new value.
  [
    'D of parse after a change of a symbol it reads',
    'let a = 1\nfunction f() { D(parse("a*y"), y) }\nlet r = f()\na = 3\n[r, f()]',
    ['List', 1, 3],
  ],
  ['parse of an assignment', 'parse("x := 5")\nx', 5],
  [
    'parse of an assignment in a function called twice',
    'let x = 0\nfunction g() { parse("x := x + 1") }\ng()\ng()\nx',
    2,
  ],
  ['parse of a string that does not parse', 'parse("")', 'Nothing'],
];

describe('PARSE AS AN OPERAND', () => {
  test.each(PROGRAMS)('%s', (_name, source, value) => {
    const result = executeEpsil(new ComputeEngine(), source);
    expect(result.value.json).toEqual(value);
  });

  test.each(PROGRAMS)('%s, asynchronously', async (_name, source, value) => {
    const result = await executeEpsilAsync(new ComputeEngine(), source);
    expect(result.value.json).toEqual(value);
  });

  test('N of parse gives a numeric approximation', () => {
    const ce = new ComputeEngine();
    const parsed = ['Parse', { str: String.raw`\frac{\pi}{2}` }] as const;
    expect(ce.expr(['N', parsed]).evaluate().re).toBeCloseTo(Math.PI / 2, 12);
    expect(ce.expr(parsed).N().re).toBeCloseTo(Math.PI / 2, 12);
  });
});
