import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  arbitraryIntegers,
  hasArbitraryConstant,
  replaceArbitraryConstants,
  withArbitraryIndexes,
} from '../../src/compute-engine/boxed-expression/arbitrary-constants';
import { isLibraryOperator } from '../../src/compute-engine/library-shadowing';
import type { MathJsonExpression } from '../../src/math-json/types';

// `ArbitraryConstant(k)` is any number, `ArbitraryInteger(k)` any integer:
// the constants of a result of `Solve`, `DSolve` or `RSolve`
// (`docs/plans/2026-11-12-arbitrary-constants-spec.md`; the row numbers are
// those of its section 3).

const ce = new ComputeEngine();

const C = (k: MathJsonExpression): MathJsonExpression => [
  'ArbitraryConstant',
  k,
];
const Z = (k: MathJsonExpression): MathJsonExpression => ['ArbitraryInteger', k];

describe('THE OPERATORS', () => {
  test('row 5: C(1) − C(1) simplifies to 0', () => {
    expect(ce.box(['Subtract', C(1), C(1)]).simplify().json).toBe(0);
  });

  test('row 6: C(1) − C(2) stays', () => {
    const r = ce.box(['Subtract', C(1), C(2)]).simplify();
    expect(r.has('x')).toBe(false);
    expect(r.isSame(0)).toBe(false);
    expect(hasArbitraryConstant(r)).toBe(true);
  });

  test('row 7: the same index is the same value, two indexes are not decided', () => {
    expect(ce.box(C(1)).isEqual(ce.box(C(2)))).toBeUndefined();
    expect(ce.box(C(1)).isEqual(ce.box(C(1)))).toBe(true);
  });

  test('row 8: D(C(1)·x + C(2), x) is C(1)', () => {
    const r = ce
      .box(['D', ['Add', ['Multiply', C(1), 'x'], C(2)], 'x'])
      .evaluate();
    expect(r.json).toEqual(C(1));
  });

  test('row 9: Integrate(C(1)·x, x) is ½·C(1)·x²', () => {
    const r = ce.box(['Integrate', ['Multiply', C(1), 'x'], 'x']).evaluate();
    expect(
      r.isSame(
        ce.box(['Multiply', ['Rational', 1, 2], C(1), ['Power', 'x', 2]])
      )
    ).toBe(true);
  });

  test('row 10: sin(π·Z(1)) simplifies to 0', () => {
    expect(ce.box(['Sin', ['Multiply', 'Pi', Z(1)]]).simplify().json).toBe(0);
  });

  test('row 11: a replacement gives the constant a value', () => {
    const family = ce.box(['Multiply', 'Pi', Z(1)]);
    const r = family.replace(
      { match: ce.box(Z(1)), replace: ce.number(3) },
      { recursive: true }
    );
    expect(r?.evaluate().isSame(ce.box(['Multiply', 3, 'Pi']))).toBe(true);
  });

  test('row 12: a constant is not an unknown', () => {
    expect(ce.box(['Multiply', 'x', Z(1)]).unknowns).toEqual(['x']);
    expect(ce.box(['Multiply', 'x', Z(1)]).freeVariables).toEqual(['x']);
    expect(ce.box(['Add', C(1), Z(2)]).symbols).toEqual([]);
  });

  test('row 13: a compilation of a constant declines', () => {
    const result = compile(ce.box(['Add', ['Multiply', 'Pi', Z(1)], 1]));
    expect(result.success).toBe(false);
    expect(result.unsupported).toEqual(['ArbitraryInteger']);
  });

  test('no value: evaluate() and N() keep the call', () => {
    for (const x of [C(1), Z(1)]) {
      expect(ce.box(x).evaluate().json).toEqual(x);
      expect(ce.box(x).N().json).toEqual(x);
      expect(ce.box(x).isConstant).toBe(true);
      expect(ce.box(x).isPure).toBe(true);
    }
    expect(ce.box(C(1)).type.toString()).toBe('number');
    expect(ce.box(Z(1)).type.toString()).toBe('integer');
  });

  test('the index is folded: Z(1 + 1) is Z(2)', () => {
    const r = ce.box(['ArbitraryInteger', ['Add', 1, 1]]);
    expect(r.isValid).toBe(true);
    expect(r.json).toEqual(Z(2));
  });

  test.each([
    ['Z(0)', ['ArbitraryInteger', 0]],
    ['Z(-1)', ['ArbitraryInteger', -1]],
    ['Z(1.5)', ['ArbitraryInteger', 1.5]],
    ['Z(x)', ['ArbitraryInteger', 'x']],
    ['Z()', ['ArbitraryInteger']],
    ['Z(1, 2)', ['ArbitraryInteger', 1, 2]],
    ['C(0)', ['ArbitraryConstant', 0]],
    ['C(x)', ['ArbitraryConstant', 'x']],
    ['C()', ['ArbitraryConstant']],
  ] as [string, MathJsonExpression][])(
    'row 20: %s is an error',
    (_, json) => {
      expect(ce.box(json).isValid).toBe(false);
    }
  );

  test('hasArbitraryConstant()', () => {
    expect(hasArbitraryConstant(ce.box(['Add', 'x', 1]))).toBe(false);
    expect(hasArbitraryConstant(ce.box(['Add', 'x', Z(1)]))).toBe(true);
    expect(hasArbitraryConstant(ce.box(['Sin', ['Multiply', 2, C(3)]]))).toBe(
      true
    );
    expect(hasArbitraryConstant(ce.symbol('c_1'))).toBe(false);
  });
});

