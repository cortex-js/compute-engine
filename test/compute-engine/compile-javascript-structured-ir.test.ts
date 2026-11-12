import { ComputeEngine } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { core } from '../../src/compute-engine/compilation/compiler-core-hooks';
import {
  lowerStructuredFragment,
  preparedNodesOf,
  type StructuredPreparation,
} from '../../src/compute-engine/compilation/javascript-structured-lower';
import {
  JAVASCRIPT_BIGINT_POLICY,
  JAVASCRIPT_POLICY,
  verifyJavaScriptProgram as verifyProgram,
} from '../../src/compute-engine/compilation/javascript-structured-policy';
import { lowerBigintProgram } from '../../src/compute-engine/compilation/javascript-structured-bigint';
import { requireBigintLane } from '../../src/compute-engine/compilation/compile-bigint-lane';
import {
  verifyProgram as verifyCore,
  type RepresentationPolicy,
} from '../../src/compute-engine/compilation/structured-verify';
import {
  touchesField,
  type EffectFact,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
  type ScalarKind,
  listType,
  tupleType,
} from '../../src/compute-engine/compilation/structured-ir';
import type { Expression } from '../../src/compute-engine/global-types';
import { isShadowedSymbol } from '../../src/compute-engine/library-shadowing';
import type { MathJsonExpression } from '../../src/math-json/types';

// The structured representation of the internal scalar JavaScript fragment
// target (step 2 of docs/plans/2026-11-09-js-compiler-status-and-plan.md):
// the lowering of the prepared root and its annotation, and the verifier.

const typed = (name: string, type: string): MathJsonExpression => [
  'Typed',
  name,
  `'${type}'`,
];

const OPTIONS = { cse: false, constantFold: false } as const;

/** `heatwall` of the heat showcase of Tycho, as the canonical form writes
 *  it: `Greater` is `Less` with the operands exchanged. */
const HEATWALL_BODY: MathJsonExpression = [
  'And',
  ['Greater', 'obstacle', 0.5],
  ['Equal', 'c', 16],
  ['Or', ['Less', 'r', 13], ['Greater', 'r', 18]],
];

const HEATCELL: MathJsonExpression = [
  'Function',
  [
    'Block',
    ['Declare', 'a', "'real'", ['Min', 0.25, ['Max', 0, 'd']]],
    [
      'If',
      ['heatwall', 'c', 'r', 'obstacle'],
      'v',
      ['Add', 'v', ['Multiply', 'a', ['Subtract', 's', ['Multiply', 4, 'v']]]],
    ],
  ],
  typed('v', 'real'),
  typed('s', 'real'),
  typed('d', 'real'),
  typed('c', 'integer'),
  typed('r', 'integer'),
  typed('obstacle', 'real'),
];

function heatEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('heatwall', '(integer, integer, real) -> boolean');
  ce.assign(
    'heatwall',
    ce.expr([
      'Function',
      HEATWALL_BODY,
      typed('c', 'integer'),
      typed('r', 'integer'),
      typed('obstacle', 'real'),
    ])
  );
  return ce;
}

function scalarEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('z', 'complex');
  ce.declare('C', 'boolean');
  ce.declare('c', 'integer');
  ce.declare('r', 'integer');
  ce.declare('obstacle', 'real');
  return ce;
}

const structured = (testOperations?: ReadonlyMap<string, string>) =>
  new ScalarFragmentJavaScriptTarget('structured', testOperations);

function lower(expr: Expression, testOperations?: ReadonlyMap<string, string>) {
  return lowerStructuredFragment(structured(testOperations).prepareStructured(expr, OPTIONS));
}

type Op = IROperation;

/** The operations of `region`, without its yield. */
const body = (region: IRRegion): Op[] =>
  region.operations.filter((op) => op.kind !== 'yield');

/** Every operation of `region` and of the regions nested in it, in order. */
function allOps(region: IRRegion): Op[] {
  const result: Op[] = [];
  for (const op of region.operations) {
    result.push(op);
    if (op.kind === 'if') result.push(...allOps(op.then), ...allOps(op.else));
    if (op.kind === 'and' || op.kind === 'or')
      for (const r of op.rest) result.push(...allOps(r));
  }
  return result;
}

const definedBy = (region: IRRegion, value: IRValue) =>
  allOps(region).find((op) => op.result?.id === value.id);

/** The input name that `value` reads, when an `input` operation defines it. */
const inputName = (program: IRProgram, region: IRRegion, value: IRValue) => {
  const op = definedBy(region, value);
  return op?.kind === 'input' ? program.inputs[op.input].name : undefined;
};

describe('the fixtures lower and verify', () => {
  test('heatcell: the local, the helper call and the If', () => {
    const ce = heatEngine();
    const program = lower(ce.expr(HEATCELL));
    expect(program.inputs.map((i) => `${i.name}:${i.type}`)).toEqual([
      'v:real', 's:real', 'd:real', 'c:integer', 'r:integer', 'obstacle:real',
    ]);
    const root = body(program.root);
    // The local `a`: one `min` operation, at the declaration, before the If.
    const mins = allOps(program.root).filter((op) => op.kind === 'min');
    expect(mins).toHaveLength(1);
    const local = mins[0].result!;
    // The call of the helper: its arguments in order, then the If.
    const call = root.find((op) => op.kind === 'call')!;
    expect(call.operands.map((v) => inputName(program, program.root, v))).toEqual([
      'c', 'r', 'obstacle',
    ]);
    const conditional = root[root.length - 1];
    expect(conditional.kind).toBe('if');
    if (conditional.kind !== 'if') return;
    expect(conditional.operands[0].id).toBe(call.result!.id);
    expect(root.indexOf(mins[0])).toBeLessThan(root.indexOf(call));
    // The then region reads `v` and nothing else.
    expect(body(conditional.then).map((op) => op.kind)).toEqual(['input']);
    // The else region reads the local as the value of its initializer.
    const product = body(conditional.else).find(
      (op) => op.kind === 'multiply' && op.operands[0].id === local.id
    );
    expect(product).toBeDefined();
    // The helper: one function, with three parameters.
    expect(program.functions).toHaveLength(1);
    const helper = program.functions[0];
    expect(helper.name).toBe('heatwall');
    expect(helper.parameters.map((p) => p.type)).toEqual(['integer', 'integer', 'real']);
    expect(helper.result).toEqual({ type: 'boolean', representation: 'boolean' });
    expect(program.functions[(call as { function: number }).function]).toBe(helper);
  });

  test('heatwall: each operand of And and Or after the first is its own region', () => {
    const ce = heatEngine();
    const program = lower(ce.expr(HEATCELL));
    const helperBody = body(program.functions[0].body);
    const and = helperBody[helperBody.length - 1];
    expect(and.kind).toBe('and');
    if (and.kind !== 'and') return;
    // The first operand, `0.5 < obstacle`, is evaluated before the And.
    expect(definedBy(program.functions[0].body, and.operands[0])?.kind).toBe('less');
    expect(helperBody.map((op) => op.kind)).toEqual(['literal', 'less', 'and']);
    expect(and.rest).toHaveLength(2);
    expect(body(and.rest[0]).map((op) => op.kind)).toEqual(['literal', 'equal']);
    const or = body(and.rest[1]).find((op) => op.kind === 'or');
    expect(or).toBeDefined();
    if (or?.kind !== 'or') return;
    expect(or.rest).toHaveLength(1);
    expect(body(or.rest[0]).map((op) => op.kind)).toEqual(['literal', 'less']);
    // `18 < r` is only in the region of the Or.
    expect(body(and.rest[1]).filter((op) => op.kind === 'less')).toHaveLength(1);
  });

  test('heatwall as an expression root', () => {
    const ce = scalarEngine();
    const program = lower(ce.expr(HEATWALL_BODY));
    expect(program.inputs.map((i) => i.name)).toEqual(['obstacle', 'c', 'r']);
    const ops = body(program.root);
    expect(ops.map((op) => op.kind)).toEqual(['literal', 'input', 'less', 'and']);
    const and = ops[3];
    if (and.kind !== 'and') throw new Error('expected and');
    // The read of `c` is in the region of the second operand, not before
    // the And.
    expect(allOps(and.rest[0]).some((op) => op.kind === 'input')).toBe(true);
  });

  test('If(C, x, z) + y: each conversion is where its operand is evaluated', () => {
    const ce = scalarEngine();
    const program = lower(ce.expr(['Add', ['If', 'C', 'x', 'z'], 'y']));
    const ops = body(program.root);
    const conditional = ops.find((op) => op.kind === 'if');
    if (conditional?.kind !== 'if') throw new Error('expected if');
    // The conversion of `x` is in the then region, not in the root region.
    const thenOps = body(conditional.then);
    expect(thenOps.map((op) => op.kind)).toEqual(['input', 'convert']);
    expect(program.inputs[(thenOps[0] as { input: number }).input].name).toBe('x');
    expect(body(conditional.else).map((op) => op.kind)).toEqual(['input']);
    // `y` is not converted: a real operand of a complex sum adds to the
    // real part only, as the existing emitter writes it.
    const conversions = ops.filter((op) => op.kind === 'convert');
    expect(conversions).toHaveLength(0);
    const sum = ops[ops.length - 1];
    expect(sum.kind).toBe('add');
    expect(sum.result!.representation).toBe('complex');
    // The canonical form puts `y` first.
    expect(sum.operands.map((v) => v.representation)).toEqual(['number', 'complex']);
    expect(inputName(program, program.root, sum.operands[0])).toBe('y');
  });

  test('a local read twice is one value', () => {
    const ce = new ComputeEngine();
    const program = lower(
      ce.expr([
        'Function',
        ['Block', ['Declare', 't', "'real'", ['Max', 0, 'd']], ['Add', 't', ['Multiply', 't', 'v']]],
        typed('d', 'real'),
        typed('v', 'real'),
      ])
    );
    const ops = allOps(program.root);
    const max = ops.filter((op) => op.kind === 'max');
    expect(max).toHaveLength(1);
    const reads = ops.filter((op) =>
      op.operands.some((v) => v.id === max[0].result!.id)
    );
    expect(reads.map((op) => op.kind).sort()).toEqual(['add', 'multiply']);
  });
});

