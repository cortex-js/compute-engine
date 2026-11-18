/**
 * The discharges `IsMissing`, `Coalesce` and `AssertPresent` on
 * `interval-js` (README of `src/compute-engine/compilation/ir/`, "The
 * discharges"; `docs/COMPILATION-MODEL.md`, "Everything computed from an
 * absent value, except at a discharge").
 *
 * The test of an absent number is `_IA.isAbsent`, a verdict over the box:
 * `'true'` where the operand is absent at every point, `'false'` where it
 * is present at every point, `'maybe'` where it is absent at some points
 * only. Each case is checked against the interpreter at points of boxes
 * where the operand is present, absent, and absent over part of the box:
 *
 * - `IsMissing` gives that verdict.
 * - `Coalesce(a, b)` gives `a` where `a` is present over the box, `b` where
 *   it is absent, and the hull of both, `partial`, where it is absent over
 *   part of it.
 * - `AssertPresent(a)` gives `a` where it is present over part of the box
 *   at least, and throws where it is absent over the whole box (the
 *   interpreter gives the error `expected-present`), which `run()` answers
 *   with `entire`.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Box = { lo: number; hi: number };
type Inputs = Record<string, Box | Box[]>;
type Kinded = {
  kind: string;
  value?: Box;
};

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('k', 'integer');
ce.declare('L', 'list<real>');
ce.declare('n', 'integer');
// `w` admits NaN, an absent value.
ce.declare('w', 'nan | real');

const iv = (lo: number, hi = lo): Box => ({ lo, hi });

function run(json: Json, inputs: Inputs): unknown {
  const r = compile(ce.box(json as never), {
    to: 'interval-js',
    fallback: false,
  });
  expect(r.success).toBe(true);
  return r.run!(inputs as never);
}

/** The points of a box: each integer of it for `k`, else its ends and
 *  three points between. */
function points(name: string, b: Box): number[] {
  if (name === 'k') {
    const out: number[] = [];
    for (let n = Math.ceil(b.lo); n <= b.hi; n++) out.push(n);
    return out;
  }
  return [0, 0.25, 0.5, 0.75, 1].map((t) => b.lo + t * (b.hi - b.lo));
}

/** Every assignment of the points of the boxes of `inputs` (a list input
 *  is the list of the midpoints of its elements). */
function samples(inputs: Inputs): Record<string, Json>[] {
  let out: Record<string, Json>[] = [{}];
  for (const [name, b] of Object.entries(inputs)) {
    const values: Json[] = Array.isArray(b)
      ? [['List', ...b.map((e) => (e.lo + e.hi) / 2)]]
      : points(name, b);
    out = out.flatMap((s) => values.map((v) => ({ ...s, [name]: v })));
  }
  return out;
}

/** The interpreter's value at a point: a number, a boolean, a list of
 *  numbers (a point), or `'error'`. */
function read(v: Expression): unknown {
  if (isNumber(v)) return v.re;
  if (isSymbol(v, 'True')) return true;
  if (isSymbol(v, 'False')) return false;
  if (isFunction(v, 'Error')) return 'error';
  if (isFunction(v, 'Tuple')) return v.ops.map(read);
  throw new Error(`unexpected value ${v.toString()}`);
}

function interpret(json: Json, at: Record<string, Json>): unknown {
  const subs = Object.fromEntries(
    Object.entries(at).map(([k, v]) => [k, ce.box(v as never)])
  );
  return read(
    ce
      .box(json as never)
      .subs(subs)
      .evaluate()
  );
}

/** `IsMissing(operand)` over the box is `verdict`, and the interpreter
 *  agrees at every point: all `True`, all `False`, or both for
 *  `'maybe'`. */
function expectVerdict(operand: Json, inputs: Inputs, verdict: string): void {
  const json = ['IsMissing', operand];
  expect(run(json, inputs)).toBe(verdict);
  const values = new Set(samples(inputs).map((s) => interpret(json, s)));
  const expected = verdict === 'maybe' ? [false, true] : [verdict === 'true'];
  expect([...values].sort()).toEqual(expected);
}

