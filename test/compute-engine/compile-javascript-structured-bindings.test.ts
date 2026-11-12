import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// The bindings of the structured route of the JavaScript compiler (the
// `numeric-kernel` profile) that a census assigned to the numeric kernel:
// a name whose value is an expression of the inputs, a captured list of
// lists, a captured complex number, and an input of a union of a number and
// a list (which keeps its decline). For each admitted program the profile
// gives the doubles and the shape of the existing compiler with
// `cse: false, constantFold: false`, compared with `Object.is` at every
// depth, on two calls, the same `symbolDeps`, and the value of the
// interpreter; every other program declines with a message that names its
// cause.

const EXISTING = { cse: false, constantFold: false, fallback: false } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;

type Mode = 'strict' | 'complex';
type Input = Record<string, number>;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('k', 'integer');
  ce.declare('L', 'list<real>');
  ce.declare('M', 'list<list<real>>');
  // Values that are expressions of the inputs.
  ce.assign('lv', ce.box(['Add', 'x', 1]));
  ce.assign('a', ce.box(['Multiply', 'x', 'y']));
  ce.assign('b', ce.box(['Add', ['Multiply', 2, 'a'], ['Sin', 'x']]));
  ce.assign('ls', ce.box(['List', 'x', ['Add', 'x', 1], ['Multiply', 'y', 3]]));
  ce.assign('sv', ce.box('y'));
  // Captured lists of lists and a captured list.
  ce.assign('rows', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
  ce.assign('rag', ce.box(['List', ['List', 1.5, -2], ['List', 3]]));
  ce.declare('CM', { type: 'matrix<real^(2x2)>', value: ['List', ['List', 1.5, 2], ['List', 0.25, -4]] } as never);
  ce.assign('CL', ce.box(['List', 1.5, 2.5]));
  // Captured complex numbers.
  ce.assign('z0', ce.box(['Complex', -0.524, -0.566]));
  ce.assign('zi', ce.box(['Complex', 0, 2]));
  return ce;
}

const INPUTS: Input[] = [
  { x: 1.5, y: 2.5, k: 1 },
  { x: -0.75, y: 0, k: 2 },
  { x: 0, y: -1e-20, k: -1 },
  { x: -0, y: 7, k: 0 },
  { x: 1e-20, y: -3.5, k: 3 },
  { x: Number.NaN, y: 1, k: 2 },
];

/** The same double (`0` and `-0` differ, two `NaN` are equal) at every
 *  depth of an array or of the parts of a complex value, the same boolean,
 *  or the same message of a throw. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null)
    return same((a as { re: number }).re, (b as { re: number }).re) && same((a as { im: number }).im, (b as { im: number }).im);
  return a === b;
}

/** A deep copy of a value of compiled code, for a comparison after the
 *  host wrote into it. */
function copy(v: unknown): unknown {
  return Array.isArray(v) ? v.map(copy) : typeof v === 'object' && v !== null ? { ...v } : v;
}

function outcome(f: () => unknown): unknown {
  try {
    return copy(f());
  } catch (e) {
    return `throws ${(e as Error).message}`;
  }
}

/** Write into every array of `value`, at every depth. */
function scribble(value: unknown): void {
  if (!Array.isArray(value)) return;
  for (let i = 0; i < value.length; i++) {
    scribble(value[i]);
    if (!Array.isArray(value[i])) value[i] = 12345;
  }
  value.push(54321);
}

function run(result: CompilationResult<'javascript'>, input: Input | unknown[]): unknown {
  return Array.isArray(input)
    ? (result.run as unknown as (...a: unknown[]) => unknown)(...input)
    : result.run!(input as never);
}

/** `json` with each symbol whose value is an expression replaced by that
 *  value, at any depth: the program that the interpreter evaluates with the
 *  inputs as the parameters of a function. */
