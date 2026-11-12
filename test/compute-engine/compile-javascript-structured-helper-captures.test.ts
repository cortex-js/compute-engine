import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';
import { verifyJavaScriptProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import type { EffectFact, IROperation, IRProgram, IRRegion, IRValue } from '../../src/compute-engine/compilation/structured-ir';

// The helpers of the structured route of the JavaScript compiler (the
// `numeric-kernel` profile) whose body reads a name that is not one of its
// parameters: an input of the program, which the body reads where it runs
// (`IRFunction.inputs`), as the existing compiler does (`const _fn_g = (t) =>
// t + _.x;`), and a captured expression, which the root computes once and
// passes to the helper (`const _val_lv = _.x + 1;` on the existing
// compiler). For each admitted program the profile gives the doubles and the
// shape of the existing compiler with `cse: false, constantFold: false`
// (`Object.is` at every depth), the same `symbolDeps`, and the value of the
// interpreter (the inputs assigned in an engine of their own: a function
// literal reads the binding of its definition); every other program declines
// with a message that names its cause.

const EXISTING = { cse: false, constantFold: false, fallback: false } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;

type Mode = 'strict' | 'complex';
type Input = Record<string, unknown>;

const fn = (body: MathJsonExpression, ...names: string[]): MathJsonExpression => ['Function', body, ...names];

/** The engine of the tests: the inputs, the helpers and the stored values.
 *  `values`: the inputs assigned, for the interpreter. */
function engine(values?: Input): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('k', 'integer');
  ce.declare('xn', 'number');
  ce.declare('L', 'list<real>');
  const assign = (name: string, json: MathJsonExpression) => ce.assign(name, ce.box(json));
  // An input.
  assign('g', fn(['Add', 't', 'x'], 't'));
  // Two inputs, one of them an integer.
  assign('g2', fn(['Multiply', 't', ['Add', 'y', 'k']], 't'));
  // A list input.
  assign('gl', fn(['Add', 't', ['At', 'L', 1]], 't'));
  // A `number` input.
  assign('gn', fn(['Sin', ['Add', 't', 'xn']], 't'));
  // A helper that calls a helper that reads an input, and reads one.
  assign('gg', fn(['Add', ['g', 't'], 'y'], 't'));
  // A captured number and a captured list.
  assign('cn', ce.box(1.5));
  assign('CL', ['List', 1.5, 2.5]);
  assign('gc', fn(['Add', ['Multiply', 't', 'cn'], ['At', 'CL', 2], 'x'], 't'));
  // Stored values: an expression, a chain, an alias.
  assign('lv', ['Add', 'x', 1]);
  assign('lw', ['Multiply', 'lv', 'y']);
  assign('sv', 'y');
  assign('h', fn(['Multiply', 't', 'lv'], 't'));
  assign('h3', fn(['Add', ['h', 't'], 'lv'], 't'));
  assign('hw', fn(['Add', 't', 'lw'], 't'));
  assign('ha', fn(['Add', 't', 'sv'], 't'));
  // An alias of a captured expression, an alias of that alias, and helpers
  // that read them.
  assign('sa', 'lv');
  assign('sb', 'sa');
  assign('hsa', fn(['Multiply', 't', 'sa'], 't'));
  assign('hsb', fn(['Multiply', 't', 'sb'], 't'));
  // A helper that reads an input in a statement block, a loop and a Sum.
  assign(
    'gb',
    fn(
      [
        'Block',
        ['Declare', 's', "'real'", 0],
        ['Loop', ['Assign', 's', ['Add', 's', ['Multiply', 'i', 'x']]], ['Element', 'i', ['Range', 1, 3]]],
        ['Add', 's', ['Sum', ['Multiply', 'j', 'y'], ['Limits', 'j', 1, 4]]],
      ],
      't'
    )
  );
  // Helpers with a declared signature, which the `complex` mode admits.
  ce.declare('gs', '(real) -> real');
  assign('gs', fn(['Add', ['Multiply', 2, 't'], 'x'], 't'));
  ce.declare('gsn', '(real) -> number');
  assign('gsn', fn(['Sqrt', ['Add', 't', 'xn']], 't'));
  // A host function that writes the inputs object.
  ce.declare('hm', '(real) -> real');
  // A helper that calls the host function and reads an input; a helper whose
  // value is a list.
  assign('gm', fn(['Add', ['hm', 't'], 'x'], 't'));
  assign('glist', fn(['List', 't', 'x'], 't'));
  // Helpers that read an alias of an input, with a complex and a real value,
  // and the complex one with the input itself.
  ce.declare('gcs', '(real) -> complex');
  assign('gcs', fn(['Add', 'sv', ['Multiply', 'ImaginaryUnit', 't']], 't'));
  ce.declare('gcy', '(real) -> complex');
  assign('gcy', fn(['Add', 'y', ['Multiply', 'ImaginaryUnit', 't']], 't'));
  ce.declare('grs', '(real) -> real');
  assign('grs', fn(['Add', 'sv', 't'], 't'));
  for (const [name, value] of Object.entries(values ?? {}))
    ce.assign(name, Array.isArray(value) ? ce.box(['List', ...(value as number[])]) : (value as number));
  return ce;
}

