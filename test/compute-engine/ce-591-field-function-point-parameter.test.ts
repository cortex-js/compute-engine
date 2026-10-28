/**
 * CE-591: a parameter of `WGSLTarget.compileFieldFunction()` that is a point,
 * a tuple of 2, 3 or 4 real numbers, is one `vec2f`, `vec3f` or `vec4f`
 * field of the uniform parameter struct. The type comes from the
 * declaration (`tuple<real, real, real>`), or from the value when the
 * symbol is not declared (`ce.assign('A', ['Tuple', 1, 2])`, as Tycho stores
 * a point). Inside the field, a read of the parameter is the WGSL vector
 * `ce_params.<name>`, so a whole-vector use (`distance`, `length`, `dot`)
 * and a component read (`A.x`, which parses to `PointX(A)`, and `A_1`,
 * which parses to `At(A, 1)`) compile as for a declared vector symbol.
 *
 * The offsets follow the WGSL layout rules (§14.4.1 "Alignment and Size"
 * and §14.4.5 "Address Space Layout Constraints" of the WGSL
 * specification): `vec2f` has alignment 8 and size 8, `vec3f` alignment 16
 * and size 12, `vec4f` alignment 16 and size 16.
 *
 * The shader text is run by the f32 evaluator of `gpu-shader-f32-eval.ts`,
 * with the parameter struct given as a global object, and compared with
 * the `javascript` target.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import type { FieldFunctionResult } from '../../src/compute-engine/compilation/types';
import { shaderFunctions } from './gpu-shader-f32-eval';

const XYZ = ['x', 'y', 'z'];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const s of XYZ) ce.declare(s, 'real');
  return ce;
}

function field(
  e: ReturnType<ComputeEngine['box']>,
  coordinates = XYZ
): FieldFunctionResult {
  return new WGSLTarget().compileFieldFunction(e, {
    name: 'f',
    coordinates,
  });
}

/**
 * The struct global of a parameter buffer: a scalar is a number, a point is
 * an object with the members `x`, `y`, `z`, `w` of its components, and a
 * list of n elements is `⌈n/4⌉` arrays of 4 numbers.
 */
function struct(
  r: FieldFunctionResult,
  values: Record<string, number | number[]>
): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  for (const p of r.params) {
    const v = values[p.name];
    if (typeof v === 'number') s[p.name] = Math.fround(v);
    else if (/^vec[234]f$/.test(p.wgslType)) {
      const point: Record<string, number> = {};
      v.forEach((c, i) => (point['xyzw'[i]] = Math.fround(c)));
      s[p.name] = point;
    } else {
      const entries: number[][] = [];
      for (let e = 0; e < p.size / 16; e++)
        entries.push(
          [0, 1, 2, 3].map((j) => {
            const w = v[4 * e + j];
            return w === undefined ? NaN : Math.fround(w);
          })
        );
      s[p.name] = entries;
    }
  }
  return s;
}

function runner(
  r: FieldFunctionResult,
  values: Record<string, number | number[]>
): (...args: number[]) => number {
  const src = [...Object.values(r.helpers), r.function].join('\n');
  const f = shaderFunctions(src, 'wgsl', { ce_params: struct(r, values) });
  return (...args) => f('f', ...args) as number;
}

const POINTS = [
  [0.3, -1.2, 2.1],
  [-2.4, 0.7, -0.4],
  [1.9, 1.1, 0.5],
  [0.0, -0.6, -2.2],
];

