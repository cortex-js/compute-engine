import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { lowerStructuredFragment } from '../../src/compute-engine/compilation/javascript-structured-lower';
import { verifyJavaScriptProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import {
  verifyProgram,
  type RepresentationPolicy,
} from '../../src/compute-engine/compilation/structured-verify';
import type {
  IROperation,
  IRProgram,
  IRRegion,
  IRValue,
  ScalarKind,
  ValueType,
} from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Writes to locals and their merges at an `If`, on the structured route of
// the internal scalar JavaScript fragment target, and a verifier policy of a
// target that is not JavaScript (step 5, first change, of
// docs/plans/2026-11-09-js-compiler-status-and-plan.md).

const OPTIONS = { cse: false, constantFold: false } as const;

const typed = (name: string, type: string): MathJsonExpression => [
  'Typed',
  name,
  `'${type}'`,
];

/** The parameters of every fixture, in order. */
const PARAMETERS: MathJsonExpression[] = [
  typed('w', 'real'),
  typed('C', 'boolean'),
  typed('D', 'boolean'),
  typed('u', 'complex'),
  typed('k', 'integer'),
];

/** A `Function` whose body is a block of `statements`. */
const fn = (...statements: MathJsonExpression[]): MathJsonExpression => [
  'Function',
  ['Block', ...statements],
  ...PARAMETERS,
];

const declare = (name: string, type: string, value: MathJsonExpression): MathJsonExpression => [
  'Declare',
  name,
  `'${type}'`,
  value,
];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('g', 'real');
  // `console` is an impurity label: the definition states an effect.
  ce.declare('Trace', {
    signature: '(real) -> real',
    effects: ['console'],
    evaluate: (ops) => ops[0],
  } as never);
  return ce;
}

const TRACE_SOURCE = (id: string, operands: readonly string[]) =>
  `globalThis.__ceTrace(${JSON.stringify(id)}, ${operands.join(', ')})`;

const structured = () =>
  new ScalarFragmentJavaScriptTarget('structured', new Map([['Trace', 'trace']]), {
    trace: TRACE_SOURCE,
  });

type Value = number | boolean | { re: number; im: number };

function run(result: CompilationResult<'javascript'>, inputs: Value[]): unknown {
  return (result.run as unknown as (...a: unknown[]) => unknown)(...inputs);
}

function boxValue(ce: ComputeEngine, v: Value): Expression {
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (typeof v === 'number') return ce.number(v);
  return ce.expr(['Complex', v.re, v.im]);
}

/** The value of `json` on `inputs` by the interpreter. */
function interpret(ce: ComputeEngine, json: MathJsonExpression, inputs: Value[]): unknown {
  const value = ce
    .function('Apply', [ce.expr(json), ...inputs.map((v) => boxValue(ce, v))])
    .evaluate();
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  const n = value.N();
  if (n.im === 0) return n.re;
  return { re: n.re, im: n.im };
}

/** Equal values, with `0` equal to `-0`. */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null)
    return (
      sameValue((a as { re: number }).re, (b as { re: number }).re) &&
      sameValue((a as { im: number }).im, (b as { im: number }).im)
    );
  return a === b;
}

/** The inputs `w, C, D, u, k`: each outcome of `C` and `D`, two values of
 *  `w` and of `k`. */
const INPUTS: Value[][] = [true, false].flatMap((C) =>
  [true, false].flatMap((D) =>
    [
      [1.5, 3],
      [-2, -1],
    ].map(([w, k]) => [w, C, D, { re: 3, im: 4 }, k])
  )
);

/** `existing: false`: the existing emitter declines the program, and only
 *  the interpreter checks it. */
