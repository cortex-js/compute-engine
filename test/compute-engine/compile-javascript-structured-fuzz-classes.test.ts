import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// The classes of programs that the random differential tester of the
// `numeric-kernel` profile (scripts/js-profile-fuzz.ts) found where the
// profile gave another value or another shape than the existing compiler
// with `cse: false, constantFold: false`, or failed with an internal error.
// One test per class, with the minimal program of the tester: a form that
// the profile reproduces is compared with the existing compiler, the same
// doubles (`Object.is`, both parts of a complex value) and the same shape
// of the value that the code makes (a number or `{re, im}`, before `run()`
// turns `{re, im: 0}` into a number); a form that it does not reproduce
// declines with `outside-profile` and a message that names its cause.

type Mode = 'strict' | 'complex';
type Value = number | boolean | { re: number; im: number } | number[];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('k', 'integer');
  ce.declare('q', 'real<-1..1>');
  ce.declare('z', 'complex');
  ce.declare('B', 'boolean');
  ce.declare('L', 'list<real>');
  ce.declare('h', 'real');
  ce.assign('h', 2.5);
  ce.assign('w', 3);
  return ce;
}

const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;
const EXISTING = { cse: false, constantFold: false, fallback: false } as const;

type Compiled = ReturnType<typeof compile>;

function compileBoth(json: MathJsonExpression, mode: Mode) {
  const ce = engine();
  const expr = ce.box(json);
  const attempt = (options: object): Compiled | { error: string } => {
    try {
      return compile(expr, { ...options, mode } as never);
    } catch (e) {
      return { error: String((e as Error).message) };
    }
  };
  return {
    profile: attempt(PROFILE),
    existing: attempt(EXISTING),
  };
}

/** The same doubles, `-0` and `NaN` included, and the same shape. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (typeof a !== 'object' || typeof b !== 'object') return Object.is(a, b);
  const p = a as { re: number; im: number };
  const q = b as { re: number; im: number };
  return Object.is(p.re, q.re) && Object.is(p.im, q.im);
}

type Outcome = { value: unknown; raw: unknown } | { throws: string };

function outcome(result: Compiled, args: unknown): Outcome {
  const run = result.run as unknown as ((...a: unknown[]) => unknown) & {
    rawCall?: (vars: unknown) => unknown;
  };
  try {
    const value = Array.isArray(args) ? run(...args) : run(args);
    const raw =
      !Array.isArray(args) && typeof run.rawCall === 'function'
        ? run.rawCall(args)
        : undefined;
    return { value, raw };
  } catch (e) {
    return { throws: String(e) };
  }
}

const shapeOf = (v: unknown) =>
  v === undefined
    ? undefined
    : typeof v === 'object' && v !== null && !Array.isArray(v)
      ? 'complex'
      : typeof v;

/** The profile admits `json` and gives the doubles and the shape of the
 *  existing compiler at each of `inputs` (an object of the free symbols,
 *  or the arguments of a `Function` literal). Returns the code of the
 *  profile. */
function sameAsExisting(
  json: MathJsonExpression,
  mode: Mode,
  inputs: readonly (Record<string, Value> | Value[])[]
): string {
  const { profile, existing } = compileBoth(json, mode);
  expect('error' in profile ? profile.error : profile.success).toBe(true);
  expect('error' in existing ? existing.error : existing.success).toBe(true);
  const p = profile as Compiled;
  const e = existing as Compiled;
  for (const input of inputs) {
    const a = outcome(p, input);
    const b = outcome(e, input);
    if ('throws' in a || 'throws' in b) {
      expect([input, a]).toEqual([input, b]);
      continue;
    }
    expect([input, a.value, same(a.value, b.value)]).toEqual([
      input,
      a.value,
      true,
    ]);
    expect([input, shapeOf(a.raw)]).toEqual([input, shapeOf(b.raw)]);
  }
  return p.code;
}

/** The profile declines `json` with `outside-profile` and a message that
 *  matches `message`. */
function declines(json: MathJsonExpression, mode: Mode, message: RegExp) {
  const { profile } = compileBoth(json, mode);
  if ('error' in profile) {
    expect(profile.error).toMatch(message);
    return;
  }
  expect(profile.success).toBe(false);
  expect(profile.diagnostic?.code).toBe('outside-profile');
  expect(profile.diagnostic?.message).toMatch(message);
}

