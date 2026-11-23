/**
 * The profile `ir` in `mode: 'bigint'` (`compilation/ir/README.md`, "The
 * `bigint` mode"): every integer is a JavaScript `bigint`, so the compiled
 * value is the interpreter's exactly, also far beyond 2^53.
 *
 * - Programs compared exactly with the interpreter.
 * - A seeded random differential test over a small integer grammar.
 * - The ABI: inputs, results, the pole.
 * - Stored code: a JSON round trip and `load()`.
 * - The declines.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { createJavaScriptRuntime } from '../../src/compute-engine/compilation/javascript-runtime';
import type { StoredJavaScript } from '../../src/compute-engine/compilation/javascript-runtime';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { toBigint } from '../../src/compute-engine/boxed-expression/numerics';
import {
  compileSlice,
  Decline,
  OPERATORS,
} from '../../src/compute-engine/compilation/ir';
import { JS_BIGINT } from '../../src/compute-engine/compilation/ir/print-js';

type Json = unknown;
type Input = bigint | number | boolean | (bigint | number)[];
type Exact = bigint | boolean | Exact[];

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('m', 'integer');
ce.declare('k', 'integer');
ce.declare('x', 'real');
ce.declare('p', 'boolean');
ce.declare('J', 'list<integer>');
ce.declare('sq', '(integer, integer) -> integer');
ce.assign(
  'sq',
  ce.box(['Function', ['Add', ['Multiply', 'a', 'a'], 'b'], 'a', 'b'])
);
ce.declare('isdiv', '(integer, integer) -> boolean');
ce.assign(
  'isdiv',
  ce.box(['Function', ['Equal', ['Mod', 'a', 'b'], 0], 'a', 'b'])
);
ce.declare('fact', '(integer) -> integer');
ce.assign(
  'fact',
  ce.box([
    'Function',
    [
      'If',
      ['LessEqual', 'j', 0],
      1,
      ['Multiply', 'j', ['fact', ['Subtract', 'j', 1]]],
    ],
    'j',
  ])
);

const BIG = { profile: 'ir', mode: 'bigint' } as const;

function compiled(
  json: Json,
  options: Record<string, unknown> = {}
): CompilationResult<'javascript'> {
  return compile(ce.box(json as never), {
    ...BIG,
    fallback: false,
    ...options,
  } as never) as CompilationResult<'javascript'>;
}

/** The engine value of an input. */
function boxed(v: Input): Expression {
  if (Array.isArray(v))
    return ce.function(
      'List',
      v.map((x) => ce.number(BigInt(x)))
    );
  if (typeof v === 'boolean') return ce.symbol(v ? 'True' : 'False');
  return ce.number(BigInt(v));
}

/** The interpreter's value as a bigint, a boolean or a list of them, or
 *  `undefined` when it is not a finite integer. */
function exactOf(r: Expression): Exact | undefined {
  if (isSymbol(r, 'True')) return true;
  if (isSymbol(r, 'False')) return false;
  if (isNumber(r)) return r.isInteger === true ? toBigint(r)! : undefined;
  // A `List`, or a lazy collection (the value of a `Map` or a `Filter`).
  if (r.isCollection && ['List', 'Map', 'Filter'].includes(r.operator)) {
    const xs = [...r.each()].map((x) => exactOf(x.evaluate()));
    return xs.every((x) => x !== undefined) ? (xs as Exact[]) : undefined;
  }
  return undefined;
}

function interpret(
  json: Json,
  point: Record<string, Input>
): Exact | undefined {
  const e = ce.box(json as never);
  const subs = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, boxed(v)])
  );
  return exactOf(e.subs(subs).evaluate());
}

/** `json` compiles, also with no pass and no folding, and its value at
 *  each point is the interpreter's. */
function agrees(json: Json, points: Record<string, Input>[]) {
  const r = compiled(json);
  const plain = compiled(json, { cse: false, constantFold: false });
  expect(r.mode).toBe('bigint');
  for (const point of points) {
    const want = interpret(json, point);
    expect(want).toBeDefined();
    expect(r.run!(point as never)).toEqual(want);
    expect(plain.run!(point as never)).toEqual(want);
  }
}

const P53 = 2n ** 53n;
const P60 = 2n ** 60n;

