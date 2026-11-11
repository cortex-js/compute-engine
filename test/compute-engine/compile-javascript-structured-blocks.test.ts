import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Blocks, local declarations, local functions and helpers declared
// `function` on the structured route of the JavaScript compiler (the
// `numeric-kernel` profile): slices 2 and 6 of
// docs/plans/2026-11-11-structured-options-and-bindings.md. For each
// admitted program the profile gives the doubles and the shape of the
// existing compiler with `cse: false, constantFold: false`, and the value of
// the interpreter; every other program declines with a message that names
// its cause.

const EXISTING = { cse: false, constantFold: false, fallback: false } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;

type Mode = 'strict' | 'complex';
type Value = number | boolean | { re: number; im: number };

const declare = (name: string, type: string, value: MathJsonExpression): MathJsonExpression => [
  'Declare',
  name,
  `'${type}'`,
  value,
];
const letLocal = (name: string, value: MathJsonExpression): MathJsonExpression => [
  'Declare',
  name,
  ['Dictionary', ['KeyValuePair', { str: 'value' }, value]],
];
const fn = (body: MathJsonExpression, ...parameters: MathJsonExpression[]): MathJsonExpression => [
  'Function',
  body,
  ...parameters,
];
const real = (name: string): MathJsonExpression => ['Typed', name, "'real'"];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('k', 'integer');
  return ce;
}

const XS = [1.5, -0.75, 0, -0, 3, 0.1];
const INPUTS = XS.map((x) => ({ x, y: 2.5, k: 3 }));

/** The same double (`0` and `-0` differ, two `NaN` are equal), or the same
 *  complex value, or the same boolean. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null)
    return (
      same((a as { re: number }).re, (b as { re: number }).re) &&
      same((a as { im: number }).im, (b as { im: number }).im)
    );
  return a === b;
}

function run(result: CompilationResult<'javascript'>, input: unknown): unknown {
  return Array.isArray(input)
    ? (result.run as unknown as (...a: unknown[]) => unknown)(...input)
    : result.run!(input as never);
}

function boxed(ce: ComputeEngine, v: Value): Expression {
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (typeof v === 'number') return ce.number(v);
  return ce.expr(['Complex', v.re, v.im]);
}

/** The value of the interpreter: `expr` applied to `input` (the values of
 *  the parameters of a root `Function`, or of the free symbols). */
function interpret(ce: ComputeEngine, expr: Expression, input: Record<string, Value> | Value[]): unknown {
  const value = Array.isArray(input)
    ? ce.function('Apply', [expr, ...input.map((v) => boxed(ce, v))]).evaluate()
    : ce
        .function('Apply', [
          ce.function('Function', [expr, ...Object.keys(input).map((n) => ce.symbol(n))]),
          ...Object.values(input).map((v) => boxed(ce, v)),
        ])
        .evaluate();
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  const n = value.N();
  return n.im === 0 ? n.re : { re: n.re, im: n.im };
}

/** Compile `json` with both compilers in each mode, compare the values at
 *  each input, and with the interpreter. Returns the code of the profile in
 *  the first mode. Every compilation comes before the first evaluation: the
 *  interpreter gives the locals of a block values, which narrows their
 *  inferred types, and a compilation reads those. */
function check(
  json: MathJsonExpression,
  inputs: (Record<string, Value> | Value[])[] = INPUTS,
  modes: readonly Mode[] = ['strict', 'complex'],
  ce: ComputeEngine = engine()
): string {
  const expr = ce.expr(json);
  const compiled = modes.map((mode) => {
    const existing = compile(expr, { ...EXISTING, mode } as never) as CompilationResult<'javascript'>;
    const profile = compile(expr, { ...PROFILE, mode } as never) as CompilationResult<'javascript'>;
    expect(existing.success).toBe(true);
    expect(profile.success).toBe(true);
    // A program of these forms has no effect.
    expect(profile.pure).toBe(true);
    return { mode, existing, profile };
  });
  for (const { mode, existing, profile } of compiled)
    for (const input of inputs) {
      const a = run(existing, input);
      const b = run(profile, input);
      if (!same(a, b)) throw new Error(`${mode} ${JSON.stringify(input)}: existing ${JSON.stringify(a)}, profile ${JSON.stringify(b)}`);
      if (typeof b === 'number' && Number.isFinite(b)) {
        const i = interpret(ce, expr, input);
        if (typeof i === 'number') expect(i).toBeCloseTo(b, 10);
      } else if (typeof b === 'boolean') expect(interpret(ce, expr, input)).toBe(b);
    }
  return compiled[0].profile.code;
}

/** The message of the decline of the profile, which must decline in each
 *  mode of `modes`. */
function declines(
  json: MathJsonExpression,
  message: RegExp,
  ce: ComputeEngine = engine(),
  modes: readonly Mode[] = ['strict', 'complex']
): void {
  const expr = ce.expr(json);
  for (const mode of modes)
    expect(() => compile(expr, { ...PROFILE, mode } as never)).toThrow(message);
}