/** `r` is the kinded result `kind` whose enclosure is `[lo, hi]`. */
function expectResult(r: unknown, kind: string, lo: number, hi: number) {
  const k = r as Kinded;
  expect(k.kind).toBe(kind);
  expect(k.value).toEqual({ lo, hi });
}

/** The interpreter's values of `json` at the points of the box lie in
 *  the enclosure `[lo, hi]`, and `[lo, hi]` is their hull. */
function expectHull(json: Json, inputs: Inputs, lo: number, hi: number) {
  const values = samples(inputs).map((s) => interpret(json, s) as number);
  expect(Math.min(...values)).toBe(lo);
  expect(Math.max(...values)).toBe(hi);
}

describe('IsMissing on interval-js', () => {
  const at = ['At', ['List', 1, 2, 3], 'k'];
  test.each([
    ['in range', iv(1, 2), 'false'],
    ['out of range', iv(4, 5), 'true'],
    ['in range and out of it', iv(2, 4), 'maybe'],
  ])('At of a constant list, k %s', (_, k, verdict) =>
    expectVerdict(at, { k }, verdict)
  );

  const restriction = ['If', ['Greater', 'x', 0], 'x'];
  test.each([
    ['x > 0', iv(1, 2), 'false'],
    ['x < 0', iv(-2, -1), 'true'],
    ['x of both signs', iv(-1, 1), 'maybe'],
  ])('a selection that takes no arm, %s', (_, x, verdict) =>
    expectVerdict(restriction, { x }, verdict)
  );

  test('At of a list input', () => {
    const L = [iv(1), iv(2)];
    expectVerdict(['At', 'L', 'k'], { L, k: iv(2, 3) }, 'maybe');
    expectVerdict(['At', 'L', 'k'], { L, k: iv(3, 4) }, 'true');
  });

  const point = ['If', ['Greater', 'x', 0], ['Tuple', 'x', 'y']];
  test.each([
    ['x > 0', iv(1, 2), 'false'],
    ['x < 0', iv(-2, -1), 'true'],
    ['x of both signs', iv(-1, 1), 'maybe'],
  ])('a point, %s', (_, x, verdict) =>
    expectVerdict(point, { x, y: iv(3) }, verdict)
  );

  test('the written Missing', () => expectVerdict('Missing', {}, 'true'));

  test('a value that is never absent', () => {
    expectVerdict('x', { x: iv(-1, 1) }, 'false');
    // A list is present, whatever its elements are.
    expectVerdict('L', { L: [iv(1), iv(2)] }, 'false');
    // A length is a plain integer of the mode.
    expectVerdict(['Length', 'L'], { L: [iv(1), iv(2)] }, 'false');
  });

  test('a boolean: no producer of an absent boolean compiles here', () => {
    // The interpreter's `If` of a relation with no else arm is False where
    // its condition fails, not Missing.
    expectVerdict(
      ['If', ['Greater', 'x', 0], ['Less', 'y', 1]],
      { x: iv(-2, 1), y: iv(0) },
      'false'
    );
  });
});