function inlined(ce: ComputeEngine, json: MathJsonExpression, depth = 0): MathJsonExpression {
  if (depth > 20) throw new Error('inlined: too deep');
  if (typeof json === 'string' && !json.startsWith("'")) {
    const value = ce._getSymbolValue(json);
    const constant =
      value !== undefined &&
      (value.isNumberLiteral || (value.operator === 'List' && value.ops!.every((op) => op.isNumberLiteral || (op.operator === 'List' && op.ops!.every((c) => c.isNumberLiteral)))));
    if (value !== undefined && !constant) return inlined(ce, value.json, depth + 1);
    return json;
  }
  if (Array.isArray(json)) return json.map((op, i) => (i === 0 ? op : inlined(ce, op as MathJsonExpression, depth))) as MathJsonExpression;
  return json;
}

/** The value of the interpreter: a number, a boolean, the parts of a
 *  complex number, or the numbers of a list (of lists). */
function interpret(ce: ComputeEngine, json: MathJsonExpression, input: Input): unknown {
  const value = ce
    .function('Apply', [
      ce.box(['Function', inlined(ce, json), ...Object.keys(input)]),
      ...Object.values(input).map((v) => ce.number(v)),
    ])
    .evaluate();
  const unbox = (v: Expression): unknown => {
    if (v.symbol === 'True') return true;
    if (v.symbol === 'False') return false;
    if (v.isCollection) return [...(v as Expression & { each(): Generator<Expression> }).each()].map((e) => unbox(e.evaluate()));
    const n = v.N();
    return n.im === 0 ? n.re : { re: n.re, im: n.im };
  };
  return unbox(value);
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
  if (typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.every(finite);
  if (typeof v === 'object' && v !== null) return finite((v as { re: number }).re) && finite((v as { im: number }).im);
  return false;
}

/** The stored values of the bindings of `names`, as text. */
function storedValues(ce: ComputeEngine, names: readonly string[]): string[] {
  return names.map((n) => JSON.stringify(ce._getSymbolValue(n)?.json));
}

const BINDINGS = ['lv', 'a', 'b', 'ls', 'sv', 'rows', 'rag', 'CM', 'CL', 'z0', 'zi'];

/**
 * Compile `json` on both routes in each mode, with `symbolDeps`, and
 * compare the values at each input on two calls, the dependencies, and the
 * value of the interpreter where it is finite. After the first call the
 * host writes into every array of the value; the second call gives the same
 * values, and the stored values of the engine are unchanged. Returns the
 * code of the profile in the first mode.
 */
function check(
  json: MathJsonExpression,
  options: {
    inputs?: (Input | unknown[])[];
    modes?: readonly Mode[];
    interpreter?: boolean;
    ce?: ComputeEngine;
    /** `superset`: the dependencies of the profile hold those of the
     *  existing compiler. */
    deps?: 'equal' | 'superset';
  } = {}
): string {
  const ce = options.ce ?? engine();
  const expr = ce.box(json);
  const before = storedValues(ce, BINDINGS);
  let code = '';
  for (const mode of options.modes ?? (['strict', 'complex'] as const)) {
    const existingDeps = new Set<string>();
    const profileDeps = new Set<string>();
    const existing = compile(expr, { ...EXISTING, mode, symbolDeps: existingDeps } as never) as CompilationResult<'javascript'>;
    const profile = compile(expr, { ...PROFILE, mode, symbolDeps: profileDeps } as never) as CompilationResult<'javascript'>;
    expect(profile.success).toBe(true);
    if (code === '') code = profile.code;
    if (options.deps === 'superset') expect([...existingDeps].filter((n) => !profileDeps.has(n))).toEqual([]);
    else expect([...profileDeps].sort()).toEqual([...existingDeps].sort());
    for (const input of options.inputs ?? INPUTS) {
      const first = outcome(() => run(existing, input));
      const value = (() => {
        try {
          return run(profile, input);
        } catch (e) {
          return `throws ${(e as Error).message}`;
        }
      })();
      const got = copy(value);
      if (!same(first, got))
        throw new Error(`${mode} ${JSON.stringify(input)}: existing ${JSON.stringify(first)}, profile ${JSON.stringify(got)}`);
      scribble(value);
      const again = outcome(() => run(profile, input));
      if (!same(got, again))
        throw new Error(`${mode} second call ${JSON.stringify(input)}: ${JSON.stringify(got)}, then ${JSON.stringify(again)}`);
      if (options.interpreter !== false && !Array.isArray(input) && finite(got)) {
        const i = interpret(ce, json, input);
        if (!close(got, i)) throw new Error(`${mode} ${JSON.stringify(input)}: profile ${JSON.stringify(got)}, interpreter ${JSON.stringify(i)}`);
      }
    }
  }
  expect(storedValues(ce, BINDINGS)).toEqual(before);
  return code;
}

/** The profile declines `json` in each mode of `modes` with `message`. */
function declines(json: MathJsonExpression, message: RegExp, ce = engine(), modes: readonly Mode[] = ['strict', 'complex']): void {
  const expr = ce.box(json);
  for (const mode of modes) {
    let error: unknown;
    try {
      compile(expr, { ...PROFILE, mode } as never);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as { diagnostic?: { code?: string } }).diagnostic?.code).toBe('outside-profile');
    expect((error as Error).message).toMatch(message);
  }
}

