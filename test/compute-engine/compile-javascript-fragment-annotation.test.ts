import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { core } from '../../src/compute-engine/compilation/compiler-core-hooks';
import { CompilerState } from '../../src/compute-engine/compilation/compiler-state';
import { isFunction, isSymbol } from '../../src/compute-engine/boxed-expression/type-guards';
import {
  attachScalarFragment,
  enterScalarFragment,
  scalarFragmentAnnotation,
} from '../../src/compute-engine/compilation/javascript-fragment-facts';
import type {
  CompilationOptions,
  CompileTarget,
} from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// The annotation of the internal scalar JavaScript fragment is built in
// `prepareCompilation()`, before any emission, from the facts of the
// operands. These tests check that the rules of `Add`, `Negate` and `If` do
// not call the reader of the existing compiler (`isComplexValued()`), that
// their facts agree with that reader, and the refusals and corrections of the
// fragment route.

const typed = (name: string, type = 'real'): MathJsonExpression => [
  'Typed',
  name,
  `'${type}'`,
];

/** A fragment target that keeps the target that its preparation made. */
class CapturingTarget extends ScalarFragmentJavaScriptTarget {
  prepared?: CompileTarget<Expression>;
  protected prepareCompilation(
    expr: Expression,
    options: CompilationOptions<Expression>,
    batch?: unknown
  ) {
    const result = super.prepareCompilation(expr, options, batch);
    this.prepared = result.target;
    return result;
  }
}

type Program = {
  name: string;
  setup: (ce: ComputeEngine) => void;
  json: MathJsonExpression;
  /** The inputs of a root expression, or the arguments of a function. */
  inputs: (Record<string, unknown> | unknown[])[];
};

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('z', 'complex');
  ce.declare('C', 'boolean');
  ce.declare('D', 'boolean');
  return ce;
}

const scalarInputs = [
  { x: 2, y: -3, z: { re: 3, im: 4 }, C: true, D: false },
  { x: -1.5, y: 4, z: { re: -1, im: 0.5 }, C: false, D: true },
];

const installHelper = (ce: ComputeEngine, body: MathJsonExpression) => {
  ce.declare('helper', '(real) -> real');
  ce.assign('helper', ce.expr(['Function', body, typed('u')]));
};

const programs: Program[] = [
  { name: 'real sum', setup: () => {}, json: ['Add', 'x', 'y'], inputs: scalarInputs },
  { name: 'mixed sum', setup: () => {}, json: ['Add', 'x', 'z'], inputs: scalarInputs },
  { name: 'three-term mixed sum', setup: () => {}, json: ['Add', 'x', 'z', 'y'], inputs: scalarInputs },
  { name: 'real negation', setup: () => {}, json: ['Negate', 'x'], inputs: scalarInputs },
  { name: 'complex negation', setup: () => {}, json: ['Negate', 'z'], inputs: scalarInputs },
  { name: 'complex literal', setup: () => {}, json: ['Add', 'x', ['Complex', 1, 2]], inputs: scalarInputs },
  { name: 'imaginary unit', setup: () => {}, json: ['Add', 'x', 'ImaginaryUnit'], inputs: scalarInputs },
  { name: 'negated complex sum', setup: () => {}, json: ['Negate', ['Add', 'z', 'x']], inputs: scalarInputs },
  { name: 'real and complex branches', setup: () => {}, json: ['If', 'C', 'x', 'z'], inputs: scalarInputs },
  { name: 'complex literal branch', setup: () => {}, json: ['If', 'C', ['Complex', 1, 2], 'x'], inputs: scalarInputs },
  {
    name: 'nested If',
    setup: () => {},
    json: ['If', 'C', ['If', 'D', 'x', 'z'], ['Negate', ['Add', 'x', 'y']]],
    inputs: scalarInputs,
  },
  {
    name: 'bound function with a local',
    setup: () => {},
    json: ['Function', ['Block',
      ['Declare', 't', "'real'", 'w'],
      ['Assign', 't', ['Add', 't', 'e']],
      ['Negate', 't']], typed('w'), typed('e')],
    inputs: [[1, 2], [-3, 0.5]],
  },
  {
    name: 'bound function with a complex local',
    setup: () => {},
    json: ['Function', ['Block',
      ['Declare', 't', "'complex'", 'v'],
      ['Assign', 't', ['Add', 't', 'w']],
      ['If', 'b', ['Negate', 't'], 't']], typed('v', 'complex'), typed('w'), typed('b', 'boolean')],
    inputs: [[{ re: 1, im: 2 }, 3, true], [{ re: -1, im: 0 }, 0.5, false]],
  },
  {
    name: 'helper call',
    setup: (ce) => installHelper(ce, ['Negate', 'u']),
    json: ['Add', ['helper', 'x'], 'y'],
    inputs: scalarInputs,
  },
  {
    name: 'helper with a capture',
    setup: (ce) => {
      ce.declare('offset', 'real');
      ce.assign('offset', 2);
      installHelper(ce, ['Add', 'u', 'offset']);
    },
    json: ['Function', ['Block',
      ['Declare', 't', "'real'", ['helper', 'w']],
      ['Assign', 't', ['helper', 't']],
      't'], typed('w')],
    inputs: [[3], [-5]],
  },
];

