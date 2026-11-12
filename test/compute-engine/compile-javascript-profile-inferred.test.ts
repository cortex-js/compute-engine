import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// A type that the host wrote with `ce.infer()`, `ce.assume()` or
// `ce.assign()`, under the `numeric-kernel` profile
// (docs/plans/2026-11-10-js-numeric-kernel-profile-spec.md, "Names with no
// declared type"). Boxing writes no inferred type on a definition of the
// host's scopes, so such a type is read as a declared type: the name takes
// the kind of its type, as the existing compiler reads it, and it is not
// listed in `defaultedSymbols`.
//
// The values are compared with the existing compiler (`cse: false`,
// `constantFold: false`, the same mode) with `Object.is`.

const PROFILE = { profile: 'numeric-kernel' } as const;
const EXISTING = { cse: false, constantFold: false } as const;

type Mode = 'strict' | 'complex';

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

function existing(expr: Expression, mode: Mode): CompilationResult<'javascript'> {
  return compile(expr, {
    ...EXISTING,
    mode,
    fallback: false,
  } as never) as CompilationResult<'javascript'>;
}

/** A value of compiled code as a comparable form: a number, a boolean, or
 *  the parts of a complex value. */
function form(v: unknown): unknown {
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v !== null && typeof v === 'object' && 're' in v && 'im' in v)
    return { re: (v as { re: number }).re, im: (v as { im: number }).im };
  return v;
}

function sameValue(a: unknown, b: unknown): boolean {
  const fa = form(a);
  const fb = form(b);
  if (typeof fa !== 'object' || typeof fb !== 'object' || fa === null || fb === null)
    return Object.is(fa, fb);
  const ca = fa as { re: number; im: number };
  const cb = fb as { re: number; im: number };
  return Object.is(ca.re, cb.re) && Object.is(ca.im, cb.im);
}

/** The profile compiles `expr` in `mode`, `canCompile()` agrees, and the
 *  values are those of the existing compiler at each input of `inputs`.
 *  Returns the result of the profile. */
function expectSameValues(
  expr: Expression,
  mode: Mode,
  inputs: readonly Record<string, unknown>[]
): CompilationResult<'javascript'> {
  const got = profile(expr, mode);
  if (!('result' in got)) throw new Error(got.message);
  const answer = canCompile(expr, { ...PROFILE, mode } as never);
  expect(answer).toEqual({
    ok: true,
    pure: got.result.pure,
    shippable: got.result.shippable,
    ...(got.result.defaultedSymbols === undefined
      ? {}
      : { defaultedSymbols: got.result.defaultedSymbols }),
  });
  const reference = existing(expr, mode);
  const run = (r: CompilationResult<'javascript'>, v: object) =>
    (r.run as unknown as (v: object) => unknown)(v);
  for (const v of inputs) {
    const a = run(got.result, v);
    const b = run(reference, v);
    if (!sameValue(a, b))
      throw new Error(
        `${expr.toString()} (${mode}) at ${JSON.stringify(v)}: profile ${JSON.stringify(form(a))}, existing ${JSON.stringify(form(b))}`
      );
  }
  return got.result;
}

const XS = [-2.5, -1, -0, 0, 0.25, 1, 3].map((x) => ({ x }));
const COMPLEX_XS = [...XS, { x: { re: 0.5, im: -1 } }];

/** Each row: the host's call that writes the type of `x`, the type that
 *  results, a body, and per mode `true` when the profile compiles it with
 *  the values of the existing compiler, or the reason of the decline. */
type Row = {
  name: string;
  write: (ce: ComputeEngine) => void;
  type: string;
  body: MathJsonExpression;
  strict: true | RegExp;
  complex: true | RegExp;
};

const inferFrom =
  (json: MathJsonExpression) =>
  (ce: ComputeEngine): void => {
    ce.infer([ce.box(json)]);
  };

