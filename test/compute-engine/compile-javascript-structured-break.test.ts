import { ComputeEngine, compile } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import {
  lowerStructuredFragment,
  preparedNodesOf,
} from '../../src/compute-engine/compilation/javascript-structured-lower';
import { verifyJavaScriptProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import { inPlaceUpdates } from '../../src/compute-engine/compilation/structured-in-place';
import { analyzeExecution } from '../../src/compute-engine/compilation/structured-execution';
import {
  exitsOf,
  isClosedRegion,
  type IRExit,
  type IRIf,
  type IRLoop,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
} from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// `Break` on the structured route of the internal scalar JavaScript fragment
// target (design: docs/plans/2026-11-10-structured-ir-break.md): the `exit`
// operation of the structured representation, open and closed regions, and
// the checks of the list "Checks" of that note.
//
// The interpreter rules that the tests follow:
// - `Break` leaves the innermost `Loop`; after the loop, each local has the
//   value that it had at the `Break`.
// - `Range(a, b)` always has at least one element: `Range(1, 0)` visits 1
//   and 0. A loop over a range therefore always runs at least one pass, and
//   the case "a range with no pass" of the note is the smallest ranges here
//   (one pass, and the two passes of `Range(1, 0)`).
// - The iteration budget counts each pass that starts, also the pass that
//   ends in `Break`.
//
// The values are compared with the existing emitter (`compile()` with
// `fallback: false`) with `Object.is`, and with the interpreter.

const OPTIONS = { cse: false, constantFold: false } as const;

const typed = (name: string, type: string): MathJsonExpression => ['Typed', name, `'${type}'`];
const declare = (name: string, type: string, value: MathJsonExpression): MathJsonExpression => [
  'Declare',
  name,
  `'${type}'`,
  value,
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
const BREAK: MathJsonExpression = ['Break'];

const structured = () => new ScalarFragmentJavaScriptTarget('structured', new Map(), {});

type Value = number | boolean | readonly number[];

function run(result: CompilationResult<'javascript'>, inputs: readonly Value[]): unknown {
  return (result.run as unknown as (...a: unknown[]) => unknown)(...inputs.map((v) => (Array.isArray(v) ? [...v] : v)));
}

function box(ce: ComputeEngine, v: Value): Expression {
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (typeof v === 'number') return ce.number(v);
  return ce.function('List', (v as readonly number[]).map((x) => ce.number(x)));
}

/** A boxed value of the interpreter as a JavaScript value. */
function unbox(value: Expression): unknown {
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  if (value.type.matches('number')) return value.N().re;
  const list = value as Expression & { each(): Generator<Expression> };
  return [...list.each()].map((x) => x.N().re);
}

/** The same value: `Object.is` for numbers, element by element for lists. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  return Object.is(a, b);
}

/** Equal values, `0` equal to `-0`, within 1e-12 relative (the interpreter
 *  can round in another order). */
function close(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => close(x, b[i]));
  if (typeof a !== 'number' || typeof b !== 'number') return a === b;
  return (
    (Number.isNaN(a) && Number.isNaN(b)) ||
    a === b ||
    (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)))
  );
}

/** Compile `expr` on both routes, and compare the values on each list of
 *  inputs with `Object.is`, and with the value `interpreter` gives. */
function agree(
  expr: Expression,
  cases: readonly (readonly Value[])[],
  interpreter?: (inputs: readonly Value[]) => unknown
): CompilationResult<'javascript'> {
  const result = structured().compile(expr, OPTIONS);
  const existing = compile(expr, { ...OPTIONS, fallback: false });
  for (const inputs of cases) {
    const value = run(result, inputs);
    const expected = run(existing, inputs);
    expect([inputs, same(value, expected)]).toEqual([inputs, true]);
    if (interpreter !== undefined) {
      const interpreted = interpreter(inputs);
      expect([inputs, value, close(value, interpreted)]).toEqual([inputs, value, true]);
    }
  }
  return result;
}

/** `agree()` for a MathJSON `Function`, applied by the interpreter. */
function agreeJson(json: MathJsonExpression, cases: readonly (readonly Value[])[]): CompilationResult<'javascript'> {
  const ce = new ComputeEngine();
  return agree(ce.expr(json), cases, (inputs) =>
    unbox(ce.function('Apply', [ce.expr(json), ...inputs.map((v) => box(ce, v))]).evaluate())
  );
}

/** An engine with machine numbers that has executed `source`. */
function engineWith(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  const { diagnostics } = executeEpsil(ce, source);
  expect(diagnostics).toEqual([]);
  return ce;
}

/** The `Function` literal that `executeEpsil()` made for `name`. */
function literal(ce: ComputeEngine, name: string): Expression {
  const definition = ce.lookupDefinition(name) as { operator?: { _lambdaLiteral?: Expression } } | undefined;
  const value = definition?.operator?._lambdaLiteral;
  if (value === undefined) throw new Error(`no function literal for ${name}`);
  return value;
}

/** `agree()` for the function `name` of the Epsil `source`. */
function agreeEpsil(
  source: string,
  name: string,
  cases: readonly (readonly Value[])[],
  interpreter = true
): CompilationResult<'javascript'> {
  const ce = engineWith(source);
  return agree(
    literal(ce, name),
    cases,
    interpreter ? (inputs) => unbox(ce.function(name, inputs.map((v) => box(ce, v))).evaluate()) : undefined
  );
}