describe('a block in a block', () => {
  test.each<[string, MathJsonExpression]>([
    ['a root block of one block', ['Block', ['Block', declare('s', 'real', 'x'), ['Add', 's', 1]]]],
    [
      'a root block of one block with a write',
      ['Block', ['Block', declare('s', 'real', 0), ['Assign', 's', ['Power', 'x', 2]], ['Add', 's', 1]]],
    ],
    [
      'three blocks',
      ['Block', ['Block', ['Block', declare('b', 'real', 0), ['Assign', 'b', ['Add', 'x', 1]], ['Multiply', 2, 'b']]]],
    ],
    [
      'the form of an Epsil program',
      ['Block', ['Block', letLocal('r', ['Multiply', 2, 'x']), ['Assign', 'r', ['Add', 'r', 1]], 'r']],
    ],
    [
      'a block as the value of a root block',
      ['Block', declare('a', 'real', 'x'), ['Block', declare('b', 'real', ['Multiply', 2, 'a']), ['Add', 'a', 'b']]],
    ],
    [
      'a block with a write as the value of a root block',
      ['Block', declare('a', 'real', 'x'), ['Block', declare('b', 'real', 0), ['Assign', 'b', ['Add', 'a', 1]], ['Multiply', 2, 'b']]],
    ],
    [
      'a block statement that writes an outer local',
      ['Block', declare('a', 'real', 'x'), ['Block', ['Assign', 'a', ['Add', 'a', 1]]], ['Multiply', 2, 'a']],
    ],
    [
      'a block statement whose local is not visible after it',
      ['Block', declare('a', 'real', 'x'), ['Block', declare('b', 'real', 5), ['Assign', 'a', ['Multiply', 'b', 'a']]], ['Multiply', 2, 'a']],
    ],
    [
      'a name declared again after a block statement that declares it',
      ['Block', declare('a', 'real', 0), ['Block', declare('u', 'real', 5), ['Assign', 'a', 'u']], declare('u', 'real', 3), ['Add', 'u', 'a']],
    ],
  ])('%s', (_name, json) => {
    check(json);
  });

  test('the code of Block(Block(…)) is the code of the inner block', () => {
    const code = check(['Block', ['Block', declare('s', 'real', 0), ['Assign', 's', ['Power', 'x', 2]], ['Add', 's', 1]]]);
    expect(code).toBe('(() => { const _tv1 = _.x; return _tv1 * _tv1 + 1; })()');
  });

  test('in the body of a Function', () => {
    check(fn(['Block', ['Block', declare('b', 'real', 0), ['Assign', 'b', ['Add', 't', 1]], ['Multiply', 2, 'b']]], real('t')), [[1.5], [-2], [0]]);
    check(fn(['Block', declare('a', 'real', 't'), ['Block', declare('b', 'real', ['Add', 'a', 1]), ['Multiply', 'a', 'b']]], real('t')), [[1.5], [-2]]);
  });

  test('a local of an inner block with the name of an outer local or a parameter declines', () => {
    declines(
      ['Block', declare('a', 'real', 'x'), ['Block', declare('a', 'real', 5), ['Assign', 'a', 7]], ['Multiply', 2, 'a']],
      /the local a has the name of a parameter, an input, an index or a local declared before it/
    );
    declines(
      fn(['Block', ['Block', declare('t', 'real', 5), ['Assign', 't', 7]], ['Multiply', 2, 't']], real('t')),
      /the local t has the name of a parameter/
    );
  });
});