describe('PRINTING AND READING', () => {
  test('MathJSON round trip', () => {
    const e = ce.box(['Add', ['Multiply', 'Pi', Z(1)], C(2)]);
    expect(ce.box(e.json).isSame(e)).toBe(true);
  });

  test('LaTeX: a call prints inside \\constant', () => {
    expect(ce.box(C(1)).latex).toBe('\\constant{c_{1}}');
    expect(ce.box(Z(12)).latex).toBe('\\constant{n_{12}}');
    expect(ce.box(['Multiply', 'Pi', Z(1)]).latex).toBe('\\pi\\constant{n_{1}}');
  });

  test('LaTeX round trip', () => {
    const e = ce.box(['Add', ['Multiply', 'Pi', Z(1)], C(2)]);
    expect(ce.parse(e.latex).isSame(e)).toBe(true);
  });

  test.each([
    ['\\constant{c_{1}}', C(1)],
    ['\\constant{n_{1}}', Z(1)],
    ['\\constant{n_{12}}', Z(12)],
    ['\\constant{c_1}', C(1)],
    ['\\constant{ c _ { 3 } }', C(3)],
  ] as [string, MathJsonExpression][])('LaTeX: %s parses', (latex, json) => {
    expect(ce.parse(latex).json).toEqual(json);
  });

  test.each([
    '\\constant{x}',
    '\\constant{c_{0}}',
    '\\constant{c_{01}}',
    '\\constant{c_{x}}',
    '\\constant{t_{1}}',
    '\\constant{}',
  ])('LaTeX: %s is an error', (latex) => {
    expect(ce.parse(latex).isValid).toBe(false);
  });

  test('LaTeX: without the command, c_1 is a symbol', () => {
    expect(ce.parse('c_1').json).toBe('c_1');
    expect(ce.parse('n_1').json).toBe('n_1');
  });
});

