/**
 * `ce.temporaryName()`: a name of the reserved form `<hint>_tmp<n>`
 * (`docs/plans/2026-11-12-fresh-symbol-spec.md`, sections 2 and 11).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { Expression } from '../../src/compute-engine/global-types';

const NO_FOLD = { constantFold: false } as const;

describe('THE TABLE OF SECTION 2', () => {
  test('a new engine gives t_tmp1', () => {
    expect(new ComputeEngine().temporaryName('t')).toBe('t_tmp1');
  });

  test('a name of an expression of avoid is skipped', () => {
    const ce = new ComputeEngine();
    expect(ce.temporaryName('t', ce.box(['Add', 't_tmp1', 'x']))).toBe(
      't_tmp2'
    );
  });

  test('a declared name is skipped', () => {
    const ce = new ComputeEngine();
    ce.declare('t_tmp1', 'real');
    expect(ce.temporaryName('t')).toBe('t_tmp2');
  });

  test('an earlier name passed in avoid is skipped', () => {
    const ce = new ComputeEngine();
    const a = ce.temporaryName('p');
    expect(a).toBe('p_tmp1');
    expect(ce.temporaryName('p', a)).toBe('p_tmp2');
  });

  test('the hint is cleaned of its underscores', () => {
    const ce = new ComputeEngine();
    expect(ce.temporaryName('_x')).toBe('x_tmp1');
    expect(ce.temporaryName('a__b')).toBe('a_b_tmp1');
    expect(ce.temporaryName('x_')).toBe('x_tmp1');
    expect(ce.temporaryName('_')).toBe('tmp_tmp1');
  });

  test('a hint that is not a valid symbol throws', () => {
    const ce = new ComputeEngine();
    expect(() => ce.temporaryName('a b')).toThrow();
    // A symbol cannot mix an emoji and letters.
    expect(() => ce.temporaryName('😀')).toThrow();
  });
});

describe('A HINT THAT IS NOT IN THE NFC FORM', () => {
  it('gives the name that ce.symbol() makes of it', () => {
    const ce = new ComputeEngine();
    ce.declare('\u00e9_tmp1', 'real');
    // `e` and a combining acute accent: the same name once normalized.
    const name = ce.temporaryName('e\u0301');
    expect(name).toBe('\u00e9_tmp2');
    expect(ce.symbol(name).symbol).toBe(name);
  });
});

describe('A TEMPORARY IS AN ORDINARY SYMBOL', () => {
  for (const hint of ['t', 'y_r', 'theta', 'x_1']) {
    test(`hint ${hint}`, () => {
      const ce = new ComputeEngine();
      const n = ce.temporaryName(hint);
      expect(n).toBe(`${hint}_tmp1`);
      ce.declare(n, 'real');

      // MathJSON and LaTeX give the same symbol back.
      expect(ce.box(ce.box(n).json).symbol).toBe(n);
      expect(ce.parse(ce.symbol(n).latex).symbol).toBe(n);

      // Each target reads the input under the name `n`.
      const e = ce.box(['Add', n, 1]);
      const js = compile(e, { to: 'javascript' });
      expect(js.success).toBe(true);
      expect(js.code).toBe(`_.${n} + 1`);
      expect(js.run!({ [n]: 2 })).toBe(3);
      const iv = compile(e, { to: 'interval-js' });
      expect(iv.success).toBe(true);
      expect(iv.code).toContain(`_.${n}`);
      expect(new GLSLTarget().compile(e, NO_FOLD).code).toBe(`${n} + 1.0`);
      expect(new PythonTarget().compile(e, NO_FOLD).code).toBe(`${n} + 1`);

      // A parameter of a function.
      expect(
        ce.box(['Apply', ['Function', ['Add', n, 1], n], 2]).evaluate().json
      ).toBe(3);

      // Not a wildcard of the pattern matcher.
      expect(ce.box(['Add', 'x', 1]).match(ce.box(['Add', n, 1]))).toBeNull();
    });
  }
});

describe('AVOID', () => {
  test('a set of names and a single name', () => {
    const ce = new ComputeEngine();
    expect(ce.temporaryName('s', new Set(['s_tmp1']))).toBe('s_tmp2');
    expect(ce.temporaryName('s', 's_tmp1')).toBe('s_tmp2');
    expect(ce.temporaryName('s', 's_tmp1', new Set(['s_tmp2']))).toBe('s_tmp3');
  });

  test('a string is one name, not text to search', () => {
    const ce = new ComputeEngine();
    expect(ce.temporaryName('s', 's_tmp1 + s_tmp2')).toBe('s_tmp1');
  });

  test('an array throws', () => {
    const ce = new ComputeEngine();
    expect(() => ce.temporaryName('s', ['s_tmp1'] as never)).toThrow();
  });

  test('a bound name and an operator name are skipped', () => {
    const ce = new ComputeEngine();
    const bound = ce.box(['Function', ['Add', 's_tmp1', 1], 's_tmp1']);
    expect(ce.temporaryName('s', bound)).toBe('s_tmp2');
    const call = ce.box(['f_tmp1', 'x']);
    expect(ce.temporaryName('f', call)).toBe('f_tmp2');
  });

  test('a name used with no definition, not in avoid, is not seen', () => {
    const ce = new ComputeEngine();
    const other = ce.box(['Add', 's_tmp1', 1]);
    expect(ce.lookupDefinition('s_tmp1')).toBeUndefined();
    expect(ce.temporaryName('s')).toBe('s_tmp1');
    expect(ce.temporaryName('s', other)).toBe('s_tmp2');
  });

  test('the call writes nothing', () => {
    const ce = new ComputeEngine();
    const n = ce.temporaryName('w');
    expect(ce.lookupDefinition(n)).toBeUndefined();
    expect(ce.temporaryName('w')).toBe(n);
  });

  test('a subtree shared to a depth of 40 is walked once', () => {
    const ce = new ComputeEngine();
    let e: Expression = ce.box('s_tmp1');
    for (let i = 0; i < 40; i++)
      e = ce.function('Tuple', [e, e], { canonical: false });
    const start = Date.now();
    expect(ce.temporaryName('s', e)).toBe('s_tmp2');
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('A HELPER FUNCTION UNDER A TEMPORARY NAME', () => {
  /** One document: a helper function under a temporary name, called twice. */
  function document(ce: ComputeEngine) {
    ce.pushScope();
    ce.declare('y', 'real');
    ce.declare('z', 'real');
    const g = ce.temporaryName('Gamma');
    ce.declare(g, 'function');
    ce.assign(g, ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
    const e = ce.box(['Add', [g, 'y'], [g, 'z']]);
    const js = compile(e, { to: 'javascript' });
    const glsl = new GLSLTarget().compile(e, NO_FOLD);
    ce.popScope();
    return {
      name: g,
      js: [js.preamble, js.code],
      value: js.run!({ y: 1, z: 2 }),
      glsl: [glsl.preamble, glsl.code],
    };
  }

  test('the helper is emitted once by JavaScript and GLSL, with no __', () => {
    const r = document(new ComputeEngine());
    expect(r.name).toBe('Gamma_tmp1');
    expect(r.value).toBe(6);
    expect(r.js).toEqual([
      'const _fn_Gamma_tmp1 = (x) => 2 * x;\n',
      '_fn_Gamma_tmp1(_.y) + _fn_Gamma_tmp1(_.z)',
    ]);
    expect(r.glsl).toEqual([
      'float _fn_Gamma_tmp1(float x) {\n  return 2.0 * x;\n}\n',
      '_fn_Gamma_tmp1(y) + _fn_Gamma_tmp1(z)',
    ]);
    for (const text of [...r.js, ...r.glsl]) expect(text).not.toContain('__');
  });

  test('two engines give the same names and the same code', () => {
    const first = document(new ComputeEngine());

    // The second engine does other work first, in scopes that it pops.
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare(ce.temporaryName('Gamma'), 'real');
    ce.parse('x^2+\\Gamma_{tmp1}').simplify();
    ce.popScope();
    expect(document(ce)).toEqual(first);

    // A temporary left declared in the global scope moves the number.
    ce.declare(ce.temporaryName('Gamma'), 'real');
    expect(document(ce).name).toBe('Gamma_tmp2');
  });
});