const declare = (
  name: string,
  type: string,
  value: MathJsonExpression
): MathJsonExpression => ['Declare', name, `'${type}'`, value];
const letLocal = (
  name: string,
  value: MathJsonExpression
): MathJsonExpression => [
  'Declare',
  name,
  ['Dictionary', ['KeyValuePair', "'value'", value]],
];
const typed = (name: string, type: string): MathJsonExpression => [
  'Typed',
  name,
  `'${type}'`,
];
const range = (
  k: string,
  a: MathJsonExpression,
  b: MathJsonExpression
): MathJsonExpression => ['Element', k, ['Range', a, b]];

const XS = [3, 0.5, -1, -0, 0, 1e300, -2.5, 1 / 3];

describe('D1: a local declared with a type has that type', () => {
  test('a complex value of a real local declines, in both modes', () => {
    declines(
      ['Block', declare('t', 'real', ['Complex', 1, 2]), 't'],
      'strict',
      /the local t is declared real, and the value \(1 \+ 2i\) written to it has the type complex/
    );
    declines(
      ['Block', declare('t', 'real', ['Complex', 1, 2]), 't'],
      'complex',
      /the local `t` has the type `complex`, and the local is declared `real`/
    );
    // The existing compiler writes `_SYS.crealElements(v)`, `NaN`, there.
    declines(
      ['Block', declare('t', 'real', ['Multiply', 1, 'u']), 't'],
      'complex',
      /the local `t` has the type `complex`, and the local is declared `real`/
    );
  });

  test('a value whose type is not real, of a real local, declines in the strict mode', () => {
    // The existing compiler declines with "different shapes".
    declines(
      ['Block', declare('t', 'real', ['Sqrt', 'x']), 't'],
      'strict',
      /the local t is declared real, and the value sqrt\(x\) written to it has the type complex, which is not real/
    );
    declines(
      ['Block', declare('t', 'real', 'x'), ['Assign', 't', ['Sqrt', 'x']], 't'],
      'strict',
      /the local t is declared real, and the value sqrt\(x\) written to it/
    );
  });

  test('an integer value of a real local is a real', () => {
    // The verifier refused `If(-1 < t, 1, t)`: the local kept the integer
    // fact of its initializer.
    const code = sameAsExisting(
      ['Block', declare('t', 'real', 1), ['If', ['Less', -1, 't'], 1, 't']],
      'strict',
      [{}]
    );
    expect(code).toBe('-1 < 1 ? 1 : 1');
    // A write in a branch, a write in a loop (a carried value), a
    // function literal.
    for (const mode of ['strict', 'complex'] as const) {
      sameAsExisting(
        [
          'Block',
          declare('t', 'real', 'x'),
          ['If', 'B', ['Assign', 't', 2]],
          ['If', ['Less', 't', 1], 1, 't'],
        ],
        mode,
        XS.flatMap((x) => [true, false].map((B) => ({ x, B })))
      );
      sameAsExisting(
        [
          'Function',
          [
            'Block',
            declare('s', 'real', 0),
            ['Loop', ['Assign', 's', ['Add', 's', 'n']], range('j', 1, 3)],
            ['If', ['Less', 's', 2], 2, 's'],
          ],
          typed('n', 'integer'),
        ],
        mode,
        [[0], [1], [-3], [2 ** 53]]
      );
    }
  });

  test('a list of integers of a local declared list<real> is a list of reals (CE-1202)', () => {
    const json: MathJsonExpression = [
      'Function',
      [
        'Block',
        declare('R', 'list<real>', ['Comprehension', 2, range('j', 1, 2)]),
        ['At', 'R', -1],
      ],
      typed('a', 'real'),
    ];
    for (const mode of ['strict', 'complex'] as const)
      sameAsExisting(json, mode, [[3], [0]]);
  });

  test('a number of a list local, and a list of a real local, decline', () => {
    declines(
      ['Block', declare('R', 'list<real>', 3), 1],
      'strict',
      /the local `R` has the type `integer`, and the local is declared `list<real>`/
    );
    declines(
      [
        'Block',
        declare('t', 'real', ['Comprehension', 'j', range('j', 1, 2)]),
        1,
      ],
      'strict',
      /The local `t` is declared `real`, and its value has the type `list<integer>`/
    );
  });
});