/** The interpreter's value of `json` for one input, as a `{re, im}` pair. */
function interpret(
  ce: ComputeEngine,
  json: MathJsonExpression,
  input: Record<string, unknown> | unknown[]
): { re: number; im: number } {
  const box = (v: unknown): MathJsonExpression =>
    typeof v === 'boolean'
      ? v ? 'True' : 'False'
      : typeof v === 'number'
        ? v
        : ['Complex', (v as { re: number }).re, (v as { im: number }).im];
  const value = Array.isArray(input)
    ? ce.expr(['Apply', json, ...input.map(box)]).N()
    : ce
        .expr(json)
        .subs(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, ce.expr(box(v))])))
        .N();
  return { re: value.re, im: value.im };
}

function asPair(value: unknown): { re: number; im: number } {
  if (typeof value === 'number') return { re: value, im: 0 };
  return value as { re: number; im: number };
}

function run(result: ReturnType<ScalarFragmentJavaScriptTarget['compile']>, input: Record<string, unknown> | unknown[]) {
  return Array.isArray(input) ? result.run!(...(input as never[])) : result.run!(input as never);
}

/**
 * Make the reader of the existing compiler throw from the start of the
 * preparation of the fragment target until its end, where the annotation is
 * built. `BaseCompiler.isComplexValued` reads `core.isComplexValued` when it
 * is called, so the spy is the function that the rules would call.
 */
function forbidExistingReaderDuringPreparation(): void {
  const prepare = (ScalarFragmentJavaScriptTarget.prototype as unknown as {
    prepareCompilation: (...args: unknown[]) => unknown;
  }).prepareCompilation;
  jest
    .spyOn(ScalarFragmentJavaScriptTarget.prototype as never, 'prepareCompilation' as never)
    .mockImplementation(function (this: unknown, ...args: unknown[]) {
      const reader = jest
        .spyOn(core, 'isComplexValued')
        .mockImplementation(() => {
          throw new Error('existing reader called during the annotation');
        });
      try {
        return prepare.apply(this, args);
      } finally {
        reader.mockRestore();
      }
    } as never);
}

afterEach(() => jest.restoreAllMocks());

describe('the rules of Add, Negate and If do not call isComplexValued()', () => {
  for (const mode of ['strict', 'complex'] as const)
    for (const constantFold of [false, true])
      for (const cse of [false, true])
        test.each(programs)(`${mode} fold=${constantFold} cse=${cse}: $name`, (program) => {
          const ce = engine();
          program.setup(ce);
          const expression = ce.expr(program.json);
          forbidExistingReaderDuringPreparation();
          const result = new ScalarFragmentJavaScriptTarget().compile(expression, {
            mode,
            constantFold,
            cse,
            fallback: false,
          });
          for (const input of program.inputs) {
            const expected = interpret(ce, program.json, input);
            const actual = asPair(run(result, input));
            expect(actual.re).toBeCloseTo(expected.re, 12);
            expect(actual.im).toBeCloseTo(expected.im, 12);
          }
        });

  test('control: the rule of Sqrt still calls isComplexValued()', () => {
    const ce = engine();
    forbidExistingReaderDuringPreparation();
    expect(() =>
      new ScalarFragmentJavaScriptTarget().compile(ce.expr(['Sqrt', 'x']), {
        fallback: false,
      })
    ).toThrow(/existing reader called during the annotation/);
  });
});

