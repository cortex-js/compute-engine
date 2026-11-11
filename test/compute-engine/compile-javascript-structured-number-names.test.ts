import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Names declared `number` under the `numeric-kernel` profile (slice 1 of
// docs/plans/2026-11-11-structured-options-and-bindings.md): an input, a
// parameter of a `Function` literal or of a helper declared `number` has the
// kind of `number` in the mode, as on the existing compiler: real in the
// `strict` mode, complex in the `complex` mode, where an input or a
// parameter of the root accepts a number or `{re, im}` and is converted at
// each read (`_SYS.cplx`). A union of a real type with `nan` or
// `signed_infinity` is real in both modes. A helper declared with the
// result `number` returns the fact of its body, as the existing compiler
// does. A name declared `number` with a number literal value is captured
// with the kind of its value. Such a name has a declared type, so it is not
// listed in `defaultedSymbols`.
//
// Each admitted program is compared with the existing compiler (`cse:
// false`, `constantFold: false`, the same mode): the values with
// `Object.is` (both parts of a complex value), and the shape of the value
// that each code makes before `run()` turns `{re, im: 0}` into a number.

const PROFILE = { profile: 'numeric-kernel' } as const;
const EXISTING = { cse: false, constantFold: false } as const;

type Mode = 'strict' | 'complex';
type Complex = { re: number; im: number };

const typed = (name: string, type: string): MathJsonExpression =>
  ['Typed', name, `'${type}'`] as MathJsonExpression;

/** An engine with the declarations and the helpers of the tests. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('xn', 'number');
  ce.declare('yn', 'number');
  ce.declare('ex', 'nan | real | signed_infinity');
  ce.declare('xr', 'real');
  ce.declare('zc', 'complex');
  ce.declare('cn', 'number');
  ce.assign('cn', 1.5);
  ce.declare('kn', 'number');
  ce.assign('kn', 7);
  ce.declare('cz', 'number');
  ce.assign('cz', ce.expr(['Complex', 1, 2]));
  ce.declare('hn', '(number) -> number');
  ce.assign(
    'hn',
    ce.expr([
      'Function',
      ['Add', ['Sin', 't'], ['Multiply', 't', 't']],
      typed('t', 'number'),
    ])
  );
  ce.declare('hr', '(real) -> number');
  ce.assign(
    'hr',
    ce.expr([
      'Function',
      ['Divide', 't', ['Add', ['Multiply', 't', 't'], 1]],
      typed('t', 'real'),
    ])
  );
  ce.declare('hu', '(real) -> nan | real | signed_infinity');
  ce.assign('hu', ce.expr(['Function', ['Divide', 1, 't'], typed('t', 'real')]));
  ce.declare('ht', '(number) -> number');
  ce.assign(
    'ht',
    ce.expr([
      'Function',
      ['Block', ['Typed', ['Multiply', 't', 2], "'number'"]],
      typed('t', 'number'),
    ])
  );
  ce.declare('hq', '(real) -> number');
  ce.assign(
    'hq',
    ce.expr([
      'Function',
      ['Block', ['Typed', ['Multiply', 't', 2], "'number'"]],
      typed('t', 'real'),
    ])
  );
  ce.declare('hs', '(real) -> number');
  ce.assign('hs', ce.expr(['Function', ['Sqrt', 't'], typed('t', 'real')]));
  ce.declare('hw', '(number | nan) -> number');
  ce.assign(
    'hw',
    ce.expr(['Function', ['Add', 't', 1], typed('t', 'number | nan')])
  );
  ce.declare('p0', 'real<0..>');
  return ce;
}

function profile(
  expr: Expression,
  mode: Mode
): { result: CompilationResult<'javascript'> } | { message: string } {
  try {
    return {
      result: compile(expr, {
        ...PROFILE,
        mode,
        fallback: false,
      } as never) as CompilationResult<'javascript'>,
    };
  } catch (e) {
    return { message: (e as Error).message };
  }
}

/** `canCompile()` agrees with `compile()` on `expr` in `mode`. */
function expectAgreement(expr: Expression, mode: Mode): void {
  const got = profile(expr, mode);
  const answer = canCompile(expr, { ...PROFILE, mode } as never);
  if ('result' in got)
    expect(answer).toEqual({
      ok: true,
      pure: got.result.pure,
      shippable: got.result.shippable,
      ...(got.result.defaultedSymbols === undefined
        ? {}
        : { defaultedSymbols: got.result.defaultedSymbols }),
    });
  else expect(answer.ok).toBe(false);
}

const isComplex = (v: unknown): v is Complex =>
  typeof v === 'object' && v !== null && 're' in v;

/** The same value with `Object.is`, part by part for a complex value. */
function same(a: unknown, b: unknown): boolean {
  if (isComplex(a) && isComplex(b))
    return Object.is(a.re, b.re) && Object.is(a.im, b.im);
  return Object.is(a, b);
}

/** `number` or `complex`: the shape of a value. */
const shape = (v: unknown) => (isComplex(v) ? 'complex' : typeof v);

/** The value that the code makes, before `run()` normalizes it: the
 *  `rawCall` of an expression, or the source of a `Function` literal
 *  evaluated again with its helpers (as `scripts/js-profile-fuzz.ts`). */
function raw(
  result: CompilationResult<'javascript'>,
  parameters: readonly string[] | undefined
): (args: unknown[]) => unknown {
  const r = result.run as unknown as {
    rawCall?: (vars: unknown) => unknown;
    SYS?: unknown;
    toString(): string;
  };
  if (parameters === undefined) return (args) => r.rawCall!(args[0]);
  const fn = new Function('_SYS', `return (${r.toString()});`)(r.SYS) as (
    ...a: unknown[]
  ) => unknown;
  return (args) => fn(...args);
}

const REALS = [-2.5, -1, -0, 0, 0.25, 1, 3, 1e300, 1e-160];
const NON_FINITE = [NaN, Infinity, -Infinity];
const COMPLEXES: Complex[] = [
  { re: 1, im: 2 },
  { re: -0.5, im: -3 },
  { re: 2, im: 0 },
  { re: -0, im: 0 },
  { re: 0, im: 1e300 },
];

/** The values of the input `name` in `mode`: a name declared `number`
 *  accepts a complex value in the `complex` mode only; a real union holds
 *  `NaN` and the infinities. */
function valuesOf(name: string, mode: Mode): unknown[] {
  if (name === 'xr' || name === 'a') return [-2.5, 0, 0.5, 3];
  if (name === 'p0') return [0, 0.5, 4];
  if (name === 'zc') return COMPLEXES;
  if (name === 'ex' || name === 'pe') return [...REALS, ...NON_FINITE];
  return mode === 'complex' ? [...REALS, ...COMPLEXES] : REALS;
}

/** Every combination of the values of `names`. */
function points(names: readonly string[], mode: Mode): unknown[][] {
  let result: unknown[][] = [[]];
  for (const name of names)
    result = result.flatMap((p) => valuesOf(name, mode).map((v) => [...p, v]));
  return result;
}

const INPUTS = ['xn', 'yn', 'ex', 'xr', 'zc', 'p0'];

/** The inputs of an expression, in the order of `INPUTS`. */
const inputsOf = (json: MathJsonExpression): string[] =>
  INPUTS.filter((name) => JSON.stringify(json).includes(`"${name}"`));

/**
 * Compile `json` with the profile and with the existing compiler in
 * `mode`; with `parameters`, `json` is a `Function` literal whose
 * parameters have these names. Returns the code of the profile, after
 * checking the values and the shapes at every point, that `canCompile()`
 * agrees and that no name is listed in `defaultedSymbols`.
 */
function expectSameAsExisting(
  json: MathJsonExpression,
  mode: Mode,
  parameters?: readonly string[]
): string {
  const ce = engine();
  const expr = ce.expr(json);
  expectAgreement(expr, mode);
  const got = profile(expr, mode);
  if (!('result' in got)) throw new Error(got.message);
  const result = got.result;
  expect(result.defaultedSymbols).toBeUndefined();
  const existing = compile(expr, {
    ...EXISTING,
    mode,
    fallback: false,
  } as never) as CompilationResult<'javascript'>;
  const names = parameters ?? inputsOf(json);
  // A throw (`Mod` of a value beyond the safe integers) is compared by its
  // message.
  const call = (r: CompilationResult<'javascript'>, args: unknown[]) => {
    try {
      return parameters === undefined
        ? (r.run as unknown as (v: object) => unknown)(
            Object.fromEntries(names.map((n, i) => [n, args[i]]))
          )
        : (r.run as unknown as (...a: unknown[]) => unknown)(...args);
    } catch (e) {
      return `throws ${(e as Error).message}`;
    }
  };
  const rawShape = (f: (args: unknown[]) => unknown, args: unknown[]) => {
    try {
      return shape(f(args));
    } catch {
      return 'throws';
    }
  };
  const rawProfile = raw(result, parameters);
  const rawExisting = raw(existing, parameters);
  for (const args of points(names, mode)) {
    const vars =
      parameters === undefined
        ? [Object.fromEntries(names.map((n, i) => [n, args[i]]))]
        : args;
    const p = call(result, args);
    const e = call(existing, args);
    expect([args, p, same(p, e)]).toEqual([args, p, true]);
    expect([args, rawShape(rawProfile, vars)]).toEqual([
      args,
      rawShape(rawExisting, vars),
    ]);
  }
  return result.code;
}

/** The message of the decline of `json` with the profile in `mode`. */
function declineOf(json: MathJsonExpression, mode: Mode): string {
  const ce = engine();
  const expr = ce.expr(json);
  expectAgreement(expr, mode);
  const got = profile(expr, mode);
  if ('result' in got) throw new Error(`compiled: ${got.result.code}`);
  return got.message;
}

describe('an input declared number', () => {
  const both: [string, MathJsonExpression][] = [
    ['xn + 1', ['Add', 'xn', 1]],
    ['sin(xn)', ['Sin', 'xn']],
    ['sqrt(xn)', ['Sqrt', 'xn']],
    ['ln(xn)', ['Ln', 'xn']],
    ['exp(xn)', ['Exp', 'xn']],
    ['arcsin(xn)', ['Arcsin', 'xn']],
    ['|xn|', ['Abs', 'xn']],
    ['xn^2', ['Power', 'xn', 2]],
    ['xn^3', ['Power', 'xn', 3]],
    ['xn·xr', ['Multiply', 'xn', 'xr']],
    ['xn / xr', ['Divide', 'xn', 'xr']],
    ['xr / xn', ['Divide', 'xr', 'xn']],
    ['xn·i', ['Multiply', 'xn', 'ImaginaryUnit']],
    ['xn·yn + zc', ['Add', ['Multiply', 'xn', 'yn'], 'zc']],
    [
      'a root block',
      ['Block', ['Declare', 't', "'complex'", ['Multiply', 'xn', 2]], ['Add', 't', 'xn']],
    ],
  ];
  test.each(both)('%s: the values and the shapes of the existing compiler in both modes', (_name, json) => {
    expectSameAsExisting(json, 'strict');
    expectSameAsExisting(json, 'complex');
  });

  test('the code reads a real input in the strict mode and converts it at each read in the complex mode', () => {
    expect(expectSameAsExisting(['Add', 'xn', 1], 'strict')).toBe('_.xn + 1');
    expect(expectSameAsExisting(['Sin', 'xn'], 'complex')).toBe(
      '_SYS.csin(_SYS.cplx(_.xn))'
    );
  });

  test('the strict mode: an operator that reads a real operand', () => {
    for (const json of [
      ['Floor', 'xn'],
      ['Mod', 'xn', 3],
      ['If', ['Less', 'xn', 1], 1, 2],
    ] as MathJsonExpression[])
      expectSameAsExisting(json, 'strict');
  });

  test('the complex mode: an operator outside the profile for a complex operand declines', () => {
    expect(declineOf(['Floor', 'xn'], 'complex')).toMatch(
      /Floor with a complex operand is not in the profile/
    );
    expect(declineOf(['If', ['Less', 'xn', 1], 1, 2], 'complex')).toMatch(
      /Less with a complex operand is not in the profile/
    );
  });

  test('the strict mode keeps the entry check of a real input', () => {
    const ce = engine();
    const got = profile(ce.expr(['Add', 'xn', 1]), 'strict');
    if (!('result' in got)) throw new Error(got.message);
    const run = got.result.run as unknown as (v: object) => unknown;
    expect(() => run({ xn: { re: 1, im: 2 } })).toThrow(
      /"xn" was compiled as a real number but received a complex/
    );
  });
});

describe('an input declared a union of real with nan or signed_infinity', () => {
  const rows: [string, MathJsonExpression][] = [
    ['ex + 1', ['Add', 'ex', 1]],
    ['sqrt(ex)', ['Sqrt', 'ex']],
    ['floor(ex)', ['Floor', 'ex']],
    ['mod(ex, 3)', ['Mod', 'ex', 3]],
    ['ex·xn', ['Multiply', 'ex', 'xn']],
    ['sum of j^2 to ex', ['Sum', ['Power', 'j', 2], ['Limits', 'j', 1, 'ex']]],
  ];
  test.each(rows)('%s: real in both modes, as on the existing compiler', (_name, json) => {
    expectSameAsExisting(json, 'strict');
    expectSameAsExisting(json, 'complex');
  });

  test('the code reads a real input in the complex mode', () => {
    expect(expectSameAsExisting(['Sqrt', 'ex'], 'complex')).toBe(
      '_SYS.csqrt(({ re: _.ex, im: 0 }))'
    );
  });
});

describe('a parameter of a Function literal declared number', () => {
  const rows: [string, MathJsonExpression, string[]][] = [
    [
      'a·p + sqrt(p)',
      [
        'Function',
        ['Block', ['Add', ['Multiply', 'p', 'a'], ['Sqrt', 'p']]],
        typed('p', 'number'),
        typed('a', 'real'),
      ],
      ['p', 'a'],
    ],
    [
      'sin(p)/p',
      ['Function', ['Divide', ['Sin', 'p'], 'p'], typed('p', 'number')],
      ['p'],
    ],
    [
      'p·q + 1',
      [
        'Function',
        ['Add', ['Multiply', 'p', 'q'], 1],
        typed('p', 'number'),
        typed('q', 'number'),
      ],
      ['p', 'q'],
    ],
    [
      'sqrt(pe), pe a union of real with nan and signed_infinity',
      ['Function', ['Sqrt', 'pe'], typed('pe', 'nan | real | signed_infinity')],
      ['pe'],
    ],
  ];
  test.each(rows)('%s: the values and the shapes of the existing compiler in both modes', (_name, json, parameters) => {
    expectSameAsExisting(json, 'strict', parameters);
    expectSameAsExisting(json, 'complex', parameters);
  });

  test('the parameter is converted at each read in the complex mode', () => {
    expect(
      expectSameAsExisting(
        ['Function', ['Sin', 'p'], typed('p', 'number')],
        'complex',
        ['p']
      )
    ).toBe('(p) => { return _SYS.csin(_SYS.cplx(p)); }');
  });

  test('a parameter declared any keeps its decline when the body reads it', () => {
    for (const mode of ['strict', 'complex'] as const)
      expect(
        declineOf(['Function', ['Add', 'q', 1], typed('q', 'any')], mode)
      ).toMatch(/the parameter q of the function has the type any/);
  });

  // A parameter that the body never reads has no representation, whatever
  // its type (compile-javascript-structured-captures.test.ts).
  test('a parameter declared any that the body never reads is admitted', () => {
    for (const mode of ['strict', 'complex'] as const)
      expect(
        expectSameAsExisting(
          ['Function', ['Add', 'p', 1], typed('p', 'real'), typed('q', 'any')],
          mode,
          ['p', 'q']
        )
      ).toBe('(p, q) => { return p + 1; }');
  });
});

describe('a helper with a parameter or a result declared number', () => {
  test('a number result is the fact of the body, as on the existing compiler', () => {
    for (const mode of ['strict', 'complex'] as const) {
      // `(real) -> number` with a real body: a number in both modes.
      expectSameAsExisting(['Add', ['hr', 'xr'], 1], mode);
      // `(number) -> number` called with a name declared `number`.
      expectSameAsExisting(['Add', ['hn', 'xn'], 1], mode);
      expectSameAsExisting(['Add', ['ht', 'xn'], 1], mode);
      // `(real) -> nan | real | signed_infinity`: real.
      expectSameAsExisting(['Add', ['hu', 'xr'], 1], mode);
    }
    expectSameAsExisting(['Add', ['hn', 'zc'], 1], 'complex');
    expectSameAsExisting(['Add', ['hn', 'xr'], 1], 'strict');
    expectSameAsExisting(['Add', ['hq', 'xr'], 1], 'strict');
  });

  test('the complex mode: a real argument of a parameter declared number declines', () => {
    // The existing compiler passes the number and converts it in the body
    // of the helper; the parameter of the profile is complex.
    expect(declineOf(['Add', ['hn', 'xr'], 1], 'complex')).toMatch(
      /The argument `"xr"` of `hn` has the type `real`, and the parameter `t` has the type `number`, which is complex in the `complex` mode/
    );
  });

  test('the complex mode: a real value ascribed number declines', () => {
    // The existing compiler makes the value of `Typed(2t, 'number')`
    // complex (`_SYS.cplx({ re: 2 * t, im: 0 })`).
    expect(declineOf(['Add', ['hq', 'xr'], 1], 'complex')).toMatch(
      /Typed with the ascribed type `number` and a value of the type `real` is not in the profile in the `complex` mode/
    );
  });

  test('the message names the declared type of the parameter', () => {
    expect(declineOf(['Add', ['hw', 'xr'], 1], 'complex')).toMatch(
      /the parameter `t` has the type `nan \| number`, which is complex in the `complex` mode/
    );
  });

  test('the complex mode: a call that the existing compiler compiles with a copy of the helper typed by its argument declines', () => {
    // With the argument `2`, `0.5` or `p0: real<0..>`, the existing compiler
    // compiles a copy of `hs` whose `Sqrt` is real (`_fn_hs_integer_2___`),
    // and the call gives a number; the one definition of the profile gives
    // a complex value.
    for (const arg of [2, 0.5, 'p0', ['Abs', 'xr']] as MathJsonExpression[])
      expect(declineOf(['Add', ['hs', arg], 1], 'complex')).toMatch(
        /the call hs\(.*\) of the helper hs is not in the profile in the `complex` mode: the type .* of the argument .* proves the sign of a radical of its body/
      );
    // An argument of the type of the parameter takes the definition.
    expectSameAsExisting(['Add', ['hs', 'xr'], 1], 'complex');
    // The strict mode has no complex promotion: the same calls compile.
    for (const arg of [2, 0.5, 'p0', 'xr'] as MathJsonExpression[])
      expectSameAsExisting(['Add', ['hs', arg], 1], 'strict');
  });

  test('the strict mode: a complex argument of a parameter declared number declines', () => {
    expect(declineOf(['Add', ['hn', 'zc'], 1], 'strict')).toMatch(
      /The argument `"zc"` of `hn` has the type `complex`, and the parameter `t` has the type `real`/
    );
  });
});

describe('a captured name declared number', () => {
  test('a number literal value is a snapshot with the kind of the value', () => {
    for (const mode of ['strict', 'complex'] as const) {
      expect(expectSameAsExisting(['Multiply', 'cn', 'xr'], mode)).toBe(
        '1.5 * _.xr'
      );
      expect(expectSameAsExisting(['Add', 'kn', 'xr'], mode)).toBe('7 + _.xr');
      expectSameAsExisting(['Multiply', 'cn', 'zc'], mode);
      expectSameAsExisting(
        ['Function', ['Multiply', 'cn', 'a'], typed('a', 'real')],
        mode,
        ['a']
      );
    }
  });

  test('a complex value keeps its decline', () => {
    for (const mode of ['strict', 'complex'] as const)
      expect(declineOf(['Add', 'cz', 'xr'], mode)).toMatch(
        /unsupported binding cz/
      );
  });
});