function lowerJson(json: MathJsonExpression, options: object = {}) {
  const preparation = structured().prepareStructured(new ComputeEngine().expr(json), { ...OPTIONS, ...options });
  return { preparation, program: lowerStructuredFragment(preparation) };
}

function loopsOf(region: IRRegion): IRLoop[] {
  const result: IRLoop[] = [];
  const visit = (r: IRRegion) => {
    for (const op of r.operations) {
      if (op.kind === 'loop') {
        result.push(op);
        visit(op.body);
      }
      if (op.kind === 'if') {
        visit(op.then);
        visit(op.else);
      }
    }
  };
  visit(region);
  return result;
}

const N = [typed('n', 'integer')];
const NX = [typed('n', 'integer'), typed('x', 'real')];

//
// The pass at which the loop exits
//

describe('the pass of the exit', () => {
  // `s` is 1, 3, 6, 10, … at the passes 1, 2, 3, 4, …: the loop exits at
  // the first pass whose `s` is above `x`, and `c` counts the passes that
  // did not exit.
  const json = fn(
    NX,
    declare('s', 'real', 0),
    declare('c', 'integer', 0),
    loop(['Block', ['Assign', 's', ['Add', 's', 'k']], ['If', ['Less', 'x', 's'], BREAK], ['Assign', 'c', ['Add', 'c', 1]]], 'k', 1, 'n'),
    ['Add', 's', ['Multiply', 1000, 'c']]
  );

  test('at the first pass, a middle pass, the last pass and never, and on the smallest ranges', () => {
    agreeJson(json, [
      [5, 0], // the first pass
      [5, 5], // the third pass
      [3, 5], // the last pass
      [5, 100], // never
      [1, 100], // a range of one pass
      [1, 0], // a range of one pass that exits
      [0, 100], // Range(1, 0): the passes 1 and 0
      [0, 0.5], // Range(1, 0), exits at the first pass
      [-3, 0.5], // Range(1, -3), counting down
    ]);
  });

  test('the emitted code: the carried variable is assigned before the break', () => {
    expect(structured().compile(new ComputeEngine().expr(json), OPTIONS).code).toBe(
      '(n, x) => { const _tv1 = n; let _tv2 = 0, _tv3 = 0; const _tv5 = _tv1 < 1 ? -1 : 1; const _tv6 = _tv5 * (_tv1 - 1); for (let _tv7 = 0; _tv7 <= _tv6; _tv7++) { const _tv4 = _tv5 < 0 ? 1 - _tv7 : 1 + _tv7; const _tv8 = _tv4 + _tv2; if (x < _tv8) { _tv2 = _tv8; break; } _tv3 = _tv3 + 1; _tv2 = _tv8; } return 1000 * _tv3 + _tv2; }'
    );
  });

  test('a write in the branch before the Break', () => {
    // `found` is written only in the closed branch: its value after the loop
    // is the value of the exit, or its initial value.
    agreeJson(
      fn(
        NX,
        declare('found', 'real', -1),
        loop(['If', ['Less', 'x', 'k'], ['Block', ['Assign', 'found', 'k'], BREAK]], 'k', 1, 'n'),
        'found'
      ),
      [[5, 0], [5, 2.5], [5, 4], [5, 9], [0, 0.5]]
    );
  });

  test('the exit two branches deep', () => {
    // The form of `choosecell`: the `If` that holds the `Break` is in a
    // branch.
    agreeJson(
      fn(
        [typed('n', 'integer'), typed('rank', 'integer')],
        declare('m', 'integer', 0),
        declare('cell', 'integer', 0),
        loop(
          [
            'If',
            ['Equal', ['Mod', 'k', 3], 0],
            ['Block', ['Assign', 'm', ['Add', 'm', 1]], ['If', ['Equal', 'm', 'rank'], ['Block', ['Assign', 'cell', 'k'], BREAK]]],
          ],
          'k',
          1,
          'n'
        ),
        ['Add', 'cell', ['Multiply', 100, 'm']]
      ),
      [[20, 1], [20, 3], [20, 6], [20, 7], [1, 1], [0, 1]]
    );
  });

  test('an If that writes no local and holds an If with a Break is kept', () => {
    // The outer `If` has no result and no effect; its exit still decides
    // which passes run.
    agreeJson(
      fn(
        NX,
        declare('s', 'real', 0),
        loop(
          ['Block', ['If', ['Less', 0, 'x'], ['If', ['Less', 'x', 'k'], BREAK]], ['Assign', 's', ['Add', 's', 'k']]],
          'k',
          1,
          'n'
        ),
        's'
      ),
      [[5, 0], [5, 2.5], [5, 4], [5, 100], [0, 0.5]]
    );
    // The same, with a write in the outer branch that nothing reads later.
    agreeJson(
      fn(
        NX,
        declare('s', 'real', 0),
        declare('t', 'real', 0),
        loop(
          [
            'Block',
            ['Assign', 's', ['Add', 's', 'k']],
            ['If', ['Less', 0, 'x'], ['Block', ['Assign', 't', 1], ['If', ['Less', 'x', 's'], BREAK]]],
          ],
          'k',
          1,
          'n'
        ),
        's'
      ),
      [[5, 0], [5, 2.5], [5, 4], [5, 100], [0, 0.5]]
    );
  });

  test('one branch continues, the other always exits', () => {
    // The form of `ray`: the closed branch is the else branch, and the
    // statements after the `If` read the value of the open branch.
    agreeJson(
      fn(
        NX,
        declare('n2', 'integer', 0),
        declare('found', 'integer', 0),
        declare('col', 'real', 0),
        loop(
          [
            'Block',
            ['If', ['Less', 'k', 'x'], ['Assign', 'n2', ['Add', 'n2', 1]], ['Block', ['If', ['Equal', 'k', 4], ['Assign', 'found', 'n2']], BREAK]],
            ['Assign', 'col', ['Add', 'col', 0.5]],
          ],
          'k',
          1,
          'n'
        ),
        ['Add', 'found', ['Multiply', 10, 'n2'], ['Multiply', 100, 'col']]
      ),
      [[7, 0], [7, 4], [7, 4.5], [7, 6], [7, 100], [0, 5]]
    );
  });

  test('a real value at the exit makes an integer carried value real', () => {
    const json = fn(
      NX,
      declare('t', 'real', 0),
      loop(['Block', ['If', ['Less', 'x', 'k'], ['Block', ['Assign', 't', ['Divide', 'k', 2]], BREAK]], ['Assign', 't', 'k']], 'k', 1, 'n'),
      't'
    );
    agreeJson(json, [[6, 2.5], [6, 0], [6, 9]]);
  });

  test('two carried values exchanged at the exit read the values before the exit', () => {
    agreeJson(
      fn(
        NX,
        declare('a', 'real', 1),
        declare('b', 'real', 2),
        loop(
          [
            'Block',
            ['If', ['Less', 'x', 'k'], ['Block', ['Assign', 'a', 'b'], ['Assign', 'b', ['Add', 'a', 'b']], BREAK]],
            ['Assign', 'a', ['Add', 'a', 1]],
          ],
          'k',
          1,
          'n'
        ),
        ['Add', 'a', ['Multiply', 1000, 'b']]
      ),
      [[5, 2], [5, 0], [5, 10]]
    );
  });
});