const INPUTS: Input[] = [
  { x: 1.5, y: 2.5, k: 1, xn: 0.5, L: [3, 4] },
  { x: -0.75, y: 0, k: 2, xn: -2, L: [-0, 1] },
  { x: 0, y: -0.25, k: -1, xn: 0, L: [] },
  { x: -0, y: 7, k: 0, xn: 3, L: [1e20] },
  { x: Number.NaN, y: 1, k: 2, xn: 1, L: [2] },
];

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null)
    return same((a as { re: number }).re, (b as { re: number }).re) && same((a as { im: number }).im, (b as { im: number }).im);
  return a === b;
}

function close(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return Object.is(a, b) || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) || (Number.isNaN(a) && Number.isNaN(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => close(v, b[i]));
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null)
    return close((a as { re: number }).re, (b as { re: number }).re) && close((a as { im: number }).im, (b as { im: number }).im);
  if (typeof a === 'object' && a !== null && typeof b === 'number') return close((a as { re: number }).re, b) && close((a as { im: number }).im, 0);
  return a === b;
}

function finite(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(finite);
  if (typeof v === 'object' && v !== null) return finite((v as { re: number }).re) && finite((v as { im: number }).im);
  return typeof v === 'boolean';
}

function outcome(f: () => unknown): unknown {
  try {
    const v = f();
    return Array.isArray(v) ? [...v] : typeof v === 'object' && v !== null ? { ...v } : v;
  } catch (e) {
    return `throws ${(e as Error).message}`;
  }
}

/** The value of the interpreter, in an engine where the inputs have their
 *  values: a helper reads the binding of its definition. */
function interpret(json: MathJsonExpression, input: Input): unknown {
  let ce: ComputeEngine;
  try {
    ce = engine(input);
  } catch {
    // `NaN` is not a value of a name declared `real`.
    return undefined;
  }
  const unbox = (v: Expression): unknown => {
    if (v.isCollection) return [...(v as Expression & { each(): Generator<Expression> }).each()].map((e) => unbox(e.evaluate()));
    const n = v.N();
    return n.im === 0 ? n.re : { re: n.re, im: n.im };
  };
  return unbox(ce.box(json).evaluate());
}

/**
 * Compile `json` on both routes in each mode of `modes`, with `symbolDeps`,
 * and compare the values at each input, the dependencies and the value of
 * the interpreter where it is finite. Returns the code of the profile in the
 * first mode, with its preamble.
 */
