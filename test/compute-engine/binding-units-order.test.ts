import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { Expression as MathJson } from '../../src/math-json/types';

// Slice 1 of binding units
// (`docs/plans/2026-11-09-binding-units-slice-1-spec.md`): boxing declares
// no name, and the requirements of the uses of a name with no explicit type
// go in the environment of the unit (one outermost boxing). So the result of
// boxing an expression does not depend on the expressions boxed before it,
// and an occurrence reads the requirements of its own unit.
//
// This file is the order-independence test of
// `docs/plans/2026-11-09-binding-units-evidence/inference-order-independence.test.ts.txt`,
// with the changes of acceptance item 3 of the spec: the type of a name is
// read on an occurrence of the expression that uses it (`typeOf()`), not on
// `ce.box(name)`, which is a new unit; a parse declares no name. Two
// requirements in two units do not conflict: each occurrence reads the
// requirements of its own unit (rule 4 of the spec), so the tests that
// asserted `unknown` for a conflict assert the type of each unit.

type Input = string | MathJson;

function engine(): ComputeEngine {
  return new ComputeEngine();
}

function box(ce: ComputeEngine, input: Input): Expression {
  return typeof input === 'string' ? ce.parse(input) : ce.box(input);
}

/** The first occurrence of the symbol `name` in `expr`, depth first: the
 * operands of a function expression and the values of a dictionary. */
function occurrence(expr: Expression, name: string): Expression | undefined {
  if (expr.symbol === name) return expr;
  for (const op of [...(expr.ops ?? []), ...(expr.values ?? [])]) {
    const found = occurrence(op, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The type of the first occurrence of `name` in `expr`, or `undefined` when
 * `expr` has no symbol occurrence of `name` (a call head is not one). */
function typeOf(expr: Expression, name: string): string | undefined {
  return occurrence(expr, name)?.type.toString();
}

describe('A READING DOES NOT DEPEND ON AN EARLIER EXPRESSION', () => {
  test('`x(3)` after `x + 1` is a call', () => {
    const ce = engine();
    expect(ce.parse('x + 1').json).toEqual(['Add', 'x', 1]);
    expect(ce.parse('x(3)').json).toEqual(['x', 3]);
  });

  test('`x + 1` after `x(3)` is a sum, not an error', () => {
    const ce = engine();
    expect(ce.parse('x(3)').json).toEqual(['x', 3]);
    const sum = ce.parse('x + 1');
    expect(sum.json).toEqual(['Add', 'x', 1]);
    expect(sum.isValid).toBe(true);
  });

  test('a speculative parse reads as the normal parse', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    expect(ce.parse('x(3)', { speculative: true }).json).toEqual(['x', 3]);
    // The speculative parse leaves no requirement.
    expect(typeOf(a, 'x')).toBe('number');
  });

  test('the name is not declared after the first parse', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    expect(ce.lookupDefinition('x')).toBeUndefined();
    expect(typeOf(a, 'x')).toBe('number');
  });

  test('two units with different requirements keep their own, in either order', () => {
    for (const order of [
      ['x + 1', 'x(3)'],
      ['x(3)', 'x + 1'],
    ]) {
      const ce = engine();
      const [first, second] = order.map((latex) => ce.parse(latex));
      const sum = order[0] === 'x + 1' ? first : second;
      expect(typeOf(sum, 'x')).toBe('number');
      expect(ce.lookupDefinition('x')).toBeUndefined();
    }
  });

  test('requirements that agree give the same type', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    const b = ce.parse('\\sin(x)');
    expect(typeOf(a, 'x')).toBe('number');
    expect(typeOf(b, 'x')).toBe('number');
  });

  test('a numeric use that maps and a collection use, in either order', () => {
    // The scalar exception of the narrowing (`narrowInferredType()`): `v + 1`
    // maps over a numeric collection, so it does not prove that `v` is a
    // scalar. Each unit reads its own requirement.
    const types = (
      [
        [
          ['Add', 'v', 1],
          ['Add', ['At', 'v', 1], ['At', 'v', 2]],
        ],
        [
          ['Add', ['At', 'v', 1], ['At', 'v', 2]],
          ['Add', 'v', 1],
        ],
      ] as MathJson[][]
    ).map((order) => {
      const ce = engine();
      const exprs = order.map((input) => ce.box(input));
      const sum =
        order[0][0] === 'Add' && order[0][1] === 'v' ? exprs[0] : exprs[1];
      const indexed = sum === exprs[0] ? exprs[1] : exprs[0];
      return [typeOf(sum, 'v'), typeOf(indexed, 'v')];
    });
    expect(types[0]).toEqual(types[1]);
    // Without the units, the two requirements met in one definition gave
    // `indexed_collection<number>`. Each unit now reads only its own: the
    // index reads of `v[1] + v[2]` give it alone.
    expect(types[0]).toEqual(['number', 'indexed_collection<number>']);
  });

  test('a numeric use that does not map and a collection use, in either order', () => {
    const types = (
      [
        [
          ['Range', 'n'],
          ['At', 'n', 1],
        ],
        [
          ['At', 'n', 1],
          ['Range', 'n'],
        ],
      ] as MathJson[][]
    ).map((order) => {
      const ce = engine();
      const exprs = order.map((input) => ce.box(input));
      const range = order[0][0] === 'Range' ? exprs[0] : exprs[1];
      const at = range === exprs[0] ? exprs[1] : exprs[0];
      return [typeOf(range, 'n'), typeOf(at, 'n')];
    });
    expect(types[0]).toEqual(types[1]);
  });

  test('the call of a library operator after a numeric use of its name', () => {
    // `N + 1` reads `N` as a variable in its own unit, and declares nothing;
    // `N(3.14159, 2)` still calls the library operator, as it does in a fresh
    // engine.
    const ce = engine();
    ce.parse('N + 1');
    expect(ce.parse('N(3.14159, 2)').evaluate().json).toBe(3.1);
    ce.parse('x + N');
    expect(ce.parse('N(2.3)').evaluate().json).toBe(2.3);
  });

  test('`a(2)` after `Integrate(a t, t)` is a call', () => {
    const ce = engine();
    ce.box(['Integrate', ['Multiply', 'a', 't'], 't']);
    expect(ce.box(['a', 2]).json).toEqual(['a', 2]);
    expect(ce.parse('a(2)').json).toEqual(['a', 2]);
  });

  test('`y(2)` after `x ↦ x + y` is a call', () => {
    const ce = engine();
    ce.box(['Function', ['Add', 'x', 'y'], 'x']);
    expect(ce.lookupDefinition('y')).toBeUndefined();
    expect(ce.parse('y(2)').json).toEqual(['y', 2]);
  });

  test('a boxing inside an evaluation reads the reported type', () => {
    // The evaluation of an expression boxed earlier is not a boxing of the
    // host: it keeps the type that its own boxing inferred.
    const ce = engine();
    const expr = ce.parse('x^2 + 2x');
    ce.parse('x(3)');
    expect(expr.subs({ x: 3 }).evaluate().json).toBe(15);
  });
});