describe('a block as an operand', () => {
  test.each<[string, MathJsonExpression]>([
    [
      'a declaration and a value, plus one',
      ['Add', ['Block', declare('a', 'real', ['Multiply', 3.7, 'x']), ['Subtract', 'a', ['Floor', 'a']]], 1],
    ],
    [
      'the form of a let',
      ['Add', ['Block', letLocal('a', ['Multiply', 3.7, 'x']), ['Subtract', 'a', ['Floor', 'a']]], 1],
    ],
    ['after another operand', ['Add', ['Sin', 'x'], ['Block', declare('a', 'real', ['Multiply', 2, 'x']), ['Multiply', 'a', 'a']]]],
    ['two declarations', ['Add', ['Block', declare('a', 'real', 'x'), declare('b', 'real', ['Add', 'a', 1]), ['Multiply', 'a', 'b']], 1]],
    ['nested', ['Add', ['Block', declare('a', 'real', 'x'), ['Block', declare('b', 'real', ['Add', 'a', 1]), ['Multiply', 'a', 'b']]], 1]],
    ['an operand that reads an input again', ['Multiply', 'x', ['Block', declare('a', 'real', 'x'), ['Add', 'a', 'a']]]],
    ['in a branch', ['If', ['Greater', 'x', 0], ['Block', declare('a', 'real', ['Multiply', 2, 'x']), ['Multiply', 'a', 'a']], 0]],
    ['in a condition', ['If', ['Block', declare('u', 'real', ['Multiply', 2, 'x']), ['Greater', 'u', 1]], 1, 2]],
    ['in a short-circuit operand', ['And', ['Greater', 'x', 0], ['Block', declare('a', 'real', ['Multiply', 2, 'x']), ['Greater', 'a', 1]]]],
    ['in a Sum with a bound that reads an input', ['Sum', ['Block', declare('t', 'integer', ['Add', 'j', 1]), 't'], ['Limits', 'j', 1, 'k']]],
    ['in a Sum with literal bounds', ['Sum', ['Block', declare('t', 'real', ['Multiply', 'j', 'x']), ['Multiply', 't', 't']], ['Limits', 'j', 1, 4]]],
    [
      'in a Sum, reading a local of the root block',
      ['Block', declare('c', 'real', ['Multiply', 2, 'x']), ['Sum', ['Block', declare('t', 'real', ['Multiply', 'c', 'j']), ['Multiply', 't', 't']], ['Limits', 'j', 1, 'k']]],
    ],
    [
      'in the body of a Loop',
      [
        'Block',
        declare('t', 'real', 0),
        ['Loop', ['Assign', 't', ['Add', 't', ['Block', declare('u', 'real', ['Multiply', 'i', 'x']), ['Multiply', 'u', 'u']]]], ['Element', 'i', ['Range', 1, 3]]],
        't',
      ],
    ],
    ['an operand of a root block', ['Block', declare('a', 'real', 'x'), ['Add', 'a', ['Block', declare('b', 'real', ['Add', 'a', 1]), 'b']]]],
    ['a local declared unknown', ['Add', ['Block', declare('a', 'unknown', ['Multiply', 2, 'x']), ['Multiply', 'a', 'a']], 1]],
  ])('%s', (_name, json) => {
    check(json);
  });

  test('the statements are written in the region of the operand, in order', () => {
    const code = check(['Add', ['Sin', 'x'], ['Block', declare('a', 'real', ['Multiply', 2, 'x']), ['Multiply', 'a', 'a']]], INPUTS, ['strict']);
    expect(code).toBe('(() => { const _tv1 = 2 * _.x; return _tv1 * _tv1 + Math.sin(_.x); })()');
  });

  test('in the body of a Function', () => {
    check(fn(['Add', 't', ['Block', declare('a', 'real', ['Multiply', 2, 't']), ['Multiply', 'a', 'a']]], real('t')), [[1.5], [-2]]);
  });

  test('a block with a statement other than a declaration declines, as on the existing route', () => {
    declines(
      ['Add', ['Block', declare('a', 'real', 0), ['Assign', 'a', 'x'], ['Multiply', 2, 'a']], 1],
      /the statement Assign\(a, x\) of a Block used as an operand is not a declaration with a value/
    );
  });

  test('a local with the name of an input declines', () => {
    declines(['Add', 'x', ['Block', declare('x', 'real', 5), ['Multiply', 2, 'x']]], /unsupported capture x/);
  });
});

describe('a local declared unknown', () => {
  test.each<[string, MathJsonExpression]>([
    ['a real value', ['Block', declare('a', 'unknown', ['Multiply', 3.7, 'x']), ['Add', 'a', 1]]],
    ['an integer value', ['Block', declare('a', 'unknown', 'k'), ['Add', 'a', 1]]],
    ['an integer, then a real', ['Block', declare('a', 'unknown', 1), ['Assign', 'a', ['Multiply', 0.5, 'x']], ['Add', 'a', 1]]],
    ['a boolean', ['Block', declare('a', 'unknown', ['Greater', 'x', 1]), ['If', 'a', 1, 2]]],
    [
      'an integer loop bound',
      ['Block', declare('m', 'unknown', ['Add', 'k', 1]), declare('t', 'real', 0), ['Loop', ['Assign', 't', ['Add', 't', 'i']], ['Element', 'i', ['Range', 1, 'm']]], 't'],
    ],
  ])('%s', (_name, json) => {
    check(json);
  });

  test('the form that `\\coloneq` gives', () => {
    const ce = engine();
    const expr = ce.parse('m \\coloneq x + 1; 2m');
    expect(expr.json).toEqual(['Block', ['Declare', 'm', "'unknown'", ['Add', 'x', 1]], ['Multiply', 2, 'm']]);
    check(expr.json as MathJsonExpression, INPUTS, ['strict', 'complex'], ce);
  });

  test('in the strict mode, a square root of an input is real', () => {
    check(['Block', declare('a', 'unknown', ['Sqrt', 'x']), ['Add', 'a', 1]], INPUTS, ['strict']);
  });

  test('in the complex mode, a local whose type is not real declines', () => {
    const expr = engine().expr(['Block', declare('a', 'unknown', ['Sqrt', 'x']), ['Add', 'a', 1]]);
    expect(() => compile(expr, { ...PROFILE, mode: 'complex' } as never)).toThrow(
      /the local a has the type number, which is not real, in the complex mode/
    );
  });
});

