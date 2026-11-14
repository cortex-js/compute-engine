import { ComputeEngine, compile } from '../../src/compute-engine';
import {
  NonFiniteValue,
  BIGINT_HELPERS as B,
} from '../../src/compute-engine/compilation/bigint-runtime';
import { SYS_HELPERS } from '../../src/compute-engine/compilation/javascript-runtime';
import { isFunction, isNumber, isSymbol } from '../../src/compute-engine/boxed-expression/type-guards';
import { exactRational } from '../../src/compute-engine/compilation/compile-bigint-lane';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * CE-715, step 3 of `docs/plans/2026-10-31-ce715-bigint-compile-mode.md`:
 * the emission of `mode: 'bigint'` (`compile-bigint-emit.ts`) and its
 * runtime helpers (`bigint-runtime.ts`).
 *
 * Each compiled value is compared with the value of `evaluate()` of the
 * interpreter for the same inputs. The inputs are passed as `bigint`
 * values. A pole in the compiled code gives the `number` of the
 * `NonFiniteValue` that its helper throws, which the wrapper of the compiled
 * entry catches (step 4, §3.4). The boundary itself (the conversion of a
 * `number` input, the entry checks, the batch routes) is tested in
 * `compile-bigint-boundary.test.ts`.
 */

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('m', 'integer');
ce.declare('k0', 'integer<0..>');
ce.declare('L', 'list<integer>');
// A function with no declaration: its literal has an untyped parameter.
ce.parse('f(x) := x!').evaluate();
// A function declared `-> integer`: its body `x(x+1)/2` is a checked exact
// division.
ce.declare('half', '(integer) -> integer');
ce.box([
  'Assign',
  'half',
  ['Function', ['Divide', ['Multiply', 'x', ['Add', 'x', 1]], 2], 'x'],
]).evaluate();
ce.declare('quo', '(integer, integer) -> integer');
ce.box(['Assign', 'quo', ['Function', ['Divide', 'x', 'y'], 'x', 'y']]).evaluate();
// A recursive function declared `-> integer`.
ce.declare('fact', '(integer) -> integer');
ce.box([
  'Assign',
  'fact',
  [
    'Function',
    [
      'If',
      ['LessEqual', 'x', 1],
      1,
      ['Multiply', 'x', ['fact', ['Subtract', 'x', 1]]],
    ],
    'x',
  ],
]).evaluate();

type Json = Parameters<typeof ce.box>[0];
type Value = bigint | boolean | Value[];
type Inputs = Record<string, bigint | bigint[]>;

/** The value of an interpreter result, as the compiled code gives it. */
function interpreterValue(e: Expression): Value {
  if (isNumber(e)) {
    const r = exactRational(e);
    if (r === undefined || r.q !== 1n)
      throw new Error(`not an exact integer: ${e.toString()}`);
    return r.p;
  }
  if (isSymbol(e, 'True')) return true;
  if (isSymbol(e, 'False')) return false;
  if (isFunction(e, 'List')) return e.ops.map(interpreterValue);
  if (e.isFiniteCollection === true) return [...e.each()].map(interpreterValue);
  throw new Error(`not a value of the mode: ${e.toString()}`);
}

function boxInput(v: bigint | bigint[]): Expression {
  return Array.isArray(v)
    ? ce.function('List', v.map((x) => ce.number(x)))
    : ce.number(v);
}

function compiled(json: Json) {
  const r = compile(ce.box(json), { mode: 'bigint', fallback: false });
  expect(r.success).toBe(true);
  expect(r.mode).toBe('bigint');
  return r;
}

function run(json: Json, inputs: Inputs = {}): unknown {
  return compiled(json).run!(inputs as never);
}

function interpreted(json: Json, inputs: Inputs = {}): Value {
  const subs = Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => [k, boxInput(v)])
  );
  return interpreterValue(ce.box(json).subs(subs).evaluate());
}

/** The compiled value equals the value of `evaluate()`. */
function agrees(json: Json, inputs: Inputs = {}): Value {
  const expected = interpreted(json, inputs);
  expect(run(json, inputs)).toEqual(expected);
  return expected;
}

/** The compiled code gives the `number` `value` (`NaN` or `Infinity`):
 * a helper threw a `NonFiniteValue`, and the entry caught it (§3.4). */
function noValue(fn: () => unknown, value: number): void {
  const result = fn();
  expect(typeof result).toBe('number');
  expect(result).toBe(value);
}

/** The helper throws a `NonFiniteValue` that carries `value`. */
function pole(fn: () => unknown, value: number): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(NonFiniteValue);
  expect((caught as NonFiniteValue).value).toBe(value);
}

const TWO_53 = 2n ** 53n;

