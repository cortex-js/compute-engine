import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';
import { _jsProfileStats } from '../../src/compute-engine/js-profile-switch';
import { CompilerState } from '../../src/compute-engine/compilation/compiler-state';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import {
  lowerStructuredFragment,
  preparedNodesOf,
} from '../../src/compute-engine/compilation/javascript-structured-lower';
import { verifyJavaScriptProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import { analyzeExecution } from '../../src/compute-engine/compilation/structured-execution';
import { inPlaceUpdates } from '../../src/compute-engine/compilation/structured-in-place';
import type { IROperation, IRProgram, IRRegion } from '../../src/compute-engine/compilation/structured-ir';

// Captured values, nodes that read no input, and unread parameters on the
// structured route of the JavaScript compiler (the `numeric-kernel`
// profile). For each admitted program the profile gives the doubles and the
// shape of the existing compiler with `cse: false, constantFold: false`,
// compared with `Object.is` at every depth, and the value of the
// interpreter; every other program declines with a message that names its
// cause.

const EXISTING = { cse: false, constantFold: false, fallback: false } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;

type Mode = 'strict' | 'complex';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('k', 'integer');
  ce.declare('L', { type: 'list<integer>', value: ['List', 10, 20, 30] } as never);
  ce.declare('R', { type: 'list<real>', value: ['List', 0.5, -1.25, 3] } as never);
  // A list with no declared type: its elements are exact (a rational, a
  // decimal, an integer beyond 2^53).
  ce.assign('E', ce.box(['List', ['Rational', 1, 3], 0.1, { num: '1152921504606846977' }]));
  ce.assign('third', ce.box(['Rational', 1, 3]));
  ce.assign('nearThird', ce.box(['Rational', 3333333333333333, 10 ** 16]));
  ce.assign('seven', ce.box(['Rational', 7, 10]));
  ce.assign('tenth', ce.box(['Rational', 1, 10]));
  ce.assign('big', ce.box({ num: '1152921504606846977' }));
  ce.declare('offset', 'real');
  ce.assign('offset', 2);
  return ce;
}

const INPUTS: Record<string, number>[] = [
  { x: 1.5, y: 2.5, k: 1 },
  { x: -0.75, y: 0, k: 3 },
  { x: 0, y: -1e-20, k: -1 },
  { x: -0, y: 7, k: 0 },
  { x: 1e-20, y: -3.5, k: 4 },
  { x: Number.NaN, y: 1, k: 2 },
];

/** The same double (`0` and `-0` differ, two `NaN` are equal) at every
 *  depth of an array, the same boolean, or the same message of a throw. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  return a === b;
}

function outcome(f: () => unknown): unknown {
  try {
    const v = f();
    return Array.isArray(v) ? [...v] : v;
  } catch (e) {
    return `throws ${(e as Error).message}`;
  }
}

function run(result: CompilationResult<'javascript'>, input: Record<string, number> | number[]): unknown {
  return Array.isArray(input)
    ? (result.run as unknown as (...a: unknown[]) => unknown)(...input)
    : result.run!(input as never);
}

/** The value of the interpreter: a number, a boolean, or the numbers of a
 *  list. */
function interpret(ce: ComputeEngine, expr: Expression, input: Record<string, number> | number[]): unknown {
  const value = Array.isArray(input)
    ? ce.function('Apply', [expr, ...input.map((v) => ce.number(v))]).evaluate()
    : ce
        .function('Apply', [
          ce.function('Function', [expr, ...Object.keys(input).map((n) => ce.symbol(n))]),
          ...Object.values(input).map((v) => ce.number(v)),
        ])
        .evaluate();
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  if (value.isCollection)
    return [...(value as Expression & { each(): Generator<Expression> }).each()].map((v) => v.evaluate().N().re);
  return value.N().re;
}

function close(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return Object.is(a, b) || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) || (Number.isNaN(a) && Number.isNaN(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => close(v, b[i]));
  return a === b;
}

/** Compile `json` on both routes in each mode, with `symbolDeps`, and
 *  compare the values at each input (twice: a second call gives the same
 *  values), the dependencies, and the value of the interpreter where it is
 *  finite. Returns the code of the profile in the first mode. */
