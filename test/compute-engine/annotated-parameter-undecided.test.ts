import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const INCOMPATIBLE = "'incompatible-type'";

/** The code of the first `Error` in `json`, or `undefined`. */
function errorCode(json: unknown): string | undefined {
  if (!Array.isArray(json)) return undefined;
  if (json[0] === 'Error')
    return typeof json[1] === 'string' ? json[1] : json[1]?.[1];
  for (const x of json) {
    const code = errorCode(x);
    if (code !== undefined) return code;
  }
  return undefined;
}

/** The value of the Epsil program `source` on a new engine, as MathJSON. */
function run(source: string): unknown {
  return executeEpsil(new ComputeEngine(), source).value.json;
}

/** The value of the Epsil program `source` on a new engine that declares each
 * name of `names` with the type `unknown` and no value, as MathJSON. A later
 * statement of the program assigns it. */
function runWith(names: string[], source: string): unknown {
  const ce = new ComputeEngine();
  for (const name of names) ce.declare(name, 'unknown');
  return executeEpsil(ce, source).value.json;
}

/** The literal `k ↦ 2k` with `k` annotated `integer`, as MathJSON. */
const DOUBLE_INTEGER = [
  'Function',
  ['Multiply', 2, 'k'],
  ['Typed', 'k', "'integer'"],
];

describe('a parameter annotated in the function is checked when a later value decides it', () => {
  test('a function statement gives the error for a later value', () => {
    expect(
      errorCode(
        runWith(
          ['m'],
          'function h(k: integer) { 2*k }\nlet r = g(h(m))\nm = 1.5\nr'
        )
      )
    ).toBe(INCOMPATIBLE);
  });

  test('a function statement gives the value for a later value that fits', () => {
    expect(
      runWith(
        ['m'],
        'function h(k: integer) { 2*k }\nlet r = g(h(m))\nm = 2\nr'
      )
    ).toEqual(['g', 4]);
  });

  test('a literal held by a variable gives the error for a later value', () => {
    expect(
      errorCode(
        runWith(
          ['m'],
          'let h = (k: integer) => 2*k\nlet r = g(h(m))\nm = 1.5\nr'
        )
      )
    ).toBe(INCOMPATIBLE);
  });

  test('a literal applied directly gives the error for a later value', () => {
    expect(
      errorCode(
        runWith(['m'], 'let r = g(((k: integer) => 2*k)(m))\nm = 1.5\nr')
      )
    ).toBe(INCOMPATIBLE);
  });

  test('ce.assign of an annotated literal holds the call', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(DOUBLE_INTEGER as any));
    const held = ce.box(['h', 'm']).evaluate();
    expect(held.json).toEqual(['h', 'm']);
    ce.assign('m', 3);
    expect(held.evaluate().json).toBe(6);
  });

  test('every route keeps the call by its name', async () => {
    const operator = new ComputeEngine();
    executeEpsil(operator, 'function h(k: integer) { 2*k }');
    expect(operator.box(['h', 'm']).evaluate().json).toEqual(['h', 'm']);
    expect(operator.box(['h', 'm']).N().json).toEqual(['h', 'm']);
    expect((await operator.box(['h', 'm']).evaluateAsync()).json).toEqual([
      'h',
      'm',
    ]);

    const value = new ComputeEngine();
    executeEpsil(value, 'let h = (k: integer) => 2*k');
    expect(value.box(['h', 'm']).evaluate().json).toEqual(['h', 'm']);
    expect(value.box(['h', 'm']).N().json).toEqual(['h', 'm']);
    expect((await value.box(['h', 'm']).evaluateAsync()).json).toEqual([
      'h',
      'm',
    ]);
  });

  test('an element of a list stays, by the name of the function', () => {
    const list = ['List', ['h', 'm'], 2];
    expect(
      run('function h(k: integer) { 2*k }\nlet m\nh([m, 1])')
    ).toEqual(list);
    expect(run('let h = (k: integer) => 2*k\nlet m\nh([m, 1])')).toEqual(list);
  });

  test('a function that calls an annotated function keeps the inner call', () => {
    expect(
      run(
        'function h(k: integer) { 2*k }\nfunction f(x: real) { h(x) + 1 }\nlet q\nf(q)'
      )
    ).toEqual(['Add', ['h', 'q'], 1]);
  });

  test('a recursive function is not unrolled for a symbolic argument', () => {
    const fact =
      'function fact(n: integer) { if n <= 1 { 1 } else { n * fact(n - 1) } }\n';
    expect(run(fact + 'let m\nfact(m)')).toEqual(['fact', 'm']);
    expect(run(fact + 'fact(5)')).toBe(120);
  });

  test('a callback stays as an inert application of the literal', () => {
    const ce = new ComputeEngine();
    const held = ce
      .box(['Map', DOUBLE_INTEGER, ['List', 'm', 1]] as any)
      .evaluate({ materialization: true });
    expect(held.json).toEqual([
      'List',
      [
        'Apply',
        ['Function', ['Block', ['Multiply', 2, 'k']], ['Typed', 'k', "'integer'"]],
        'm',
      ],
      2,
    ]);
    ce.assign('m', 3);
    expect(held.evaluate().json).toEqual(['List', 6, 2]);
  });

  test('an inert application with a rest parameter collects it once', () => {
    expect(
      runWith(
        ['q'],
        'function f(a: integer, ...r) { Length(r) }\nlet z = f(q, 1, 2)\nq = 2\nz'
      )
    ).toBe(2);
    const anonymous =
      'let z = ((a: integer, ...r) => Length(r))(q, 1, 2)\nq = 2\nz';
    expect(runWith(['q'], anonymous)).toBe(2);
  });
});