function check(
  json: MathJsonExpression,
  options: {
    modes?: readonly Mode[];
    interpreter?: boolean;
    inputs?: Input[];
    /** `superset`: the dependencies of the profile hold those of the
     *  existing compiler. */
    deps?: 'equal' | 'superset';
  } = {}
): string {
  const ce = engine();
  const expr = ce.box(json);
  let code: string | undefined;
  for (const mode of options.modes ?? (['strict'] as const)) {
    const existingDeps = new Set<string>();
    const profileDeps = new Set<string>();
    const existing = compile(expr, { ...EXISTING, mode, symbolDeps: existingDeps } as never) as CompilationResult<'javascript'>;
    const profile = compile(expr, { ...PROFILE, mode, symbolDeps: profileDeps } as never) as CompilationResult<'javascript'>;
    expect(profile.success).toBe(true);
    code ??= `${profile.preamble ?? ''}${profile.code}`;
    if (options.deps === 'superset') expect([...existingDeps].filter((n) => !profileDeps.has(n))).toEqual([]);
    else expect([...profileDeps].sort()).toEqual([...existingDeps].sort());
    for (const input of options.inputs ?? INPUTS) {
      const a = outcome(() => existing.run!(input as never));
      const b = outcome(() => profile.run!(input as never));
      if (!same(a, b)) throw new Error(`${mode} ${JSON.stringify(input)}: existing ${JSON.stringify(a)}, profile ${JSON.stringify(b)}`);
      if (options.interpreter !== false && finite(b)) {
        const i = interpret(json, input);
        if (i !== undefined && !close(b, i)) throw new Error(`${mode} ${JSON.stringify(input)}: profile ${JSON.stringify(b)}, interpreter ${JSON.stringify(i)}`);
      }
    }
  }
  return code!;
}

/** The profile declines `json` with `message`. */
function declines(json: MathJsonExpression, message: RegExp, options: object = {}): void {
  let error: unknown;
  try {
    compile(engine().box(json), { ...PROFILE, ...options } as never);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as { diagnostic?: { code?: string } }).diagnostic?.code).toBe('outside-profile');
  expect((error as Error).message).toMatch(message);
}