const FIXTURES: { name: string; json: MathJsonExpression; existing?: false }[] = [
  {
    name: 'reassignment at the top level',
    json: fn(
      declare('t', 'real', 'w'),
      ['Assign', 't', ['Add', 't', 1]],
      ['Assign', 't', ['Multiply', 't', 'w']],
      't'
    ),
  },
  {
    name: 'a write in one branch',
    json: fn(declare('t', 'real', 'w'), ['If', 'C', ['Assign', 't', ['Add', 't', 1]]], 't'),
  },
  {
    name: 'a write in the else branch only',
    json: fn(
      declare('t', 'real', 'w'),
      ['If', 'C', ['Block', ['Assign', 't', 't']], ['Assign', 't', ['Negate', 't']]],
      ['Add', 't', 'w']
    ),
  },
  {
    name: 'writes of two locals in both branches',
    json: fn(
      declare('a', 'real', 'w'),
      declare('b', 'real', 0),
      [
        'If',
        'C',
        ['Block', ['Assign', 'a', ['Add', 'a', 1]], ['Assign', 'b', ['Multiply', 'a', 2]]],
        ['Block', ['Assign', 'a', 5], ['Assign', 'b', 'w']],
      ],
      ['Add', 'a', 'b']
    ),
  },
  {
    name: 'nested If',
    json: fn(
      declare('t', 'real', 'w'),
      declare('s', 'real', 1),
      [
        'If',
        'C',
        ['If', 'D', ['Assign', 't', 1], ['Block', ['Assign', 't', 2], ['Assign', 's', 't']]],
        ['If', 'D', ['Assign', 's', ['Add', 's', 't']], ['Assign', 't', 3]],
      ],
      ['Add', 't', ['Multiply', 10, 's']]
    ),
  },
  {
    // The existing emitter declines an `If` of one branch that is a
    // branch of another `If` ("wrong number of arguments").
    name: 'nested If with no else branch',
    json: fn(
      declare('t', 'real', 'w'),
      ['If', 'C', ['Assign', 't', 1], ['If', 'D', ['Assign', 't', ['Add', 't', 2]]]],
      't'
    ),
    existing: false,
  },
  {
    name: 'a write then a read in a branch',
    json: fn(
      declare('a', 'real', 'w'),
      declare('b', 'real', 0),
      ['If', 'C', ['Block', ['Assign', 'a', ['Add', 'a', 1]], ['Assign', 'b', ['Multiply', 'a', 'a']]]],
      ['Add', 'a', 'b']
    ),
  },
  {
    name: 'an accumulation written three times',
    json: fn(
      declare('s', 'real', 0),
      ['Assign', 's', ['Add', 's', 'w']],
      ['If', 'C', ['Assign', 's', ['Add', 's', 'w']]],
      ['Assign', 's', ['Add', 's', 'w']],
      's'
    ),
  },
  {
    name: 'a complex local',
    json: fn(
      declare('q', 'complex', 'u'),
      ['If', 'C', ['Assign', 'q', ['Add', 'q', 'w']], ['Assign', 'q', ['Negate', 'q']]],
      ['Add', 'q', 'w']
    ),
  },
  {
    name: 'an integer local',
    json: fn(
      declare('n', 'integer', 'k'),
      ['If', 'C', ['Assign', 'n', ['Add', 'n', 1]]],
      ['Assign', 'n', ['Add', 'n', 'k']],
      'n'
    ),
  },
  {
    name: 'a boolean local',
    json: fn(
      declare('f', 'boolean', 'C'),
      ['If', 'D', ['Assign', 'f', ['Less', 'w', 0]]],
      ['If', 'f', 'w', ['Negate', 'w']]
    ),
  },
  {
    name: 'a local written and never read again',
    json: fn(declare('t', 'real', 'w'), ['If', 'C', ['Assign', 't', ['Add', 't', 1]]], 'w'),
  },
  // A nested `If` that writes a local that no later statement reads: the
  // nested `If` removes the local, and the outer one does not merge it.
  {
    name: 'a nested If with an else branch writes a local that is not read again',
    json: fn(
      declare('t', 'real', 'w'),
      ['If', 'C', ['If', 'D', ['Assign', 't', 1], ['Assign', 't', 2]]],
      'w'
    ),
  },
  {
    name: 'a nested If with no else branch writes a local that is not read again',
    json: fn(declare('t', 'real', 'w'), ['If', 'C', ['If', 'D', ['Assign', 't', 1]]], 'w'),
  },
  {
    name: 'a local written by a nested If and read after an intermediate statement',
    json: fn(
      declare('t', 'real', 'w'),
      declare('s', 'real', 0),
      ['If', 'C', ['If', 'D', ['Assign', 't', 1]]],
      ['Assign', 's', ['Add', 'w', 1]],
      ['Add', 't', 's']
    ),
  },
  {
    name: 'a local written by a nested If in one branch and directly in the other',
    json: fn(
      declare('t', 'real', 'w'),
      ['If', 'C', ['If', 'D', ['Assign', 't', 1], ['Assign', 't', 3]], ['Assign', 't', 2]],
      't'
    ),
  },
  {
    name: 'a local written by a nested If in one branch and directly in the other, not read again',
    json: fn(
      declare('t', 'real', 'w'),
      ['If', 'C', ['If', 'D', ['Assign', 't', 1], ['Assign', 't', 3]], ['Assign', 't', 2]],
      'w'
    ),
  },
];

