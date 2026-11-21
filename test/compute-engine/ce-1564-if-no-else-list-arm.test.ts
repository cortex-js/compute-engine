/**
 * CE-1564: an `If` with no else whose arm is a flat list of numbers or a
 * list of points (a Desmos restriction of a list of curves, `f(x) {0 < x}`).
 * Where the condition holds, the value is the arm, as in the interpreter.
 * Where it does not, the interpreter gives `Missing` and the compiled value
 * is the list of NaN (of points of NaN) of the length of the arm, the
 * absent value of each element (`docs/COMPILATION-MODEL.md`, "Caveats of
 * compiled code"). A length that is made in the arm is not visible in the
 * other arm, and declines.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('L', 'list<real>');
ce.declare('P', 'list<tuple<real, real>>');
ce.declare('V', 'list<real^3>');

const OPTIONS = { fallback: false } as const;
const box = (json: unknown) => ce.box(json as never);
const js = (json: unknown) => compile(box(json), OPTIONS);

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

const positive = ['Less', 0, 'x'];

describe('CE-1564: If with no else of a list arm on JavaScript', () => {
  test('a list of curves restricted to x > 0', () => {
    const json = ['If', positive, ['Multiply', 'x', 'L']];
    const r = js(json);
    expect(r.success).toBe(true);
    expect(r.run!({ x: 2, L: [1, 2] } as never)).toEqual([2, 4]);
    expect(
      ce.withValues({ x: 2, L: ce.box(['List', 1, 2]) } as never, () =>
        box(json).evaluate().toString()
      )
    ).toBe('[2,4]');
    expect(r.run!({ x: -2, L: [1, 2, 3] } as never)).toEqual([NaN, NaN, NaN]);
  });

  test('a list of stated length', () => {
    const r = js(['If', positive, ['List', 'x', 2, 3]]);
    expect(r.run!({ x: 2 } as never)).toEqual([2, 2, 3]);
    expect(r.run!({ x: -2 } as never)).toEqual([NaN, NaN, NaN]);
  });

  test('a list of points', () => {
    const r = js(['If', positive, 'P']);
    expect(
      r.run!({
        x: 1,
        P: [
          [1, 2],
          [3, 4],
        ],
      } as never)
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(
      r.run!({
        x: -1,
        P: [
          [1, 2],
          [3, 4],
        ],
      } as never)
    ).toEqual([
      [NaN, NaN],
      [NaN, NaN],
    ]);
  });

  test('a nested If with no else', () => {
    const r = js(['If', positive, ['If', ['Less', 1, 'x'], 'L']]);
    expect(r.run!({ x: 2, L: [1, 2] } as never)).toEqual([1, 2]);
    expect(r.run!({ x: 0.5, L: [1, 2] } as never)).toEqual([NaN, NaN]);
    expect(r.run!({ x: -1, L: [1, 2] } as never)).toEqual([NaN, NaN]);
  });

  test('an arm of a result Which, and the last expression of a Block', () => {
    const which = js([
      'Which',
      positive,
      ['If', ['Less', 1, 'x'], 'L'],
      'True',
      ['List', 7, 8],
    ]);
    expect(which.run!({ x: 0.5, L: [1, 2] } as never)).toEqual([NaN, NaN]);
    expect(which.run!({ x: -1, L: [1, 2] } as never)).toEqual([7, 8]);
    const block = js(['Block', ['If', positive, 'L']]);
    expect(block.run!({ x: -1, L: [1, 2] } as never)).toEqual([NaN, NaN]);
  });

  // The interpreter's value is `Missing`: an operator that reads it as
  // absent would see a present list of NaN. The readers that cannot tell
  // the two apart are in `ce-1606-if-no-else-list-arm-readers.test.ts`.
  test.each([
    ['IsMissing', ['IsMissing', ['If', positive, 'L']]],
    ['Coalesce', ['Coalesce', ['If', positive, 'L'], ['List', 7]]],
    ['AssertPresent', ['AssertPresent', ['If', positive, 'L']]],
    ['Length', ['Length', ['If', positive, 'L']]],
    ['Rest', ['Rest', ['If', positive, 'L']]],
  ])('the value read by %s declines', (_, json) => {
    expect(failure(() => js(json))).toMatch(
      /an If with no else of a list arm whose value is read by other than At, First, Last, an arithmetic operator or a reduction/
    );
  });

  test('one boxed restriction read by IsMissing and returned declines', () => {
    const r = box(['If', positive, 'L']);
    const e = ce.function('If', [
      ce.function('IsMissing', [r]),
      box(['List', 7, 8]),
      r,
    ]);
    expect(failure(() => compile(e, OPTIONS))).toMatch(
      /an If with no else of a list arm whose value is read by other than At, First, Last, an arithmetic operator or a reduction/
    );
  });

  test('a shared graph of conditionals is walked once per node', () => {
    let e = box(['If', positive, 'L']);
    for (let i = 0; i < 40; i++)
      e = ce.function('If', [box(['Less', i, 'x']), e, e]);
    const start = Date.now();
    failure(() => compile(e, OPTIONS));
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  test('a length made in the arm declines', () => {
    expect(
      failure(() => js(['If', positive, ['Range', 1, ['Floor', 'x']]]))
    ).toMatch(/an If with no else whose list arm has a length made in the arm/);
  });

  test('a Which with no True clause still declines', () => {
    expect(failure(() => js(['Which', positive, 'L']))).toMatch(
      /arms of two types/
    );
  });
});

describe('CE-1564: If with no else of a list arm on GLSL', () => {
  test('a list of stated length: the else is a vector of NaN', () => {
    const r = compile(box(['If', positive, 'V']), { ...OPTIONS, to: 'glsl' });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/v\d+ = V;/);
    expect(r.code).toMatch(
      /= vec3\(uintBitsToFloat\(0x7fc00000u\), uintBitsToFloat\(0x7fc00000u\), uintBitsToFloat\(0x7fc00000u\)\);/
    );
  });
});
