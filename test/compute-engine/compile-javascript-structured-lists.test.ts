import { ComputeEngine, compile } from '../../src/compute-engine';
import {
  ScalarFragmentJavaScriptTarget,
  type StructuredPhase,
} from '../../src/compute-engine/compilation/javascript-fragment-target';
import { core } from '../../src/compute-engine/compilation/compiler-core-hooks';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import {
  lowerStructuredFragment,
  preparedNodesOf,
} from '../../src/compute-engine/compilation/javascript-structured-lower';
import { verifyJavaScriptProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import type {
  IROperation,
  IRProgram,
  IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import { listType } from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Step 6, change 6b, of docs/plans/2026-11-09-js-compiler-status-and-plan.md
// (design: docs/plans/2026-11-10-structured-ir-loops-and-lists.md), on the
// structured route of the internal scalar JavaScript fragment target: a list
// of reals or of integers as an input of the program or a parameter of a
// helper, read with `At` and `Length`.
//
// The rules of the interpreter and of the existing emitter that the tests
// follow:
// - `At(L, i)` counts from 1; a negative index counts from the end; an index
//   out of range (0, beyond the length) gives `NaN` for a list of numbers.
//   The existing emitter writes `_SYS.atNumeric(L, i, "real")` for a list
//   input or parameter, which gives the same values and throws when the
//   element is an array.
// - `Length(L)` is the number of elements; the existing emitter writes
//   `(L).length`.
// - The entry check of `run()` refuses a typed array and a string for a list
//   input.
//
// The fixture is `heatneighbor` of Tycho's heat showcase
// (`~/dev/tycho/src/graph-paper/onboarding/showcase-heat.js`). Its MathJSON
// is written here in the canonical form of the Epsil source: the definitions
// that `executeEpsil()` makes wrap the body of each function in
// `Block(Typed(…, 'real'))` and each branch in a `Block`, which the helper
// admission of the structured route refuses (the last test of
// "refusals").

const OPTIONS = { cse: false, constantFold: false } as const;
const MODES = ['strict', 'complex'] as const;

const typed = (name: string, type: string): MathJsonExpression => ['Typed', name, `'${type}'`];
const declare = (name: string, type: string, value: MathJsonExpression): MathJsonExpression => [
  'Declare',
  name,
  `'${type}'`,
  value,
];
/** The form of a `let` that `parseEpsil()` gives. */
const letLocal = (name: string, value: MathJsonExpression): MathJsonExpression => [
  'Declare',
  name,
  ['Dictionary', ['KeyValuePair', "'value'", value]],
];
const loop = (body: MathJsonExpression, k: string, a: MathJsonExpression, b: MathJsonExpression): MathJsonExpression => [
  'Loop',
  body,
  ['Element', k, ['Range', a, b]],
];
/** A `Function` whose body is a block of `statements`, with `parameters`. */
const fn = (parameters: MathJsonExpression[], ...statements: MathJsonExpression[]): MathJsonExpression => [
  'Function',
  ['Block', ...statements],
  ...parameters,
];

const HEATWALL: MathJsonExpression = [
  'And',
  ['Less', 0.5, 'obstacle'],
  ['Equal', 'c', 16],
  ['Or', ['Less', 'r', 13], ['Less', 18, 'r']],
];

const HEATNEIGHBOR: MathJsonExpression = [
  'If',
  ['Or', ['Less', 'c', 0], ['LessEqual', 'N', 'c'], ['Less', 'r', 0], ['LessEqual', 'N', 'r']],
  ['If', ['Less', 0.5, 'boundary'], 0, 'center'],
  ['If', ['heatwall', 'c', 'r', 'obstacle'], 'center', ['At', 'H', ['Add', 'c', ['Multiply', 'N', 'r'], 1]]],
];

const HEATNEIGHBOR_CALL: MathJsonExpression = ['heatneighbor', 'H', 'c', 'r', 'center', 'boundary', 'obstacle'];

/** Assign the helper `name` of the signature `signature`. */
function install(
  ce: ComputeEngine,
  name: string,
  signature: string,
  body: MathJsonExpression,
  parameters: MathJsonExpression[]
): void {
  ce.declare(name, signature);
  ce.assign(name, ce.expr(['Function', body, ...parameters]));
}

/** An engine with `N = 32`, `heatwall`, `heatneighbor`, and the inputs of
 *  the call of `heatneighbor` declared. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('N', 'integer');
  ce.assign('N', 32);
  install(ce, 'heatwall', '(integer, integer, real) -> boolean', HEATWALL, [
    typed('c', 'integer'),
    typed('r', 'integer'),
    typed('obstacle', 'real'),
  ]);
  install(ce, 'heatneighbor', '(list<real>, integer, integer, real, real, real) -> real', HEATNEIGHBOR, [
    typed('H', 'list<real>'),
    typed('c', 'integer'),
    typed('r', 'integer'),
    typed('center', 'real'),
    typed('boundary', 'real'),
    typed('obstacle', 'real'),
  ]);
  for (const [name, type] of [
    ['H', 'list<real>'],
    ['c', 'integer'],
    ['r', 'integer'],
    ['center', 'real'],
    ['boundary', 'real'],
    ['obstacle', 'real'],
  ])
    ce.declare(name, type);
  return ce;
}

const structured = (hooks = {}) => new ScalarFragmentJavaScriptTarget('structured', new Map(), hooks);

type Value = number | readonly number[];

function run(result: CompilationResult<'javascript'>, inputs: Value[] | Record<string, Value>): unknown {
  const r = result.run as unknown as (...a: unknown[]) => unknown;
  return Array.isArray(inputs) ? r(...inputs) : r(inputs);
}

function boxValue(ce: ComputeEngine, v: Value): Expression {
  return typeof v === 'number' ? ce.number(v) : ce.function('List', v.map((x) => ce.number(x)));
}

/** The value of `json`, a `Function` literal, on `inputs` by the
 *  interpreter. */
function interpret(ce: ComputeEngine, json: MathJsonExpression, inputs: Value[]): number {
  return ce.function('Apply', [ce.expr(json), ...inputs.map((v) => boxValue(ce, v))]).evaluate().N().re;
}

/** The same number, `NaN` equal to `NaN`, `0` equal to `-0`. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  return a === b;
}

/** A field of 32 × 32 different temperatures, exact in binary, so that a
 *  wrong index gives another value. */
const FIELD: readonly number[] = Array.from(
  { length: 1024 },
  (_, k) => Math.round((Math.sin(0.37 * (k + 1)) + (k + 1) / 1000) * 2 ** 20) / 2 ** 20
);

//
// heatneighbor
//

describe('heatneighbor: the interpreter decides, the existing emitter checks', () => {
  // Interior cells, the four edges, the four corners, the cells beyond each
  // edge, and the cells of the wall (column 16, rows below 13 and above
  // 18) and of its gap.
  const CELLS: [number, number][] = [
    [3, 4], [10, 20], [0, 5], [31, 5], [5, 0], [5, 31],
    [0, 0], [31, 31], [0, 31], [31, 0],
    [-1, 4], [32, 4], [4, -1], [4, 32], [-1, -1],
    [16, 5], [16, 25], [16, 12], [16, 13], [16, 15], [16, 18], [16, 19], [15, 12],
  ];
  for (const mode of MODES)
    test(`${mode} mode: interior, edge and corner cells, wall and no wall, insulated and cooled`, () => {
      const ce = engine();
      const expr = ce.expr(HEATNEIGHBOR_CALL);
      const result = structured().compile(expr, { ...OPTIONS, mode });
      const existing = compile(expr, { ...OPTIONS, mode, fallback: false });
      const H = ce.function('List', FIELD.map((x) => ce.number(x)));
      for (const [c, r] of CELLS)
        for (const boundary of [0, 1])
          for (const obstacle of [0, 1]) {
            const vars = { H: FIELD, c, r, center: 0.75, boundary, obstacle };
            const value = run(result, vars);
            const expected = ce
              .function('heatneighbor', [H, ce.number(c), ce.number(r), ce.number(0.75), ce.number(boundary), ce.number(obstacle)])
              .evaluate()
              .N().re;
            expect([vars.c, vars.r, boundary, obstacle, value]).toEqual([c, r, boundary, obstacle, expected]);
            expect(same(value, run(existing, vars))).toBe(true);
          }
      // A wrong index is visible: an interior cell reads its own element.
      expect(run(result, { H: FIELD, c: 3, r: 4, center: 0.75, boundary: 0, obstacle: 0 })).toBe(FIELD[3 + 32 * 4]);
    });

  test('the exact emitted code', () => {
    const result = structured().compile(engine().expr(HEATNEIGHBOR_CALL), OPTIONS);
    expect(result.preamble).toBe(
      'function _tv1(_tv3, _tv4, _tv5) { return 0.5 < _tv5 && _tv3 === 16 && (_tv4 < 13 || 18 < _tv4); }\n' +
        'function _tv2(_tv6, _tv7, _tv8, _tv9, _tv10, _tv11) { return _tv7 < 0 || 32 <= _tv7 || _tv8 < 0 || 32 <= _tv8 ? 0.5 < _tv10 ? 0 : _tv9 : _tv1(_tv7, _tv8, _tv11) ? _tv9 : _SYS.atNumeric(_tv6, 32 * _tv8 + _tv7 + 1, "real"); }\n'
    );
    expect(result.code).toBe('_tv2(_.H, _.c, _.r, _.center, _.boundary, _.obstacle)');
  });

  test('the representation: a list input, a list parameter, an at of the element type', () => {
    const preparation = structured().prepareStructured(engine().expr(HEATNEIGHBOR_CALL), OPTIONS);
    const program = lowerStructuredFragment(preparation);
    expect({ ...program.inputs[0], type: String(program.inputs[0].type) }).toEqual({ name: 'H', type: 'list<real>', representation: 'array', elementLabel: 'real' });
    const neighbor = program.functions.find((f) => f.name === 'heatneighbor')!;
    expect(neighbor.parameters.map((p) => [String(p.type), p.representation])).toEqual([
      ['list<real>', 'array'],
      ['integer', 'number'],
      ['integer', 'number'],
      ['real', 'number'],
      ['real', 'number'],
      ['real', 'number'],
    ]);
    const reads = operationsOf(neighbor.body).filter((op) => op.kind === 'at');
    expect(reads).toHaveLength(1);
    expect(reads[0].result!.type).toBe('real');
    expect(reads[0].operands.map((o) => String(o.type))).toEqual(['list<real>', 'integer']);
    expect(reads[0].effect).toBe('pure');
  });
});

/** Every operation of `region` and of the regions nested in it. */
function operationsOf(region: IRRegion): IROperation[] {
  return region.operations.flatMap((op) => [
    op,
    ...(op.kind === 'if'
      ? [...operationsOf(op.then), ...operationsOf(op.else)]
      : op.kind === 'loop'
        ? operationsOf(op.body)
        : op.kind === 'and' || op.kind === 'or'
          ? op.rest.flatMap(operationsOf)
          : []),
  ]);
}

//
// Programs of a root Function
//

const L = typed('L', 'list<real>');
const I = typed('i', 'integer');

type Fixture = { name: string; json: MathJsonExpression; inputs: Value[][] };

const SHORT = [10.5, -20.25, 30, 4.125, -0.5];

const FIXTURES: Fixture[] = [
  {
    name: 'At at the first and the last element',
    json: fn(
      [L],
      declare('t', 'real', ['At', 'L', 1]),
      ['Add', 't', ['Multiply', 1000, ['At', 'L', ['Length', 'L']]], ['Multiply', 1e6, ['At', 'L', -1]]]
    ),
    inputs: [[SHORT], [[7]], [FIELD]],
  },
  {
    name: 'a sum of a list with a loop over 1..Length(L)',
    json: fn([L], declare('s', 'real', 0), loop(['Assign', 's', ['Add', 's', ['At', 'L', 'k']]], 'k', 1, ['Length', 'L']), 's'),
    // The empty list: the range from 1 to 0 has the elements 1 and 0, and
    // each read is out of range.
    inputs: [[SHORT], [[3]], [[]], [FIELD]],
  },
  {
    name: 'a list of integers',
    json: fn(
      [typed('M', 'list<integer>'), I],
      declare('t', 'integer', ['Mod', ['At', 'M', 'i'], 3]),
      ['Add', 't', ['Multiply', 10, ['Length', 'M']]]
    ),
    inputs: [[[4, -7, 9, 11], 1], [[4, -7, 9, 11], 2], [[4, -7, 9, 11], -1], [[-5], 1]],
  },
  {
    name: 'an index computed with Mod and Floor',
    json: fn(
      [L, typed('k', 'integer')],
      letLocal('c', ['Mod', ['Add', 'k', -1], 'N']),
      letLocal('r', ['Floor', ['Divide', ['Add', 'k', -1], 'N']]),
      ['Add', ['At', 'L', ['Add', 'c', ['Multiply', 'N', 'r'], 1]], ['Multiply', 1000, ['At', 'L', ['Add', 'r', 1]]]]
    ),
    inputs: [[FIELD, 1], [FIELD, 33], [FIELD, 64], [FIELD, 1024], [FIELD, 500]],
  },
  {
    name: 'a list read in a loop at an index of the loop',
    json: fn(
      [L, typed('n', 'integer')],
      declare('s', 'real', 0),
      loop(['Assign', 's', ['Add', ['Multiply', 's', 0.5], ['At', 'L', ['Add', ['Mod', 'k', 5], 1]]]], 'k', 1, 'n'),
      's'
    ),
    inputs: [[SHORT, 7], [SHORT, 0], [FIELD, 40]],
  },
  // Integers computed from `Length(L)`, which the engine types
  // `integer | signed_infinity` or `real`: the facts are integers.
  {
    name: 'an index computed from Length(L)',
    json: fn([L, I], declare('t', 'real', 0), ['At', 'L', ['Add', ['Mod', 'i', ['Length', 'L']], 1]]),
    inputs: [[SHORT, 0], [SHORT, 7], [SHORT, -3], [[2.5], 4]],
  },
  {
    name: 'let n = Length(L), then Range(1, n) and At(L, n)',
    json: fn(
      [L],
      letLocal('n', ['Length', 'L']),
      declare('s', 'real', 0),
      loop(['Assign', 's', ['Add', ['Multiply', 's', 2], ['At', 'L', 'k']]], 'k', 1, 'n'),
      ['Add', 's', ['Multiply', 1000, ['At', 'L', 'n']]]
    ),
    inputs: [[SHORT], [[4]], [FIELD.slice(0, 12)]],
  },
  {
    name: "Declare(n, 'integer', Length(L))",
    json: fn([L], declare('n', 'integer', ['Length', 'L']), ['Add', ['At', 'L', 'n'], ['Multiply', 10, 'n']]),
    inputs: [[SHORT], [[4]]],
  },
  {
    name: 'a loop over Range(1, Length(L) - 1)',
    json: fn(
      [L],
      declare('s', 'real', 0),
      loop(['Assign', 's', ['Add', 's', ['Multiply', ['At', 'L', 'k'], ['At', 'L', ['Add', 'k', 1]]]]], 'k', 1, ['Subtract', ['Length', 'L'], 1]),
      's'
    ),
    inputs: [[SHORT], [[3, 4]], [FIELD]],
  },
];

describe('differential: the interpreter decides, the existing emitter checks', () => {
  for (const fixture of FIXTURES)
    for (const mode of MODES)
      test(`${fixture.name} (${mode} mode)`, () => {
        const ce = engine();
        const expr = ce.expr(fixture.json);
        const result = structured().compile(expr, { ...OPTIONS, mode });
        const existing = compile(expr, { ...OPTIONS, mode, fallback: false });
        for (const inputs of fixture.inputs) {
          const value = run(result, inputs);
          const label = inputs.map((v) => (typeof v === 'number' ? v : `[${v.length}]`));
          expect([label, same(value, interpret(ce, fixture.json, inputs))]).toEqual([label, true]);
          expect([label, same(value, run(existing, inputs))]).toEqual([label, true]);
        }
      });
});

describe('the spellings of a list of reals or of integers', () => {
  // Each is a JavaScript array of numbers on the existing route, read with
  // `_SYS.atNumeric` and `.length`.
  test.each([
    ['list<real>', 'list<real>'],
    ['vector<real>', 'list<real>'],
    ['list<real^5>', 'list<real>'],
    ['list<finite_real>', 'list<real>'],
    ['list<integer>', 'list<integer>'],
    ['vector<integer>', 'list<integer>'],
  ])('%s', (spelling, type) => {
    const ce = engine();
    const json = fn([typed('V', spelling), I], declare('t', 'real', 0), ['Add', ['At', 'V', 'i'], ['Multiply', 100, ['Length', 'V']]]);
    const program = lowerStructuredFragment(structured().prepareStructured(ce.expr(json), OPTIONS));
    expect(String(program.inputs[0].type)).toBe(type);
    const result = structured().compile(ce.expr(json), OPTIONS);
    const existing = compile(ce.expr(json), { ...OPTIONS, fallback: false });
    const V = [3, -4, 7, 1, 2];
    for (const i of [1, 5, -2, 0, 6]) {
      const value = run(result, [V, i]);
      expect([i, same(value, run(existing, [V, i]))]).toEqual([i, true]);
      expect([i, same(value, interpret(ce, json, [V, i]))]).toEqual([i, true]);
    }
  });
});

describe('a list of integers passed to a parameter of the type list<real>', () => {
  // The existing route passes the array; the interpreter reads the
  // integers as reals.
  test('the values', () => {
    const ce = engine();
    install(ce, 'h', '(list<real>, integer) -> real', ['Add', ['At', 'L', 'i'], 0.5], [L, I]);
    const json = fn([typed('M', 'list<integer>'), I], declare('t', 'real', 0), ['h', 'M', 'i']);
    const result = structured().compile(ce.expr(json), OPTIONS);
    const existing = compile(ce.expr(json), { ...OPTIONS, fallback: false });
    for (const i of [1, 3, -1, 0, 4]) {
      const value = run(result, [[4, -7, 9], i]);
      expect([i, same(value, interpret(ce, json, [[4, -7, 9], i]))]).toEqual([i, true]);
      expect([i, same(value, run(existing, [[4, -7, 9], i]))]).toEqual([i, true]);
    }
  });
});

describe('a list passed through two helpers', () => {
  function withHelpers(): ComputeEngine {
    const ce = engine();
    // `Length(L)` in the value of a helper is not used: the engine types
    // it `integer | signed_infinity`, and wraps such a body in
    // `Typed(…, 'real')`, which the helper admission refuses.
    install(ce, 'inner', '(list<real>, integer) -> real', ['Add', ['At', 'L', 'i'], ['Multiply', 0.5, ['At', 'L', 1]]], [L, I]);
    install(ce, 'outer', '(list<real>, integer) -> real', ['Add', ['Multiply', 2, ['inner', 'L', 'i']], ['inner', 'L', ['Negate', 'i']]], [L, I]);
    return ce;
  }
  const json = fn([L, I], declare('t', 'real', 0), ['outer', 'L', 'i']);

  test('the values', () => {
    const ce = withHelpers();
    const result = structured().compile(ce.expr(json), OPTIONS);
    const existing = compile(ce.expr(json), { ...OPTIONS, fallback: false });
    for (const i of [1, 2, 5, 6, 0, -5]) {
      const value = run(result, [SHORT, i]);
      expect([i, same(value, interpret(ce, json, [SHORT, i]))]).toEqual([i, true]);
      expect([i, same(value, run(existing, [SHORT, i]))]).toEqual([i, true]);
    }
  });

  test('both helpers have a list parameter, and the list is passed as it is', () => {
    const ce = withHelpers();
    const program = lowerStructuredFragment(structured().prepareStructured(ce.expr(json), OPTIONS));
    expect(program.functions.map((f) => [f.name, String(f.parameters[0].type)])).toEqual([
      ['inner', 'list<real>'],
      ['outer', 'list<real>'],
    ]);
    const result = structured().compile(ce.expr(json), OPTIONS);
    expect(result.code).toBe(
      '(L, i) => { function _tv1(_tv3, _tv4) { return 0.5 * _SYS.atNumeric(_tv3, 1, "real") + _SYS.atNumeric(_tv3, _tv4, "real"); }\n' +
        'function _tv2(_tv5, _tv6) { return 2 * _tv1(_tv5, _tv6) + _tv1(_tv5, -_tv6); }\n' +
        'return _tv2(L, i); }'
    );
  });

  test('the list input of an expression is passed to the helper', () => {
    const ce = withHelpers();
    ce.declare('X', 'list<real>');
    ce.declare('j', 'integer');
    const result = structured().compile(ce.expr(['outer', 'X', 'j']), OPTIONS);
    expect(run(result, { X: SHORT, j: 2 })).toBe(2 * (SHORT[1] + 0.5 * SHORT[0]) + (SHORT[3] + 0.5 * SHORT[0]));
  });
});

//
// Index out of range: the existing emitter decides, the interpreter
// decides where the contract defines the result
//

describe('an index out of range, 0, or negative', () => {
  const INDEXES = [1, 3, 5, -1, -5, 0, 6, -6, 1000, -1000];
  test('At alone: the absent value NaN, as the interpreter and the existing emitter give', () => {
    const ce = engine();
    const json = fn([L, I], declare('t', 'real', 0), ['At', 'L', 'i']);
    const result = structured().compile(ce.expr(json), OPTIONS);
    const existing = compile(ce.expr(json), { ...OPTIONS, fallback: false });
    for (const i of INDEXES) {
      const value = run(result, [SHORT, i]);
      expect([i, same(value, interpret(ce, json, [SHORT, i]))]).toEqual([i, true]);
      expect([i, same(value, run(existing, [SHORT, i]))]).toEqual([i, true]);
    }
    expect(run(result, [SHORT, 0])).toBeNaN();
    expect(run(result, [SHORT, -1])).toBe(-0.5);
  });

  test('arithmetic on the absent value (unspecified): the value of the existing emitter', () => {
    const ce = engine();
    const json = fn([L, I], declare('t', 'real', 0), ['Add', ['Multiply', 2, ['At', 'L', 'i']], 1]);
    const result = structured().compile(ce.expr(json), OPTIONS);
    const existing = compile(ce.expr(json), { ...OPTIONS, fallback: false });
    for (const i of INDEXES) expect([i, same(run(result, [SHORT, i]), run(existing, [SHORT, i]))]).toEqual([i, true]);
  });

  // The message of the element check names the element type that the
  // program declares: `real<0..1>` for `list<real<0..1>>`. The engine
  // parses `list<finite_real>` as `list<real>`.
  test.each(['list<real>', 'list<real<0..1>>', 'list<rational>', 'list<integer<0..9>>', 'list<finite_real>'])(
    'the entry check and the element check are the ones of the existing route (%s)',
    (type) => {
      const ce = engine();
      const json = fn([typed('L', type), I], declare('t', 'real', 0), ['At', 'L', 'i']);
      const result = structured().compile(ce.expr(json), OPTIONS);
      const existing = compile(ce.expr(json), { ...OPTIONS, fallback: false });
      const call = /_SYS\.atNumeric\(L, i, "[^"]*"\)/;
      expect(result.code.match(call)?.[0]).toBe(existing.code.match(call)?.[0]);
      expect(result.code).toContain(`"${type === 'list<finite_real>' ? 'real' : type.slice(5, -1)}"`);
      for (const bad of [new Float64Array([1, 2]), 'ab', [[1, 2], 3]] as unknown as Value[]) {
        let message: string | undefined;
        try {
          run(existing, [bad, 1]);
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message).toBeDefined();
        expect(() => run(result, [bad, 1])).toThrow(message);
      }
    }
  );

  test('the element type that a helper declares for its list parameter', () => {
    const ce = engine();
    install(ce, 'h', '(list<real<0..1>>, integer) -> real', ['At', 'F', 'i'], [typed('F', 'list<real<0..1>>'), I]);
    const json = fn([L, I], declare('t', 'real', 0), ['h', 'L', 'i']);
    const result = structured().compile(ce.expr(json), OPTIONS);
    const existing = compile(ce.expr(json), { ...OPTIONS, fallback: false });
    expect(result.code).toContain('"real<0..1>"');
    let message: string | undefined;
    try {
      run(existing, [[[1], 2] as unknown as Value, 1]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/real<0\.\.1>/);
    expect(() => run(result, [[[1], 2] as unknown as Value, 1])).toThrow(message);
  });
});

//
// Refusals
//

describe('refusals', () => {
  const body = (parameters: MathJsonExpression[], value: MathJsonExpression) =>
    fn(parameters, declare('t', 'real', 0), value);
  const refusals: [string, MathJsonExpression, RegExp][] = [
    ['At with two indexes', body([L, I], ['At', 'L', 'i', 'i']), /At with 2 indexes is not in the structured route, which reads one index/],
    ['At with a string index', body([L, I], ['At', 'L', "'a'"]), /At with a string index is not in the structured route/],
    ['At of a number', body([L, I], ['At', 'i', 1]), /invalid bound expression/],
    ['Length of a number', body([L, I], ['Length', 'i']), /Length in the structured route reads a list of reals, integers or tuples or a tuple of reals, and its operand has the type `integer`/],
    // A list of lists and a matrix of real cells are in the route since
    // slice 1 of the nested lists (compile-javascript-structured-nested.test.ts).
    ['a list of lists of complex numbers', body([typed('L', 'list<list<complex>>'), I], ['At', ['At', 'L', 'i'], 1]), /the parameter L has the type list<list<complex>>, and the structured route admits a list of lists only of rows of reals, of integers or of tuples of reals/],
    // The body reads the parameter: a parameter that the body never reads is
    // admitted whatever its type (compile-javascript-structured-captures.test.ts).
    ['a tensor of no declared rank', body([typed('L', 'tensor'), I], ['Add', ['Length', 'L'], 'i']), /the parameter L has the type tensor, a tensor whose rank the type does not state/],
    // A type that is not a list type keeps the message of a parameter that
    // the route has no type for.
    ['a named tuple parameter', body([typed('T', 'tuple<x: real, y: real>'), I], ['At', 'T', 'i']), /the parameter T of the function has the type tuple<x: real, y: real>, which is not in the structured route: a parameter is a number, a boolean, a list of reals or of integers, or a tuple of reals/],
    ['a list of complex numbers', body([typed('L', 'list<complex>'), I], ['At', 'L', 'i']), /the parameter L has the type list<complex>/],
    ['a list of booleans', body([typed('L', 'list<boolean>'), I], ['Add', ['Length', 'L'], 'i']), /the parameter L has the type list<boolean>/],
    // `vector`, a list of numbers, is a list of reals in the `strict` mode
    // (compile-javascript-structured-number-inputs.test.ts).
    ['indexed_collection<real>', body([typed('L', 'indexed_collection<real>'), I], ['Add', ['Length', 'L'], 'i']), /the parameter L of the function has the type indexed_collection<real>, which is not in the structured route/],
    // `First`, `Last`, `Rest` and the other functions of lists are in the
    // route since slice 2 (compile-javascript-structured-collections2.test.ts).
    // A numeric order is in the route since slice 3 of the nested lists
    // (compile-javascript-structured-nested2.test.ts); a named one is not.
    ['Norm with a named order', body([L], ['Norm', 'L', "'Frobenius'"]), /unsupported (bound )?head String/],
    ['Range with a literal step 0', body([L, I], ['At', ['Range', 1, 'i', 0], 1]), /Range with the literal step 0 is not in the structured route/],
    // The structured route admits `Comprehension` over one range and
    // `ReplaceAt` (compile-javascript-structured-heat.test.ts; design:
    // docs/plans/2026-11-10-structured-ir-loops-and-lists.md); these forms
    // stay out.
    ['Comprehension over a list', body([L], ['At', ['Comprehension', 'x', ['Element', 'x', 'L']], 1]), /Comprehension over Element\(x, L\) is not in the structured route, which admits a comprehension over Element\(j, Range\(a, b\)\) only, and not over a list/],
    ['Comprehension with a guard that draws', body([L], ['At', ['Comprehension', 'j', ['Element', 'j', ['Range', 1, 3], ['Less', ['Random'], 0.5]]], 1]), /Comprehension with a guard whose guard or body has the node Random\(\), which is not pure, is not in the structured route/],
    ['Comprehension with two generators', body([L], ['At', ['Comprehension', ['Add', 'j', 'm'], ['Element', 'j', ['Range', 1, 3]], ['Element', 'm', ['Range', 1, 3]]], 1]), /Comprehension with other than one generator is not in the structured route/],
    ['Comprehension of booleans', body([L], ['At', ['Comprehension', ['Less', 'j', 2], ['Element', 'j', ['Range', 1, 3]]], 1]), /Comprehension whose body has the type `boolean` is not in the structured route/],
    ['Comprehension of complex numbers', body([L], ['At', ['Comprehension', ['Add', 'j', 'ImaginaryUnit'], ['Element', 'j', ['Range', 1, 3]]], 1]), /Comprehension whose body has the type `complex` is not in the structured route/],
    ['Comprehension with a real bound', body([L, typed('x', 'real')], ['At', ['Comprehension', 'j', ['Element', 'j', ['Range', 1, 'x']]], 1]), /The bound `x` of `Comprehension` does not have an integer fact/],
    ['ReplaceAt with a real index', body([L, typed('x', 'real')], ['At', ['ReplaceAt', 'L', 'x', 2], 1]), /ReplaceAt with an index of the type `real` is not in the structured route, which reads an index of the type integer/],
    ['ReplaceAt with a complex value', body([L], ['At', ['ReplaceAt', 'L', 1, 'ImaginaryUnit'], 1]), /ReplaceAt with a value of the type `complex` is not in the structured route/],
    ['ReplaceAt with a boolean value', body([L, typed('C', 'boolean')], ['At', ['ReplaceAt', 'L', 1, 'C'], 1]), /ReplaceAt with a value of the type `boolean` is not in the structured route/],
    ['ReplaceAt of a number', body([L, I], ['At', ['ReplaceAt', 'i', 1, 2], 1]), /invalid bound expression/],
    ['Typed that is not the value of the body', body([L, I], ['Add', ['Typed', 'i', "'integer'"], 1]), /Typed is in the structured route only around the value of a function body/],
    ['Typed with another type than its value', fn([L, I], declare('t', 'real', 0), ['Typed', 't', "'integer'"]), /Typed with the ascribed type `integer` and a value of the type `real` is not in the structured route/],
    ['a list literal of a list and a number', body([L, I], ['At', ['At', ['List', ['List', 1], 2], 'i'], 1]), /a list literal of lists of different element types or of lists and other values is not in the structured route/],
    ['a tuple of booleans', body([L, I], ['At', ['Tuple', ['Less', 't', 1], 1], 1]), /a tuple with an element of the type `boolean` is not in the structured route/],
    ['arithmetic on a list and a complex number', body([L, typed('z', 'complex')], ['At', ['Add', 'L', 'z'], 1]), /Add of a list and the operand z of the type `complex` is not in the structured route/],
    ['a product of two lists', body([L, typed('M', 'list<real>')], ['Multiply', 'L', 'M']), /Multiply of the lists L and M, whose lengths are not equal by construction, is not in the structured route/],
    ['a comparison of lists', body([L, typed('M', 'list<real>')], ['If', ['Equal', 'L', 'M'], 1, 0]), /Equal with the list operand L is not in the structured route/],
    ['a product of a tuple', body([typed('P', 'tuple<real, real>'), I], ['At', ['Multiply', 'P', 'i'], 1]), /Multiply with the tuple operand P is not in the structured route/],
    ['Sqrt of a list', body([L], ['Add', ['Sqrt', 'L'], 0]), /Sqrt with the list operand L is not in the structured route/],
    ['Min of a list and a number', body([L, typed('x', 'real')], ['Min', 'L', 'x']), /Min with the list operand L is not in the structured route/],
    ['Less of a list and a number', body([L, typed('x', 'real')], ['Less', 'L', 'x']), /Less with the list operand L is not in the structured route/],
    ['And with a list', body([L, typed('C', 'boolean')], ['And', 'C', 'L']), /And with the list operand L is not in the structured route/],
    ['Or with a list', body([L, typed('C', 'boolean')], ['Or', 'C', 'L']), /Or with the list operand L is not in the structured route/],
    ['Power of a list', body([L], ['Power', 'L', 2]), /Power with the list operand L is not in the structured route/],
    ['a local declared list<complex>', fn([L, I], declare('M', 'list<complex>', 'L'), ['At', 'M', 'i']), /unsupported local declaration/],
  ];
  test.each(refusals)('%s', (_name, json, reason) => {
    expect(() => structured().prepareStructured(engine().expr(json), OPTIONS)).toThrow(reason);
  });

  test('an input of an expression of a refused list type', () => {
    const ce = engine();
    ce.declare('B', 'list<boolean>');
    expect(() => structured().prepareStructured(ce.expr(['Add', ['Length', 'B'], 1]), OPTIONS)).toThrow(
      /the input B has the type list<boolean>, and the structured route admits a list only of the type list<real> or list<integer>/
    );
  });

  // A string and a tuple keep their earlier messages. A list of reals and a
  // list of lists with a value are captured lists
  // (compile-javascript-structured-captures.test.ts,
  // compile-javascript-structured-bindings.test.ts).
  test.each([
    ['a string input', 'string', undefined],
    ['a named tuple input', 'tuple<x: real, y: real>', undefined],
  ] as [string, string, MathJsonExpression | undefined][])('%s', (_name, type, value) => {
    const ce = engine();
    ce.declare('S', type);
    if (value !== undefined) ce.assign('S', ce.expr(value));
    expect(() => structured().prepareStructured(ce.expr(['Add', ['Length', 'S'], 1]), OPTIONS)).toThrow(
      /unsupported binding S/
    );
  });

  // The engine types the call as an error: the admission refuses it as an
  // invalid expression.
  test('a number argument for a list parameter', () => {
    const ce = engine();
    install(ce, 'h', '(list<real>, integer) -> real', ['At', 'L', 'i'], [L, I]);
    expect(() => structured().prepareStructured(ce.expr(body([I], ['h', 'i', 'i'])), OPTIONS)).toThrow(
      /invalid bound expression/
    );
  });

  test('a list argument for a number parameter', () => {
    const ce = engine();
    install(ce, 'g', '(real) -> real', ['Add', 'x', 1], [typed('x', 'real')]);
    expect(() => structured().prepareStructured(ce.expr(body([L], ['g', 'L'])), OPTIONS)).toThrow(
      /The argument `L` of `g` has the type `list<real>`, and the parameter `x` has the type `real`/
    );
  });

  test.each([
    ['At', '(list<real>, integer) -> real', ['At', 'L', 'i'], [L, I]],
    ['Length', '(list<real>) -> integer', ['Length', 'L'], [L]],
  ] as [string, string, MathJsonExpression, MathJsonExpression[]][])(
    'a user function named %s declines',
    (name, signature, value, parameters) => {
      const ce = engine();
      install(ce, name, signature, 0, parameters);
      expect(() => structured().prepareStructured(ce.expr(body([L, I], value)), OPTIONS)).toThrow(
        new RegExp(`unsupported bound head ${name}`)
      );
    }
  );

  test('the form of a definition that executeEpsil() makes is admitted', () => {
    // `executeEpsil()` from src/epsil/execute-epsil.ts makes the body of a
    // function `Block(Typed(…, 'real'))`: the structured route admits the
    // ascription around the value of the body, with the declared result
    // type.
    const ce = new ComputeEngine();
    ce.declare('N', 'integer');
    ce.assign('N', 32);
    install(ce, 'heatwall', '(integer, integer, real) -> boolean', HEATWALL, [
      typed('c', 'integer'),
      typed('r', 'integer'),
      typed('obstacle', 'real'),
    ]);
    install(ce, 'neighbor', '(list<real>, integer) -> real', ['Block', ['Typed', ['At', 'H', 'c'], "'real'"]], [
      typed('H', 'list<real>'),
      typed('c', 'integer'),
    ]);
    ce.declare('H', 'list<real>');
    ce.declare('c', 'integer');
    const result = structured().compile(ce.expr(['neighbor', 'H', 'c']), OPTIONS);
    expect(run(result, { H: [1.5, 2.5], c: 2 })).toBe(2.5);
    // An ascription that is not the declared result type is refused.
    install(ce, 'neighbor2', '(list<real>, integer) -> real', ['Block', ['Typed', ['At', 'H', 'c'], "'integer'"]], [
      typed('H', 'list<real>'),
      typed('c', 'integer'),
    ]);
    expect(() => structured().prepareStructured(ce.expr(['neighbor2', 'H', 'c']), OPTIONS)).toThrow(
      /the body of the helper neighbor2 has the ascribed type integer, which is not its declared result type/
    );
  });
});

//
// The verifier
//

describe('the verifier, at and length', () => {
  /** The lowered `t := 0; At(L, i) + Length(L)`, and the place of each
   *  operation of its root region. */
  function lowered() {
    const json = fn([L, I], declare('t', 'real', 0), ['Add', ['At', 'L', 'i'], ['Length', 'L']]);
    const preparation = structured().prepareStructured(engine().expr(json), OPTIONS);
    const program = lowerStructuredFragment(preparation);
    const ops = program.root.operations as IROperation[];
    const at = ops.findIndex((op) => op.kind === 'at');
    const length = ops.findIndex((op) => op.kind === 'length');
    const add = ops.findIndex((op) => op.kind === 'add');
    const replace = (index: number, changed: IROperation): IRProgram => {
      const rootOps = [...ops];
      rootOps[index] = changed;
      return { ...program, root: { ...program.root, operations: rootOps } };
    };
    return { program, ops, at, length, add, replace, nodes: preparedNodesOf(preparation) };
  }

  test('the lowered program is accepted', () => {
    const m = lowered();
    expect(m.at).toBeGreaterThanOrEqual(0);
    expect(m.length).toBeGreaterThanOrEqual(0);
    expect(() => verifyJavaScriptProgram(m.program, m.nodes)).not.toThrow();
  });

  test('an at of a value that is not a list', () => {
    const m = lowered();
    const op = m.ops[m.at];
    const changed = { ...op, operands: [op.operands[1], op.operands[1]] } as IROperation;
    expect(() => verifyJavaScriptProgram(m.replace(m.at, changed), m.nodes)).toThrow(
      /the operation at reads a value of the type integer, not a list/
    );
  });

  test('an at whose index is not an integer', () => {
    const m = lowered();
    const op = m.ops[m.at];
    const changed = { ...op, operands: [op.operands[0], op.operands[0]] } as IROperation;
    expect(() => verifyJavaScriptProgram(m.replace(m.at, changed), m.nodes)).toThrow(
      /the index of the operation at has the type list<real>/
    );
  });

  test('an at whose result is not of the element type', () => {
    const m = lowered();
    const op = m.ops[m.at];
    const changed = { ...op, result: { ...op.result!, type: 'integer' } } as IROperation;
    expect(() => verifyJavaScriptProgram(m.replace(m.at, changed), m.nodes)).toThrow(
      /the operation at of a list<real> has a result of the type integer, not real/
    );
  });

  test('an at with one operand', () => {
    const m = lowered();
    const op = m.ops[m.at];
    const changed = { ...op, operands: [op.operands[0]] } as IROperation;
    expect(() => verifyJavaScriptProgram(m.replace(m.at, changed), m.nodes)).toThrow(
      /the operation at has 1 operands, not 2/
    );
  });

  test('an at that is not pure', () => {
    const m = lowered();
    const changed = { ...m.ops[m.at], effect: 'unknown' } as IROperation;
    expect(() => verifyJavaScriptProgram(m.replace(m.at, changed), m.nodes)).toThrow(/the operation at is not pure/);
  });

  test('a length whose result is not an integer', () => {
    const m = lowered();
    const op = m.ops[m.length];
    const changed = { ...op, result: { ...op.result!, type: 'real' } } as IROperation;
    expect(() => verifyJavaScriptProgram(m.replace(m.length, changed), m.nodes)).toThrow(
      /the operation length of a list<real> has a result of the type real, not integer/
    );
  });

  test('a length of a value that is not a list', () => {
    const m = lowered();
    const op = m.ops[m.length];
    // An integer value defined before the length: the literal of `t`.
    const integer = m.ops.slice(0, m.length).find((o) => o.result?.type === 'integer')!.result!;
    const changed = { ...op, operands: [integer] } as IROperation;
    expect(() => verifyJavaScriptProgram(m.replace(m.length, changed), m.nodes)).toThrow(
      /the operation length reads a value of the type integer, not a list/
    );
  });

  test('an add with a list operand', () => {
    const m = lowered();
    const op = m.ops[m.add];
    const list = m.ops[m.at].operands[0];
    const changed = { ...op, operands: [op.operands[0], list] } as IROperation;
    expect(() => verifyJavaScriptProgram(m.replace(m.add, changed), m.nodes)).toThrow(
      /the operation add has a list operand or a list result/
    );
  });

  test('a list of a type that the target does not hold', () => {
    const m = lowered();
    const read = m.ops.findIndex((op) => op.kind === 'input' && String(op.result!.type) === 'list<real>');
    const op = m.ops[read];
    const changed = { ...op, result: { ...op.result!, type: listType('boolean') } } as IROperation;
    expect(() => verifyJavaScriptProgram(m.replace(read, changed), m.nodes)).toThrow(
      /has the type list<boolean>, which the target does not hold/
    );
  });
});

//
// The existing readers are not called from preparation to emission
//

describe('the existing readers are not called from preparation to emission', () => {
  const READERS: [object, string][] = [
    [core, 'isComplexValued'],
    [core, 'staticTypeOf'],
    [core, 'userFunctionParamLanes'],
    [core, 'compile'],
    [BaseCompiler, 'compileCseRoot'],
  ];
  for (const mode of MODES)
    test(`${mode} mode: the readers throw, and heatneighbor compiles and runs`, () => {
      const ce = engine();
      const phases: StructuredPhase[] = [];
      const onPhase = (phase: StructuredPhase) => {
        phases.push(phase);
        if (phase === 'preparation')
          for (const [object, reader] of READERS)
            jest.spyOn(object as never, reader as never).mockImplementation((() => {
              throw new Error(`${reader} called from preparation to emission`);
            }) as never);
        if (phase === 'emission') jest.restoreAllMocks();
      };
      let result: CompilationResult<'javascript'>;
      try {
        result = structured({ onPhase }).compile(ce.expr(HEATNEIGHBOR_CALL), { ...OPTIONS, mode });
      } finally {
        jest.restoreAllMocks();
      }
      expect(phases).toEqual(['preparation', 'annotation', 'lowering', 'verification', 'emission', 'assembly']);
      expect(run(result, { H: FIELD, c: 7, r: 9, center: 0.75, boundary: 0, obstacle: 1 })).toBe(FIELD[7 + 32 * 9]);
      expect(run(result, { H: FIELD, c: 16, r: 5, center: 0.75, boundary: 0, obstacle: 1 })).toBe(0.75);
    });
});