/** The program of the fixture `name`. */
const fixture = (name: string): MathJsonExpression =>
  FIXTURES.find((f) => f.name === name)!.json;

describe('differential: the interpreter decides, the existing emitter checks', () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, () => {
      const ce = engine();
      const expr = ce.expr(fixture.json);
      const result = structured().compile(expr, OPTIONS);
      expect(result.success).toBe(true);
      const existing =
        fixture.existing === false
          ? undefined
          : compile(expr, { ...OPTIONS, fallback: false });
      for (const inputs of INPUTS) {
        const value = run(result, inputs);
        expect([inputs, sameValue(value, interpret(ce, fixture.json, inputs))]).toEqual([
          inputs,
          true,
        ]);
        if (existing) expect([inputs, value]).toEqual([inputs, run(existing, inputs)]);
      }
    });
  }
});

//
// The representation
//

/** Every operation of `region` and of the regions nested in it. */
function allOps(region: IRRegion): IROperation[] {
  const result: IROperation[] = [];
  for (const op of region.operations) {
    result.push(op);
    if (op.kind === 'if') result.push(...allOps(op.then), ...allOps(op.else));
    if (op.kind === 'and' || op.kind === 'or')
      for (const r of op.rest) result.push(...allOps(r));
  }
  return result;
}

const lower = (json: MathJsonExpression) =>
  lowerStructuredFragment(structured().prepareStructured(engine().expr(json), OPTIONS));