describe('the rows of §3.1, compared with evaluate()', () => {
  const catalan: Json = [
    'Subtract',
    ['Binomial', ['Multiply', 2, 'n'], 'n'],
    ['Binomial', ['Multiply', 2, 'n'], ['Add', 'n', 1]],
  ];
  it.each([10n, 40n, 100n])('the Catalan form at n = %s', (n) => {
    expect(typeof agrees(catalan, { n })).toBe('bigint');
  });

  it('the Catalan number C(40) is exact past 2^53', () => {
    expect(run(catalan, { n: 40n })).toBe(2622127042276492108820n);
  });

  it('Mod(n, 10) at n = 2^60 + 1 is 7', () => {
    expect(agrees(['Mod', 'n', 10], { n: 2n ** 60n + 1n })).toBe(7n);
  });

  it('the constant Mod(2^60 + 1, 10) is the literal 7n', () => {
    const r = compiled(['Mod', ['Add', ['Power', 2, 60], 1], 10]);
    expect(r.code).toBe('7n');
    expect(r.run!({})).toBe(7n);
  });

  it.each([
    ['Abs(n!)', ['Abs', ['Factorial', 'n']]],
    ['Sum(i², i = 1..n)', ['Sum', ['Power', 'i', 2], ['Limits', 'i', 1, 'n']]],
    ['Product(i, i = 1..n)', ['Product', 'i', ['Limits', 'i', 1, 'n']]],
  ] as const)('%s', (_, json) => {
    for (const n of [0n, 1n, 25n]) agrees(json as Json, { n });
  });

  it.each([
    ['Mod(n, 7)', ['Mod', 'n', 7]],
    ['GCD(n, m)', ['GCD', 'n', 'm']],
    ['LCM(n, m)', ['LCM', 'n', 'm']],
    ['−n', ['Negate', 'n']],
    ['Floor(n/3)', ['Floor', ['Divide', 'n', 3]]],
    ['Max(n, m, 3)', ['Max', 'n', 'm', 3]],
    ['Min(n, m)', ['Min', 'n', 'm']],
    ['Sign(n − m)', ['Sign', ['Subtract', 'n', 'm']]],
    ['Remainder(n, m)', ['Remainder', 'n', 'm']],
  ] as const)('%s', (_, json) => {
    for (const [n, m] of [
      [25n, 15n],
      [-7n, 3n],
      [7n, -3n],
      [5n, 2n],
      [1n, -2n],
      [-5n, -2n],
      [TWO_53 + 3n, 6n],
    ])
      agrees(json as Json, { n, m });
  });

  it('n! is exact at n = 30', () => {
    expect(agrees(['Factorial', 'n'], { n: 30n })).toBe(
      265252859812191058636308480000000n
    );
  });

  it('n^k0 with an exponent typed integer<0..>', () => {
    agrees(['Power', 'n', 'k0'], { n: -3n, k0: 41n });
  });

  it('(−1)^k by the parity of k, also for a negative k', () => {
    for (const n of [-3n, -2n, 0n, 7n])
      expect(run(['Power', -1, 'n'], { n })).toBe(n % 2n === 0n ? 1n : -1n);
  });
});

describe('the parent-lowered shapes of §3.2', () => {
  it('Floor(n/2) + Ceil(n/2) at an odd n is n', () => {
    const json: Json = [
      'Add',
      ['Floor', ['Divide', 'n', 2]],
      ['Ceil', ['Divide', 'n', 2]],
    ];
    expect(agrees(json, { n: 7n })).toBe(7n);
    expect(agrees(json, { n: -7n })).toBe(-7n);
  });

  it.each(['Floor', 'Ceil', 'Round', 'Truncate'])(
    '%s of n(n+1)/2 and of n/m',
    (head) => {
      agrees([head, ['Divide', ['Multiply', 'n', ['Add', 'n', 1]], 2]], {
        n: 5n,
      });
      for (const [n, m] of [
        [7n, 2n],
        [-7n, 2n],
        [5n, -2n],
        [-5n, 2n],
        [TWO_53 + 1n, 2n],
      ])
        agrees([head, ['Divide', 'n', 'm']], { n, m });
    }
  );

  it('Floor(2^(−n)) at n = 3 is 0, and Ceil is 1', () => {
    expect(agrees(['Floor', ['Power', 2, ['Negate', 'n']]], { n: 3n })).toBe(
      0n
    );
    expect(agrees(['Ceil', ['Power', 2, ['Negate', 'n']]], { n: 3n })).toBe(1n);
    // With a negative n the power is an integer.
    expect(agrees(['Floor', ['Power', 2, ['Negate', 'n']]], { n: -5n })).toBe(
      32n
    );
  });

  it.each(['Floor', 'Ceil', 'Round', 'Truncate'])(
    '%s(Sqrt(n)) at squares, at 17, at 20 and past 2^53',
    (head) => {
      for (const n of [
        0n,
        1n,
        16n,
        17n,
        20n,
        24n,
        25n,
        TWO_53 * TWO_53,
        TWO_53 * TWO_53 + 1n,
        (TWO_53 + 7n) ** 2n - 1n,
      ])
        agrees([head, ['Sqrt', 'n']], { n });
    }
  );

  it('Sqrt of a negative operand is a pole carrying NaN', () => {
    noValue(() => run(['Floor', ['Sqrt', 'n']], { n: -4n }), NaN);
  });

  it('a quotient under Typed is a checked exact division', () => {
    const json: Json = ['Typed', ['Divide', 'n', 2], "'integer'"];
    expect(run(json, { n: 8n })).toBe(4n);
    expect(() => run(json, { n: 7n })).toThrow(RangeError);
  });

  it('an argument at an integer parameter is under an integer promise', () => {
    // `Fibonacci` is `(integer) -> integer`.
    const json: Json = ['Fibonacci', ['Divide', 'n', 2]];
    expect(run(json, { n: 20n })).toBe(55n);
    expect(() => run(json, { n: 21n })).toThrow(RangeError);
  });
});