describe('a loop inside a loop', () => {
  test('the exit leaves the inner loop only', () => {
    // The inner loop exits at `j = k`; the outer loop runs each pass.
    const json = fn(
      N,
      declare('s', 'real', 0),
      declare('passes', 'integer', 0),
      loop(
        [
          'Block',
          ['Assign', 'passes', ['Add', 'passes', 1]],
          loop(['Block', ['Assign', 's', ['Add', 's', 'j']], ['If', ['Equal', 'j', 'k'], BREAK]], 'j', 1, 5),
        ],
        'k',
        1,
        'n'
      ),
      ['Add', 's', ['Multiply', 1000, 'passes']]
    );
    agreeJson(json, [[3], [7], [1], [0]]);
    const [outer, inner] = loopsOf(lowerJson(json).program.root);
    expect(exitsOf(outer)).toHaveLength(0);
    expect(exitsOf(inner)).toHaveLength(1);
  });

  test('an exit of the outer loop after an inner loop', () => {
    const json = fn(
      NX,
      declare('s', 'real', 0),
      loop(
        [
          'Block',
          loop(['Assign', 's', ['Add', 's', 'j']], 'j', 1, 'k'),
          ['If', ['Less', 'x', 's'], BREAK],
        ],
        'k',
        1,
        'n'
      ),
      's'
    );
    agreeJson(json, [[6, 0], [6, 9], [6, 100]]);
    const [outer, inner] = loopsOf(lowerJson(json).program.root);
    expect(exitsOf(outer)).toHaveLength(1);
    expect(exitsOf(inner)).toHaveLength(0);
  });
});

//
// A carried list
//