describe('single-definition values', () => {
  test('each write is a new value, and the root yields the last one', () => {
    const program = lower(fixture('reassignment at the top level'));
    const ops = program.root.operations;
    const multiply = ops.find((op) => op.kind === 'multiply')!;
    const add = ops.find((op) => op.kind === 'add')!;
    expect(multiply.operands[0].id).toBe(add.result!.id);
    expect(ops[ops.length - 1].operands[0].id).toBe(multiply.result!.id);
  });

  test('an If statement has one result per merged local, in order', () => {
    const program = lower(fixture('writes of two locals in both branches'));
    const conditional = program.root.operations.find((op) => op.kind === 'if');
    if (conditional?.kind !== 'if') throw new Error('expected if');
    expect(conditional.results.map((r) => r.type)).toEqual(['real', 'real']);
    // The else branch yields `5` for `a` and the read of `w` for `b`.
    const yields = conditional.else.operations[conditional.else.operations.length - 1];
    expect(yields.operands).toHaveLength(2);
    const sum = program.root.operations.find((op) => op.kind === 'add')!;
    expect(sum.operands.map((v) => v.id)).toEqual(conditional.results.map((v) => v.id));
  });

  test('a local that a branch does not write merges with its value before the If', () => {
    const program = lower(fixture('a write in one branch'));
    const conditional = program.root.operations.find((op) => op.kind === 'if');
    if (conditional?.kind !== 'if') throw new Error('expected if');
    const before = program.root.operations[0].result!;
    expect(conditional.else.operations).toHaveLength(1);
    expect(conditional.else.operations[0].operands[0].id).toBe(before.id);
  });

  test('a local that is never read again is not merged, and a pure If is not lowered', () => {
    const program = lower(fixture('a local written and never read again'));
    expect(allOps(program.root).some((op) => op.kind === 'if')).toBe(false);
    // With an effect in its branch, the If stays, with no result.
    const traced = lower(
      fn(declare('t', 'real', 'w'), ['If', 'C', ['Assign', 't', ['Trace', 't']]], 'w')
    );
    const conditional = traced.root.operations.find((op) => op.kind === 'if');
    if (conditional?.kind !== 'if') throw new Error('expected if');
    expect(conditional.results).toEqual([]);
    expect(conditional.effect).toBe('effectful');
  });

  // No program reaches two branch values of one representation and of
  // types other than integer and real: the facts of the literal `1` are
  // changed to a boolean held as a number. The write of that value to the
  // real local throws before the merge.
  test('a merge of a boolean and a real value throws', () => {
    const preparation = structured().prepareStructured(
      engine().expr(fn(declare('t', 'real', 'w'), ['If', 'C', ['Assign', 't', 1]], 't')),
      OPTIONS
    );
    const block = preparation.annotation.scope.inner.values().next().value!;
    const one = [...block.facts.keys()].find((node) => node.isNumberLiteral && node.re === 1)!;
    block.facts.set(one, { type: { kind: 'boolean' }, representation: 'number' });
    expect(() => lowerStructuredFragment(preparation)).toThrow(
      /a value of the type boolean is written to the local t of the type real/
    );
  });

  test('the merge of an integer and a real value is real; of two integers, integer', () => {
    const real = lower(
      fn(declare('t', 'real', 'k'), ['If', 'C', ['Assign', 't', 'w']], 't')
    );
    const a = real.root.operations.find((op) => op.kind === 'if');
    if (a?.kind !== 'if') throw new Error('expected if');
    expect(a.results.map((r) => r.type)).toEqual(['real']);
    const integer = lower(fixture('an integer local'));
    const b = integer.root.operations.find((op) => op.kind === 'if');
    if (b?.kind !== 'if') throw new Error('expected if');
    expect(b.results.map((r) => r.type)).toEqual(['integer']);
  });
});

describe('the emitted code', () => {
  const code = (json: MathJsonExpression) =>
    structured().compile(engine().expr(json), OPTIONS).code;

  test('a pruned If leaves no trace of its pure condition', () => {
    expect(
      code(fn(declare('t', 'real', 'w'), ['If', ['Less', 'w', 0], ['Assign', 't', 1]], 'w'))
    ).toBe('(w, C, D, u, k) => { const _tv1 = w; return w; }');
  });

  test('writes of two locals in both branches: one let per result', () => {
    expect(code(fixture('writes of two locals in both branches'))).toBe(
      '(w, C, D, u, k) => { const _tv1 = w; let _tv3, _tv4; if (C) { const _tv2 = _tv1 + 1; _tv3 = _tv2; _tv4 = 2 * _tv2; } else { _tv3 = 5; _tv4 = w; } return _tv3 + _tv4; }'
    );
  });

  test('one merged value from branches that are expressions: a conditional', () => {
    expect(code(fixture('an integer local'))).toBe(
      '(w, C, D, u, k) => { const _tv1 = k; return k + (C ? _tv1 + 1 : _tv1); }'
    );
  });
});

//
// Refusals
//