function check(
  json: MathJsonExpression,
  options: {
    inputs?: (Record<string, number> | number[])[];
    modes?: readonly Mode[];
    interpreter?: boolean;
    ce?: ComputeEngine;
  } = {}
): string {
  const ce = options.ce ?? engine();
  const expr = ce.expr(json);
  const stored = (['L', 'R', 'E'] as const).map((n) => JSON.stringify(ce._getSymbolValue(n)?.json));
  let code = '';
  for (const mode of options.modes ?? (['strict', 'complex'] as const)) {
    const existingDeps = new Set<string>();
    const profileDeps = new Set<string>();
    const existing = compile(expr, { ...EXISTING, mode, symbolDeps: existingDeps } as never) as CompilationResult<'javascript'>;
    const profile = compile(expr, { ...PROFILE, mode, symbolDeps: profileDeps } as never) as CompilationResult<'javascript'>;
    expect(existing.success).toBe(true);
    expect(profile.success).toBe(true);
    expect([...profileDeps].sort()).toEqual([...existingDeps].sort());
    code ||= profile.code;
    for (const input of options.inputs ?? INPUTS)
      for (const call of [1, 2]) {
        const a = outcome(() => run(existing, input));
        const b = outcome(() => run(profile, input));
        if (!same(a, b))
          throw new Error(`${mode} call ${call} ${JSON.stringify(input)}: existing ${JSON.stringify(a)}, profile ${JSON.stringify(b)}`);
        if (options.interpreter !== false && call === 1 && (typeof b === 'boolean' || Array.isArray(b) || (typeof b === 'number' && Number.isFinite(b)))) {
          const i = interpret(ce, expr, input);
          if (!close(b, i)) throw new Error(`${mode} ${JSON.stringify(input)}: profile ${JSON.stringify(b)}, interpreter ${JSON.stringify(i)}`);
        }
      }
  }
  // The values of the captured bindings are as they were.
  expect((['L', 'R', 'E'] as const).map((n) => JSON.stringify(ce._getSymbolValue(n)?.json))).toEqual(stored);
  return code;
}

/** The profile declines `json` in each mode of `modes` with `message`. */
function declines(json: MathJsonExpression, message: RegExp, ce = engine(), modes: readonly Mode[] = ['strict', 'complex']): void {
  const expr = ce.expr(json);
  for (const mode of modes) expect(() => compile(expr, { ...PROFILE, mode } as never)).toThrow(message);
}