// A constant in the input of a solve: the answer is what a free symbol in
// its place gives, or the solve stays undecided. It is never `[]`, and no
// root is dropped (the table of section 12 of the spec).
describe('A CONSTANT IN THE INPUT OF A SOLVE', () => {
  const engine = new ComputeEngine();
  engine.declare('a', 'number');
  engine.declare('m', 'integer');

  /** Replace `C(k)` by `a` and `Z(k)` by `m`. */
  const withSymbols = (x: MathJsonExpression): MathJsonExpression =>
    Array.isArray(x)
      ? x[0] === 'ArbitraryConstant'
        ? 'a'
        : x[0] === 'ArbitraryInteger'
          ? 'm'
          : (x.map(withSymbols) as MathJsonExpression)
      : x;

  test.each([
    ['sin x = C(1)', ['Equal', ['Sin', 'x'], C(1)]],
    ['√x = C(1)', ['Equal', ['Sqrt', 'x'], C(1)]],
    ['C(1)·sin x = 1', ['Equal', ['Multiply', C(1), ['Sin', 'x']], 1]],
    ['sin x = Z(1)', ['Equal', ['Sin', 'x'], Z(1)]],
    [
      'cos x = cos(π·Z(1))',
      ['Equal', ['Cos', 'x'], ['Cos', ['Multiply', 'Pi', Z(1)]]],
    ],
    [
      '(x − 1)·C(1)^x = 0',
      ['Equal', ['Multiply', ['Subtract', 'x', 1], ['Power', C(1), 'x']], 0],
    ],
    [
      '(x − 1)(x − C(1)) = 0',
      [
        'Equal',
        ['Multiply', ['Subtract', 'x', 1], ['Subtract', 'x', C(1)]],
        0,
      ],
    ],
    [
      '[x² = 4, x ≠ Z(1)]',
      ['List', ['Equal', ['Power', 'x', 2], 4], ['NotEqual', 'x', Z(1)]],
    ],
    ['x + C(1) = x', ['Equal', ['Add', 'x', C(1)], 'x']],
  ] as [string, MathJsonExpression][])('%s', (_, equation) => {
    const withConstant = engine.box(['Solve', equation, 'x']).evaluate();
    const withSymbol = engine
      .box(['Solve', withSymbols(equation), 'x'])
      .evaluate();
    if (withSymbol.operator === 'Solve')
      expect(withConstant.operator).toBe('Solve');
    else {
      expect(withConstant.operator).toBe('List');
      expect(withConstant.nops).toBe(withSymbol.nops);
    }
  });

  test.each([
    ['C', C(1)],
    ['Z', Z(1)],
  ] as [string, MathJsonExpression][])(
    'row 19: Solve(x = %s(1), x ∈ 1..5) is not decided as []',
    (_, k) => {
      const r = engine
        .box(['Solve', ['Equal', 'x', k], ['Element', 'x', ['Range', 1, 5]]])
        .evaluate();
      const s = engine
        .box([
          'Solve',
          ['Equal', 'x', withSymbols(k)],
          ['Element', 'x', ['Range', 1, 5]],
        ])
        .evaluate();
      expect(r.operator === 'List' && r.nops === 0).toBe(false);
      expect(r.operator).toBe(s.operator);
    }
  );

  test('row 21: a constant is a generic real parameter', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    const r = e.box(['Solve', ['Equal', 'x', ['Add', C(1), 1]], 'x']).evaluate();
    expect(r.isSame(e.box(['List', ['Add', C(1), 1]]))).toBe(true);
  });
});