const ROWS: Row[] = [
  {
    // `Mod(x, 2)` requires a real operand: `x` is real, also in the
    // `complex` mode, where the existing compiler keeps it on the real lane.
    name: 'ce.infer(): real',
    write: inferFrom(['Mod', 'x', 2]),
    type: 'real',
    body: ['Sin', 'x'],
    strict: true,
    complex: true,
  },
  {
    name: 'ce.infer(): integer',
    write: inferFrom(['Fibonacci', 'x']),
    type: 'integer',
    body: ['Add', ['Sin', 'x'], 1],
    strict: true,
    complex: true,
  },
  {
    // `number`: real in the `strict` mode, a number or a complex value in
    // the `complex` mode, as for a name declared `number`.
    name: 'ce.infer(): number',
    write: inferFrom(['Add', 'x', 1]),
    type: 'number',
    body: ['Sin', 'x'],
    strict: true,
    complex: true,
  },
  {
    // A union of a real type with `signed_infinity`: real in both modes.
    name: 'ce.infer(): real | signed_infinity',
    write: inferFrom(['Arctan2', 'x', 1]),
    type: 'real | signed_infinity',
    body: ['Multiply', 2, 'x'],
    strict: true,
    complex: true,
  },
  {
    name: 'ce.infer(): boolean',
    write: inferFrom(['Not', 'x']),
    type: 'boolean',
    body: ['If', 'x', 1, 2],
    strict: true,
    complex: true,
  },
  {
    // A complex type that the profile has no kind for declines, as a name
    // declared with that type does.
    name: 'ce.infer(): complex | infinity',
    write: inferFrom(['Arg', 'x']),
    type: 'complex | infinity',
    body: ['Sin', 'x'],
    strict: /unsupported binding x/,
    complex: /unsupported binding x/,
  },
  {
    // A list type with elements that are not real (`ce.infer()` writes no
    // `list<real>` from a use: `At(x, 1) + 1` requires
    // `indexed_collection<number>`).
    name: 'ce.infer(): indexed_collection<number>',
    write: inferFrom(['Add', ['At', 'x', 1], 1]),
    type: 'indexed_collection<number>',
    body: ['At', 'x', 1],
    strict: /x/,
    complex: /x/,
  },
  {
    // A matrix of `number` cells: real in the `strict` mode (slice 3 of the
    // nested lists, `_SYS.det(x)`); the `complex` mode declines a list of
    // lists.
    name: 'ce.infer(): matrix',
    write: inferFrom(['Determinant', 'x']),
    type: 'matrix',
    body: ['Determinant', 'x'],
    strict: true,
    complex: /Determinant|x/,
  },
  {
    // An assumption narrows the type of the definition that it makes.
    name: 'ce.assume(x > 0)',
    write: (ce) => {
      ce.assume(ce.box(['Greater', 'x', 0]));
    },
    type: 'real<0<..>',
    body: ['Sin', 'x'],
    strict: true,
    complex: true,
  },
  {
    name: 'ce.assume(x ∈ ℤ)',
    write: (ce) => {
      ce.assume(ce.box(['Element', 'x', 'Integers']));
    },
    type: 'integer',
    body: ['Add', ['Sin', 'x'], 1],
    strict: true,
    complex: true,
  },
];

/** The type of `x` in `ce`. */
const typeOfX = (ce: ComputeEngine): string => ce.box('x').type.toString();

describe('a type written by the host', () => {
  test.each(ROWS.map((r) => [r.name, r] as const))('%s', (_name, row) => {
    for (const mode of ['strict', 'complex'] as const) {
      for (const order of ['after', 'before'] as const) {
        const ce = new ComputeEngine();
        // `before`: the program is boxed before the host writes the type.
        const early = order === 'before' ? ce.box(row.body) : undefined;
        row.write(ce);
        expect(typeOfX(ce)).toBe(row.type);
        const expr = early ?? ce.box(row.body);
        const expected = mode === 'strict' ? row.strict : row.complex;
        if (expected === true) {
          const inputs =
            row.type === 'boolean'
              ? [{ x: true }, { x: false }]
              : mode === 'complex' && row.type === 'number'
                ? COMPLEX_XS
                : XS;
          const result = expectSameValues(expr, mode, inputs);
          expect(result.defaultedSymbols).toBeUndefined();
        } else {
          const got = profile(expr, mode);
          expect(got).toEqual({ message: expect.stringMatching(expected) });
          expect(canCompile(expr, { ...PROFILE, mode } as never).ok).toBe(false);
        }
      }
    }
  });

  test('the kind of the type: real in the complex mode, as the existing compiler', () => {
    const ce = new ComputeEngine();
    ce.infer([ce.box(['Mod', 'x', 2])]);
    const got = profile(ce.box(['Sin', 'x']), 'complex');
    expect('result' in got && got.result.code).toBe('Math.sin(_.x)');
    expect(existing(ce.box(['Sin', 'x']), 'complex').code).toBe('Math.sin(_.x)');
  });

  test('a free symbol that the host did not type takes the default kind', () => {
    const ce = new ComputeEngine();
    ce.infer([ce.box(['Mod', 'x', 2])]);
    const got = profile(ce.box(['Add', 'x', 'u']), 'strict');
    expect('result' in got && got.result.defaultedSymbols).toEqual(['u']);
  });

  test('ce.infer() of a form that requires no type writes nothing', () => {
    const ce = new ComputeEngine();
    expect(ce.infer([ce.box(['Less', 'x', 1])]).declared).toEqual([]);
    const got = profile(ce.box(['Sin', 'x']), 'strict');
    expect('result' in got && got.result.defaultedSymbols).toEqual(['x']);
  });
});

