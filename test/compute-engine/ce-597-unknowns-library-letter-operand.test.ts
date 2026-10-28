import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import {
  isFunction,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

// ROADMAP CE-597. A letter that names a library operator (`N`, `D`) and is
// used as a value is a variable: `x + N` lists `N` among the unknowns. The
// same holds for an operand that a lazy operator holds at a value position:
// the integrand of `Integrate`, the body of `Sum` and `Product`, and the
// initial value of `Reduce`. There `N` stayed bound to the library operator,
// so `unknowns` left it out (and the body of `Sum` was a type error).

type Route = 'parse' | 'box' | 'function';

function build(
  ce: ComputeEngine,
  route: Route,
  latex: string,
  json: [string, ...unknown[]]
): Expression {
  if (route === 'parse') return ce.parse(latex);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (route === 'box') return ce.box(json as any);
  const [head, ...ops] = json;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ce.function(head, ops as any);
}

const ROUTES: Route[] = ['parse', 'box', 'function'];

describe('CE-597: a library letter at a value operand of a lazy operator', () => {
  describe.each(ROUTES)('route %s', (route) => {
    test.each(['N', 'D'])('integrand `%s`', (letter) => {
      const ce = new ComputeEngine();
      const expr = build(ce, route, `y=\\int_0^1 ${letter}\\,dt`, [
        'Equal',
        'y',
        ['Integrate', letter, ['Limits', 't', 0, 1]],
      ]);
      expect(expr.unknowns).toEqual([letter, 'y'].sort());
      expect(expr.freeVariables).toEqual([letter, 'y'].sort());
    });

    test('initial value of `Reduce`', () => {
      const ce = new ComputeEngine();
      const expr = build(
        ce,
        route,
        'y=x+\\operatorname{Reduce}([1,2],\\operatorname{Add},N)',
        ['Equal', 'y', ['Add', 'x', ['Reduce', ['List', 1, 2], 'Add', 'N']]]
      );
      expect(expr.unknowns).toEqual(['N', 'x', 'y']);
    });

    // The seed `N` is a variable. The reducer operand `N`, applied as a
    // function, resolves to the library `N`: a repaired variable whose type
    // is not a function type is not applicable (`isApplicableDef`,
    // `function-utils.ts`). So `Reduce([1, 2], N, N)` folds with the library
    // `N`, and `N(N(N, 1), 2)` is the seed `N` itself.
    test('`Reduce(L, N, N)` lists `N`', () => {
      const ce = new ComputeEngine();
      const expr = build(ce, route, 'y=x+\\operatorname{Reduce}([1,2],N,N)', [
        'Equal',
        'y',
        ['Add', 'x', ['Reduce', ['List', 1, 2], 'N', 'N']],
      ]);
      expect(expr.unknowns).toEqual(['N', 'x', 'y']);
      expect(expr.evaluate().toString()).toBe('y == N + x');
      ce.assign('N', 5);
      expect(expr.evaluate().toString()).toBe('y == x + 5');
    });

    test.each(['Sum', 'Product'])('body of `%s`', (op) => {
      const ce = new ComputeEngine();
      const latex = op === 'Sum' ? '\\sum_{k=1}^3 N' : '\\prod_{k=1}^3 N';
      const expr = build(ce, route, latex, [op, 'N', ['Limits', 'k', 1, 3]]);
      expect(expr.isValid).toBe(true);
      expect(expr.unknowns).toEqual(['N']);
      expect(expr.evaluate().toString()).toBe(op === 'Sum' ? '3N' : 'N^3');
    });
  });

  test('a library operator at the reducer position is not a free variable', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Reduce', ['List', 1, 2], 'Add']);
    expect(expr.unknowns).toEqual([]);
    expect(expr.references).toEqual([]);
    expect(expr.evaluate().toString()).toBe('3');
  });

  test('the integration variable named `N` stays the variable', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\int_0^1 N\\,dN').evaluate().toString()).toBe('1/2');
    expect(ce.parse('\\sum_{N=1}^3 N').evaluate().toString()).toBe('6');
  });
});