describe('refusals', () => {
  const refusals: [string, MathJsonExpression, RegExp][] = [
    [
      'a write to a parameter',
      fn(declare('t', 'real', 'w'), ['Assign', 'w', 1], 't'),
      /only writes to a declared local are supported, and w is a parameter/,
    ],
    [
      'a write to a parameter in a branch',
      fn(declare('t', 'real', 'w'), ['If', 'C', ['Assign', 'w', 1]], 't'),
      /only writes to a declared local are supported, and w is a parameter/,
    ],
    [
      'a write to an outer binding',
      fn(declare('t', 'real', 'w'), ['If', 'C', ['Assign', 'g', 1]], 't'),
      /only writes to a declared local are supported, and g is not a local declared before the write/,
    ],
    [
      'a write that changes the representation, at the top level',
      fn(declare('t', 'complex', 'u'), ['Assign', 't', 'w'], 't'),
      /local writes must preserve representation/,
    ],
    [
      'a write that changes the representation, in a branch',
      fn(declare('t', 'complex', 'u'), ['If', 'C', ['Assign', 't', 'w']], 't'),
      /local writes must preserve representation/,
    ],
    [
      'a complex value written to a real local',
      fn(declare('t', 'real', 'w'), ['If', 'C', ['Assign', 't', 'u']], 't'),
      /the local t is declared real, and the value u written to it has the type complex, which is not real/,
    ],
    [
      'a real value written to an integer local, in a branch',
      fn(declare('n', 'integer', 'k'), ['If', 'C', ['Assign', 'n', 'w']], 'n'),
      /a value written to the integer local n does not have the type integer/,
    ],
    [
      'a write inside an And operand, in the canonical form',
      fn(
        declare('b', 'boolean', 'C'),
        declare('t', 'real', 'w'),
        ['If', ['And', 'C', ['Assign', 'b', 'False']], ['Assign', 't', 1]],
        't'
      ),
      /invalid bound expression/,
    ],
    [
      // A loop with no index set is admitted since
      // compile-javascript-structured-statements.test.ts; one with a guard
      // is not.
      'a loop with a guard',
      fn(declare('t', 'real', 'w'), ['Loop', ['Assign', 't', ['Add', 't', 1]], ['Element', 'k', ['Range', 1, 3], ['Less', 'k', 2]]], 't'),
      /the structured route admits a Loop only over Element\(k, Range\(a, b\)\) or the elements of a list, with no guard/,
    ],
    [
      'a Return in a branch',
      fn(declare('t', 'real', 'w'), ['If', 'C', ['Return', 't']], 't'),
      /the structured route admits no statement Return in a branch of an If/,
    ],
    [
      'a Break in a branch',
      fn(declare('t', 'real', 'w'), ['If', 'C', ['Break']], 't'),
      /the structured route admits no statement Break in a branch of an If/,
    ],
    // A declaration in a block of a branch is admitted
    // (compile-javascript-structured-loops.test.ts); a branch that is a
    // declaration is an error when the expression is boxed.
    [
      'a branch that is a declaration',
      fn(declare('t', 'real', 'w'), ['If', 'C', declare('s', 'real', 1)], 't'),
      /the structured route admits no statement Error in a branch of an If/,
    ],
  ];
  test.each(refusals)('%s', (_name, json, reason) => {
    expect(() => structured().prepareStructured(engine().expr(json), OPTIONS)).toThrow(reason);
  });

  // The canonical form makes an assignment in an operand an error
  // (`assignment-in-operand`), and a made node `And(C, Assign(t, True))` is
  // not valid either: both are refused as invalid expressions.
  test('a write inside an And operand, in a made node', () => {
    const ce = engine();
    const made = (h: string, ops: Expression[]) =>
      (ce as unknown as { _fn(h: string, ops: Expression[]): Expression })._fn(h, ops);
    const and = made('And', [ce.expr('C'), made('Assign', [ce.symbol('t'), ce.True])]);
    const body = made('Block', [ce.expr(declare('t', 'boolean', 'C')), and]);
    const expr = made('Function', [body, ...PARAMETERS.map((p) => ce.expr(p))]);
    expect(() => structured().prepareStructured(expr, OPTIONS)).toThrow(
      /invalid bound expression/
    );
  });
});