describe('THE INDEXES OF ONE SOLVE', () => {
  const family: MathJsonExpression = [
    'List',
    ['Multiply', 'Pi', ['ArbitraryInteger', 1]],
  ];
  const solveSin = (engine: ComputeEngine) =>
    engine.box(['Solve', ['Equal', ['Sin', 'x'], 0], 'x']).evaluate();

  test('row 1: the parameter of a family is ArbitraryInteger(1), nothing is declared', () => {
    const engine = new ComputeEngine();
    expect(solveSin(engine).json).toEqual(family);
    for (const name of ['t', 't_1', 'c_1', 'c_2'])
      expect(engine.lookupDefinition(name)).toBeUndefined();
    // `t` stays free for the user.
    expect(() => engine.assign('t', 0.5)).not.toThrow();
  });

  test('row 2 and acceptance 3: a use of `t` or `c_1` before the solve changes nothing', () => {
    const engine = new ComputeEngine();
    engine.parse('t + 1');
    engine.parse('t + c_1');
    expect(solveSin(engine).json).toEqual(family);
  });

  test('acceptance 2: the definitions of the user are unchanged', () => {
    const engine = new ComputeEngine();
    engine.declare('t', 'integer');
    engine.assign('c_1', 2);
    expect(solveSin(engine).json).toEqual(family);
    expect(engine.box('t').type.toString()).toBe('integer');
    expect(engine.box('c_1').evaluate().json).toBe(2);
  });

  test('row 14: a second solve whose input holds Z(1) takes Z(2)', () => {
    const r = ce
      .box([
        'Solve',
        ['Equal', ['Sin', ['Subtract', 'x', ['Multiply', 'Pi', Z(1)]]], 0],
        'x',
      ])
      .evaluate();
    const json = JSON.stringify(r.json);
    expect(json).toContain('["ArbitraryInteger",1]');
    expect(json).toContain('["ArbitraryInteger",2]');
  });

  test('row 15: two results of the same solve use the same index', () => {
    const engine = new ComputeEngine();
    const r1 = solveSin(engine);
    const r2 = solveSin(engine);
    expect(r1.op1.sub(r2.op1).simplify().json).toBe(0);
  });

  test('row 16: a stored value that holds Z(1) is in the input', () => {
    const engine = new ComputeEngine();
    engine.assign('a', engine.box(['Multiply', 'Pi', Z(1)]));
    const r = engine
      .box(['Solve', ['Equal', ['Sin', ['Subtract', 'x', 'a']], 0], 'x'])
      .evaluate();
    expect(JSON.stringify(r.json)).toContain('["ArbitraryInteger",2]');
  });

  test('a constant that occurs only in a condition is counted', () => {
    const r = ce
      .box([
        'Solve',
        ['Equal', ['Sin', 'x'], 0],
        ['Element', 'x', 'RealNumbers', ['NotEqual', 'x', Z(1)]],
      ])
      .evaluate();
    // A side condition cannot remove the members of a family: no answer, or
    // a family whose parameter is not Z(1).
    if (r.operator === 'List')
      expect(JSON.stringify(r.json)).not.toContain(
        '["Multiply","Pi",["ArbitraryInteger",1]]'
      );
  });

  test('the free parameter of an identity is ArbitraryConstant(1)', () => {
    expect(ce.box(['Solve', ['Equal', 'x', 'x'], 'x']).evaluate().json).toEqual([
      'List',
      C(1),
    ]);
  });

  test('acceptance 5: a list of alternative families shares one parameter', () => {
    const r = ce
      .box(['Solve', ['Equal', ['Sin', 'x'], ['Rational', 1, 2]], 'x'])
      .evaluate();
    expect(r.nops).toBe(2);
    const json = JSON.stringify(r.json);
    expect(json).toContain('["ArbitraryInteger",1]');
    expect(json).not.toContain('["ArbitraryInteger",2]');
  });

  test('acceptance 5: a solution with two independent parameters uses two indexes', () => {
    const r = ce
      .box([
        'Solve',
        ['Equal', ['Add', 'x', 'y', 'z'], 0],
        ['Element', 'x', 'Integers'],
        ['Element', 'y', 'Integers'],
        ['Element', 'z', 'Integers'],
      ])
      .evaluate();
    const json = JSON.stringify(r.json);
    expect(json).toContain('["ArbitraryInteger",1]');
    expect(json).toContain('["ArbitraryInteger",2]');
    expect(json).not.toContain('["ArbitraryInteger",3]');
  });

  test('acceptance 4: the MathJSON of a result boxes to the same result', () => {
    for (const r of [
      solveSin(ce),
      ce.box(['Solve', ['Equal', 'x', 'x'], 'x']).evaluate(),
    ])
      expect(ce.box(r.json).isSame(r)).toBe(true);
  });

  test('an unknown with a value: the value is not in the input', () => {
    const engine = new ComputeEngine();
    engine.assign('x', engine.box(Z(1)));
    expect(solveSin(engine).json).toEqual(family);
  });

  test('rule 4: a strategy that takes an index and fails gives it back', () => {
    const engine = new ComputeEngine();
    const r = withArbitraryIndexes(engine, [], () => {
      arbitraryIntegers(engine, undefined, 1); // a strategy that fails
      const [z] = arbitraryIntegers(engine, undefined, 1);
      return engine.function('Multiply', [engine.symbol('Pi'), z]);
    });
    expect(r.json).toEqual(['Multiply', 'Pi', Z(1)]);
  });

  test('rule 4: an index of the input keeps its value, a gap after it is closed', () => {
    const engine = new ComputeEngine();
    const input = engine.box(Z(1));
    const r = withArbitraryIndexes(engine, [input], () => {
      arbitraryIntegers(engine, undefined, 1); // a strategy that fails: Z(2)
      const [z] = arbitraryIntegers(engine, undefined, 1); // Z(3)
      return engine.function('List', [input, z]);
    });
    expect(r.json).toEqual(['List', Z(1), Z(2)]);
  });

  test('a function whose value holds Z(1): the parameter of the family is not Z(1)', () => {
    // The scan of the input does not read the body of `f`; the call is
    // evaluated during the solve, and the result holds Z(1).
    const engine = new ComputeEngine();
    engine.assign('f', engine.box(['Function', Z(1)]));
    const r = engine
      .box(['Solve', ['Equal', ['Sin', ['Subtract', 'x', ['f']]], 0], 'x'])
      .evaluate();
    expect(r.operator).toBe('List');
    for (const root of r.ops!) {
      const json = JSON.stringify(root.json);
      expect(json).toContain('["ArbitraryInteger",1]');
      expect(json).toContain('["ArbitraryInteger",2]');
    }
  });

  test('a coefficient whose name is shadowed where the solve runs', () => {
    // The equation reads the `a` of the outer scope, whose value holds Z(1);
    // the `a` of the scope of the solve has no value.
    const engine = new ComputeEngine();
    engine.assign('a', engine.box(['Multiply', 'Pi', Z(1)]));
    const eq = engine.box(['Equal', ['Sin', ['Subtract', 'x', 'a']], 0]);
    engine.pushScope();
    try {
      engine.declare('a', 'real');
      const r = engine.function('Solve', [eq, engine.symbol('x')]).evaluate();
      expect(r.operator).toBe('List');
      const json = JSON.stringify(r.json);
      expect(json).toContain('["ArbitraryInteger",1]');
      expect(json).toContain('["ArbitraryInteger",2]');
    } finally {
      engine.popScope();
    }
  });

  test('the bound of a clause reads the enclosing name: its value is used', () => {
    // In `Sum(1, Limits(n, 1, n))`, the upper bound is the enclosing `n`.
    const engine = new ComputeEngine();
    engine.assign('n', engine.box(Z(1)));
    const sum = engine.box(['Sum', 1, ['Limits', 'n', 1, 'n']]);
    const r = withArbitraryIndexes(engine, [], () => {
      const [z] = arbitraryIntegers(engine, undefined, 1);
      return engine.function('List', [sum, z]);
    });
    expect(r.json).toEqual(['List', ['Sum', 1, ['Limits', 'n', 1, 'n']], Z(2)]);
  });

  test('a dictionary in the result: its values are read', () => {
    const engine = new ComputeEngine();
    const dict = engine.box(['Dictionary', ['Tuple', "'k'", Z(1)]]);
    expect(hasArbitraryConstant(dict)).toBe(true);
    expect(
      replaceArbitraryConstants(dict, () => engine.number(5)).get('k')?.json
    ).toBe(5);
    const r = withArbitraryIndexes(engine, [], () => {
      const [z] = arbitraryIntegers(engine, undefined, 1);
      return engine.function('List', [dict, z]);
    });
    expect(r.json).toEqual([
      'List',
      ['Dictionary', ['KeyValuePair', { str: 'k' }, Z(1)]],
      Z(2),
    ]);
  });

  test('a stored dictionary that holds Z(1) is in the input', () => {
    const engine = new ComputeEngine();
    engine.assign('d', engine.box(['Dictionary', ['Tuple', "'k'", Z(1)]]));
    const r = engine
      .box([
        'Solve',
        ['Equal', ['Sin', ['Subtract', 'x', ['At', 'd', "'k'"]]], 0],
        'x',
      ])
      .evaluate();
    const json = JSON.stringify(r.json);
    expect(json).toContain('["ArbitraryInteger",1]');
    expect(json).toContain('["ArbitraryInteger",2]');
  });

  test('expr.solve() gives the constants too', () => {
    const roots = ce
      .box(['Equal', ['Add', 'x', 1], ['Add', 'x', 1]])
      .solve('x');
    expect(roots?.map((r) => (r as any).json)).toEqual([C(1)]);
  });

  test('expr.solve() reads an iterator of unknowns once', () => {
    const identity = ce.box(['Equal', ['Add', 'x', 1], ['Add', 'x', 1]]);
    expect(identity.solve(['x'].values())?.map((r) => (r as any).json)).toEqual(
      [C(1)]
    );
    const square = ce.box(['Equal', ['Power', 'x', 2], 4]);
    expect(square.solve(['x'].values())?.map((r) => (r as any).json)).toEqual(
      square.solve('x')?.map((r) => (r as any).json)
    );
  });
});