describe('CE-591 point parameters: the struct layout', () => {
  test('one vec2f, from an assigned tuple', () => {
    const ce = engine();
    ce.assign('A', ce.box(['Tuple', 1, 2]));
    const r = field(ce.parse('\\operatorname{distance}((x,y),A)'));
    expect(r.success).toBe(true);
    expect(r.function).toBe(
      'fn f(x: f32, y: f32, z: f32) -> f32 {\n' +
        '  return distance(vec2f(x, y), ce_params.A);\n' +
        '}\n'
    );
    expect(r.paramsStructSource).toBe('struct CEParams {\n  A: vec2f,\n}\n');
    expect(r.params).toEqual([
      {
        name: 'A',
        ceType: 'tuple<integer, integer>',
        wgslType: 'vec2f',
        offset: 0,
        size: 8,
      },
    ]);
    expect(r.paramsSize).toBe(16);
  });

  test('one vec3f, from a declared tuple', () => {
    const ce = engine();
    ce.declare('B', 'tuple<real, real, real>');
    const r = field(ce.box(['Distance', ['Tuple', 'x', 'y', 'z'], 'B']));
    expect(r.success).toBe(true);
    expect(r.function).toContain('distance(vec3f(x, y, z), ce_params.B)');
    expect(r.paramsStructSource).toBe('struct CEParams {\n  B: vec3f,\n}\n');
    expect(r.params).toEqual([
      {
        name: 'B',
        ceType: 'tuple<real, real, real>',
        wgslType: 'vec3f',
        offset: 0,
        size: 12,
      },
    ]);
    expect(r.paramsSize).toBe(16);
  });

  test('scalars, points and a list: the alignment padding is in the offsets', () => {
    const ce = engine();
    ce.declare('c', 'real');
    ce.declare('B', 'tuple<real, real, real>');
    ce.declare('E', 'tuple<integer, integer, integer, integer>');
    ce.declare('P', 'list<real^5>');
    ce.assign('A', ce.box(['Tuple', 1, 2]));
    const expr = ce.box([
      'Add',
      'c',
      ['PointX', 'A'],
      ['Distance', ['Tuple', 'x', 'y', 'z'], 'B'],
      ['Norm', 'E'],
      ['At', 'P', 2],
    ]);
    const r = field(expr);
    expect(r.success).toBe(true);
    expect(r.paramsStructSource).toBe(
      'struct CEParams {\n' +
        '  c: f32,\n' +
        '  A: vec2f,\n' +
        '  B: vec3f,\n' +
        '  E: vec4f,\n' +
        '  P: array<vec4f, 2>,\n' +
        '}\n'
    );
    // `c` ends at 4; `A` (alignment 8) starts at 8; `B` (alignment 16)
    // starts at 16 and ends at 28; `E` (alignment 16) starts at 32; the
    // list (alignment 16) starts at 48.
    expect(r.params.map((p) => [p.name, p.wgslType, p.offset, p.size])).toEqual(
      [
        ['c', 'f32', 0, 4],
        ['A', 'vec2f', 8, 8],
        ['B', 'vec3f', 16, 12],
        ['E', 'vec4f', 32, 16],
        ['P', 'array<vec4f, 2>', 48, 32],
      ]
    );
    expect(r.params.find((p) => p.name === 'P')?.length).toBe(5);
    expect(r.params.find((p) => p.name === 'E')?.length).toBeUndefined();
    expect(r.paramsSize).toBe(80);

    // The values: the f32 evaluator against the javascript target, with
    // every point declared in a reference engine so that its value is an
    // input of the javascript function.
    const ref = engine();
    ref.declare('c', 'real');
    ref.declare('A', 'tuple<real, real>');
    ref.declare('B', 'tuple<real, real, real>');
    ref.declare('E', 'tuple<integer, integer, integer, integer>');
    ref.declare('P', 'list<real^5>');
    const js = compile(ref.box(expr.json), { to: 'javascript' });
    expect(js.success).toBe(true);
    for (const values of [
      {
        c: 0.5,
        A: [1, 2],
        B: [0.5, -1, 2],
        E: [1, 2, 2, 4],
        P: [9, 8, 7, 6, 5],
      },
      {
        c: -2,
        A: [-3, 0.25],
        B: [0, 0, 0],
        E: [0, 0, 3, 4],
        P: [1, 2, 3, 4, 5],
      },
    ]) {
      const run = runner(r, values);
      for (const [x, y, z] of POINTS)
        expect(run(x, y, z)).toBeCloseTo(
          js.run!({ x, y, z, ...values } as never) as number,
          4
        );
    }
  });
});