describe('D2: a quotient factor whose numerator is a product with a rational', () => {
  test('the chain of the existing emitter', () => {
    expect(
      sameAsExisting(
        [
          'Multiply',
          ['Divide', ['Multiply', 0.1, ['Rational', 1, 3]], 'w'],
          'q',
        ],
        'strict',
        [{ q: 1 / 3 }, { q: -1 }, { q: 0.1 }]
      )
    ).toBe('_.q * 0.1 / 3 / 3');
    // The other factor of the numerator is a quotient in turn.
    expect(
      sameAsExisting(
        [
          'Multiply',
          [
            'Divide',
            ['Multiply', ['Divide', 1.5, 'k'], ['Rational', 1, 3]],
            'x',
          ],
          'y',
        ],
        'strict',
        [
          { x: 1e155, y: 1e300, k: 7 },
          { x: 3, y: 0.1, k: -3 },
        ]
      )
    ).toBe('_.y * 1.5 / _.k / 3 / _.x');
    // More than one other factor: their product is one operand.
    sameAsExisting(
      [
        'Multiply',
        'q',
        ['Divide', ['Multiply', ['Rational', 1, 3], 0.1, 'Pi'], 'x'],
      ],
      'strict',
      XS.map((x) => ({ x, q: 1 / 3 }))
    );
  });
});