// User decision 2026-10-28: the same holds at every operand whose parameter
// takes any value (`any`, `value`, `expression`, `unknown`): the comparisons,
// the collection literals, the argument of a function with no declared
// signature, the body of a function literal (`Limit`).
const VALUE_POSITIONS: [string, string, [string, ...unknown[]], string][] = [
  ['N = 2', 'N=2', ['Equal', 'N', 2], '"True"'],
  ['N > 2', 'N>2', ['Greater', 'N', 2], '"False"'],
  ['[N, 1]', '[N,1]', ['List', 'N', 1], '[2,1]'],
  ['(N, 1)', '(N,1)', ['Tuple', 'N', 1], '(2, 1)'],
  ['{N, 1}', '\\{N,1\\}', ['Set', 'N', 1], 'Set(1, 2)'],
  ['f(N)', 'f(N)', ['f', 'N'], 'f(2)'],
  [
    'lim N',
    '\\lim_{x\\to 0} N',
    ['Limit', ['Function', ['Block', 'N'], 'x'], 0],
    '2',
  ],
  ['max(N, 2)', '\\max(N,2)', ['Max', 'N', 2], '2'],
];

describe('CE-597: a library letter at an operand that takes any value', () => {
  describe.each(ROUTES)('route %s', (route) => {
    test.each(VALUE_POSITIONS)('%s', (_label, latex, json, withTwo) => {
      const ce = new ComputeEngine();
      const expr = build(ce, route, latex, json);
      expect(expr.unknowns).toEqual(['N']);
      expect(expr.subs({ N: 2 }).evaluate().toString()).toBe(withTwo);
      ce.assign('N', 2);
      expect(expr.unknowns).toEqual([]);
      expect(expr.evaluate().toString()).toBe(withTwo);
      expect(expr.N().toString()).toBe(withTwo);
    });
  });

  // A position that takes a function keeps the operator binding.
  test.each([
    ['Apply(N, x)', ['Apply', 'N', 'x'], ['x']],
    ['N(x)', ['N', 'x'], ['x']],
    ['Derivative(Sin)', ['Derivative', 'Sin'], []],
    ['Map(N, [1, 2])', ['Map', 'N', ['List', 1, 2]], []],
  ] as [string, [string, ...unknown[]], string[]][])(
    'a function operand: %s',
    (_label, json, unknowns) => {
      const ce = new ComputeEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expr = ce.box(json as any);
      expect(expr.unknowns).toEqual(unknowns);
      expect(Object.keys(ce.lookupDefinition('N')!)).toEqual(['operator']);
    }
  );

  test('`\\mathrm{N}(x)` applies `N`', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\mathrm{N}(x)');
    expect(expr.json).toEqual(['N', 'x']);
    expect(expr.unknowns).toEqual(['x']);
  });

  test('a declared function parameter keeps the operator', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(function) -> number');
    const expr = ce.box(['g', 'N']);
    expect(expr.unknowns).toEqual([]);
    expect(Object.keys(ce.lookupDefinition('N')!)).toEqual(['operator']);
  });
});

// The variable declared for a value use of `N` does not hide the library
// operator from a call: `N(2.3)` is still the numeric evaluation, as after
// `x + N` (`isApplicableDef`, `function-utils.ts`).
describe('CE-597: a call of the library operator after a value use', () => {
  test.each([
    ['integrand', '\\int_0^1 N\\,dt'],
    ['Sum body', '\\sum_{k=1}^3 N'],
    ['N = 2', 'N=2'],
    ['[N, 1]', '[N,1]'],
    ['f(N)', 'f(N)'],
  ])('after %s', (_label, latex) => {
    const ce = new ComputeEngine();
    const expr = ce.parse(latex);
    expect(expr.unknowns).toEqual(['N']);
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
    ce.assign('N', 3);
    expect(expr.unknowns).toEqual([]);
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
  });

  test('`D(x^2, x)` after an integrand `D`', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_0^1 D\\,dt');
    expect(expr.unknowns).toEqual(['D']);
    expect(ce.box(['D', ['Power', 'x', 2], 'x']).evaluate().toString()).toBe(
      '2x'
    );
    ce.assign('D', 3);
    expect(expr.evaluate().toString()).toBe('3');
    expect(ce.box(['D', ['Power', 'x', 2], 'x']).evaluate().toString()).toBe(
      '2x'
    );
  });
});