test('the lowering reads no type, value or definition of the engine', () => {
  const ce = heatEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('z', 'complex');
  ce.declare('C', 'boolean');
  const preparations: StructuredPreparation[] = [
    structured().prepareStructured(ce.expr(HEATCELL), OPTIONS),
    structured().prepareStructured(ce.expr(['Add', ['If', 'C', 'x', 'z'], 'y']), OPTIONS),
    // The forms of `Power` and `Abs` that the rules record: the lowering
    // reads the record, not the symbol `ExponentialE` or a sign fact.
    structured().prepareStructured(
      ce.expr([
        'Add',
        ['Exp', 'x'],
        ['Power', 'y', 2],
        ['Power', ['Max', 0, 'x'], 1.5],
        ['Abs', 'y'],
        ['Abs', ['Max', 0, 'y']],
      ]),
      OPTIONS
    ),
  ];
  const forbid = (object: object, name: string) =>
    jest.spyOn(object as never, name as never).mockImplementation((() => {
      throw new Error(`${name} called during the lowering`);
    }) as never);
  const samples = [ce.expr(['Add', 'x', 1]), ce.expr('x'), ce.expr(2)];
  forbid(core, 'isComplexValued');
  forbid(core, 'staticTypeOf');
  forbid(core, 'compile');
  forbid(ce, 'lookupDefinition');
  for (const sample of samples)
    for (const name of ['evaluate', 'N']) forbid(Object.getPrototypeOf(sample), name);
  // The scope chain and the definition of a symbol, which a test of a
  // shadowed library name reads (`isShadowedSymbol()`).
  const forbidGetter = (object: object, name: string) =>
    (jest.spyOn(object as never, name as never, 'get' as never) as jest.SpyInstance).mockImplementation((() => {
      throw new Error(`${name} read during the lowering`);
    }) as never);
  forbidGetter(ce, 'contextStack');
  for (const sample of samples)
    for (const name of ['valueDefinition', 'isNonNegative'])
      if (name in sample) forbidGetter(Object.getPrototypeOf(sample), name);
  try {
    for (const preparation of preparations)
      expect(() => lowerStructuredFragment(preparation)).not.toThrow();
  } finally {
    jest.restoreAllMocks();
  }
  // Control: the spies are the functions that the engine calls.
  forbid(core, 'isComplexValued');
  expect(() => core.isComplexValued(ce.expr('x'))).toThrow(/during the lowering/);
  const e = ce.expr('ExponentialE');
  forbidGetter(ce, 'contextStack');
  forbidGetter(Object.getPrototypeOf(e), 'valueDefinition');
  expect(() => isShadowedSymbol(e as never)).toThrow(/during the lowering/);
  jest.restoreAllMocks();
});

describe('effects', () => {
  function traceEngine() {
    const ce = scalarEngine();
    // `console` is an impurity label: the definition states an effect.
    ce.declare('Trace', {
      signature: '(real) -> real',
      effects: ['console'],
      evaluate: (ops) => ops[0],
    } as never);
    // `pure: false` states no effect set: the effects are unknown.
    ce.declare('Mystery', {
      signature: '(real) -> real',
      pure: false,
      evaluate: (ops) => ops[0],
    } as never);
    ce.declare('Trusted', {
      signature: '(real) -> real',
      pure: true,
      evaluate: (ops) => ops[0],
    } as never);
    return ce;
  }
  const TESTS = new Map([
    ['Trace', 'trace'],
    ['Mystery', 'mystery'],
    ['Trusted', 'trusted'],
  ]);

  test('two occurrences of one node stay two operations, in order', () => {
    const ce = traceEngine();
    const trace = ce.expr(['Trace', 'x']);
    // A made program: one boxed node at two operand positions.
    const sum = (ce as unknown as { _fn(h: string, ops: Expression[]): Expression })._fn(
      'Add',
      [trace, trace]
    );
    expect(sum.ops[0]).toBe(sum.ops[1]);
    const program = lower(sum, TESTS);
    const ops = body(program.root);
    expect(ops.map((op) => op.kind)).toEqual(['input', 'trace', 'input', 'trace', 'add']);
    const [, first, , second, add] = ops;
    expect(first.result!.id).not.toBe(second.result!.id);
    expect(first.effect).toBe('effectful');
    expect(second.effect).toBe('effectful');
    // The sum of two evaluated values is pure; both producers stay.
    expect(add.effect).toBe('pure');
    expect(add.operands.map((v) => v.id)).toEqual([first.result!.id, second.result!.id]);
    expect(program.root.effect).toBe('effectful');
  });

  test('an operation of an untaken branch is in its region, not in the parent', () => {
    const ce = traceEngine();
    const program = lower(ce.expr(['If', 'C', ['Trace', 'x'], 'y']), TESTS);
    const ops = body(program.root);
    expect(ops.some((op) => op.kind === 'trace')).toBe(false);
    const conditional = ops.find((op) => op.kind === 'if');
    if (conditional?.kind !== 'if') throw new Error('expected if');
    expect(body(conditional.then).map((op) => op.kind)).toEqual(['input', 'trace']);
    expect(conditional.then.effect).toBe('effectful');
    expect(conditional.else.effect).toBe('pure');
    expect(conditional.effect).toBe('effectful');
    expect(program.root.effect).toBe('effectful');
  });

  test('two occurrences of a head with unknown effects stay two operations, in order', () => {
    const ce = traceEngine();
    const mystery = ce.expr(['Mystery', 'x']);
    const sum = (ce as unknown as { _fn(h: string, ops: Expression[]): Expression })._fn(
      'Add',
      [mystery, mystery]
    );
    const ops = body(lower(sum, TESTS).root);
    expect(ops.map((op) => op.kind)).toEqual(['input', 'trace', 'input', 'trace', 'add']);
    expect(ops[1].result!.id).not.toBe(ops[3].result!.id);
    expect([ops[1].effect, ops[3].effect]).toEqual(['unknown', 'unknown']);
    expect(ops[4].operands.map((v) => v.id)).toEqual([ops[1].result!.id, ops[3].result!.id]);
  });

  test('a head with unknown effects in an untaken branch is in its region only', () => {
    const ce = traceEngine();
    const program = lower(ce.expr(['If', 'C', 'y', ['Mystery', 'x']]), TESTS);
    const ops = body(program.root);
    expect(ops.some((op) => op.kind === 'trace')).toBe(false);
    const conditional = ops.find((op) => op.kind === 'if');
    if (conditional?.kind !== 'if') throw new Error('expected if');
    expect(body(conditional.else).map((op) => op.kind)).toEqual(['input', 'trace']);
    expect(conditional.then.effect).toBe('pure');
    expect(conditional.else.effect).toBe('unknown');
    expect(conditional.effect).toBe('unknown');
  });

  test('the effect fact comes from the declaration', () => {
    const ce = traceEngine();
    const effectOf = (head: string): EffectFact => {
      const program = lower(ce.expr([head, 'x']), TESTS);
      return body(program.root).find((op) => op.kind === 'trace')!.effect;
    };
    expect(effectOf('Trace')).toBe('effectful');
    expect(effectOf('Mystery')).toBe('unknown');
    expect(effectOf('Trusted')).toBe('pure');
  });
});

//
// The verifier
//