describe('a list carried by a loop with an exit', () => {
  const L = [typed('L', 'list<real>'), typed('m', 'integer')];

  test('the host array is not written, and the result is the list at the exit', () => {
    const json = fn(
      L,
      declare('R', 'list<real>', 'L'),
      loop(['Block', ['Assign', 'R', ['ReplaceAt', 'R', 'k', ['Multiply', 10, 'k']]], ['If', ['Equal', 'k', 'm'], BREAK]], 'k', 1, 4),
      'R'
    );
    const ce = new ComputeEngine();
    const result = agreeJson(json, [
      [[1, 2, 3, 4], 1],
      [[1, 2, 3, 4], 3],
      [[1, 2, 3, 4], 9],
    ]);
    const host = [1, 2, 3, 4];
    expect(run2(result, host, 2)).toEqual([10, 20, 3, 4]);
    expect(host).toEqual([1, 2, 3, 4]);
    void ce;
  });

  test('a list that the program makes is written in place, and the exit hands it over', () => {
    const json = fn(
      [typed('m', 'integer')],
      declare('R', 'list<real>', ['Comprehension', 0, ['Element', 'j', ['Range', 1, 5]]]),
      loop(['Block', ['If', ['Equal', 'k', 'm'], BREAK], ['Assign', 'R', ['ReplaceAt', 'R', 'k', 'k']]], 'k', 1, 5),
      ['Assign', 'R', ['ReplaceAt', 'R', 5, -1]],
      'R'
    );
    agreeJson(json, [[1], [3], [5], [9]]);
    const { program } = lowerJson(json);
    const updates = allOperations(program.root).filter((op) => op.kind === 'replace-at');
    expect(updates).toHaveLength(2);
    // The exit and the update of the body never both run with one array, so
    // both updates are in place.
    expect(updates.every((op) => inPlaceUpdates(program).has(op))).toBe(true);
  });

  test('an exit that hands over an input list makes the result not unique', () => {
    // The exit can give the result the array of the host: the update after
    // the loop copies.
    const json = fn(
      L,
      declare('R', 'list<real>', ['Comprehension', 0, ['Element', 'j', ['Range', 1, 4]]]),
      loop(
        ['Block', ['If', ['Equal', 'k', 'm'], ['Block', ['Assign', 'R', 'L'], BREAK]], ['Assign', 'R', ['ReplaceAt', 'R', 'k', 'k']]],
        'k',
        1,
        4
      ),
      ['Assign', 'R', ['ReplaceAt', 'R', 1, -1]],
      'R'
    );
    const result = agreeJson(json, [
      [[5, 6, 7, 8], 2],
      [[5, 6, 7, 8], 9],
    ]);
    const host = [5, 6, 7, 8];
    expect(run2(result, host, 3)).toEqual([-1, 6, 7, 8]);
    expect(host).toEqual([5, 6, 7, 8]);
    const { program } = lowerJson(json);
    const updates = allOperations(program.root).filter((op) => op.kind === 'replace-at');
    const inPlace = inPlaceUpdates(program);
    // The update in the body writes the array of the comprehension (the
    // parameter never holds the operand of the exit); the one after the loop
    // copies.
    expect(updates.map((op) => inPlace.has(op))).toEqual([true, false]);
    // No update in place writes an array that the host can hold.
    expect(analyzeExecution(program).independentCalls).toMatchObject({ holds: true, blockers: [] });
  });

  test('an update before the exit of the old list copies', () => {
    // `S` keeps the list before the update, and the exit hands `S` over: the
    // update must not write the array that `S` holds.
    const json = fn(
      [typed('m', 'integer')],
      declare('R', 'list<real>', ['Comprehension', 0, ['Element', 'j', ['Range', 1, 3]]]),
      declare('S', 'list<real>', ['Comprehension', 0, ['Element', 'j', ['Range', 1, 3]]]),
      loop(
        ['Block', ['Assign', 'S', 'R'], ['Assign', 'R', ['ReplaceAt', 'R', 'k', 'k']], ['If', ['Equal', 'k', 'm'], ['Block', ['Assign', 'R', 'S'], BREAK]]],
        'k',
        1,
        3
      ),
      'R'
    );
    agreeJson(json, [[1], [2], [3], [9]]);
    const { program } = lowerJson(json);
    const [update] = allOperations(program.root).filter((op) => op.kind === 'replace-at');
    expect(inPlaceUpdates(program).has(update)).toBe(false);
  });
});

function run2(result: CompilationResult<'javascript'>, list: number[], m: number): unknown {
  return (result.run as unknown as (...a: unknown[]) => unknown)(list, m);
}

/** The operations of `region` and of the regions nested in it. */
function allOperations(region: IRRegion): IROperation[] {
  return region.operations.flatMap((op) => [
    op,
    ...(op.kind === 'if'
      ? [...allOperations(op.then), ...allOperations(op.else)]
      : op.kind === 'loop' || op.kind === 'build'
        ? allOperations(op.body)
        : op.kind === 'and' || op.kind === 'or'
          ? op.rest.flatMap(allOperations)
          : []),
  ]);
}

//
// The iteration budget
//

describe('the iteration budget', () => {
  const json = fn(
    [typed('n', 'integer'), typed('m', 'integer')],
    declare('s', 'integer', 0),
    loop(['Block', ['Assign', 's', ['Add', 's', 1]], ['If', ['Equal', 's', 'm'], BREAK]], 'k', 1, 'n'),
    's'
  );

  test('counts the passes that ran, the pass of the exit too', () => {
    const ce = new ComputeEngine();
    const options = { ...OPTIONS, iterationBudget: 10 };
    const result = structured().compile(ce.expr(json), options);
    const existing = compile(ce.expr(json), { ...options, fallback: false });
    const failure = (r: CompilationResult<'javascript'>, inputs: number[]) => {
      try {
        return run(r, inputs);
      } catch (e) {
        return [(e as Error).name, (e as Error).message];
      }
    };
    // Ten passes, the last one exits: within the budget.
    expect(failure(result, [100, 10])).toBe(10);
    // Eleven passes: over the budget.
    expect((failure(result, [100, 11]) as string[])[0]).toBe('CancellationError');
    for (const inputs of [
      [100, 10],
      [100, 11],
      [9, 100],
      [12, 100],
      [100, 1],
    ])
      expect([inputs, failure(result, inputs)]).toEqual([inputs, failure(existing, inputs)]);
  });
});

//
// The witnesses of the note
//

/** Tycho's `B` of the Burning Ship showcase, copied from
 *  `~/dev/tycho/src/graph-paper/onboarding/template-data.js`. */