test('the annotation exists before the first emission', () => {
  for (const program of programs) {
    const ce = engine();
    program.setup(ce);
    const target = new CapturingTarget();
    const compileCore = core.compile;
    const seen: boolean[] = [];
    jest.spyOn(core, 'compile').mockImplementation((expr, t, prec) => {
      if (seen.length === 0)
        seen.push(target.prepared !== undefined && scalarFragmentAnnotation(target.prepared) !== undefined);
      return compileCore(expr, t, prec);
    });
    target.compile(ce.expr(program.json), { fallback: false });
    jest.restoreAllMocks();
    expect({ program: program.name, annotatedBeforeEmission: seen }).toEqual({
      program: program.name,
      annotatedBeforeEmission: [true],
    });
  }
});

//
// Comparison of the facts with the reader of the existing compiler
//

type ValueFacts = { representation: string };
type AnyScope = {
  facts: ReadonlyMap<Expression, ValueFacts | { type: unknown }>;
  inner: ReadonlyMap<Expression, AnyScope>;
};

/** The value facts of every admitted node of the annotation. */
function admittedFacts(target: CompileTarget<Expression>): Map<Expression, boolean> {
  const annotation = scalarFragmentAnnotation(target)!;
  const result = new Map<Expression, boolean>();
  const visit = (scope: AnyScope) => {
    for (const [node, facts] of scope.facts)
      if ('representation' in facts)
        result.set(node, facts.representation === 'complex');
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(annotation.scope as AnyScope);
  for (const fn of annotation.functions.values()) visit(fn.scope as AnyScope);
  return result;
}

/**
 * The answers of `isComplexValued()` for each node that the ordinary
 * JavaScript compiler asks about while it compiles `expression`, with the
 * state that it has installed at that moment.
 */
function ordinaryAnswers(
  expression: Expression,
  options: Parameters<typeof compile>[1]
): Map<Expression, Set<boolean>> {
  const answers = new Map<Expression, Set<boolean>>();
  const reader = core.isComplexValued;
  const record = (node: Expression, answer: boolean) => {
    if (CompilerState._compileDepth === 0) return;
    const set = answers.get(node) ?? new Set<boolean>();
    set.add(answer);
    answers.set(node, set);
  };
  jest.spyOn(core, 'isComplexValued').mockImplementation((node) => {
    const answer = reader(node);
    record(node, answer);
    return answer;
  });
  // A node that no parent asks about (the root, a branch, a statement) is
  // asked here, when the compiler emits it, with the state of that moment.
  const emit = core.compileWithCse;
  jest.spyOn(core, 'compileWithCse').mockImplementation((node, target, prec) => {
    record(node, reader(node));
    return emit(node, target, prec);
  });
  try {
    compile(expression, options);
  } finally {
    jest.restoreAllMocks();
  }
  return answers;
}

const comparisonPrograms: Program[] = [
  ...programs,
  // The programs of compile-javascript-fragment.test.ts that the list above
  // does not have.
  ...([
    ['Sqrt', 'x'], ['Sqrt', 'z'], ['Sqrt', -4],
    ['If', 'C', ['Sqrt', 'x'], ['Negate', 'z']],
    ['Add', ['Sqrt', 'x'], ['Sqrt', 'y']],
    ['Add', ['Sqrt', 'x'], ['Sqrt', ['Add', ['Sqrt', 'x'], 'y']]],
    // Literals and the imaginary unit alone and in operations.
    3, 2.5, ['Complex', 1, 2], 'ImaginaryUnit',
    ['Negate', 'ImaginaryUnit'],
    ['Negate', ['Complex', 1, 2]],
    ['If', 'C', 'ImaginaryUnit', 2],
    ['If', 'C', ['If', 'D', ['Complex', 0, 1], 'x'], ['If', 'D', 'y', 'z']],
    ['Sqrt', ['Add', 'x', 'ImaginaryUnit']],
  ] as MathJsonExpression[]).map((json) => ({
    name: JSON.stringify(json),
    setup: () => {},
    json,
    inputs: [],
  })),
  {
    name: 'four-term accumulator',
    setup: () => {},
    json: ['Function', ['Block',
      ['Declare', 'total', "'real'", 'w'],
      ['Assign', 'total', ['Add', 'total', 'e']],
      ['Assign', 'total', ['Add', 'total', 'n']],
      ['Assign', 'total', ['Add', 'total', 's']],
      'total'], typed('w'), typed('e'), typed('n'), typed('s')],
    inputs: [],
  },
  {
    name: 'boolean local',
    setup: () => {},
    json: ['Function', ['Block',
      ['Declare', 'selected', "'boolean'", 'False'],
      ['Assign', 'selected', ['If', 'b', 'True', 'False']],
      'selected'], typed('b', 'boolean')],
    inputs: [],
  },
  {
    name: 'complex helper',
    setup: (ce) => {
      ce.declare('helper', '(complex, complex) -> complex');
      ce.assign('helper', ce.expr(['Function', ['Add', 'a', 'b'], typed('a', 'complex'), typed('b', 'complex')]));
    },
    json: ['Add', ['helper', 'z', 'z'], 'x'],
    inputs: [],
  },
  {
    name: 'helper with a branch and a capture',
    setup: (ce) => {
      ce.declare('offset', 'real');
      ce.assign('offset', -2.5);
      ce.declare('helper', '(boolean, real) -> real');
      ce.assign('helper', ce.expr(['Function',
        ['If', 'b', ['Add', 'offset', 'u'], ['Negate', ['Add', 'u', 'offset']]],
        typed('b', 'boolean'), typed('u')]));
    },
    json: ['helper', 'C', 'x'],
    inputs: [],
  },
];

test('the facts of the new rules equal isComplexValued() of the ordinary compiler', () => {
  const differences: string[] = [];
  const notAsked: string[] = [];
  let compared = 0;
  for (const mode of ['strict', 'complex'] as const)
    for (const constantFold of [false, true])
      for (const cse of [false, true])
        for (const program of comparisonPrograms) {
          const ce = engine();
          program.setup(ce);
          const expression = ce.expr(program.json);
          const options = { mode, constantFold, cse, fallback: false };
          const target = new CapturingTarget();
          target.compile(expression, options);
          const facts = admittedFacts(target.prepared!);
          const answers = ordinaryAnswers(expression, options);
          for (const [node, complex] of facts) {
            const answer = answers.get(node);
            const where = `${program.name} (${mode}, fold=${constantFold}, cse=${cse}): ${isSymbol(node) ? node.symbol : node.operator}`;
            if (answer === undefined) {
              notAsked.push(where);
              continue;
            }
            compared += 1;
            if (answer.size !== 1 || !answer.has(complex))
              differences.push(`${where}: fact ${complex}, isComplexValued ${[...answer].join('/')}`);
          }
        }
  expect(compared).toBeGreaterThan(1000);
  // The one difference: in the `complex` mode, the existing reader answers
  // `true` for the read of a block local declared `boolean`, and for the
  // block whose value it is, because it reads a local whose type is not a
  // subtype of `real` as a wide binding that the mode promotes. The value is
  // a boolean, and the fact of the pass (`boolean`, not complex) describes
  // it. The ordinary compiler writes the read as `_SYS.cplx(selected)`,
  // which gives a boolean unchanged, so no value differs.
  const expected = [false, true].flatMap((constantFold) =>
    [false, true].flatMap((cse) =>
      ['Block', 'selected'].map(
        (node) =>
          `boolean local (complex, fold=${constantFold}, cse=${cse}): ${node}: fact false, isComplexValued true`
      )
    )
  );
  expect(differences).toEqual(expected);
  // Every admitted node is emitted by the ordinary compiler, so each one has
  // an answer to compare with.
  expect(notAsked).toEqual([]);
});

//
// Refusals at admission
//

describe('refusals at admission', () => {
  test('an If whose condition has the type true', () => {
    const ce = engine();
    ce.declare('k', 'integer');
    const expression = ce.expr(['If', ['Equal', 'k', 'k'], 'x', 'y']);
    expect(expression.isValid).toBe(true);
    expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { fallback: false }))
      .toThrow(/the condition of If has the constant type true/);
    // Control: the ordinary target writes the branch it selects.
    expect(compile(expression, { fallback: false }).run!({ k: 1, x: 2, y: 3 })).toBe(2);
  });

  test('an If whose condition has the type false', () => {
    const ce = engine();
    ce.declare('F', 'false');
    const expression = ce.expr(['If', 'F', 'x', 'y']);
    expect(expression.isValid).toBe(true);
    expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { fallback: false }))
      .toThrow(/the condition of If has the constant type false/);
  });

  test('an If with a constant condition in a bound body and in a helper body', () => {
    const ce = engine();
    const bound = ce.expr(['Function', ['Block',
      ['Declare', 's', "'real'", 'w'],
      ['If', ['Equal', 'k', 'k'], 's', 'w']], typed('w'), typed('k', 'integer')]);
    expect(() => new ScalarFragmentJavaScriptTarget().compile(bound, { fallback: false }))
      .toThrow(/the condition of If has the constant type true/);
    ce.declare('helper', '(integer, real) -> real');
    ce.assign('helper', ce.expr(['Function', ['If', ['Equal', 'k', 'k'], 'u', ['Negate', 'u']],
      typed('k', 'integer'), typed('u')]));
    expect(() => new ScalarFragmentJavaScriptTarget().compile(ce.expr(['helper', 1, 'x']), { fallback: false }))
      .toThrow(/the condition of If has the constant type true/);
  });

  test('a closed function node with a complex value', () => {
    // The canonical form keeps these nodes. A constant fold writes a real
    // literal for a closed node whose value is real, whatever its operator,
    // where the fact of the node is complex.
    const ce = engine();
    ce.declare('p', '(boolean) -> boolean');
    ce.assign('p', ce.expr(['Function', 'b', typed('b', 'boolean')]));
    ce.declare('g', '(complex) -> complex');
    ce.assign('g', ce.expr(['Function', ['Add', 'q', ['Negate', 'q']], typed('q', 'complex')]));
    const refused: [MathJsonExpression, RegExp][] = [
      // The value of the sum is 0. Its operand `Negate(Sqrt(-2))` is typed
      // first, and is the node that the refusal names.
      [['Add', ['Sqrt', -2], ['Negate', ['Sqrt', -2]]], /a closed Negate with a complex value/],
      [['Negate', ['Sqrt', -2]], /a closed Negate with a complex value/],
      // The `If` folds to 1; before this refusal the fold wrote `1` and the
      // complex sum read it as `{re, im}`, which gave `{re: NaN}`.
      [['Add', 'x', ['If', ['p', 'True'], 1, ['Sqrt', -2]]], /a closed If with a complex value/],
      // The declared result is complex; the value is 0.
      [['Add', 'x', ['g', ['Complex', 0, 1]]], /a closed g with a complex value/],
    ];
    for (const [json, message] of refused) {
      const expression = ce.expr(json);
      expect(expression.json).toEqual(json);
      for (const constantFold of [false, true])
        expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { constantFold, fallback: false }))
          .toThrow(message);
    }
    // Control: a sum with a free symbol and a complex operand is admitted.
    const open = new ScalarFragmentJavaScriptTarget()
      .compile(ce.expr(['Add', 'x', ['Sqrt', -2]]), { constantFold: true, fallback: false })
      .run!({ x: 1 }) as { re: number; im: number };
    expect(open.re).toBe(1);
    expect(open.im).toBeCloseTo(Math.SQRT2, 15);
    // Control: in a function body, complex nodes that read only a local or
    // only a parameter are admitted.
    const body = new ScalarFragmentJavaScriptTarget()
      .compile(ce.expr(['Function', ['Block',
        ['Declare', 't', "'complex'", 'v'],
        ['Add', ['Negate', 't'], ['Negate', 'v']]], typed('v', 'complex')]), { constantFold: true, fallback: false })
      .run!({ re: 1, im: 2 }) as { re: number; im: number };
    expect(body).toEqual({ re: -2, im: -4 });
    // Control: a helper whose body reads only its parameter is admitted.
    expect(asPair(new ScalarFragmentJavaScriptTarget()
      .compile(ce.expr(['Add', 'x', ['g', 'z']]), { constantFold: true, fallback: false })
      .run!({ x: 1, z: { re: 3, im: 4 } }))).toEqual({ re: 1, im: 0 });
  });

  test('an If whose condition does not have the type boolean', () => {
    const ce = engine();
    ce.declare('u', 'any');
    const expression = ce.expr(['If', 'u', 'x', 'y']);
    expect(expression.isValid).toBe(true);
    expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { fallback: false }))
      .toThrow(/the condition of If does not have the type boolean/);
  });
});