/** The names of the reserved form in the MathJSON of `expr`. */
function reservedNames(expr: Expression): string[] {
  return [
    ...new Set(JSON.stringify(expr.json).match(/\w*_tmp[1-9]\d*/g) ?? []),
  ].sort();
}

describe('E1: THE VARIABLE OF A SERIES, A RESIDUE AND A CONTOUR INTEGRAL', () => {
  const ce = new ComputeEngine();

  // Each input holds `s` and `s_tmp1`: the variable of the computation is
  // `s_tmp2`, and no result holds it.
  test('a series at infinity', () => {
    const r = ce
      .function('Series', [
        ce.box(['Divide', ['Add', 'x', 's', 's_tmp1'], ['Add', 'x', 1]]),
        ce.symbol('x'),
        ce.PositiveInfinity,
        ce.number(3),
      ])
      .evaluate();
    expect(r.operator).toBe('Add');
    expect(reservedNames(r)).toEqual(['s_tmp1']);
    expect(r.has('s')).toBe(true);
  });

  test('a Taylor series of a unary function', () => {
    const r = ce
      .function('Series', [
        ce.box(['Sin', ['Add', 'x', 's', 's_tmp1']]),
        ce.symbol('x'),
        ce.Zero,
        ce.number(2),
      ])
      .evaluate();
    expect(r.operator).toBe('Add');
    expect(r.has('Cos')).toBe(true);
    expect(reservedNames(r)).toEqual(['s_tmp1']);
  });

  test('a residue at infinity', () => {
    const r = ce
      .box([
        'Residue',
        ['Divide', ['Add', 's', 's_tmp1'], 'x'],
        'x',
        'PositiveInfinity',
      ])
      .evaluate();
    expect(r.json).toEqual(['Add', ['Negate', 's'], ['Negate', 's_tmp1']]);
  });

  test('a contour integral whose variable is s_tmp1', () => {
    const r = ce.contourIntegrate(['Divide', 1, 's_tmp1'], 's_tmp1', {
      kind: 'circle',
      center: 0,
      radius: 2,
    });
    expect(r.status).toBe('success');
    expect(r.value!.json).toEqual(['Multiply', ['Complex', 0, 2], 'Pi']);
    expect(r.poles!.map((p) => p.point.json)).toEqual([0]);
  });

  test('a definite integral by residues, on a period and on a half-line', () => {
    const period = ce
      .box([
        'Integrate',
        ['Divide', 1, ['Add', 2, ['Cos', 's_tmp1']]],
        ['Limits', 's_tmp1', 0, ['Multiply', 2, 'Pi']],
      ])
      .evaluate();
    expect(period.json).toEqual([
      'Multiply',
      ['Rational', 2, 3],
      ['Sqrt', 3],
      'Pi',
    ]);
    const halfLine = ce
      .box([
        'Integrate',
        ['Divide', ['Cos', 's_tmp1'], ['Add', ['Power', 's_tmp1', 2], 1]],
        ['Limits', 's_tmp1', 0, 'PositiveInfinity'],
      ])
      .evaluate();
    expect(halfLine.json).toEqual([
      'Divide',
      'Pi',
      ['Multiply', 2, 'ExponentialE'],
    ]);
  });
});