/** A small program, made by hand: `If(C, x, 1)`. */
function madeProgram() {
  const ce = scalarEngine();
  const origin = ce.expr('x');
  const owner = {};
  let next = 0;
  const value = (type: ScalarKind): IRValue => ({
    owner,
    revision: 1,
    id: next++,
    type,
    representation: type === 'real' || type === 'integer' ? 'number' : type,
  });
  const region = (operations: Op[], effect: EffectFact = 'pure'): IRRegion => ({
    operations,
    effect,
    ...touchesField(...operations.map((op) => op.touches)),
  });
  const yieldOf = (v: IRValue): Op => ({ kind: 'yield', operands: [v], effect: 'pure', origin });
  const condition = value('boolean');
  const x = value('real');
  const one = value('real');
  const result = value('real');
  const thenOps: Op[] = [
    { kind: 'input', input: 1, result: x, operands: [], effect: 'pure', origin },
    yieldOf(x),
  ];
  const elseOps: Op[] = [
    { kind: 'literal', value: 1, result: one, operands: [], effect: 'pure', origin },
    yieldOf(one),
  ];
  const rootOps: Op[] = [
    { kind: 'input', input: 0, result: condition, operands: [], effect: 'pure', origin },
    {
      kind: 'if',
      results: [result],
      operands: [condition],
      then: region(thenOps),
      else: region(elseOps),
      effect: 'pure',
      origin,
    },
    yieldOf(result),
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
  const prepared: ReadonlySet<Expression> = new Set([origin]);
  return { program, prepared, rootOps, thenOps, elseOps, value, yieldOf, origin, x, one, result, condition, region };
}

/**
 * A made program with one function `f(p: real) -> real` whose body traces
 * `p` with the effect `effectful`, and whose root yields `f(x)`.
 */
function madeFunctionProgram() {
  const m = madeProgram();
  const p = m.value('real');
  const traced = m.value('real');
  const fnOps: Op[] = [
    { kind: 'trace', trace: 't', result: traced, operands: [p], effect: 'effectful', touches: ['console'], origin: m.origin },
    m.yieldOf(traced),
  ];
  const fn = {
    name: 'f',
    parameters: [p],
    result: { type: 'real' as ScalarKind, representation: 'number' as const },
    body: m.region(fnOps, 'effectful'),
    origin: m.origin,
  };
  const x = m.value('real');
  const called = m.value('real');
  const call = {
    kind: 'call' as const,
    function: 0,
    result: called,
    operands: [x],
    effect: 'effectful' as EffectFact,
    touches: ['console'],
    origin: m.origin,
  };
  const rootOps: Op[] = [
    { kind: 'input', input: 1, result: x, operands: [], effect: 'pure', origin: m.origin },
    call,
    m.yieldOf(called),
  ];
  const program: IRProgram = {
    ...m.program,
    functions: [fn],
    root: m.region(rootOps, 'effectful'),
  };
  return { ...m, program, fn, fnOps, rootOps, call, p };
}

describe('the verifier', () => {
  test('control: the made programs verify', () => {
    const m = madeProgram();
    expect(() => verifyProgram(m.program, m.prepared)).not.toThrow();
    const f = madeFunctionProgram();
    expect(() => verifyProgram(f.program, f.prepared)).not.toThrow();
  });

  test('an origin that is not a prepared node', () => {
    const m = madeProgram();
    expect(() => verifyProgram(m.program, new Set())).toThrow(
      /origin of the operation .* is not a prepared node/
    );
  });

  test('a function whose body yields a value of another type than its result', () => {
    // No call reads the function: the root of `madeProgram()` is kept.
    const m = madeProgram();
    const p = m.value('real');
    const flag = m.value('boolean');
    const program: IRProgram = {
      ...m.program,
      functions: [
        {
          name: 'g',
          parameters: [p],
          result: { type: 'real', representation: 'number' },
          body: m.region([
            { kind: 'literal', value: true, result: flag, operands: [], effect: 'pure', origin: m.origin },
            m.yieldOf(flag),
          ]),
          origin: m.origin,
        },
      ],
    };
    expect(() => verifyProgram(program, m.prepared)).toThrow(
      /the body of g yields a boolean value, and its result is a real/
    );
  });

  test('a function result whose representation is not the one of its type', () => {
    const f = madeFunctionProgram();
    const program = {
      ...f.program,
      functions: [{ ...f.fn, result: { type: 'real' as ScalarKind, representation: 'complex' as const } }],
    };
    expect(() => verifyProgram(program, f.prepared)).toThrow(
      /the result of f has the type real and the representation complex/
    );
  });

  test('an if whose result type is not the type of its regions', () => {
    const m = madeProgram();
    // `If(C, x, 1)` is real; declare it integer.
    const integer = { ...m.result, type: 'integer' as ScalarKind };
    m.rootOps[1] = { ...(m.rootOps[1] as Extract<Op, { kind: 'if' }>), results: [integer] };
    m.rootOps[2] = m.yieldOf(integer);
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(
      /the result of an if has the type integer, and its regions the types real and real/
    );
  });

  test('an integer result of an arithmetic operation on a real operand', () => {
    const m = madeProgram();
    const negated = m.value('integer');
    m.thenOps.splice(1, 1,
      { kind: 'negate', result: negated, operands: [m.x], effect: 'pure', origin: m.origin },
      m.yieldOf(m.x)
    );
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(
      /the operation negate has an integer result and an operand that is not an integer/
    );
  });

  test('a real argument of an integer parameter', () => {
    const f = madeFunctionProgram();
    const p = { ...f.p, type: 'integer' as ScalarKind };
    const fnOps = [{ ...f.fnOps[0], operands: [p] } as Op, f.fnOps[1]];
    const program = {
      ...f.program,
      functions: [{ ...f.fn, parameters: [p], body: f.region(fnOps, 'effectful') }],
    };
    expect(() => verifyProgram(program, f.prepared)).toThrow(
      /the argument 1 of a call of f has the type real, and its parameter the type integer/
    );
  });

  test('a trace operation with a boolean operand', () => {
    const m = madeProgram();
    m.rootOps.splice(1, 0, {
      kind: 'trace',
      trace: 't',
      result: m.value('real'),
      operands: [m.condition],
      effect: 'effectful',
      touches: ['console'],
      origin: m.origin,
    });
    const program = { ...m.program, root: m.region(m.rootOps, 'effectful') };
    expect(() => verifyProgram(program, m.prepared)).toThrow(
      /an operand of the operation trace has the representation boolean/
    );
  });

  test('an if whose effect is weaker than its region', () => {
    const m = madeProgram();
    m.thenOps.splice(1, 0, {
      kind: 'trace', trace: 't', result: m.value('real'), operands: [m.x], effect: 'effectful', touches: ['console'], origin: m.origin,
    });
    const conditional = m.rootOps[1] as Extract<Op, { kind: 'if' }>;
    m.rootOps[1] = { ...conditional, then: m.region(m.thenOps, 'effectful') };
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(
      /the effect of the operation if \(pure\) omits the effect of its region \(effectful\)/
    );
  });

  /** `And(C, <rest>)` at the root, with the rest region `restOps`. */
  function madeAnd(m: ReturnType<typeof madeProgram>, restOps: Op[], restEffect: EffectFact, andEffect: EffectFact) {
    const first = m.value('boolean');
    const result = m.value('boolean');
    const ops: Op[] = [
      { kind: 'input', input: 0, result: first, operands: [], effect: 'pure', origin: m.origin },
      { kind: 'and', result, operands: [first], rest: [m.region(restOps, restEffect)], effect: andEffect, origin: m.origin },
      m.yieldOf(result),
    ];
    return { ops, result };
  }

  test('an and whose effect is weaker than its region', () => {
    const m = madeProgram();
    const second = m.value('boolean');
    const x = m.value('real');
    const restOps: Op[] = [
      { kind: 'input', input: 1, result: x, operands: [], effect: 'pure', origin: m.origin },
      { kind: 'trace', trace: 't', result: m.value('real'), operands: [x], effect: 'effectful', touches: ['console'], origin: m.origin },
      { kind: 'input', input: 0, result: second, operands: [], effect: 'pure', origin: m.origin },
      m.yieldOf(second),
    ];
    const { ops } = madeAnd(m, restOps, 'effectful', 'pure');
    const program = { ...m.program, root: m.region(ops, 'pure') };
    expect(() => verifyProgram(program, m.prepared)).toThrow(
      /the effect of the operation and \(pure\) omits the effect of its region \(effectful\)/
    );
  });

  test('a value of the rest region of an or used after the or', () => {
    const m = madeProgram();
    const second = m.value('boolean');
    const restOps: Op[] = [
      { kind: 'input', input: 0, result: second, operands: [], effect: 'pure', origin: m.origin },
      m.yieldOf(second),
    ];
    const { ops } = madeAnd(m, restOps, 'pure', 'pure');
    ops[1] = { ...(ops[1] as Extract<Op, { kind: 'and' }>), kind: 'or' };
    ops[2] = m.yieldOf(second);
    const program = { ...m.program, root: m.region(ops, 'pure') };
    expect(() => verifyProgram(program, m.prepared)).toThrow(
      /the value \d+ is used outside the region of its definition/
    );
  });

  test('a call whose effect is weaker than the body of its function', () => {
    const f = madeFunctionProgram();
    f.rootOps[1] = { ...f.call, effect: 'pure' };
    const program = { ...f.program, root: f.region(f.rootOps, 'pure') };
    expect(() => verifyProgram(program, f.prepared)).toThrow(
      /the effect of a call of f \(pure\) omits the effect of its body \(effectful\)/
    );
  });

  test('a function body that reads an input of the program', () => {
    const f = madeFunctionProgram();
    const read = f.value('real');
    const fnOps: Op[] = [
      { kind: 'input', input: 1, result: read, operands: [], effect: 'pure', origin: f.origin },
      f.yieldOf(read),
    ];
    const program: IRProgram = {
      ...f.program,
      functions: [{ ...f.fn, body: f.region(fnOps, 'pure') }],
    };
    expect(() => verifyProgram(program, f.prepared)).toThrow(
      /the body of a function reads the input 1/
    );
  });

  test('a function parameter used in the root region', () => {
    const f = madeFunctionProgram();
    f.rootOps[2] = f.yieldOf(f.p);
    expect(() => verifyProgram(f.program, f.prepared)).toThrow(
      /the value \d+ is used outside the region of its definition/
    );
  });

  test('a value of another program', () => {
    const m = madeProgram();
    m.rootOps[2] = m.yieldOf({ ...m.result, owner: {} });
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(/belongs to another program/);
  });

  test('a use outside the region of its definition', () => {
    const m = madeProgram();
    // `x` is defined in the then region; the root yields it.
    m.rootOps[2] = m.yieldOf(m.x);
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(
      /used outside the region of its definition/
    );
  });

  test('a use before the definition', () => {
    const m = madeProgram();
    const late = m.value('real');
    m.rootOps.splice(0, 0, {
      kind: 'negate',
      result: m.value('real'),
      operands: [late],
      effect: 'pure',
      origin: m.origin,
    });
    m.rootOps.splice(2, 0, {
      kind: 'literal',
      value: 2,
      result: late,
      operands: [],
      effect: 'pure',
      origin: m.origin,
    });
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(/used before its definition/);
  });

  test('an invalid conversion', () => {
    const m = madeProgram();
    m.rootOps.splice(1, 0, {
      kind: 'convert',
      conversion: 'real-to-complex',
      result: m.value('complex'),
      operands: [m.condition],
      effect: 'pure',
      origin: m.origin,
    });
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(/invalid conversion/);
  });

  test('If results of different representations', () => {
    const m = madeProgram();
    const complex = m.value('complex');
    m.elseOps.splice(0, 2,
      { kind: 'literal', value: { re: 1, im: 1 }, result: complex, operands: [], effect: 'pure', origin: m.origin },
      m.yieldOf(complex)
    );
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(
      /two results of an if have different representations/
    );
  });

  // Complex arithmetic (docs/plans/2026-11-10-structured-complex-arithmetic.md,
  // "Each part").
  /** `madeProgram()` with the operations of `make` in its then branch,
   *  after the read of `x` and a complex literal `c`, before its yield. */
  function madeComplex(make: (m: ReturnType<typeof madeProgram>, c: IRValue) => Op[]) {
    const m = madeProgram();
    const c = m.value('complex');
    m.thenOps.splice(
      1,
      0,
      { kind: 'literal', value: { re: 1, im: 2 }, result: c, operands: [], effect: 'pure', origin: m.origin },
      ...make(m, c)
    );
    return m;
  }

  test('control: a mixed product and quotient, and complex(x, x)', () => {
    const m = madeComplex((m, c) => [
      { kind: 'multiply', result: m.value('complex'), operands: [m.x, c], effect: 'pure', origin: m.origin },
      { kind: 'multiply', result: m.value('complex'), operands: [c, c], effect: 'pure', origin: m.origin },
      { kind: 'divide', result: m.value('complex'), operands: [m.x, c], effect: 'pure', origin: m.origin },
      { kind: 'divide', result: m.value('complex'), operands: [c, m.x], effect: 'pure', origin: m.origin },
      { kind: 'binary', fn: 'complex', result: m.value('complex'), operands: [m.x, m.x], effect: 'pure', origin: m.origin },
    ]);
    expect(() => verifyProgram(m.program, m.prepared)).not.toThrow();
  });

  test('a complex multiply of three operands', () => {
    const m = madeComplex((m, c) => [
      { kind: 'multiply', result: m.value('complex'), operands: [m.x, c, c], effect: 'pure', origin: m.origin },
    ]);
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(
      /a complex multiply has 3 operands, not two/
    );
  });

  test('a real multiply with a complex operand', () => {
    const m = madeComplex((m, c) => [
      { kind: 'multiply', result: m.value('real'), operands: [m.x, c], effect: 'pure', origin: m.origin },
    ]);
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(
      /the operation multiply has a result of the type real and a complex operand/
    );
  });

  // The rule of the core, under a policy that admits any representation of
  // the operands of the functions: the JavaScript policy refuses these
  // operands by their representation first.
  const anyOperands: RepresentationPolicy = {
    ...JAVASCRIPT_POLICY,
    functions: Object.fromEntries(
      Object.keys(JAVASCRIPT_POLICY.functions).map((fn) => [
        fn,
        { results: ['number', 'complex'], operands: ['number', 'complex'] },
      ])
    ),
  };

  test('complex of a complex operand', () => {
    const m = madeComplex((m, c) => [
      { kind: 'binary', fn: 'complex', result: m.value('complex'), operands: [c, m.x], effect: 'pure', origin: m.origin },
    ]);
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(
      /an operand of the operation binary has the representation complex/
    );
    expect(() => verifyCore(m.program, m.prepared, anyOperands)).toThrow(
      /the function complex of complex, real has a result of the type complex/
    );
  });

  test('a pow of complex operands, and a pow with one complex operand', () => {
    const control = madeComplex((m, c) => [
      { kind: 'binary', fn: 'pow', result: m.value('complex'), operands: [c, c], effect: 'pure', origin: m.origin },
    ]);
    expect(() => verifyProgram(control.program, control.prepared)).not.toThrow();
    const m = madeComplex((m, c) => [
      { kind: 'binary', fn: 'pow', result: m.value('complex'), operands: [c, m.x], effect: 'pure', origin: m.origin },
    ]);
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(
      /an operand of the operation binary has the representation number/
    );
    expect(() => verifyCore(m.program, m.prepared, anyOperands)).toThrow(
      /the function pow of complex, real has a result of the type complex/
    );
  });

  test('a complex divide with no complex operand', () => {
    const m = madeComplex((m) => [
      { kind: 'divide', result: m.value('complex'), operands: [m.x, m.x], effect: 'pure', origin: m.origin },
    ]);
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(
      /the operation divide has a result of the type complex and no complex operand/
    );
  });

  test('a region with no yield', () => {
    const m = madeProgram();
    m.thenOps.pop();
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(/a region has no yield/);
  });

  test('a region with two yields', () => {
    const m = madeProgram();
    m.thenOps.push(m.yieldOf(m.x));
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(/a region has 2 yields/);
  });

  test('a missing effect fact', () => {
    const m = madeProgram();
    m.thenOps[0] = { ...m.thenOps[0], effect: undefined as never };
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(/has no effect fact/);
  });

  test('a region summary that omits an effectful operation', () => {
    const m = madeProgram();
    const traced = m.value('real');
    m.elseOps.splice(1, 0, {
      kind: 'trace',
      trace: 't',
      result: traced,
      operands: [m.one],
      effect: 'effectful',
      touches: ['console'],
      origin: m.origin,
    });
    // The else region still says `pure`.
    expect(() => verifyProgram(m.program, m.prepared)).toThrow(
      /effect of a region \(pure\) does not agree with its operations \(effectful\)/
    );
  });
});

//
// Admission
//

describe('admission of the structured route', () => {
  const refusals: [string, () => Expression, RegExp][] = [
    // The engine types these `true` and `false` (`booleanClaim()`).
    ['Less with no free symbol', () => scalarEngine().expr(['Less', 1, 2]), /1 < 2 has the type true/],
    ['Equal with no free symbol', () => scalarEngine().expr(['Equal', 1, 2]), /1 == 2 has the type false/],
    ['Less chain with a complex operand', () => scalarEngine().expr(['Less', 'x', 'z', 1]), /Less with a complex operand/],
    ['Less with a complex operand', () => scalarEngine().expr(['Less', 'z', 'x']), /Less with a complex operand/],
    ['Equal with a complex operand', () => scalarEngine().expr(['Equal', 'z', 'x']), /Equal with a complex operand/],
    ['Less with a boolean operand', () => scalarEngine().expr(['Less', 'C', 'x']), /Less with a boolean operand/],
    ['Max with a complex operand', () => scalarEngine().expr(['Max', 'z', 'x']), /Max with a complex operand/],
    ['Min with a complex operand', () => scalarEngine().expr(['Min', 'x', 'z']), /Min with a complex operand/],
    ['Min with a boolean operand', () => scalarEngine().expr(['Min', 'x', 'C']), /Min with a boolean operand/],
    ['Max with a boolean operand', () => scalarEngine().expr(['Max', 'C', 'x']), /Max with a boolean operand/],
    // The canonical form refuses `And(C, x)` (an incompatible-type error), so
    // the witness is a made node.
    ['And with a real operand', () => made('And'), /And with an operand that is not a boolean/],
    ['Or with a real operand', () => made('Or'), /Or with an operand that is not a boolean/],
    ['Multiply of a boolean and a complex operand', () => made('Multiply', ['C', 'z']), /a product with a boolean operand/],
    ['Divide of a boolean and a complex operand', () => made('Divide', ['C', 'z']), /Divide with a boolean operand/],
    // The canonical form keeps `Min(x)`, `And(C)` and `Or(C)`, and writes
    // `Multiply(x)` as `x`: the unary product is a made node.
    ['Min of one operand', () => scalarEngine().expr(['Min', 'x']), /Min of one operand of the type `real` is not in the structured route, which folds a list or a tuple/],
    ['And of one operand', () => scalarEngine().expr(['And', 'C']), /And of fewer than two operands/],
    ['Or of one operand', () => scalarEngine().expr(['Or', 'C']), /Or of fewer than two operands/],
    ['Multiply of one operand', () => made('Multiply', ['x']), /a product of fewer than two operands/],
  ];
  function made(head: string, operands = ['C', 'x']): Expression {
    const ce = scalarEngine();
    return (ce as unknown as { _fn(h: string, ops: Expression[]): Expression })._fn(
      head,
      operands.map((o) => ce.expr(o))
    );
  }
  test.each(refusals)('%s', (_name, make, reason) => {
    const expr = make();
    expect(expr.isValid).toBe(true);
    expect(() => structured().prepareStructured(expr, OPTIONS)).toThrow(reason);
  });

  test('cse and constantFold must be false', () => {
    const expr = scalarEngine().expr(['Add', 'x', 'y']);
    expect(() => structured().prepareStructured(expr, { constantFold: false })).toThrow(
      /requires cse: false/
    );
    expect(() => structured().prepareStructured(expr, { cse: false })).toThrow(
      /requires constantFold: false/
    );
    expect(() =>
      structured().prepareStructured(expr, { cse: true, constantFold: false })
    ).toThrow(/requires cse: false/);
  });

  // A write makes a new value: compile-javascript-structured-locals.test.ts.
  test('a local written twice is two values', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'Function',
      ['Block', ['Declare', 't', "'real'", 'w'], ['Assign', 't', ['Add', 't', 1]], 't'],
      typed('w', 'real'),
    ]);
    const program = lowerStructuredFragment(structured().prepareStructured(expr, OPTIONS));
    const [read, one, sum, yields] = program.root.operations;
    expect([read.kind, one.kind, sum.kind, yields.kind]).toEqual(['input', 'literal', 'add', 'yield']);
    expect(yields.operands[0].id).toBe(sum.result!.id);
  });

  test('the structured route compiles', () => {
    const expr = scalarEngine().expr(['Add', 'x', 'y']);
    expect(structured().compile(expr, OPTIONS).run!({ x: 1, y: 2 })).toBe(3);
  });

  test('the existing route still refuses the new operators', () => {
    const ce = scalarEngine();
    const target = new ScalarFragmentJavaScriptTarget();
    for (const head of ['Multiply', 'Min', 'Max', 'Less'])
      expect(() =>
        target.compile(ce.expr([head, 'x', 'y']), { fallback: false })
      ).toThrow(new RegExp(`unsupported head ${head}`));
    expect(() =>
      target.compile(heatEngine().expr(HEATCELL), { fallback: false })
    ).toThrow(/unsupported head Min/);
  });
});