describe('AN INFERRED TYPE DOES NOT REFUSE AN ASSIGNMENT', () => {
  test('after one requirement', () => {
    const ce = engine();
    ce.parse('x + 1');
    ce.assign('x', ce.string('hello'));
    expect(ce.box('x').evaluate().json).toBe("'hello'");
  });

  test('after two different requirements', () => {
    const ce = engine();
    ce.parse('x + 1');
    ce.parse('x(3)');
    ce.assign('x', 5);
    expect(ce.parse('x + 1').evaluate().json).toBe(6);
  });

  test('a declaration replaces the inferred type', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    ce.declare('x', 'string');
    expect(typeOf(a, 'x')).toBe('string');
    expect(ce.parse('x').type.toString()).toBe('string');
  });
});

describe('ROLLBACK AND CHECKPOINT', () => {
  test('a rollback frame leaves no requirement and no declaration', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    ce._withBoxingPassWindow(() =>
      ce._withRolledBackInference(() => {
        ce.parse('x(3)');
        expect(typeOf(a, 'x')).toBe('number');
      })
    );
    expect(typeOf(a, 'x')).toBe('number');
    expect(ce.lookupDefinition('x')).toBeUndefined();
    expect(typeOf(ce.parse('2x'), 'x')).toBe('number');
  });

  test('a checkpoint restore leaves the requirements of the units', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    const cp = ce.checkpoint();
    ce.parse('x(3)');
    expect(typeOf(a, 'x')).toBe('number');
    ce.restore(cp);
    expect(typeOf(a, 'x')).toBe('number');
    expect(typeOf(ce.parse('\\cos(x)'), 'x')).toBe('number');
    expect(ce.lookupDefinition('x')).toBeUndefined();
  });
});