// During an operation, a new constant has a provisional index (a negative
// integer); the final index is decided from the result when the outermost
// operation ends. No provisional index leaves an operation.
describe('PROVISIONAL INDEXES', () => {
  /** The operands of the calls of `ArbitraryConstant` and
   * `ArbitraryInteger` that are not an index k ≥ 1. */
  const provisional = (x: unknown): unknown[] => {
    const out: unknown[] = [];
    const walk = (y: unknown): void => {
      if (Array.isArray(y)) {
        if (
          (y[0] === 'ArbitraryConstant' || y[0] === 'ArbitraryInteger') &&
          !(typeof y[1] === 'number' && y[1] >= 1)
        )
          out.push(y[1]);
        y.forEach(walk);
      } else if (typeof y === 'object' && y !== null)
        Object.values(y).forEach(walk);
    };
    walk(x);
    return out;
  };
  const sinFamily: MathJsonExpression = ['Equal', ['Sin', 'x'], 0];

  test('inside an operation, a new constant is provisional and not equal to a real one', () => {
    const engine = new ComputeEngine();
    let inside: MathJsonExpression | undefined;
    withArbitraryIndexes(engine, [], () => {
      const [z] = arbitraryIntegers(engine, undefined, 1);
      inside = z.json;
      expect(z.isValid).toBe(true);
      expect(z.type.toString()).toBe('integer');
      expect(hasArbitraryConstant(z)).toBe(true);
      expect(z.isSame(engine.box(Z(1)))).toBe(false);
      // A call of the same index boxed again inside the operation is valid.
      expect(engine.box(z.json).isSame(z)).toBe(true);
      return z;
    });
    expect(provisional(inside)).toHaveLength(1);
    // Outside the operation, the provisional call is an error.
    expect(engine.box(inside!).isValid).toBe(false);
  });

  test('a result produced by a nested solve is numbered by the outer operation', () => {
    const engine = new ComputeEngine();
    let nested: MathJsonExpression | undefined;
    const r = withArbitraryIndexes(engine, [engine.box(Z(1))], () => {
      const inner = engine.box(['Solve', sinFamily, 'x']).evaluate();
      nested = inner.json;
      return inner;
    });
    // The nested solve shares the operation: its parameter is provisional.
    expect(provisional(nested)).toHaveLength(1);
    expect(r.json).toEqual(['List', ['Multiply', 'Pi', Z(2)]]);
  });

  test('an unevaluated result that holds a provisional constant is numbered', () => {
    const engine = new ComputeEngine();
    const r = withArbitraryIndexes(engine, [], () => {
      const [z] = arbitraryIntegers(engine, undefined, 1);
      // The solver has no answer: the `Solve` is returned unevaluated.
      return engine
        .box([
          'Solve',
          ['Equal', ['Gamma', 'x'], ['Add', 'x', z.json]],
          'x',
        ])
        .evaluate();
    });
    expect(r.json).toEqual([
      'Solve',
      ['Equal', ['Gamma', 'x'], ['Add', 'x', Z(1)]],
      'x',
    ]);
  });

  test('a provisional index that leaves its operation is an error (development check)', () => {
    const engine = new ComputeEngine();
    expect(() =>
      withArbitraryIndexes(
        engine,
        [],
        () => ({ value: arbitraryIntegers(engine, undefined, 1)[0] }),
        // A map that does not visit the field: the index is not replaced.
        { map: (result) => result }
      )
    ).toThrow(/provisional index/);
  });

  test('no entry returns a provisional index', () => {
    const engine = new ComputeEngine();
    const y = ['y', 'x'] as MathJsonExpression;
    const a = (n: MathJsonExpression): MathJsonExpression => ['a', n];
    const results: unknown[] = [
      engine.box(['Solve', sinFamily, 'x']).evaluate().json,
      engine.box(['Solve', ['Equal', 'x', 'x'], 'x']).evaluate().json,
      engine
        .box(['Solve', ['Equal', ['Add', 'x', 'y'], 1], ['Element', 'x', 'Integers'], ['Element', 'y', 'Integers']])
        .evaluate().json,
      engine.box(sinFamily).solve('x')?.map((r) => (r as any).json),
      engine.box(['Equal', ['Add', 'x', 1], ['Add', 'x', 1]]).solve('x')?.map((r) => (r as any).json),
      engine.box(['DSolve', ['Equal', ['D', ['D', y, 'x'], 'x'], y], 'y', 'x']).evaluate().json,
      engine
        .box(['RSolve', ['Equal', a(['Add', 'n', 1]), ['Multiply', 2, a('n')]], 'a', 'n'])
        .evaluate().json,
    ];
    const explanation = engine
      .box(['Equal', ['Add', 'x', 1], ['Add', 'x', 1]])
      .explain('solve', { variable: 'x' });
    results.push(
      explanation.result.json,
      explanation.initial.json,
      explanation.steps.map((step) => step.value.json)
    );
    for (const r of results) expect(provisional(r)).toEqual([]);
    expect(explanation.result.json).toEqual(['List', C(1)]);
  });
});