// Slice 1 of docs/plans/2026-11-11-structured-collections-and-lambdas.md:
// the operations `list`, `tuple` and `get`, and a list operand of an
// arithmetic operation.
describe('the verifier: lists and tuples', () => {
  const structured = () => new ScalarFragmentJavaScriptTarget('structured');
  const fn = (
    body: MathJsonExpression,
    ...parameters: [string, string][]
  ): MathJsonExpression =>
    [
      'Function',
      ['Block', body],
      ...parameters.map(([n, t]) => typed(n, t)),
    ] as MathJsonExpression;
  const X: [string, string] = ['x', 'real'];
  const P: [string, string] = ['P', 'tuple<real, real>'];
  const prepare = (json: MathJsonExpression) =>
    structured().prepareStructured(new ComputeEngine().expr(json), OPTIONS);
  /** The program of `json` with the first operation of the kind `kind` of
   *  the root replaced by `change(op)`. */
  function changed(
    json: MathJsonExpression,
    kind: IROperation['kind'],
    change: (op: IROperation) => IROperation
  ): () => void {
    const preparation = prepare(json);
    const program = lowerStructuredFragment(preparation);
    const index = program.root.operations.findIndex((op) => op.kind === kind);
    expect(index).toBeGreaterThanOrEqual(0);
    const operations = [...program.root.operations];
    operations[index] = change(operations[index]);
    const root = { ...program.root, operations };
    return () => verifyProgram({ ...program, root }, preparedNodesOf(preparation));
  }

  test('a list whose element is a real and whose type is a list of integers', () => {
    expect(
      changed(fn(['List', 'x', 1], X), 'list', (op) => ({
        ...op,
        result: { ...op.result!, type: listType('integer') },
      }) as IROperation)
    ).toThrow(/the element 1 of the operation list has the type real, and its result the type list<integer>/);
  });

  test('a tuple of a length other than its type', () => {
    expect(
      changed(fn(['Tuple', 'x', 1], X), 'tuple', (op) => ({
        ...op,
        result: { ...op.result!, type: tupleType(['real', 'real', 'real']) },
      }) as IROperation)
    ).toThrow(/the operation tuple has 2 operands, not 3/);
  });

  test('a get of a position out of range', () => {
    expect(
      changed(fn(['Sum', 'P'], P), 'get', (op) => ({ ...op, position: 3 }) as IROperation)
    ).toThrow(/the operation get reads the position 3 of a tuple<real, real>/);
  });

  test('an arithmetic operation of a list operand', () => {
    expect(
      changed(fn(['Add', ['At', ['List', 'x', 1], 1], 1], X), 'list', (op) => ({
        ...op,
        kind: 'add',
      }) as IROperation)
    ).toThrow(/the operation add has a list operand or a list result/);
  });

  // Slice 2: the functions of lists (`collection`).
  const L: [string, string] = ['L', 'list<real>'];
  const N: [string, string] = ['n', 'integer'];
  test.each([
    [
      'a norm with a list result',
      fn(['Norm', 'L'], L),
      (op: IROperation) => ({ ...op, result: { ...op.result!, type: listType('real'), representation: 'array' } }),
      /the function of lists norm has a result of the type list<real>, not real/,
    ],
    [
      'a take of a real count',
      fn(['Take', 'L', 'n'], L, N),
      (op: IROperation) => ({ ...op, operands: [op.operands[0], { ...op.operands[1], type: 'real' }] }),
      /the count of the function of lists take has the type real|is used with another type/,
    ],
    [
      'a take whose result is a list of integers of a list of reals',
      fn(['Take', 'L', 'n'], L, N),
      (op: IROperation) => ({ ...op, result: { ...op.result!, type: listType('integer') } }),
      /the function of lists take has a result of the type list<integer>, not list<real>/,
    ],
    [
      'a dot of one operand',
      fn(['Dot', 'L', 'L'], L),
      (op: IROperation) => ({ ...op, operands: [op.operands[0]] }),
      /the function of lists dot has 1 operands/,
    ],
    [
      'a sort that is not pure',
      fn(['Sort', 'L'], L),
      (op: IROperation) => ({ ...op, effect: 'unknown' }),
      /the function of lists sort is not pure|does not agree with its operations/,
    ],
    [
      'an unknown function of lists',
      fn(['Reverse', 'L'], L),
      (op: IROperation) => ({ ...op, fn: 'cross' }),
      /the target has no function of lists cross/,
    ],
    [
      'a range with a real bound',
      fn(['Range', 1, 'n'], N),
      (op: IROperation) => ({ ...op, operands: [op.operands[0], { ...op.operands[1], type: 'real' }] }),
      /the bounds of the function of lists range are not integers|is used with another type/,
    ],
    [
      'a join of a tuple',
      fn(['Join', 'L', 'L'], L),
      (op: IROperation) => ({ ...op, operands: [op.operands[0], { ...op.operands[1], type: tupleType(['real', 'real']) }] }),
      /reads lists, not a tuple|is used with another type/,
    ],
    // Slices 4 and 5: a range with a step, the rotations, lists of tuples.
    [
      'a range with a real step whose result is a list of integers',
      fn(['Range', 1, 'n', 0.5], N),
      (op: IROperation) => ({ ...op, result: { ...op.result!, type: listType('integer') } }),
      /the function of lists range has a result of the type list<integer>, not list<real>/,
    ],
    [
      'a range of four operands',
      fn(['Range', 1, 'n', 2], N),
      (op: IROperation) => ({ ...op, operands: [...op.operands, op.operands[2]] }),
      /the function of lists range has 4 operands/,
    ],
    [
      'a rotation by a real shift',
      fn(['RotateLeft', 'L', 'n'], L, N),
      (op: IROperation) => ({ ...op, operands: [op.operands[0], { ...op.operands[1], type: 'real' }] }),
      /the count of the function of lists rotate-left has the type real|is used with another type/,
    ],
    [
      'a take of a list of booleans',
      fn(['Take', 'L', 'n'], L, N),
      (op: IROperation) => ({
        ...op,
        operands: [{ ...op.operands[0], type: listType('boolean') }, op.operands[1]],
        result: { ...op.result!, type: listType('boolean') },
      }),
      // The JavaScript policy holds no list of booleans, so the check of the
      // value can fire first; the rule of `take` refuses it too.
      /the operand 1 of the function of lists take has the type list<boolean>|is used with another type|has the type list<boolean>, which the target does not hold/,
    ],
    [
      'a take of a list of tuples whose result is a list of reals',
      fn(['Take', 'LP', 'n'], ['LP', 'list<tuple<real, real>>'], N),
      (op: IROperation) => ({ ...op, result: { ...op.result!, type: listType('real') } }),
      /the function of lists take has a result of the type list<real>, not list<tuple<real, real>>/,
    ],
    [
      'a join of lists of tuples of two sizes',
      fn(['ListJoin', 'LP', 'LP'], ['LP', 'list<tuple<real, real>>']),
      (op: IROperation) => ({
        ...op,
        operands: [op.operands[0], { ...op.operands[1], type: listType(tupleType(['real', 'real', 'real'])) }],
      }),
      /reads lists of other elements than tuple<real, real>|is used with another type/,
    ],
  ] as [string, MathJsonExpression, (op: IROperation) => IROperation, RegExp][])(
    '%s',
    (_name, json, change, message) => {
      expect(changed(json, 'collection', change)).toThrow(message);
    }
  );

  test('a list of tuples with a tuple of another size', () => {
    expect(
      changed(fn(['List', 'P', 'P'], P), 'list', (op) => ({
        ...op,
        result: { ...op.result!, type: listType(tupleType(['real', 'real', 'real'])) },
      }) as IROperation)
    ).toThrow(/the element 1 of the operation list has the type tuple<real, real>, and its result the type list<tuple<real, real, real>>/);
  });

  test('an element of a list of tuples read as a number', () => {
    expect(
      changed(fn(['At', ['At', 'LP', 'n'], 1], ['LP', 'list<tuple<real, real>>'], N), 'at', (op) => ({
        ...op,
        result: { ...op.result!, type: 'real', representation: 'number' },
      }) as IROperation)
    ).toThrow(/the operation at of a list<tuple<real, real>> has a result of the type real, not tuple<real, real>|is used with another type/);
  });

  // Slice 1 of docs/plans/2026-11-11-structured-nested-lists-and-matrices.md:
  // the element types of lists of lists are checked at every depth.
  const M: [string, string] = ['M', 'list<list<real>>'];
  const MI: [string, string] = ['MI', 'list<list<integer>>'];
  const R3: [string, string] = ['R3', 'list<list<list<real>>>'];
  test.each([
    [
      'a row read whose result is a number',
      fn(['Length', ['At', 'M', 'n']], M, N),
      'at',
      (op: IROperation) => ({ ...op, result: { ...op.result!, type: 'real', representation: 'number' } }),
      /the operation at of a list<list<real>> has a result of the type real, not list<real>|is used with another type/,
    ],
    [
      'a row read of rank 3 whose result has rank 1',
      fn(['Length', ['At', 'R3', 'n']], R3, N),
      'at',
      (op: IROperation) => ({ ...op, result: { ...op.result!, type: listType('real') } }),
      /the operation at of a list<list<list<real>>> has a result of the type list<real>, not list<list<real>>|is used with another type/,
    ],
    [
      'a row of reals typed as a list of rows',
      fn(['List', ['List', 'x'], ['List', 1]], X),
      'list',
      (op: IROperation) => ({ ...op, result: { ...op.result!, type: listType(listType('integer')) } }),
      /the element 1 of the operation list has the type real, and its result the type list<list<integer>>/,
    ],
    [
      'a list of lists of rows of reals typed as rows of integers (depth 3)',
      fn(['List', 'M', 'M'], M),
      'list',
      (op: IROperation) => ({ ...op, result: { ...op.result!, type: listType(listType(listType('integer'))) } }),
      /the element 1 of the operation list has the type list<list<real>>, and its result the type list<list<list<integer>>>/,
    ],
    [
      'a list of lists with a number element',
      fn(['List', 'M', 'M'], M),
      'list',
      (op: IROperation) => ({ ...op, operands: [op.operands[0], { ...op.operands[1], type: 'real', representation: 'number' }] }),
      /the element 2 of the operation list has the type real, and its result the type list<list<list<real>>>|is used with another type/,
    ],
    [
      'a list of lists of booleans at depth 3',
      fn(['List', ['List', ['List', 'x']]], X),
      'list',
      (op: IROperation) => ({ ...op, result: { ...op.result!, type: listType(listType(listType('boolean'))) } }),
      /the operation list of a|the element 1 of the operation list has the type list<list<real>>, and its result the type list<list<list<boolean>>>|which the target does not hold/,
    ],
    [
      'a replace-at of a row of reals into rows of integers with a result of rows of integers',
      fn(['ReplaceAt', 'MI', 'n', ['List', 'x']], MI, N, X),
      'replace-at',
      (op: IROperation) => ({ ...op, result: { ...op.result!, type: listType(listType('integer')) } }),
      /the operation replace-at writes a list<real> element into a list<list<integer>> and has a result of the type list<list<integer>>/,
    ],
    [
      'a replace-at of a number into rows',
      fn(['ReplaceAt', 'M', 'n', ['List', 'x']], M, N, X),
      'replace-at',
      (op: IROperation) => ({ ...op, operands: [op.operands[0], op.operands[1], { ...op.operands[2], type: 'real', representation: 'number' }] }),
      /the operation replace-at writes a real element into a list<list<real>>|is used with another type/,
    ],
  ] as [string, MathJsonExpression, IROperation['kind'], (op: IROperation) => IROperation, RegExp][])(
    'lists of lists: %s',
    (_name, json, kind, change, message) => {
      expect(changed(json, kind, change)).toThrow(message);
    }
  );

  test.each([
    [
      'a take of rows whose result is a list of reals',
      fn(['Take', 'M', 'n'], M, N),
      (op: IROperation) => ({ ...op, result: { ...op.result!, type: listType('real') } }),
      /the function of lists take has a result of the type list<real>, not list<list<real>>/,
    ],
    [
      'a join of rows and a list of numbers',
      fn(['Join', 'M', 'M'], M),
      (op: IROperation) => ({ ...op, operands: [op.operands[0], { ...op.operands[1], type: listType('real') }] }),
      /reads lists of other elements than list<real>|is used with another type/,
    ],
    [
      'a join of rows of rank 2 and of rank 3',
      fn(['Join', 'M', 'M'], M),
      (op: IROperation) => ({ ...op, operands: [op.operands[0], { ...op.operands[1], type: listType(listType(listType('real'))) }] }),
      /reads lists of other elements than list<real>|is used with another type/,
    ],
    [
      'a sort of rows',
      fn(['Reverse', 'M'], M),
      (op: IROperation) => ({ ...op, fn: 'sort' }),
      /the operand 1 of the function of lists sort has the type list<list<real>>/,
    ],
    [
      'a norm of rows',
      fn(['Reverse', 'M'], M),
      (op: IROperation) => ({ ...op, fn: 'norm', resultArray: undefined, result: { ...op.result!, type: 'real', representation: 'number' } }),
      /the operand 1 of the function of lists norm has the type list<list<real>>|is used with another type/,
    ],
  ] as [string, MathJsonExpression, (op: IROperation) => IROperation, RegExp][])(
    'lists of lists: %s',
    (_name, json, change, message) => {
      expect(changed(json, 'collection', change)).toThrow(message);
    }
  );

  test('lists of lists: an add of a row operand', () => {
    expect(
      changed(fn(['Length', ['At', 'M', 'n']], M, N), 'length', (op) => ({ ...op, kind: 'add' }) as IROperation)
    ).toThrow(/the operation add has a list operand or a list result|has 1 operands, fewer than 2/);
  });

  test('a target with no functions of lists refuses one', () => {
    const preparation = prepare(fn(['Mean', 'L'], L));
    const program = lowerStructuredFragment(preparation);
    const policy: RepresentationPolicy = { ...JAVASCRIPT_POLICY, collections: undefined };
    expect(() => verifyCore(program, preparedNodesOf(preparation), policy)).toThrow(
      /the target has no function of lists mean/
    );
  });

  // Slice 3: a function operand is lowered to a region of the existing
  // operations; no function value is in the program.
  test('Map of a lambda is a build whose body has the lambda inline', () => {
    const program = lowerStructuredFragment(
      prepare(fn(['Map', ['Function', ['Multiply', 't', 'x'], 't'], 'L'], L, X))
    );
    const build = program.root.operations.find((op) => op.kind === 'build');
    expect(build).toBeDefined();
    const kinds = build!.kind === 'build' ? build!.body.operations.map((op) => op.kind) : [];
    expect(kinds).toEqual(['at', 'input', 'multiply', 'yield']);
    expect(program.functions).toEqual([]);
  });
});

