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
      expect(ast(out)).toEqual(ast(eq));
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

  // Not distinct symbols: the target stays an application in an `Assign`.
  for (const bad of ['f(x, x)', 'f(1)', 'f(_)']) {
    test(`${bad} := 1 stays an Assign`, () => {
      expect((ast(`${bad} := 1`) as { fn: unknown[] }).fn[0]).toBe('Assign');
    });
  }

  test('a non-application target is still a plain assignment', () => {
    expect(ast('x := 1')).toEqual({
      fn: ['Assign', { sym: 'x' }, { num: '1' }],
    });
  });
});