const B_PRELUDE = `
function B(p: real, q: real) -> real {
  let a = 0.0
  let b = 0.0
  let n = 0
  let s = 0.0
  let t = 0.0
  for k in 1..128 {
    s = a^2 + b^2
    if s > 65536 { break }
    n = n + 1
    t = a^2 - b^2 + p
    b = abs(2*a*b) + q
    a = t
  }
  s = a^2 + b^2
  if s <= 65536 { 1 } else { min(1, (n + 1 - ln(ln(s) / ln(65536)) / ln(2)) / 128) }
}
`;

/** Tycho's `M` of the Multibrot showcase (template-data.js), with one line
 *  replaced: the route declines `r = s^(d/2)` (a `Power` with an exponent
 *  that is not a literal), so the line is `r = s`, the value of `s^(d/2)`
 *  for `d = 2`. The forms `exp(d/2 * ln(s))`, with `abs(s)`, `s + 1` or
 *  `sqrt(s)` in the logarithm, are declined too: the engine does not type
 *  their exponential `real`. */
const M_PRELUDE = `
function M(p: real, q: real, d: real) -> real {
  let a = p
  let b = q
  let n = 1
  let s = 0.0
  let t = 0.0
  let w = 0.0
  let r = 0.0
  for k in 1..128 {
    s = a^2 + b^2
    if s > 4096 { break }
    n = n + 1
    w = if s > 0 { d * arctan2(b, a) } else { 0.0 }
    r = s
    t = r * cos(w) + p
    b = r * sin(w) + q
    a = t
  }
  s = a^2 + b^2
  if s <= 4096 { 1 } else { min(1, (n + 1 - ln(ln(s) / ln(4096)) / ln(d)) / 128) }
}
`;

/** Tycho's \`ray\` of the Othello showcase, copied from
 *  \`~/dev/tycho/src/graph-paper/onboarding/showcase-othello.js\`. */
const RAY_PRELUDE = `
function ray(B: list<integer>, k: integer, p: integer, dx: integer, dy: integer) -> integer {
  let col = k - 1 - 8 * floor((k - 1) / 8) + dx
  let row = floor((k - 1) / 8) + dy
  let n = 0
  let found = 0
  for j in 1..7 {
    if col < 0 || col > 7 || row < 0 || row > 7 { break }
    let v = B[1 + col + 8 * row]
    if v == -p {
      n = n + 1
    } else {
      if v == p { found = n }
      break
    }
    col = col + dx
    row = row + dy
  }
  found
}
`;

/** Reduced copies of Tycho's `hasmove` and `choosecell` (showcase-othello.js).
 *  Each calls `flips`, which needs `NotEqual`, and declares
 *  `let count: integer = …`, which the route declines (the typed `let` form
 *  `Declare(count, 'integer', Dictionary(value: …))`). The copies replace
 *  the call with `B[k] * p` and write `let count = …`. The loops and their
 *  exits are those of the showcase. */
const OTHELLO_REDUCED = `
function hasmove(B: list<integer>, p: integer) -> boolean {
  let found = false
  for k in 1..64 {
    let count = B[k] * p
    if count > 0 { found = true; break }
  }
  found
}
function choosecell(B: list<integer>, rank: integer) -> integer {
  let n = 0
  let cell = 0
  for k in 1..64 {
    let count = B[k] * B[65]
    if count > 0 {
      n = n + 1
      if n == rank { cell = k; break }
    }
  }
  cell
}
`;

/** The board of 65 entries with `entries` (1-based index to value) set. */
const board = (entries: Record<number, number>): number[] =>
  Array.from({ length: 65 }, (_, i) => entries[i + 1] ?? 0);

/** The initial Othello board of the showcase. */
const START = board({ 28: -1, 37: -1, 29: 1, 36: 1, 65: 1 });

describe('the witnesses', () => {
  test('B: never, at the second pass, at a middle pass', () => {
    agreeEpsil(B_PRELUDE, 'B', [
      [0, 0], // never escapes
      [300, 0], // s is above 65536 at the second pass
      [1, 1],
      [-1.75, -0.03],
      [0.4, 0.3],
      [-0.5, 0.6],
      [0.25, 0],
    ]);
  });

  test('B compiles on the profile, pure and shippable', () => {
    const result = compile(literal(engineWith(B_PRELUDE), 'B'), {
      profile: 'numeric-kernel',
      fallback: false,
    } as never) as CompilationResult<'javascript'> & { pure?: boolean; shippable?: boolean };
    expect(result.success).toBe(true);
    expect([result.pure, result.shippable]).toEqual([true, true]);
  });

  test("M's loop", () => {
    agreeEpsil(M_PRELUDE, 'M', [
      [0, 0, 3],
      [3, 0, 3],
      [70, 0, 2],
      [0.3, 0.5, 3],
      [-0.6, 0.2, 5.5],
      [0.2, 0.9, 2],
    ]);
  });

  test('ray: an edge exits at the first pass, a disc of the player at a middle pass, the last pass, never', () => {
    const row = (p: number) => board({ 1: p, 2: -p, 3: -p, 4: -p, 5: -p, 6: -p, 7: -p, 8: p });
    const open = (p: number) => board({ 1: p, 2: -p, 3: -p, 4: -p, 5: -p, 6: -p, 7: -p, 8: -p });
    agreeEpsil(RAY_PRELUDE, 'ray', [
      [START, 1, 1, -1, 0], // the edge: exits at the first pass
      [START, 27, 1, 1, 0], // one disc, then the player's: exits at the second pass
      [START, 20, -1, 0, 1],
      [row(1), 1, 1, 1, 0], // six discs, then the player's: exits at the last pass
      [open(1), 1, 1, 1, 0], // seven discs: never exits
      [START, 1, 1, 0, 0], // dx = dy = 0: the cell itself, every pass
    ]);
    // Every cell and direction of the start board, against the existing
    // emitter only (the interpreter is slow).
    const cases: Value[][] = [];
    for (let k = 1; k <= 64; k++)
      for (const p of [1, -1])
        for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) cases.push([START, k, p, dx, dy]);
    agreeEpsil(RAY_PRELUDE, 'ray', cases, false);
  });

  test('hasmove, reduced: first pass, middle pass, last pass, never', () => {
    agreeEpsil(OTHELLO_REDUCED, 'hasmove', [
      [board({ 1: 1 }), 1],
      [board({ 30: -1 }), -1],
      [board({ 64: 1 }), 1],
      [board({}), 1],
      [START, 1],
    ]);
  });

  test('choosecell, reduced: the exit two branches deep', () => {
    agreeEpsil(OTHELLO_REDUCED, 'choosecell', [
      [START, 1],
      [START, 2],
      [START, 3],
      [board({ 1: 1, 64: 1, 65: 1 }), 2],
      [board({ 65: 1 }), 1],
    ]);
  });
});