//
// The policy `JS-bigint` of the compile mode `bigint`
//

describe('the verifier: the policy JS-bigint', () => {
  /** The program of `json` in the mode `bigint`, lowered from the lane
   *  analysis of the existing compiler (`lowerBigintProgram()`). */
  function bigint(json: MathJsonExpression) {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    ce.declare('m', 'integer');
    const expr = ce.box(json);
    return lowerBigintProgram(expr, requireBigintLane(expr));
  }

  /** The program with the first operation of the kind `kind` of its root
   *  replaced by `edit(op)`. */
  function edited(
    lowered: ReturnType<typeof bigint>,
    kind: string,
    edit: (op: IROperation) => IROperation
  ): IRProgram {
    const { program } = lowered;
    const index = program.root.operations.findIndex((op) => op.kind === kind);
    expect(index).toBeGreaterThanOrEqual(0);
    const operations = [...program.root.operations];
    operations[index] = edit(operations[index]);
    return { ...program, root: { ...program.root, operations } };
  }

  const PROGRAM: MathJsonExpression = [
    'Add',
    ['Floor', ['Divide', 'n', 'm']],
    ['Mod', 'n', 'm'],
    ['Factorial', 'n'],
  ];

  test('a lowered program verifies, with the abort kinds of the policy', () => {
    const { program, preparedNodes } = bigint(PROGRAM);
    expect(() => verifyProgram(program, preparedNodes)).not.toThrow();
    expect(program.numericPolicy).toBe('bigint');
    expect(program.noValueResult).toBe('number');
    const aborts = Object.fromEntries(
      program.root.operations.map((op) => [
        op.kind === 'integer' ? `${op.fn} ${op.rounding ?? ''}`.trim() : op.kind,
        op.aborts,
      ])
    );
    expect(aborts).toEqual({
      'input': undefined,
      'quotient floor': ['no-value'],
      'mod': ['no-value'],
      'factorial': ['error', 'no-value'],
      'add': undefined,
      'yield': undefined,
    });
    expect(program.root.canAbort).toBe(true);
  });

  test('a real value has no representation in the policy', () => {
    const lowered = bigint(PROGRAM);
    const program = edited(lowered, 'add', (op) => ({
      ...op,
      result: { ...op.result!, type: 'real' },
    }) as IROperation);
    expect(() => verifyProgram(program, lowered.preparedNodes)).toThrow(
      /JS-bigint structured representation: the value \d+ has the type real, which the target does not hold/
    );
  });

  test('an operation that the policy does not have', () => {
    const lowered = bigint(['Add', 'n', 'm']);
    const program = edited(lowered, 'add', (op) => ({ ...op, kind: 'divide' }) as IROperation);
    expect(() => verifyProgram(program, lowered.preparedNodes)).toThrow(
      /the target has no operation divide/
    );
  });

  test('an integer function on the double policy', () => {
    const lowered = bigint(PROGRAM);
    expect(() =>
      verifyCore(lowered.program, lowered.preparedNodes, JAVASCRIPT_POLICY)
    ).toThrow(/^JS structured representation: the value \d+ has the representation bigint, which the target does not have/);
    // Under a policy that holds `bigint` values, with no integer function.
    const { integers: _integers, ...noIntegers } = JAVASCRIPT_BIGINT_POLICY;
    expect(() =>
      verifyCore(lowered.program, lowered.preparedNodes, noIntegers)
    ).toThrow(/the target has no integer function quotient/);
  });

  test('the abort kinds of an operation are those of the policy', () => {
    const lowered = bigint(PROGRAM);
    const missing = edited(lowered, 'integer', (op) => {
      const { aborts: _aborts, ...rest } = op;
      return rest as IROperation;
    });
    expect(() => verifyProgram(missing, lowered.preparedNodes)).toThrow(
      /the operation integer has the abort kinds none, and the target states no-value/
    );
    const extra = edited(lowered, 'add', (op) => ({ ...op, aborts: ['error'] }) as IROperation);
    expect(() => verifyProgram(extra, lowered.preparedNodes)).toThrow(
      /the operation add has the abort kinds error, and the target states none/
    );
    const unsorted = edited(lowered, 'integer', (op) => ({ ...op, aborts: ['no-value', 'error'] }) as IROperation);
    expect(() => verifyProgram(unsorted, lowered.preparedNodes)).toThrow(
      /the operation integer has a malformed list of abort kinds/
    );
  });

  test('an exact quotient can abort with an error; a rounded one cannot', () => {
    const { program } = bigint(['Typed', ['Divide', 'n', 'm'], "'integer'"]);
    const quotient = program.root.operations.find((op) => op.kind === 'integer');
    expect(quotient).toMatchObject({ fn: 'quotient', rounding: 'exact', aborts: ['error', 'no-value'] });
  });

  test('the no-value result is named exactly when an operation can abort with no-value', () => {
    const lowered = bigint(PROGRAM);
    const { noValueResult: _none, ...without } = lowered.program;
    expect(() => verifyProgram(without, lowered.preparedNodes)).toThrow(
      /an operation aborts with no-value, and the program has no no-value result/
    );
    const plain = bigint(['Add', 'n', ['Multiply', 2, 'm']]);
    expect(plain.program.noValueResult).toBeUndefined();
    expect(() =>
      verifyProgram({ ...plain.program, noValueResult: 'number' }, plain.preparedNodes)
    ).toThrow(/the program has a no-value result, and no operation aborts with no-value/);
    expect(() =>
      verifyProgram({ ...plain.program, noValueResult: 'boolean' }, plain.preparedNodes)
    ).toThrow(/the program has the no-value result boolean, and the target number/);
  });

  test('a rounding exactly for the functions that have one', () => {
    const lowered = bigint(PROGRAM);
    const none = edited(lowered, 'integer', (op) => {
      const { rounding: _rounding, ...rest } = op as IROperation & { rounding?: string };
      return rest as IROperation;
    });
    expect(() => verifyProgram(none, lowered.preparedNodes)).toThrow(
      /the integer function quotient has the rounding undefined/
    );
    const sqrt = bigint(['Floor', ['Sqrt', 'n']]);
    const exact = edited(sqrt, 'integer', (op) => ({ ...op, rounding: 'exact' }) as IROperation);
    expect(() => verifyProgram(exact, sqrt.preparedNodes)).toThrow(
      /the integer function isqrt has the rounding exact/
    );
    const factorial = bigint(['Factorial', 'n']);
    const rounded = edited(factorial, 'integer', (op) => ({ ...op, rounding: 'floor' }) as IROperation);
    expect(() => verifyProgram(rounded, factorial.preparedNodes)).toThrow(
      /the integer function factorial has a rounding/
    );
  });

  test('an integer function with an operand that is not an integer, or the wrong count', () => {
    const lowered = bigint(['Less', ['Factorial', 'n'], 'm']);
    const boolean = edited(lowered, 'integer', (op) => ({
      ...op,
      result: { ...op.result!, type: 'boolean', representation: 'boolean' },
    }) as IROperation);
    expect(() => verifyProgram(boolean, lowered.preparedNodes)).toThrow(
      /the result of the operation integer has the representation boolean/
    );
    const two = edited(lowered, 'integer', (op) => ({ ...op, operands: [op.operands[0], op.operands[0]] }) as IROperation);
    expect(() => verifyProgram(two, lowered.preparedNodes)).toThrow(
      /the operation integer has 2 operands, not 1/
    );
  });

  test('a constant pole is a no-value operation that aborts with no-value', () => {
    const lowered = bigint(['Add', 'n', ['Factorial', -1]]);
    const op = lowered.program.root.operations.find((o) => o.kind === 'no-value');
    expect(op).toMatchObject({ value: 'infinite', aborts: ['no-value'], effect: 'pure' });
    const wrong = edited(lowered, 'no-value', (o) => ({ ...o, value: 'nan' }) as IROperation);
    expect(() => verifyProgram(wrong, lowered.preparedNodes)).toThrow(
      /a no-value operation names the value nan/
    );
  });

  test('a bigint literal is an integer', () => {
    const lowered = bigint(['Add', 'n', ['Power', 2, 70]]);
    const literal = lowered.program.root.operations.find((o) => o.kind === 'literal');
    expect(literal).toMatchObject({ value: 2n ** 70n });
    expect(() => verifyProgram(lowered.program, lowered.preparedNodes)).not.toThrow();
    const boolean = edited(lowered, 'literal', (o) => ({
      ...o,
      result: { ...o.result!, type: 'boolean', representation: 'boolean' },
    }) as IROperation);
    expect(() => verifyProgram(boolean, lowered.preparedNodes)).toThrow(
      /a literal of the representation boolean holds another kind of value/
    );
  });

  test('a literal holds the kind of value of its representation (literalAdmits)', () => {
    // A JavaScript number in a `bigint` literal of the type `integer`.
    const lowered = bigint(['Add', 'n', 3]);
    const number = edited(lowered, 'literal', (o) => ({ ...o, value: 3 }) as IROperation);
    expect(() => verifyProgram(number, lowered.preparedNodes)).toThrow(
      /^JS-bigint structured representation: a literal of the representation bigint holds another kind of value/
    );
    // A `bigint` value in a `number` literal of the type `integer`, on the
    // policy of the `strict` mode.
    const preparation = new ScalarFragmentJavaScriptTarget(
      'structured'
    ).prepareStructured(
      new ComputeEngine().expr([
        'Function',
        ['Block', ['Add', 'k', 3]],
        typed('k', 'integer'),
      ] as MathJsonExpression),
      OPTIONS
    );
    const program = lowerStructuredFragment(preparation);
    const index = program.root.operations.findIndex((op) => op.kind === 'literal');
    expect(program.root.operations[index]).toMatchObject({
      value: 3,
      result: { type: 'integer', representation: 'number' },
    });
    const operations = [...program.root.operations];
    operations[index] = { ...operations[index], value: 3n } as IROperation;
    expect(() =>
      verifyProgram(
        { ...program, root: { ...program.root, operations } },
        preparedNodesOf(preparation)
      )
    ).toThrow(
      /^JS structured representation: a literal of the representation number holds another kind of value/
    );
  });
});