describe('IR bigint: the interpreter, exactly', () => {
  test('arithmetic far beyond 2^53', () => {
    agrees(
      ['Add', ['Multiply', 'n', 'm'], ['Negate', 'k'], 1],
      [
        { n: P60 + 1n, m: P53 + 3n, k: -(P60 * 7n) },
        { n: 0, m: 5, k: -3 },
      ]
    );
  });
  test('Mod(n, 10) at 2^60 + 1 is 7', () => {
    expect(compiled(['Mod', 'n', 10]).run!({ n: P60 + 1n } as never)).toBe(7n);
    agrees(
      ['Mod', 'n', 'm'],
      [
        { n: -(P60 + 1n), m: 7 },
        { n: P60, m: -9 },
      ]
    );
  });
  test('a product and a power far beyond 2^53', () => {
    agrees(['Power', 'n', 5], [{ n: P53 + 1n }, { n: -(P60 + 3n) }]);
    agrees(['Multiply', 'n', 'n', 'm'], [{ n: P60, m: -(P53 + 1n) }]);
    // A closed node is the exact value of `evaluate()`.
    agrees(['Add', ['Power', 2, 70], 1, 'n'], [{ n: 0 }]);
  });
  test('Factorial and Binomial: the Catalan form at n = 40', () => {
    const catalan = [
      'Subtract',
      ['Binomial', ['Multiply', 2, 'n'], 'n'],
      ['Binomial', ['Multiply', 2, 'n'], ['Add', 'n', 1]],
    ];
    expect(compiled(catalan).run!({ n: 40 } as never)).toBe(
      2622127042276492108820n
    );
    agrees(catalan, [{ n: 40 }, { n: 7 }]);
    agrees(['Factorial', 'n'], [{ n: 30 }, { n: 0 }]);
    agrees(['GCD', 'n', 'm'], [{ n: P60 * 6n, m: P53 * 9n }]);
    agrees(['LCM', 'n', 'm'], [{ n: P53 + 1n, m: 12 }]);
  });
  test('comparisons, If and Which', () => {
    agrees(
      ['If', ['Less', 'n', 'm'], ['Subtract', 'm', 'n'], ['Abs', 'n']],
      [
        { n: P60, m: P60 + 1n },
        { n: -(P60 + 1n), m: -P60 - 2n },
      ]
    );
    agrees(
      [
        'Which',
        ['Less', 'n', 0],
        ['Negate', 'n'],
        ['Greater', 'n', 100],
        ['Mod', 'n', 100],
        'True',
        'n',
      ],
      [{ n: -(P60 + 5n) }, { n: P60 + 17n }, { n: 42 }]
    );
    agrees(
      ['And', ['Equal', 'n', 'm'], ['NotEqual', 'n', 0]],
      [
        { n: P60, m: P60 },
        { n: P60, m: P60 + 1n },
      ]
    );
  });
  test('a Sum and a Product with integer bounds', () => {
    agrees(['Product', 'k', ['Limits', 'k', 1, 'n']], [{ n: 30 }, { n: 0 }]);
    agrees(
      ['Sum', ['Power', 'k', 3], ['Limits', 'k', 1, 'n']],
      [{ n: 1000 }, { n: -2 }]
    );
    agrees(['Sum', ['Factorial', 'k'], ['Limits', 'k', 0, 'n']], [{ n: 25 }]);
  });
  test('a Block with a local', () => {
    agrees(
      [
        'Block',
        ['Declare', 't', 'integer', ['Multiply', 'n', 'n']],
        ['Assign', 't', ['Add', 't', 1]],
        ['Multiply', 't', 't'],
      ],
      [{ n: P53 + 1n }]
    );
  });
  test('user functions with integer parameters', () => {
    agrees(['sq', 'n', 'm'], [{ n: P60, m: -1 }]);
    agrees(['fact', 'n'], [{ n: 25 }, { n: 0 }]);
  });
  test('a list input and a list result', () => {
    agrees(
      ['List', 'n', ['Multiply', 'n', 'n'], ['Power', 'n', 3]],
      [{ n: 2n ** 40n }]
    );
    agrees(['Sum', 'J'], [{ J: [P60, P60, -1n] }]);
    agrees(
      ['Map', ['Function', ['Multiply', 'z', 'n'], 'z'], ['Range', 1, 'm']],
      [{ n: P60, m: 4 }]
    );
    agrees(['Length', 'J'], [{ J: [1, 2, 3] }]);
    agrees(['At', 'J', -1], [{ J: [1n, P60] }]);
  });
  test('Filter, Reduce, Loop and Sign', () => {
    agrees(
      ['Filter', 'J', ['Function', ['Greater', 'z', 'n'], 'z']],
      [{ J: [1n, P60, 3n], n: 2n }]
    );
    agrees(['Reduce', 'J', 'Multiply', 1], [{ J: [P60, P60, 3n] }]);
    agrees(
      [
        'Block',
        ['Declare', 's', 'integer', 0],
        [
          'Loop',
          ['Assign', 's', ['Add', 's', ['Multiply', 'e', 'e']]],
          ['Element', 'e', 'J'],
        ],
        's',
      ],
      [{ J: [P60, 2n] }]
    );
    agrees(['Sign', 'n'], [{ n: -P60 }, { n: 0 }]);
  });
  // A guard protects a pole that it guards: no pass evaluates the guarded
  // operand before its guard (the passes `hoist` and `fold` are off).
  test('a guarded pole is not evaluated', () => {
    agrees(
      [
        'And',
        ['NotEqual', 'm', 0],
        [
          'Or',
          ['Equal', ['Mod', 'n', 'm'], 1],
          ['Equal', ['Mod', 'n', 'm'], 2],
        ],
      ],
      [
        { n: 7, m: 0 },
        { n: 7, m: 3 },
      ]
    );
    agrees(
      ['If', ['NotEqual', 'm', 0], ['isdiv', 'n', 'm'], 'False'],
      [
        { n: 7, m: 0 },
        { n: 8, m: 4 },
      ]
    );
    agrees(
      [
        'And',
        ['GreaterEqual', 'n', 0],
        ['Greater', ['Factorial', 'n'], 'm'],
        ['Less', ['Factorial', 'n'], 'k'],
      ],
      [
        { n: -1, m: 0, k: 5 },
        { n: 2, m: 0, k: 5 },
      ]
    );
    agrees(
      [
        'And',
        ['LessEqual', 'n', ['Length', 'J']],
        ['Greater', 'n', 0],
        ['Equal', ['At', 'J', 'n'], ['Multiply', 2, ['At', 'J', 'n']]],
      ],
      [
        { J: [0, 2], n: 5 },
        { J: [0, 2], n: 1 },
      ]
    );
    agrees(
      [
        'Filter',
        'J',
        [
          'Function',
          [
            'And',
            ['NotEqual', 'z', 0],
            [
              'Or',
              ['Equal', ['Mod', 'n', 'z'], 0],
              ['Equal', ['Mod', 'n', 'z'], 1],
            ],
          ],
          'z',
        ],
      ],
      [{ J: [0, 2, 3, 5], n: 10 }]
    );
  });
  test('a function literal at the root', () => {
    const r = compiled([
      'Function',
      ['Multiply', 'a', ['Factorial', 'a']],
      ['Typed', 'a', "'integer'"],
    ]);
    expect(r.calling).toBe('lambda');
    const want = interpret(['Multiply', 'n', ['Factorial', 'n']], { n: 20 });
    expect(r.run!(20 as never)).toEqual(want);
    expect(r.run!(20n as never)).toEqual(want);
  });
});