describe('a helper that reads an input of the program', () => {
  test.each<[string, MathJsonExpression, Mode[]?]>([
    ['one input', ['g', 'y']],
    ['a helper with a declared signature, in both modes', ['gs', 'y'], ['strict', 'complex']],
    ['an input declared number, in both modes', ['gsn', 'y'], ['strict', 'complex']],
    ['two calls', ['Add', ['g', 'y'], ['g', 2]]],
    ['two inputs, one an integer', ['g2', 'x']],
    ['an input that only the helper reads', ['g', 2]],
    ['a list input', ['gl', 'y']],
    ['an input declared number', ['gn', 'y']],
    ['a helper that calls a helper that reads an input', ['gg', 'k']],
    ['two helpers, the same and different inputs', ['Add', ['g', 'y'], ['gg', 'x'], ['g2', 1]]],
    ['with a captured number and a captured list', ['gc', 'y']],
    ['a body with statements, a loop and a Sum', ['gb', 1]],
    ['in a branch', ['If', ['Less', 'y', 0], ['g', 1], ['g', 2]]],
    ['in the body of a Sum', ['Sum', ['g', 'j'], ['Limits', 'j', 1, 3]]],
    ['in the body of a Sum of more terms than it unrolls', ['Sum', ['g', 'j'], ['Limits', 'j', 1, 300]]],
    ['as a function operand', ['Map', 'g', 'L']],
    ['in a lambda', ['Map', fn(['g', 'u'], 'u'), 'L']],
    ['in a comprehension', ['Comprehension', ['g', 'j'], ['Element', 'j', ['Range', 1, 3]]]],
  ])('%s', (_name, json, ...rest) => {
    const modes = rest[0] as Mode[] | undefined;
    check(json, modes === undefined ? {} : { modes });
  });

  test('in an integrand', () => {
    // The closed form replaces the integral: the existing compiler records
    // no dependency on `g`, the profile records the helper that its
    // admission resolved (a dependency more is harmless).
    check(['Integrate', ['g', 't'], ['Limits', 't', 0, 'y']], { deps: 'superset' });
  });

  test('the code reads the input in the body of the function', () => {
    expect(check(['Add', ['g', 'y'], ['g', 2]])).toBe(
      'function _tv1(_tv2) { return _tv2 + _.x; }\n_tv1(_.y) + _tv1(2)'
    );
  });

  test('in a loop of a root Block', () => {
    check([
      'Block',
      ['Declare', 's', "'real'", 0],
      ['Loop', ['Assign', 's', ['Add', 's', ['g', 'i']]], ['Element', 'i', ['Range', 1, 3]]],
      's',
    ]);
  });

  // The body of the helper reads the input of the program also where the
  // call is under a binder of the same name: the existing compiler writes the
  // body outside every binder (Tycho row 507), and the interpreter reads the
  // binding of the definition of the helper.
  test.each<[string, MathJsonExpression]>([
    ['a local of a root Block', ['Block', ['Declare', 'x', "'real'", 5], ['Add', 'x', ['g', 1]]]],
    ['a local of a value block', ['Add', ['Block', ['Declare', 'x', "'real'", ['Multiply', 2, 'y']], ['g', 'x']], 1]],
    ['the index of a Sum', ['Sum', ['g', 'x'], ['Limits', 'x', 1, 3]]],
    ['the index of a Loop', ['Block', ['Declare', 's', "'real'", 0], ['Loop', ['Assign', 's', ['Add', 's', ['g', 'x']]], ['Element', 'x', ['Range', 1, 3]]], 's']],
    ['a parameter of a lambda', ['Map', fn(['g', 'x'], 'x'), 'L']],
  ])('a call under %s named like the input', (_name, json) => {
    // The interpreter reads a block local and an index of the root as the
    // existing compiler does here; the values are compared with both.
    check(json, { interpreter: !/lambda/.test(_name) });
  });

  test('a host function that writes the inputs object, before, between and after the calls', () => {
    const log: string[] = [];
    let current: Input = {};
    (globalThis as Record<string, unknown>).__hcSet = (t: number) => {
      log.push(`set(${t})`);
      current.x = (current.x as number) + 10;
      return t;
    };
    const options = { functions: { hm: '__hcSet' } };
    const ce = engine();
    for (const json of [
      ['Add', ['hm', 1], ['g', 2]],
      ['Add', ['g', 2], ['hm', 1], ['g', 3]],
      ['Add', ['g', 2], ['hm', 1]],
      ['g', ['hm', 'y']],
      ['Multiply', ['g', 'y'], ['hm', 1], ['g', 'y']],
      ['Sum', ['Add', ['g', 'j'], ['hm', 'j']], ['Limits', 'j', 1, 3]],
      ['If', ['Less', ['hm', 1], 'x'], ['g', 1], ['g', 2]],
    ] as MathJsonExpression[]) {
      const expr = ce.box(json);
      const existing = compile(expr, { ...EXISTING, ...options } as never) as CompilationResult<'javascript'>;
      const profile = compile(expr, { ...PROFILE, ...options } as never) as CompilationResult<'javascript'>;
      for (const x of [1.5, -0, Number.NaN]) {
        current = { x, y: 2.5 };
        log.length = 0;
        const a = outcome(() => existing.run!(current as never));
        const logA = [...log];
        current = { x, y: 2.5 };
        log.length = 0;
        const b = outcome(() => profile.run!(current as never));
        expect([b, log]).toEqual([a, logA]);
        expect(same(a, b)).toBe(true);
      }
    }
  });

  test('a host function and a complex value: a call of a helper that reads an input counts as a read', () => {
    // The existing emitter evaluates a complex operand first: `g(1)` in
    // `g(1)·Arcosh(x)` would read `_.x` before `hm`.
    declines(['Add', ['hm', 1], ['Multiply', ['g', 1], ['Arcosh', 'x']]], /draws more than once, and a draw is in a complex value/, {
      functions: { hm: '__hcSet' },
    });
  });

  // A captured alias (`sv := y`) is a read of `y` where the alias is read:
  // a call of a helper that reads it is a read of the root, as a helper that
  // reads `y` itself.
  test.each<[string, MathJsonExpression]>([
    ['through an alias', ['Add', ['hm', 1], ['gcs', 1]]],
    ['directly', ['Add', ['hm', 1], ['gcy', 1]]],
  ])('a host function and a complex value of a helper that reads an input %s', (_name, json) => {
    declines(json, /draws more than once, and a draw is in a complex value/, {
      functions: { hm: '__hcSet' },
    });
  });

  test('a host function that writes the input that an alias reads', () => {
    let current: Input = {};
    (globalThis as Record<string, unknown>).__hcSetY = (t: number) => {
      current.y = (current.y as number) + 10;
      return t;
    };
    const options = { functions: { hm: '__hcSetY' } };
    const ce = engine();
    for (const json of [
      ['Add', ['hm', 1], ['grs', 1]],
      ['Add', ['grs', 1], ['hm', 1], ['grs', 2]],
      ['Add', ['hm', 1], 'sv'],
    ] as MathJsonExpression[]) {
      const expr = ce.box(json);
      const existing = compile(expr, { ...EXISTING, ...options } as never) as CompilationResult<'javascript'>;
      const profile = compile(expr, { ...PROFILE, ...options } as never) as CompilationResult<'javascript'>;
      expect(profile.success).toBe(true);
      current = { x: 1.5, y: 2 };
      const a = existing.run!(current as never);
      current = { x: 1.5, y: 2 };
      const b = profile.run!(current as never);
      expect(Object.is(a, b)).toBe(true);
    }
  });

  test('symbolDeps: the helpers, not the inputs', () => {
    const deps = new Set<string>();
    compile(engine().box(['gg', 'y']), { ...PROFILE, symbolDeps: deps } as never);
    expect([...deps].sort()).toEqual(['g', 'gg']);
  });

  test('the inputs of the result: a name that only a helper reads', () => {
    const ce = engine();
    const existing = compile(ce.box(['g', 2]), EXISTING as never) as CompilationResult<'javascript'>;
    const profile = compile(ce.box(['g', 2]), PROFILE as never) as CompilationResult<'javascript'>;
    expect(profile.freeSymbols).toEqual(existing.freeSymbols);
    expect(profile.freeSymbols).toEqual(['x']);
  });

  test('a name with no declared type takes the default kind', () => {
    const ce = engine();
    ce.assign('gu', ce.box(fn(['Multiply', 't', 'u'], 't')));
    const result = compile(ce.box(['gu', 'y']), PROFILE as never) as CompilationResult<'javascript'>;
    expect(result.run!({ y: 2, u: 3 } as never)).toBe(6);
    // The input, and the helper, whose parameter took the default kind.
    expect(result.defaultedSymbols).toEqual(['u', 'gu']);
  });

  test('the root Function: its parameters are its only inputs', () => {
    declines(
      fn(['g', 'y'], 'y'),
      /unsupported helper capture x: the helper g reads x, which is not a parameter of the helper, and the root of the program is a Function literal/
    );
    declines(fn(['g', 'x'], 'x'), /root of the program is a Function literal/);
  });

  test('recursion still declines', () => {
    const ce = engine();
    ce.assign('rr', ce.box(fn(['If', ['Less', 't', 0], 'x', ['rr', ['Subtract', 't', 1]]], 't')));
    let error: unknown;
    try {
      compile(ce.box(['rr', 'y']), PROFILE as never);
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toMatch(/calls itself/);
  });
});

describe('a helper that reads a captured expression', () => {
  test.each<[string, MathJsonExpression]>([
    ['one read', ['h', 'y']],
    ['a read in the root too', ['Add', ['h', 'y'], 'lv']],
    ['a helper that calls it, and reads it', ['h3', 'y']],
    ['a chain of values', ['hw', 'x']],
    ['an alias of an input', ['ha', 1]],
    ['two calls', ['Add', ['h', 1], ['h3', 2]]],
    ['in the body of a Sum', ['Sum', ['h', 'j'], ['Limits', 'j', 1, 3]]],
    ['in a lambda', ['Map', fn(['h', 'u'], 'u'), 'L']],
    ['in a root Block', ['Block', ['Declare', 'q', "'real'", ['h', 'y']], ['Add', 'q', 1]]],
  ])('%s', (_name, json) => {
    check(json);
  });

  // The value is computed alone, at the start of the root, outside every
  // binder, as the existing compiler computes `_val_lv` before the body.
  test.each<[string, MathJsonExpression]>([
    ['the index of a Sum', ['Sum', ['h', 'x'], ['Limits', 'x', 1, 3]]],
    ['a local of a root Block', ['Block', ['Declare', 'x', "'real'", 9], ['h', 'x']]],
    ['a parameter of a lambda', ['Map', fn(['h', 'x'], 'x'), 'L']],
  ])('a call under %s named like an input that the value reads', (_name, json) => {
    check(json);
  });

  // An alias of a captured expression (`sa := lv`) read by a helper: the
  // helper receives `lv` and reads it where its body reads `sa`.
  test.each<[string, MathJsonExpression]>([
    ['the alias in the root too', ['Add', 'sa', ['hsa', 2]]],
    ['the expression in the root', ['Add', 'lv', ['hsa', 2]]],
    ['an argument that is an input', ['Add', 'sa', ['hsa', 'y']]],
    ['with a helper that reads the expression', ['Add', ['h', 1], ['hsa', 2]]],
    ['an alias of an alias', ['hsb', 3]],
    ['an alias of an alias, in the root too', ['Add', ['hsb', 3], 'sb']],
  ])('an alias of a captured expression: %s', (_name, json) => {
    check(json);
  });

  // A value with one use is computed at the start of the root, as the
  // existing compiler computes `_val_lv` before the body, not at its use:
  // there its read of `_.x` would come after the read of `_.y`.
  test('a value with one use is computed before the body', () => {
    expect(check(['h', 'y'])).toBe(
      'function _tv1(_tv2, _tv3) { return _tv3 * _tv2; }\n' +
        '(() => { const _tv4 = _.x + 1; return _tv1(_.y, _tv4); })()'
    );
    expect(check(['Multiply', 'y', ['Sin', 'lv']])).toBe(
      '(() => { const _tv1 = _.x + 1; return _.y * Math.sin(_tv1); })()'
    );
  });

  test.each<[string, MathJsonExpression]>([
    ['a helper', ['h', 'y']],
    ['a helper that calls it', ['h3', 'y']],
    ['an alias in a helper', ['hsa', 'y']],
    ['the root, after a read of an input', ['Multiply', 'y', ['Sin', 'lv']]],
    ['the root, two values', ['Add', 'y', 'lw']],
  ])('the order of the reads of the inputs object: %s', (_name, json) => {
    const expr = engine().box(json);
    const order = (options: object): string[] => {
      const result = compile(expr, options as never) as CompilationResult<'javascript'>;
      const reads: string[] = [];
      // The reads of the compiled code: the check of the arguments
      // (`checkEntry()`) reads them in an order of its own, before the code.
      const record = (name: string, value: number) => () => {
        if (!new Error().stack!.includes('checkEntry')) reads.push(name);
        return value;
      };
      const inputs = {};
      for (const [name, value] of [['x', 1.5], ['y', 2.5], ['k', 1]] as const)
        Object.defineProperty(inputs, name, { get: record(name, value), enumerable: true });
      reads.push(String(result.run!(inputs as never)));
      return reads;
    };
    expect(order(PROFILE)).toEqual(order(EXISTING));
  });

  test('the value is computed once and passed to the helper', () => {
    expect(check(['Add', ['h', 1], ['h3', 2]])).toBe(
      'function _tv1(_tv3, _tv4) { return _tv4 * _tv3; }\n' +
        'function _tv2(_tv5, _tv6) { return _tv6 + _tv1(_tv5, _tv6); }\n' +
        '(() => { const _tv7 = _.x + 1; return _tv2(2, _tv7) + _tv1(1, _tv7); })()'
    );
  });

  test('a host function that writes the inputs object: the value of the start of the call', () => {
    let current: Input = {};
    (globalThis as Record<string, unknown>).__hcSet2 = (t: number) => {
      current.x = (current.x as number) + 10;
      return t;
    };
    const options = { functions: { hm: '__hcSet2' } };
    const ce = engine();
    for (const json of [
      ['Add', ['hm', 1], ['h', 2]],
      ['Add', ['h', 2], ['hm', 1], ['h3', 3]],
    ] as MathJsonExpression[]) {
      const expr = ce.box(json);
      const existing = compile(expr, { ...EXISTING, ...options } as never) as CompilationResult<'javascript'>;
      const profile = compile(expr, { ...PROFILE, ...options } as never) as CompilationResult<'javascript'>;
      current = { x: 1.5, y: 2 };
      const a = existing.run!(current as never);
      current = { x: 1.5, y: 2 };
      const b = profile.run!(current as never);
      expect(Object.is(a, b)).toBe(true);
    }
  });

  test('symbolDeps: the helpers and every value they read', () => {
    const existing = new Set<string>();
    const profile = new Set<string>();
    const ce = engine();
    compile(ce.box(['hw', 'x']), { ...EXISTING, symbolDeps: existing } as never);
    compile(ce.box(['hw', 'x']), { ...PROFILE, symbolDeps: profile } as never);
    expect([...profile].sort()).toEqual([...existing].sort());
    expect([...profile].sort()).toEqual(['hw', 'lv', 'lw']);
  });

  test.each<[string, MathJsonExpression, RegExp]>([
    ['a function operand', ['Map', 'h', 'L'], /the function operand h reads the value of lv/],
    ['a binder of the name at a call', ['Sum', ['h', 'lv'], ['Limits', 'lv', 1, 3]], /the program binds the name lv/],
    ['the root Function', fn(['h', 'y'], 'y'), /unsupported helper capture lv: its value x \+ 1 is an expression/],
    [
      'a local function that calls the helper',
      ['Block', ['Declare', 'lf', "'function'", fn(['h', 'u'], 'u')], ['lf', 2]],
      /the local function lf reads the value of lv/,
    ],
  ])('declines: %s', (_name, json, message) => {
    declines(json, message);
  });

  test('declines: a parameter of the helper named like the value it passes on', () => {
    const ce = engine();
    ce.assign('hp', ce.box(fn(['Add', ['h', 1], 'lv'], 'lv')));
    let error: unknown;
    try {
      compile(ce.box(['hp', 'y']), PROFILE as never);
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toMatch(/the helper hp reads the value of lv.*a parameter or a local of the helper/);
  });
});

// A user function whose parameters are scalars, called with a list, is one
// call per element (`FragmentDefinition.mapsListArguments`).
describe('a capturing helper applied to each element of a list', () => {
  test.each<[string, MathJsonExpression, Mode[]?]>([
    ['a helper that reads an input', ['g', 'L']],
    ['a helper with a declared signature, in both modes', ['gs', 'L'], ['strict', 'complex']],
    ['a helper that reads a captured expression', ['h', 'L']],
    ['a helper that calls one that reads a captured expression', ['h3', 'L']],
    ['both, in a sum of lists', ['Add', ['g', 'L'], ['h', 'L']]],
    ['in a Sum whose body is a list', ['Sum', ['Multiply', ['g', 'L'], 'j'], ['Limits', 'j', 1, 3]]],
    ['a captured expression in a Sum whose body is a list', ['Sum', ['Multiply', ['h', 'L'], 'j'], ['Limits', 'j', 1, 3]]],
    ['a helper whose value is a list', ['glist', 'y']],
    ['a helper whose value is a list, applied to each element', ['glist', 'L']],
  ])('%s', (_name, json, ...rest) => {
    const modes = rest[0] as Mode[] | undefined;
    check(json, modes === undefined ? {} : { modes });
  });

  test('a host function that writes the inputs object between the elements', () => {
    const log: string[] = [];
    let current: Input = {};
    (globalThis as Record<string, unknown>).__hcSet3 = (t: number) => {
      log.push(`set(${t})`);
      current.x = (current.x as number) + 10;
      return t;
    };
    const options = { functions: { hm: '__hcSet3' } };
    const ce = engine();
    for (const json of [
      ['gm', 'L'],
      ['Add', ['g', 'L'], ['gm', 'L']],
      ['Add', ['gm', 'L'], ['h', 'L']],
    ] as MathJsonExpression[]) {
      const expr = ce.box(json);
      const existing = compile(expr, { ...EXISTING, ...options } as never) as CompilationResult<'javascript'>;
      const profile = compile(expr, { ...PROFILE, ...options } as never) as CompilationResult<'javascript'>;
      expect(profile.success).toBe(true);
      for (const L of [[1, 2, 3], [], [-0]]) {
        current = { x: 1.5, y: 2.5, L };
        log.length = 0;
        const a = outcome(() => existing.run!(current as never));
        const logA = [...log];
        current = { x: 1.5, y: 2.5, L };
        log.length = 0;
        const b = outcome(() => profile.run!(current as never));
        expect([b, log]).toEqual([a, logA]);
        expect(same(a, b)).toBe(true);
      }
    }
  });
});

describe('the verifier: the inputs that a function reads', () => {
  /** `f(p) = p + x`, called by the root with `y`: the function reads the
   *  input `x`. `listed`: the inputs that the function lists. */
  function made(listed: readonly number[] | undefined, reads = true) {
    const ce = new ComputeEngine();
    const origin = ce.expr('x');
    const owner = {};
    let next = 0;
    const value = (): IRValue => ({ owner, revision: 1, id: next++, type: 'real', representation: 'number' });
    const region = (operations: IROperation[], effect: EffectFact = 'pure'): IRRegion => ({ operations, effect });
    const p = value();
    const x = value();
    const sum = value();
    const fnOps: IROperation[] = reads
      ? [
          { kind: 'input', input: 0, result: x, operands: [], effect: 'pure', origin },
          { kind: 'add', result: sum, operands: [p, x], effect: 'pure', origin },
          { kind: 'yield', operands: [sum], effect: 'pure', origin },
        ]
      : [{ kind: 'yield', operands: [p], effect: 'pure', origin }];
    const y = value();
    const called = value();
    const rootOps: IROperation[] = [
      { kind: 'input', input: 1, result: y, operands: [], effect: 'pure', origin },
      { kind: 'call', function: 0, result: called, operands: [y], effect: 'pure', origin },
      { kind: 'yield', operands: [called], effect: 'pure', origin },
    ];
    const program: IRProgram = {
      owner,
      revision: 1,
      inputs: [
        { name: 'x', type: 'real', representation: 'number' },
        { name: 'y', type: 'real', representation: 'number' },
      ],
      numericPolicy: 'strict',
      captures: [],
      functions: [
        {
          name: 'f',
          parameters: [p],
          result: { type: 'real', representation: 'number' },
          body: region(fnOps),
          ...(listed === undefined ? {} : { inputs: listed }),
          origin,
        },
      ],
      root: region(rootOps),
    };
    return { program, prepared: new Set([origin]) };
  }

  test('a function that lists the input it reads verifies', () => {
    const m = made([0]);
    expect(() => verifyJavaScriptProgram(m.program, m.prepared)).not.toThrow();
  });

  test.each<[string, readonly number[] | undefined, boolean, RegExp]>([
    ['a read of an input that the function does not list', undefined, true, /the body of a function reads the input 0, which the function does not list/],
    ['a read of another input than the one listed', [1], true, /reads the input 0, which the function does not list/],
    ['a listed input that the body does not read', [0], false, /the function f lists an input that its body does not read/],
    ['an empty list', [], false, /the function f lists no input/],
    ['an index that is not an input', [0, 5], true, /are not inputs of the program in increasing order/],
    ['a list that is not in increasing order', [1, 0], true, /are not inputs of the program in increasing order/],
  ])('%s', (_name, listed, reads, message) => {
    const m = made(listed, reads);
    expect(() => verifyJavaScriptProgram(m.program, m.prepared)).toThrow(message);
  });
});