describe('D3: an ordering with a closed operand whose value is the undirected infinity', () => {
  test('declines: the existing compiler writes false', () => {
    for (const json of [
      ['GreaterEqual', ['Divide', 1, 0], 'x'],
      ['Less', ['Multiply', -5, ['Divide', 1, 0]], 'y'],
      ['Less', 'k', ['Power', 0, -1]],
      ['GreaterEqual', ['Cot', 'Pi'], 'x'],
    ] as MathJsonExpression[])
      declines(json, 'strict', /whose value is the undirected infinity/);
  });

  test('a local that shadows a name with a value is not closed', () => {
    // `h` has the value 2.5 in the engine; the local `h` is the input `x`.
    sameAsExisting(
      [
        'Block',
        declare('h', 'real', 'x'),
        ['Less', 'y', ['Divide', 1, ['Subtract', 'h', 2.5]]],
      ],
      'strict',
      [
        { x: 3, y: 1 },
        { x: 2.5, y: 1 },
      ]
    );
  });

  test('an operand that reads an index is not evaluated', () => {
    // The test of the existing compiler (`isConstantPole()`): every symbol
    // a constant or a name with a value. A sum over an index is not
    // evaluated, so its size does not matter.
    const ce = engine();
    const expr = ce.box([
      'Less',
      'x',
      ['Sum', ['Sin', 'j'], ['Limits', 'j', 1, 1_000_000]],
    ]);
    const sum = expr.ops![1];
    const proto = Object.getPrototypeOf(sum);
    const spy = jest.spyOn(proto, 'evaluate');
    try {
      const result = compile(expr, PROFILE as never);
      expect(result.success).toBe(true);
      const sums = spy.mock.contexts.filter(
        (c) => (c as { operator?: string }).operator === 'Sum'
      );
      expect(sums).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  test('a real infinity is admitted', () => {
    sameAsExisting(
      ['Less', 'x', 'PositiveInfinity'],
      'strict',
      XS.map((x) => ({ x }))
    );
  });
});

describe('D4: an unread write of a Mod that can throw', () => {
  test('the If that writes it is kept: the same RangeError', () => {
    const code = sameAsExisting(
      [
        'Block',
        declare('t', 'real', 'x'),
        [
          'If',
          ['LessEqual', 2, 'x'],
          ['Assign', 't', 1],
          ['Assign', 't', ['Mod', 'k', 3]],
        ],
        0,
      ],
      'strict',
      [
        { x: 1e-160, k: 2 ** 53 },
        { x: 1e-160, k: 5 },
        { x: 3, k: 2 ** 53 },
      ]
    );
    expect(code).toContain('_SYS.floorMod(_.k, 3)');
  });
});

describe('D4b: a helper whose body can throw, in an If whose writes are not read', () => {
  const withHelpers = (): ComputeEngine => {
    const ce = engine();
    ce.declare('fm', '(integer) -> integer');
    ce.assign(
      'fm',
      ce.expr(['Function', ['Mod', 'v', 3], typed('v', 'integer')])
    );
    ce.declare('fr', '(list<real>, integer) -> real');
    ce.assign(
      'fr',
      ce.expr([
        'Function',
        ['At', ['ReplaceAt', 'l', 'i', 0], 1],
        typed('l', 'list<real>'),
        typed('i', 'integer'),
      ])
    );
    return ce;
  };
  const throws = (json: MathJsonExpression, message: RegExp) => {
    const ce = withHelpers();
    const expr = ce.box(json);
    const p = compile(expr, { ...PROFILE, mode: 'strict' } as never);
    const e = compile(expr, { ...EXISTING, mode: 'strict' } as never);
    const input = { B: true, k: 2 ** 53 + 2, L: [1, 2] };
    expect(() => (e.run as (v: unknown) => unknown)(input)).toThrow(message);
    expect(() => (p.run as (v: unknown) => unknown)(input)).toThrow(message);
    expect((p.run as (v: unknown) => unknown)({ ...input, B: false })).toBe(1);
  };

  test('the If is kept: the same throw as the existing compiler', () => {
    throws(
      [
        'Block',
        declare('t', 'integer', 0),
        ['If', 'B', ['Assign', 't', ['fm', 'k']]],
        1,
      ],
      /RangeError|beyond the safe integer range/
    );
    throws(
      [
        'Block',
        declare('t', 'real', 0),
        ['If', 'B', ['Assign', 't', ['fr', 'L', 'k']]],
        1,
      ],
      /is not a position of the list/
    );
  });
});

describe('D5: At of a list whose element type is not real, in the complex mode', () => {
  test('declines: the existing compiler wraps the read in _SYS.cplx', () => {
    declines(
      ['At', ['Comprehension', ['Power', 'k', 1.6], range('j', 1, 4)], 3],
      'complex',
      /has the type number, which is not real, in the complex mode/
    );
  });

  test('a multiple of Pi whose type is not real declines too', () => {
    declines(
      ['Sin', ['Multiply', 'Pi', ['Divide', 1, 'x']]],
      'complex',
      /has the type number, which is not real, in the complex mode/
    );
    sameAsExisting(
      ['Sin', ['Multiply', 'Pi', 'x']],
      'complex',
      XS.map((x) => ({ x }))
    );
  });
});

describe('F1: a complex sum with a real operand that is a sum or a conditional', () => {
  test('the operand is one term, as on the existing emitter', () => {
    const point = (u: { re: number; im: number }) => ({ u, z: u, B: true });
    const zs = [
      { re: 1, im: 2 },
      { re: -0, im: 0.5 },
      { re: 1e300, im: -1 },
    ];
    for (const json of [
      ['Add', 'u', ['If', 'B', 1, -1]],
      ['Add', ['Which', 'B', 2], 'u'],
      ['Add', ['Sum', 1, ['Limits', 'j', 1, 5]], 'ImaginaryUnit'],
      ['Add', 'z', ['Conjugate', ['Add', 'x', 'y']]],
      ['Add', 'z', 'x', ['If', 'B', 0.1, -1]],
    ] as MathJsonExpression[])
      sameAsExisting(
        json,
        'complex',
        zs.flatMap((u) => [
          { ...point(u), x: 0.1, y: 0.2 },
          { ...point(u), B: false, x: -0, y: 1e300 },
        ])
      );
    sameAsExisting(
      ['Subtract', ['If', 'B', 1, 0.1], 'z'],
      'strict',
      zs.map((z) => ({ z, B: false }))
    );
  });
});

describe('F2: Haversine where the existing emitter writes it with no parentheses', () => {
  test('declines, however the parent reaches it', () => {
    declines(
      ['Multiply', ['Divide', ['Haversine', -0.25], 'x'], 'h'],
      'strict',
      /in the numerator of the factor/
    );
    declines(
      [
        'Function',
        ['Block', declare('t', 'real', ['Haversine', 1]), ['Divide', 1, 't']],
        typed('a', 'real'),
      ],
      'strict',
      /the value Haversine\(1\) of the local t/
    );
    declines(
      ['Product', ['Haversine', 'j'], ['Limits', 'j', 1, 3]],
      'strict',
      /Haversine of j as an operand of Product/
    );
    // A sum of one term is the term, written in the parent of the sum.
    declines(
      ['Multiply', 'x', ['Sum', ['Haversine', 'j'], ['Limits', 'j', 1, 1]]],
      'strict',
      /Haversine of j as an operand of Sum/
    );
  });

  test('a haversine that no parent groups is admitted', () => {
    sameAsExisting(
      ['Add', ['Haversine', ['Multiply', 2, 'x']], 1],
      'strict',
      XS.map((x) => ({ x }))
    );
  });
});

describe('L2: a real value of a local declared complex', () => {
  test('declines in the complex mode: the existing compiler reads it in another shape', () => {
    // With a write, the existing compiler gives `{re: 4, im: 0}` at
    // `x = 3`; with none, it reads `(t).re` of a number, `NaN`. In the
    // strict mode it declines both.
    declines(
      [
        'Block',
        declare('t', 'complex', 'x'),
        ['Assign', 't', ['Add', 't', 1]],
        't',
      ],
      'complex',
      /local writes must preserve representation: the local t is held as complex/
    );
    declines(
      ['Block', declare('t', 'complex', 'x'), ['Add', 't', 1]],
      'complex',
      /local writes must preserve representation: the local t is held as complex/
    );
  });

  test('a complex value of a local declared complex is admitted', () => {
    for (const mode of ['strict', 'complex'] as const)
      sameAsExisting(
        [
          'Block',
          declare('t', 'complex', 'z'),
          ['Assign', 't', ['Add', 't', 1]],
          't',
        ],
        mode,
        [{ z: { re: 1, im: 2 } }, { z: { re: -0, im: 0.5 } }]
      );
  });
});

describe('L1: a let local whose type is not real, in the complex mode', () => {
  test('declines: the existing compiler reads it as a complex value', () => {
    declines(
      [
        'Function',
        ['Block', letLocal('t', ['Divide', 0.5, 'b']), 't'],
        typed('b', 'real'),
      ],
      'complex',
      /the local t has the type infinity \| nan \| real, which is not real, in the complex mode/
    );
  });

  test('a let local that holds a list is admitted', () => {
    const inputs = [
      { x: 0.5, L: [1, 2] },
      { x: -0, L: [3] },
    ];
    sameAsExisting(
      [
        'Block',
        letLocal('R', 'L'),
        ['Assign', 'R', ['ReplaceAt', 'R', 1, 'x']],
        ['Add', ['At', 'R', 1], ['At', 'L', 1]],
      ],
      'complex',
      inputs
    );
    sameAsExisting(
      [
        'Block',
        letLocal('R', ['Comprehension', 'j', range('j', 1, 3)]),
        [
          'Loop',
          ['Assign', 'R', ['ReplaceAt', 'R', 'i', 'x']],
          range('i', 1, 2),
        ],
        ['At', 'R', 1],
      ],
      'complex',
      inputs
    );
  });

  test('a let local read as a bound or an index is admitted', () => {
    sameAsExisting(
      ['Block', letLocal('n', ['Length', 'L']), ['At', 'L', 'n']],
      'complex',
      [{ L: [1, 2, 3] }, { L: [0.5] }]
    );
  });
});

describe('R1: WithRandomSeed of a value that is not a number', () => {
  test('declines: the existing compiler reads it element-wise', () => {
    // `u` has no declared type: the node has the type `value`, and the
    // existing compiler writes `_SYS.bcast(…, 0.6666666666666666, …)`.
    declines(
      [
        'Multiply',
        ['Rational', 2, 3],
        ['Max', 'u', 2.5],
        ['WithRandomSeed', 1, 'u'],
      ],
      'strict',
      /WithRandomSeed of the type value/
    );
  });
});