describe('A REPLACEMENT KEEPS THE BINDINGS', () => {
  test('a constant in the body of a Sum: the Sum keeps its scope and its index', () => {
    const sum = ce.box(['Sum', ['Multiply', C(3), 'k'], ['Limits', 'k', 1, 3]]);
    const r = replaceArbitraryConstants(sum, () => ce.number(2));
    expect(r.json).toEqual(['Sum', ['Multiply', 2, 'k'], ['Limits', 'k', 1, 3]]);
    expect(r.localScope).toBe(sum.localScope);
    expect(r.evaluate().json).toBe(12);
  });

  test('a constant in a call of a user function: the call still calls it', () => {
    const engine = new ComputeEngine();
    engine.declare('g', {
      signature: '(number) -> number',
      evaluate: ([x]) => x.mul(engine.number(10)),
    });
    const call = engine.box(['g', C(1)]);
    const r = replaceArbitraryConstants(call, () => engine.number(2));
    expect(r.operatorDefinition).toBe(call.operatorDefinition);
    expect(r.evaluate().json).toBe(20);
    // Rebuilt in a scope that declares another `g`: the call keeps the `g`
    // it was bound to.
    engine.pushScope();
    engine.declare('g', {
      signature: '(number) -> number',
      evaluate: ([x]) => x.mul(engine.number(100)),
    });
    const inner = replaceArbitraryConstants(call, () => engine.number(2));
    expect(inner.operatorDefinition).toBe(call.operatorDefinition);
    expect(inner.evaluate().json).toBe(20);
    engine.popScope();
  });
});