/** A seeded generator of numbers in [0, 1). */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('IR bigint: random programs against the interpreter', () => {
  // The grammar has no pole (a divisor `Abs(b) + 1`, exponents from 1 to 3,
  // `Factorial` and `Binomial` of nonnegative operands), so every value is
  // a finite integer or a boolean: a `number`, a throw or another value
  // than the interpreter's is a failure.
  test('300 programs of a small integer grammar', () => {
    const random = mulberry32(715);
    const pick = <T>(xs: readonly T[]): T =>
      xs[Math.floor(random() * xs.length)];
    const inputs = ['n', 'm', 'k'];
    const int = (d: number): Json => {
      if (d === 0 || random() < 0.25)
        return random() < 0.6 ? pick(inputs) : pick([0, 1, 2, -3, 7, 100]);
      const a = () => int(d - 1);
      switch (pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const)) {
        case 0:
          return ['Add', a(), a()];
        case 1:
          return ['Subtract', a(), a()];
        case 2:
          return ['Multiply', a(), a()];
        case 3:
          return ['Negate', a()];
        case 4:
          return ['Abs', a()];
        case 5:
          return ['Mod', a(), ['Add', ['Abs', a()], 1]];
        case 6:
          return [pick(['Max', 'Min']), a(), a()];
        case 7:
          return ['Power', a(), pick([1, 2, 3])];
        case 8:
          return ['Factorial', ['Mod', a(), 20]];
        case 9:
          return ['Binomial', ['Mod', a(), 30], ['Mod', a(), 30]];
        case 10:
          return [pick(['GCD', 'LCM']), a(), a()];
        case 11:
          return ['If', bool(d - 1), a(), a()];
        default:
          return [
            'Sum',
            ['Multiply', 'j', a()],
            ['Limits', 'j', 1, ['Mod', a(), 6]],
          ];
      }
    };
    const bool = (d: number): Json =>
      d > 0 && random() < 0.3
        ? [pick(['And', 'Or']), bool(d - 1), bool(d - 1)]
        : [
            pick([
              'Less',
              'LessEqual',
              'Greater',
              'GreaterEqual',
              'Equal',
              'NotEqual',
            ]),
            int(d),
            int(d),
          ];
    const values: bigint[] = [
      0n,
      1n,
      -1n,
      7n,
      -13n,
      P53 + 1n,
      -(P60 - 3n),
      2n ** 64n + 5n,
      10n ** 20n,
    ];
    const counts = { compiled: 0, declined: 0, compared: 0 };
    const failures: string[] = [];
    const text = (x: unknown) =>
      JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));
    for (let i = 0; i < 300; i++) {
      const json = random() < 0.15 ? bool(3) : int(3);
      let r: CompilationResult<'javascript'>;
      try {
        r = compiled(json);
      } catch (e) {
        const code = (e as { diagnostic?: { code?: string } }).diagnostic?.code;
        if (code !== 'outside-profile') throw e;
        counts.declined++;
        continue;
      }
      counts.compiled++;
      for (let j = 0; j < 3; j++) {
        const point = Object.fromEntries(inputs.map((x) => [x, pick(values)]));
        const want = interpret(json, point);
        let got: unknown;
        try {
          got = r.run!(point as never);
        } catch (e) {
          got = `a throw: ${String(e)}`;
        }
        counts.compared++;
        if (want === undefined || got !== want)
          failures.push(
            `${text(json)} at ${text(point)}: ${text(got)} for ${text(want)}`
          );
      }
    }
    // Statistics for a reader of the run, printed on request only.
    if (process.env.CE_TEST_REPORT)
      console.log(
        `ir bigint random: ${counts.compiled} compiled, ${counts.declined} declined, ${counts.compared} compared`
      );
    expect(failures).toEqual([]);
    expect(counts.compared).toBeGreaterThan(300);
  });
});