describe('comparisons (§3.3)', () => {
  it('n > 1/2', () => {
    for (const n of [-1n, 0n, 1n, 2n])
      agrees(['Greater', 'n', ['Rational', 1, 2]], { n });
  });

  it('n ≥ (3·2^53 + 1)/2 at n = 3·2^52 is false, as in the interpreter', () => {
    const json: Json = [
      'GreaterEqual',
      'n',
      ['Divide', ['Add', ['Multiply', 3, ['Power', 2, 53]], 1], 2],
    ];
    expect(agrees(json, { n: 3n * 2n ** 52n })).toBe(false);
    expect(agrees(json, { n: 3n * 2n ** 52n + 1n })).toBe(true);
  });

  it('Equal(n, (2^53 + 1)/2^53) at n = 1 is false', () => {
    const json: Json = [
      'Equal',
      'n',
      ['Divide', ['Add', ['Power', 2, 53], 1], ['Power', 2, 53]],
    ];
    expect(agrees(json, { n: 1n })).toBe(false);
    expect(run(['NotEqual', 'n', ['Rational', 1, 3]], { n: 1n })).toBe(true);
  });

  it.each(['Less', 'Greater', 'LessEqual', 'GreaterEqual', 'Equal', 'NotEqual'])(
    '%s of two lane values',
    (head) => {
      for (const [n, m] of [
        [1n, 2n],
        [2n, 2n],
        [TWO_53 + 1n, TWO_53],
      ])
        agrees([head, 'n', 'm'], { n, m });
    }
  );

  it('IsPrime(n) at 17, at 2^61 − 1 and at 2^61 + 1', () => {
    expect(agrees(['IsPrime', 'n'], { n: 17n })).toBe(true);
    expect(agrees(['IsPrime', 'n'], { n: 2n ** 61n - 1n })).toBe(true);
    expect(agrees(['IsPrime', 'n'], { n: 2n ** 61n + 1n })).toBe(false);
  });

  it('And, Or, Not and Boole', () => {
    const json: Json = [
      'Add',
      ['Boole', ['And', ['Less', 'n', 'm'], ['Not', ['Equal', 'n', 0]]]],
      ['Boole', ['Or', ['Greater', 'n', 'm'], ['Equal', 'm', 0]]],
    ];
    for (const [n, m] of [
      [1n, 2n],
      [0n, 2n],
      [3n, 0n],
    ])
      agrees(json, { n, m });
  });
});

describe('conditionals', () => {
  it('If(n < 0, 0, n!) at n = −1 is 0n', () => {
    expect(
      agrees(['If', ['Less', 'n', 0], 0, ['Factorial', 'n']], { n: -1n })
    ).toBe(0n);
  });

  it('Which with a final True clause', () => {
    const json: Json = [
      'Which',
      ['Less', 'n', 0],
      -1,
      ['Equal', 'n', 0],
      0,
      'True',
      ['Multiply', 2, 'n'],
    ];
    for (const n of [-4n, 0n, 9n]) agrees(json, { n });
  });
});

describe('collections (§3.1.1 (b) and (c))', () => {
  const L = [3n, 1n, 4n, 1n, 5n, 9n, 2n, 6n];

  it('At(L, n) in range, from the start and from the end', () => {
    for (const n of [1n, 3n, 8n, -1n, -8n])
      agrees(['At', 'L', 'n'], { L, n });
  });

  it('At(L, n) out of range is a pole carrying NaN', () => {
    for (const n of [0n, 9n, -9n])
      noValue(() => run(['At', 'L', 'n'], { L, n }), NaN);
    noValue(() => run(['First', 'L'], { L: [] }), NaN);
  });

  it('First and Last', () => {
    agrees(['First', 'L'], { L });
    agrees(['Last', 'L'], { L });
  });

  it('Take(L, 0) is empty, and an oversized count is clipped', () => {
    for (const n of [0n, 2n, -2n, 20n, -20n]) {
      agrees(['Take', 'L', 'n'], { L, n });
      agrees(['Drop', 'L', 'n'], { L, n });
    }
    expect(run(['Take', 'L', 'n'], { L, n: 0n })).toEqual([]);
  });

  it('Length(L) + n and Count(L)', () => {
    expect(agrees(['Add', ['Length', 'L'], 'n'], { L, n: TWO_53 })).toBe(
      TWO_53 + 8n
    );
    agrees(['Count', 'L'], { L });
  });

  it('ReplaceAt(L, n, m)', () => {
    agrees(['ReplaceAt', 'L', 'n', 'm'], { L, n: 2n, m: TWO_53 + 1n });
    agrees(['ReplaceAt', 'L', 'n', 'm'], { L, n: -1n, m: 0n });
    expect(() => run(['ReplaceAt', 'L', 'n', 'm'], { L, n: 0n, m: 1n })).toThrow(
      RangeError
    );
  });

  it('Range: ascending, descending, with a step, and empty', () => {
    for (const [n, m] of [
      [1n, 5n],
      [5n, 1n],
      [3n, 3n],
    ])
      agrees(['Range', 'n', 'm'], { n, m });
    agrees(['Range', 'n'], { n: 4n });
    agrees(['Range', 'n', 'm', 3], { n: 1n, m: 10n });
    agrees(['Range', 'n', 'm', 1], { n: 3n, m: 1n });
  });

  it('a list of lane values, and Map over a range', () => {
    agrees(['List', 'n', ['Factorial', 'n'], ['Negate', 'n']], { n: 21n });
    agrees(['Map', ['Function', ['Factorial', 'k'], 'k'], ['Range', 1, 'n']], {
      n: 22n,
    });
    agrees(['Map', ['Function', ['Multiply', 'k', 'n'], 'k'], 'L'], {
      L,
      n: TWO_53,
    });
  });

  it('Fold and Reduce give the accumulator first, then the element', () => {
    const fn: Json = [
      'Function',
      ['Subtract', ['Multiply', 2, 'a'], 'b'],
      'a',
      'b',
    ];
    agrees(['Fold', fn, 1, 'L'], { L });
    agrees(['Reduce', 'L', fn, 'n'], { L, n: TWO_53 });
  });
});