describe('CE-591 point parameters: reads of the vector', () => {
  const ce = engine();
  ce.declare('B', 'tuple<real, real, real>');
  ce.assign('A', ce.box(['Tuple', 1, 2]));
  const ref = engine();
  ref.declare('A', 'tuple<real, real>');
  ref.declare('B', 'tuple<real, real, real>');

  test('LaTeX `A.x` parses to `PointX(A)`, and `A_1` to `At(A, 1)`', () => {
    expect(ce.parse('A.x').json).toEqual(['PointX', 'A']);
    expect(ce.parse('(X-A).x').json).toEqual([
      'PointX',
      ['Add', ['Negate', 'A'], 'X'],
    ]);
    expect(ce.parse('A_1').json).toEqual(['At', 'A', 1]);
  });

  test.each([
    [
      'component reads, LaTeX `A.x`',
      '(x - A.x)^2 + (y - A.y)^2 - 16',
      'ce_params.A.x',
    ],
    [
      'component reads, LaTeX `A_1`',
      '(x - A_1)^2 + (y - A_2)^2 + B_3',
      'ce_params.B.z',
    ],
    [
      'distance to a point of the coordinates',
      '\\operatorname{distance}((x,y),A) + \\operatorname{distance}((x,y,z),B)',
      'distance(vec2f(x, y), ce_params.A)',
    ],
  ])('%s', (_label, latex, read) => {
    const expr = ce.parse(latex);
    const r = field(expr);
    expect(r.success).toBe(true);
    expect(r.function).toContain(read);
    const js = compile(ref.parse(latex), { to: 'javascript' });
    expect(js.success).toBe(true);
    for (const values of [
      { A: [1, 2], B: [0.5, -1, 2] },
      { A: [-0.5, 3], B: [2, 1, -1] },
    ]) {
      const run = runner(r, values);
      for (const [x, y, z] of POINTS)
        expect(run(x, y, z)).toBeCloseTo(
          js.run!({ x, y, z, ...values } as never) as number,
          4
        );
    }
  });

  test('whole-vector reads: difference, `Norm`, `Abs`, `Dot`', () => {
    const json = [
      'Add',
      [
        'Divide',
        ['Dot', ['Subtract', 'B', ['Tuple', 'x', 'y', 'z']], 'B'],
        ['Norm', 'B'],
      ],
      ['Abs', ['Subtract', ['Tuple', 'x', 'y'], 'A']],
    ];
    const r = field(ce.box(json as never));
    expect(r.success).toBe(true);
    expect(r.function).toContain(
      'dot(ce_params.B + vec3f(-x, -y, -z), ce_params.B)'
    );
    expect(r.function).toContain('length(ce_params.B)');
    const js = compile(ref.box(json as never), { to: 'javascript' });
    expect(js.success).toBe(true);
    for (const values of [
      { A: [1, 2], B: [0.5, -1, 2] },
      { A: [-0.5, 3], B: [2, 1, -1] },
    ]) {
      const run = runner(r, values);
      for (const [x, y, z] of POINTS)
        expect(run(x, y, z)).toBeCloseTo(
          js.run!({ x, y, z, ...values } as never) as number,
          4
        );
    }
  });

  test('`At` with a computed index reads the vector field', () => {
    const r = field(ce.box(['At', 'B', ['Floor', 'x']]));
    expect(r.success).toBe(true);
    expect(r.function).toContain('_gpu_at3(ce_params.B, floor(x))');
    expect(r.helpers._gpu_at3).toContain('fn _gpu_at3(v: vec3f, i: f32)');
  });
});