describe('a value that is an expression of the inputs', () => {
  test.each<[string, MathJsonExpression, Mode[]?, boolean?]>([
    ['one read', ['Multiply', 2, 'lv']],
    ['two reads', ['Add', ['Multiply', 2, 'lv'], ['Sin', 'lv']]],
    ['a chain of values', ['Add', 'b', 'a']],
    ['a value that is a symbol', ['Add', 'sv', 1]],
    ['a list value', ['Multiply', 2, 'ls']],
    ['a list value as the value of the program', 'ls'],
    ['an element of a list value', ['Add', ['At', 'ls', 'k'], 'lv']],
    ['in a branch', ['If', ['Greater', 'x', 0.5], 'lv', ['Negate', 'lv']]],
    ['in the body of a Sum', ['Sum', ['Multiply', 'lv', 'j'], ['Limits', 'j', 1, 5]]],
    ['in the body of a Sum of more terms than it unrolls', ['Sum', ['Multiply', 'lv', 'j'], ['Limits', 'j', 1, 200]]],
    ['in the function of a Map', ['Map', ['Function', ['Add', 't', 'lv'], 't'], ['List', 1, 2, 3]], ['strict'], false],
    ['with a complex operand', ['Add', 'lv', ['Sqrt', 'x']], ['complex']],
  ])('%s', (_name, json, ...rest) => {
    const modes = rest[0] as Mode[] | undefined;
    // The interpreter gives the lazy list of `Map` as unevaluated elements
    // here; the values are compared with the existing compiler.
    check(json, { ...(modes === undefined ? {} : { modes }), interpreter: rest[1] !== false });
  });

  test('the code computes the value once: one sum for two reads', () => {
    const code = check(['Add', ['Multiply', 2, 'lv'], ['Sin', 'lv']]);
    expect(code).toBe('(() => { const _tv1 = _.x + 1; return 2 * _tv1 + Math.sin(_tv1); })()');
    expect(check(['Add', 'b', 'a'], { modes: ['strict'] }).match(/_\.x \* _\.y/g)).toHaveLength(1);
  });

  test('in a root Block and in a root Function', () => {
    check(['Block', ['Declare', 't', "'real'", ['Multiply', 2, 'y']], ['Add', 't', 'lv']]);
    // A root `Function` whose value reads no name of the engine but its
    // own values.
    const ce = engine();
    ce.assign('cv', ce.box(['Sqrt', 2]));
    check(['Function', ['Add', 't', 'cv'], ['Typed', 't', "'real'"]], { ce, inputs: [[1], [-0], [2.5]], interpreter: false });
  });

  test('a value that calls a user function', () => {
    const ce = engine();
    ce.assign('sq', ce.box(['Function', ['Multiply', 't', 't'], 't']));
    ce.assign('qv', ce.box(['Add', ['sq', 'x'], 1]));
    check(['Multiply', 'qv', 'y'], { ce, modes: ['strict'] });
  });

  test('in another angular unit, the value is rewritten as the existing compiler rewrites it', () => {
    const ce = engine();
    ce.angularUnit = 'deg';
    ce.assign('c', ce.box(['Sin', 'x']));
    const code = check(['Add', 'c', ['Cos', 'x']], { ce });
    expect(code).toBe('Math.sin(0.017453292519943295 * _.x) + Math.cos(0.017453292519943295 * _.x)');
  });

  test('a new value is read by a new compilation; the code keeps the value it read', () => {
    const ce = engine();
    const expr = ce.box(['Multiply', 2, 'lv']);
    const first = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    ce.assign('lv', ce.box(['Add', 'x', 2]));
    const second = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    expect(first.run!({ x: 1 } as never)).toBe(4);
    expect(second.run!({ x: 1 } as never)).toBe(6);
    check(['Multiply', 2, 'lv'], { ce });
  });

  test('symbolDeps: the name and each name whose value it reads', () => {
    const deps = new Set<string>();
    compile(engine().box(['Add', 'b', 1]), { ...PROFILE, symbolDeps: deps } as never);
    expect([...deps].sort()).toEqual(['a', 'b']);
  });

  // A binder of the name of the value shadows the value: the binder is read.
  test.each<[string, MathJsonExpression, (Input | unknown[])[]?, Mode[]?]>([
    ['a parameter of the root Function', ['Function', ['Add', 'lv', 1], ['Typed', 'lv', "'real'"]], [[1], [-0], [2.5]]],
    ['a parameter of a lambda', ['Map', ['Function', ['Add', 'lv', 1], 'lv'], 'L'], [{ L: [1, -0, 2.5] } as never], ['strict']],
    ['the index of a Sum', ['Sum', ['Multiply', 'lv', 'x'], ['Limits', 'lv', 1, 3]]],
    ['a local of a block', ['Block', ['Declare', 'lv', "'real'", ['Multiply', 3, 'y']], ['Add', 'lv', 1]]],
    ['the variable of an integral', ['Integrate', ['Multiply', 'lv', 'x'], ['Limits', 'lv', 0, 1]], undefined, ['strict']],
    [
      'the index of a Loop',
      ['Function', ['Block', ['Declare', 's', "'real'", 0], ['Loop', ['Assign', 's', ['Add', 's', 'lv']], ['Element', 'lv', ['Range', 1, 3]]], 's'], ['Typed', 'y', "'real'"]],
      [[1], [2]],
    ],
  ])('%s', (_name, json, ...rest) => {
    const inputs = rest[0] as (Input | unknown[])[] | undefined;
    const modes = rest[1] as Mode[] | undefined;
    const code = check(json, {
      ...(inputs === undefined ? {} : { inputs }),
      ...(modes === undefined ? {} : { modes }),
      // The interpreter is not asked: `inlined()` does not know binders.
      interpreter: false,
      // The profile records the name of the variable of the integral, which
      // the code does not read (`calculusDependencies()` follows the names of
      // the integrand); a dependency more is harmless.
      deps: 'superset',
    });
    expect(code).not.toMatch(/_\.x \+ 1/);
  });

  test('a parameter of a helper', () => {
    const ce = engine();
    ce.assign('hp', ce.box(['Function', ['Multiply', 'lv', 2], 'lv']));
    const code = check(['hp', 'y'], { ce, modes: ['strict'] });
    expect(code).not.toMatch(/_\.x/);
  });

  // A binder of a name that the value reads, where the value is read: the
  // existing compiler refuses it, or reads the name of the engine where the
  // profile would read the binder.
  test.each<[string, MathJsonExpression, RegExp]>([
    ['the index of a Sum', ['Sum', ['Multiply', 'lv', 'x'], ['Limits', 'x', 1, 3]], /the value assigned to this symbol mentions `x`, which a parameter or index binds/],
    ['a parameter of the root Function', ['Function', ['Add', 'lv', 'x'], ['Typed', 'x', "'real'"]], /the value assigned to this symbol mentions `x`, which a parameter or index binds/],
    ['a parameter of a lambda', ['Map', ['Function', ['Add', 'lv', 'x'], 'x'], 'L'], /the value assigned to this symbol mentions `x`, which a parameter or index binds/],
    ['a local of a block', ['Block', ['Declare', 'x', "'real'", 3], ['Add', 'lv', 1]], /unsupported capture x|mentions `x`/],
  ])('a binder of a name of the value declines: %s', (_name, json, message) => {
    declines(json, message, engine(), ['strict']);
  });

  test('a read in the body of a helper declines', () => {
    const ce = engine();
    ce.assign('hf', ce.box(['Function', ['Add', 't', 'lv'], 't']));
    declines(['hf', 'y'], /unsupported helper capture lv: its value x \+ 1 is an expression/, ce, ['strict']);
  });

  test('a value that reads a free name in a root Function declines', () => {
    declines(['Function', ['Add', 't', 'lv'], ['Typed', 't', "'real'"]], /unsupported capture x/);
  });

  test('an impure value declines', () => {
    const ce = engine();
    ce.assign('r', ce.box(['Add', 2, ['Random']]));
    declines(['Add', 'r', 'r'], /unsupported binding r: its value 2 \+ Random\(\) is not pure/, ce);
    // The existing compiler draws at each read.
    expect(compile(ce.box(['Add', 'r', 'r']), EXISTING as never).code).toBe(
      '(2 + _SYS.drawNextRandomNumber()) + (2 + _SYS.drawNextRandomNumber())'
    );
  });

  test('a cycle of values declines', () => {
    const ce = engine();
    ce.assign('c1', ce.box(['Add', 'c2', 1]));
    ce.assign('c2', ce.box(['Add', 'c1', 1]));
    declines(['Add', 'c1', 'x'], /refers to `c1`|refers to `c2`/, ce);
    expect(() => compile(ce.box(['Add', 'c1', 'x']), EXISTING as never)).toThrow();
  });

  test('a value that reads a name of the host declines', () => {
    const ce = engine();
    const vars = { vars: { x: 'next()' }, preamble: 'let n = 0; const next = () => ++n;' };
    let error: unknown;
    try {
      compile(ce.box(['Add', 'lv', 'y']), { ...PROFILE, ...vars } as never);
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toMatch(/reads x, a name of the host/);
    // A function of the host in the value.
    ce.assign('hv', ce.box(['Add', ['g', 'x'], 1]));
    expect(() => compile(ce.box(['Add', 'hv', 'y']), { ...PROFILE, functions: { g: 'Math.abs' } } as never)).toThrow(
      /the value of hv \(.*\) reads g, a name of the host|unsupported binding hv: its value g\(x\) \+ 1 is not pure/
    );
  });

  test('a value whose operations can throw declines', () => {
    const ce = engine();
    ce.assign('mv', ce.box(['Mod', 'k', 'y']));
    declines(['Add', 'mv', 'x'], /the value of mv \(.*\) has an operation that can throw, abort or read the host/, ce, ['strict']);
  });

  // The existing compiler computes `_val_lv` before the body; a function of
  // the host that changes the inputs object before the read does not change
  // the value. `__bindingsSet` sets `x` to 9 and returns 5.
  test('the value is computed before a call of the host that changes the inputs', () => {
    const host = globalThis as unknown as Record<string, unknown>;
    let current: Input = {};
    host.__bindingsSet = () => {
      current.x = 9;
      return 5;
    };
    host.__bindingsH = (a: number, b: number) => 100 * a + b;
    const ce = engine();
    ce.declare('g', '(real) -> real');
    ce.declare('h', '(real, real) -> real');
    const options = { functions: { g: '__bindingsSet', h: '__bindingsH' } };
    for (const [json, expected] of [
      [['h', ['g', 'x'], 'lv'], 505],
      [['h', 'lv', ['g', 'x']], 505],
      [['Add', ['g', 'x'], 'lv'], 10],
      [['If', ['Less', ['g', 'x'], 6], ['Multiply', 2, 'lv'], 0], 10],
    ] as [MathJsonExpression, number][]) {
      const expr = ce.box(json);
      for (const route of [EXISTING, PROFILE]) {
        const result = compile(expr, { ...route, ...options } as never) as CompilationResult<'javascript'>;
        current = { x: 4 };
        expect(result.run!(current)).toBe(expected);
      }
    }
  });

  // A bare integrand is a name that the `Integrate` scope binds with no
  // value; the existing compiler reads the value of the engine there.
  // A value that is a name is written at each read, as the existing
  // compiler writes it (it binds only applications before the body):
  // `__aliasSet` sets `y` to 9 and returns 5.
  test('a value that is a name is read where it is read, after a call of the host', () => {
    const host = globalThis as unknown as Record<string, unknown>;
    let current: Input = {};
    host.__aliasSet = () => {
      current.y = 9;
      return 5;
    };
    host.__aliasH = (a: number, b: number) => 100 * a + b;
    const ce = engine();
    ce.declare('g', '(real) -> real');
    ce.declare('h', '(real, real) -> real');
    ce.assign('s2', ce.box('sv'));
    ce.assign('lw', ce.box(['Add', 'sv', 1]));
    const options = { functions: { g: '__aliasSet', h: '__aliasH' } };
    for (const [json, expected] of [
      [['h', ['g', 'x'], 'sv'], 509],
      [['h', 'sv', ['g', 'x']], 405],
      // An alias of an alias.
      [['h', ['g', 'x'], 's2'], 509],
      // An expression that reads an alias is computed before the body.
      [['h', ['g', 'x'], 'lw'], 505],
    ] as [MathJsonExpression, number][]) {
      const expr = ce.box(json);
      for (const route of [EXISTING, PROFILE]) {
        const result = compile(expr, { ...route, ...options } as never) as CompilationResult<'javascript'>;
        current = { x: 1, y: 4 };
        expect(result.run!(current)).toBe(expected);
      }
    }
  });

  test('an alias read where a form binds the name it reads declines', () => {
    declines(['Sum', ['Multiply', 'sv', 'y'], ['Limits', 'y', 1, 3]], /the value assigned to this symbol mentions `y`, which a parameter or index binds/, engine(), ['strict']);
  });

  test('a bare integrand that the scope of the integral binds declines with its cause', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    ce.declare('x', 'real');
    ce.declare('k', 'real');
    ce.assign('k', ce.box(['Sin', 30]));
    expect(() => compile(ce.parse('\\int_0^x k\\,dt'), PROFILE as never)).toThrow(
      /unsupported binding k: the name is read where a scope around it binds it with no value and the type unknown, and the existing compiler reads the value sin\(30\) of the engine there/
    );
  });
});