describe('common subexpressions (§3.7)', () => {
  // `Binomial(2n + m, n + m)`: large enough for the CSE thresholds.
  const B: Json = [
    'Binomial',
    ['Add', ['Multiply', 2, 'n'], 'm'],
    ['Add', 'n', 'm'],
  ];
  const hoisted = (code: string) => code.match(/const _cse\d+ =/g) ?? [];

  it('a repeated lane subexpression is one hoisted temporary', () => {
    const json: Json = ['Add', B, ['Multiply', B, 'n']];
    expect(hoisted(compiled(json).code!)).toHaveLength(1);
    agrees(json, { n: 5n, m: 1n });
    agrees(json, { n: 40n, m: 3n });
  });

  it('a parent-lowered quotient is not shared: Floor(x/2) + Ceil(x/2)', () => {
    agrees(['Add', ['Floor', ['Divide', 'n', 2]], ['Ceil', ['Divide', 'n', 2]]], {
      n: 7n,
    });
    const x: Json = ['Add', B, 'n'];
    const json: Json = [
      'Add',
      ['Floor', ['Divide', x, 2]],
      ['Ceil', ['Divide', x, 2]],
    ];
    agrees(json, { n: 5n, m: 2n });
    agrees(json, { n: 6n, m: 2n });
  });

  it('a temporary can call a user function', () => {
    const q: Json = ['quo', ['Add', ['Factorial', 'n'], ['Factorial', 'm']], 'm'];
    const json: Json = ['Add', q, ['Multiply', q, 'n']];
    expect(hoisted(compiled(json).code!)).toHaveLength(1);
    agrees(json, { n: 5n, m: 1n });
  });

  it('a subexpression in a branch is not evaluated when the branch is not', () => {
    const q: Json = ['quo', ['Add', ['Factorial', 'n'], ['Factorial', 'm']], 'm'];
    const json: Json = [
      'If',
      ['NotEqual', 'm', 0],
      ['Add', q, ['Multiply', q, 'n']],
      0,
    ];
    agrees(json, { n: 5n, m: 0n });
    agrees(json, { n: 5n, m: 1n });
  });

  it('a loop body that reads its index is not shared with the root', () => {
    agrees(
      [
        'Add',
        [
          'Sum',
          ['Binomial', ['Add', ['Multiply', 2, 'n'], 'm'], ['Add', 'n', 'm']],
          ['Limits', 'm', 1, 3],
        ],
        B,
      ],
      { n: 2n, m: 7n }
    );
  });
});

describe('loops (§3.7)', () => {
  it('a Sum to n = 10^6 counts with a bigint counter', () => {
    const r = compiled(['Sum', ['Mod', 'k', 7], ['Limits', 'k', 1, 'n']]);
    expect(r.code).toMatch(/0n/);
    // 10^6 = 7·142857 + 1: each full period adds 0 + 1 + … + 6 = 21.
    expect(r.run!({ n: 10n ** 6n } as never)).toBe(142857n * 21n + 1n);
  });

  it('Sum(k!, k = 0..n)', () => {
    agrees(['Sum', ['Factorial', 'k'], ['Limits', 'k', 0, 'n']], { n: 25n });
  });

  it('Sum(Floor(n/k), k = 1..n)', () => {
    agrees(
      ['Sum', ['Floor', ['Divide', 'n', 'k']], ['Limits', 'k', 1, 'n']],
      { n: 30n }
    );
  });

  it('the derangement sum with (n − k)!', () => {
    const json: Json = [
      'Sum',
      [
        'Multiply',
        ['Power', -1, 'k'],
        ['Binomial', 'n', 'k'],
        ['Factorial', ['Subtract', 'n', 'k']],
      ],
      ['Limits', 'k', 0, 'n'],
    ];
    expect(agrees(json, { n: 10n })).toBe(1334961n);
    agrees(json, { n: 25n });
  });

  it('a Sum whose upper limit is below its lower limit is 0', () => {
    agrees(['Sum', 'k', ['Limits', 'k', 5, 'n']], { n: 1n });
    agrees(['Product', 'k', ['Limits', 'k', 5, 'n']], { n: 1n });
  });

  it('a nested Sum whose inner limit is the outer index', () => {
    agrees(
      [
        'Sum',
        ['Multiply', 'p', 'j'],
        ['Limits', 'p', 1, 'n'],
        ['Limits', 'j', 1, 'p'],
      ],
      { n: 12n }
    );
  });
});

describe('user functions (§3.1.2)', () => {
  it('f(n) + 1 with f := x ↦ x!', () => {
    agrees(['Add', ['f', 'n'], 1], { n: 22n });
  });

  it('a body declared -> integer is a checked exact division', () => {
    agrees(['half', 'n'], { n: TWO_53 + 1n });
    expect(run(['quo', 'n', 'm'], { n: 8n, m: 2n })).toBe(4n);
    expect(() => run(['quo', 'n', 'm'], { n: 7n, m: 2n })).toThrow(RangeError);
    noValue(() => run(['quo', 'n', 'm'], { n: 7n, m: 0n }), Infinity);
  });

  it('a recursive function', () => {
    expect(agrees(['fact', 'n'], { n: 25n })).toBe(
      15511210043330985984000000n
    );
  });

  // A single-statement `Block` has a copy of the lane record of its
  // operand. The emitter must write the `Block` as its operand, not as a
  // second call of the function that its operand calls.
  describe('a Block around a call of a user function', () => {
    ce.box(['Assign', 'inc', ['Function', ['Add', 'x', 1], 'x']]).evaluate();
    ce.box(['Assign', 'h', ['Function', ['inc', 'x'], 'x']]).evaluate();

    it('h(x) := inc(x), whose body is a Block', () => {
      expect(agrees(['h', 'n'], { n: 5n })).toBe(6n);
    });

    it('Block(inc(n))', () => {
      expect(agrees(['Block', ['inc', 'n']], { n: 5n })).toBe(6n);
    });

    it('Map(x ↦ Block(inc(x)), Range(1, n))', () => {
      expect(
        agrees(
          ['Map', ['Function', ['Block', ['inc', 'x']], 'x'], ['Range', 1, 'n']],
          { n: 3n }
        )
      ).toEqual([2n, 3n, 4n]);
    });

    it('Sum(Block(inc(k)), k = 1..n)', () => {
      expect(
        agrees(['Sum', ['Block', ['inc', 'k']], ['Limits', 'k', 1, 'n']], {
          n: 3n,
        })
      ).toBe(9n);
    });
  });

  it('a Function literal at the root takes bigint arguments', () => {
    const r = compile(
      ce.box(['Function', ['Factorial', 'k'], ['Typed', 'k', "'integer'"]]),
      { mode: 'bigint', fallback: false }
    );
    expect(r.success).toBe(true);
    expect((r.run as unknown as (k: bigint) => bigint)(25n)).toBe(
      15511210043330985984000000n
    );
  });
});

