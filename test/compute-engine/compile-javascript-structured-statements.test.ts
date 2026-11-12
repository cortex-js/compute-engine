import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Statements and loops on the structured route of the JavaScript compiler
// (the `numeric-kernel` profile): loops with no index set or with several,
// loops over a list value or a range with a step, comprehensions with
// several generators or over a list, destructuring declarations and writes,
// `Return`, and helpers with a default value. For each admitted program
// the profile gives the doubles and the shape of the existing compiler with
// `cse: false, constantFold: false` (`Object.is` at every depth), and the
// value of the interpreter; the inputs are not changed; every other program
// declines with a message that names its cause.
// docs/plans/2026-11-11-structured-options-and-bindings.md, "Result of the
// statement and loop forms".

const EXISTING = { cse: false, constantFold: false, fallback: false } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;

type Mode = 'strict' | 'complex';

const declare = (name: string, type: string, value: MathJsonExpression): MathJsonExpression => [
  'Declare',
  name,
  `'${type}'`,
  value,
];
const letLocal = (name: MathJsonExpression, value: MathJsonExpression): MathJsonExpression => [
  'Declare',
  name,
  ['Dictionary', ['KeyValuePair', { str: 'value' }, value]],
];
const fn = (body: MathJsonExpression, ...parameters: MathJsonExpression[]): MathJsonExpression => [
  'Function',
  body,
  ...parameters,
];
const typed = (name: string, type = 'real'): MathJsonExpression => ['Typed', name, `'${type}'`];
const range = (index: string, a: MathJsonExpression, b: MathJsonExpression, step?: MathJsonExpression): MathJsonExpression => [
  'Element',
  index,
  step === undefined ? ['Range', a, b] : ['Range', a, b, step],
];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('n', 'integer');
  ce.declare('L', 'list<real>');
  return ce;
}

const INPUTS: Record<string, unknown>[] = [
  { x: 1.5, y: 2.5, n: 3, L: [1, -2, 0.5] },
  { x: -0.75, y: -0, n: 0, L: [] },
  { x: 0, y: 7, n: 5, L: [3] },
  { x: -0, y: 0.1, n: -2, L: [-0, 4, 4, 1e-3] },
];

/** The same value at every depth: `Object.is` for numbers. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return (
      same(ka, kb) &&
      ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    );
  }
  return a === b;
}

const copy = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

function run(result: CompilationResult<'javascript'>, input: unknown): unknown {
  return Array.isArray(input)
    ? (result.run as unknown as (...a: unknown[]) => unknown)(...input.map(copyInput))
    : result.run!(copyInput(input) as never);
}

// Each run gets its own copy of the input, compared after the call.
let lastInput: unknown;
function copyInput(v: unknown): unknown {
  lastInput = v;
  return v;
}

function boxedValue(ce: ComputeEngine, v: unknown): Expression {
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (typeof v === 'number') return ce.number(v);
  if (Array.isArray(v)) return ce.function('List', v.map((e) => boxedValue(ce, e)));
  throw new Error(`no boxed value for ${JSON.stringify(v)}`);
}

function plain(value: Expression): unknown {
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  if (value.operator === 'List' || value.operator === 'Tuple')
    return (value.ops ?? []).map(plain);
  // A lazy collection (a comprehension): its elements.
  if (value.isCollection) return [...value.each()].map((e) => plain(e.evaluate()));
  const n = value.N();
  return n.im === 0 ? n.re : { re: n.re, im: n.im };
}

/** The value of the interpreter: `expr` applied to `input`. */
function interpret(ce: ComputeEngine, expr: Expression, input: Record<string, unknown> | unknown[], names: string[]): unknown {
  const value = Array.isArray(input)
    ? ce.function('Apply', [expr, ...input.map((v) => boxedValue(ce, v))]).evaluate()
    : // The inputs are substituted: a comprehension is a lazy view, whose
      // elements an application would read outside the frame of its call.
      expr
        .subs(Object.fromEntries(names.map((n) => [n, boxedValue(ce, (input as Record<string, unknown>)[n])])))
        .evaluate();
  return plain(value);
}

function closeTo(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return Number.isNaN(a) ? Number.isNaN(b) : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => closeTo(v, b[i]));
  return same(a, b);
}

/**
 * Compile `json` with both compilers in each mode, compare the values at
 * each input (and that the input is not changed), and with the
 * interpreter (`interpreter: false` to skip it). Returns the code of the
 * profile in the first mode.
 */