describe('CE-591 point parameters: values are hidden', () => {
  test('a new point value gives the same text; the definition is restored', () => {
    const ce = engine();
    const latex =
      '(x - A.x)^2 + (y - A.y)^2 + \\operatorname{distance}((x,y),A) + |A|';
    ce.assign('A', ce.box(['Tuple', 1, 2]));
    const a = field(ce.parse(latex));
    expect(a.success).toBe(true);
    expect(ce.box('A').type.toString()).toBe('tuple<integer, integer>');
    expect(ce.box('A').value?.json).toEqual(['Tuple', 1, 2]);

    ce.assign('A', ce.box(['Tuple', 3.5, -2]));
    const b = field(ce.parse(latex));
    expect(b.success).toBe(true);
    expect(b.function).toBe(a.function);
    expect(b.helpers).toEqual(a.helpers);
    expect(b.paramsStructSource).toBe(a.paramsStructSource);
    expect(b.params.map((p) => [p.name, p.wgslType, p.offset, p.size])).toEqual(
      a.params.map((p) => [p.name, p.wgslType, p.offset, p.size])
    );
    expect(ce.box('A').value?.json).toEqual(['Tuple', 3.5, -2]);
    // No value is folded in the text.
    expect(a.function).not.toMatch(/3\.5|2\.0/);
    // The buffer value decides the result.
    expect(runner(a, { A: [3.5, -2] })(3.5, -2, 0)).toBeCloseTo(
      Math.hypot(3.5, 2),
      5
    );
  });

  test('a declared point: a new value gives the same text', () => {
    const ce = engine();
    ce.declare('B', 'tuple<real, real, real>');
    const e = ce.box(['Sqrt', ['PointZ', 'B']]);
    ce.assign('B', ce.box(['Tuple', 1, 2, 4]));
    const a = field(e);
    ce.assign('B', ce.box(['Tuple', 1, 2, -4]));
    const b = field(e);
    expect(a.success).toBe(true);
    expect(b).toEqual(a);
    expect(a.function).toContain('sqrt(ce_params.B.z)');
  });
});

describe('CE-591 point parameters: declines', () => {
  test.each([
    [
      'a tuple of 1 component',
      ['Tuple', 1],
      /"D" has the type `tuple<integer>`/,
    ],
    [
      'a tuple of 5 components',
      ['Tuple', 1, 2, 3, 4, 5],
      /"D" has the type `tuple<integer, integer, integer, integer, integer>`/,
    ],
    [
      'a complex component',
      ['Tuple', 1, ['Complex', 1, 2]],
      /"D" has the type `tuple<integer, complex>`/,
    ],
    [
      'a list component',
      ['Tuple', 1, ['List', 1, 2]],
      /"D" has the type `tuple<integer, vector<integer\^2>>`/,
    ],
    [
      'a NaN component',
      ['Tuple', 1, 'NaN'],
      /"D" has the type `tuple<integer, nan>`/,
    ],
  ])('%s', (_label, value, message) => {
    const ce = engine();
    ce.assign('D', ce.box(value as never));
    const r = field(ce.box(['Add', 'x', ['At', 'D', 1]]));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsupported-parameter');
    expect(r.diagnostic?.binding).toBe('D');
    expect(r.diagnostic?.message).toMatch(message);
    expect(r.diagnostic?.message).toMatch(/a point of 2, 3 or 4 real numbers/);
    expect(r.function).toBe('');
    expect(r.params).toEqual([]);
  });

  test('a declared complex component declines', () => {
    const ce = engine();
    ce.declare('K', 'tuple<real, complex>');
    const r = field(ce.box(['Add', 'x', ['PointX', 'K']]));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsupported-parameter');
    expect(r.diagnostic?.message).toMatch(
      /"K" has the type `tuple<real, complex>`/
    );
  });
});