describe('CE-597: evaluate(), N() and subs() agree with unknowns', () => {
  test('integrand `N`, then `N := 3`', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_0^1 N\\,dt');
    expect(expr.unknowns).toEqual(['N']);
    expect(expr.evaluate().toString()).toBe('N');
    ce.assign('N', 3);
    expect(expr.unknowns).toEqual([]);
    expect(expr.evaluate().toString()).toBe('3');
    expect(expr.N().re).toBeCloseTo(3, 10);
  });

  test('integrand `N`, `subs`', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_0^1 N\\,dt');
    expect(expr.subs({ N: 4 }).evaluate().toString()).toBe('4');
  });

  test('initial value of `Reduce`, then `N := 3`', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\operatorname{Reduce}([1,2],\\operatorname{Add},N)'
    );
    expect(expr.evaluate().toString()).toBe('N + 3');
    expect(expr.subs({ N: 4 }).evaluate().toString()).toBe('7');
    ce.assign('N', 3);
    expect(expr.unknowns).toEqual([]);
    expect(expr.evaluate().toString()).toBe('6');
  });

  test('initial value of `Fold`, rewritten to `Reduce`', () => {
    // `Fold(f, x, L)` canonicalizes to `Reduce(L, f, x)`; its seed is a
    // value too (Tycho ledger row 473, which reads Desmos `Fold`).
    const ce = new ComputeEngine();
    const expr = ce.parse(
      'y=x+\\operatorname{Fold}((a,b)\\mapsto a+b,N,[1,2])'
    );
    expect(expr.unknowns).toEqual(['N', 'x', 'y']);
    const fold = ce.box([
      'Fold',
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      'N',
      ['List', 1, 2],
    ]);
    ce.assign('N', 10);
    expect(fold.evaluate().toString()).toBe('13');
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
  });

  test('initial value of `Scan`', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Scan',
      ['List', 1, 2],
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      'N',
    ]);
    expect(expr.unknowns).toEqual(['N']);
    ce.assign('N', 10);
    expect(expr.evaluate().toString()).toBe('[11,13]');
  });

  test('a letter devolved in the body of a binder is not local to it', () => {
    // The shadow is declared outside the scope of `Sum`, so a later
    // assignment reaches it.
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sum_{k=1}^3 N k');
    expect(expr.unknowns).toEqual(['N']);
    ce.assign('N', 2);
    expect(expr.unknowns).toEqual([]);
    expect(expr.evaluate().toString()).toBe('12');
  });

  test('the integrand letter is bound to a value definition', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_0^1 N\\,dt');
    if (!isFunction(expr, 'Integrate')) throw new Error('expected Integrate');
    const n = expr.op1;
    expect(isSymbol(n, 'N')).toBe(true);
    expect(n.valueDefinition).toBeDefined();
    expect(n.operatorDefinition).toBeUndefined();
  });
});