//
// Execution analysis
//

describe('the execution analysis', () => {
  test('a loop that holds an exit is not a parallel candidate, and the answer names the exit', () => {
    const ce = engineWith(B_PRELUDE);
    const program = lowerStructuredFragment(structured().prepareStructured(literal(ce, 'B'), OPTIONS));
    const analysis = analyzeExecution(program);
    expect(analysis.parallelLoops).toHaveLength(1);
    const [judgment] = analysis.parallelLoops;
    expect(judgment.candidate).toBe(false);
    if (!judgment.candidate) {
      expect(judgment.reason.kind).toBe('exit');
      expect(judgment.reason.reason).toMatch(/the body holds an exit/);
      expect(judgment.reason.origin.operator).toBe('Break');
    }
    expect(analysis.independentCalls.holds).toBe(true);
    expect(analysis.workerPortable.holds).toBe(true);
  });

  test('an exit of an inner loop does not make the outer loop fail for it', () => {
    const json = fn(
      [typed('L', 'list<real>')],
      declare('R', 'list<real>', 'L'),
      declare('s', 'real', 0),
      loop(
        [
          'Block',
          declare('t', 'real', 0),
          loop(['Block', ['Assign', 't', ['Add', 't', 'j']], ['If', ['Less', 'k', 't'], BREAK]], 'j', 1, 9),
          ['Assign', 'R', ['ReplaceAt', 'R', 'k', 't']],
        ],
        'k',
        1,
        3
      ),
      'R'
    );
    agreeJson(json, [[[0, 0, 0]]]);
    const [outer, inner] = analyzeExecution(lowerJson(json).program).parallelLoops;
    expect(outer.candidate).toBe(true);
    expect(inner.candidate).toBe(false);
    if (!inner.candidate) expect(inner.reason.kind).toBe('exit');
  });

  test('with a budget, the loop with an exit can abort', () => {
    const ce = engineWith(B_PRELUDE);
    const program = lowerStructuredFragment(
      structured().prepareStructured(literal(ce, 'B'), { ...OPTIONS, iterationBudget: 1000 })
    );
    expect(program.root.canAbort).toBe(true);
    expect(analyzeExecution(program).independentCalls.caveats.map((c) => c.name)).toEqual(['iteration-budget']);
  });
});

//
// The representation and the verifier
//

describe('the representation', () => {
  const json = fn(
    NX,
    declare('c', 'integer', 0),
    loop(['Block', ['If', ['Less', 'x', 'k'], BREAK], ['Assign', 'c', ['Add', 'c', 1]]], 'k', 1, 'n'),
    'c'
  );

  test('a branch that ends in Break ends in an exit of the carried values', () => {
    const { program } = lowerJson(json);
    const [op] = loopsOf(program.root);
    const branch = op.body.operations.find((o): o is IRIf => o.kind === 'if')!;
    expect(isClosedRegion(branch.then)).toBe(true);
    expect(isClosedRegion(branch.else)).toBe(false);
    const [exit] = exitsOf(op);
    expect(exit.operands.map((v) => v.id)).toEqual([op.body.parameters![1].id]);
    // The `if` has no result: its open branch writes nothing.
    expect(branch.results).toHaveLength(0);
  });

  test('the If of a closed branch has the results of the open branch', () => {
    const { program } = lowerJson(
      fn(
        NX,
        declare('c', 'integer', 0),
        loop(['Block', ['If', ['Less', 'x', 'k'], BREAK, ['Assign', 'c', ['Add', 'c', 1]]], ['Assign', 'c', ['Add', 'c', 'k']]], 'k', 1, 'n'),
        'c'
      )
    );
    const [op] = loopsOf(program.root);
    const branch = op.body.operations.find((o): o is IRIf => o.kind === 'if')!;
    expect(branch.results).toHaveLength(1);
    expect(isClosedRegion(branch.then)).toBe(true);
  });
});