describe('a captured list of lists', () => {
  test.each<[string, MathJsonExpression]>([
    ['the list of lists', 'rows'],
    ['an element', ['Multiply', 'x', ['At', 'rows', 1, 2]]],
    ['an element of a ragged list', ['Multiply', 'x', ['At', 'rag', 2, 1]]],
    ['an element of a declared matrix', ['Add', 'x', ['At', 'CM', 'k', 2]]],
    ['a row', ['At', 'rows', 2]],
    ['a row at an index of the input', ['At', 'rows', 'k']],
    ['the length', ['Add', ['Length', 'rows'], 'x']],
    ['element-wise arithmetic', ['Multiply', 'x', 'rows']],
    ['a list of rows', ['List', ['At', 'rows', 1], ['At', 'rag', 1]]],
    ['a captured list as a row', ['List', 'CL', 'CL']],
    ['a comprehension of a captured list', ['Comprehension', 'CL', ['Element', 'j', ['Range', 1, 2]]]],
  ])('%s', (_name, json) => {
    check(json, { modes: ['strict'] });
  });

  test('a row of the input replaced by a captured list', () => {
    check(['ReplaceAt', 'M', 1, 'CL'], {
      modes: ['strict'],
      inputs: [{ M: [[1, 2], [3, 4]] } as never, { M: [[-0]] } as never],
      interpreter: false,
    });
  });

  test('the value of the program is copied to the depth that can hold the constant', () => {
    expect(check('rows', { modes: ['strict'] })).toMatch(/^_tv1\?\.map\(\(_r\) => _r\?\.slice\(\)\)$/);
    expect(check(['At', 'rows', 2], { modes: ['strict'] })).toMatch(/\?\.slice\(\)$/);
    // A new list of new rows is not copied.
    expect(check(['Multiply', 'x', 'rows'], { modes: ['strict'] })).not.toMatch(/slice/);
  });

  test('an update of a cell of a row in a loop: one copy of two levels, the constant unchanged', () => {
    const json: MathJsonExpression = [
      'Function',
      [
        'Block',
        ['Declare', 'S', "'list<list<real>>'", 'rows'],
        ['Loop', ['Assign', 'S', ['ReplaceAt', 'S', 'j', 1, ['Multiply', 'j', 'p']]], ['Element', 'j', ['Range', 1, 2]]],
        'S',
      ],
      ['Typed', 'p', "'real'"],
    ];
    const code = check(json, { modes: ['strict'], inputs: [[2], [-0], [0.5]], interpreter: false });
    expect(code.match(/\.map\(\(_r\) => _r\?\.slice\(\)\)/g)).toHaveLength(1);
    expect(code).toContain('_SYS.replaceAtInPlace(');
  });

  // A value of rank 3 can hold the constant, or a row of it, at a depth that
  // a copy of two levels does not reach: the host would write into the
  // constant through the value, and the next call would read the write.
  test.each<[string, MathJsonExpression]>([
    ['a list of the list of lists', ['List', 'rows', 'rows']],
    ['a list of a list of a captured list', ['List', ['List', 'CL']]],
    ['a list of a list of a row', ['List', ['List', ['At', 'rows', 1]]]],
    ['a comprehension of the list of lists', ['Comprehension', 'rows', ['Element', 'j', ['Range', 1, 2]]]],
    ['the list of lists with an input', ['List', 'rows', 'M']],
    ['a local and its update', ['Block', ['Declare', 'T', "'unknown'", 'rows'], ['Declare', 'U', "'unknown'", ['ReplaceAt', 'T', 1, 1, 'x']], ['List', 'T', 'U']]],
    ['a call of a helper that returns the list of lists', ['List', ['hc']]],
    ['a list of one list of lists', ['List', 'rows']],
    ['a value of rank 4', ['List', ['List', 'rows']]],
  ])('a value of rank 3 that can hold a captured list declines: %s', (_name, json) => {
    const ce = engine();
    ce.declare('hc', '() -> list<list<real>>');
    ce.assign('hc', ce.box(['Function', 'rows']));
    declines(json, /the value of the program is a list of rank 3 or more, and the program reads a captured list/, ce, ['strict']);
  });

  test('a value of rank 2 that holds a captured list as a row is copied with two levels', () => {
    for (const json of [
      ['List', 'CL', 'CL'],
      ['List', ['At', 'rows', 1], 'CL'],
      'rows',
    ] as MathJsonExpression[])
      expect(check(json, { modes: ['strict'] })).toMatch(/\?\.map\(\(_r\) => _r\?\.slice\(\)\)$/);
  });

  test('a list of lists in the complex mode declines, as a list of lists does', () => {
    declines(['At', 'rows', 1, 2], /a list of lists, which is not in the profile in the `complex` mode/, engine(), ['complex']);
  });

  // A list of lists of lists and a list with an empty row are not constants
  // of the program: they are captured expressions, which the program
  // computes once per call (a list literal of list literals).
  test('a list of lists of lists and a list with an empty row', () => {
    const ce = engine();
    ce.assign('deep', ce.box(['List', ['List', ['List', 1]]]));
    ce.assign('er', ce.box(['List', ['List', 1], ['List']]));
    check(['Add', ['Length', 'deep'], 'x'], { ce, modes: ['strict'] });
    check(['Add', ['Length', 'er'], 'x'], { ce, modes: ['strict'] });
  });
});

