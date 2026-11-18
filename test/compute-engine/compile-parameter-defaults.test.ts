// Compilation of function literals and user functions with a parameter with
// a default value, `(x, k = 2) => x * k`, spelled
// `["Function", body, "x", ["Optional", "k", 2]]` (GitHub issue #490).
//
// A default fills ONLY an argument that the call leaves out. The engine
// completes such a call when it canonicalizes it (`f(3)` becomes `f(3, 2)`),
// so compiled code sees every argument. A callback that its consumer calls
// with fewer arguments than the literal has parameters (`Map`, `Fold`,
// `Sort`) and a literal that the host calls without the defaulted argument
// (the root compiled literal) get the default from a native default
// parameter (`undefined` selects it), not from a test of absence. An absent
// value that the call supplies at a defaulted position (`f(Missing)`,
// `f(At(L, 100))`, `g(NaN)`) is not replaced: the interpreter passes it to the
// body, which gives `Missing` or `NaN` as for any other argument. Compiled
// code gives an unspecified value for such an argument, so the tests below
// check only that the call compiles.
//
// A default is a constant: a number, a string, a boolean, `[]` or `{}`. A
// symbol default (`k = d`, `mode = Auto`) and a default of a rest parameter
// are static errors: a declaration throws, and a function literal has an
// `Error` in place of the parameter, so that it does not compile.

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

type Json = any;

/** `(x, k = d) => body`, with `x * k` as the default body. */
function defaulted(d: Json, body: Json = ['Multiply', 'x', 'k']): Json {
  return ['Function', body, 'x', ['Optional', 'k', d]];
}

function run(
  ce: ComputeEngine,
  expr: Json,
  to: string,
  vars: Record<string, unknown> = {}
): { code: string; value: unknown } {
  const options = { to, fallback: false } as any;
  const result: any = compile(ce.box(expr) as any, options);
  expect(result.success).toBe(true);
  return { code: result.code, value: result.run?.(vars) };
}

describe('COMPILED PARAMETER DEFAULTS: JAVASCRIPT', () => {
  const ce = new ComputeEngine();
  ce.declare('y', 'real');
  ce.declare('d', 'real');

  test('a symbol default is a static error', () => {
    const lit = defaulted('d');
    const json = JSON.stringify(ce.box(lit).json);
    expect(json).toContain('expected-a-literal-default');
    expect(() =>
      compile(ce.box(lit) as any, { to: 'javascript', fallback: false })
    ).toThrow();
    expect(() =>
      compile(ce.box(['Map', lit, ['List', 'y', 2]]) as any, {
        to: 'javascript',
        fallback: false,
      })
    ).toThrow();
  });

  test('a default of a rest parameter is a static error', () => {
    const lit = ['Function', 'r', ['Optional', ['Spread', 'r'], 2]];
    expect(JSON.stringify(ce.box(lit).json)).toContain('Error');
    expect(() =>
      compile(ce.box(lit) as any, { to: 'javascript', fallback: false })
    ).toThrow();
  });
});

describe('COMPILED PARAMETER DEFAULTS: USER FUNCTIONS', () => {
  test('a default in a clause of a two-clause function is a declaration error', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function f(n, k = 2) { n }\nfunction f(0, k) { k }\nf(1)'
    );
    expect(
      r.diagnostics.some((d) =>
        String(d.message[1] ?? '').includes(
          'a default value in an overloaded signature is not supported yet'
        )
      )
    ).toBe(true);
  });

  test('a default that names a variable throws in a declared function, and is a static error in an Epsil function', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('F5', {
        signature: '(k: real = d) -> real',
        evaluate: ([k]) => k,
      })
    ).toThrow(/a default value is a constant/);
    const r = executeEpsil(
      new ComputeEngine(),
      'function f(x, k = d) { x * k }'
    );
    expect(r.diagnostics.map((d: any) => d.message[0])).toContain(
      'static-type-error'
    );
  });
});

describe('COMPILED PARAMETER DEFAULTS: INTERVAL AND GLSL', () => {
  const ce = new ComputeEngine();
  ce.declare('y', 'real');

  const saturated = ['Apply', defaulted(2), 'y', 5];
  // The call leaves out `k`: the engine completes it with the default when it
  // canonicalizes the call.
  const completed = ['Apply', defaulted(2), 'y'];

  test('GLSL: a saturated call and a completed call decline', () => {
    // The GLSL fragment refuses `Apply` of a function literal.
    const declined = (expr: Json) => {
      const r: any = compile(ce.box(expr) as any, {
        to: 'glsl',
        fallback: true,
      } as any);
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('outside-profile');
    };
    declined(saturated);
    declined(completed);
  });
});