function check(
  json: MathJsonExpression,
  options: {
    inputs?: (Record<string, unknown> | unknown[])[];
    modes?: readonly Mode[];
    ce?: ComputeEngine;
    interpreter?: boolean;
    extra?: Record<string, unknown>;
  } = {}
): string {
  const ce = options.ce ?? engine();
  const inputs = options.inputs ?? INPUTS;
  const modes = options.modes ?? ['strict'];
  const expr = ce.expr(json);
  const compiled = modes.map((mode) => {
    const existing = compile(expr, { ...EXISTING, ...options.extra, mode } as never) as CompilationResult<'javascript'>;
    const profile = compile(expr, { ...PROFILE, ...options.extra, mode } as never) as CompilationResult<'javascript'>;
    expect(existing.success).toBe(true);
    expect(profile.success).toBe(true);
    return { mode, existing, profile };
  });
  const names = expr.operator === 'Function' ? [] : expr.unknowns.filter((n) => n !== 'Nothing');
  for (const { mode, existing, profile } of compiled)
    for (const input of inputs) {
      const outcome = (r: CompilationResult<'javascript'>) => {
        const given = copy(input);
        try {
          const value = run(r, given);
          expect(lastInput).toEqual(copy(input));
          return { value };
        } catch (e) {
          return { error: `${(e as Error).constructor.name}: ${(e as Error).message}` };
        }
      };
      const a = outcome(existing);
      const b = outcome(profile);
      if (!same(a, b))
        throw new Error(
          `${mode} ${JSON.stringify(input)}: existing ${JSON.stringify(a)}, profile ${JSON.stringify(b)}\n${profile.code}`
        );
      if (options.interpreter !== false && 'value' in b) {
        const i = interpret(ce, expr, input, names);
        if (!closeTo(i, b.value))
          throw new Error(`${mode} ${JSON.stringify(input)}: interpreter ${JSON.stringify(i)}, profile ${JSON.stringify(b.value)}`);
      }
    }
  return compiled[0].profile.code;
}

/** The profile declines `json` with `message`, in each mode of `modes`. */
function declines(
  json: MathJsonExpression,
  message: RegExp,
  ce: ComputeEngine = engine(),
  modes: readonly Mode[] = ['strict']
): void {
  const expr = ce.expr(json);
  for (const mode of modes)
    expect(() => compile(expr, { ...PROFILE, mode } as never)).toThrow(message);
}

const FN_INPUTS = [[1.5, 3], [-0.75, 0], [0, 5], [-0, -2]];

describe('a Loop with several index sets', () => {
  test.each<[string, MathJsonExpression]>([
    [
      'two literal ranges, the first outermost',
      ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', ['Multiply', 's', 10], 'i', ['Multiply', 2, 'j']]], range('i', 1, 3), range('j', 1, 2)], 's'],
    ],
    [
      'a later range that reads an earlier index',
      ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', ['Multiply', 's', 10], 'i', 'j']], range('i', 1, 3), range('j', 1, 'i')], 's'],
    ],
    [
      'bounds that read an input, and an empty inner range',
      ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', 's', ['Multiply', 'i', 'j', 'x']]], range('i', 1, 'n'), range('j', 'i', 'n')], 's'],
    ],
    [
      'three index sets',
      ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', ['Multiply', 's', 3], 'i', 'j', 'k']], range('i', 1, 2), range('j', 'i', 2), range('k', 1, 'j')], 's'],
    ],
    [
      'a range and a list',
      ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', ['Multiply', 's', 2], ['Multiply', 'i', 'c']]], range('i', 1, 2), ['Element', 'c', 'L']], 's'],
    ],
    [
      'two carried locals and a nested Loop',
      [
        'Block',
        declare('s', 'real', 0),
        declare('t', 'real', 1),
        ['Loop', ['Block', ['Assign', 's', ['Add', 's', 'i']], ['Loop', ['Assign', 't', ['Multiply', 't', ['Add', 'x', 'j', 'k']]], range('k', 1, 2)]], range('i', 1, 2), range('j', 1, 2)],
        ['Add', 's', 't'],
      ],
    ],
  ])('%s', (_name, json) => {
    check(json);
  });

  test('the loops are nested in the order of the index sets', () => {
    const code = check(['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', ['Multiply', 's', 10], 'i', 'j']], range('i', 1, 3), range('j', 1, 'i')], 's'], { inputs: [{}] });
    // The outer loop runs over `i`, the inner one over `j` from 1 to `i`.
    expect(code.match(/for \(/g)?.length).toBe(2);
  });

  test('the iteration budget counts each pass of each index set', () => {
    for (const budget of [3, 4, 5, 12, 13])
      check(['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', 's', 'i', 'j']], range('i', 1, 3), range('j', 1, 3)], 's'], {
        inputs: [{}],
        extra: { iterationBudget: budget },
        interpreter: false,
      });
  });

  test('a list carried and updated in place in two nested index sets', () => {
    const json: MathJsonExpression = [
      'Block',
      letLocal('M', ['Comprehension', 0, range('k', 1, 6)]),
      ['Loop', ['Assign', 'M', ['ReplaceAt', 'M', ['Add', ['Multiply', 3, ['Subtract', 'i', 1]], 'j'], ['Add', ['At', 'M', 'j'], ['Multiply', 'i', 'x']]]], range('i', 1, 2), range('j', 1, 3)],
      'M',
    ];
    // The interpreter does not evaluate `ReplaceAt` of this local.
    check(json, { interpreter: false });
    // An input list carried by the loops is copied, never written.
    check(['Block', letLocal('M', 'L'), ['Loop', ['Assign', 'M', ['ReplaceAt', 'M', 1, ['Add', ['At', 'M', 1], 'i', 'j']]], range('i', 1, 2), range('j', 1, 2)], 'M'], {
      inputs: INPUTS.filter((i) => (i.L as number[]).length > 0),
    });
  });

  test('in the body of a root Function', () => {
    check(fn(['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', 's', ['Multiply', 'i', 'j', 't']]], range('i', 1, 'm'), range('j', 'i', 'm')], 's'], typed('t'), typed('m', 'integer')), {
      inputs: FN_INPUTS,
    });
  });

  test('a Break declines, as on the existing compiler', () => {
    declines(
      ['Block', declare('s', 'real', 0), ['Loop', ['Block', ['If', ['Greater', 's', 5], ['Break']], ['Assign', 's', ['Add', 's', 'i', 'j']]], range('i', 1, 3), range('j', 1, 3)], 's'],
      /no Break inside a Loop over several index sets/
    );
  });

  test('a Break of a nested Loop in the body is admitted', () => {
    check([
      'Block',
      declare('s', 'real', 0),
      ['Loop', ['Loop', ['Block', ['If', ['Greater', 'k', 'i'], ['Break']], ['Assign', 's', ['Add', ['Multiply', 's', 10], 'k']]], range('k', 1, 3)], range('i', 1, 2), range('j', 1, 2)],
      's',
    ]);
  });

  test('two index sets with one name decline', () => {
    declines(['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', 's', 'i']], range('i', 1, 3), range('i', 1, 2)], 's'], /the loop index i has the name/);
  });
});