describe('IR bigint: the ABI', () => {
  test('a number and a bigint input give the same bigint, also a small one', () => {
    const r = compiled(['Add', ['Multiply', 'n', 'n'], 1]);
    expect(r.run!({ n: 3 } as never)).toBe(10n);
    expect(r.run!({ n: 3n } as never)).toBe(10n);
    const off = compiled(['Add', 'n', 1], { entryChecks: false });
    expect(off.run!({ n: 1 } as never)).toBe(2n);
  });
  test('a number that is not a safe integer throws a TypeError with the checks on', () => {
    const r = compiled(['Add', 'n', 1]);
    expect(() => r.run!({ n: 1.5 } as never)).toThrow(TypeError);
    expect(() => r.run!({ n: 2 ** 60 } as never)).toThrow(TypeError);
    const list = compiled(['Sum', 'J']);
    expect(list.run!({ J: [1, 2n] } as never)).toBe(3n);
    expect(() => list.run!({ J: [1.5] } as never)).toThrow(TypeError);
  });
  test('a boolean result is a boolean, a list result an array of bigint', () => {
    expect(compiled(['Less', 'n', 'm']).run!({ n: P60, m: 1 } as never)).toBe(
      false
    );
    expect(
      compiled(['List', 'n', ['Add', 'n', 1]]).run!({ n: 1 } as never)
    ).toEqual([1n, 2n]);
  });
  test('a pole is a number: Infinity for ~oo, NaN for no value', () => {
    expect(compiled(['Factorial', 'n']).run!({ n: -1 } as never)).toBe(
      Infinity
    );
    expect(compiled(['Mod', 'n', 'm']).run!({ n: 5, m: 0 } as never)).toBeNaN();
    expect(
      compiled(['At', 'J', 'n']).run!({ J: [1], n: 3 } as never)
    ).toBeNaN();
    // An arm that is not taken throws no pole.
    const guarded = compiled([
      'If',
      ['Less', 'n', 0],
      0,
      ['Factorial', ['Subtract', 'n', 1]],
    ]);
    expect(guarded.run!({ n: -5 } as never)).toBe(0n);
    expect(guarded.run!({ n: 0 } as never)).toBe(Infinity);
    expect(
      compiled(['If', ['Less', 'n', 0], 0, ['Factorial', 'n']]).run!({
        n: -1,
      } as never)
    ).toBe(0n);
    expect(typeof compiled(['Mod', 'n', 0]).run!({ n: 5 } as never)).toBe(
      'number'
    );
    const lambda = compiled([
      'Function',
      ['Factorial', 'a'],
      ['Typed', 'a', "'integer'"],
    ]);
    expect(lambda.run!(-2 as never)).toBe(Infinity);
  });
  test('the bigint syntax spells only operations of the table', () => {
    const ops = new Set(
      OPERATORS.flatMap((r) => r.signatures.map((s) => s[2]))
    );
    for (const op of Object.keys(JS_BIGINT.ops)) expect(ops.has(op)).toBe(true);
  });
});