describe('COMPILED PARAMETER DEFAULTS: CALLBACKS AND FOLDS', () => {
  test('a default that names a constant list of the engine is a static error', () => {
    const ce = new ComputeEngine();
    ce.assign('D', ce.box(['List', 1, 2, 3]));
    const lit = [
      'Function',
      'xs',
      ['Optional', ['Typed', 'xs', "'list<number>'"], 'D'],
    ];
    expect(JSON.stringify(ce.box(lit).json)).toContain(
      'expected-a-literal-default'
    );
    expect(() =>
      compile(ce.box(lit) as any, { to: 'javascript', fallback: false })
    ).toThrow();
  });
});

describe('COMPILED PARAMETER DEFAULTS: ARGUMENT COUNT AND DEFINITIONS', () => {
  test('a combiner with a rest parameter declines, as it did before defaults', () => {
    // The compiled literal does not take a rest parameter, so such a
    // combiner declined before parameter defaults too, while the
    // interpreter gives `3`.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    const combiner = [
      'Function',
      ['Add', 'a', ['Length', 'r']],
      'a',
      ['Spread', 'r'],
    ];
    const reduce = ['Reduce', 'L', combiner, 0];
    expect(
      ce
        .box(reduce)
        .subs({ L: ['List', 1, 2, 3] })
        .evaluate().json
    ).toBe(3);
    for (const to of ['javascript'])
      for (const expr of [reduce, ['Scan', 'L', combiner, 0]])
        expect(() =>
          compile(ce.box(expr) as any, { to, fallback: false } as any)
        ).toThrow();
  });
});

describe('COMPILED PARAMETER DEFAULTS: SORT, ITERATE AND PIPE', () => {
  const ce = new ComputeEngine();
  ce.declare('y', 'real');

});

describe('COMPILED PARAMETER DEFAULTS: A DEFAULT FILLS ONLY A LEFT-OUT ARGUMENT', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');

  /** `(k: real = 2) ↦ k` */
  const K: Json = ['Function', 'k', ['Optional', ['Typed', 'k', "'real'"], 2]];

  const values = { L: ['List', 1, 2] };

  /** The interpreter's value of `expr`, with `L` = [1, 2]. */
  function interpreterValue(expr: Json): Json {
    const sub = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, ce.box(v)])
    );
    return ce.box(expr).subs(sub).evaluate();
  }

  // The calls that leave out the argument, and a call that supplies it.
  const programs: [string, Json, number][] = [
    ['f()', ['Apply', K], 2],
    ['g(5) with k: real', ['Apply', K, 5], 5],
    [
      'a block-local function',
      ['Block', ['Declare', 'h', "'unknown'", K], ['h']],
      2,
    ],
  ];

  test('a parameter declared with `missing` is a static error', () => {
    // A declared type cannot name `missing` (`docs/ERROR-MODEL.md`,
    // "`Missing` is a result only"): a default handles an argument that the
    // call leaves out.
    const r = executeEpsil(
      new ComputeEngine(),
      'function f(k: real | missing = 2) { k }'
    );
    expect(r.diagnostics.map((d: any) => d.message[0])).toContain(
      'type-annotation-error'
    );
  });

  test.each(programs)('interpreter: %s', (_, expr, expected) => {
    expect(interpreterValue(expr).re).toBe(expected);
  });

  test.each([
    ['f(Missing)', ['Apply', K, 'Missing'], 'Missing'],
    ['f(At(L, 100))', ['Apply', K, ['At', 'L', 100]], 'NaN'],
    ['g(0/0) with k: real', ['Apply', K, ['Divide', 0, 0]], 'NaN'],
    ['g(NaN) with k: real', ['Apply', K, 'NaN'], 'NaN'],
  ] as [string, Json, string][])(
    'a supplied absent value is passed through: %s',
    (_, expr, expected) => {
      // The interpreter does not fill the default.
      expect(interpreterValue(expr).json).toBe(expected);
    }
  );

  test('a call of a user function with a left-out argument', () => {
    const ce2 = new ComputeEngine();
    const r = executeEpsil(ce2, 'function f(x, k: real = 2) { k }');
    expect(r.diagnostics).toEqual([]);
    ce2.declare('L', 'list<real>');
    for (const [expr, expected] of [
      [['f', 1, ['At', 'L', 1]], 1],
      [['f', 1], 2],
      [['f', 1, 7], 7],
      [
        ['Map', 'f', 'L'],
        [2, 2],
      ],
    ] as [Json, unknown][]) {
      const v = ce2
        .box(expr)
        .subs({ L: ce2.box(['List', 1, 2]) })
        .evaluate();
      expect(
        v.isCollection ? [...(v.each() as any)].map((x: any) => x.re) : v.re
      ).toEqual(expected);
    }
    // The interpreter passes a supplied `Missing` to the body.
    expect(ce2.box(['f', 1, 'Missing']).evaluate().json).toBe('Missing');
  });
});