describe('a first write to a local of a block', () => {
  test.each<[string, MathJsonExpression]>([
    ['a real value', ['Block', ['Assign', 's', ['Power', 'x', 2]], ['Add', 's', 1]]],
    ['an integer, then a real', ['Block', ['Assign', 's', 1], ['Assign', 's', ['Multiply', 0.5, 'x']], ['Add', 's', 1]]],
    ['an integer', ['Block', ['Assign', 's', 'k'], ['Assign', 's', ['Add', 's', 1]], ['Add', 's', 1]]],
    ['two names', ['Block', ['Assign', 'p', ['Multiply', 2, 'x']], ['Assign', 'q', ['Add', 'p', 1]], ['Multiply', 'p', 'q']]],
    ['a boolean', ['Block', ['Assign', 's', ['Greater', 'x', 1]], ['If', 's', 1, 2]]],
    ['then a loop', ['Block', ['Assign', 's', 0], ['Loop', ['Assign', 's', ['Add', 's', 'i']], ['Element', 'i', ['Range', 1, 3]]], ['Add', 's', 'x']]],
    [
      'an integer loop bound',
      ['Block', ['Assign', 'm', ['Add', 'k', 1]], declare('t', 'real', 0), ['Loop', ['Assign', 't', ['Add', 't', 'i']], ['Element', 'i', ['Range', 1, 'm']]], 't'],
    ],
    ['in an inner block', ['Block', ['Block', ['Assign', 's', ['Add', 'x', 1]], ['Multiply', 2, 's']]]],
    ['in a block statement', ['Block', declare('a', 'real', 'x'), ['Block', ['Assign', 's', ['Add', 'a', 1]], ['Assign', 'a', 's']], ['Multiply', 2, 'a']]],
  ])('%s', (_name, json) => {
    check(json);
  });

  test('in the strict mode, a square root', () => {
    check(['Block', ['Assign', 's', ['Sqrt', 'x']], ['Add', 's', 1]], INPUTS, ['strict']);
  });

  test('in the body of a Function', () => {
    check(fn(['Block', ['Assign', 'q', ['Add', 't', 1]], ['Multiply', 2, 'q']], real('t')), [[1.5], [-2]]);
  });

  test('in the strict mode, a real and a complex value declines, as on the existing route', () => {
    declines(
      ['Block', ['Assign', 'a', 1], ['If', ['Greater', 'x', 0], ['Assign', 'a', ['Sqrt', ['Multiply', -1, 'x']]]], 'a'],
      /the local a is written a real value and a complex value/,
      engine(),
      ['strict']
    );
  });

  test('a write to a name of the engine declines, as on the existing route', () => {
    declines(['Block', ['Assign', 'y', ['Add', 'x', 1]], ['Add', 'y', 1]], /y is not a local of the block: it is a name of the engine or an input/);
  });

  test('a first write that reads the name declines', () => {
    declines(['Block', ['Assign', 'q', ['Add', 'q', 1]], 'q'], /the first write to the local q of the block reads q, which has no value yet/);
  });

  test('a local of an inner block read after it declines', () => {
    declines(['Block', ['Block', ['Assign', 'q', 'x']], 'q'], /unsupported capture q/);
  });
});