describe('a captured list', () => {
  test.each<[string, MathJsonExpression]>([
    ['At(L, k)', ['At', 'L', 'k']],
    ['At(L, -1) + x', ['Add', ['At', 'L', -1], 'x']],
    ['At(R, k) · x', ['Multiply', ['At', 'R', 'k'], 'x']],
    ['Length(L) + x', ['Add', ['Length', 'L'], 'x']],
    ['Sum(L)', ['Sum', 'L']],
    ['Max(R) - x', ['Add', ['Max', 'R'], ['Negate', 'x']]],
    ['Sum(E)', ['Sum', 'E']],
    ['E', 'E'],
    ['L', 'L'],
    ['x · L', ['Multiply', 'x', 'L']],
    ['Sum(At(L, j), j = 1..3) + x', ['Add', ['Sum', ['At', 'L', 'j'], ['Limits', 'j', 1, 3]], 'x']],
    ['At(L, 1) + At(L, k) + At(R, 2)', ['Add', ['At', 'L', 1], ['At', 'L', 'k'], ['At', 'R', 2]]],
  ])('%s', (_name, json) => {
    check(json);
  });

  /** The profile of `json` in the `strict` mode, with its code, the code
   *  that the runner evaluates once, and the code of each call. */
  const profileOf = (ce: ComputeEngine, json: MathJsonExpression) => {
    const result = compile(ce.expr(json), PROFILE as never) as CompilationResult<'javascript'> & {
      preambleOnce?: string;
      preamblePerCall?: string;
    };
    const text = [result.preambleOnce ?? '', result.preamblePerCall ?? '', result.code].join('\n');
    return { result, text };
  };
  const count = (text: string, part: string) => text.split(part).length - 1;

  test('the list is a constant of the program, made once', () => {
    const ce = engine();
    const { result, text } = profileOf(ce, ['Add', ['At', 'L', 'k'], 'x']);
    expect(result.code).toMatch(/^_\.x \+ _SYS\.atNumeric\(_tv\d+, _\.k, "integer"\)$/);
    expect(result.preambleOnce).toMatch(/^const _tv\d+ = \[10, 20, 30\];\n$/);
    expect(count(text, '[10, 20, 30]')).toBe(1);
    expect(result.shippable).toBe(true);
    // Read in a loop, in a helper and in the root: one array.
    ce.declare('h', '(integer) -> real');
    ce.assign('h', ce.box(['Function', ['Add', 'j', ['At', 'L', 'j']], 'j']));
    const json: MathJsonExpression = ['Add', ['Sum', ['h', 'j'], ['Limits', 'j', 1, 3]], ['At', 'L', 'k'], ['At', 'L', 1], 'x'];
    const read = profileOf(ce, json);
    expect(count(read.text, '[10, 20, 30]')).toBe(1);
    expect(read.result.run!({ x: 0.5, k: 2 } as never)).toBe(1 + 10 + 2 + 20 + 3 + 30 + 20 + 10 + 0.5);
    check(json, { ce });
  });

  test('no call changes the constant or the stored value', () => {
    const ce = engine();
    const stored = JSON.stringify(ce._getSymbolValue('L')!.json);
    // An update of the captured list copies it.
    const replaced = profileOf(ce, ['ReplaceAt', 'L', 1, 'x']).result;
    expect(replaced.code).toMatch(/^_SYS\.replaceAt\(_tv\d+, 1, _\.x\)$/);
    expect(replaced.run!({ x: 7 } as never)).toEqual([7, 20, 30]);
    expect(replaced.run!({ x: 8 } as never)).toEqual([8, 20, 30]);
    // A local that holds the list and is updated: a copy, then the update.
    const local = profileOf(ce, ['Block', ['Declare', 't', "'list<real>'", 'L'], ['Assign', 't', ['ReplaceAt', 't', 1, 'x']], 't']).result;
    expect(local.run!({ x: 7 } as never)).toEqual([7, 20, 30]);
    expect(local.run!({ x: 8 } as never)).toEqual([8, 20, 30]);
    // The list as the value: the host gets a copy, which it can write.
    for (const json of ['L', ['If', ['Less', 'x', 0], 'L', ['ReplaceAt', 'L', 2, 'x']]] as MathJsonExpression[]) {
      const value = profileOf(ce, json).result;
      const first = value.run!({ x: -1 } as never) as number[];
      expect(first).toEqual([10, 20, 30]);
      first[0] = 999;
      expect(value.run!({ x: -1 } as never)).toEqual([10, 20, 30]);
      expect(value.run!({ x: 1 } as never)).toEqual(json === 'L' ? [10, 20, 30] : [10, 1, 30]);
    }
    // A value that is a new array is not copied again.
    expect(profileOf(ce, ['ReplaceAt', 'L', 1, 'x']).result.code).not.toMatch(/slice/);
    expect(JSON.stringify(ce._getSymbolValue('L')!.json)).toBe(stored);
    check(['ReplaceAt', 'L', 1, 'x']);
    check('L', { interpreter: false });
  });

  test('the verifier checks the constants and their reads', () => {
    const ce = engine();
    const preparation = new ScalarFragmentJavaScriptTarget('structured').prepareStructured(
      ce.expr(['Add', ['At', 'L', 'k'], ['At', 'R', 1], ['Length', 'L']]),
      { cse: false, constantFold: false }
    );
    const program = lowerStructuredFragment(preparation);
    const nodes = preparedNodesOf(preparation);
    expect(program.constants?.map((c) => [c.name, String(c.type), c.elements])).toEqual([
      ['L', 'list<integer>', [10, 20, 30]],
      ['R', 'list<real>', [0.5, -1.25, 3]],
    ]);
    verifyJavaScriptProgram(program, nodes);
    // No update writes a constant, and the program is pure and portable.
    expect(inPlaceUpdates(program).size).toBe(0);
    const analysis = analyzeExecution(program);
    expect([analysis.independentCalls.holds, analysis.workerPortable.holds]).toEqual([true, true]);
    const reads = (region: IRRegion): IROperation[] => region.operations.filter((op) => op.kind === 'constant');
    const read = reads(program.root)[0];
    const constants = program.constants!;
    const variants: [string, IRProgram][] = [
      ['a non-finite element', { ...program, constants: [{ ...constants[0], elements: [10, Number.NaN, 30] }, constants[1]] }],
      ['a fraction in a list of integers', { ...program, constants: [{ ...constants[0], elements: [10, 20.5, 30] }, constants[1]] }],
      ['no element', { ...program, constants: [{ ...constants[0], elements: [] }, constants[1]] }],
      ['one binding twice', { ...program, constants: [constants[0], { ...constants[1], binding: constants[0].binding }] }],
      ['a read of no constant', { ...program, constants: [] }],
      ['a read of another type', { ...program, constants: [{ ...constants[0], type: constants[1].type }, constants[1]] }],
      [
        'a read that is not pure',
        {
          ...program,
          root: {
            ...program.root,
            operations: program.root.operations.map((op) => (op === read ? { ...op, effect: 'unknown' as const } : op)),
          },
        },
      ],
    ];
    const messageOf = (variant: IRProgram) => {
      try {
        verifyJavaScriptProgram(variant, nodes);
        return 'verified';
      } catch (e) {
        return (e as Error).message;
      }
    };
    for (const [name, variant] of variants)
      expect([name, messageOf(variant)]).toEqual([name, expect.stringMatching(/the constant|a read of the constant/)]);
  });

  test('the elements are the doubles of the exact values', () => {
    const ce = engine();
    expect(profileOf(ce, 'E').result.preambleOnce).toMatch(/= \[0\.3333333333333333, 0\.1, 1152921504606847000\];/);
    expect(check(['Add', 'big', 'x'], { modes: ['strict'] })).toBe('1152921504606847000 + _.x');
    check('E');
  });

  // The interpreter gives a lazy `Map`, whose elements the harness reads
  // after the call that binds `x`: it is compared with the existing
  // compiler only.
  test('Map(v ↦ x·v, R)', () => {
    // The complex mode declines a `Map` with a function literal.
    check(['Map', ['Function', ['Multiply', 'x', 'v'], 'v'], 'R'], { interpreter: false, modes: ['strict'] });
  });

  test('a name declared list, whose value is a list of integers', () => {
    const ce = engine();
    ce.declare('LB', { type: 'list', value: ['List', 1, 2] } as never);
    check(['Add', ['At', 'LB', 2], 'x'], { ce });
  });

  test('in the body of a root Function', () => {
    check(['Function', ['Add', ['At', 'L', 'j'], ['At', 'R', 1]], ['Typed', 'j', "'integer'"]], {
      inputs: [[1], [3], [-2], [5]],
    });
  });

  test('the declines that stay', () => {
    const ce = engine();
    ce.assign('LL', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    ce.assign('LT', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    ce.assign('LS', ce.box(['List', { str: 'a' }, { str: 'b' }]));
    ce.assign('LI', ce.box(['List', 1, { num: '1e400' }]));
    ce.assign('huge', ce.box({ num: '1e400' }));
    ce.assign('LC', ce.box(['List', ['Complex', 1, 2], 3]));
    ce.assign('ev', ce.box(['Add', ['Power', 'x', 2], 1]));
    // A list of lists is a constant of rank 2
    // (compile-javascript-structured-bindings.test.ts).
    check(['Add', ['Length', 'LL'], 'x'], { ce, modes: ['strict'] });
    // A list that is not a constant of the program (a list of tuples, of
    // strings, of a value that is not finite, a list declared with elements
    // of the type `number`) is a captured expression, which the program
    // computes once per call, as the existing compiler computes `_val_LT`
    // (compile-javascript-structured-bindings.test.ts): its elements are
    // admitted as any list literal.
    check(['Add', ['Length', 'LT'], 'x'], { ce, modes: ['strict'] });
    declines(['Add', ['Length', 'LS'], 'x'], /unsupported head String/, ce);
    check(['Add', ['At', 'LI', 1], 'x'], { ce });
    declines(['Add', 'huge', 'x'], /unsupported binding huge: its value .* is not finite/, ce);
    ce.declare('LN', { type: 'list<number>', value: ['List', 0.5, ['Rational', 1, 3], 3] } as never);
    ce.declare('VN', { type: 'vector<3>', value: ['List', 0.5, ['Rational', 1, 3], 3] } as never);
    for (const name of ['LN', 'VN']) {
      check(['Add', ['At', name, 'k'], 'x'], { ce, modes: ['strict'] });
      declines(['Add', ['At', name, 'k'], 'x'], new RegExp(`At\\("${name}", k\\) has the type number`), ce, ['complex']);
      check(['Multiply', 'x', name], { ce });
    }
    declines(['Add', ['At', 'LC', 2], 'x'], /a list literal with an element of the type `complex`|At\("LC", 2\) has the type complex/, ce);
    // A value that is an expression of the inputs: the existing compiler
    // writes its code once per call (`_val_ev`), and the route computes it
    // once (compile-javascript-structured-bindings.test.ts, which compares
    // it with the interpreter: the interpreter reads the `x` of `ev` in the
    // engine, not as a parameter of the function of `interpret()`).
    check(['Add', 'ev', 'y'], { ce, interpreter: false });
  });
});

describe('a value of the frame of a call', () => {
  // `d` is a parameter of `f`: the interpreter compiles the element
  // function of `Map` while it calls `f`, and the existing compiler writes
  // the value of `d` in that frame (`map-compile-captured-values.test.ts`).
  // The element function reads `d`, or binds its own `d`, which the
  // compilation reads in place of the value of the frame.
  test.each<[string, unknown]>([
    ['a read of the parameter', ['Add', 'x', 'd']],
    ['a lambda parameter with its name', null],
  ])('%s', (_name, element) => {
    const fn = (body: unknown, ...params: string[]) => ['Function', body, ...params];
    const calls = [['f', 1], ['f', 2.5], ['f', 3]];
    const valuesOf = (route: 'off' | 'on' | 'jit-off') => {
      const ce = new ComputeEngine({ precision: 'machine' });
      ce._jsProfile = route === 'on' ? { profile: 'numeric-kernel' } : undefined;
      if (route === 'jit-off') ce.jit = 'off';
      const map = element === null ? fn(['Add', 'd', 1], 'd') : fn(element, 'x');
      ce.assign('f', ce.box(fn(['Sum', ['Map', map, ['Range', 1, 128]]], 'd') as never));
      const values = calls.map((c) => ce.box(c as never).evaluate().json);
      return { values, stats: _jsProfileStats(ce) };
    };
    const interpreted = valuesOf('jit-off').values;
    expect(valuesOf('off').values).toEqual(interpreted);
    const on = valuesOf('on');
    expect(on.values).toEqual(interpreted);
    const counts = Object.values(on.stats);
    expect(counts.reduce((n, s) => n + s.admitted, 0)).toBeGreaterThan(0);
    expect(counts.reduce((n, s) => n + s.declined + s.failed, 0)).toBe(0);
  });
});

describe('a node that reads no input', () => {
  // The fold compiles the literal that it writes, and its evaluation can
  // compile (a `Sum` its body): each such compilation is nested in the
  // compilation in progress, as in the existing compiler, and does not
  // empty its memos (`resetCompilationMemos()` writes a new
  // `_foldValueMemo`) or reset its step budgets.
  test('a fold empties no memo of the compilation in progress', () => {
    const ce = engine();
    const descriptor = Object.getOwnPropertyDescriptor(CompilerState, '_foldValueMemo')!;
    let memo = CompilerState._foldValueMemo;
    let resets = 0;
    Object.defineProperty(CompilerState, '_foldValueMemo', {
      configurable: true,
      get: () => memo,
      set: (v) => {
        memo = v;
        resets += 1;
      },
    });
    try {
      const resetsOf = (json: MathJsonExpression) => {
        resets = 0;
        compile(ce.expr(json), PROFILE as never);
        return resets;
      };
      const plain = resetsOf(['Add', 'x', 1]);
      expect(resetsOf(['Add', 'x', ['Floor', ['Divide', 7, 2]]])).toBe(plain);
      expect(resetsOf(['Add', 'x', ['Floor', ['Sum', ['Divide', 1, ['Power', 'j', 2]], ['Limits', 'j', 1, 1000]]]])).toBe(plain);
    } finally {
      Object.defineProperty(CompilerState, '_foldValueMemo', { ...descriptor, value: memo });
    }
  });

  test.each<[string, MathJsonExpression, boolean?]>([
    // The existing compiler folds a jump function of closed exact operands
    // (`closedExactJump()`, `tryConstantFold()`): the profile writes the
    // same literal.
    ['x + Floor(third)', ['Add', 'x', ['Floor', 'third']]],
    ['x + Ceil(third)', ['Add', 'x', ['Ceil', 'third']]],
    ['Sign(offset) + x', ['Add', ['Sign', 'offset'], 'x']],
    ['Truncate(7/2) + x', ['Add', ['Truncate', ['Divide', 7, 2]], 'x']],
    ['x · Floor((25! - 1)/24!)', ['Multiply', 'x', ['Floor', ['Divide', ['Add', ['Factorial', 25], -1], ['Factorial', 24]]]]],
    // Both compilers write `0.5028841971693994`, the value of `.N()`. The
    // interpreter's `evaluate()` of `x + Fract(π·10^30)` computes the exact
    // form `10^30·π - 3141592653589793238462643383279` in the precision of
    // the engine, which loses the fractional part (a defect of the
    // interpreter, reported with this change).
    ['x + Fract(π·10^30)', ['Add', 'x', ['Fract', ['Multiply', 'Pi', ['Power', 10, 30]]]], false],
    ['x + Floor(π·10^30)', ['Add', 'x', ['Floor', ['Multiply', 'Pi', ['Power', 10, 30]]]]],
    ['x + Mod(√8, 2)', ['Add', 'x', ['Mod', ['Sqrt', 8], 2]]],
    // With `symbolDeps` the existing compiler does not fold this node, and
    // both compilers write `_SYS.floorMod(0.7, 0.1)`, `0.0999…`, where the
    // interpreter gives 0 (a defect of the existing compiler, reported with
    // this change); without it, both write `0`.
    ['x + Mod(seven, tenth)', ['Add', 'x', ['Mod', 'seven', 'tenth']], false],
    ['If(nearThird < third, x, -x)', ['If', ['Less', 'nearThird', 'third'], 'x', ['Negate', 'x']]],
    ['If(nearThird = third, x, -x)', ['If', ['Equal', 'nearThird', 'third'], 'x', ['Negate', 'x']]],
    ['x + Sign(√2)', ['Add', 'x', ['Sign', ['Sqrt', 2]]]],
    // Integer literals in the safe range: the existing compiler writes the
    // code of the node.
    ['x + Sign(3)', ['Add', 'x', ['Sign', 3]]],
    ['x + Ceil(-2)', ['Add', 'x', ['Ceil', -2]]],
    // A rest parameter: with a third named parameter, Jest would read a row
    // of two elements as a test that waits for `done()`.
  ])('%s', (...row) => {
    const [, json, interpreter] = row;
    check(json, { interpreter });
  });

  test('the literal of the fold', () => {
    expect(check(['Multiply', 'x', ['Floor', ['Divide', ['Add', ['Factorial', 25], -1], ['Factorial', 24]]]], { modes: ['strict'] })).toBe('_.x * 24');
    expect(check(['If', ['Less', 'nearThird', 'third'], 'x', ['Negate', 'x']], { modes: ['strict'] })).toBe('true ? _.x : -_.x');
  });

  test('Mod(a, 1) of a dividend that is not integer-valued', () => {
    expect(check(['Mod', 'x', 1], { modes: ['strict'] })).toBe('_SYS.fract(_.x)');
    check(['Mod', ['Divide', ['Ln', ['Abs', 'x']], ['Ln', 2]], 1]);
    // `-1e-20 - Math.floor(-1e-20)` is 1, and the remainder gives 0 on both
    // compilers, where the interpreter gives `1 - 1e-20`: the precision of
    // the target at the jump.
    check(['Add', ['Mod', ['Multiply', 'x', 'y'], 1], 'y'], { interpreter: false });
    check(['Mod', 'y', 1], {
      inputs: [{ x: 0, y: -1e-20, k: 0 }, { x: 0, y: -0, k: 0 }, { x: 0, y: Infinity, k: 0 }],
      interpreter: false,
    });
  });

  test('the declines that stay', () => {
    // An integer dividend: the existing emitter writes `%` when it proves it
    // not negative, which is `-0` at `-0`.
    declines(['Add', ['Mod', 'k', 1], 'x'], /Mod of the integer k and the literal divisor 1/);
    // A dividend that the pass types as an integer (found by the random
    // tester, seed 173: a compile-error before the fix).
    const withList = engine();
    withList.declare('LQ', 'list<tuple<real, real>>');
    declines(['Mod', ['Length', 'LQ'], 1], /Mod of the integer Length\("LQ"\) and the literal divisor 1/, withList);
    declines(['Mod', ['Floor', 'x'], 1],/Mod of the integer Floor\(x\) and the literal divisor 1|Mod of the integer floor/);
    // A condition whose type is the value false before a condition that is
    // not constant: the existing compiler drops its clause.
    declines(['Which', ['Less', 3, 2], 'x', ['Less', 'x', 1], 2, 'True', 0], /the condition of Which has the constant type false/);
    // A rounding of an integer variable and an exact constant that no
    // double holds: the existing compiler rewrites the node.
    declines(['Floor', ['Add', 'k', ['Sqrt', 2]]], /Floor of an operand with the exact constant/);
  });
});

// A name that the program binds (a parameter of the root function or of a
// helper, a lambda parameter, a `Sum` index, a block local, a loop index)
// with the name of a symbol that has a value: the program reads the bound
// name, never the value of the symbol, as on the existing compiler and the
// interpreter.
describe('a bound name with the name of a symbol that has a value', () => {
  const shadowing = () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('t', ce.box(['Rational', 1, 3]));
    ce.assign('n', 5);
    ce.assign('L', ce.box(['List', 1, 2, 3]));
    ce.declare('h', '(list<real>) -> real');
    ce.assign('h', ce.box(['Function', ['At', 'L', 1], ['Typed', 'L', "'list<real>'"]]));
    ce.declare('g', '(real) -> real');
    ce.assign('g', ce.box(['Function', ['Sign', 'n'], ['Typed', 'n', "'real'"]]));
    return ce;
  };
  const list = (ce: ComputeEngine, v: unknown) =>
    Array.isArray(v) ? ce.function('List', v.map((e) => ce.number(e as number))) : ce.number(v as number);
  /** The profile compiles `json`, a `Function` literal, with the values of
   *  the existing compiler and of the interpreter at each list of
   *  arguments; or, with `declines`, declines it with that message. */
  const expectBound = (json: MathJsonExpression, cases: unknown[][], declines?: RegExp) => {
    const ce = shadowing();
    const expr = ce.expr(json);
    const existing = compile(expr, EXISTING as never) as CompilationResult<'javascript'>;
    if (declines !== undefined) {
      expect(() => compile(expr, PROFILE as never)).toThrow(declines);
      return;
    }
    const profile = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    for (const args of cases) {
      const a = outcome(() => run(profile, args as number[]));
      const b = outcome(() => run(existing, args as number[]));
      expect([args, same(a, b)]).toEqual([args, true]);
      const i = ce.function('Apply', [expr, ...args.map((v) => list(ce, v))]).evaluate();
      const value = i.symbol === 'True' ? true : i.symbol === 'False' ? false : i.N().re;
      expect([args, close(a, value)]).toEqual([args, true]);
    }
  };

  test('a parameter of the root function in a node that reads no other name', () => {
    // `Floor(t)`, `Floor(n)` with `t := 1/3`, `n := 5`: the existing compiler
    // writes `Math.floor(t)` and `n`, and so does the profile: a bound name
    // is not an exact constant (`inexactJumpConstant()`), and the node is
    // never folded.
    expectBound(['Function', ['Floor', 't'], 't'], [[0.5], [-1.5], [2]]);
    expectBound(['Function', ['Floor', 'n'], ['Typed', 'n', "'integer'"]], [[3], [-2]]);
    expectBound(['Function', ['Add', ['Mod', 'x', 1], ['Floor', 't']], 'x', 't'], [[0.25, 1.5], [-0.5, -2.5]]);
    // A bound name next to an exact constant that no double holds: the
    // constant is refused.
    expectBound(['Function', ['Floor', ['Add', 't', ['Sqrt', 2]]], ['Typed', 't', "'integer'"]], [], /Floor of an operand with the exact constant/);
    expectBound(['Function', ['Sign', 'n'], 'n'], [[-2], [0], [3.5]]);
    expectBound(['Function', ['Less', 'n', 't'], 'n', 't'], [[0.25, 0.5], [2, 1]]);
  });

  test('a list parameter of the root function', () => {
    expectBound(['Function', ['At', 'L', 1], ['Typed', 'L', "'list<real>'"]], [[[7, 8, 9]], [[-1.5]]]);
    expectBound(['Function', ['Add', ['Sum', 'L'], ['Length', 'L']], ['Typed', 'L', "'list<real>'"]], [[[7, 8, 9]], [[0.5]]]);
  });

  test('a parameter of a helper', () => {
    expectBound(['Function', ['h', 'R'], ['Typed', 'R', "'list<real>'"]], [[[7, 8, 9]]]);
    expectBound(['Function', ['g', 'x'], ['Typed', 'x', "'real'"]], [[-2.5], [0], [4]]);
  });

  test('a lambda parameter, a Sum index, a block local and a loop index', () => {
    const R = ['Typed', 'R', "'list<real>'"];
    expectBound(['Function', ['Sum', ['Map', ['Function', ['Multiply', 2, 'L'], 'L'], 'R']], R], [[[7, 8, 9]]]);
    expectBound(['Function', ['Add', 'x', ['Sum', 'L', ['Limits', 'L', 1, 3]]], ['Typed', 'x', "'real'"]], [[0.5]]);
    expectBound(['Function', ['Block', ['Declare', 'L', "'list<real>'", ['List', 'x', 2]], ['At', 'L', 1]], ['Typed', 'x', "'real'"]], [[0.5], [-3]]);
    expectBound(
      ['Function', ['Block', ['Declare', 's', "'real'", 0], ['Loop', ['Assign', 's', ['Add', 's', 'L']], ['Element', 'L', ['Range', 1, 3]]], 's'], ['Typed', 'x', "'real'"]],
      [[0.5]]
    );
  });
});

describe('a parameter of the root Function that the body never reads', () => {
  test.each<[string, MathJsonExpression]>([
    ['any', 'any'],
    ['string', 'string'],
    ['list<list<real>>', 'list<list<real>>'],
    ['collection<integer>', 'collection<integer>'],
    ['real', 'real'],
  ])('%s', (_name, type) => {
    const json: MathJsonExpression = ['Function', ['Multiply', 2, 'p'], ['Typed', 'p', "'real'"], ['Typed', 'q', `'${type}'`]];
    // The interpreter checks the type of the argument of `q`, which a
    // number does not have for most of these types.
    expect(check(json, { inputs: [[1.5, 3], [-0, 0], [2, Number.NaN]], interpreter: type === 'real' || type === 'any' })).toBe(
      '(p, q) => { return 2 * p; }'
    );
  });

  test('a parameter with no annotation, and the host gives any value there', () => {
    const ce = engine();
    const json: MathJsonExpression = ['Function', ['Add', 'p', 1], ['Typed', 'p', "'real'"], ['Typed', 'q', "'any'"]];
    const expr = ce.expr(json);
    const profile = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    const existing = compile(expr, EXISTING as never) as CompilationResult<'javascript'>;
    for (const q of [[1, 2], 'text', { a: 1 }, undefined])
      expect(same(run(profile, [2, q as never]), run(existing, [2, q as never]))).toBe(true);
  });

  test('the declines that stay', () => {
    // A parameter that the body reads keeps the rule of its type (R1).
    declines(['Function', ['Add', 'q', 1], ['Typed', 'q', "'any'"]], /the parameter q of the function has the type any/);
    // A name of the body is a read, also as the parameter of a nested
    // literal.
    declines(
      ['Function', ['Add', 'p', ['Apply', ['Function', ['Multiply', 2, 'q'], 'q'], 'p']], ['Typed', 'p', "'real'"], ['Typed', 'q', "'any'"]],
      /the parameter q of the function has the type any/
    );
    // A default value or a rest parameter keeps its refusal.
    declines(['Function', ['Add', 'p', 1], ['Typed', 'p', "'real'"], ['Optional', 'q', 5]], /has a default value/);
  });
});