describe('a Loop with no index set', () => {
  test.each<[string, MathJsonExpression]>([
    [
      'a while loop',
      ['Block', declare('s', 'real', 0), ['Loop', ['Block', ['If', ['Less', 'x', 's'], ['Break']], ['Assign', 's', ['Add', 's', 1]]]], 's'],
    ],
    [
      'the form of an Epsil while loop',
      [
        'Block',
        letLocal('i', 1),
        letLocal('m', 0),
        ['Loop', ['Block', ['If', ['Not', ['LessEqual', 'i', 'n']], ['Break']], ['Block', ['Assign', 'm', ['Add', 'm', ['Multiply', 'i', 'x']]], ['Assign', 'i', ['Add', 'i', 1]]]]],
        'm',
      ],
    ],
    [
      'two locals and a Break in a nested branch',
      [
        'Block',
        letLocal('a', 'x'),
        letLocal('b', 0),
        ['Loop', ['Block', ['Assign', 'b', ['Add', 'b', 1]], ['If', ['Greater', 'b', 3], ['Break'], ['If', ['Greater', 'a', 100], ['Break'], ['Assign', 'a', ['Add', ['Multiply', 2, 'a'], 1]]]]]],
        ['Add', 'a', 'b'],
      ],
    ],
    [
      'a list built until a condition holds',
      ['Block', letLocal('xs', ['List']), letLocal('i', 1), ['Loop', ['Block', ['If', ['Greater', 'i', 3], ['Break']], ['Assign', 'xs', ['Append', 'xs', ['Multiply', 'i', 'x']]], ['Assign', 'i', ['Add', 'i', 1]]]], 'xs'],
    ],
  ])('%s', (_name, json) => {
    check(json);
  });

  test('the code is a while loop', () => {
    const code = check(['Block', declare('s', 'real', 0), ['Loop', ['Block', ['If', ['Less', 'x', 's'], ['Break']], ['Assign', 's', ['Add', 's', 1]]]], 's']);
    expect(code).toMatch(/while \(true\)/);
  });

  test('the iteration budget stops a loop with no Break, as on the existing compiler', () => {
    for (const budget of [1, 10])
      check(['Block', ['Assign', 's', 0], ['Loop', ['Assign', 's', ['Add', 's', 1]]], 's'], { inputs: [{}], extra: { iterationBudget: budget }, interpreter: false });
    check(['Block', ['Assign', 's', 0], ['Loop', ['Block', ['Assign', 's', ['Add', 's', 1]], ['If', ['Equal', 's', 3], ['Break']]]], 's'], {
      inputs: [{}],
      extra: { iterationBudget: 3 },
      interpreter: false,
    });
  });

  test('a body that always ends in Break declines', () => {
    declines(['Block', declare('s', 'real', 0), ['Loop', ['Block', ['Assign', 's', 'x'], ['Break']]], 's'], /a Break only as the last statement of a branch of an If/);
    declines(
      ['Block', declare('s', 'real', 0), ['Loop', ['If', ['Less', 'x', 0], ['Break'], ['Break']]], 's'],
      /no Loop whose body always ends in Break/
    );
  });
});