describe('a captured complex number', () => {
  test.each<[string, MathJsonExpression]>([
    ['a sum', ['Add', 'x', 'z0']],
    ['a product', ['Multiply', 'x', 'z0']],
    ['a sum with a value of real part 0', ['Add', 'x', 'zi']],
    ['a product of two captures', ['Multiply', 'z0', 'zi']],
    ['in an iteration of the form of the Mandelbrot set', ['Add', ['Power', ['Add', ['Power', ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'y']], 2], 'z0'], 2], 'z0']],
  ])('%s', (_name, json) => {
    check(json, { modes: ['complex'] });
  });

  test('the code writes the object of the parts at each read, as the existing compiler', () => {
    expect(check(['Add', 'x', 'zi'], { modes: ['complex'] })).toBe('({ re: _.x + ({ re: 0, im: 2 }).re, im: ({ re: 0, im: 2 }).im })');
  });

  test('the strict mode', () => {
    check(['Add', 'x', 'z0'], { modes: ['strict'] });
  });

  test('a real value of a name declared complex declines', () => {
    const ce = engine();
    ce.declare('zf', 'complex');
    ce.assign('zf', 5);
    declines(['Add', ['Power', 'x', 2], ['Power', 'zf', 2]], /unsupported binding zf: its value 5 is a real number, and the name is declared complex/, ce);
  });

  // The existing compiler lifts a real value of a name declared `complex`
  // to the complex lane: `Sqrt(z)` with `z := x + 1` is `2i` at `x = -5`,
  // also in the `strict` mode.
  test('a real expression of a name declared complex declines', () => {
    for (const value of [['Add', 'x', 1], ['Add', 'k', 1]] as MathJsonExpression[]) {
      const ce = engine();
      ce.declare('zc', 'complex');
      ce.assign('zc', ce.box(value));
      expect(compile(ce.box(['Sqrt', 'zc']), EXISTING as never).run!({ x: -5, k: -5 })).toEqual({ re: 0, im: 2 });
      declines(['Sqrt', 'zc'], /unsupported binding zc: its value .* is not complex-valued, and the name is declared complex$/, ce);
    }
  });

  // The test is the one of the existing compiler (the name complex-valued,
  // the value not), not the engine type of the value: `x / y` has the type
  // `real | infinity | nan`. At `x = -4` the real lane gives `NaN`.
  test.each<[string, MathJsonExpression]>([
    ['a quotient', ['Divide', 'x', 'y']],
    ['a square root', ['Sqrt', 'x']],
    ['a logarithm', ['Ln', 'x']],
    ['a power', ['Power', 'x', 'y']],
    ['a conditional', ['If', ['Greater', 'y', 0], 'x', ['Divide', 1, 'x']]],
  ])('a value of a name declared complex declines: %s', (_name, value) => {
    const ce = engine();
    ce.declare('zc', 'complex');
    ce.assign('zc', ce.box(value));
    declines(['Sqrt', 'zc'], /unsupported binding zc: its value .* is not complex-valued, and the name is declared complex/, ce);
  });

  // A declaration `number` over a real value, and `real` or `number` over an
  // integer value, keep the lane of the value on both routes.
  test.each<[string, MathJsonExpression]>([
    ['number', ['Add', 'x', 1]],
    ['number', ['Add', 'k', 1]],
    ['real', ['Add', 'k', 1]],
  ])('a value of a name declared %s: %j', (declared, value) => {
    const ce = engine();
    ce.declare('zd', declared);
    ce.assign('zd', ce.box(value));
    const inputs = [{ x: -5, y: 0, k: -5 }, { x: 3, y: 0, k: 3 }];
    for (const json of [['Sqrt', 'zd'], ['Ln', 'zd'], ['Divide', 'zd', 2]] as MathJsonExpression[])
      check(json, { ce, inputs, interpreter: false });
  });

  test('a list with a complex element declines', () => {
    const ce = engine();
    ce.assign('LC', ce.box(['List', ['Complex', 1, 2], 3]));
    declines(['Add', ['At', 'LC', 2], 'x'], /a list literal with an element of the type `complex`|At\("LC", 2\) has the type complex/, ce);
  });
});

describe('an input of a union of a number and a list', () => {
  test.each<[string, string, MathJsonExpression]>([
    ['list<real> | real', 'u', ['Add', 'u', 1]],
    ['integer | vector<integer^2>', 'v', ['Multiply', 2, 'v']],
  ])('%s declines', (type, name, json) => {
    const ce = engine();
    ce.declare(name, type);
    // The existing compiler compiles one body per member, with one test of
    // the shape at the binding.
    expect(compile(ce.box(json), EXISTING as never).code).toMatch(new RegExp(`^\\(Array\\.isArray\\(_\\.${name}\\)`));
    declines(json, new RegExp(`unsupported binding ${name}: the input has the union type .*, which the profile does not dispatch on`), ce);
  });
});