describe('a local function', () => {
  test.each<[string, MathJsonExpression]>([
    ['Declare … function', ['Block', declare('g', 'function', fn(['Multiply', 't', 't'], 't')), ['Add', ['g', 'x'], 1]]],
    ['DefineFunction', ['Block', ['DefineFunction', 'g', fn(['Add', 't', 1], 't')], ['Multiply', ['g', 'x'], 2]]],
    ['the form of a let', ['Block', letLocal('g', fn(['Add', 't', 1], 't')), ['Multiply', ['g', 'x'], 2]]],
    ['declared unknown', ['Block', declare('g', 'unknown', fn(['Add', 't', 1], 't')), ['Multiply', ['g', 'x'], 2]]],
    ['two parameters', ['Block', ['DefineFunction', 'g', fn(['Subtract', 'a', 'b'], 'a', 'b')], ['g', 'x', 1]]],
    ['an annotated parameter', ['Block', declare('g', 'function', fn(['Multiply', 't', 2], real('t'))), ['g', 'x']]],
    ['an integer argument', ['Block', declare('g', 'function', fn(['Multiply', 't', 0.5], 't')), ['g', 'k']]],
    ['it reads an input', ['Block', declare('g', 'function', fn(['Add', ['Power', 't', 2], 'x'], 't')), ['Add', 1, ['g', 3]]]],
    [
      'it reads a local',
      ['Block', declare('a', 'real', ['Multiply', 2, 'x']), declare('g', 'function', fn(['Add', 't', 'a'], 't')), ['g', 3]],
    ],
    [
      'a local written after the definition: the call reads its value there',
      ['Block', declare('a', 'real', ['Multiply', 2, 'x']), declare('g', 'function', fn(['Add', 't', 'a'], 't')), ['Assign', 'a', 10], ['g', 3]],
    ],
    [
      'two calls around a write of the local',
      [
        'Block',
        declare('a', 'real', ['Multiply', 2, 'x']),
        declare('g', 'function', fn(['Add', 't', 'a'], 't')),
        declare('b', 'real', ['g', 1]),
        ['Assign', 'a', 10],
        ['Add', 'b', ['g', 3]],
      ],
    ],
    [
      'a call in a branch, where the local was written',
      [
        'Block',
        declare('a', 'real', 'x'),
        declare('g', 'function', fn(['Multiply', 't', 'a'], 't')),
        declare('r', 'real', 0),
        ['If', ['Greater', 'x', 0], ['Block', ['Assign', 'a', ['Add', 'a', 1]], ['Assign', 'r', ['g', 2]]], ['Assign', 'r', ['g', 3]]],
        ['Add', 'r', ['g', 1]],
      ],
    ],
    [
      'a call in a loop that writes the local',
      [
        'Block',
        declare('a', 'real', 'x'),
        declare('g', 'function', fn(['Add', 't', 'a'], 't')),
        declare('s', 'real', 0),
        ['Loop', ['Block', ['Assign', 'a', ['Multiply', 'a', 2]], ['Assign', 's', ['Add', 's', ['g', 'i']]]], ['Element', 'i', ['Range', 1, 3]]],
        's',
      ],
    ],
    [
      'a call in a loop before the write of the local: the local is carried',
      [
        'Block',
        declare('a', 'real', 'x'),
        declare('g', 'function', fn(['Add', 't', 'a'], 't')),
        declare('s', 'real', 0),
        ['Loop', ['Block', ['Assign', 's', ['Add', 's', ['g', 'i']]], ['Assign', 'a', 'i']], ['Element', 'i', ['Range', 1, 3]]],
        's',
      ],
    ],
    ['a call in a Sum', ['Block', declare('g', 'function', fn(['Multiply', 2, 't'], 't')), ['Sum', ['g', 'j'], ['Limits', 'j', 1, 3]]]],
    [
      'a local function that calls another one',
      ['Block', declare('g', 'function', fn(['Multiply', 3, 't'], 't')), declare('h', 'function', fn(['Add', ['g', 't'], 1], 't')), ['h', 'x']],
    ],
    [
      'a local function that calls another one that reads a local',
      [
        'Block',
        declare('a', 'real', ['Add', 'x', 1]),
        declare('g', 'function', fn(['Multiply', 'a', 't'], 't')),
        declare('h', 'function', fn(['Add', ['g', 't'], 1], 't')),
        ['Assign', 'a', ['Multiply', 'a', 2]],
        ['h', 'x'],
      ],
    ],
    ['in a block at the place of the value', ['Block', ['Block', declare('g', 'function', fn(['Multiply', 3, 't'], 't')), ['g', 'x']]]],
  ])('%s', (_name, json) => {
    check(json, INPUTS, ['strict']);
  });

  test('the code: a helper of the program, with the captured names as parameters', () => {
    const code = check(['Block', declare('g', 'function', fn(['Add', ['Power', 't', 2], 'x'], 't')), ['Add', 1, ['g', 3]]], INPUTS, ['strict']);
    expect(code).toBe('1 + _tv1(3, _.x)');
  });

  test('in the body of a Function, it reads a parameter', () => {
    check(fn(['Block', declare('g', 'function', fn(['Add', 's', 't'], 't')), ['Add', ['g', 1], ['g', 2]]], real('s')), [[1.5], [-2]], ['strict']);
  });

  test('from LaTeX', () => {
    const ce = engine();
    for (const latex of ['g(t) \\coloneq t^2 + x; g(3)+1', 'a \\coloneq 2x; g(t) \\coloneq t + a; g(1)'])
      check(ce.parse(latex).json as MathJsonExpression, INPUTS, ['strict'], ce);
  });

  test.each<[string, MathJsonExpression, RegExp]>([
    [
      'a local function that calls itself',
      ['Block', declare('g', 'function', fn(['If', ['Less', 't', 1], 0, ['Add', 1, ['g', ['Subtract', 't', 1]]]], 't')), ['g', 3]],
      /the helper g calls itself/,
    ],
    [
      'a local function in a branch',
      ['Block', declare('a', 'real', 0), ['If', ['Greater', 'x', 0], ['Block', ['DefineFunction', 'g', fn(['Add', 't', 1], 't')], ['Assign', 'a', ['g', 'x']]]], 'a'],
      /admits the local function g only as a statement of the body, not in a branch, a loop, a nested block or an operand/,
    ],
    [
      'a second definition',
      ['Block', declare('g', 'function', fn(['Add', 't', 1], 't')), declare('b', 'real', ['g', 1]), ['Assign', 'g', fn(['Multiply', 10, 't'], 't')], ['Add', 'b', ['g', 2]]],
      /the write of a function literal to g defines a local function only as the first write to a new local of the block/,
    ],
    [
      'a local function with the name of a library operator',
      ['Block', declare('Sin', 'function', fn(['Add', 't', 1], 't')), ['Sin', 'x']],
      /the local function Sin has the name of a parameter, a local, another function or an operator of the library/,
    ],
    [
      'a declared signature',
      ['Block', declare('g', '(real) -> real', fn(['Multiply', 2, 't'], 't')), ['g', 'x']],
      /the local function g is declared \(real\) -> real/,
    ],
    [
      'a parameter with the name of a local',
      ['Block', declare('a', 'real', 'x'), declare('g', 'function', fn(['Multiply', 2, 'a'], 'a')), ['g', 'x']],
      /the parameter a of the local function g has the name of a parameter, an input or a local of the body around it/,
    ],
    [
      // The existing compiler compiles the closure, and declines `Min` of a
      // complex operand in its body.
      'a local function that is not called',
      ['Block', declare('g', 'function', fn(['Min', 'x', ['Complex', 0.5, -1]], 'v')), 1],
      /the local function g is not called/,
    ],
    [
      'a read of a local that a later statement declares',
      [
        'Block',
        declare('g', 'function', fn(['Add', 't', 'a'], 't')),
        ['Assign', 'a', ['Multiply', 2, 'x']],
        ['g', 3],
      ],
      /the local function g reads a, a local of the block declared after it/,
    ],
    [
      'a local function used as a value',
      ['Block', declare('g', 'function', fn(['Multiply', 2, 't'], 't')), ['Map', ['List', 1, 2], 'g']],
      /./,
    ],
  ])('declines %s', (_name, json, message) => {
    declines(json, message, engine(), ['strict']);
  });

  test('in the complex mode, a local function declines', () => {
    // The existing compiler reads the value of a call as a complex value
    // there (`_SYS.cplx(g(…))`), whatever the body.
    declines(
      ['Block', declare('g', 'function', fn(['Multiply', 2, 't'], real('t'))), ['Add', ['g', 'x'], 1]],
      /admits the local function g only in the strict mode: in the complex mode the existing compiler reads the value of its calls as a complex value/,
      engine(),
      ['complex']
    );
  });

  test('a local function in the body of a helper declines', () => {
    const ce = engine();
    ce.assign('f', ce.expr(fn(['Block', declare('g', 'function', fn(['Add', 'u', 1], 'u')), ['g', 't']], 't')));
    declines(['f', 'x'], /admits no local function in the body of a helper/, ce, ['strict']);
  });
});