describe('IR bigint: stored code', () => {
  const stored = (r: CompilationResult<'javascript'>): StoredJavaScript =>
    JSON.parse(
      JSON.stringify({
        code: r.code,
        preamble: r.preamble,
        preambleOnce: r.preambleOnce,
        callCode: r.callCode,
        reconstructionDigits: r.reconstructionDigits,
        calling: r.calling,
        entryPlan: r.entryPlan,
        mode: r.mode,
        runtimeVersion: r.runtimeVersion,
        shippable: r.shippable,
        profile: r.profile,
      })
    );
  const rt = createJavaScriptRuntime();
  test('a stored result loads and gives the values of run()', () => {
    const cases: [Json, Record<string, Input>[]][] = [
      [
        ['Mod', 'n', 10],
        [{ n: P60 + 1n }, { n: 3 }],
      ],
      [['fact', 'n'], [{ n: 30 }]],
      [['Sum', 'J'], [{ J: [1, P60] }]],
      [['Factorial', 'n'], [{ n: -1 }]],
      [
        ['Map', ['Function', ['Power', 'z', 2], 'z'], ['Range', 'n', 'm']],
        [{ n: -2, m: 3 }],
      ],
    ];
    for (const [json, points] of cases) {
      const r = compiled(json);
      const s = stored(r);
      expect(s.mode).toBe('bigint');
      const f = rt.load(s);
      for (const point of points)
        expect(f(point)).toEqual(r.run!(point as never));
    }
    const lambda = compiled([
      'Function',
      ['sq', 'a', 'a'],
      ['Typed', 'a', "'integer'"],
    ]);
    expect(rt.load(stored(lambda))(P60)).toEqual(lambda.run!(P60 as never));
    expect(() => rt.load(stored(lambda))(1.5)).toThrow(TypeError);
  });
});

describe('IR bigint: declines', () => {
  ce.declare('vq', 'integer');
  // Each row has its options: a third parameter of the callback with no
  // column is read by Jest as `done`.
  const DECLINES: [string, Json, Record<string, unknown>][] = [
    ['a quotient under Floor', ['Floor', ['Divide', 'n', 3]], {}],
    ['a quotient under Ceil', ['Ceil', ['Divide', 'n', 2]], {}],
    ['Floor of a square root', ['Floor', ['Sqrt', 'n']], {}],
    [
      'a checked division under an integer promise',
      ['Block', ['Declare', 't', 'integer', ['Divide', 'n', 'm']], 't'],
      {},
    ],
    [
      'a comparison with a rational constant',
      ['Less', 'n', ['Rational', 7, 2]],
      {},
    ],
    ['a real input', ['Add', 'n', 'x'], {}],
    ['a real literal', ['Add', 'n', 1.5], {}],
    ['a power of an exponent that can be negative', ['Power', 'n', 'm'], {}],
    ['vars', ['Add', 'vq', 1], { vars: { vq: '_.q' } }],
  ];
  test.each(DECLINES)('%s', (name, json, options) => {
    let error: unknown;
    try {
      compiled(json, options);
    } catch (e) {
      error = e;
    }
    expect(
      (error as { diagnostic?: { code?: string } } | undefined)?.diagnostic
        ?.code
    ).toBe(name === 'vars' ? 'outside-profile' : 'bigint-lane');
  });
  test('GLSL has no bigint mode', () => {
    expect(() =>
      compileSlice(ce.box(['Add', 'n', 1]), { target: 'glsl', mode: 'bigint' })
    ).toThrow(Decline);
  });
});