describe('a Loop over a list value or a range with a step', () => {
  test.each<[string, MathJsonExpression]>([
    ['a list literal', ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', ['Multiply', 's', 10], 'c']], ['Element', 'c', ['List', 5, 6, 7]]], 's']],
    ['a list of inputs', ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', ['Multiply', 's', 2], 'c']], ['Element', 'c', ['List', 'x', 'y', 1]]], 's']],
    ['a range with an integer step', ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', ['Multiply', 's', 10], 'i']], range('i', 1, 9, 3)], 's']],
    ['a range with a negative step', ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', ['Multiply', 's', 10], 'i']], range('i', 9, 1, -2)], 's']],
    ['a range with a real step', ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', ['Multiply', 's', 3], 'i']], range('i', 0, 1, 0.1)], 's']],
    ['a range with a step that reads an input', ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', 's', 'i']], range('i', 1, 10, 'n')], 's']],
    ['a function of lists', ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', ['Multiply', 's', 2], 'c']], ['Element', 'c', ['Reverse', 'L']]], 's']],
  ])('%s', (_name, json) => {
    check(json);
  });
});

describe('a Comprehension with several generators or over a list', () => {
  test.each<[string, MathJsonExpression]>([
    ['two ranges', ['Comprehension', ['Add', ['Multiply', 10, 'i'], 'j'], range('i', 1, 3), range('j', 1, 2)]],
    ['a later range that reads an earlier index', ['Comprehension', ['Add', ['Multiply', 10, 'i'], 'j'], range('i', 1, 3), range('j', 1, 'i')]],
    ['a filter that reads an earlier generator', ['Comprehension', ['Add', ['Multiply', 10, 'i'], 'j'], range('i', 1, 3), ['Element', 'j', ['Range', 1, 3], ['Less', 'i', 'j']]]],
    ['a filter on the first generator', ['Comprehension', ['Multiply', 'i', 'j', 'x'], ['Element', 'i', ['Range', 1, 4], ['Less', 1, 'i']], range('j', 1, 2)]],
    ['a list literal', ['Comprehension', ['Multiply', 'c', 'x'], ['Element', 'c', ['List', 5, 6, 7]]]],
    ['a list input', ['Comprehension', ['Add', 'c', 'y'], ['Element', 'c', 'L']]],
    ['a list input and a range', ['Comprehension', ['Multiply', 'c', 'i'], ['Element', 'c', 'L'], range('i', 1, 2)]],
    ['a list input with a filter', ['Comprehension', ['Multiply', 2, 'c'], ['Element', 'c', 'L', ['Less', 0, 'c']]]],
    ['a range with a step', ['Comprehension', ['Multiply', 'k', 'x'], range('k', 1, 9, 2)]],
    ['a range with a step that reads an input', ['Comprehension', ['Multiply', 'k', 'x'], range('k', 1, 10, 'n')]],
    ['tuples of two generators', ['Comprehension', ['Tuple', 'i', 'j'], range('i', 1, 2), range('j', 3, 4)]],
  ])('%s', (_name, json) => {
    check(json);
  });

  test('the source of an inner generator is evaluated once per pass of the outer one', () => {
    const code = check(['Comprehension', ['Add', 'i', 'j'], range('i', 1, 3), range('j', 1, ['Multiply', 2, 'i'])]);
    // The bound `2i` is computed in the body of the outer loop.
    expect(code).toMatch(/for \(let (\w+) = 0; \1 <= \w+; \1\+\+\) \{ const (\w+) = .*2 \* \2/);
  });

  test('a source after the first that calls the host declines', () => {
    const ce = engine();
    ce.declare('g', '(real) -> integer');
    const expr = ce.expr(['Comprehension', ['Add', 'i', 'j'], range('i', 1, 3), range('j', 1, ['g', 'i'])]);
    expect(() => compile(expr, { ...PROFILE, functions: { g: (t: number) => t } } as never)).toThrow(/not pure/);
  });

  test('a filter that reads a later generator declines', () => {
    declines(['Comprehension', 'i', ['Element', 'i', ['Range', 1, 3], ['Less', 'i', 'j']], range('j', 1, 2)], /reads the index j of a later generator/);
  });

  test('a body that is not pure declines', () => {
    declines(['Comprehension', ['Add', 'i', ['Random']], range('i', 1, 3), range('j', 1, 2)], /not pure/);
  });
});

describe('a destructuring declaration or write', () => {
  const step = (ce: ComputeEngine) => {
    ce.assign('step', ce.expr(['Function', ['Tuple', ['Multiply', 2, 'k'], ['Add', 'k', 1]], typed('k')] as MathJsonExpression));
    return ce;
  };
  test.each<[string, MathJsonExpression]>([
    ['a declaration of a literal tuple', ['Block', letLocal(['Tuple', 'a', 'b'], ['Tuple', ['Multiply', 2, 'x'], 3]), ['Add', 'a', 'b']]],
    ['a declaration with the type unknown', ['Block', ['Declare', ['Tuple', 'a', 'b'], "'unknown'", ['Tuple', 3, ['Multiply', 4.5, 'x']]], ['Add', ['Multiply', 10, 'a'], 'b']]],
    ['a swap', ['Block', letLocal('a', 'x'), letLocal('b', 'y'), ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 'b', 'a']], ['Add', ['Multiply', 10, 'a'], 'b']]],
    ['a write that reads both names', ['Block', letLocal('a', 'x'), letLocal('b', 'y'), ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 'b', ['Add', 'a', 'b']]], ['Add', ['Multiply', 10, 'a'], 'b']]],
    ['integer locals', ['Block', declare('p', 'integer', 1), declare('q', 'integer', 2), ['Assign', ['Tuple', 'p', 'q'], ['Tuple', 7, 'n']], ['Add', ['Multiply', 100, 'p'], 'q']]],
    [
      'a Fibonacci loop',
      ['Block', letLocal('a', 'x'), letLocal('b', 'y'), ['Loop', ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 'b', ['Add', 'a', 'b']]], range('k', 1, 'n')], 'b'],
    ],
    ['a declaration in a loop body', ['Block', declare('s', 'real', 0), ['Loop', ['Block', letLocal(['Tuple', 'a', 'c'], ['Tuple', 'k', ['Multiply', 'k', 'x']]), ['Assign', 's', ['Add', 's', 'a', 'c']]], range('k', 1, 'n')], 's']],
  ])('%s', (_name, json) => {
    check(json);
  });

  test('a declaration of the value of a user function', () => {
    check(['Block', letLocal(['Tuple', 'v', 'j'], ['step', 'x']), ['Add', 'j', ['Multiply', 100, 'v']]], { ce: step(engine()) });
  });

  test('a write of the value of a user function', () => {
    check(['Block', letLocal('v', 'x'), letLocal('j', 'y'), ['Assign', ['Tuple', 'v', 'j'], ['step', 'j']], ['Add', 'j', ['Multiply', 100, 'v']]], { ce: step(engine()) });
  });

  test('every component is evaluated, in order, before a name is written', () => {
    // The host function is called through the runtime: it records in a
    // global.
    const calls: number[] = [];
    (globalThis as Record<string, unknown>).__statementsCalls = calls;
    const g = (t: number) => (((globalThis as Record<string, unknown>).__statementsCalls as number[]).push(t), t * 10);
    const ce = engine();
    ce.declare('g', '(real) -> real');
    const expr = ce.expr(['Block', letLocal('a', 1.5), letLocal('b', 2.5), ['Assign', ['Tuple', 'a', 'b'], ['Tuple', ['g', 'b'], ['g', 'a']]], ['Add', ['Multiply', 1000, 'a'], 'b']] as MathJsonExpression);
    const options = { functions: { g } };
    const existing = compile(expr, { ...EXISTING, ...options } as never) as CompilationResult<'javascript'>;
    const profile = compile(expr, { ...PROFILE, ...options } as never) as CompilationResult<'javascript'>;
    expect(profile.success).toBe(true);
    const a = existing.run!({} as never);
    const recorded = calls.splice(0);
    expect(profile.run!({} as never)).toBe(a);
    expect(calls).toEqual(recorded);
    expect(recorded).toEqual([2.5, 1.5]);
  });

  test('a value that is an input declines, as the interpreter rejects it', () => {
    const ce = engine();
    ce.declare('T', 'tuple<real, real>');
    declines(['Block', letLocal(['Tuple', 'a', 'b'], 'T'), ['Add', 'a', 'b']], /is not a literal tuple/, ce);
  });

  test('a write of a real component to an integer local declines', () => {
    declines(['Block', declare('p', 'integer', 1), declare('q', 'integer', 2), ['Assign', ['Tuple', 'p', 'q'], ['Tuple', 'x', 2]], 'p'], /a value written to the integer local p does not have the type integer/);
  });

  test('a write to a name that is not a declared local declines', () => {
    declines(['Block', ['Assign', ['Tuple', 'xs', 'm'], ['Tuple', ['List', 1, 2, 3], 2]], ['Length', 'xs']], /only writes to a declared local are supported/);
  });

  test('a declaration with a declared type declines', () => {
    declines(['Block', ['Declare', ['Tuple', 'a', 'b'], "'tuple<real, real>'", ['Tuple', 'x', 'y']], ['Add', 'a', 'b']], /admits a declaration with a value and no type, or the type unknown/);
  });
});

describe('Return in tail position', () => {
  test.each<[string, MathJsonExpression]>([
    ['the root', ['Return', ['Add', 'x', 1]]],
    ['the value of a root Block', ['Block', ['Return', ['Add', 'x', 1]]]],
    ['the branches of an If at the root', ['Block', ['If', ['Less', 0, 'x'], ['Return', 1], ['Return', 'y']]]],
    ['after a statement', ['Block', declare('t', 'real', ['Multiply', 2, 'x']), ['Return', ['Add', 't', 1]]]],
  ])('%s', (_name, json) => {
    // The interpreter gives the unevaluated `Return` there.
    check(json, { interpreter: false });
  });

  test('the branches of an If in a function body', () => {
    check(fn(['Block', declare('t', 'real', ['Multiply', 2, 'x']), ['If', ['Less', 't', 0], ['Return', ['Negate', 't']], ['Return', 't']]], typed('x')), { inputs: [[1.5], [-2], [0], [-0]] });
  });

  test('a Return in a branch before the end of a body declines', () => {
    declines(fn(['Block', ['If', ['Less', 'x', 0], ['Return', 0]], ['Add', 'x', 1]], typed('x')), /admits no statement Return in a branch of an If/);
  });

  test('one Return node in tail position and as an operand declines', () => {
    // The memo of the admission of a value does not hold the place of a
    // `Return`: a node that holds one is checked at each path.
    const ce = engine();
    const r = ce.function('Return', [ce.symbol('x')]);
    const body = ce.function('If', [ce.box(['Less', 0, 'x']), r, ce.function('Add', [r, ce.number(1)])]);
    const expr = ce.function('Function', [body, ce.box(typed('x'))]);
    expect(() => compile(expr, PROFILE as never)).toThrow(/admits a Return only in tail position/);
  });

  test('a Return as an operand declines', () => {
    declines(['Add', ['Return', 'x'], 1], /admits a Return only in tail position/);
  });
});

describe('Continue in the body of a loop', () => {
  const body = (statements: MathJsonExpression[], value: MathJsonExpression = 's'): MathJsonExpression =>
    fn(['Block', declare('s', 'real', 0), declare('c', 'real', 0), ...statements, value], typed('m', 'integer'));
  const M = [[5], [0], [-3], [1]];
  test.each<[string, MathJsonExpression]>([
    ['a Continue in a branch', body([['Loop', ['Block', ['If', ['Equal', ['Mod', 'k', 2], 0], ['Continue']], ['Assign', 's', ['Add', 's', 'k']]], range('k', 1, 'm')]])],
    [
      'a branch block that writes a local, then Continue',
      body([['Loop', ['Block', ['If', ['Less', 'k', 3], ['Block', ['Assign', 'c', ['Add', 'c', 1]], ['Continue']]], ['Assign', 's', ['Add', 's', ['Multiply', 'k', 'k']]]], range('k', 1, 'm')]], ['Add', ['Multiply', 1000, 'c'], 's']),
    ],
    ['a Continue in the else branch', body([['Loop', ['Block', ['If', ['Less', 'k', 3], ['Assign', 's', ['Add', 's', 100]], ['Continue']], ['Assign', 's', ['Add', 's', 'k']]], range('k', 1, 'm')]])],
    ['a Continue, then a Break', body([['Loop', ['Block', ['If', ['Equal', ['Mod', 'k', 2], 0], ['Continue']], ['If', ['Less', 7, 'k'], ['Break']], ['Assign', 's', ['Add', 's', 'k']]], range('k', 1, ['Multiply', 4, 'm'])]])],
    ['a loop over two index sets', body([['Loop', ['Block', ['If', ['Equal', 'j', 'k'], ['Continue']], ['Assign', 's', ['Add', 's', ['Multiply', 'j', 'k']]]], range('j', 1, 3), range('k', 1, 'm')]])],
    [
      'a loop with no index set',
      body([['Loop', ['Block', ['Assign', 'c', ['Add', 'c', 1]], ['If', ['Less', ['Multiply', 2, 'm'], 'c'], ['Break']], ['If', ['Equal', ['Mod', 'c', 3], 0], ['Continue']], ['Assign', 's', ['Add', 's', 'c']]]]]),
    ],
  ])('%s', (_name, json) => {
    check(json, { inputs: M });
  });

  test('the iteration budget counts the passes that end in Continue', () => {
    const json = body([['Loop', ['Block', ['Assign', 'c', ['Add', 'c', 1]], ['If', ['Less', 'm', 'c'], ['Break']], ['If', ['Less', 0, 'c'], ['Continue']], ['Assign', 's', 1]]]]);
    for (const budget of [3, 6, 7]) check(json, { inputs: [[5]], extra: { iterationBudget: budget }, interpreter: false });
  });

  test('one Continue node in an admitted and in a nested position declines', () => {
    // The position of each occurrence is checked, not the node object: for
    // k = 0..2 and x = 1 the existing compiler adds 1 once.
    const ce = engine();
    const C = ce.function('Continue', []);
    const k = ce.symbol('k');
    const loop = ce.function('Loop', [
      ce.function('Block', [
        ce.function('If', [ce.function('Equal', [k, ce.number(1)]), C]),
        ce.function('If', [ce.function('Equal', [k, ce.number(0)]), ce.function('Block', [ce.function('If', [ce.box(['Greater', 'x', 0]), C])])]),
        ce.function('Assign', [ce.symbol('s'), ce.box(['Add', 's', 1])]),
      ]),
      ce.box(range('k', 0, 2)),
    ]);
    const expr = ce.function('Block', [ce.box(declare('s', 'real', 0)), loop, ce.symbol('s')]);
    const continues: Expression[] = [];
    const visit = (e: Expression): void => {
      if (e.operator === 'Continue') continues.push(e);
      for (const op of e.ops ?? []) visit(op);
    };
    visit(expr);
    expect(continues.length).toBe(2);
    expect(continues[0]).toBe(continues[1]);
    const existing = compile(expr, EXISTING as never) as CompilationResult<'javascript'>;
    expect(existing.run!({ x: 1 } as never)).toBe(1);
    expect(() => compile(expr, PROFILE as never)).toThrow(/admits a Continue only as the last statement of a branch of an If that is a statement of the body of a Loop/);
  });

  test('one Break node at the end of a branch and as a statement of a loop body declines', () => {
    const ce = engine();
    const B = ce.function('Break', []);
    const s = ce.symbol('s');
    const add = ce.function('Assign', [s, ce.box(['Add', 's', 'k'])]);
    const first = ce.function('Loop', [ce.function('Block', [ce.function('If', [ce.box(['Less', 2, 'k']), B]), add]), ce.box(range('k', 1, 5))]);
    const second = ce.function('Loop', [ce.function('Block', [add, B]), ce.box(range('k', 1, 5))]);
    const expr = ce.function('Block', [ce.box(declare('s', 'real', 0)), first, second, s]);
    expect((first.ops![0].ops![0].ops![1])).toBe(second.ops![0].ops![1]);
    expect(() => compile(expr, PROFILE as never)).toThrow(/admits a Break only as the last statement of a branch of an If/);
  });

  test('a Continue in a nested If declines', () => {
    declines(body([['Loop', ['Block', ['If', ['Less', 1, 'k'], ['If', ['Equal', ['Mod', 'k', 2], 0], ['Continue']]], ['Assign', 's', ['Add', 's', 'k']]], range('k', 1, 'm')]]), /admits a Continue only as the last statement of a branch of an If that is a statement of the body of a Loop/);
  });
});

describe('a helper with a parameter with a default value', () => {
  test('a call that leaves the argument out and one that gives it', () => {
    const ce = engine();
    ce.assign('hd', ce.expr(fn(['Multiply', 't', 'k'], typed('t'), ['Optional', typed('k'), 2])));
    check(['Add', ['hd', 'x'], ['hd', 'x', 'y']], { ce });
  });

  test('a parameter with no annotation', () => {
    const ce = engine();
    ce.assign('hu', ce.expr(fn(['Add', 't', 'k'], 't', ['Optional', 'k', 0.5])));
    check(['Multiply', ['hu', 'x'], 3], { ce });
  });

  test('a root function with a default value declines', () => {
    declines(fn(['Multiply', 'x', 'k'], typed('x'), ['Optional', typed('k'), 2]), /the parameter k of the function has a default value/);
  });
});

describe('a loop whose value is not used', () => {
  /** The code of `json` on both compilers; the code is not run. */
  const codes = (json: MathJsonExpression) => {
    const expr = engine().expr(json);
    const existing = compile(expr, EXISTING as never) as CompilationResult<'javascript'>;
    const profile = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    expect(profile.success).toBe(true);
    return { existing: existing.code, profile: profile.code };
  };

  test('a loop with no index set and no exit is kept: it may not terminate', () => {
    const { existing, profile } = codes(['Block', declare('i', 'real', 0), ['If', ['Less', 0, 'x'], ['Loop', ['Assign', 'i', ['Add', 'i', 1]]]], 42]);
    expect(existing).toMatch(/while \(true\)/);
    expect(profile).toMatch(/if \(0 < _\.x\) \{ let \w+ = 0; while \(true\) \{ \w+ = \w+ \+ 1; \} \}/);
  });

  test('a loop with no index set and a Break is kept, as the existing compiler keeps it', () => {
    const json: MathJsonExpression = ['Block', declare('i', 'real', 0), ['If', ['Less', 0, 'x'], ['Loop', ['Block', ['If', ['Less', 3, 'i'], ['Break']], ['Assign', 'i', ['Add', 'i', 1]]]]], 42];
    const { existing, profile } = codes(json);
    expect(existing).toMatch(/while \(true\)/);
    expect(profile).toMatch(/while \(true\) \{ if \(3 < \w+\) \{ break; \}/);
    check(json);
  });

  test('a bounded loop with a pure body is removed: it ends, and only time differs', () => {
    const json: MathJsonExpression = ['Block', declare('i', 'real', 0), ['If', ['Less', 0, 'x'], ['Loop', ['Assign', 'i', ['Add', 'i', 1]], range('k', 1, 3)]], 42];
    const { existing, profile } = codes(json);
    expect(existing).toMatch(/for \(let k = 1; k <= 3; k\+\+\)/);
    expect(profile).toBe('42');
    check(json);
  });
});

describe('a local that a later index set reads', () => {
  test('the bound of the second index set reads a local that the body writes', () => {
    const json: MathJsonExpression = ['Block', declare('limit', 'integer', 2), declare('s', 'real', 0), ['Loop', ['Block', ['Assign', 's', ['Add', 's', 'j']], ['Assign', 'limit', 1]], range('i', 1, 2), range('j', 1, 'limit')], 's'];
    check(json, { inputs: [{}] });
    expect(compile(engine().expr(json), PROFILE as never).run!({} as never)).toBe(4);
  });

  test('the bound of the third index set reads a local that the body writes', () => {
    check(['Block', declare('m', 'integer', 3), declare('s', 'real', 0), ['Loop', ['Block', ['Assign', 's', ['Add', ['Multiply', 's', 10], 'k']], ['Assign', 'm', 1]], range('i', 1, 2), range('j', 1, 2), range('k', 1, 'm')], 's'], { inputs: [{}] });
  });
});

describe('the count test of a Range clause', () => {
  test('a single Range clause with a bound that is not a literal tests its count', () => {
    const json: MathJsonExpression = ['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', 's', 'i']], range('i', 1, ['Multiply', 5000000000, 'n'])], 's'];
    const code = check(json, { inputs: [{ n: 1 }], extra: { iterationBudget: 3 }, interpreter: false });
    expect(code).toMatch(/throw new RangeError\('Invalid array length'\)/);
  });

  test('a single Range clause of literal bounds has no test, as the existing counted for', () => {
    const code = check(['Block', declare('s', 'real', 0), ['Loop', ['Assign', 's', ['Add', 's', 'i']], range('i', 1, 4)], 's'], { inputs: [{}] });
    expect(code).not.toMatch(/RangeError/);
  });
});