describe('a helper declared function', () => {
  const helper = (ce: ComputeEngine, name: string, literal: MathJsonExpression) => {
    ce.declare(name, 'function');
    ce.assign(name, ce.expr(literal));
  };

  test.each<[string, MathJsonExpression, MathJsonExpression, readonly Mode[]]>([
    ['a parameter with no annotation', fn(['Multiply', 3, 't'], 't'), ['Add', ['f', 'x'], 1], ['strict']],
    ['an annotated parameter', fn(['Sqrt', 't'], real('t')), ['Add', ['f', 'x'], 1], ['strict']],
    ['a boolean result', fn(['Greater', 't', 1], 't'), ['If', ['f', 'x'], 1, 2], ['strict']],
    ['a body with a local', fn(['Block', declare('a', 'real', ['Multiply', 't', 2]), ['Add', 'a', 1]], 't'), ['f', 'x'], ['strict']],
    ['an integer argument', fn(['Multiply', 't', 0.5], 't'), ['f', 'k'], ['strict']],
  ])('%s', (_name, literal, root, modes) => {
    const ce = engine();
    helper(ce, 'f', literal);
    check(root, INPUTS, modes, ce);
  });

  test('the code', () => {
    const ce = engine();
    helper(ce, 'f', fn(['Multiply', 3, 't'], 't'));
    const result = compile(ce.expr(['Add', ['f', 'x'], 1]), PROFILE as never) as CompilationResult<'javascript'> & { preamble?: string };
    expect(result.code).toBe('_tv1(_.x) + 1');
  });

  test('a body with an Integrate with no closed form declines', () => {
    // An integral with a closed form is admitted
    // (`compile-javascript-structured-calculus.test.ts`).
    const ce = engine();
    helper(
      ce,
      'f',
      fn(['Integrate', ['Sqrt', ['Add', 't', ['Power', 'u', 4]]], ['Limits', 'u', 0, 1]], 't')
    );
    declines(['f', 'x'], /has no closed form/, ce, ['strict']);
  });

  test('in the complex mode, a helper declared function declines', () => {
    // The existing compiler reads each parameter, also one annotated
    // `real`, and the value as complex values there: `i · f(x)` with
    // `f(t: real) := 2t` has the real part `-0` at `x = -0.75`.
    const ce = engine();
    helper(ce, 'f', fn(['Multiply', 2, 't'], real('t')));
    declines(
      ['Multiply', 'ImaginaryUnit', ['f', 'x']],
      /the helper f is declared function: in the complex mode the existing compiler reads each of its parameters and its value as complex values/,
      ce,
      ['complex']
    );
  });
});