//
// Corrections on the fragment route
//

describe('a write to a local declared integer', () => {
  test('declines an initial value of the type real', () => {
    const ce = new ComputeEngine();
    const json: MathJsonExpression = ['Function', ['Block',
      ['Declare', 'n', "'integer'", 'w'], 'n'], typed('w')];
    const expression = ce.expr(json);
    expect(expression.isValid).toBe(true);
    // The interpreter refuses the value 2.5 for the integer local.
    expect(ce.expr(['Apply', json, 2.5]).evaluate().operator).toBe('Error');
    expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { fallback: false }))
      .toThrow(/a value written to the integer local n does not have the type integer/);
  });

  test('declines an assigned value of the type real', () => {
    const ce = new ComputeEngine();
    const expression = ce.expr(['Function', ['Block',
      ['Declare', 'm', "'integer'", 'k'],
      ['Assign', 'm', ['Add', 'm', 'w']],
      'm'], typed('k', 'integer'), typed('w')]);
    expect(expression.isValid).toBe(true);
    expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { fallback: false }))
      .toThrow(/a value written to the integer local m does not have the type integer/);
  });

  test('control: integer values compile', () => {
    const ce = new ComputeEngine();
    const expression = ce.expr(['Function', ['Block',
      ['Declare', 'm', "'integer'", 'k'],
      ['Assign', 'm', ['Add', 'm', 'k', 1]],
      'm'], typed('k', 'integer')]);
    expect(new ScalarFragmentJavaScriptTarget().compile(expression, { fallback: false }).run!(3)).toBe(7);
  });
});