describe('a gather of a row read', () => {
  test('a list of indexes of a row that can be absent declines', () => {
    const ce = engine();
    ce.declare('M2', 'matrix<2x2>');
    ce.declare('k', 'integer');
    declines(['At', ['At', 'M2', 'k'], ['Range', 1, 3]], /the row can be absent, and the existing emitter reads undefined for a gather of an absent row/, ce);
  });
});

describe('a shared tower in the new forms', () => {
  // One node object as both operands of `Arctan2`, nested 40 deep: 41
  // distinct nodes and 2^40 paths. A walk that does not visit each node once
  // does not end.
  const tower = (ce: ComputeEngine, leaf: Expression, depth = 40): Expression => {
    let t = leaf;
    for (let i = 0; i < depth; i++) t = ce.function('Arctan2', [t, t]);
    return t;
  };
  const clause = (ce: ComputeEngine, index: string, a: MathJsonExpression, b: MathJsonExpression) =>
    ce.function('Element', [ce.symbol(index), ce.function('Range', [ce.box(a), ce.box(b)])]);

  test('in a comprehension with two generators', () => {
    const ce = engine();
    const expr = ce.function('Comprehension', [tower(ce, ce.box(['Multiply', 'p', 'q', 'x'])), clause(ce, 'p', 1, 2), clause(ce, 'q', 1, 'p')]);
    const start = performance.now();
    const result = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    expect(performance.now() - start).toBeLessThan(1000);
    expect(result.run!({ x: 1.5 } as never)).toEqual([Math.PI / 4, Math.PI / 4, Math.PI / 4]);
  });

  // The type of a `Loop` in the engine (`loopBodyYieldsValue()` in
  // `control-structures.ts`) walks the body once per path, also for a
  // `Loop` with one index set (about 10 s at depth 28): not a walk of the
  // compilation (CE-1240, and the shapes left out of
  // compile-javascript-structured-shared-depth.test.ts). Enabled when that
  // walk visits each node once.
  test.skip('in the body of a loop over two index sets', () => {
    const ce = engine();
    const body = ce.function('Assign', [ce.symbol('s'), ce.function('Add', [ce.symbol('s'), tower(ce, ce.box(['Add', 'p', 'q', 'x']))])]);
    const expr = ce.function('Block', [ce.box(declare('s', 'real', 0)), ce.function('Loop', [body, clause(ce, 'p', 1, 2), clause(ce, 'q', 1, 2)]), ce.symbol('s')]);
    const start = performance.now();
    const result = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    expect(performance.now() - start).toBeLessThan(1000);
    expect(result.run!({ x: 1.5 } as never)).toBe(Math.PI);
  });
});