describe('COMPILED PARAMETER DEFAULTS: DECLARED DEFAULTS AND OTHER ROUTES', () => {
  test('a present list argument of a user function is passed whole', () => {
    // A list is present, and keeps its shape.
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function hu(x, k = 2) { k }\nfunction hr(x, k: real = 2) { k + x }'
    );
    expect(r.diagnostics).toEqual([]);
    ce.declare('L', 'list<real>');
    const vals = { L: ce.box(['List', 1, 2]) };
    for (const [expr, expected] of [
      [
        ['hu', 1, 'L'],
        [1, 2],
      ],
      [
        ['hr', 1, 'L'],
        [2, 3],
      ],
    ] as [Json, unknown][]) {
      const v = ce.box(expr).subs(vals).evaluate();
      expect([...(v.each() as any)].map((x: any) => x.re)).toEqual(expected);
    }
  });

  test('evaluateAsync: a left-out argument takes the default', async () => {
    const ce = new ComputeEngine();
    ce.declare('F5', {
      signature: '(k: real = 2) -> real',
      evaluate: ([k]) => k,
    });
    const expr = ce.box(['F5']);
    expect(expr.evaluate().toString()).toBe('2');
    expect((await expr.evaluateAsync()).toString()).toBe('2');
  });

  test('a default of the signature declared for a variable fills a left-out argument', () => {
    const ce = new ComputeEngine();
    ce.declare('fv', '(real, real = 2) -> real');
    ce.assign('fv', ce.box(['Function', ['Add', 'x', 'k'], 'x', 'k']));
    ce.declare('fl', '(list<real> = []) -> list<real>');
    ce.assign('fl', ce.box(['Function', 'v', 'v']));
    const call = ['fv', 1];
    expect(ce.box(call).evaluate().re).toBe(3);
    expect(run(ce, call, 'javascript').value).toBe(3);
    expect(ce.box(['fl']).evaluate().toString()).toBe('[]');
  });

  test('the default of the declared signature comes before the default of the literal', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(number, number = 2) -> number');
    ce.assign(
      'g',
      ce.box(['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 3]])
    );
    const expr = ['g', 3];
    expect(ce.box(expr).evaluate().re).toBe(6);
  });

  test('a supplied absent cell of a broadcast is passed through', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(real = 2) -> real');
    ce.assign('g', ce.box(['Function', ['Coalesce', 'k', 0], 'k']));
    expect(ce.box(['g']).evaluate().toString()).toBe('2');
    // The cell `Missing` is not filled with the default 2: it stays `Missing`.
    expect(
      ce
        .box(['g', ['List', 'Missing', 3]])
        .evaluate()
        .toString()
    ).toBe('["Missing",3]');
  });
});

describe('COMPILED PARAMETER DEFAULTS: A CALL THAT MAPS OVER A LIST', () => {
  // A call of a user function with scalar parameters maps it over a list
  // argument. A cell that is absent is passed to the function, which does
  // not fill it with the default.
  const ce = new ComputeEngine();
  const r = executeEpsil(
    ce,
    [
      'function hr(a, k: real = 2) { a + k }',
      'function hp(p: tuple<real, real>, k = 2) { p[1] * k }',
    ].join('\n')
  );
  expect(r.diagnostics).toEqual([]);
  ce.declare('N', 'list<real>');
  ce.declare('L', 'list<real>');
  ce.declare('P', 'list<tuple<real, real>>');
  const vals: Record<string, Json> = {
    N: ['List', 'NaN', 3],
    L: ['List', 1, 2],
    P: ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
  };
  function interpretedList(expr: Json): number[] {
    const sub = Object.fromEntries(
      Object.entries(vals).map(([k, v]) => [k, ce.box(v)])
    );
    const v = ce.box(expr).subs(sub).evaluate();
    return [...(v.each() as any)].map((x: any) => x.re);
  }

  test.each([
    ['hr(1, L), present cells', ['hr', 1, 'L'], [2, 3]],
    ['hp(P), left out', ['hp', 'P'], [2, 6]],
    ['hp(P, [5, 3]), present', ['hp', 'P', ['List', 5, 3]], [5, 9]],
  ] as [string, Json, number[]][])('%s', (_, expr, expected) => {
    expect(interpretedList(expr)).toEqual(expected);
  });

  test('an absent cell is passed to the function', () => {
    // The cell is `NaN`, and `NaN + 1` is `NaN`: the default 2 is not used.
    expect(interpretedList(['hr', 1, 'N'])).toEqual([NaN, 4]);
  });
});