describe('ce.assign(): a symbol with a value', () => {
  test.each<[string, (ce: ComputeEngine) => void, 'capture' | RegExp]>([
    ['an integer', (ce) => ce.assign('a', 3), 'capture'],
    ['a real number', (ce) => ce.assign('a', 2.5), 'capture'],
    ['a complex number', (ce) => ce.assign('a', ce.complex(1, 2)), /unsupported binding a/],
    ['a list of lists', (ce) => ce.assign('a', ce.box(['List', ['List', 1, 2]])), /unsupported binding a/],
  ])('%s', (_name, assign, expected) => {
    for (const mode of ['strict', 'complex'] as const)
      for (const order of ['after', 'before'] as const) {
        const ce = new ComputeEngine();
        const early = order === 'before' ? ce.box(['Add', 'x', 'a']) : undefined;
        assign(ce);
        const expr = early ?? ce.box(['Add', 'x', 'a']);
        if (expected === 'capture') {
          const result = expectSameValues(expr, mode, XS);
          // The value is copied: `a` is not an input.
          expect(result.code).not.toMatch(/_\.a/);
          expect(result.defaultedSymbols).toEqual(['x']);
        } else
          expect(profile(expr, mode)).toEqual({ message: expect.stringMatching(expected) });
      }
  });

  // A list is captured (compile-javascript-structured-captures.test.ts);
  // `x + a` is then an element-wise sum with an operand of the default kind:
  // real in the `strict` mode, with the doubles of the existing compiler,
  // and complex in the `complex` mode, where it declines.
  test('a list', () => {
    for (const order of ['after', 'before'] as const) {
      const ce = new ComputeEngine();
      const early = order === 'before' ? ce.box(['Add', 'x', 'a']) : undefined;
      ce.assign('a', ce.box(['List', 1, 2]));
      const expr = early ?? ce.box(['Add', 'x', 'a']);
      const got = profile(expr, 'strict');
      if (!('result' in got)) throw new Error(got.message);
      expect(got.result.code).not.toMatch(/_\.a/);
      expect(got.result.defaultedSymbols).toEqual(['x']);
      const reference = existing(expr, 'strict');
      for (const v of XS) {
        const a = (got.result.run as unknown as (v: object) => number[])(v);
        const b = (reference.run as unknown as (v: object) => number[])(v);
        expect([v, a.length, a.every((e, i) => Object.is(e, b[i]))]).toEqual([v, b.length, true]);
      }
      expect(profile(expr, 'complex')).toEqual({
        message: expect.stringMatching(/Add of a list and the operand x of the type `complex`/),
      });
    }
  });

  test('the existing route of the fragment target captures only a declared binding', () => {
    // The existing emitter of the fragment target (no `'structured'`
    // argument) refuses a capture whose type `ce.assign()` wrote; the
    // profile captures it, with the value of the ordinary compiler.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('offset', 2);
    ce.declare('helper', '(real) -> real');
    ce.assign('helper', ce.box(['Function', ['Add', 'u', 'offset'], ['Typed', 'u', "'real'"]]));
    const expr = ce.box(['helper', 'x']);
    expect(() => new ScalarFragmentJavaScriptTarget().compile(expr)).toThrow(/unsupported helper capture offset/);
    expect(expectSameValues(expr, 'strict', XS).preamble).toMatch(/return 2 \+ _tv2;/);
    ce.declare('other', 'real');
    ce.assign('other', 2);
    ce.assign('helper', ce.box(['Function', ['Add', 'u', 'other'], ['Typed', 'u', "'real'"]]));
    expect(new ScalarFragmentJavaScriptTarget().compile(ce.box(['helper', 'x'])).run!({ x: 3 } as never)).toBe(5);
  });

  test('a value assigned after the program was boxed is read, also in a helper capture', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Multiply', 'a', ['Sin', 'x']]);
    ce.assign('a', 4);
    const result = expectSameValues(expr, 'strict', XS);
    expect(result.code).toBe('4 * Math.sin(_.x)');
  });
});