describe('CE-591 point parameters: components declared `number`', () => {
  // The host writes only real values into the buffer, so a component
  // declared `number` is read as a real number, as a list parameter of type
  // `list<number^n>` is.
  test.each([
    ['tuple<number, number>', 'vec2f', 8, ['Tuple', 'x', 'y'], [1, -2]],
    [
      'tuple<number, number, number>',
      'vec3f',
      12,
      ['Tuple', 'x', 'y', 'z'],
      [0.5, -1, 2],
    ],
  ])('%s is a %s', (declared, wgslType, size, coordinates, value) => {
    const ce = engine();
    ce.declare('N', declared);
    const json = ['Add', ['PointX', 'N'], ['Distance', coordinates, 'N']];
    const r = field(ce.box(json as never));
    expect(r.success).toBe(true);
    expect(r.params).toEqual([
      { name: 'N', ceType: declared, wgslType, offset: 0, size },
    ]);
    expect(r.paramsStructSource).toBe(
      `struct CEParams {\n  N: ${wgslType},\n}\n`
    );
    expect(r.function).toContain('ce_params.N.x');
    expect(r.function).toContain(`distance(${wgslType}(`);
    const ref = engine();
    ref.declare('N', declared.replace(/number/g, 'real'));
    const js = compile(ref.box(json as never), { to: 'javascript' });
    expect(js.success).toBe(true);
    const run = runner(r, { N: value as number[] });
    for (const [x, y, z] of POINTS)
      expect(run(x, y, z)).toBeCloseTo(
        js.run!({ x, y, z, N: value } as never) as number,
        4
      );
  });
});

describe('CE-591 review: a user function that reads a parameter with an integer value', () => {
  // The value of a parameter is hidden while the field compiles, and its
  // type is the type of the value with no fact (`integer` becomes `real`).
  // A user function was typed with the integer type, and its callers read
  // the result type of that typing (`h(t) := a` returns an integer, so
  // `Floor(h(x))` would drop the `floor`). The field declines, and names
  // the remedy: declare the parameter before it is assigned. The engine
  // state is the same after the decline.
  const state = (ce: ComputeEngine, name: string) => [
    ce.box(name).type.toString(),
    JSON.stringify(ce.box(name).value?.json),
    ce.lookupDefinition('h')!.operator!.signature.toString(),
    ce.parse('h(10)').evaluate().toString(),
    compile(ce.parse('h(x)'), { to: 'javascript' }).code,
  ];

  test.each([
    ['a scalar', 'a', 5, 'a', 'real'],
    ['a list', 'L', ['List', 1, 2, 3], 't + L_2', 'vector<real^3>'],
    ['a point', 'A', ['Tuple', 1, 2], 't + A.x', 'tuple<real, real>'],
  ])('%s declines', (_label, name, value, body, now) => {
    const ce = engine();
    ce.assign(name, ce.box(value as never));
    ce.parse(`h(t) := ${body}`).evaluate();
    const before = state(ce, name);
    const r = field(ce.parse('\\lfloor h(x) \\rfloor'));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toContain(
      `the user-defined function "h" reads the parameter "${name}"`
    );
    expect(r.diagnostic?.message).toContain('was typed when');
    expect(r.diagnostic?.message).toContain(`ce.declare('${name}', '${now}')`);
    expect(state(ce, name)).toEqual(before);
  });

  test.each([
    ['a scalar', 'a', 'real', 5, 'a', { a: 2.5 }, () => 2],
    [
      'a point',
      'A',
      'tuple<real, real>',
      ['Tuple', 1, 2],
      't + A.x',
      { A: [2.5, 1] },
      (x: number) => Math.floor(x + 2.5),
    ],
  ])(
    '%s declared before its assignment compiles, and keeps `floor`',
    (_label, name, declared, value, body, values, want) => {
      const ce = engine();
      ce.declare(name, declared);
      ce.assign(name, ce.box(value as never));
      ce.parse(`h(t) := ${body}`).evaluate();
      const r = field(ce.parse('\\lfloor h(x) \\rfloor'));
      expect(r.success).toBe(true);
      expect(r.function).toContain('floor(_fn_1_f_h(x))');
      const run = runner(r, values as never);
      for (const [x, y, z] of POINTS) expect(run(x, y, z)).toBe(want(x));
    }
  );

  test('a parameter reassigned with a wider type declines, and does not throw', () => {
    const ce = engine();
    ce.assign('a', 5);
    ce.parse('h(t) := t + a').evaluate();
    ce.assign('a', 2.5);
    const r = field(ce.parse('h(x)'));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toContain('was typed when');
  });
});