describe('A USER OPERATOR OF THE SAME NAME', () => {
  // The user operator is declared in a nested scope (a declaration at the
  // top level is accepted as well).
  test('a user ArbitraryInteger is not a constant: the solve does not renumber it', () => {
    const engine = new ComputeEngine();
    engine.pushScope();
    engine.declare('ArbitraryInteger', '(integer) -> real');
    const user = engine.box(Z(1));
    expect(isLibraryOperator(user)).toBe(false);
    expect(hasArbitraryConstant(user)).toBe(false);
    const r = engine
      .box([
        'Solve',
        ['Equal', ['Sin', ['Subtract', 'x', Z(1)]], 0],
        'x',
      ])
      .evaluate();
    const calls: Array<[unknown, boolean]> = [];
    const walk = (x: any) => {
      if (x.operator === 'ArbitraryInteger')
        calls.push([x.op1.json, isLibraryOperator(x)]);
      for (const op of x.ops ?? []) walk(op);
    };
    walk(r);
    // The parameter of the family is the library ArbitraryInteger(1): the
    // user call ArbitraryInteger(1) does not use the index 1, and it keeps
    // its operand and its binding.
    expect(calls.filter(([, library]) => library).map(([k]) => k)).toEqual([
      1, 1,
    ]);
    expect(calls.filter(([, library]) => !library).map(([k]) => k)).toEqual([
      1, 1,
    ]);
    engine.popScope();
  });
});