describe('the verifier, an exit', () => {
  /** The lowered program of `json`, its nodes, and the loop with its
   *  closed branch. */
  function lowered(source: MathJsonExpression = fn(
    NX,
    declare('c', 'integer', 0),
    loop(['Block', ['If', ['Less', 'x', 'k'], BREAK], ['Assign', 'c', ['Add', 'c', 1]]], 'k', 1, 'n'),
    'c'
  )) {
    const { preparation, program } = lowerJson(source);
    const nodes = preparedNodesOf(preparation);
    const rootOps = program.root.operations;
    const loopIndex = rootOps.findIndex((op) => op.kind === 'loop');
    const loopOp = rootOps[loopIndex] as IRLoop;
    const ifIndex = loopOp.body.operations.findIndex((op) => op.kind === 'if');
    const ifOp = loopOp.body.operations[ifIndex] as IRIf;
    const exit = ifOp.then.operations[ifOp.then.operations.length - 1] as IRExit;
    /** The program with the closed branch `then`, the `if` and the loop
     *  body changed. */
    const withBranch = (then: IROperation[], changeIf: Partial<IRIf> = {}, bodyTail?: IROperation[]): IRProgram => {
      const newIf: IRIf = { ...ifOp, then: { ...ifOp.then, operations: then }, ...changeIf };
      const bodyOps = [...loopOp.body.operations];
      bodyOps[ifIndex] = newIf;
      if (bodyTail !== undefined) bodyOps.splice(bodyOps.length - 1, 1, ...bodyTail);
      const newLoop: IRLoop = { ...loopOp, body: { ...loopOp.body, operations: bodyOps } };
      const root = [...rootOps];
      root[loopIndex] = newLoop;
      return { ...program, root: { ...program.root, operations: root } };
    };
    let nextId = 10_000;
    const value = (type: IRValue['type'], representation: string): IRValue => ({
      ...exit.operands[0],
      id: nextId++,
      type,
      representation,
    });
    const literal = (result: IRValue, v: number | boolean): IROperation => ({
      kind: 'literal',
      value: v,
      result,
      operands: [],
      effect: 'pure',
      origin: exit.origin,
    });
    return { program, nodes, loopOp, ifOp, exit, withBranch, value, literal, rootOps };
  }

  const verify = (program: IRProgram, nodes: ReadonlySet<Expression>) => () => verifyJavaScriptProgram(program, nodes);

  test('control: the lowered program verifies', () => {
    const m = lowered();
    expect(verify(m.program, m.nodes)).not.toThrow();
  });

  test('an operation after an exit', () => {
    const m = lowered();
    const v = m.value('real', 'number');
    expect(verify(m.withBranch([m.exit, m.literal(v, 1)]), m.nodes)).toThrow(/an operation follows an exit/);
  });

  test('an exit with another count of operands than the results of its loop', () => {
    const m = lowered();
    expect(verify(m.withBranch([{ ...m.exit, operands: [] }]), m.nodes)).toThrow(
      /an exit has 0 operands, and its loop has 1 results/
    );
  });

  test('an operand of an exit of another representation', () => {
    const m = lowered();
    const flag = m.value('boolean', 'boolean');
    expect(verify(m.withBranch([m.literal(flag, true), { ...m.exit, operands: [flag] }]), m.nodes)).toThrow(
      /the operand 1 of an exit has the representation boolean, and the carried value 1 of its loop number/
    );
  });

  test('an operand of an exit of another type', () => {
    const m = lowered();
    const real = m.value('real', 'number');
    expect(verify(m.withBranch([m.literal(real, 0.5), { ...m.exit, operands: [real] }]), m.nodes)).toThrow(
      /the operand 1 of an exit has the type real, and the carried value 1 of its loop the type integer/
    );
  });

  test('an exit with an effect, and an exit with a result', () => {
    const m = lowered();
    expect(verify(m.withBranch([{ ...m.exit, effect: 'effectful' }], { effect: 'effectful' }), m.nodes)).toThrow(
      /an exit has the effect effectful/
    );
    const v = m.value('real', 'number');
    expect(verify(m.withBranch([{ ...m.exit, result: v } as unknown as IROperation]), m.nodes)).toThrow(
      /an exit has a result/
    );
  });

  test('a closed region with a yield', () => {
    const m = lowered();
    const yieldOp: IROperation = { kind: 'yield', operands: [], effect: 'pure', origin: m.exit.origin };
    expect(verify(m.withBranch([yieldOp, m.exit]), m.nodes)).toThrow(/a closed region has a yield/);
  });

  test('a loop body that always exits', () => {
    const m = lowered();
    const bodyOps = [...m.loopOp.body.operations];
    bodyOps[bodyOps.length - 1] = { ...m.exit, operands: [m.loopOp.body.parameters![1]] };
    const root = [...m.rootOps];
    root[root.indexOf(m.loopOp)] = { ...m.loopOp, body: { ...m.loopOp.body, operations: bodyOps } };
    expect(verify({ ...m.program, root: { ...m.program.root, operations: root } }, m.nodes)).toThrow(
      /the body of a loop is closed: every pass exits/
    );
  });

  test('a closed region that is not a branch of an if', () => {
    const m = lowered();
    const root = [...m.rootOps];
    root[root.length - 1] = { ...m.exit, operands: [] };
    expect(verify({ ...m.program, root: { ...m.program.root, operations: root } }, m.nodes)).toThrow(
      /a region that is not a branch of an if is closed/
    );
  });

  test('an exit outside the body of a loop', () => {
    const m = lowered();
    const flag = m.value('boolean', 'boolean');
    const root = [...m.rootOps];
    const yieldOp = root[root.length - 1];
    const ifOp: IRIf = {
      ...m.ifOp,
      operands: [flag],
      results: [],
      then: { operations: [{ ...m.exit, operands: [] }], effect: 'pure' },
      else: { operations: [{ kind: 'yield', operands: [], effect: 'pure', origin: m.exit.origin }], effect: 'pure' },
    };
    root.splice(root.length - 1, 1, m.literal(flag, true), ifOp, yieldOp);
    expect(verify({ ...m.program, root: { ...m.program.root, operations: root } }, m.nodes)).toThrow(
      /an exit is outside the body of a loop/
    );
  });

  test('an exit in a region of an and between it and its loop', () => {
    const m = lowered();
    const flag = m.value('boolean', 'boolean');
    const result = m.value('boolean', 'boolean');
    const inner: IRIf = {
      ...m.ifOp,
      operands: [flag],
      results: [],
      then: { operations: [m.exit], effect: 'pure' },
      else: { operations: [{ kind: 'yield', operands: [], effect: 'pure', origin: m.exit.origin }], effect: 'pure' },
    };
    const and: IROperation = {
      kind: 'and',
      result,
      operands: [flag],
      rest: [
        {
          operations: [inner, { kind: 'yield', operands: [flag], effect: 'pure', origin: m.exit.origin }],
          effect: 'pure',
        },
      ],
      effect: 'pure',
      origin: m.exit.origin,
    };
    const bodyOps = [...m.loopOp.body.operations];
    bodyOps.splice(0, 0, m.literal(flag, true), and);
    const root = [...m.rootOps];
    root[root.indexOf(m.loopOp)] = { ...m.loopOp, body: { ...m.loopOp.body, operations: bodyOps } };
    expect(verify({ ...m.program, root: { ...m.program.root, operations: root } }, m.nodes)).toThrow(
      /an exit is in a region of the operation and, between it and its loop/
    );
  });

  test('an if whose two branches are closed: no result, and the last operation', () => {
    const m = lowered();
    const closedElse = { ...m.ifOp.then };
    // Two closed branches and one result, as the last operation of a
    // branch.
    const v = m.value('integer', 'number');
    const inner: IRIf = { ...m.ifOp, then: m.ifOp.then, else: closedElse, results: [v] };
    expect(verify(m.withBranch([inner]), m.nodes)).toThrow(/an if whose two branches are closed has 1 results/);
    // Without the result, it closes the branch that holds it.
    expect(verify(m.withBranch([{ ...inner, results: [] }]), m.nodes)).not.toThrow();
    // Two closed branches, then the yield of the body.
    expect(verify(m.withBranch([m.exit], { else: closedElse, results: [] }), m.nodes)).toThrow(
      /an operation follows an if whose two branches are closed/
    );
  });
});