describe('constants', () => {
  it('1^(10^7) is 1n', () => {
    expect(agrees(['Power', 1, ['Power', 10, 7]])).toBe(1n);
  });

  it('an integer literal and a constant list', () => {
    expect(run(5)).toBe(5n);
    expect(run(['Add', 'n', ['Power', 2, 70]], { n: 1n })).toBe(2n ** 70n + 1n);
  });

  it('a constant whose value the interpreter leaves unevaluated declines', () => {
    const r = compile(ce.box(['Fibonacci', ['Power', 10, 9]]), {
      mode: 'bigint',
    });
    expect(r.success).toBe(false);
    expect(r.diagnostic!.code).toBe('bigint-lane');
  });
});

describe('constant folding (§3.7)', () => {
  const declines = (json: Json) => {
    const r = compile(ce.box(json), { mode: 'bigint' });
    expect(r.success).toBe(false);
    expect(r.diagnostic!.code).toBe('bigint-lane');
  };

  it.each([
    ['2^60 + 1', ['Add', ['Power', 2, 60], 1], 2n ** 60n + 1n],
    ['Fibonacci(100)', ['Fibonacci', 100], 354224848179261915075n],
    ['Fibonacci(80)', ['Fibonacci', 80], 23416728348467685n],
    ['30!', ['Factorial', 30], 265252859812191058636308480000000n],
  ] as const)('%s past 2^53 is the exact bigint literal', (_, json, value) => {
    expect(compiled(json as Json).code).toBe(`${value}n`);
    expect(agrees(json as Json)).toBe(value);
  });

  it('n + 2^60 at n = 1', () => {
    expect(compiled(['Add', 'n', ['Power', 2, 60]]).code).toContain(
      `${2n ** 60n}n`
    );
    expect(agrees(['Add', 'n', ['Power', 2, 60]], { n: 1n })).toBe(
      2n ** 60n + 1n
    );
  });

  it('a folded boolean: IsPrime(17)', () => {
    expect(compiled(['IsPrime', 17]).code).toBe('true');
    expect(agrees(['IsPrime', 17])).toBe(true);
  });

  it.each([
    ['Floor(7/2)', ['Floor', ['Divide', 7, 2]], 3n],
    ['Floor(10^20/3)', ['Floor', ['Divide', ['Power', 10, 20], 3]], 33333333333333333333n],
    ['Ceil(10^20/3)', ['Ceil', ['Divide', ['Power', 10, 20], 3]], 33333333333333333334n],
  ] as const)('a folded constant under a rounding parent: %s', (_, json, value) => {
    expect(compiled(json as Json).code).toBe(`${value}n`);
    expect(agrees(json as Json)).toBe(value);
    expect(agrees(['Add', 'n', json as Json], { n: 1n })).toBe(value + 1n);
  });

  it('a rational constant in a comparison is compared exactly: n > 7/2', () => {
    const json: Json = ['Greater', 'n', ['Divide', 7, 2]];
    expect(compiled(json).code).toContain('7n < 2n * ');
    expect(agrees(json, { n: 3n })).toBe(false);
    expect(agrees(json, { n: 4n })).toBe(true);
  });

  it('a symbol with a rational value in a comparison: n > h, h := 7/2', () => {
    ce.assign('hRational', ce.box(['Rational', 7, 2]));
    const json: Json = ['Greater', 'n', 'hRational'];
    expect(agrees(json, { n: 3n })).toBe(false);
    expect(agrees(json, { n: 4n })).toBe(true);
  });

  it('a repeated folded literal is hoisted by CSE as a bigint', () => {
    const P: Json = ['Binomial', ['Fibonacci', 80], 3];
    const json: Json = [
      'Add',
      ['Multiply', 'n', P],
      ['Multiply', ['Add', 'n', 1], P],
      ['Mod', P, 'n'],
    ];
    const code = compiled(json).code!;
    const value = interpreted(P) as bigint;
    expect(code).toMatch(new RegExp(`const _cse\\d+ = ${value}n;`));
    expect(code.split(`${value}n`)).toHaveLength(2);
    agrees(json, { n: 2n });
    agrees(json, { n: 7n });
  });

  it('a folded value that is not an integer outside an integer-forcing parent declines: n + 1/2', () => {
    declines(['Add', 'n', ['Rational', 1, 2]]);
    declines(['Add', 'n', ['Divide', 1, 2]]);
  });

  it('a folded value that the interpreter leaves unevaluated declines', () => {
    declines(['Fibonacci', ['Power', 10, 9]]);
    // Past the size limit of §3.9 (1,000,000 decimal digits).
    declines(['Add', 'n', ['Power', 2, ['Power', 10, 7]]]);
  });

  describe('a constant whose value is a pole (§3.4)', () => {
    it.each([
      ['(−1)!', ['Factorial', -1], Infinity],
      ['Mod(5, 0)', ['Mod', 5, 0], NaN],
      ['Remainder(5, 0)', ['Remainder', 5, 0], NaN],
    ] as const)('%s is the number of its pole', (_, json, value) => {
      noValue(() => run(json as Json), value);
      noValue(() => run(['Add', 'n', json as Json], { n: 1n }), value);
    });

    it('the pole is thrown only when its branch runs', () => {
      const json: Json = ['If', ['Greater', 'n', 0], 'n', ['Factorial', -1]];
      expect(agrees(json, { n: 3n })).toBe(3n);
      noValue(() => run(json, { n: -2n }), Infinity);
      const mod: Json = ['If', ['Greater', 'n', 0], 'n', ['Mod', 5, 0]];
      expect(agrees(mod, { n: 3n })).toBe(3n);
      noValue(() => run(mod, { n: -1n }), NaN);
    });

    // The canonical form of `0^(−1)` and `1/0` is `~oo`, and of `0^0` it
    // is `NaN`: a non-finite literal is a pole, as is a
    // `Divide` whose divisor has the value zero.
    it.each([
      ['0^(−1)', ['Power', 0, -1], Infinity],
      ['0^0', ['Power', 0, 0], NaN],
      ['1/Fibonacci(0)', ['Divide', 1, ['Fibonacci', 0]], Infinity],
      ['ComplexInfinity', 'ComplexInfinity', Infinity],
      ['Floor(1/0)', ['Floor', ['Divide', 1, 0]], Infinity],
    ] as const)('n + %s is the number of its pole', (_, json, value) => {
      noValue(() => run(['Add', 'n', json as Json], { n: 1n }), value);
    });

    it('a symbol whose value is not finite is a pole', () => {
      ce.assign('cPole', ce.box(['Divide', 1, 0]));
      noValue(() => run(['Add', 'n', 'cPole'], { n: 1n }), Infinity);
    });

    it('a non-finite literal is thrown only when its branch runs', () => {
      const json: Json = ['If', ['Greater', 'n', 0], 'n', ['Power', 0, -1]];
      expect(agrees(json, { n: 3n })).toBe(3n);
      noValue(() => run(json, { n: -2n }), Infinity);
    });

    it('a repeated pole is not hoisted by CSE', () => {
      const P: Json = ['Divide', 1, ['Fibonacci', 0]];
      const json: Json = [
        'If',
        ['Greater', 'n', 0],
        'n',
        ['Add', ['Multiply', P, 'n'], ['Multiply', P, ['Add', 'n', 2]]],
      ];
      const code = compiled(json).code!;
      expect(code).not.toMatch(/const _cse\d+ =/);
      expect(code.split('NonFiniteValue(Infinity)')).toHaveLength(3);
      expect(agrees(json, { n: 3n })).toBe(3n);
      noValue(() => run(json, { n: -2n }), Infinity);
      // At the root, outside a branch.
      const root: Json = [
        'Add',
        ['Multiply', ['Factorial', -1], 'n'],
        ['Multiply', ['Factorial', -1], ['Add', 'n', 1]],
      ];
      expect(compiled(root).code!).not.toMatch(/const _cse\d+ =/);
      noValue(() => run(root, { n: 1n }), Infinity);
    });

    it('a pole in a comparison is the number of the pole', () => {
      noValue(() => run(['Greater', 'n', ['Factorial', -1]], { n: 2n }), Infinity);
      noValue(() => run(['Less', 'n', ['Divide', 1, 0]], { n: 2n }), Infinity);
      noValue(() => run(['Equal', 'n', ['Power', 0, 0]], { n: 2n }), NaN);
    });

    it('a constant with a pole of a head that is not on the lane declines', () => {
      declines(['Add', 'n', ['Ln', 0]]);
      declines(['Add', 'n', ['Factorial', ['Ln', 0]]]);
      // The operand of `Factorial2` must be typed `integer<0..>`, as for
      // an input.
      declines(['Add', 'n', ['Factorial2', -2]]);
    });
  });
});