describe('THE CONSTANTS OF INTEGRATION', () => {
  const y = ['y', 'x'] as MathJsonExpression;
  const dsolve = (engine: ComputeEngine, equation: MathJsonExpression) =>
    engine.box(['DSolve', equation, 'y', 'x']).evaluate();

  test('row 3: y′ = y is C(1)·eˣ', () => {
    const r = dsolve(ce, ['Equal', ['D', y, 'x'], y]);
    expect(r.json).toEqual([
      'List',
      ['Equal', y, ['Multiply', C(1), ['Power', 'ExponentialE', 'x']]],
    ]);
  });

  test('row 4: y″ = y has the indexes 1 and 2', () => {
    const json = JSON.stringify(
      dsolve(ce, ['Equal', ['D', ['D', y, 'x'], 'x'], y]).json
    );
    expect(json).toContain('["ArbitraryConstant",1]');
    expect(json).toContain('["ArbitraryConstant",2]');
    expect(json).not.toContain('c_');
  });

  test('row 17: a stored value that holds C(1) is in the input', () => {
    const engine = new ComputeEngine();
    engine.assign('b', engine.box(C(1)));
    const r = dsolve(engine, ['Equal', ['D', y, 'x'], ['Multiply', 'b', y]]);
    const json = JSON.stringify(r.json);
    expect(json).toContain('["ArbitraryConstant",2]');
    expect(json).not.toContain('["ArbitraryConstant",1]');
  });

  test('a constant in the value of a function body is not a constant of integration', () => {
    // The scan of the input does not read the body of `f`: the result holds
    // C(1) from it, and the constants of integration take 2 and 3.
    const engine = new ComputeEngine();
    engine.assign('f', engine.box(['Function', C(1)]));
    const z = ['z', 'x'] as MathJsonExpression;
    const r = engine
      .box([
        'DSolve',
        [
          'List',
          ['Equal', ['D', y, 'x'], ['Multiply', ['f'], y]],
          ['Equal', ['D', z, 'x'], 0],
        ],
        ['List', 'y', 'z'],
        'x',
      ])
      .evaluate();
    expect(r.json).toEqual([
      'List',
      [
        'Equal',
        y,
        [
          'Multiply',
          C(2),
          ['Power', 'ExponentialE', ['Multiply', 'x', C(1)]],
        ],
      ],
      ['Equal', z, C(3)],
    ]);
  });

  test('row 18: initial conditions leave no constant', () => {
    const r = dsolve(ce, [
      'List',
      ['Equal', ['D', y, 'x'], y],
      ['Equal', ['y', 0], 2],
    ]);
    expect(r.json).toEqual([
      'List',
      ['Equal', y, ['Multiply', 2, ['Power', 'ExponentialE', 'x']]],
    ]);
    const a = (n: MathJsonExpression): MathJsonExpression => ['a', n];
    const fib = ce
      .box([
        'RSolve',
        [
          'List',
          ['Equal', a(['Add', 'n', 2]), ['Add', a(['Add', 'n', 1]), a('n')]],
          ['Equal', a(0), 0],
          ['Equal', a(1), 1],
        ],
        'a',
        'n',
      ])
      .evaluate();
    expect(fib.operator).toBe('List');
    expect(JSON.stringify(fib.json)).not.toContain('ArbitraryConstant');
    expect(withValue(fib.op1.op2, 'n', 10)).toBeCloseTo(55, 9);
  });

  test('acceptance 5: y‴ + y = C(1) gives the indexes 2, 3 and 4', () => {
    const r = dsolve(ce, [
      'Equal',
      ['Add', ['D', y, 'x', 'x', 'x'], y],
      C(1),
    ]);
    const json = JSON.stringify(r.json);
    for (const k of [1, 2, 3, 4])
      expect(json).toContain(`["ArbitraryConstant",${k}]`);
    expect(json).not.toContain('["ArbitraryConstant",5]');
  });

  test('acceptance 2: nothing is declared, and a declared c_1 changes nothing', () => {
    const engine = new ComputeEngine();
    dsolve(engine, ['Equal', ['D', y, 'x'], y]);
    for (const name of ['c_1', 'c_2', 't'])
      expect(engine.lookupDefinition(name)).toBeUndefined();
    const declared = new ComputeEngine();
    declared.declare('c_1', 'integer');
    declared.assign('c_2', 5);
    expect(dsolve(declared, ['Equal', ['D', y, 'x'], y]).json).toEqual(
      dsolve(engine, ['Equal', ['D', y, 'x'], y]).json
    );
    expect(declared.box('c_1').type.toString()).toBe('integer');
    expect(declared.box('c_2').evaluate().json).toBe(5);
  });

  test('a name with an inferred definition is not a constant of integration', () => {
    const engine = new ComputeEngine();
    engine.declare('c_1', { type: 'integer', inferred: true });
    expect(dsolve(engine, ['Equal', ['D', ['D', y, 'x'], 'x'], y]).json).toEqual(
      dsolve(new ComputeEngine(), ['Equal', ['D', ['D', y, 'x'], 'x'], y]).json
    );
    expect(engine.box('c_1').type.toString()).toBe('integer');
  });

  test('CE-1253: a parameter of the user named c_1 is not a constant of integration', () => {
    const engine = new ComputeEngine();
    const r = engine
      .parse(
        "\\operatorname{DSolve}(\\left[y''(x)=y(x), y(0)=c_1, y'(0)=0\\right], y, x)"
      )
      .evaluate();
    // y = (c_1/2)·eˣ + (c_1/2)·e⁻ˣ, the same as with `a` for `c_1`
    const withA = engine
      .parse(
        "\\operatorname{DSolve}(\\left[y''(x)=y(x), y(0)=a, y'(0)=0\\right], y, x)"
      )
      .evaluate();
    expect(r.op1.op2.isSame(withA.op1.op2.subs({ a: 'c_1' }))).toBe(true);
    expect(JSON.stringify(r.json)).not.toContain('ArbitraryConstant');
    for (const x of [0, 0.5, 2]) {
      const v = r.op1.op2.subs({ c_1: 3, x }).N().re;
      expect(v).toBeCloseTo(3 * Math.cosh(x), 9);
    }
  });

  test('Interpret of a linear recurrence reads the constants of RSolve', () => {
    const r = ce.box(['Interpret', ce.parse('1+1+2+3+5+8+13+21+34+55').json]);
    expect(r.evaluate().N().re).toBe(143);
  });

  test('an anchor with a constant is not numeric', () => {
    // A numeric anchor starts a search for the upper bound of the sum, which
    // does not end for a constant.
    const r = ce
      .box(['Interpret', ['Add', 1, 1, 2, 3, 5, 8, 'ContinuationPlaceholder', C(1)]])
      .evaluate();
    expect(r.operator).not.toBe('Sum');
  });
});

/** The value of `expr` with `name` replaced by `value`. */
function withValue(
  expr: ReturnType<ComputeEngine['box']>,
  name: string,
  value: number
): number {
  return expr.subs({ [name]: value }).N().re;
}