describe('the complex cases of Negate and Add read the recorded conversions', () => {
  /** A target of the ordinary JavaScript compiler with a made artifact whose
   *  facts are `facts` for `node`, entered at `node`. */
  function madeArtifact(
    node: Expression,
    operands: readonly Expression[],
    conversions: { kind: string; representation: string }[],
    complexOperands: readonly Expression[] = []
  ) {
    const target = new JavaScriptTarget().createTarget();
    const real = { type: { kind: 'real' }, representation: 'number' } as const;
    const complex = { type: { kind: 'complex' }, representation: 'complex' } as const;
    const facts = new Map<Expression, unknown>([
      [node, { type: { kind: 'complex' }, representation: 'complex', conversions }],
      ...operands.map((operand) =>
        [operand, complexOperands.includes(operand) ? complex : real] as [Expression, unknown]),
    ]);
    attachScalarFragment(target, {
      root: node,
      annotation: {
        root: node,
        scope: { facts, inner: new Map() } as never,
        functions: new Map(),
      },
    });
    const leave = enterScalarFragment(node, target)!;
    return { target, leave };
  }

  test('Negate applies real-to-complex to its operand', () => {
    const ce = engine();
    const node = ce.expr(['Negate', 'x']);
    if (!isFunction(node)) throw new Error('expected a function expression');
    const operand = node.op1;
    const { target, leave } = madeArtifact(node, [operand], [
      { kind: 'real-to-complex', representation: 'complex' },
    ]);
    const handler = target.functions!('Negate') as (...args: unknown[]) => string;
    const code = handler([operand], () => '_.x', target);
    leave();
    expect(code).toBe('_SYS.cneg(({ re: _.x, im: 0 }))');
  });

  test('Negate and Add refuse a conversion that the emitter does not apply', () => {
    const ce = engine();
    for (const json of [['Negate', 'x'], ['Add', 'x', 'y']] as MathJsonExpression[]) {
      const node = ce.expr(json);
      const operands = (node as unknown as { ops: Expression[] }).ops;
      const { target, leave } = madeArtifact(node, operands, operands.map(() => ({
        kind: 'to-float', representation: 'complex',
      })));
      const handler = target.functions!(node.operator) as (...args: unknown[]) => string;
      expect(() => handler(operands, () => '_.x', target)).toThrow(/unsupported conversion/);
      leave();
    }
  });

  test('Add refuses a conversion that does not match the operand', () => {
    // The conversion of an operand is compared with the representation in
    // the operand's own facts. A real operand must have `real-to-complex`
    // (`none` is refused); a complex operand must have `none`
    // (`real-to-complex` is refused).
    const ce = engine();
    const cases: [MathJsonExpression, { kind: string; representation: string }[]][] = [
      [['Add', 'x', 'y'], [
        { kind: 'real-to-complex', representation: 'complex' },
        { kind: 'none', representation: 'number' },
      ]],
      [['Add', 'x', 'z'], [
        { kind: 'real-to-complex', representation: 'complex' },
        { kind: 'real-to-complex', representation: 'complex' },
      ]],
    ];
    for (const [json, conversions] of cases) {
      const node = ce.expr(json);
      const operands = (node as unknown as { ops: Expression[] }).ops;
      const complexOperands = operands.filter((o) => isSymbol(o) && o.symbol === 'z');
      const { target, leave } = madeArtifact(node, operands, conversions, complexOperands);
      const handler = target.functions!('Add') as (...args: unknown[]) => string;
      expect(() => handler(operands, () => '_.x', target)).toThrow(
        /the conversion of a complex sum operand does not match the operand/
      );
      leave();
    }
  });

  test('Add writes a converted real operand as the real part of the sum', () => {
    const ce = engine();
    const node = ce.expr(['Add', 'x', 'y']);
    const operands = (node as unknown as { ops: Expression[] }).ops;
    const { target, leave } = madeArtifact(node, operands, [
      { kind: 'real-to-complex', representation: 'complex' },
      { kind: 'real-to-complex', representation: 'complex' },
    ]);
    const handler = target.functions!('Add') as (...args: unknown[]) => string;
    const code = handler(operands, (e: Expression) => `_.${isSymbol(e) ? e.symbol : '?'}`, target);
    leave();
    expect(code).toBe('({ re: _.x + _.y, im: 0 })');
  });
});