describe('Coalesce on interval-js', () => {
  const at = ['At', ['List', 1, 2, 3], 'k'];
  const json = ['Coalesce', at, 0];

  test('k in range: the value', () => {
    expectResult(run(json, { k: iv(1, 2) }), 'interval', 1, 2);
    expectHull(json, { k: iv(1, 2) }, 1, 2);
  });

  test('k out of range: the fallback', () => {
    expectResult(run(json, { k: iv(4, 5) }), 'interval', 0, 0);
    expectHull(json, { k: iv(4, 5) }, 0, 0);
  });

  test('k in range and out of it: the hull of both', () => {
    expectResult(run(json, { k: iv(2, 4) }), 'partial', 0, 3);
    expectHull(json, { k: iv(2, 4) }, 0, 3);
  });

  test('an absent fallback leaves the value', () => {
    expectResult(
      run(['Coalesce', at, 'Missing'], { k: iv(2, 4) }),
      'partial',
      2,
      3
    );
  });

  const restriction = ['Coalesce', ['If', ['Greater', 'x', 0], 'x'], -5];
  test.each([
    ['x > 0', iv(1, 2), 'interval', 1, 2],
    ['x < 0', iv(-2, -1), 'interval', -5, -5],
    ['x of both signs', iv(-1, 1), 'partial', -5, 1],
  ])('a selection that takes no arm, %s', (_, x, kind, lo, hi) => {
    expectResult(run(restriction, { x }), kind, lo, hi);
    // The enclosure holds every value of the interpreter (at x = 0 the
    // value is the fallback; the enclosure of the arm reaches 0).
    for (const s of samples({ x })) {
      const v = interpret(restriction, s) as number;
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
  });

  test('the written Missing', () => {
    expectResult(run(['Coalesce', 'Missing', 3], {}), 'interval', 3, 3);
  });

  test('three operands, each lowered only where the ones before are absent', () => {
    const chain = [
      'Coalesce',
      ['At', ['List', 1, 2], 'k'],
      ['If', ['Greater', 'x', 0], 'x'],
      7,
    ];
    expectResult(run(chain, { k: iv(1), x: iv(-1) }), 'interval', 1, 1);
    expectResult(run(chain, { k: iv(5), x: iv(1, 2) }), 'interval', 1, 2);
    expectResult(run(chain, { k: iv(5), x: iv(-2, -1) }), 'interval', 7, 7);
    expectResult(run(chain, { k: iv(2, 3), x: iv(-1, 1) }), 'partial', 0, 7);
    expect(interpret(chain, { k: 5, x: -1 })).toBe(7);
    expect(interpret(chain, { k: 5, x: 1.5 })).toBe(1.5);
  });

  test('the fallback is not computed where the value is present', () => {
    // `AssertPresent` of an absent value throws: computed, it would make
    // the result `entire`.
    const json = [
      'Add',
      1,
      [
        'Coalesce',
        ['If', ['Greater', 'x', 0], 'x'],
        ['AssertPresent', ['At', ['List', 1, 2], 'k']],
      ],
    ];
    expectResult(run(json, { x: iv(1, 2), k: iv(5) }), 'interval', 2, 3);
    expect(run(json, { x: iv(-2, -1), k: iv(5) })).toEqual({ kind: 'entire' });
    expect(interpret(json, { x: -1, k: 5 })).toBe('error');
    expectResult(run(json, { x: iv(-2, -1), k: iv(1) }), 'interval', 2, 2);
  });

  test('a point', () => {
    const json = [
      'Coalesce',
      ['If', ['Greater', 'x', 0], ['Tuple', 'x', 'y']],
      ['Tuple', 0, 0],
    ];
    const y = iv(3);
    const present = run(json, { x: iv(1, 2), y }) as Kinded[];
    expectResult(present[0], 'interval', 1, 2);
    expectResult(present[1], 'interval', 3, 3);
    const absent = run(json, { x: iv(-2, -1), y }) as Kinded[];
    expectResult(absent[0], 'interval', 0, 0);
    expectResult(absent[1], 'interval', 0, 0);
    expect(interpret(json, { x: -1.5, y: 3 })).toEqual([0, 0]);
    const both = run(json, { x: iv(-1, 1), y }) as Kinded[];
    expectResult(both[0], 'partial', 0, 1);
    expectResult(both[1], 'partial', 0, 3);
  });

  test('At of a list input', () => {
    const L = [iv(1), iv(2)];
    const json = ['Coalesce', ['At', 'L', 'k'], 0];
    expectResult(run(json, { L, k: iv(2, 3) }), 'partial', 0, 2);
    expectHull(json, { L, k: iv(2, 3) }, 0, 2);
  });
});

describe('AssertPresent on interval-js', () => {
  const json = ['AssertPresent', ['At', ['List', 1, 2, 3], 'k']];

  test('k in range: the value', () => {
    expectResult(run(json, { k: iv(1, 2) }), 'interval', 1, 2);
    expectHull(json, { k: iv(1, 2) }, 1, 2);
  });

  test('k out of range: the error, entire', () => {
    expect(run(json, { k: iv(4, 5) })).toEqual({ kind: 'entire' });
    for (const s of samples({ k: iv(4, 5) }))
      expect(interpret(json, s)).toBe('error');
  });

  test('k in range and out of it: the value where it is present', () => {
    expectResult(run(json, { k: iv(2, 4) }), 'partial', 2, 3);
    expect(samples({ k: iv(2, 4) }).map((s) => interpret(json, s))).toEqual([
      2,
      3,
      'error',
    ]);
  });

  test('a point', () => {
    const json = [
      'AssertPresent',
      ['If', ['Greater', 'x', 0], ['Tuple', 'x', 'y']],
    ];
    const y = iv(3);
    const present = run(json, { x: iv(1, 2), y }) as Kinded[];
    expectResult(present[0], 'interval', 1, 2);
    expectResult(present[1], 'interval', 3, 3);
    expect(run(json, { x: iv(-2, -1), y })).toEqual({ kind: 'entire' });
    expect(interpret(json, { x: -1.5, y: 3 })).toBe('error');
    const both = run(json, { x: iv(-1, 1), y }) as Kinded[];
    expectResult(both[0], 'partial', 0, 1);
    expectResult(both[1], 'partial', 3, 3);
  });

  test('a value that is never absent compiles to itself', () => {
    expectResult(
      run(['AssertPresent', 'x'], { x: iv(1, 2) }),
      'interval',
      1,
      2
    );
  });
});

describe('the discharges that decline on interval-js', () => {
  test.each([
    // The NaN of `Sqrt(-4)` on the real lane is the interpreter's `2i`, not
    // an absent value.
    ['Coalesce', ['Coalesce', ['Sqrt', 'x'], 0]],
    ['IsMissing', ['IsMissing', ['Ln', 'x']]],
  ])('%s of a value whose type admits a complex value', (_, json) => {
    expect(() =>
      compile(ce.box(json as never), { to: 'interval-js', fallback: false })
    ).toThrow(/on the real lane/);
  });
});

describe('a pole is not an absent value', () => {
  // A kernel gives `empty` at a pole of a point box (`1/x` at `[0, 0]`),
  // the encoding of the producers of an absent value. A discharge reads it
  // as surely absent only for an operand that no kernel makes `empty`
  // where the interpreter has a value; elsewhere its `'true'` is `'maybe'`.
  test.each([
    ['1/x', ['Divide', 1, 'x'], 'x', 0],
    ['1 + 1/x', ['Add', 1, ['Divide', 1, 'x']], 'x', 0],
    ['Floor(1/x)', ['Floor', ['Divide', 1, 'x']], 'x', 0],
    ['Gamma(x) at 0', ['Gamma', 'x'], 'x', 0],
    ['Gamma(x) at -2', ['Gamma', 'x'], 'x', -2],
    ['Factorial(n) at -1', ['Factorial', 'n'], 'n', -1],
  ])('IsMissing(%s) at its pole is maybe', (_, operand, name, at) => {
    const json = ['IsMissing', operand];
    expect(run(json, { [name]: iv(at) })).toBe('maybe');
    expect(interpret(json, { [name]: at })).toBe(false);
  });

  test('Coalesce(1/x, 0) at the pole is entire', () => {
    // The interpreter's value is `~oo`, which no bounded interval holds
    // (`1/x` alone at `[0, 0]` is `empty`); the fallback `0` would be the
    // value of an absent operand: the answer holds both.
    expect(run(['Divide', 1, 'x'], { x: iv(0) })).toEqual({ kind: 'empty' });
    expect(interpret(['IsMissing', ['Divide', 1, 'x']], { x: 0 })).toBe(false);
    expect(run(['Coalesce', ['Divide', 1, 'x'], 0], { x: iv(0) })).toEqual({
      kind: 'entire',
    });
    expectResult(
      run(['Coalesce', ['Divide', 1, 'x'], 0], { x: iv(2) }),
      'interval',
      0.5,
      0.5
    );
  });

  test('AssertPresent(1/x) at the pole does not throw', () => {
    expect(run(['AssertPresent', ['Divide', 1, 'x']], { x: iv(0) })).toEqual({
      kind: 'empty',
    });
  });

  test('a value computed from a producer by safe operations stays decided', () => {
    const json = ['Add', ['At', 'L', 'k'], 1];
    const L = [iv(1), iv(2)];
    expectVerdict(json, { L, k: iv(3, 4) }, 'true');
    expectVerdict(json, { L, k: iv(1, 2) }, 'false');
    expectVerdict(['Divide', ['At', 'L', 'k'], 2], { L, k: iv(3, 4) }, 'true');
    // A division by a value that can be 0 is not safe.
    expect(
      run(['IsMissing', ['Divide', ['At', 'L', 'k'], 'x']], {
        L,
        k: iv(3, 4),
        x: iv(1),
      })
    ).toBe('maybe');
  });
});

describe('review witnesses', () => {
  test('At of a list that holds an absent element', () => {
    const at = ['At', ['List', ['If', ['Greater', 'x', 0], 'x'], 1], 'k'];
    const inputs = { x: iv(-1), k: iv(1, 2) };
    expectVerdict(at, inputs, 'maybe');
    expectResult(run(['Coalesce', at, 0], inputs), 'partial', 0, 1);
    expectHull(['Coalesce', at, 0], inputs, 0, 1);
    expectVerdict(at, { x: iv(-1), k: iv(1) }, 'true');
  });

  test('At of a Map whose callback can select no arm', () => {
    const at = [
      'At',
      ['Map', ['Function', ['If', ['Greater', 't', 0], 't'], 't'], 'L'],
      'k',
    ];
    const inputs = { L: [iv(-1), iv(2)], k: iv(1, 2) };
    expectVerdict(at, inputs, 'maybe');
    expectResult(run(['Coalesce', at, -7], inputs), 'partial', -7, 2);
    expectHull(['Coalesce', at, -7], inputs, -7, 2);
  });

  test('entire can be absent', () => {
    const at = ['At', ['List', 1, 2, 3], ['Floor', ['Divide', 'x', 'y']]];
    const inputs = { x: iv(-1, 1), y: iv(0, 1) };
    expect(run(['IsMissing', at], inputs)).toBe('maybe');
    expect(interpret(['IsMissing', at], { x: 1, y: 0.1 })).toBe(true);
    expect(interpret(['IsMissing', at], { x: 1, y: 1 })).toBe(false);
    expectResult(
      run(['If', ['IsMissing', at], 1, 0], inputs),
      'interval',
      0,
      1
    );
  });

  test('NaN is absent', () => {
    const inputs = { w: iv(NaN) };
    expect(run(['IsMissing', 'w'], inputs)).toBe('true');
    expectResult(run(['Coalesce', 'w', 0], inputs), 'interval', 0, 0);
    expect(run(['AssertPresent', 'w'], inputs)).toEqual({ kind: 'entire' });
    expect(interpret(['IsMissing', 'w'], { w: 'NaN' })).toBe(true);
    expect(interpret(['Coalesce', 'w', 0], { w: 'NaN' })).toBe(0);
  });
});

describe('At of a list that holds a jump keeps the jump', () => {
  // The values of main before the change of `_IA.at`: a `singular`
  // element is not an absence.
  const floorAt = ['At', ['List', ['Floor', 'x'], 2, 3], 'k'];
  test.each([
    [
      floorAt,
      iv(1),
      { kind: 'singular', at: 1, continuity: 'right', value: iv(0, 1) },
    ],
    [
      floorAt,
      iv(1, 2),
      { kind: 'singular', at: 1, continuity: 'right', value: iv(0, 2) },
    ],
    [
      ['At', ['List', ['Floor', 'x'], ['Floor', ['Multiply', 2, 'x']]], 'k'],
      iv(2),
      { kind: 'singular', at: 2, continuity: 'right', value: iv(1, 3) },
    ],
  ])('%j at k = %j', (json, k, expected) => {
    expect(run(json, { x: iv(0.5, 1.5), k })).toEqual(expected);
  });
});