describe('CE-591 review: a value that reads other symbols is written in place', () => {
  test('`A := (x, 1)` with the coordinate x', () => {
    const ce = engine();
    ce.assign('A', ce.box(['Tuple', 'x', 1]));
    const expr = ce.parse('A.x + y');
    const r = field(expr);
    expect(r.success).toBe(true);
    expect(r.params).toEqual([]);
    expect(r.function).toContain('vec2f(x, 1.0).x');
    const js = compile(expr, { to: 'javascript' });
    const run = runner(r, {});
    for (const [x, y, z] of POINTS)
      expect(run(x, y, z)).toBeCloseTo(
        js.run!({ x, y, z } as never) as number,
        5
      );
  });

  test('`a := x + 1` with the coordinate x', () => {
    const ce = engine();
    ce.assign('a', ce.parse('x + 1'));
    const expr = ce.parse('a y');
    const r = field(expr);
    expect(r.success).toBe(true);
    expect(r.params).toEqual([]);
    const js = compile(expr, { to: 'javascript' });
    const run = runner(r, {});
    for (const [x, y, z] of POINTS)
      expect(run(x, y, z)).toBeCloseTo(
        js.run!({ x, y, z } as never) as number,
        5
      );
  });

  test('`A := (a, b)` with the parameters a and b', () => {
    const ce = engine();
    ce.assign('a', 1);
    ce.assign('b', 2);
    ce.assign('A', ce.box(['Tuple', 'a', 'b']));
    const latex = '\\operatorname{distance}((x,y),A) + A.x';
    const r = field(ce.parse(latex));
    expect(r.success).toBe(true);
    expect(r.function).toContain(
      'distance(vec2f(x, y), vec2f(ce_params.a, ce_params.b))'
    );
    expect(r.paramsStructSource).toBe(
      'struct CEParams {\n  a: f32,\n  b: f32,\n}\n'
    );
    expect(r.params.map((p) => [p.name, p.wgslType, p.offset])).toEqual([
      ['a', 'f32', 0],
      ['b', 'f32', 4],
    ]);
    const ref = engine();
    ref.declare('A', 'tuple<real, real>');
    const js = compile(ref.parse(latex), { to: 'javascript' });
    for (const [a, b] of [
      [1, 2],
      [-3, 0.5],
    ]) {
      // A new value of a or b gives the same text and layout (the
      // `ceType` of a parameter is the type of its value).
      ce.assign('a', a);
      ce.assign('b', b);
      const again = field(ce.parse(latex));
      expect(again.function).toBe(r.function);
      expect(again.paramsStructSource).toBe(r.paramsStructSource);
      expect(again.params.map((p) => [p.name, p.offset, p.size])).toEqual(
        r.params.map((p) => [p.name, p.offset, p.size])
      );
      const run = runner(r, { a, b });
      for (const [x, y, z] of POINTS)
        expect(run(x, y, z)).toBeCloseTo(
          js.run!({ x, y, z, A: [a, b] } as never) as number,
          4
        );
    }
    expect(ce.box('A').value?.json).toEqual(['Tuple', 'a', 'b']);
  });

  test('`c := a + 1`: no fact of the value of a reaches the code', () => {
    const ce = engine();
    ce.assign('c', ce.parse('a + 1'));
    const texts: string[] = [];
    for (const v of [5, -5]) {
      ce.assign('a', v);
      const r = field(ce.parse('\\sqrt{c} + |c|'));
      expect(r.success).toBe(true);
      expect(r.params.map((p) => p.name)).toEqual(['a']);
      texts.push(r.function);
    }
    expect(texts[1]).toBe(texts[0]);
    expect(texts[0]).toContain('sqrt(');
    expect(texts[0]).toContain('abs(');
  });

  test('a value that reads itself through another symbol declines', () => {
    const ce = engine();
    ce.assign('p', ce.parse('q + 1'));
    ce.assign('q', ce.parse('p + 1'));
    const r = field(ce.parse('p + x'));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toMatch(/refers to itself/);
  });

  test('a constant value with `Pi` or a square root is a parameter', () => {
    const ce = engine();
    ce.assign('A', ce.box(['Tuple', 1.5, ['Sqrt', 2]]));
    ce.assign('P', ce.box(['Tuple', 1, 'Pi']));
    const r = field(ce.parse('A.y + P.y + x'));
    expect(r.success).toBe(true);
    expect(r.params.map((p) => [p.name, p.wgslType])).toEqual([
      ['A', 'vec2f'],
      ['P', 'vec2f'],
    ]);
  });
});