describe('poles (§3.4): the number result', () => {
  it.each([
    ['n! at n = −1', ['Factorial', 'n'], { n: -1n }, Infinity],
    ['−|n!| at n = −1', ['Negate', ['Abs', ['Factorial', 'n']]], { n: -1n }, Infinity],
    ['n! > 5 at n = −1', ['Greater', ['Factorial', 'n'], 5], { n: -1n }, Infinity],
    ['Mod(n, m) at m = 0', ['Mod', 'n', 'm'], { n: 5n, m: 0n }, NaN],
    ['Floor(n/m) at 0/0', ['Floor', ['Divide', 'n', 'm']], { n: 0n, m: 0n }, NaN],
    ['n^k0 at 0^0', ['Power', 'n', 'k0'], { n: 0n, k0: 0n }, NaN],
    [
      'Map(Range(−1, n), k ↦ k!)',
      ['Map', ['Function', ['Factorial', 'k'], 'k'], ['Range', -1, 'n']],
      { n: 3n },
      Infinity,
    ],
  ] as const)('%s', (_, json, inputs, value) => {
    noValue(() => run(json as Json, inputs as Inputs), value);
  });
});

// The time bounds of the size limit are hang guards: far above the time of
// the work and above a stall of a worker in a full run on a loaded machine,
// and far below the computation of a result of millions of digits, which
// takes minutes.
const HANG_GUARD_MS = 30_000;