//
// Order and laziness
//

describe('order and laziness, with the test operation', () => {
  let traces: string[] = [];
  beforeEach(() => {
    traces = [];
    (globalThis as Record<string, unknown>).__ceTrace = (id: string, ...args: number[]) => {
      traces.push(`${id}(${args.join(',')})`);
      return args[0] ?? 0;
    };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__ceTrace;
  });

  test('an effectful write runs once, in its branch only', () => {
    const json = fn(
      declare('t', 'real', 'w'),
      ['If', 'C', ['Assign', 't', ['Trace', ['Add', 't', 1]]]],
      ['Add', 't', ['Multiply', 't', 't']]
    );
    const result = structured().compile(engine().expr(json), OPTIONS);
    expect(run(result, [2, false, false, { re: 0, im: 0 }, 0])).toBe(6);
    expect(traces).toEqual([]);
    expect(run(result, [2, true, false, { re: 0, im: 0 }, 0])).toBe(12);
    expect(traces).toEqual(['trace(3)']);
  });

  test('the effectful condition of a pruned If runs once', () => {
    const json = fn(
      declare('t', 'real', 'w'),
      ['If', ['Less', ['Trace', 'w'], 0], ['Assign', 't', 1]],
      'w'
    );
    const result = structured().compile(engine().expr(json), OPTIONS);
    expect(run(result, [-2, true, false, { re: 0, im: 0 }, 0])).toBe(-2);
    expect(traces).toEqual(['trace(-2)']);
  });

  test('effectful writes in both branches and after the If keep their order', () => {
    const json = fn(
      declare('t', 'real', ['Trace', 'w']),
      ['If', 'C', ['Assign', 't', ['Trace', ['Add', 't', 1]]], ['Assign', 't', ['Trace', ['Add', 't', 2]]]],
      ['Assign', 't', ['Trace', ['Add', 't', 10]]],
      't'
    );
    const result = structured().compile(engine().expr(json), OPTIONS);
    expect(run(result, [1, true, false, { re: 0, im: 0 }, 0])).toBe(12);
    expect(traces).toEqual(['trace(1)', 'trace(2)', 'trace(12)']);
    traces.length = 0;
    expect(run(result, [1, false, false, { re: 0, im: 0 }, 0])).toBe(13);
    expect(traces).toEqual(['trace(1)', 'trace(3)', 'trace(13)']);
  });
});

//
// The verifier: an `if` with several results
//

/** A made program: `If(C, (x, b), (1, b))` whose two results are a real
 *  and a boolean, and whose root yields the real one. */
function madeTwoResults() {
  const origin = engine().expr('x');
  const owner = {};
  let next = 0;
  const value = (type: ScalarKind): IRValue => ({
    owner,
    revision: 1,
    id: next++,
    type,
    representation: type === 'real' || type === 'integer' ? 'number' : type,
  });
  const yieldOf = (...values: IRValue[]): IROperation => ({
    kind: 'yield',
    operands: values,
    effect: 'pure',
    origin,
  });
  const region = (operations: IROperation[]): IRRegion => ({ operations, effect: 'pure' });
  const c = value('boolean');
  const x = value('real');
  const one = value('real');
  const real = value('real');
  const flag = value('boolean');
  const thenOps: IROperation[] = [
    { kind: 'input', input: 1, result: x, operands: [], effect: 'pure', origin },
    yieldOf(x, c),
  ];
  const elseOps: IROperation[] = [
    { kind: 'literal', value: 1, result: one, operands: [], effect: 'pure', origin },
    yieldOf(one, c),
  ];
  const conditional = {
    kind: 'if' as const,
    results: [real, flag],
    operands: [c],
    then: region(thenOps),
    else: region(elseOps),
    effect: 'pure' as const,
    origin,
  };
  const rootOps: IROperation[] = [
    { kind: 'input', input: 0, result: c, operands: [], effect: 'pure', origin },
    conditional,
    yieldOf(real),
  ];
  const program: IRProgram = {
    owner,
    revision: 1,
    inputs: [
      { name: 'C', type: 'boolean', representation: 'boolean' },
      { name: 'x', type: 'real', representation: 'number' },
    ],
    numericPolicy: 'strict',
    captures: [],
    functions: [],
    root: region(rootOps),
  };
  return { program, prepared: new Set([origin]), rootOps, thenOps, elseOps, conditional, yieldOf, x, c, one, real, flag, value };
}