// The repair reads a held operand by its name first, and canonicalizes it
// only when the name resolves to the library operator: canonicalizing a held
// operand to test it bound it, or declared it, in the scope outside the
// construct that binds it (a parameter of a function literal, a local of a
// block).
describe('CE-597: names bound inside the expression are not repaired', () => {
  function globalBinding(ce: ComputeEngine, name: string): unknown {
    return ce.context.lexicalScope.bindings.get(name);
  }

  test('a parameter `N` of a function literal', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('(N) \\mapsto N');
    expect(expr.unknowns).toEqual([]);
    expect(globalBinding(ce, 'N')).toBeUndefined();
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
    const boxed = ce.box(['Function', ['Block', 'N'], 'N']);
    expect(boxed.unknowns).toEqual([]);
    expect(globalBinding(ce, 'N')).toBeUndefined();
  });

  test.each([
    ['Q', ['Block', ['Assign', 'Q', 5], 'Q']],
    ['X', ['Block', ['Declare', 'X', "'integer'"], ['Assign', 'X', 5], 'X']],
    ['Y', ['Function', ['Block', 'Y'], 'Y']],
  ] as [string, [string, ...unknown[]]][])(
    'a block or a literal declares no global `%s`',
    (name, json) => {
      const ce = new ComputeEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ce.box(json as any);
      expect(globalBinding(ce, name)).toBeUndefined();
    }
  );

  test('a block local `N` stays the local', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 'N', "'integer'"],
      ['Assign', 'N', 5],
      'N',
    ]);
    expect(expr.unknowns).toEqual([]);
    expect(expr.evaluate().toString()).toBe('5');
    expect(globalBinding(ce, 'N')).toBeUndefined();
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
  });

  test('a bare `N` statement of a function body is a variable', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\lim_{x\\to 0} N');
    expect(expr.unknowns).toEqual(['N']);
    ce.assign('N', 3);
    expect(expr.evaluate().toString()).toBe('3');
  });
});

describe('CE-597: every operand of a comparison chain is a value', () => {
  test.each([
    [['Equal', 2, 2, 'N']],
    [['Less', 1, 2, 'N']],
    [['LessEqual', 1, 'N', 2, 'N']],
  ] as [[string, ...unknown[]]][])('%j', (json) => {
    const ce = new ComputeEngine();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expr = ce.box(json as any);
    expect(expr.unknowns).toEqual(['N']);
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
  });
});

// `Apply(f, x…)` forwards its arguments to `f`: whether one is a value or a
// function is the business of the parameters of `f`, not of the `any*`
// parameters of `Apply`.
describe('CE-597: the arguments that `Apply` forwards', () => {
  function globalN(ce: ComputeEngine): unknown {
    return ce.context.lexicalScope.bindings.get('N');
  }

  test('a named callee with a function parameter keeps the operator', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(function) -> number');
    for (const head of ['Apply', 'ApplyWhole']) {
      const expr = ce.box([head, 'g', 'N']);
      expect(expr.unknowns).not.toContain('N');
    }
    expect(ce.box(['g', 'N']).unknowns).toEqual([]);
    expect(globalN(ce)).toBeUndefined();
  });

  test('a named callee with a number parameter reads a variable', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> number');
    expect(ce.box(['Apply', 'h', 'N']).unknowns).toEqual(['N']);
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
  });

  test('a literal with a function parameter keeps the operator', () => {
    const ce = new ComputeEngine();
    const typed = ce.box([
      'Apply',
      ['Function', ['f', 2], ['Typed', 'f', "'function'"]],
      'N',
    ]);
    expect(typed.unknowns).toEqual([]);
    expect(typed.evaluate().toString()).toBe('2');
    // An unannotated parameter is typed `unknown` whether the body applies
    // it or not, so it is not read as a value.
    const bare = ce.box(['Apply', ['Function', ['f', 2], 'f'], 'N']);
    expect(bare.unknowns).toEqual([]);
    expect(bare.evaluate().toString()).toBe('2');
    expect(globalN(ce)).toBeUndefined();
  });

  test('a literal with a number parameter reads a variable', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Apply',
      ['Function', ['Add', 'x', 1], ['Typed', 'x', "'number'"]],
      'N',
    ]);
    expect(expr.unknowns).toEqual(['N']);
    ce.assign('N', 4);
    expect(expr.evaluate().toString()).toBe('5');
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
  });
});

