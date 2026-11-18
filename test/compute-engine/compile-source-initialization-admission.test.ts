import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { parseEpsil, resolveLibraryNames } from '../../src/epsil';
import type { MathJsonExpression } from '../../src/math-json/types';

const silence = jest.spyOn(console, 'warn').mockImplementation(() => {});
afterAll(() => silence.mockRestore());

function box(source: string) {
  const ce = new ComputeEngine();
  const [program, diagnostics] = parseEpsil(source);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return ce.box(resolveLibraryNames(program, source, ce));
}

const UNINITIALIZED: MathJsonExpression = [
  'Block',
  ['Declare', 's', "'unknown'", 0],
  ['Loop', ['Block', ['Declare', 'n', "'integer'"],
    ['If', ['Greater', 'i', 3], ['Assign', 'n', 1]],
    ['If', ['NotEqual', 'n', 1], ['Assign', 's', ['Add', 's', 'i']]]],
    ['Element', 'i', ['Range', 1, 5]]],
  's',
];

describe('source declarations require initialization before compilation', () => {
  test.each(['javascript', 'glsl', 'interval-js'])('a nested loop declines on %s', (to) => {
    const ce = new ComputeEngine();
    expect(compile(ce.box(UNINITIALIZED), { to }).success).toBe(false);
    let success = false;
    try { success = compile(ce.box(UNINITIALIZED), { to, fallback: false }).success; }
    catch { /* A strict target may throw its decline. */ }
    expect(success).toBe(false);
  });

  test('IR also declines the source declaration', () => {
    const ce = new ComputeEngine();
    expect(compile(ce.box(UNINITIALIZED), { to: 'javascript', profile: 'ir' }).success).toBe(false);
  });

  test('a later straight-line write does not supply an initialization proof', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Block', ['Declare', 'n', "'integer'"], ['Assign', 'n', 7], 'n']);
    expect(expr.evaluate().re).toBe(7);
    expect(compile(expr, { to: 'javascript' }).success).toBe(false);
  });

  test('the initialized loop control still compiles with the right value', () => {
    const source = JSON.parse(JSON.stringify(UNINITIALIZED)) as MathJsonExpression[];
    const loop = source[2] as MathJsonExpression[];
    const body = loop[1] as MathJsonExpression[];
    (body[1] as MathJsonExpression[]).push(0);
    const ce = new ComputeEngine();
    const result = compile(ce.box(source), { to: 'javascript', fallback: false });
    expect(result.success).toBe(true);
    expect(result.run?.({})).toBe(6);
  });

  test('a source signature paired with its same-scope function is initialized', () => {
    const expr = box('let f: (number) -> number\nfunction f(x) { x+1 }\nf(2)');
    const result = compile(expr, { to: 'javascript' });
    expect(result.run?.({})).toBe(3);
  });

  test('destructuring lowering initializes its generated temporary slots', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Block', ['Declare', 'a', "'unknown'", 2],
      ['Declare', 'b', "'unknown'", 3],
      ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 'b', 'a']],
      ['Add', ['Multiply', 'a', 10], 'b']]);
    expect(expr.evaluate().re).toBe(32);
    const result = compile(expr, { to: 'javascript' });
    expect(result.run?.({})).toBe(32);
  });

  test('recursive list execution preserves initialized source locals', () => {
    const expr = box('function f(n, acc: list) { let out = acc; if n > 0 { out = [...out, n]; out = f(n - 1, out) }; out }\nf(3, [])');
    const result = compile(expr, { to: 'javascript' });
    expect(result.run?.({})).toEqual([3, 2, 1]);
  });
});