//
// Admission
//

describe('admission', () => {
  const body = (statement: MathJsonExpression) =>
    fn(NX, declare('s', 'real', 0), loop(statement, 'k', 1, 'n'), 's');
  const refusals: [string, MathJsonExpression, RegExp][] = [
    [
      'a Break that is a statement of the loop body',
      body(['Block', ['Assign', 's', 'k'], BREAK]),
      /admits a Break only as the last statement of a branch of an If, not as a statement of the body of a Loop/,
    ],
    ['the loop body is a Break', body(BREAK), /admits a Break only as the last statement of a branch of an If/],
    [
      'a statement after a Break in a branch',
      body(['If', ['Less', 'x', 'k'], ['Block', BREAK, ['Assign', 's', 'k']]]),
      /admits no statement after a Break, or after an If whose two branches end in Break/,
    ],
    [
      'a statement after an If whose two branches end in Break',
      body(['Block', ['If', ['Less', 'x', 'k'], BREAK, BREAK], ['Assign', 's', 'k']]),
      /admits no statement after a Break, or after an If whose two branches end in Break/,
    ],
    [
      'a loop body that always ends in Break',
      body(['Block', ['Assign', 's', 'k'], ['If', ['Less', 'x', 'k'], BREAK, BREAK]]),
      /admits no Loop whose body always ends in Break/,
    ],
    [
      'a Break with a value',
      body(['If', ['Less', 'x', 'k'], ['Break', 's']]),
      /admits no statement Break in a branch of an If/,
    ],
    [
      'a Break outside a loop',
      fn(NX, declare('s', 'real', 0), ['If', ['Less', 'x', 1], BREAK], 's'),
      /admits no statement Break in a branch of an If/,
    ],
    [
      'a Break in a value',
      body(['Assign', 's', ['If', ['Less', 'x', 'k'], BREAK, 1]]),
      /`Break\(\)` is a statement, and it stands where a value is expected/,
    ],
  ];
  test.each(refusals)('%s', (_name, json, reason) => {
    expect(() => structured().prepareStructured(new ComputeEngine().expr(json), OPTIONS)).toThrow(reason);
  });
});