describe('the size limit (§3.9)', () => {
  it.each([
    ['Fibonacci(n) at 10^9', ['Fibonacci', 'n'], { n: 10n ** 9n }],
    ['n! at 10^7', ['Factorial', 'n'], { n: 10n ** 7n }],
    ['Factorial2(k0) at 10^7', ['Factorial2', 'k0'], { k0: 10n ** 7n }],
    ['Binomial(n, m) at 10^9, 5·10^8', ['Binomial', 'n', 'm'], { n: 10n ** 9n, m: 5n * 10n ** 8n }],
    ['n^k0 at 2, 10^7', ['Power', 'n', 'k0'], { n: 2n, k0: 10n ** 7n }],
    ['Floor(2^(−n)) at −10^7', ['Floor', ['Power', 2, ['Negate', 'n']]], { n: -(10n ** 7n) }],
  ] as const)('%s throws a RangeError at once', (_, json, inputs) => {
    const start = Date.now();
    expect(() => run(json as Json, inputs as Inputs)).toThrow(RangeError);
    expect(Date.now() - start).toBeLessThan(HANG_GUARD_MS);
  });
});

describe('the double mode is not changed', () => {
  it('the same expression in strict mode computes with doubles', () => {
    const r = compile(ce.box(['Add', ['Floor', ['Divide', 'n', 2]], 1]), {
      mode: 'strict',
    });
    expect(r.code).not.toMatch(/\dn\b|_SYS\.b/);
    expect(r.run!({ n: 7 })).toBe(4);
  });
});