// A named user function follows the rule of an inline literal
// (`isAnnotatedValueParameter`): an unannotated parameter is typed `unknown`
// whether the body applies it or not, so the argument `N` stays the library
// operator; an annotated value parameter makes it a variable.
describe('CE-597: the arguments of a named user function', () => {
  test('`g = (f) ↦ f(2)`, then `g(N)` applies the library `N`', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['f', 2], 'f']));
    for (const expr of [ce.box(['g', 'N']), ce.parse('g(N)')]) {
      expect(expr.unknowns).toEqual([]);
      expect(expr.evaluate().toString()).toBe('2');
    }
    expect(ce.context.lexicalScope.bindings.get('N')).toBeUndefined();
  });

  test('`h = (x: number) ↦ x + 1`, then `h(N)` lists `N`', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'h',
      ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', "'number'"]])
    );
    const expr = ce.box(['h', 'N']);
    expect(expr.unknowns).toEqual(['N']);
    ce.assign('N', 4);
    expect(expr.evaluate().toString()).toBe('5');
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
  });
});

// A held operand written in parentheses is read through them: its canonical
// form is the symbol.
describe('CE-597: a parenthesized operand', () => {
  test.each([
    ['box', (ce: ComputeEngine) => ce.box(['Equal', ['Delimiter', 'N'], 2])],
    [
      'box, nested',
      (ce: ComputeEngine) =>
        ce.box(['Equal', ['Delimiter', ['Delimiter', 'N']], 2]),
    ],
    ['parse', (ce: ComputeEngine) => ce.parse('(N)=2')],
  ] as [string, (ce: ComputeEngine) => Expression][])('%s', (_label, make) => {
    const ce = new ComputeEngine();
    const expr = make(ce);
    expect(expr.json).toEqual(['Equal', 'N', 2]);
    expect(expr.unknowns).toEqual(['N']);
    ce.assign('N', 2);
    expect(expr.evaluate().toString()).toBe('"True"');
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
  });
});

describe('CE-597: `IdenticallyEqual` compares values', () => {
  test('`N \\equiv x` lists `N`, as `N = x` does', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('N \\equiv x').unknowns).toEqual(['N', 'x']);
    expect(ce.parse('N = x').unknowns).toEqual(['N', 'x']);
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
  });
});

// The LaTeX parser reads `N(2.3)` as a call or a product from the binding of
// `N`. Once a value use has made `N` a variable typed as a number (`x + N`,
// the element of a list of numbers), the product is the consistent reading
// (user decision 2026-10-28). A variable that is not typed as a number (the
// operand of `N = 2`, of `f(N)`, the coordinate of a tuple) is not, so the
// parser still reads the call of the library `N`.
describe('CE-597: the LaTeX `N(2.3)` after a value use of `N`', () => {
  test.each([
    ['x+N', ['Multiply', 2.3, 'N']],
    ['[N,1]', ['Multiply', 2.3, 'N']],
    ['(N,1)', ['N', 2.3]],
    ['N=2', ['N', 2.3]],
    ['f(N)', ['N', 2.3]],
  ])('after `%s`', (latex, expected) => {
    const ce = new ComputeEngine();
    ce.parse(latex);
    expect(ce.parse('N(2.3)').json).toEqual(expected);
  });
});

describe('CE-597: units and strings', () => {
  test('the newton in a quantity stays the unit', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{QuantityUnit}(5\\,\\mathrm{N})');
    expect(expr.json).toEqual(['QuantityUnit', ['Quantity', 5, 'N']]);
    expect(expr.unknowns).toEqual([]);
    expect(expr.evaluate().toString()).toBe('N');
    expect(ce.parse('5\\,\\mathrm{N}').unknowns).toEqual([]);
  });

  test('`String(N)` reads `N` as a variable', () => {
    // `String` takes any value (user decision 2026-10-28, a value position).
    const ce = new ComputeEngine();
    const expr = ce.box(['String', 'N']);
    expect(expr.unknowns).toEqual(['N']);
    expect(expr.evaluate().toString()).toBe('"N"');
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
  });
});