describe('a local function and the host', () => {
  // The functions of the host, global so that the code of both compilers
  // calls them: `__h` writes the inputs object and logs, `__T` logs.
  const host = globalThis as unknown as {
    __log: string[];
    __vars: Record<string, number>;
    __h: (t: number) => number;
    __T: () => number;
  };
  beforeEach(() => {
    host.__log = [];
    host.__h = (t: number) => {
      host.__log.push('h');
      host.__vars.x = 9;
      return t;
    };
    host.__T = () => {
      host.__log.push('T');
      return 2;
    };
  });

  function hostEngine(): ComputeEngine {
    const ce = engine();
    ce.declare('h', '(real) -> real');
    ce.declare('T', 'real');
    return ce;
  }

  /** The value and the log of the host of a run of `result`. */
  function runLogged(result: CompilationResult<'javascript'>, input: Record<string, number>): [unknown, string[]] {
    host.__log = [];
    host.__vars = { ...input };
    const value = result.run!(host.__vars as never);
    return [value, host.__log];
  }

  const READS_INPUT: MathJsonExpression = [
    'Block',
    declare('g', 'function', fn(['If', ['Greater', ['h', 't'], 0], 'x', 0], real('t'))),
    ['g', 1],
  ];

  test('a local function that reads an input declines when the program calls a host function that is not pure', () => {
    // The existing closure reads `_.x` after `h` writes it: 9, not 4.
    const expr = hostEngine().expr(READS_INPUT);
    const options = { functions: { h: '__h' } };
    const existing = compile(expr, { ...EXISTING, ...options } as never) as CompilationResult<'javascript'>;
    expect(runLogged(existing, { x: 4 })).toEqual([9, ['h']]);
    expect(() => compile(expr, { ...PROFILE, ...options } as never)).toThrow(
      /the local function g reads the input x, and the program has a read or a call of the host that is not declared pure/
    );
  });

  test('with a host function declared pure, it is admitted', () => {
    const expr = hostEngine().expr(READS_INPUT);
    const options = { functions: { h: { source: 'Math.abs', pure: true } } };
    const existing = compile(expr, { ...EXISTING, ...options } as never) as CompilationResult<'javascript'>;
    const profile = compile(expr, { ...PROFILE, ...options } as never) as CompilationResult<'javascript'>;
    for (const x of XS) expect(same(profile.run!({ x } as never), existing.run!({ x } as never))).toBe(true);
  });

  test('a local function that reads a local calls the host in the order of the existing compiler', () => {
    const expr = hostEngine().expr([
      'Block',
      declare('a', 'real', ['Multiply', 2, 'x']),
      declare('g', 'function', fn(['Add', ['h', 't'], 'a'], real('t'))),
      ['g', 1],
    ]);
    const options = { functions: { h: '__h' } };
    const existing = compile(expr, { ...EXISTING, ...options } as never) as CompilationResult<'javascript'>;
    const profile = compile(expr, { ...PROFILE, ...options } as never) as CompilationResult<'javascript'>;
    expect(runLogged(profile, { x: 4 })).toEqual(runLogged(existing, { x: 4 }));
    expect(runLogged(profile, { x: 4 })).toEqual([9, ['h']]);
  });

  test('a local function that reads a host read declines', () => {
    const ce = hostEngine();
    const options = { vars: { T: '__T()' } };
    // The existing closure reads `T` where its body reads it: not at all
    // when the branch is not taken.
    const branch = ce.expr([
      'Block',
      declare('g', 'function', fn(['If', ['Greater', 't', 0], 'T', 0], real('t'))),
      ['Add', ['g', 'x'], 1],
    ]);
    const existing = compile(branch, { ...EXISTING, ...options } as never) as CompilationResult<'javascript'>;
    expect(runLogged(existing, { x: -1 })).toEqual([1, []]);
    expect(() => compile(branch, { ...PROFILE, ...options } as never)).toThrow(
      /the local function g reads T, a read of the host/
    );
    // And after the call of `h` in its body.
    const order = ce.expr(['Block', declare('g', 'function', fn(['Divide', ['h', 't'], 'T'], real('t'))), ['g', 'x']]);
    const both = { ...options, functions: { h: '__h' } };
    const existingOrder = compile(order, { ...EXISTING, ...both } as never) as CompilationResult<'javascript'>;
    expect(runLogged(existingOrder, { x: 3 })).toEqual([1.5, ['h', 'T']]);
    expect(() => compile(order, { ...PROFILE, ...both } as never)).toThrow(
      /the local function g reads T, a read of the host/
    );
  });
});

describe('another angular unit than radians', () => {
  function degrees(): ComputeEngine {
    const ce = engine();
    ce.angularUnit = 'deg';
    return ce;
  }
  const DEGREES = [30, -45, 0, 90].map((x) => ({ x, y: 2.5, k: 3 }));

  test.each([
    ['the root block', ['Block', letLocal('a', ['Sin', 'x']), ['Multiply', 'a', 'a']]],
    ['an operand block', ['Add', ['Block', letLocal('a', ['Sin', 'x']), ['Multiply', 'a', 'a']], 1]],
  ] as [string, MathJsonExpression][])('a let local in the dictionary form declines, in %s', (_name, json) => {
    // `rewriteAngularUnit()` does not reach the value of the dictionary
    // (CE-1207): both compilers read `sin(x)` in radians.
    declines(json, /the local a is declared with its value in a dictionary, and the angular unit is deg/, degrees());
  });

  test.each([
    ['a local declared real', ['Add', ['Block', declare('a', 'real', ['Sin', 'x']), ['Multiply', 'a', 'a']], 1]],
    ['an implicit local', ['Block', ['Assign', 'a', ['Sin', 'x']], ['Multiply', 'a', 'a']]],
    [
      'a call of a local function in a trigonometric operand',
      ['Block', declare('g', 'function', fn(['Add', 't', 1], 't')), ['Sin', ['g', 'x']]],
    ],
    [
      'a local function whose body is trigonometric',
      [
        'Block',
        declare('a', 'real', ['Multiply', 2, 'x']),
        declare('g', 'function', fn(['Add', ['Sin', 't'], 'a'], 't')),
        ['g', 'x'],
      ],
    ],
  ] as [string, MathJsonExpression][])('%s is admitted', (_name, json) => {
    check(json, DEGREES, ['strict'], degrees());
  });
});