describe('CE-591 review: a value that calls a user function', () => {
  test('`c := g(2)` with `g` reading a coordinate declines as a capture', () => {
    const ce = engine();
    ce.parse('g(t) := t + x').evaluate();
    ce.assign('c', ce.parse('g(2)'));
    const r = field(ce.parse('c + y'));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toMatch(/"g" reads the coordinate "x"/);
  });

  test('`c := g(2)` with `g` reading the parameter k: k is the field, not c', () => {
    const ce = engine();
    ce.declare('k', 'real');
    ce.assign('k', 3);
    ce.parse('g(t) := t + k').evaluate();
    ce.assign('c', ce.parse('g(2)'));
    const r = field(ce.parse('c + y'));
    expect(r.success).toBe(true);
    expect(r.params.map((p) => p.name)).toEqual(['k']);
    expect(r.function).not.toContain('ce_params.c');
    expect(r.helpers._fn_1_f_g).toContain('ce_params.k');
    // The buffer value of k decides the result: 2 + k + y.
    expect(runner(r, { k: 10 })(0, 1, 0)).toBe(13);
  });

  test('`a := h(y)` with `h` reading the coordinate x declines as a capture', () => {
    const ce = engine();
    ce.parse('h(t) := t + x').evaluate();
    ce.assign('a', ce.parse('h(y)'));
    const r = field(ce.parse('a + z'));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toMatch(/"h" reads the coordinate "x"/);
  });

  test('a user function that reads `c := x + 1` declines as a capture', () => {
    const ce = engine();
    ce.assign('c', ce.parse('x + 1'));
    ce.parse('h(t) := t + c').evaluate();
    const r = field(ce.parse('h(y)'));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toMatch(/"h" reads the coordinate "x"/);
  });
});

describe('CE-591 review: outdated types derived from a hidden parameter', () => {
  test('a user `Gamma` that reads an integer point declines with the remedy', () => {
    const ce = engine();
    ce.assign('A', ce.box(['Tuple', 1, 2]));
    ce.parse('\\Gamma(t) := A.x').evaluate();
    const r = field(ce.box(['Floor', ['Gamma', 'x']]));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toContain(
      'the user-defined function "Gamma" reads the parameter "A"'
    );
    expect(r.diagnostic?.message).toContain(
      "ce.declare('A', 'tuple<real, real>')"
    );
  });

  test('a user `Gamma` that reads a declared point keeps `floor`', () => {
    const ce = engine();
    ce.declare('A', 'tuple<real, real>');
    ce.assign('A', ce.box(['Tuple', 1, 2]));
    ce.parse('\\Gamma(t) := A.x').evaluate();
    const r = field(ce.box(['Floor', ['Gamma', 'x']]));
    expect(r.success).toBe(true);
    expect(r.function).toMatch(/return floor\(_fn_1_f_Gamma\w*\(x\)\);/);
    expect(runner(r, { A: [2.5, 1] })(0, 0, 0)).toBe(2);
  });

  test('a user function that reads `c := a + 1` names the parameter a', () => {
    const ce = engine();
    ce.assign('a', 5);
    ce.assign('c', ce.parse('a + 1'));
    ce.parse('h(t) := c').evaluate();
    const r = field(ce.parse('\\lfloor h(x) \\rfloor'));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toContain(
      'the user-defined function "h" reads "c", whose value reads the parameter "a"'
    );
    expect(r.diagnostic?.message).toContain("ce.declare('a', 'real')");
  });

  test('`b := a` compiled in place names the parameter a', () => {
    const ce = engine();
    ce.assign('a', 5);
    ce.assign('b', ce.parse('a'));
    const r = field(ce.parse('\\lfloor b \\rfloor + x'));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toContain(
      'the value of "b" is compiled in place'
    );
    expect(r.diagnostic?.message).toContain("ce.declare('a', 'real')");
  });

  test('`b := a` with a declared before its assignment compiles', () => {
    const ce = engine();
    ce.declare('a', 'real');
    ce.assign('a', 5);
    ce.assign('b', ce.parse('a'));
    const r = field(ce.parse('\\lfloor b \\rfloor + x'));
    expect(r.success).toBe(true);
    expect(r.function).toContain('floor(ce_params.a)');
    expect(runner(r, { a: 2.5 })(1, 0, 0)).toBe(3);
  });
});

