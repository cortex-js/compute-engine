/**
 * CE-593: a symbol declared `list<tuple<number, number>> | tuple<number,
 * number>` (a point or a list of points, a type that Tycho gives to some of
 * its points).
 *
 * 1. The coordinate `P.x` (`PointX(P)`) is `list<number> | number`: the
 *    coordinate of the point option is a number, and the coordinate of the
 *    list option is a list of numbers (a broadcast). Before, the type also
 *    had a `missing` option, which no value of `P.x` has, and the shader
 *    targets declined it as an "object-domain absent position".
 * 2. On a shader target, a value of this type has no single representation
 *    (a point is a `vec2`, a list of points is an array). When the shader
 *    computes the value of `P` (a value is assigned and no `vars` entry maps
 *    `P`), and the value is a point, `P.x` is the `.x` of that `vec2`.
 *    Otherwise the compilation declines with a message that names `P`, its
 *    type and the declaration to write.
 * 3. `compileFieldFunction()` reads each parameter from the buffer, whatever
 *    its value, and a buffer field has one fixed type: such a parameter
 *    declines, with the same remedy.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { rewriteAngularUnit } from '../../src/compute-engine/symbolic/angular-unit';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const UNION = 'list<tuple<number, number>> | tuple<number, number>';

function engine(value?: unknown): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('P', UNION);
  if (value !== undefined) ce.assign('P', ce.box(value as any));
  return ce;
}

function compileError(
  ce: ComputeEngine,
  src: string,
  to: 'glsl' | 'wgsl',
  vars?: Record<string, string>
): string {
  try {
    const r = compile(ce.parse(src), { to, fallback: false, vars });
    return r.success ? `success: ${r.code}` : `failure: ${r.error ?? ''}`;
  } catch (e) {
    return (e as Error).message;
  }
}

describe('CE-593: the type of a coordinate of a point or a list of points', () => {
  test('PointX and PointY have no missing option', () => {
    const ce = engine();
    expect(ce.box(['PointX', 'P']).type.toString()).toBe(
      'list<number> | number'
    );
    expect(ce.box(['PointY', 'P']).type.toString()).toBe(
      'list<number> | number'
    );
    expect(ce.parse('P.x + y').type.toString()).toBe('list<number> | number');
  });

  test('a point option keeps the absence marker of its coordinate', () => {
    // A single point `tuple<integer, integer>` has the coordinate type
    // `integer | nan`, and the union keeps that marker; the list option adds
    // none.
    const ce = new ComputeEngine();
    ce.declare('Q', 'list<tuple<integer, integer>> | tuple<integer, integer>');
    expect(ce.box(['PointX', 'Q']).type.toString()).toBe(
      'integer | list<integer> | nan'
    );
  });

  test('PointZ of a union of 3-D points has no missing option', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'R',
      'list<tuple<number, number, number>> | tuple<number, number, number>'
    );
    expect(ce.box(['PointZ', 'R']).type.toString()).toBe(
      'list<number> | number'
    );
  });

  test('the values agree with the type', () => {
    const ce = engine(['Tuple', 1, 2]);
    expect(ce.box(['PointX', 'P']).evaluate().json).toBe(1);
    ce.assign('P', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    expect(ce.box(['PointX', 'P']).evaluate().json).toEqual(['List', 1, 3]);
  });
});

describe('CE-593: the javascript target', () => {
  test('compiles the coordinate with a broadcast', () => {
    const ce = engine(['Tuple', 1, 2]);
    const r = compile(ce.parse('P.x + y'), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '_SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _.y, _SYS.pointComponent(_val_P, 0))'
    );
    expect(r.run!({ y: 3 })).toBe(4);
  });
});

describe('CE-593: the shader targets read the assigned point', () => {
  // The compilation writes the point value in place of `P` before it
  // starts, so `P` compiles as the tuple `(1, 2)` does.
  test.each([
    ['glsl', 'y + 1.0'],
    ['wgsl', 'y + 1.0'],
  ] as const)('%s', (to, code) => {
    const ce = engine(['Tuple', 1, 2]);
    const r = compile(ce.parse('P.x + y'), { to, fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toBe(code);
  });

  test('PointY reads the second component', () => {
    const ce = engine(['Tuple', 1, 2]);
    const r = compile(ce.parse('P.y'), { to: 'glsl', fallback: false });
    expect(r.code).toBe('2.0');
  });

  // The shape checks read the point, a `vec2`, not the declared type, which
  // reads as an array.
  test.each([
    ['glsl', 'P', 'vec2(1.0, 2.0)'],
    ['glsl', 'P + (y, y)', 'vec2(y, y) + vec2(1.0, 2.0)'],
    ['glsl', '\\sin(xP)', 'sin(x * vec2(1.0, 2.0))'],
    ['wgsl', '\\sin(xP)', 'sin(x * vec2f(1.0, 2.0))'],
    ['glsl', '2P', 'vec2(2.0, 4.0)'],
    [
      'glsl',
      '\\operatorname{distance}((x,y),P)',
      'distance(vec2(x, y), vec2(1.0, 2.0))',
    ],
    ['wgsl', 'P + (y, y)', 'vec2f(y, y) + vec2f(1.0, 2.0)'],
    [
      'wgsl',
      '\\operatorname{distance}((x,y),P)',
      'distance(vec2f(x, y), vec2f(1.0, 2.0))',
    ],
  ] as const)('%s: %s', (to, src, code) => {
    const ce = engine(['Tuple', 1, 2]);
    const r = compile(ce.parse(src), { to, fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toBe(code);
  });

  test.each(['glsl', 'wgsl'] as const)('%s: Norm and Dot', (to) => {
    const ce = engine(['Tuple', 1, 2]);
    for (const json of [
      ['Norm', 'P'],
      ['Dot', 'P', ['Tuple', 'x', 'y']],
    ]) {
      const r = compile(ce.box(json as any), { to, fallback: false });
      expect(r.success).toBe(true);
    }
  });

  test('an assigned list of points declines', () => {
    // The value is not a point, so it is not written in place of `P`, and
    // `P` is read as an input of the union type.
    const ce = engine(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]);
    expect(compileError(ce, 'P.x + y', 'glsl')).toMatch(
      /^Could not compile `PointX`: "P" has the type `list<tuple<number, number>> \| tuple<number, number>`/
    );
  });
});

describe('CE-593: the shader targets decline when the value is not used', () => {
  const MESSAGE =
    'Could not compile `PointX`: "P" has the type ' +
    '`list<tuple<number, number>> | tuple<number, number>`, which admits a ' +
    'point and a list of points. A shader value cannot be both: a point is ' +
    'a vector (`vec2`, `vec3`, `vec4`) and a list of points is an array. ' +
    "Declare \"P\" as a point (`ce.declare('P', 'tuple<real, real>')`), or " +
    'assign a point to "P" and do not map it with `vars`, so that the ' +
    'shader uses its value.';

  test.each(['glsl', 'wgsl'] as const)('%s: no value', (to) => {
    expect(compileError(engine(), 'P.x + y', to)).toBe(MESSAGE);
  });

  test.each(['glsl', 'wgsl'] as const)(
    '%s: a value, and a vars entry for P',
    (to) => {
      expect(
        compileError(engine(['Tuple', 1, 2]), 'P.x + y', to, { P: 'P' })
      ).toBe(MESSAGE);
    }
  );

  // A read of `P` as a shader input declines with the same message, with
  // `P` as the head: a bare `P`, and every whole-vector use of it.
  const INPUT_MESSAGE = MESSAGE.replace('`PointX`', '`P`');
  const WHOLE = [
    'P',
    'P + (y, y)',
    '2P',
    '\\Vert P\\Vert',
    '\\operatorname{distance}((x,y),P)',
  ];

  test.each(['glsl', 'wgsl'] as const)('%s: P as an input', (to) => {
    for (const src of WHOLE) {
      expect(compileError(engine(), src, to)).toBe(INPUT_MESSAGE);
      expect(compileError(engine(['Tuple', 1, 2]), src, to, { P: 'P' })).toBe(
        INPUT_MESSAGE
      );
    }
  });

  test('the declaration named in the message compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    ce.declare('P', 'tuple<real, real>');
    const r = compile(ce.parse('P.x + y'), { to: 'glsl', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toBe('y + P.x');
  });
});

describe('CE-593: compileFieldFunction() declines the parameter', () => {
  const MESSAGE_START =
    'Could not compile with `compileFieldFunction()`: the parameter "P" has ' +
    'the type `list<tuple<number, number>> | tuple<number, number>`, which ' +
    'admits a point and a list of points, and a field of the parameter ' +
    'struct has one fixed type. Declare "P" as a point (`ce.declare(\'P\', ' +
    "'tuple<real, real>')`).";

  test.each([
    ['with an assigned point', ['Tuple', 1, 2]],
    ['with no value', undefined],
  ])('%s', (_, value) => {
    const ce = engine(value);
    for (const src of ['P.x + y', 'P_1 + y']) {
      const r = new WGSLTarget().compileFieldFunction(ce.parse(src), {
        name: 'f',
        coordinates: ['x', 'y'],
      });
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsupported-parameter');
      expect(r.diagnostic?.binding).toBe('P');
      expect(r.diagnostic?.message.startsWith(MESSAGE_START)).toBe(true);
    }
  });

  test('a parameter declared as a point compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('P', 'tuple<real, real>');
    const r = new WGSLTarget().compileFieldFunction(ce.parse('P.x + y'), {
      name: 'f',
      coordinates: ['x', 'y'],
    });
    expect(r.success).toBe(true);
    expect(r.function).toContain('ce_params.P.x');
  });
});

describe('CE-593: user functions and locals read the point', () => {
  // The signature of `f(t) := t·P` returns the union, because it was
  // derived from the stored body. A call of `f` is replaced by its body with
  // the point value written in place of `P`, for this compilation only, so
  // the call site reads a point. Before, `f(t) := t·P` compiled to
  // `float _fn_f(float t) { return vec2(1.0, 2.0) * t; }`.
  test.each([
    [
      'glsl',
      [
        'x * vec2(1.0, 2.0)',
        '(x * vec2(1.0, 2.0)).x',
        'x * vec2(1.0, 2.0) + vec2(y, y)',
        'distance(x * vec2(1.0, 2.0), vec2(x, y))',
      ],
    ],
    [
      'wgsl',
      [
        'x * vec2f(1.0, 2.0)',
        '(x * vec2f(1.0, 2.0)).x',
        'x * vec2f(1.0, 2.0) + vec2f(y, y)',
        'distance(x * vec2f(1.0, 2.0), vec2f(x, y))',
      ],
    ],
  ] as const)('%s: calls of a user function', (to, codes) => {
    const ce = engine(['Tuple', 1, 2]);
    ce.parse('f(t) := t P').evaluate();
    const sources = [
      'f(x)',
      'f(x).x',
      'f(x) + (y, y)',
      '\\operatorname{distance}(f(x),(x,y))',
    ];
    sources.forEach((src, i) => {
      const r = compile(ce.parse(src), { to, fallback: false });
      expect(r.success).toBe(true);
      expect(r.code).toBe(codes[i]);
    });
    // The stored definition does not change: it still reads `P`.
    ce.assign('P', ce.box(['Tuple', 3, 4]));
    expect(ce.parse('f(1)').evaluate().json).toEqual(['Tuple', 3, 4]);
  });

  // A user function compiled as a shader function: its body is compiled with
  // the point in place of `P`, and with the calls of `f` replaced.
  test.each([
    [
      'glsl',
      'float _fn_k(float s) {\n  return (s * vec2(1.0, 2.0)).x + 1.0;\n}\n',
    ],
    [
      'wgsl',
      'fn _fn_k(s: f32) -> f32 {\n  return (s * vec2f(1.0, 2.0)).x + 1.0;\n}\n',
    ],
  ] as const)('%s: a shader function that calls f', (to, preamble) => {
    const ce = engine(['Tuple', 1, 2]);
    ce.parse('f(t) := t P').evaluate();
    ce.parse('k(s) := f(s).x + 1').evaluate();
    const r = compile(ce.parse('k(x)'), { to, fallback: false });
    expect(r.code).toBe('_fn_k(x)');
    expect(r.preamble).toBe(preamble);
  });

  test.each([
    ['glsl', 'vec2 a;\na = x * vec2(1.0, 2.0);\nreturn a.x;'],
    ['wgsl', 'var a: vec2f;\na = x * vec2f(1.0, 2.0);\nreturn a.x;'],
  ] as const)('%s: a Block local holding f(x)', (to, code) => {
    const ce = engine(['Tuple', 1, 2]);
    ce.parse('f(t) := t P').evaluate();
    const r = compile(
      ce.box(['Block', ['Assign', 'a', ['f', 'x']], ['PointX', 'a']]),
      { to, fallback: false }
    );
    expect(r.code).toBe(code);
  });

  test.each(['glsl', 'wgsl'] as const)(
    '%s: a function that returns a list of points declines',
    (to) => {
      const ce = engine(['Tuple', 1, 2]);
      ce.declare('Q', UNION);
      ce.assign('Q', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
      ce.parse('h(t) := t Q').evaluate();
      expect(compileError(ce, 'h(x).x', to)).toBe(
        'Could not compile `PointX`: `h(x)` has the type ' +
          '`list<tuple<number, number>> | tuple<number, number>`, which ' +
          'admits a point and a list of points. A shader value cannot be ' +
          'both: a point is a vector (`vec2`, `vec3`, `vec4`) and a list of ' +
          'points is an array. Make the value a point (a tuple such as ' +
          '`tuple<real, real>`).'
      );
    }
  );

  // The value dependency is recorded as for a symbol declared as a point:
  // the same `symbolDeps` capture set, on every target.
  test.each(['glsl', 'wgsl'] as const)('%s: the capture set', (to) => {
    const deps = (decl: string): string[] => {
      const ce = new ComputeEngine();
      ce.declare('y', 'real');
      ce.declare('P', decl);
      ce.assign('P', ce.box(['Tuple', 1, 2]));
      const set = new Set<string>();
      compile(ce.parse('P + (y, y)'), { to, fallback: false, symbolDeps: set });
      return [...set].sort();
    };
    expect(deps(UNION)).toEqual(deps('tuple<real, real>'));
  });

  test.each([
    [
      'glsl',
      'vec2 a;\na = vec2(2.0, 4.0);\nreturn a;',
      'vec2 a;\na = x * vec2(1.0, 2.0);\nreturn a.x;',
    ],
    [
      'wgsl',
      'var a: vec2f;\na = vec2f(2.0, 4.0);\nreturn a;',
      'var a: vec2f;\na = x * vec2f(1.0, 2.0);\nreturn a.x;',
    ],
  ] as const)('%s: a Block local', (to, whole, coordinate) => {
    const ce = engine(['Tuple', 1, 2]);
    const r = compile(
      ce.box(['Block', ['Assign', 'a', ['Multiply', 2, 'P']], 'a']),
      { to, fallback: false }
    );
    expect(r.code).toBe(whole);
    const s = compile(
      ce.box([
        'Block',
        ['Assign', 'a', ['Multiply', 'x', 'P']],
        ['PointX', 'a'],
      ]),
      { to, fallback: false }
    );
    expect(s.code).toBe(coordinate);
  });

  // A function whose body reads a coordinate of `P` (`f(t) := At(P, 1)`)
  // has a signature that returns `missing | number | tuple<number, number>`:
  // the coordinate of a point, or the first point of a list of points. That
  // union has no shader type. The call is replaced by its body, which is a
  // number once the point is in place. Before, `f(x) + x` declined with
  // "Could not compile an object-domain absent ('missing') position".
  // (Tycho ledger row 479.)
  test.each(['glsl', 'wgsl'] as const)(
    '%s: a call that returns a coordinate of P',
    (to) => {
      const ce = engine(['Tuple', 3, 4]);
      ce.declare('f', 'function');
      ce.assign('f', ce.box(['Function', ['At', 'P', 1], 't']));
      expect(ce.box(['Add', ['f', 2], 2]).evaluate().re).toBe(5);
      const r = compile(ce.box(['Add', ['f', 'x'], 'x']), {
        to,
        fallback: false,
      });
      expect(r.success).toBe(true);
      expect(r.code).toBe('x + 3.0');
    }
  );

  // A number body whose type is a range (`Square(3)` is an integer from 0
  // up) or the type of a ranged coordinate (`u: real<0..1>`) is kept too.
  test.each(['glsl', 'wgsl'] as const)(
    '%s: a call whose body has a ranged number type',
    (to) => {
      const ce = engine(['Tuple', 3, 4]);
      ce.declare('f', 'function');
      ce.assign('f', ce.box(['Function', ['Square', ['At', 'P', 1]], 't']));
      expect(ce.box(['Add', ['f', 2], 2]).evaluate().re).toBe(11);
      const r = compile(ce.box(['Add', ['f', 'x'], 'x']), {
        to,
        fallback: false,
      });
      expect(r.success).toBe(true);

      const ce2 = engine();
      ce2.declare('u', 'real<0..1>');
      ce2.assign('P', ce2.box(['Tuple', 'u', 4]));
      ce2.declare('g', 'function');
      ce2.assign('g', ce2.box(['Function', ['At', 'P', 1], 't']));
      const r2 = compile(ce2.box(['Add', ['g', 'x'], 'x']), {
        to,
        fallback: false,
      });
      expect(r2.success).toBe(true);
      expect(r2.code).toMatch(/\bu\b/);
    }
  );

  // A body that stays a union after the substitution keeps the call as
  // written, and the compilation declines as before: with a list of points
  // in `P`, `At(P, 1)` is not written in place.
  test.each(['glsl', 'wgsl'] as const)(
    '%s: a call over a list of points still declines',
    (to) => {
      const ce = engine(['List', ['Tuple', 3, 4], ['Tuple', 5, 6]]);
      ce.declare('f', 'function');
      ce.assign('f', ce.box(['Function', ['At', 'P', 1], 't']));
      let message = '';
      try {
        const r = compile(ce.box(['Add', ['f', 'x'], 'x']), {
          to,
          fallback: false,
        });
        message = r.success ? `success: ${r.code}` : `failure: ${r.error}`;
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/^Could not compile/);
    }
  );
});

describe('CE-593: only the union is read through its value', () => {
  // A symbol of another type keeps the reading of its declared type: a
  // `list<real>` of no stated length is not a point, whatever its value.
  test.each(['glsl', 'wgsl'] as const)('%s: P: list<real>', (to) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('P', 'list<real>');
    ce.assign('P', ce.parse('[x, y]'));
    expect(compileError(ce, 'x + P.x', to)).toMatch(
      /^Could not compile `PointX`: a list of points has no GPU lowering/
    );
  });
});

describe('CE-593: a tuple value under an indexed_collection option', () => {
  // `indexed_collection<tuple<…>>` also admits a tuple of points, which the
  // accessor reads as one point: `PointX(((1, 2), (3, 4)))` is `(1, 2)`.
  test('the coordinate type admits the point', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'P',
      'indexed_collection<tuple<number, number>> | tuple<number, number>'
    );
    const px = ce.box(['PointX', 'P']);
    expect(px.type.toString()).toBe(
      'list<number> | missing | number | tuple<number, number>'
    );
    ce.assign('P', ce.box(['Tuple', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    const value = px.evaluate();
    expect(value.json).toEqual(['Tuple', 1, 2]);
    expect(value.type.matches(px.type)).toBe(true);
  });
});

describe('CE-593: the rewrites keep the other compile contracts', () => {
  // A head that the caller overrides keeps the caller's implementation: its
  // call is not replaced by the engine's body.
  test.each(['glsl', 'wgsl'] as const)('%s: a functions override', (to) => {
    const ce = engine(['Tuple', 1, 2]);
    ce.parse('f(t) := t P').evaluate();
    const r = compile(ce.parse('f(x)'), {
      to,
      fallback: false,
      functions: { f: 'shader_f' },
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('shader_f(x)');
  });

  // The value written in place of `P` is rewritten for the angular unit, as
  // the expression is at the compile entry: in degree mode `Sin(x)` is
  // `sin(0.017453292 * x)`. The rest of the expression is not converted a
  // second time.
  test.each([
    [
      'glsl',
      'vec2(sin(0.017453292 * x), 0.0).x',
      '(x * vec2(sin(0.017453292 * x), 0.0)).x',
    ],
    [
      'wgsl',
      'vec2f(sin(0.017453292 * x), 0.0).x',
      '(x * vec2f(sin(0.017453292 * x), 0.0)).x',
    ],
  ] as const)('%s: degree mode', (to, coordinate, call) => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    ce.declare('x', 'real');
    ce.declare('P', UNION);
    ce.assign('P', ce.box(['Tuple', ['Sin', 'x'], 0]));
    ce.parse('f(t) := t P').evaluate();
    expect(compile(ce.parse('P.x'), { to, fallback: false }).code).toBe(
      coordinate
    );
    expect(compile(ce.parse('f(x).x'), { to, fallback: false }).code).toBe(
      call
    );
  });

  // A node that several parents share stays one node: the graph
  // `e_{k+1} = e_k + sin(e_k)` has 2k + 2 distinct nodes and 2^k paths. The
  // base `e_0 = P.x + x` is not constant: the numeric evaluation of a
  // CONSTANT shared graph during the shader lowering takes a time
  // exponential in its depth whatever the type of `P` (see the report of
  // CE-593), which is not what this test measures.
  test.each(['glsl', 'wgsl'] as const)('%s: a shared graph', (to) => {
    const ce = engine(['Tuple', 1, 2]);
    let e = ce.box(['Add', ['PointX', 'P'], 'x']);
    for (let i = 0; i < 20; i++)
      e = ce.function('Add', [e, ce.function('Sin', [e])]);
    const start = performance.now();
    const r = compile(e, { to, fallback: false });
    const ms = performance.now() - start;
    expect(r.success).toBe(true);
    // One `sin` for each level: the shared nodes are written once.
    expect(r.code.split('sin(').length - 1).toBe(20);
    if (process.env.CE_PERF === '1') expect(ms).toBeLessThan(2_000);
  });
});

describe('CE-593: compileShader() reads the shader declarations', () => {
  function shader(
    ce: ComputeEngine,
    src: string,
    options: {
      inputs?: Array<{ name: string; type: string }>;
      uniforms?: Array<{ name: string; type: string }>;
      output?: string;
      constantFold?: boolean;
    } = {}
  ): string {
    try {
      const code = new GLSLTarget().compileShader({
        type: 'fragment',
        inputs: options.inputs ?? [{ name: 'x', type: 'float' }],
        uniforms: options.uniforms,
        outputs: [{ name: 'o', type: options.output ?? 'float' }],
        body: [{ variable: 'o', expression: ce.parse(src) }],
        constantFold: options.constantFold,
      });
      return code
        .split('\n')
        .filter((l) => l.trim().startsWith('o ='))
        .join('\n')
        .trim();
    } catch (e) {
      return (e as Error).message;
    }
  }

  // The value `(x, 0)` of `P` reads the engine symbol `x`, which holds 100.
  // In a shader that declares an input `x`, the value written in place of
  // `P` read the input instead: `o = vec2(x, 0.0).x;`. The value is not
  // written in place when it mentions a declared name, and the compilation
  // declines.
  test('a point value that mentions a declared name is not written in place', () => {
    const ce = engine(['Tuple', 'x', 0]);
    ce.assign('x', 100);
    expect(shader(ce, 'P.x', { constantFold: false })).toMatch(
      /^Could not compile `PointX`: "P" has the type/
    );
    // Without the declaration, the value reads the engine symbol.
    expect(shader(ce, 'P.x', { inputs: [], constantFold: false })).toBe(
      'o = vec2(100.0, 0.0).x;'
    );
  });

  // The body of `g` reads the engine symbol `u`, which a uniform of the
  // shader would capture. The call is not inlined.
  test('a callee body that mentions a declared name is not inlined', () => {
    const ce = engine(['Tuple', 1, 2]);
    ce.declare('u', 'real');
    ce.assign('u', 7);
    ce.parse('g(t) := t P + (u, u)').evaluate();
    const uniforms = [{ name: 'u', type: 'float' }];
    expect(shader(ce, 'g(x).x', { uniforms, constantFold: false })).toMatch(
      /^Could not compile `PointX`: `g\(x\)` has the type/
    );
    expect(shader(ce, 'g(x).x', { constantFold: false })).toBe(
      'o = (x * vec2(1.0, 2.0) + vec2(7.0, 7.0)).x;'
    );
  });

  // The type and width checks of a statement read the expression with the
  // call inlined. Before, they read the call, whose width is unknown, and
  // `float o = x * vec2(1.0, 2.0);` was emitted.
  test('the width checks read the inlined call', () => {
    const ce = engine(['Tuple', 1, 2]);
    ce.parse('f(t) := t P').evaluate();
    expect(shader(ce, 'f(x)')).toMatch(
      /^Could not compile the body statement "o" of `compileShader\(\)`: the value has 2 components, and the target "o" has the type `float`/
    );
    expect(shader(ce, 'f(x)', { output: 'vec2' })).toBe(
      'o = x * vec2(1.0, 2.0);'
    );
  });
});

describe('CE-593: an impure argument is not substituted', () => {
  // `isPure` of `r` is true, but `r` holds `Random()`. Substituting `f(r)`
  // wrote `r`, and its draw, at each occurrence of the parameter: two draws
  // instead of one. The call stays a call, which has the union type, and
  // the compilation declines.
  test.each(['glsl', 'wgsl'] as const)('%s', (to) => {
    const ce = engine(['Tuple', 1, 2]);
    ce.parse('f(t) := (t - t^2) P').evaluate();
    ce.declare('r', 'real');
    ce.assign('r', ce.box(['Random'], { form: 'raw' }));
    expect(compileError(ce, 'f(r).x', to)).toMatch(
      /^Could not compile `PointX`: `f\(r\)` has the type/
    );
    // A pure argument is substituted.
    ce.assign('r', 3);
    expect(compileError(ce, 'f(r).x', to)).toBe('success: -6.0');
  });
});

describe('CE-593: the impurity test reads the current values', () => {
  // The inlining of point calls runs before the compilation resets its
  // memos. It read the answer of an earlier compilation, made when `r` held
  // a pure value, and inlined `f(r)` after `r := Random()`: two draws.
  test('glsl', () => {
    const ce = engine(['Tuple', 1, 2]);
    ce.parse('f(t) := (t - t^2) P').evaluate();
    ce.declare('r', 'real');
    ce.assign('r', 3);
    const r = ce.box('r');
    compile(ce.box(['Cot', r]), {
      to: 'glsl',
      fallback: false,
      constantFold: false,
    });
    ce.assign('r', ce.box(['Random'], { form: 'raw' }));
    expect(compileError(ce, 'f(r).x', 'glsl')).toMatch(
      /^Could not compile `PointX`: `f\(r\)` has the type/
    );
  });
});

describe('CE-593: the inlining reads the scope of the definition', () => {
  // `f` captured the outer `P = (1, 2)`; the compile scope declares another
  // `P = (3, 4)`. The interpreter reads the captured `P`. The inlining of
  // point calls ran before the check of `compile()`, removed the call, and
  // read the inner `P`: `(x * vec2(3.0, 4.0)).x`. The check now runs before
  // the inlining. Modeled on `compile-user-function-definition-scope.test.ts`.
  function scoped(): ComputeEngine {
    const ce = engine(['Tuple', 1, 2]);
    ce.declare('f', 'function');
    ce.assign('f', ce.parse('t \\mapsto t P'));
    ce.pushScope();
    ce.declare('P', UNION);
    ce.assign('P', ce.box(['Tuple', 3, 4]));
    return ce;
  }

  test.each(['glsl', 'wgsl'] as const)('%s: compile()', (to) => {
    const ce = scoped();
    expect(ce.parse('f(x).x').subs({ x: 2 }).evaluate().re).toBe(2);
    expect(compileError(ce, 'f(x).x', to)).toMatch(
      /body reads `P`.*different definition/
    );
  });

  test('glsl: compileShader()', () => {
    const ce = scoped();
    expect(() =>
      new GLSLTarget().compileShader({
        type: 'fragment',
        inputs: [{ name: 'x', type: 'float' }],
        outputs: [{ name: 'o', type: 'float' }],
        body: [{ variable: 'o', expression: ce.parse('f(x).x') }],
      })
    ).toThrow(/body reads `P`.*different definition/);
  });
});

describe('CE-593: a refusal before compile() leaves no memo', () => {
  // The chain throws at the inlining budget, before `compile()` starts, and
  // its walk recorded `r` as pure. After `r := Random()`, a new compilation
  // read that answer and substituted `r` two times: two draws.
  test('glsl', () => {
    const ce = engine(['Tuple', 1, 2]);
    ce.parse('f_0(t) := (t - t^2) P').evaluate();
    for (let i = 1; i <= 10; i++)
      ce.parse(`f_{${i}}(t) := f_{${i - 1}}(t) + f_{${i - 1}}(t+1)`).evaluate();
    ce.declare('r', 'real');
    ce.assign('r', 3);
    const r = ce.box('r');
    expect(() =>
      compile(ce.box(['PointX', ['f_10', r]]), { to: 'glsl', fallback: false })
    ).toThrow(/would be written out more than 512 times/);
    ce.assign('r', ce.box(['Random'], { form: 'raw' }));
    expect(() =>
      compile(ce.box(['PointX', ['f_0', r]]), { to: 'glsl', fallback: false })
    ).toThrow(/^Could not compile `PointX`: `f_0\(r\)` has the type/);
  });
});

describe('CE-593: the substituted value is checked', () => {
  // A host can write the value of a definition directly. A 3-D point in
  // the definition of a 2-D `P` is refused where `P` is read
  // (`compileSymbol`); the substitution of the value removed `P` first and
  // compiled `1.0`.
  test.each(['glsl', 'wgsl'] as const)('%s: a value of another type', (to) => {
    const ce = engine(['Tuple', 1, 2]);
    (ce.lookupDefinition('P') as any).value.value = ce.box(['Tuple', 1, 2, 3]);
    expect(compileError(ce, 'P.x', to)).toMatch(
      /^Could not compile the symbol 'P': its value has the type 'tuple<integer, integer, integer>'/
    );
  });

  // The value holds a graph whose shared nodes are written once for each
  // path. `compileShader()` measured its statements before the
  // substitution, and `compileToSource()` did not measure them: with
  // `constantFold: false`, 18 levels wrote 3.5 million characters.
  function deepValue(): ComputeEngine {
    const ce = engine();
    ce.declare('a', 'real');
    ce.assign('a', 0.5);
    let u = ce.box('a');
    for (let i = 0; i < 24; i++)
      u = ce.function('Add', [u, ce.function('Sin', [u])]);
    ce.assign('P', ce.function('Tuple', [u, 0]));
    return ce;
  }

  test('compileShader()', () => {
    const ce = deepValue();
    expect(() =>
      new GLSLTarget().compileShader({
        type: 'fragment',
        inputs: [{ name: 'x', type: 'float' }],
        outputs: [{ name: 'o', type: 'float' }],
        body: [{ variable: 'o', expression: ce.parse('P.x') }],
        constantFold: false,
      })
    ).toThrow(/body statements would have more than 50,000 nodes/);
  });

  test('compileToSource()', () => {
    const ce = deepValue();
    expect(() =>
      new GLSLTarget().compileToSource(ce.parse('P.x'), { constantFold: false })
    ).toThrow(/code would have more than 50,000 nodes/);
  });

  // `compile()` checks the size after the substitution, with its
  // common-subexpression pass, and compiles.
  test('compile()', () => {
    const ce = deepValue();
    const r = compile(ce.parse('P.x'), {
      to: 'glsl',
      fallback: false,
      constantFold: false,
    });
    expect(r.success).toBe(true);
  });
});

describe('CE-593: degree mode keeps a shared value shared', () => {
  // `rewriteAngularUnit()` rewrote a node once for each path, and wrote a
  // tree without the sharing: the value of `P`, a graph of 24 levels
  // (`u = u + sin(u)`), took a time exponential in the depth before the
  // shader size checks ran (18 levels: 6.8 s; 20 levels ran out of memory).
  // A shared node is now rewritten once. The bound is on the size of the
  // result, which does not depend on the machine.
  function deepValue(): { ce: ComputeEngine; value: Expression } {
    const ce = engine();
    ce.angularUnit = 'deg';
    ce.declare('a', 'real');
    ce.assign('a', 0.5);
    let u = ce.box('a');
    for (let i = 0; i < 24; i++)
      u = ce.function('Add', [u, ce.function('Sin', [u])]);
    const value = ce.function('Tuple', [u, 0]);
    ce.assign('P', value);
    return { ce, value };
  }

  function distinctNodes(e: Expression): number {
    const seen = new Set<Expression>();
    const walk = (n: Expression): void => {
      if (seen.has(n)) return;
      seen.add(n);
      if (isFunction(n)) n.ops.forEach(walk);
    };
    walk(e);
    return seen.size;
  }

  test('the rewrite keeps the sharing', () => {
    const { value } = deepValue();
    const rewritten = rewriteAngularUnit(value);
    expect(distinctNodes(rewritten)).toBeLessThan(500);
  });

  test('glsl: compile() and compileShader()', () => {
    const { ce } = deepValue();
    expect(
      compile(ce.parse('P.x'), {
        to: 'glsl',
        fallback: false,
        constantFold: false,
      }).success
    ).toBe(true);
    expect(() =>
      new GLSLTarget().compileShader({
        type: 'fragment',
        inputs: [{ name: 'x', type: 'float' }],
        outputs: [{ name: 'o', type: 'float' }],
        body: [{ variable: 'o', expression: ce.parse('P.x') }],
        constantFold: false,
      })
    ).toThrow(/body statements would have more than 50,000 nodes/);
  });
});

describe('CE-593: a callee body that holds a shared graph', () => {
  // The walk of a callee body keeps its results for each set of callees
  // being substituted, so a shared node of the body is walked once.
  test('compiles', () => {
    const ce = engine(['Tuple', 1, 2]);
    let u = ce.box(['Multiply', 'y', 'P']);
    for (let i = 0; i < 12; i++)
      u = ce.function('Add', [u, ce.function('Multiply', [ce.box('y'), u])]);
    ce.declare('f', 'function');
    ce.assign(
      'f',
      ce.function('Function', [
        ce.function('Add', [ce.function('Multiply', ['t', 'P']), u]),
        ce.box('t'),
      ])
    );
    const r = compile(ce.parse('f(x).x'), { to: 'glsl', fallback: false });
    expect(r.success).toBe(true);
  });
});

describe('CE-593: the inlining of point calls has a budget', () => {
  // Each level calls the level below twice, and the walk of a callee body
  // keeps no results, so the number of inlined bodies doubles with each
  // level. Without a budget, 16 levels took about 20 s before the shader
  // size check. The walk stops after 512 bodies.
  function chain(depth: number): ComputeEngine {
    const ce = engine(['Tuple', 1, 2]);
    ce.parse('f_0(t) := t P').evaluate();
    for (let i = 1; i <= depth; i++)
      ce.parse(`f_{${i}}(t) := f_{${i - 1}}(t) + f_{${i - 1}}(t+1)`).evaluate();
    return ce;
  }

  test('a short chain compiles', () => {
    const r = compile(chain(4).parse('f_{4}(x).x'), {
      to: 'glsl',
      fallback: false,
    });
    expect(r.success).toBe(true);
  });

  test('a long chain declines', () => {
    const start = performance.now();
    expect(compileError(chain(16), 'f_{16}(x).x', 'glsl')).toMatch(
      /would be written out more than 512 times/
    );
    if (process.env.CE_PERF === '1')
      expect(performance.now() - start).toBeLessThan(2_000);
  });
});
