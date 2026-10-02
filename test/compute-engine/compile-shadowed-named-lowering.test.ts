import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// The compiler lowers some heads BY NAME in its own code: `If`, `Which`, the
// loops, `Sum`, `Product`, `Block`, … Each of these lowerings computes the
// library operator. A user definition that replaces the library definition
// of such a head (`ce.declare('If', { ...libraryIf, evaluate })`) is what
// the interpreter calls, so the compilation must fail closed (the result
// falls back to the interpreter) or use the definition's own `compile`
// handler. Before, the check for a shadowing definition ran only for the
// heads that a target lowers through its `functions` or `operators` table,
// and a redeclared `If` compiled with `success: true` to the code of the
// library `If`.
//
// An unchanged copy of the library definition is the library operator, and
// still compiles to the library form.
//

/** A fresh engine where `name` is redeclared with a copy of its library
 * definition, with the fields of `patch` replaced. */
function engineWithCopy(
  name: string,
  patch: Record<string, unknown> = {}
): ComputeEngine {
  const ce = new ComputeEngine();
  const def = ce.lookupDefinition(name) as any;
  ce.declare(name, { ...def.operator, ...patch });
  return ce;
}

/** An `evaluate` handler that always gives 100. */
const HUNDRED = {
  evaluate: (_ops: any[], { engine }: any) => engine.number(100),
};

function compiled(ce: ComputeEngine, expr: any, to?: string) {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return compile(ce.box(expr), to ? ({ to } as any) : undefined) as any;
  } finally {
    warn.mockRestore();
  }
}

const IF = ['If', ['Greater', 'x', 0], ['Sin', 'x'], ['Cos', 'x']];

/** A loop whose body holds an `If` statement: the lowering of the loop body
 * handles the `If` without compiling it as a node. */
const LOOP_WITH_IF = [
  'Block',
  ['Declare', 's', 'real'],
  ['Assign', 's', 0],
  [
    'Loop',
    [
      'If',
      ['Greater', 'i', 2],
      ['Assign', 's', ['Add', 's', 'i']],
      ['Assign', 's', 's'],
    ],
    ['Element', 'i', ['Range', 1, 4]],
  ],
  's',
];

// Each shape, with the expression whose value the interpreter gives for it
// at `x = 0.7` (`subs()` cannot reach the parameter `x` of a function
// literal, so that shape is compared with the `If` it applies). Every row
// has three elements: with fewer, `test.each` passes its `done` callback as
// the last parameter.
const SHAPES: [string, any, any][] = [
  ['at the root', IF, IF],
  ['as an operand', ['Add', 1, IF], ['Add', 1, IF]],
  [
    'in a Block',
    ['Block', ['Declare', 't', 'real'], ['Assign', 't', IF], 't'],
    ['Block', ['Declare', 't', 'real'], ['Assign', 't', IF], 't'],
  ],
  ['in a loop body', LOOP_WITH_IF, LOOP_WITH_IF],
  ['in a function literal', ['Apply', ['Function', IF, 'x'], 'x'], IF],
];

describe('a redeclared If', () => {
  test.each(SHAPES)('a copy with a new `evaluate`, %s', (_, expr, ref) => {
    const ce = engineWithCopy('If', HUNDRED);
    const f = compiled(ce, expr);
    expect(f.success).toBe(false);
    // The fallback is the interpreter, which runs the new handler.
    expect(f.run({ x: 0.7 })).toBe(ce.box(ref).subs({ x: 0.7 }).evaluate().re);
  });

  test('the value of the ROADMAP example', () => {
    const ce = engineWithCopy('If', HUNDRED);
    const f = compiled(ce, IF);
    expect(f.success).toBe(false);
    expect(f.run({ x: 0.7 })).toBe(100);
  });

  test.each(['python', 'glsl', 'wgsl', 'interval-js'])(
    'a copy with a new `evaluate` fails closed on %s',
    (to) => {
      const ce = engineWithCopy('If', HUNDRED);
      for (const [, expr] of SHAPES)
        expect(compiled(ce, expr, to).success).toBe(false);
    }
  );

  test('a copy with `lazy: false`', () => {
    const assertion = jest
      .spyOn(console, 'assert')
      .mockImplementation(() => {});
    try {
      const ce = engineWithCopy('If', { lazy: false });
      expect(compiled(ce, IF).success).toBe(false);
    } finally {
      assertion.mockRestore();
    }
  });

  test('an unchanged copy compiles as the library If', () => {
    const ce = engineWithCopy('If');
    for (const [, expr, ref] of SHAPES) {
      const f = compiled(ce, expr);
      expect(f.success).toBe(true);
      expect(f.run({ x: 0.7 })).toBeCloseTo(
        ce.box(ref).subs({ x: 0.7 }).N().re,
        10
      );
    }
    expect(compiled(ce, IF, 'python').success).toBe(true);
  });

  test('the `compile` handler of a redeclared If is not consulted', () => {
    // `If` is a control-flow head: the compiler does not call a `compile`
    // handler for it, so the handler cannot exempt the definition.
    const ce = engineWithCopy('If', {
      ...HUNDRED,
      compile: () => '(42)',
    });
    const f = compiled(ce, IF);
    expect(f.success).toBe(false);
    expect(f.run({ x: 0.7 })).toBe(100);
  });

  test('a redeclared If in the body of a user function', () => {
    const ce = engineWithCopy('If', HUNDRED);
    ce.assign('g', ce.box(['Function', ['Add', LOOP_WITH_IF, 'y'], 'y']));
    expect(compiled(ce, ['Add', ['g', 'x'], 1]).success).toBe(false);
  });
});

describe('the other heads lowered by name', () => {
  const CASES: [string, any][] = [
    ['Sum', ['Sum', ['Multiply', 'x', 'i'], ['Limits', 'i', 1, 3]]],
    ['Product', ['Product', ['Multiply', 'x', 'i'], ['Limits', 'i', 1, 3]]],
    ['Block', ['Block', ['Sin', 'x']]],
    ['Which', ['Which', ['Greater', 'x', 0], 1, 'True', 2]],
    [
      'Loop',
      [
        'Block',
        ['Declare', 's', 'real'],
        ['Assign', 's', 0],
        [
          'Loop',
          ['Assign', 's', ['Add', 's', 'i']],
          ['Element', 'i', ['Range', 1, 3]],
        ],
        's',
      ],
    ],
  ];

  test.each(CASES)('a copy of %s with a new `evaluate`', (name, expr) => {
    const ce = engineWithCopy(name, HUNDRED);
    const f = compiled(ce, expr);
    expect(f.success).toBe(false);
    expect(f.run({ x: 0.7 })).toBe(ce.box(expr).subs({ x: 0.7 }).evaluate().re);
  });

  test.each(CASES)('an unchanged copy of %s', (name, expr) => {
    const ce = engineWithCopy(name);
    const f = compiled(ce, expr);
    expect(f.success).toBe(true);
    expect(f.run({ x: 0.7 })).toBeCloseTo(
      ce.box(expr).subs({ x: 0.7 }).N().re,
      10
    );
  });

  test('Which is overridable: the `compile` handler of a copy is used', () => {
    const ce = engineWithCopy('Which', { ...HUNDRED, compile: () => '(42)' });
    const f = compiled(ce, ['Which', ['Greater', 'x', 0], 1, 'True', 2]);
    expect(f.success).toBe(true);
    expect(f.run({ x: 0.7 })).toBe(42);
  });
});