describe('order independence', () => {
  // Boxing, evaluating and compiling other expressions that use the name
  // does not change the answer of the profile: only a call of the host
  // writes the type of a free symbol.
  const uses: MathJsonExpression[] = [
    ['Mod', 'x', 2],
    ['At', 'x', 1],
    ['And', 'x', 'True'],
    ['Less', 'x', 1],
    ['Factorial', 'x'],
  ];
  const others = (ce: ComputeEngine) => {
    for (const json of uses) {
      const e = ce.box(json);
      e.evaluate();
      e.simplify();
      e.N();
      try {
        compile(e, { ...PROFILE, fallback: false } as never);
      } catch {}
      try {
        compile(e);
      } catch {}
    }
    ce.parse('x^2 - 4 = 0').solve('x');
  };
  const answer = (ce: ComputeEngine, mode: Mode) => {
    const got = profile(ce.box(['Sin', 'x']), mode);
    return 'result' in got
      ? { code: got.result.code, defaulted: got.result.defaultedSymbols }
      : got;
  };

  test.each<[string, (ce: ComputeEngine) => void]>([
    ['no type', () => {}],
    ['ce.infer(): number', inferFrom(['Add', 'x', 1])],
    ['ce.infer(): real', inferFrom(['Mod', 'x', 2])],
    ['ce.assume(x > 0)', (ce) => void ce.assume(ce.box(['Greater', 'x', 0]))],
  ])('%s', (_name, write) => {
    for (const mode of ['strict', 'complex'] as const) {
      const plain = new ComputeEngine();
      write(plain);
      const expected = answer(plain, mode);
      const before = new ComputeEngine();
      others(before);
      write(before);
      expect(answer(before, mode)).toEqual(expected);
      const after = new ComputeEngine();
      write(after);
      others(after);
      expect(answer(after, mode)).toEqual(expected);
    }
  });
});