describe('CE-591 review: declared symbols compiled in place, and scopes', () => {
  test('a declared `b: integer` with `b := a` declines and names a', () => {
    const ce = engine();
    ce.assign('a', 5);
    ce.declare('b', 'integer');
    ce.assign('b', ce.parse('a'));
    const r = field(ce.parse('\\lfloor b \\rfloor + x'));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toContain(
      '"b" has the declared type `integer`'
    );
    expect(r.diagnostic?.message).toContain("ce.declare('a', 'integer')");
    expect(r.diagnostic?.message).toContain('or declare "b" as `real`');
  });

  test('with `a` declared `integer`, the host writes an integral value', () => {
    const ce = engine();
    ce.declare('a', 'integer');
    ce.assign('a', 5);
    ce.declare('b', 'integer');
    ce.assign('b', ce.parse('a'));
    const r = field(ce.parse('\\lfloor b \\rfloor + x'));
    expect(r.success).toBe(true);
    // The declared type is a promise of the host: `⌊a⌋` is `a`.
    expect(r.function).toContain('return x + ce_params.a;');
    expect(runner(r, { a: 2 })(0.5, 0, 0)).toBe(2.5);
  });

  test('with `b` declared `real`, the `floor` stays', () => {
    const ce = engine();
    ce.assign('a', 5);
    ce.declare('b', 'real');
    ce.assign('b', ce.parse('a'));
    const r = field(ce.parse('\\lfloor b \\rfloor + x'));
    expect(r.success).toBe(true);
    expect(r.function).toContain('floor(ce_params.a)');
    expect(runner(r, { a: 2.5 })(0.5, 0, 0)).toBe(2.5);
  });

  test('a parameter of a user function named like a global symbol', () => {
    const ce = engine();
    ce.parse('g(t) := t + x').evaluate();
    ce.assign('b', ce.parse('g(2)'));
    ce.parse('h(b) := b + 1').evaluate();
    const r = field(ce.parse('h(y)'));
    expect(r.success).toBe(true);
    expect(r.params).toEqual([]);
    const run = runner(r, {});
    for (const [x, y, z] of POINTS) expect(run(x, y, z)).toBeCloseTo(y + 1, 5);
  });

  test('a `Sum` index named like a global symbol', () => {
    const ce = engine();
    ce.parse('g(t) := t + x').evaluate();
    ce.assign('k', ce.parse('g(2)'));
    ce.parse('h(t) := \\sum_{k=1}^{3} k t').evaluate();
    for (const latex of ['\\sum_{k=1}^{3} k y', 'h(y)']) {
      const r = field(ce.parse(latex));
      expect(r.success).toBe(true);
      expect(r.params).toEqual([]);
      const run = runner(r, {});
      for (const [x, y, z] of POINTS)
        expect(run(x, y, z)).toBeCloseTo(6 * y, 4);
    }
  });
});