describe('the verifier, an if with several results', () => {
  test('control: the made program verifies', () => {
    const m = madeTwoResults();
    expect(() => verifyJavaScriptProgram(m.program, m.prepared)).not.toThrow();
  });

  test('a region that yields fewer values than the results', () => {
    const m = madeTwoResults();
    m.thenOps[1] = m.yieldOf(m.x);
    expect(() => verifyJavaScriptProgram(m.program, m.prepared)).toThrow(
      /a region of an if yields 1 values, and the if has 2 results/
    );
  });

  test('a region that yields its values in another order', () => {
    const m = madeTwoResults();
    m.elseOps[1] = m.yieldOf(m.c, m.one);
    expect(() => verifyJavaScriptProgram(m.program, m.prepared)).toThrow(
      /the two results of an if have different representations \(number, boolean\)/
    );
  });

  test('a result of another type than the values of its regions', () => {
    const m = madeTwoResults();
    const integer = { ...m.real, type: 'integer' as ScalarKind };
    m.rootOps[1] = { ...m.conditional, results: [integer, m.flag] };
    m.rootOps[2] = m.yieldOf(integer);
    expect(() => verifyJavaScriptProgram(m.program, m.prepared)).toThrow(
      /the result of an if has the type integer, and its regions the types real and real/
    );
  });

  test('a region that is not of an if yields one value', () => {
    const m = madeTwoResults();
    m.rootOps[2] = m.yieldOf(m.real, m.flag);
    expect(() => verifyJavaScriptProgram(m.program, m.prepared)).toThrow(
      /the operation yield has 2 operands, not 1/
    );
  });
});

//
// A second policy
//

/** A policy of a made target, with other names for the representations:
 *  `float` for a real or an integer, `bool` for a boolean, and no complex
 *  number and no list. The core does not depend on the names of
 *  JavaScript. */
const FLOAT_POLICY: RepresentationPolicy = {
  name: 'Test',
  representations: new Set(['float', 'bool']),
  representationOf: (type) =>
    type.startsWith('list<') ? undefined : type === 'boolean' ? 'bool' : 'float',
  conversions: {},
  operations: {
    add: { results: ['float'], operands: 'same' },
    negate: { results: ['float'], operands: 'same' },
    multiply: { results: ['float'], operands: ['float'] },
    min: { results: ['float'], operands: ['float'] },
    max: { results: ['float'], operands: ['float'] },
    less: { results: ['bool'], operands: ['float'] },
    'less-equal': { results: ['bool'], operands: ['float'] },
    equal: { results: ['bool'], operands: ['float'] },
    'not-equal': { results: ['bool'], operands: ['float'] },
    and: { results: ['bool'], operands: ['bool'] },
    or: { results: ['bool'], operands: ['bool'] },
    mod: { results: ['float'], operands: ['float'] },
    floor: { results: ['float'], operands: ['float'] },
    divide: { results: ['float'], operands: ['float'] },
    sqrt: { results: ['float'], operands: 'same' },
    at: { results: ['float'], operands: ['float'] },
    length: { results: ['float'], operands: ['float'] },
    not: { results: ['bool'], operands: ['bool'] },
    build: { results: ['float'], operands: ['float'] },
    'replace-at': { results: ['float'], operands: ['float'] },
    trace: { results: ['float'], operands: ['float'] },
  },
  functions: {},
};