describe('the runtime helpers (§3.6)', () => {
  it('are on the _SYS object of the JavaScript runtime', () => {
    for (const [name, helper] of Object.entries(B))
      expect((SYS_HELPERS as Record<string, unknown>)[name]).toBe(helper);
  });

  it('the divisions', () => {
    pole(() => B.bfloorDiv(5n, 0n), Infinity);
    pole(() => B.bfloorDiv(0n, 0n), NaN);
    expect(B.bfloorDiv(-7n, 2n)).toBe(-4n);
    expect(B.bceilDiv(-7n, 2n)).toBe(-3n);
    pole(() => B.bceilDiv(-7n, 0n), Infinity);
    expect([B.broundDiv(5n, 2n), B.broundDiv(-5n, 2n), B.broundDiv(7n, 2n)]).toEqual([
      3n,
      -3n,
      4n,
    ]);
    pole(() => B.broundDiv(0n, 0n), NaN);
    expect(B.btruncDiv(-7n, 2n)).toBe(-3n);
    pole(() => B.btruncDiv(1n, 0n), Infinity);
    expect(B.bexactDiv(-8n, 2n)).toBe(-4n);
    expect(() => B.bexactDiv(7n, 2n)).toThrow(RangeError);
    pole(() => B.bexactDiv(7n, 0n), Infinity);
  });

  it('bfloorMod and bremainder', () => {
    pole(() => B.bfloorMod(5n, 0n), NaN);
    expect(B.bfloorMod(-7n, 3n)).toBe(2n);
    expect(B.bfloorMod(7n, -3n)).toBe(-2n);
    pole(() => B.bremainder(5n, 0n), NaN);
    expect(B.bremainder(-7n, 3n)).toBe(-1n);
    expect(B.bremainder(7n, -3n)).toBe(1n);
    // The quotient is rounded to the nearest integer, a tie toward +∞, as
    // the interpreter rounds it: not the sign of the dividend.
    expect(B.bremainder(25n, 15n)).toBe(-5n);
    expect(B.bremainder(5n, 2n)).toBe(-1n);
    expect(B.bremainder(1n, -2n)).toBe(1n);
  });

  it('bpow and bpowRational', () => {
    pole(() => B.bpow(0n, 0n), NaN);
    expect(B.bpow(-2n, 3n)).toBe(-8n);
    expect(B.bpow(1n, 10n ** 7n)).toBe(1n);
    expect(B.bpow(-1n, 10n ** 7n + 1n)).toBe(-1n);
    expect(B.bpow(0n, 10n ** 9n)).toBe(0n);
    expect(() => B.bpow(2n, 10n ** 7n)).toThrow(RangeError);
  });

  it('bpowRational under a rounding parent', () => {
    pole(() => B.bfloorDiv(...B.bpowRational(0n, -2n)), Infinity);
    expect(B.bfloorDiv(...B.bpowRational(2n, -3n))).toBe(0n);
    expect(B.bceilDiv(...B.bpowRational(2n, -3n))).toBe(1n);
    expect(B.bfloorDiv(...B.bpowRational(-2n, -3n))).toBe(-1n);
    expect(B.bfloorDiv(...B.bpowRational(3n, 4n))).toBe(81n);
  });

  it('bgcd and blcm', () => {
    expect([B.bgcd(0n, 0n), B.bgcd(0n, 5n), B.bgcd(-4n, 6n)]).toEqual([0n, 5n, 2n]);
    expect(B.blcm(0n, 5n)).toBe(0n);
    expect(B.blcm(-4n, 6n)).toBe(12n);
    expect(B.blcm(4n, 6n, 10n)).toBe(60n);
  });

  it('bfactorial and bfactorial2', () => {
    pole(() => B.bfactorial(-1n), Infinity);
    expect(B.bfactorial(0n)).toBe(1n);
    expect(B.bfactorial(20n)).toBe(2432902008176640000n);
    expect(B.bfactorial2(0n)).toBe(1n);
    expect(B.bfactorial2(7n)).toBe(105n);
    expect(B.bfactorial2(8n)).toBe(384n);
  });

  it('bbinomial', () => {
    expect([
      B.bbinomial(-1n, 2n),
      B.bbinomial(5n, -1n),
      B.bbinomial(5n, 7n),
      B.bbinomial(-3n, -5n),
      B.bbinomial(-2n, 3n),
      B.bbinomial(10n, 3n),
    ]).toEqual([1n, 0n, 0n, 6n, -4n, 120n]);
  });

  it('bfibonacci', () => {
    expect([B.bfibonacci(-3n), B.bfibonacci(-4n), B.bfibonacci(0n), B.bfibonacci(1n), B.bfibonacci(90n)]).toEqual([
      2n,
      -3n,
      0n,
      1n,
      2880067194370816120n,
    ]);
    expect(() => B.bfibonacci(10n ** 9n)).toThrow(RangeError);
  });

  it('bisqrt and the rounded square roots', () => {
    expect(B.bisqrt(17n)).toBe(4n);
    pole(() => B.bisqrt(-4n), NaN);
    expect([B.bceilSqrt(17n), B.bceilSqrt(16n)]).toEqual([5n, 4n]);
    expect([B.broundSqrt(17n), B.broundSqrt(20n), B.broundSqrt(16n), B.broundSqrt(21n)]).toEqual([
      4n,
      4n,
      4n,
      5n,
    ]);
    for (let t = 0n; t < 200n; t++) {
      const k = B.bisqrt(t);
      expect(k * k <= t && (k + 1n) * (k + 1n) > t).toBe(true);
    }
  });

  it('bsign, babs, bmin, bmax', () => {
    expect([B.bsign(-5n), B.bsign(0n), B.bsign(3n)]).toEqual([-1n, 0n, 1n]);
    expect(B.babs(-5n)).toBe(5n);
    expect(B.bmin(3n, -1n, 2n)).toBe(-1n);
    expect(B.bmax(3n, -1n, 2n)).toBe(3n);
  });

  it('bindex and bcount', () => {
    for (const [i, len] of [
      [0n, 3],
      [4n, 3],
      [-4n, 3],
      [1n, 0],
    ] as const)
      pole(() => B.bindex(i, len), NaN);
    expect([B.bindex(1n, 3), B.bindex(3n, 3), B.bindex(-1n, 3), B.bindex(-3n, 3)]).toEqual([
      0, 2, 2, 0,
    ]);
    expect([B.bcount(0n, 4), B.bcount(9n, 4), B.bcount(-9n, 4), B.bcount(-2n, 4)]).toEqual([
      0, 4, -4, -2,
    ]);
  });

  it('brange and brangeCount', () => {
    expect(B.brange(1n, 4n)).toEqual([1n, 2n, 3n, 4n]);
    expect(B.brange(4n, 1n)).toEqual([4n, 3n, 2n, 1n]);
    expect(B.brange(1n, 10n, 4n)).toEqual([1n, 5n, 9n]);
    expect(B.brange(3n, 1n, 1n)).toEqual([]);
    expect(B.brangeCount(0n, 10n, 0n)).toBe(0n);
    expect(B.brangeCount(1n, 10n ** 20n, 1n)).toBe(10n ** 20n);
    expect(() => B.brange(1n, 2n ** 40n)).toThrow(RangeError);
  });

  it('isIntegerValue', () => {
    expect([B.isIntegerValue(5n), B.isIntegerValue(5), B.isIntegerValue(5.5), B.isIntegerValue('5')]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('the size estimates of Power and Binomial (§3.9)', () => {
  // The interpreter leaves `a^e` unevaluated when the count of decimal
  // digits of `|a|` times `e` is more than 1,000,000. The helper must throw
  // in each of these cases, also when the true result is smaller.
  it('n^k0 at 2, 10^6 computes and equals evaluate()', () => {
    const v = agrees(['Power', 'n', 'k0'], { n: 2n, k0: 10n ** 6n });
    expect(String(v).length).toBe(301030);
  });

  // The count of digits of the base is exact: `999999999999999` has 15
  // digits, so its power to 66,666 (999,990 digits) computes in both, and
  // its power to 66,667 (1,000,005 digits) computes in neither.
  it('n^k0 at 999999999999999, 66666 computes and equals evaluate()', () => {
    const v = agrees(['Power', 'n', 'k0'], {
      n: 999_999_999_999_999n,
      k0: 66_666n,
    });
    expect(String(v).length).toBe(999_990);
  });

  it.each([
    [9n, 1_000_001n],
    [2n, 1_000_001n],
    [2n, 3_000_000n],
    [999_999_999_999_999n, 66_667n],
  ])('n^k0 at %s, %s throws a RangeError, and evaluate() stays unevaluated', (n, k0) => {
    expect(() => run(['Power', 'n', 'k0'], { n, k0 })).toThrow(RangeError);
    const r = ce.box(['Power', 'n', 'k0']).subs({ n: ce.number(n), k0: ce.number(k0) }).evaluate();
    expect(r.operator).toBe('Power');
  });

  // The helper and the interpreter use the same estimate
  // (`estimatedBinomialDigits` in `numerics/special-functions.ts`). For
  // `n > 2^53` the estimate has no subtraction of nearly equal values, so
  // a large result is found before the multiplication loop starts.
  it('Binomial(n, m) at 10^100, 10^10 throws a RangeError at once', () => {
    const start = Date.now();
    expect(() => run(['Binomial', 'n', 'm'], { n: 10n ** 100n, m: 10n ** 10n })).toThrow(RangeError);
    expect(Date.now() - start).toBeLessThan(HANG_GUARD_MS);
  });

  // `Binomial(10^300, 3369)` has about 1,000,277 digits.
  it('Binomial(n, m) at 10^300, 3369 throws a RangeError, and evaluate() stays unevaluated', () => {
    const n = 10n ** 300n;
    expect(() => run(['Binomial', 'n', 'm'], { n, m: 3369n })).toThrow(RangeError);
    const r = ce.box(['Binomial', 'n', 'm']).subs({ n: ce.number(n), m: ce.number(3369) }).evaluate();
    expect(r.operator).toBe('Binomial');
  });

  it.each([
    [20_000n, 10_000n],
    [10n ** 20n, 1_000n],
    // `n` is beyond the double range; the result has about 800 digits.
    [10n ** 400n, 2n],
  ])('Binomial(n, m) at %s, %s computes and equals evaluate()', (n, m) => {
    agrees(['Binomial', 'n', 'm'], { n, m });
  });
});