describe('a local function, other forms', () => {
  test('a first write of a function literal is a local function', () => {
    const code = check(['Block', ['Assign', 'g', fn(['Add', 't', 1], 't')], ['Add', ['g', 'x'], 1]], INPUTS, ['strict']);
    expect(code).toBe('_tv1(_.x) + 1');
  });

  test.each([
    [
      'a write to a local function',
      ['Block', ['Assign', 'g', fn(['Add', 't', 1], 't')], ['Assign', 'g', 3], ['g', 'x']],
      /./,
    ],
    [
      'a second write of a function literal',
      ['Block', ['Assign', 'g', fn(['Add', 't', 1], 't')], ['Assign', 'g', fn(['Add', 't', 2], 't')], ['g', 'x']],
      /./,
    ],
    [
      'a local function read as a value by another one',
      [
        'Block',
        declare('g', 'function', fn(['Add', 't', 1], 't')),
        declare('h', 'function', fn(['Add', ['g', 't'], 'g'], 't')),
        ['h', 'x'],
      ],
      /the local function h reads the local function g as a value/,
    ],
  ] as [string, MathJsonExpression, RegExp][])('%s declines', (_name, json, message) => {
    declines(json, message, engine(), ['strict']);
  });
});

describe('a local function or a helper in degrees', () => {
  function degrees(): ComputeEngine {
    const ce = engine();
    ce.angularUnit = 'deg';
    return ce;
  }
  const DEGREES = [30, -45, 0, 90].map((x) => ({ x, y: 2.5, k: 3 }));
  const SIN = fn(['Sin', 't'], 't');

  /** The value of the profile at x = 30, after `check()`. */
  function at30(json: MathJsonExpression, ce: ComputeEngine): unknown {
    check(json, DEGREES, ['strict'], ce);
    const profile = compile(ce.expr(json), PROFILE as never) as CompilationResult<'javascript'>;
    return profile.run!({ x: 30, y: 2.5, k: 3 } as never);
  }

  test.each([
    ['Declare(g, function, F)', ['Block', declare('g', 'function', SIN), ['g', 'x']]],
    ['Declare(g, unknown, F)', ['Block', declare('g', 'unknown', SIN), ['g', 'x']]],
    ['DefineFunction(g, F)', ['Block', ['DefineFunction', 'g', SIN], ['g', 'x']]],
    ['Assign(g, F)', ['Block', ['Assign', 'g', SIN], ['g', 'x']]],
  ] as [string, MathJsonExpression][])('%s gives sin(30°)', (_name, json) => {
    expect(at30(json, degrees())).toBeCloseTo(0.5, 15);
  });

  test('Declare(g, {value: F}) declines', () => {
    // `rewriteAngularUnit()` does not reach the value of the dictionary
    // (CE-1207).
    declines(
      ['Block', letLocal('g', SIN), ['g', 'x']],
      /the local function g is declared with its value in a dictionary, and the angular unit is deg/,
      degrees(),
      ['strict']
    );
  });

  test('a helper declared function gives sin(30°)', () => {
    const ce = degrees();
    ce.declare('f', 'function');
    ce.assign('f', ce.expr(fn(['Sin', 't'], real('t'))));
    expect(at30(['f', 'x'], ce)).toBeCloseTo(0.5, 15);
  });

  test('a helper with a declared signature gives sin(30°)', () => {
    const ce = degrees();
    ce.declare('f', '(real) -> real');
    ce.assign('f', ce.expr(fn(['Sin', 't'], real('t'))));
    expect(at30(['f', 'x'], ce)).toBeCloseTo(0.5, 15);
  });
});

describe('a first write in degrees', () => {
  function degrees(): ComputeEngine {
    const ce = engine();
    ce.angularUnit = 'deg';
    return ce;
  }
  const ARCTAN: MathJsonExpression = ['Block', ['Assign', 't', 'x'], ['Arctan', 't']];

  test('in the complex mode it declines', () => {
    // The existing compiler gives `NaN` (`57.29… * _SYS.catan(_SYS.cplx(t))`)
    // where the interpreter gives 45 at x = 1.
    declines(
      ARCTAN,
      /the first write to t declares a local of the block, and in the complex mode with the angular unit deg/,
      degrees(),
      ['complex']
    );
  });

  test('in the strict mode it is admitted', () => {
    check(ARCTAN, [1, -1, 0, 0.5].map((x) => ({ x, y: 2.5, k: 3 })), ['strict'], degrees());
  });
});