describe('what an annotated parameter does not hold', () => {
  test('a concrete argument is applied', () => {
    expect(run('function h(k: integer) { 2*k }\nh(3)')).toBe(6);
    expect(errorCode(run('function h(k: integer) { 2*k }\nh(1.5)'))).toBe(
      INCOMPATIBLE
    );
  });

  test('an argument declared with a type that fits is applied', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function h(k: integer) { 2*k }');
    ce.declare('n', 'integer');
    expect(ce.box(['h', 'n']).evaluate().json).toEqual(['Multiply', 2, 'n']);
  });

  test('a symbol at a parameter that admits every real number is applied', () => {
    expect(run('function f(x: real) { x^2 }\nf(x)')).toEqual(['Power', 'x', 2]);
    expect(run('function f(x: real) { x^2 }\nD(f(x), x)')).toEqual([
      'Multiply',
      2,
      'x',
    ]);
  });

  test('a predicate at a boolean parameter is applied', () => {
    expect(run('function p(b: boolean) { b }\nlet x\np(x > 0)')).toEqual([
      'Less',
      0,
      'x',
    ]);
  });

  test('a symbol at a parameter typed symbol is its own value', () => {
    expect(run('function f(s: symbol) { s }\nlet q\nf(q)')).toBe('q');
    const declared = new ComputeEngine();
    declared.declare('f', '(symbol) -> symbol');
    declared.assign('f', declared.box(['Function', 's', 's']));
    expect(declared.box(['f', 'q']).evaluate().json).toBe('q');
  });

  test('an expression at a parameter typed expression is applied', () => {
    expect(run('function f(e: expression) { e }\nlet q\nf(q + 1)')).toEqual([
      'Add',
      'q',
      1,
    ]);
  });

  test('a bare parameter beside an annotated one holds nothing', () => {
    expect(run('function f(a: integer, b) { a + b }\nlet q\nf(1, q)')).toEqual([
      'Add',
      'q',
      1,
    ]);
    expect(run('let f = (a: integer, b) => a + b\nlet q\nf(1, q)')).toEqual([
      'Add',
      'q',
      1,
    ]);
  });

  test('a literal with no annotation holds nothing', () => {
    expect(run('let m\n((k) => 2*k)(m)')).toEqual(['Multiply', 2, 'm']);
    expect(run('function h(k) { 2*k }\nlet m\nh(m)')).toEqual([
      'Multiply',
      2,
      'm',
    ]);
  });

  test('a type that inference wrote on a callback parameter holds nothing', () => {
    const ce = new ComputeEngine();
    const held = ce
      .box(['Map', ['Function', ['Multiply', 2, 'k'], 'k'], ['List', 'm', 1]])
      .evaluate({ materialization: true });
    expect(held.json).toEqual(['List', ['Multiply', 2, 'm'], 2]);
  });

  test('a non-strict engine does not hold the call', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    ce.assign('h', ce.box(DOUBLE_INTEGER as any));
    expect(ce.box(['h', 'm']).evaluate().json).toEqual(['Multiply', 2, 'm']);
  });

  test('a lazy definition receives its operand as written', () => {
    const ce = new ComputeEngine();
    ce.declare('h', {
      lazy: true,
      signature: '(integer) -> any',
      evaluate: ce.expr(['Function', ['Multiply', 2, 'k'], 'k']),
    });
    expect(ce.box(['h', 'm']).evaluate().json).toEqual(['Multiply', 2, 'm']);
  });
});

