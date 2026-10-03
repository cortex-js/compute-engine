import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';

// `f(x) := body` defines `f` exactly as `f(x) = body` does.

// MathJSON without the source spans (`:=` is a character longer than `=`).
const ast = (src: string): unknown =>
  JSON.parse(
    JSON.stringify(parseEpsil(src)[0], (k, v) =>
      k === 'sourceOffsets' ? undefined : v
    )
  );

const run = (src: string) => executeEpsil(new ComputeEngine(), src);

const cases: [string, string, string][] = [
  ['one parameter', 'f(x) = x^2 + a', 'f(x) := x^2 + a'],
  ['two parameters', 'f(x, y) = x*y + a', 'f(x, y) := x*y + a'],
  ['typed parameter', 'f(x: integer) = x + 1', 'f(x: integer) := x + 1'],
  ['return type', 'f(x) -> integer = x + 1', 'f(x) -> integer := x + 1'],
  [
    'generic parameter type',
    'f(x: tuple<integer, integer>) = 1',
    'f(x: tuple<integer, integer>) := 1',
  ],
  ['rest parameter', 'f(...xs) = xs', 'f(...xs) := xs'],
  [
    'effect specifier',
    'f(x) random -> integer = 1',
    'f(x) random -> integer := 1',
  ],
  ['where clause', 'f(x: T) -> T where T = x', 'f(x: T) -> T where T := x'],
  [
    'where clause with a bound',
    'f(x: T) -> T where T: number = x',
    'f(x: T) -> T where T: number := x',
  ],
  [
    'where clause with two names',
    'f(x: T, y: U) -> T where T, U = x',
    'f(x: T, y: U) -> T where T, U := x',
  ],
  ['wildcard parameter', 'f(_) = 1', 'f(_) := 1'],
  ['repeated parameter', 'f(x, x) = 1', 'f(x, x) := 1'],
  ['literal-pattern clause', 'f(1) = 1', 'f(1) := 1'],
  [
    'inside a block',
    'function g() {\n f(x) = x + 1\n f(2)\n}',
    'function g() {\n f(x) := x + 1\n f(2)\n}',
  ],
];

describe('EPSIL f(x) := body DEFINES A FUNCTION (#400)', () => {
  for (const [name, eq, colon] of cases) {
    test(`${name}: := parses to the same MathJSON as =`, () => {
      expect(ast(colon)).toEqual(ast(eq));
      expect(parseEpsil(colon)[1]).toHaveLength(parseEpsil(eq)[1].length);
    });
    test(`${name}: := serializes as =`, () => {
      const out = serializeEpsil(parseEpsil(colon)[0]!);
      expect(out).toBe(serializeEpsil(parseEpsil(eq)[0]!));
      // A generic definition (`where T`) serializes in the `function f<T>(…)
      // { body }` block form, because `f<T>(x) = …` is not a definition in
      // the grammar. The braces re-parse as a `Block` around the body, so
      // the round trip is not exact for either spelling.
      if (!eq.includes(' where ')) expect(ast(out)).toEqual(ast(eq));
    });
  }

  test('f(3) is a + 9 under both spellings', () => {
    expect(run('f(x) := x^2 + a\nf(3)').value?.toString()).toBe('a + 9');
    expect(run('f(x) = x^2 + a\nf(3)').value?.toString()).toBe('a + 9');
  });

  test('f(2, 5) with two parameters is 10', () => {
    expect(run('f(x, y) := x*y\nf(2, 5)').value?.toString()).toBe('10');
  });

  test('a definition inside a block is callable there', () => {
    expect(
      run('function g() {\n f(x) := x + 1\n f(2)\n}\ng()').value?.toString()
    ).toBe('3');
  });

  // Literal-pattern clauses accumulate under either spelling, so a base case
  // written with `:=` is not lost.
  test('clauses written with := accumulate as with =', () => {
    expect(run('f(0) := 1\nf(n) := n*f(n-1)\nf(5)').value?.toString()).toBe(
      '120'
    );
    expect(run('f(0) = 1\nf(n) := n*f(n-1)\nf(5)').value?.toString()).toBe(
      '120'
    );
  });

  test('a rest parameter collects the arguments', () => {
    expect(run('f(...xs) := count(xs)\nf(1, 2, 3)').value?.toString()).toBe(
      '3'
    );
  });

  test('a non-application target is still a plain assignment', () => {
    expect(ast('x := 1')).toEqual({
      fn: ['Assign', { sym: 'x' }, { num: '1' }],
    });
  });
});