// Each pair is boxed in both orders, each order in a fresh engine. The
// canonical form of each expression and the type of each occurrence of a
// free name must not depend on the order.
const F: MathJson = ['Function', ['Add', '_', 1], '_'];
const PAIRS: [Input, Input][] = [
  ['x+1', 'x(3)'],
  ['x+1', ['At', 'x', 1]],
  ['2x', '\\det(x)'],
  ['x^2', 'f(x)'],
  ['f(x)+1', 'f(2,3)'],
  ['n+1', '\\sum_{k=1}^{n} k'],
  [
    ['Take', 'x', 1],
    ['Add', 'x', 1],
  ],
  [
    ['And', 'p', 'q'],
    ['Add', 'p', 1],
  ],
  [
    ['Mean', ['List', 'p', 'q']],
    ['And', 'p', 'q'],
  ],
  ['xy', 'x(y)'],
  [
    ['Length', 'L'],
    ['Add', 'L', 1],
  ],
  [
    ['Add', ['At', 'v', 1], ['At', 'v', 2]],
    ['Multiply', 2, 'v'],
  ],
  [
    ['Multiply', 't', 'P'],
    ['At', 'P', 1],
  ],
  [
    ['Range', 'n'],
    ['At', 'n', 1],
  ],
  ['\\sin(x)', '\\cos(x)'],
  ['x+y', 'x-y'],
  [
    ['Map', 'L', F],
    ['Add', 'L', 1],
  ],
  [
    ['Count', 'S'],
    ['Multiply', 'S', 2],
  ],
  ['N+1', 'N(3.14159, 2)'],
  ['x+N', 'N(2.3)'],
  ['g(x)', 'g+1'],
  ['\\sqrt{x}', 'x(2)'],
  [
    ['Floor', 'x'],
    ['And', 'x', 'True'],
  ],
  [
    ['Not', 'b'],
    ['Add', 'b', 1],
  ],
  [
    ['Length', 's'],
    ['Not', 's'],
  ],
  [
    ['Dot', 'u', 'v'],
    ['Add', 'u', 1],
  ],
  [
    ['Determinant', 'A'],
    ['Add', 'A', 'B'],
  ],
  [
    ['Determinant', ['Add', 'A', 'B']],
    ['Add', 'A', 1],
  ],
  ['a(b+c)', 'a+1'],
  [
    ['Max', 'L'],
    ['Add', 'L', 1],
  ],
  [
    ['Filter', 'L', ['Function', ['Greater', '_', 1], '_']],
    ['Multiply', 'L', 2],
  ],
  [
    ['Sum', 'x', ['Limits', 'k', 1, 10]],
    ['At', 'x', 1],
  ],
  [
    ['Integrate', ['Multiply', 'a', 't'], 't'],
    ['a', 2],
  ],
  ['e^{x}', 'x(1)'],
  [
    ['Equal', 'x', 'y'],
    ['And', 'x', 'y'],
  ],
  [
    ['Less', 'x', 1],
    ['At', 'x', 2],
  ],
  [
    ['Abs', 'z'],
    ['Not', 'z'],
  ],
  ['h(1)+h(2)', '2h'],
  [
    ['Tuple', 'x', 'y'],
    ['Add', 'x', 1],
  ],
  ['q(2q)', 'q(3)'],
  [
    ['Factorial', 'n'],
    ['At', 'n', 1],
  ],
  [
    ['GCD', 'a', 'b'],
    ['And', 'a', 'b'],
  ],
  ['pq', 'p(q)'],
  [
    ['List', 'x', 'y'],
    ['Multiply', 'x', ['List', 1, 2]],
  ],
  ['\\frac{tP}{P_1-1}', 'P+1'],
  [
    ['Function', ['Add', 'x', 'y'], 'x'],
    ['y', 2],
  ],
];

describe('THE RESULT OF A BOXING DOES NOT DEPEND ON THE ORDER', () => {
  test.each(
    PAIRS.map(([a, b]) => [JSON.stringify(a), JSON.stringify(b), a, b])
  )('%s and %s', (_a, _b, a, b) => {
    const first = engine();
    const a1 = box(first, a as Input);
    const b1 = box(first, b as Input);
    const second = engine();
    const b2 = box(second, b as Input);
    const a2 = box(second, a as Input);
    expect(a1.json).toEqual(a2.json);
    expect(b1.json).toEqual(b2.json);
    const names = [
      ...new Set([...a1.unknowns, ...b1.unknowns, ...a2.unknowns]),
    ].sort();
    expect(names.map((n) => [n, typeOf(a1, n), typeOf(b1, n)])).toEqual(
      names.map((n) => [n, typeOf(a2, n), typeOf(b2, n)])
    );
  });
});

// A bare call head after a call of the same free name: the second head is a
// raw symbol, and the reading of the head through a power of its argument
// list reads its canonical occurrence, which holds the `function` reading the
// first call wrote in the unit. A head that the expression uses as a factor
// (`x(x)`, whose argument refers to the head) stays a product.
describe('A CALL HEAD AFTER A CALL OF THE SAME FREE NAME', () => {
  test.each([
    ['g(x)g(x)^{-1}', ['Multiply', ['g', 'x'], ['Power', ['g', 'x'], -1]]],
    [
      'g(x)^2g(x)^{-1}',
      ['Multiply', ['Power', ['g', 'x'], 2], ['Power', ['g', 'x'], -1]],
    ],
    [
      'f(x)^{-1}f(x)^{-1}',
      ['Multiply', ['Power', ['f', 'x'], -1], ['Power', ['f', 'x'], -1]],
    ],
    ['2x(x)^{-1}', ['Multiply', 2, 'x', ['Divide', 1, 'x']]],
    ['x(x)x(x)^{-1}', ['Multiply', 'x', 'x', 'x', ['Divide', 1, 'x']]],
  ])('%s', (latex, expected) => {
    expect(engine().parse(latex).json).toEqual(expected);
  });
});