describe('E4: THE ACCUMULATOR OF A COMPILED ITERATE', () => {
  // The placeholder of the type probe avoids the names of the function: a
  // body that reads `accumulator_tmp1` is probed with that name's own type.
  const take = [
    'Take',
    ['Iterate', ['Function', ['Add', 'x', 'accumulator_tmp1'], 'x'], 0],
    3,
  ];

  test('a real name of the body compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('accumulator_tmp1', 'real');
    const r = compile(ce.box(take as never), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.run!({ accumulator_tmp1: 2 })).toEqual([2, 4, 6]);
  });

  test('a complex name of the body declines', () => {
    const ce = new ComputeEngine();
    ce.declare('accumulator_tmp1', 'complex');
    expect(() =>
      compile(ce.box(take as never), { to: 'javascript', fallback: false })
    ).toThrow(/may return a complex value/);
  });
});

describe('E6: THE AUXILIARY NAMES OF DSOLVE AND RSOLVE', () => {
  // Each equation reaches one solver that names an auxiliary symbol; the
  // spy shows the name it got, and the result holds no name of the
  // reserved form.
  const y = ['y', 'x'];
  const d = (e: unknown) => ['D', e, 'x'];
  const cases: [string, unknown, string, string[]][] = [
    [
      'separable',
      ['Equal', d(y), ['Divide', 'x', y]],
      'DSolve',
      ['dsolvey_tmp1'],
    ],
    [
      'Clairaut',
      ['Equal', y, ['Add', ['Multiply', 'x', d(y)], ['Power', d(y), 2]]],
      'DSolve',
      ['dsolvep_tmp1'],
    ],
    [
      'homogeneous',
      ['Equal', d(y), ['Add', 1, ['Divide', y, 'x']]],
      'DSolve',
      ['dsolvev_tmp1'],
    ],
    [
      'exact',
      [
        'Equal',
        [
          'Add',
          ['Multiply', 2, 'x', y],
          ['Power', y, 2],
          [
            'Multiply',
            ['Add', ['Power', 'x', 2], ['Multiply', 2, 'x', y]],
            d(y),
          ],
        ],
        0,
      ],
      'DSolve',
      ['dsolvey_tmp1'],
    ],
    [
      'third order, constant coefficients',
      [
        'Equal',
        [
          'Add',
          d(d(d(y))),
          ['Negate', ['Multiply', 6, d(d(y))]],
          ['Multiply', 11, d(y)],
          ['Negate', ['Multiply', 6, y]],
        ],
        0,
      ],
      'DSolve',
      ['dsolveroot_tmp1'],
    ],
    [
      'polynomial forcing',
      ['Equal', ['Add', d(d(y)), ['Negate', y]], 'x'],
      'DSolve',
      ['dsolvep_0_tmp1', 'dsolvep_1_tmp1'],
    ],
    [
      'exponential forcing',
      ['Equal', ['Add', d(d(y)), ['Negate', y]], ['Exp', 'x']],
      'DSolve',
      ['dsolvea_tmp1'],
    ],
    [
      'sinusoidal forcing',
      ['Equal', ['Add', d(d(y)), y], ['Sin', 'x']],
      'DSolve',
      ['dsolvesin_tmp1', 'dsolvecos_tmp1'],
    ],
    [
      'Fibonacci',
      [
        'Equal',
        ['a', ['Add', 'n', 2]],
        ['Add', ['a', ['Add', 'n', 1]], ['a', 'n']],
      ],
      'RSolve',
      ['rsolveroot_tmp1'],
    ],
  ];

  for (const [label, equation, op, names] of cases) {
    test(label, () => {
      const ce = new ComputeEngine();
      const spy = jest.spyOn(ce, 'temporaryName');
      const [f, v] = op === 'DSolve' ? ['y', 'x'] : ['a', 'n'];
      const r = ce.box([op, equation, f, v] as never).evaluate();
      expect(spy.mock.results.map((x) => x.value)).toEqual(names);
      expect(r.operator).toBe('List');
      expect(reservedNames(r)).toEqual([]);
    });
  }
});