describe('a policy that is not the one of JavaScript', () => {
  /** `If(C, x + 1, x) < 2`, with the representations of `FLOAT_POLICY`. */
  function made(representation: (type: ValueType) => string | undefined) {
    const origin = engine().expr('x');
    const owner = {};
    let next = 0;
    const value = (type: ScalarKind): IRValue => ({
      owner,
      revision: 1,
      id: next++,
      type,
      representation: representation(type) ?? '',
    });
    const yieldOf = (v: IRValue): IROperation => ({ kind: 'yield', operands: [v], effect: 'pure', origin });
    const region = (operations: IROperation[]): IRRegion => ({ operations, effect: 'pure' });
    const [c, x, one, sum, branch, two, less] = (
      ['boolean', 'real', 'integer', 'real', 'real', 'integer', 'boolean'] as ScalarKind[]
    ).map(value);
    const program: IRProgram = {
      owner,
      revision: 1,
      inputs: [
        { name: 'C', type: 'boolean', representation: representation('boolean')! },
        { name: 'x', type: 'real', representation: representation('real')! },
      ],
      numericPolicy: 'strict',
      captures: [],
      functions: [],
      root: region([
        { kind: 'input', input: 0, result: c, operands: [], effect: 'pure', origin },
        { kind: 'input', input: 1, result: x, operands: [], effect: 'pure', origin },
        {
          kind: 'if',
          results: [branch],
          operands: [c],
          then: region([
            { kind: 'literal', value: 1, result: one, operands: [], effect: 'pure', origin },
            { kind: 'add', result: sum, operands: [x, one], effect: 'pure', origin },
            yieldOf(sum),
          ]),
          else: region([yieldOf(x)]),
          effect: 'pure',
          origin,
        },
        { kind: 'literal', value: 2, result: two, operands: [], effect: 'pure', origin },
        { kind: 'less', result: less, operands: [branch, two], effect: 'pure', origin },
        yieldOf(less),
      ]),
    };
    return { program, prepared: new Set([origin]) };
  }

  test('a program of the representations float and bool verifies under its policy', () => {
    const m = made(FLOAT_POLICY.representationOf);
    expect(() => verifyProgram(m.program, m.prepared, FLOAT_POLICY)).not.toThrow();
  });

  test('the same program does not verify under the JavaScript policy', () => {
    const m = made(FLOAT_POLICY.representationOf);
    expect(() => verifyJavaScriptProgram(m.program, m.prepared)).toThrow(
      /JS structured representation: the value 0 has the representation bool, which the target does not have/
    );
  });

  test('a list value under a policy that has no list representation', () => {
    const m = made(FLOAT_POLICY.representationOf);
    const origin = [...m.prepared][0];
    const list: IRValue = { owner: m.program.owner, revision: 1, id: 100, type: 'list<real>', representation: 'float' };
    const program: IRProgram = {
      ...m.program,
      inputs: [...m.program.inputs, { name: 'L', type: 'list<real>', representation: 'float' }],
      root: {
        ...m.program.root,
        operations: [
          { kind: 'input', input: 2, result: list, operands: [], effect: 'pure', origin },
          ...m.program.root.operations,
        ],
      },
    };
    expect(() => verifyProgram(program, m.prepared, FLOAT_POLICY)).toThrow(
      /Test structured representation: the value 100 has the type list<real>, which the target does not hold/
    );
  });

  test('the policy decides the representation of an operand', () => {
    const m = made(FLOAT_POLICY.representationOf);
    const policy: RepresentationPolicy = {
      ...FLOAT_POLICY,
      operations: { ...FLOAT_POLICY.operations, less: { results: ['bool'], operands: ['bool'] } },
    };
    expect(() => verifyProgram(m.program, m.prepared, policy)).toThrow(
      /Test structured representation: an operand of the operation less has the representation float/
    );
  });
});