// Slice 2 of docs/plans/2026-11-11-structured-numeric-calculus.md: the
// operation `routine` (`integrate`) and its rule in the policy.
describe('the verifier: routines', () => {
  type Made = ReturnType<typeof madeProgram>;
  /**
   * A made program whose root is `integrate` of its parameter between the
   * literal 0 and the input `x`, with the routine replaced by `change`.
   */
  function madeRoutine(change: (op: Op, m: Made) => Op = (op) => op) {
    const m = madeProgram();
    const lo = m.value('real');
    const hi = m.value('real');
    const t = m.value('real');
    const r = m.value('real');
    const routine: Op = {
      kind: 'routine',
      fn: 'integrate',
      result: r,
      operands: [lo, hi],
      body: { ...m.region([m.yieldOf(t)]), parameters: [t] },
      initialPanels: 4,
      effect: 'effectful',
      touches: ['entropy', 'quadrature'],
      aborts: ['error'],
      origin: m.origin,
    };
    const changed = change(routine, m);
    const rootOps: Op[] = [
      { kind: 'input', input: 0, result: m.condition, operands: [], effect: 'pure', origin: m.origin },
      { kind: 'literal', value: 0, result: lo, operands: [], effect: 'pure', origin: m.origin },
      { kind: 'input', input: 1, result: hi, operands: [], effect: 'pure', origin: m.origin },
      changed,
      m.yieldOf(changed.result!),
    ];
    const root: IRRegion = {
      ...m.region(rootOps, changed.effect),
      ...(changed.aborts !== undefined ? { canAbort: true as const } : {}),
    };
    return { program: { ...m.program, root }, prepared: m.prepared };
  }
  const verify =
    (made: ReturnType<typeof madeRoutine>, policy: RepresentationPolicy = JAVASCRIPT_POLICY) =>
    () =>
      verifyCore(made.program, made.prepared, policy);

  test('control: the made routine verifies', () => {
    expect(verify(madeRoutine())).not.toThrow();
  });

  test('a target with no routines (a GLSL policy) refuses it', () => {
    expect(verify(madeRoutine(), { ...JAVASCRIPT_POLICY, routines: undefined })).toThrow(
      /the target has no routine integrate/
    );
  });

  test('a routine that the policy does not list', () => {
    const policy: RepresentationPolicy = {
      ...JAVASCRIPT_POLICY,
      routines: { integrate: JAVASCRIPT_POLICY.routines!.integrate },
    };
    expect(verify(madeRoutine((op) => ({ ...op, fn: 'limit', operands: [op.operands[0]], initialPanels: undefined, effect: 'pure', touches: undefined })), policy)).toThrow(
      /the target has no routine limit/
    );
  });

  // Slices 3 and 4: `integrate-sampled`, `limit`, `derivative`, and the
  // alternative of an integral.
  const asRoutine = (op: Op) => op as Extract<Op, { kind: 'routine' }>;
  /** The routine of `madeRoutine()` as a pure `fn` of the point `x`. */
  const pureRoutine =
    (fn: 'limit' | 'derivative', extra: object = {}) =>
    (op: Op): Op => {
      const { initialPanels: _panels, touches: _touches, ...rest } = asRoutine(op);
      return {
        ...rest,
        fn,
        operands: [op.operands[1]],
        effect: 'pure',
        ...(fn === 'limit' ? { aborts: ['error'] } : { aborts: undefined }),
        ...(fn === 'derivative' ? { order: 2 } : {}),
        ...extra,
      } as Op;
    };
  /** The routine of `madeRoutine()` with an alternative of its own
   *  parameter that yields that parameter. */
  const withAlternative = (op: Op, m: Made): Op => {
    const s = m.value('real');
    return {
      ...op,
      alternative: { ...m.region([m.yieldOf(s)]), parameters: [s] },
    };
  };

  test.each([
    ['a limit', pureRoutine('limit')],
    ['a limit with a direction', (op: Op) => ({ ...pureRoutine('limit')(op), operands: [op.operands[1], op.operands[0]] })],
    ['a derivative', pureRoutine('derivative')],
    [
      'a sampled integral',
      (op: Op) => {
        const { initialPanels: _panels, ...rest } = asRoutine(op);
        return { ...rest, fn: 'integrate-sampled' } as Op;
      },
    ],
    ['an integral with an alternative', withAlternative],
  ] as [string, (op: Op, m: Made) => Op][])('control: %s verifies', (_name, change) => {
    expect(verify(madeRoutine(change))).not.toThrow();
  });

  test.each([
    ['a limit of three operands', (op: Op) => ({ ...pureRoutine('limit')(op), operands: [op.operands[1], op.operands[1], op.operands[1]] }), /the operation routine limit has 3 operands, not one or two/],
    ['a derivative of two operands', (op: Op) => ({ ...pureRoutine('derivative')(op), operands: [op.operands[1], op.operands[1]] }), /the operation routine has 2 operands, not 1/],
    ['a derivative with no order', pureRoutine('derivative', { order: undefined }), /a routine derivative has the order undefined, not a positive integer/],
    ['a derivative of the order 0', pureRoutine('derivative', { order: 0 }), /a routine derivative has the order 0, not a positive integer/],
    ['a limit with an order', pureRoutine('limit', { order: 1 }), /a routine limit has an order/],
    ['a limit with panels', pureRoutine('limit', { initialPanels: 4 }), /a routine limit states a number of panels/],
    ['a derivative that aborts', pureRoutine('derivative', { aborts: ['error'] }), /the operation routine has the abort kinds error, and the target states none/],
    ['an effectful derivative', pureRoutine('derivative', { effect: 'effectful', touches: ['quadrature'] }), /a routine derivative has the effect effectful and the states quadrature, and the target states pure and none/],
    ['a limit with no abort kind', pureRoutine('limit', { aborts: undefined }), /the operation routine has the abort kinds none, and the target states error/],
    [
      'a sampled integral with panels',
      (op: Op) => ({ ...op, fn: 'integrate-sampled' }),
      /a routine integrate-sampled states a number of panels/,
    ],
    [
      'a derivative with an alternative',
      (op: Op, m: Made) => withAlternative(pureRoutine('derivative')(op), m),
      /a routine derivative has an alternative/,
    ],
    [
      'an alternative with no parameter',
      (op: Op, m: Made) => {
        const with2 = asRoutine(withAlternative(op, m));
        const { parameters: _parameters, ...alternative } = with2.alternative!;
        return { ...with2, alternative };
      },
      /the alternative of a routine integrate has 0 parameters, not one|has no definition/,
    ],
    [
      'an alternative that draws, and a routine that omits its state',
      (op: Op, m: Made) => {
        const d = m.value('real');
        const s = m.value('real');
        return {
          ...op,
          alternative: {
            ...m.region([{ kind: 'draw', result: d, operands: [], effect: 'effectful', touches: ['random'], origin: m.origin }, m.yieldOf(d)], 'effectful'),
            parameters: [s],
          },
        };
      },
      /a routine integrate has the effect effectful and the states entropy, quadrature, and the target states effectful and entropy, quadrature, random for it and its regions/,
    ],
  ] as [string, (op: Op, m: Made) => Op, RegExp][])('%s', (_name, change, message) => {
    expect(verify(madeRoutine(change))).toThrow(message);
  });

  test.each([
    ['one operand', (op: Op) => ({ ...op, operands: [op.operands[0]] }), /the operation routine has 1 operands, not 2/],
    [
      'a boolean bound',
      (op: Op, m: Made) => ({ ...op, operands: [op.operands[0], m.condition] }),
      /an operand of the operation routine has the representation boolean/,
    ],
    [
      'a pure routine',
      (op: Op) => ({ ...op, effect: 'pure', touches: undefined }),
      /a routine integrate has the effect pure and the states none, and the target states effectful and entropy, quadrature/,
    ],
    ['a missing state', (op: Op) => ({ ...op, touches: ['quadrature'] }), /a routine integrate has the effect effectful and the states quadrature,/],
    ['no abort kind', (op: Op) => ({ ...op, aborts: undefined }), /the operation routine has the abort kinds none, and the target states error/],
    [
      'a result of the type integer',
      (op: Op) => ({ ...op, result: { ...op.result!, type: 'integer' } }),
      /a routine integrate has a result of the type integer, not real|used with another type/,
    ],
    ['zero panels', (op: Op) => ({ ...op, initialPanels: 0 }), /a routine integrate starts from 0 panels, not a positive integer/],
    [
      'a body with no parameter',
      (op: Op) => {
        const routine = op as Extract<Op, { kind: 'routine' }>;
        const { parameters: _parameters, ...body } = routine.body;
        return { ...routine, body };
      },
      /the body of a routine integrate has 0 parameters, not one|has no definition/,
    ],
    [
      'an integer parameter',
      (op: Op) => {
        const routine = op as Extract<Op, { kind: 'routine' }>;
        const t = { ...routine.body.parameters![0], type: 'integer' as ScalarKind };
        return {
          ...routine,
          body: { ...routine.body, parameters: [t], operations: [{ ...routine.body.operations[0], operands: [t] }] },
        };
      },
      /the parameter of the body of a routine integrate has the type integer/,
    ],
    [
      'a body that yields two values',
      (op: Op) => {
        const routine = op as Extract<Op, { kind: 'routine' }>;
        const [t] = routine.body.parameters!;
        return {
          ...routine,
          body: { ...routine.body, operations: [{ ...routine.body.operations[0], operands: [t, t] }] },
        };
      },
      // The check of the yield of a region refuses it first.
      /the body of a routine integrate yields 2 values, not one|the operation yield has 2 operands, not 1/,
    ],
  ] as [string, (op: Op, m: Made) => Op, RegExp][])('%s', (_name, change, message) => {
    expect(verify(madeRoutine(change))).toThrow(message);
  });

  test('an exit that leaves the routine', () => {
    // `loop k in 1..2 { integrate(t => if (C) exit else t, 0, 0) }`: the
    // exit is in a region of the routine, between it and its loop.
    const m = madeProgram();
    const from = m.value('integer');
    const to = m.value('integer');
    const k = m.value('integer');
    const c = m.value('boolean');
    const t = m.value('real');
    const v = m.value('real');
    const lo = m.value('real');
    const r = m.value('real');
    const branch: Op = {
      kind: 'if',
      results: [v],
      operands: [c],
      then: m.region([{ kind: 'exit', operands: [], effect: 'pure', origin: m.origin }]),
      else: m.region([m.yieldOf(t)]),
      effect: 'pure',
      origin: m.origin,
    };
    const routine: Op = {
      kind: 'routine',
      fn: 'integrate',
      result: r,
      operands: [lo, lo],
      body: {
        ...m.region([
          { kind: 'input', input: 0, result: c, operands: [], effect: 'pure', origin: m.origin },
          branch,
          m.yieldOf(v),
        ]),
        parameters: [t],
      },
      effect: 'effectful',
      touches: ['entropy', 'quadrature'],
      aborts: ['error'],
      origin: m.origin,
    };
    const loopBody: IRRegion = {
      ...m.region(
        [
          { kind: 'literal', value: 0, result: lo, operands: [], effect: 'pure', origin: m.origin },
          routine,
          { kind: 'yield', operands: [], effect: 'pure', origin: m.origin },
        ],
        'effectful'
      ),
      canAbort: true,
      parameters: [k],
    };
    const loop: Op = {
      kind: 'loop',
      results: [],
      operands: [from, to],
      body: loopBody,
      effect: 'effectful',
      touches: ['entropy', 'quadrature'],
      origin: m.origin,
    };
    const rootOps: Op[] = [
      { kind: 'literal', value: 1, result: from, operands: [], effect: 'pure', origin: m.origin },
      { kind: 'literal', value: 2, result: to, operands: [], effect: 'pure', origin: m.origin },
      loop,
      { kind: 'literal', value: 1, result: m.one, operands: [], effect: 'pure', origin: m.origin },
      m.yieldOf(m.one),
    ];
    const root: IRRegion = { ...m.region(rootOps, 'effectful'), canAbort: true };
    expect(() => verifyCore({ ...m.program, root }, m.prepared, JAVASCRIPT_POLICY)).toThrow(
      /an exit is in a region of the operation routine, between it and its loop/
    );
  });

  test('a lowered integral has the facts of the policy', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const preparation = structured().prepareStructured(
      ce.expr([
        'Integrate',
        ['Sqrt', ['Add', 1, ['Power', 't', 4]]],
        ['Limits', 't', 0, 'x'],
      ] as MathJsonExpression),
      OPTIONS
    );
    const program = lowerStructuredFragment(preparation);
    const routine = program.root.operations.find((op) => op.kind === 'routine');
    expect(routine).toMatchObject({
      fn: 'integrate',
      effect: 'effectful',
      touches: ['entropy', 'quadrature'],
      aborts: ['error'],
      initialPanels: 16,
    });
    expect(program.root.canAbort).toBe(true);
  });
});