describe('the compiler state of the annotation of a program with Sqrt', () => {
  /** The fields of `CompilerState` that `withOutermostCompilerState()` sets. */
  const snapshot = () => ({
    mode: CompilerState._mode,
    integerLane: CompilerState._integerLane,
    realOnlyLowering: CompilerState._realOnlyLowering,
    oracleFoldTarget: CompilerState._oracleFoldTarget,
    boundVarsCtx: CompilerState._boundVarsCtx,
    callSiteTarget: CompilerState._callSiteTarget,
    unrolledIndexValues: CompilerState._unrolledIndexValues,
  });

  test('is installed during the annotation and restored after it, also after a throw', () => {
    const ce = engine();
    ce.declare('p', '(boolean) -> boolean');
    ce.assign('p', ce.expr(['Function', 'b', typed('b', 'boolean')]));
    const before = snapshot();
    // The state that the rule of Sqrt reads, at its first call.
    const seen: { callSiteTarget: unknown; unrolledIndexValues: unknown[] }[] = [];
    const reader = core.isComplexValued;
    jest.spyOn(core, 'isComplexValued').mockImplementation((node) => {
      if (seen.length === 0)
        seen.push({
          callSiteTarget: CompilerState._callSiteTarget,
          unrolledIndexValues: CompilerState._unrolledIndexValues,
        });
      return reader(node);
    });
    const target = new CapturingTarget();
    target.compile(ce.expr(['Sqrt', 'x']), { mode: 'complex', fallback: false });
    expect(seen).toEqual([{ callSiteTarget: target.prepared, unrolledIndexValues: [] }]);
    expect(snapshot()).toEqual(before);
    // The refusal of the closed `If` is thrown inside the annotation.
    expect(() =>
      new ScalarFragmentJavaScriptTarget().compile(
        ce.expr(['Add', ['Sqrt', 'x'], ['If', ['p', 'True'], 1, ['Sqrt', -2]]]),
        { mode: 'complex', fallback: false }
      )
    ).toThrow(/a closed If with a complex value/);
    const after = snapshot();
    expect(after).toEqual(before);
    expect(after.unrolledIndexValues).toBe(before.unrolledIndexValues);
  });

  test('is refused inside another compilation', () => {
    // A made state: the depth of a compilation in progress.
    const ce = engine();
    CompilerState._compileDepth += 1;
    try {
      expect(() =>
        new ScalarFragmentJavaScriptTarget().compile(ce.expr(['Sqrt', 'x']), { fallback: false })
      ).toThrow(/a square root inside another compilation is not supported/);
    } finally {
      CompilerState._compileDepth -= 1;
    }
  });
});