describe('a value assigned before or after the program is boxed', () => {
  // A name boxed before `ce.assign()` is a free name: each rule of the
  // profile reads the definition that it resolves to when the program is
  // compiled, so the outcome (the code or the reason of the decline) is the
  // one of the program boxed after the assignment.
  const fn = (ce: ComputeEngine) =>
    ce.box(['Function', ['Multiply', 2, 't'], 't']);
  const ROWS: [
    string,
    MathJsonExpression,
    (ce: ComputeEngine) => void,
    Record<string, unknown>?,
  ][] = [
    ['a Haversine grouping', ['Divide', 'x', ['Haversine', 'a']], (ce) => void ce.assign('a', 3)],
    ['Floor of a quotient by a captured name', ['Floor', ['Divide', 'x', 'a']], (ce) => void ce.assign('a', 3)],
    ['Round of a quotient by a captured name', ['Round', ['Divide', 'x', 'a']], (ce) => void ce.assign('a', 3)],
    ['Ceil of a quotient by a captured name', ['Ceil', ['Divide', 'x', 'a']], (ce) => void ce.assign('a', 3)],
    ['Mod by a captured name', ['Mod', 'x', 'a'], (ce) => void ce.assign('a', 3)],
    ['a captured exponent', ['Power', 'x', 'a'], (ce) => void ce.assign('a', 3)],
    ['a captured rational exponent', ['Power', 'x', 'a'], (ce) => void ce.assign('a', ce.box(['Rational', 1, 3]))],
    ['a captured base', ['Power', 'a', 'x'], (ce) => void ce.assign('a', 2.5)],
    ['the square root of a captured negative number', ['Sqrt', 'a'], (ce) => void ce.assign('a', -2)],
    ['a Sum bound', ['Sum', ['Sin', 'k'], ['Limits', 'k', 1, 'a']], (ce) => void ce.assign('a', 3)],
    ['a helper call', ['Add', ['g', 'x'], 1], (ce) => void ce.assign('g', fn(ce))],
    ['a helper call, f(t) := 2t', ['Add', ['g', 'x'], 1], (ce) => void ce.parse('g(t) \\coloneq 2t').evaluate()],
    ['a vars-mapped name with a value', ['Add', 'x', 'a'], (ce) => void ce.assign('a', 3), { vars: { a: '_.a' } }],
    ['a comparison with a captured pole', ['If', ['Less', ['Divide', 1, 'a'], 'x'], 1, 2], (ce) => void ce.assign('a', 0)],
    ['a list value', ['At', 'a', 1], (ce) => void ce.assign('a', ce.box(['List', 1, 2]))],
    ['a complex value', ['Add', 'x', 'a'], (ce) => void ce.assign('a', ce.complex(1, 2))],
    ['a captured rational factor', ['Multiply', 'x', 'a'], (ce) => void ce.assign('a', ce.box(['Rational', 1, 3]))],
    ['Sin(Pi·a)', ['Sin', ['Multiply', 'Pi', 'a']], (ce) => void ce.assign('a', 0.5)],
  ];
  const outcome = (
    json: MathJsonExpression,
    assign: (ce: ComputeEngine) => void,
    options: Record<string, unknown> | undefined,
    mode: Mode,
    order: 'before' | 'after'
  ) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const early = order === 'before' ? ce.box(json) : undefined;
    assign(ce);
    const expr = early ?? ce.box(json);
    try {
      const r = compile(expr, { ...PROFILE, ...options, mode, fallback: false } as never) as CompilationResult<'javascript'>;
      return { code: r.code, value: form((r.run as unknown as (v: object) => unknown)({ x: 0.75, a: 2 })) };
    } catch (e) {
      return { message: (e as Error).message };
    }
  };
  test.each(ROWS.map((row) => [row[0], row] as const))('%s', (_name, row) => {
    const [, json, assign, options] = row;
    for (const mode of ['strict', 'complex'] as const)
      expect(outcome(json, assign, options, mode, 'before')).toEqual(
        outcome(json, assign, options, mode, 'after')
      );
  });

  test('a helper assigned after the call was boxed: the values of the existing compiler', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box(['Add', ['g', 'x'], 1]);
    ce.assign('g', fn(ce));
    const result = expectSameValues(expr, 'strict', XS);
    expect(result.code).toBe('_tv1(_.x) + 1');
  });
});

describe('the names that are not read as typed by the host', () => {
  test('a parameter of a Function literal keeps the default kind, also when the host typed its name', () => {
    for (const mode of ['strict', 'complex'] as const) {
      const ce = new ComputeEngine();
      ce.infer([ce.box(['Mod', 'x', 2])]);
      const fn = ce.box(['Function', ['Sin', 'x'], 'x']);
      const got = profile(fn, mode);
      expect('result' in got && got.result.defaultedSymbols).toEqual(['x']);
      // Boxing narrows the type of the parameter (`real` here): it is not
      // read.
      const narrowed = ce.box(['Function', ['Add', ['Mod', 'x', 2], ['Sin', 'x']], 'x']);
      const literal = profile(narrowed, mode);
      if (mode === 'strict')
        expect('result' in literal && literal.result.defaultedSymbols).toEqual(['x']);
      else
        expect(literal).toEqual({ message: expect.stringMatching(/Mod with a complex operand/) });
    }
  });

  test('a name declared unknown with no assumption keeps the default kind', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'unknown');
    const got = profile(ce.box(['Sin', 'w']), 'strict');
    expect('result' in got && got.result.defaultedSymbols).toEqual(['w']);
  });
});