describe('an annotated parameter and a symbol that its type lists', () => {
  test('the symbol that the type lists is applied, on each route', () => {
    const type = 'symbol<Auto> | symbol<Manual>';
    expect(
      run(`function f(x, mode: ${type}) { [x, mode] }\nf(1, Auto)`)
    ).toEqual(['List', 1, 'Auto']);
    expect(
      run(`let f = (x, mode: ${type} = Auto) => [x, mode]\nf(1)`)
    ).toEqual(['List', 1, 'Auto']);
  });

  test('an absent value does not wait for a later value', () => {
    expect(run('function h(k: integer) { 2*k }\nh(Missing)')).toBe('Missing');
    expect(run('let h = (k: integer) => 2*k\nh(Missing)')).toBe('Missing');
    expect(errorCode(run('function s(k: string) { k }\ns(Missing)'))).toBe(
      INCOMPATIBLE
    );
  });
});

describe('the order of the checks of an annotated parameter', () => {
  test('an absent value beside an undecided argument gives Missing', () => {
    expect(
      run('function f(k: integer, x: real) { k + x }\nlet m\nf(m, Missing)')
    ).toBe('Missing');
    expect(
      run('let f = (k: integer, x: real) => k + x\nlet m\nf(m, Missing)')
    ).toBe('Missing');
  });

  test('a value that does not fit beside an undecided argument is an error', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function f(k: integer, j: integer) { k + j }');
    expect(errorCode(ce.box(['f', 'm', 1.5]).evaluate().json)).toBe(
      INCOMPATIBLE
    );
  });
});

describe('an annotated parameter and the map of a broadcastable or a point-list parameter', () => {
  test('an element of a broadcastable map applies the body', () => {
    expect(
      run('function h(k: broadcastable<integer>) { 2*k }\nlet m\nh([m, 1])')
    ).toEqual(['List', ['Multiply', 2, 'm'], 2]);
  });

  test('a symbol beside a broadcastable map applies the body', () => {
    expect(
      run(
        'function h(k: integer, x: broadcastable<real>) { k*x }\nlet m\nh(m, [1, 2])'
      )
    ).toEqual(['List', 'm', ['Multiply', 2, 'm']]);
  });

  test('a symbol beside a point-list map applies the body', () => {
    expect(
      run(
        'function f(k: integer, p: tuple<real, real>) { k*PointX(p) }\nlet m\nf(m, [(1, 2), (3, 4)])'
      )
    ).toEqual(['List', 'm', ['Multiply', 3, 'm']]);
  });
});

describe('the application that waits belongs to the literal that answered', () => {
  test('a function with no annotation does not wait for an inner application', () => {
    const held = run('let w = (x) => ((k: integer) => 2*k)(x)\nlet m\nw(m)');
    expect((held as unknown[])[0]).toBe('Apply');
    expect(
      runWith(
        ['m'],
        'let w = (x) => ((k: integer) => 2*k)(x)\nlet r = w(m)\nm = 3\nr'
      )
    ).toBe(6);
  });

  test('a local annotated function resolves after the call returns', () => {
    const w = 'function w(x) { let h = (k: integer) => 2*k\n h(x) + 1 }\n';
    expect(runWith(['m'], w + 'let r = w(m)\nm = 2\nr')).toBe(5);
    expect(errorCode(runWith(['m'], w + 'let r = w(m)\nm = 1.5\nr'))).toBe(
      INCOMPATIBLE
    );
  });

  test('a generic literal checks its ground parameter when a value decides it', () => {
    const ce = new ComputeEngine();
    const literal = [
      'Function',
      ['Multiply', 2, 'k'],
      "'(x: T, k: integer) -> number where T: number'",
    ];
    expect(errorCode(ce.box(['Apply', literal, 1, 1.5] as any).evaluate().json)).toBe(
      INCOMPATIBLE
    );
    const held = ce.box(['Apply', literal, 1, 'm'] as any).evaluate();
    expect(errorCode(held.json)).toBeUndefined();
    ce.assign('m', 1.5);
    expect(errorCode(held.evaluate().json)).toBe(INCOMPATIBLE);
  });

  test('a bare parameter under a signature marker that is not generic holds nothing', () => {
    const ce = new ComputeEngine();
    const literal = [
      'Function',
      ['Block', ['Typed', ['Add', 'a', 'b'], "'(a: integer, b: integer) -> number'"]],
      ['Typed', 'a', "'integer'"],
      'b',
    ];
    expect(ce.box(['Apply', literal, 1, 'q'] as any).evaluate().json).toEqual([
      'Add',
      'q',
      1,
    ]);
  });

  test('a type variable of a generic literal holds nothing', () => {
    const ce = new ComputeEngine();
    const literal = [
      'Function',
      ['Add', 'x', 'x'],
      "'(x: T) -> T where T: number'",
    ];
    expect(ce.box(['Apply', literal, 'm'] as any).evaluate().json).toEqual([
      'Multiply',
      2,
      'm',
    ]);
  });
});
