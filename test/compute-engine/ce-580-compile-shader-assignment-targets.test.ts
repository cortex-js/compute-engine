import { ComputeEngine, compile } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

// CE-580. `compileShader()` wrote each body statement as
// `<variable> = <code>;` and did not check the target `variable`. A target
// that is not an output of the shader, a value whose type is not the type of
// the target, and an assignment in a compute shader (which has no outputs)
// gave a shader that fails only when the GPU compiles it. Each one is now
// refused when the shader is compiled.

const ce = new ComputeEngine();
const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

describe('CE-580 a valid output assignment compiles as before', () => {
  it('GLSL fragment: a whole output, a component, and gl_FragDepth', () => {
    const shader = glsl.compileShader({
      type: 'fragment',
      inputs: [{ name: 'x', type: 'float' }],
      outputs: [{ name: 'fragColor', type: 'vec4' }],
      body: [
        {
          variable: 'fragColor',
          expression: ce.box(['Tuple', 'x', 0, 0, 1]),
        },
        { variable: 'fragColor.g', expression: ce.box(['Multiply', 2, 'x']) },
        { variable: 'gl_FragDepth', expression: ce.box('x') },
      ],
    });
    expect(shader).toBe(
      '#version 300 es\n\nprecision highp float;\nprecision highp int;\n\n' +
        'in float x;\n\nout vec4 fragColor;\n\nvoid main() {\n' +
        '  fragColor = vec4(x, 0.0, 0.0, 1.0);\n' +
        '  fragColor.g = 2.0 * x;\n' +
        '  gl_FragDepth = x;\n' +
        '}\n'
    );
  });

  it('GLSL vertex: gl_Position, gl_PointSize, and two components', () => {
    const shader = glsl.compileShader({
      type: 'vertex',
      inputs: [{ name: 'p', type: 'vec4' }],
      outputs: [{ name: 'vColor', type: 'vec3' }],
      body: [
        { variable: 'gl_Position', expression: ce.box('p') },
        { variable: 'gl_PointSize', expression: ce.box(2) },
        { variable: 'vColor.rg', expression: ce.box(['Tuple', 1, 0.5]) },
      ],
    });
    expect(shader).toBe(
      '#version 300 es\n\nin vec4 p;\n\nout vec3 vColor;\n\nvoid main() {\n' +
        '  gl_Position = p;\n' +
        '  gl_PointSize = 2.0;\n' +
        '  vColor.rg = vec2(1.0, 0.5);\n' +
        '}\n'
    );
  });

  it('WGSL fragment: a field of `output`, and a component of one', () => {
    const shader = wgsl.compileShader({
      type: 'fragment',
      inputs: [{ name: 'x', type: 'f32', location: 0 }],
      outputs: [
        { name: 'c', type: 'f32', location: 0 },
        { name: 'color', type: 'vec4f', location: 1 },
      ],
      body: [
        { variable: 'output.c', expression: ce.box(['Multiply', 2, 'x']) },
        { variable: 'output.color.r', expression: ce.box('x') },
      ],
    });
    expect(shader).toBe(
      'struct FragmentInput {\n  @location(0) x: f32,\n};\n\n' +
        'struct FragmentOutput {\n  @location(0) c: f32,\n' +
        '  @location(1) color: vec4f,\n};\n\n' +
        '@fragment\nfn main(input: FragmentInput) -> FragmentOutput {\n' +
        '  var output: FragmentOutput;\n' +
        '  output.c = 2.0 * input.x;\n' +
        '  output.color.r = input.x;\n' +
        '  return output;\n}\n'
    );
  });

  it('WGSL vertex: a built-in output is a field of `output` too', () => {
    const shader = wgsl.compileShader({
      type: 'vertex',
      inputs: [{ name: 'p', type: 'vec4f', location: 0 }],
      outputs: [{ name: 'pos', type: 'vec4f', builtin: 'position' }],
      body: [{ variable: 'output.pos', expression: ce.box('p') }],
    });
    expect(shader).toContain('  output.pos = input.p;\n');
  });

  it('WGSL compute: an empty body is valid', () => {
    expect(
      wgsl.compileShader({ type: 'compute', workgroupSize: [8], body: [] })
    ).toBe('@compute\n@workgroup_size(8)\nfn main() {\n}\n');
  });

  it('desktop GLSL converts an integer vector to a float vector', () => {
    // GLSL 3.30 §4.1.10 converts `ivec2` to `vec2` in an assignment, and
    // GLSL 4.00 and later also convert `ivec2` to `uvec2`.
    const shader = (version: string, type: string) =>
      glsl.compileShader({
        type: 'fragment',
        version,
        uniforms: [{ name: 'k', type: 'ivec2' }],
        outputs: [{ name: 'o', type }],
        body: [{ variable: 'o', expression: ce.box('k') }],
      });
    expect(shader('330', 'vec2')).toContain('  o = k;\n');
    expect(shader('450', 'uvec2')).toContain('  o = k;\n');
    expect(() => shader('330', 'uvec2')).toThrow(
      /the value has the type `ivec2`, and the target "o" has the type `uvec2`/
    );
  });
});

describe('CE-580 a target that is not an output is refused', () => {
  it('GLSL: an undeclared name', () => {
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'fragColor', type: 'vec4' }],
        body: [{ variable: 'zz', expression: ce.box(1) }],
      })
    ).toThrow(
      'Could not compile the body statement "zz" of `compileShader()`: "zz" ' +
        'is not an output of the shader. A body statement must assign a ' +
        'declared output, or components of a vector output ' +
        '(`fragColor.x`). The outputs are "fragColor" (`vec4`), ' +
        '"gl_FragDepth" (`float`).'
    );
  });

  it('GLSL: gl_FragColor is not an output of GLSL ES 3.00', () => {
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        body: [{ variable: 'gl_FragColor.r', expression: ce.box(1) }],
      })
    ).toThrow(/"gl_FragColor\.r" is not an output of the shader/);
  });

  it('GLSL: the built-in output of another stage', () => {
    expect(() =>
      glsl.compileShader({
        type: 'vertex',
        body: [{ variable: 'gl_FragDepth', expression: ce.box(1) }],
      })
    ).toThrow(
      /"gl_FragDepth" is not an output of the shader\. .* The outputs are "gl_Position" \(`vec4`\), "gl_PointSize" \(`float`\)\./
    );
  });

  it('WGSL: an output name without `output.`', () => {
    expect(() =>
      wgsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'c', type: 'f32' }],
        body: [{ variable: 'c', expression: ce.box(1) }],
      })
    ).toThrow(
      'Could not compile the body statement "c" of `compileShader()`: "c" ' +
        'is not an output of the shader. A body statement must assign a ' +
        'declared output, or components of a vector output. The outputs ' +
        'are "output.c" (`f32`).'
    );
  });

  it('WGSL: a uniform is not an output', () => {
    expect(() =>
      wgsl.compileShader({
        type: 'fragment',
        uniforms: [{ name: 'u', type: 'f32' }],
        outputs: [{ name: 'c', type: 'f32' }],
        body: [{ variable: 'u', expression: ce.box(1) }],
      })
    ).toThrow(/"u" is not an output of the shader/);
  });

  it('WGSL: a shader with no outputs', () => {
    expect(() =>
      wgsl.compileShader({
        type: 'fragment',
        body: [{ variable: 'output.c', expression: ce.box(1) }],
      })
    ).toThrow(/This shader declares no outputs\./);
  });
});

describe('CE-580 WGSL writes a target of several components one at a time', () => {
  // WGSL accepts `output.color.rg = v;` only with the `swizzle_assignment`
  // language extension (WGSL §6.5.4, §9.2.2). A one-component target is a
  // reference without any extension (WGSL §8.5.1.3), so the value is bound
  // to a `let` and each component is assigned on its own.
  const shader = (
    outputs: Array<{ name: string; type: string; location?: number }>,
    body: Array<{ variable: string; expression: unknown }>
  ) =>
    wgsl.compileShader({
      type: 'fragment',
      inputs: [
        { name: 'uv', type: 'vec2f', location: 0 },
        { name: 'x', type: 'f32', location: 1 },
      ],
      outputs,
      body: body as never,
      constantFold: false,
    });
  const main = (code: string) =>
    code.slice(code.indexOf('  var output: FragmentOutput;\n'));

  it('two components', () => {
    expect(
      main(
        shader(
          [{ name: 'color', type: 'vec4f', location: 0 }],
          [{ variable: 'output.color.rg', expression: ce.box('uv') }]
        )
      )
    ).toBe(
      '  var output: FragmentOutput;\n' +
        '  let _tv1 = input.uv;\n' +
        '  output.color.r = _tv1.x;\n' +
        '  output.color.g = _tv1.y;\n' +
        '  return output;\n}\n'
    );
  });

  it('three components, in the order of the letters', () => {
    expect(
      main(
        shader(
          [{ name: 'p', type: 'vec3f', location: 0 }],
          [
            {
              variable: 'output.p.zyx',
              expression: ce.box(['Tuple', 'x', 2, 3]),
            },
          ]
        )
      )
    ).toBe(
      '  var output: FragmentOutput;\n' +
        '  let _tv1 = vec3f(input.x, 2.0, 3.0);\n' +
        '  output.p.z = _tv1.x;\n' +
        '  output.p.y = _tv1.y;\n' +
        '  output.p.x = _tv1.z;\n' +
        '  return output;\n}\n'
    );
  });

  it('four components', () => {
    expect(
      main(
        shader(
          [{ name: 'color', type: 'vec4f', location: 0 }],
          [
            {
              variable: 'output.color.abgr',
              expression: ce.box(['Tuple', 1, 0, 0, 'x']),
            },
          ]
        )
      )
    ).toBe(
      '  var output: FragmentOutput;\n' +
        '  let _tv1 = vec4f(1.0, 0.0, 0.0, input.x);\n' +
        '  output.color.a = _tv1.x;\n' +
        '  output.color.b = _tv1.y;\n' +
        '  output.color.g = _tv1.z;\n' +
        '  output.color.r = _tv1.w;\n' +
        '  return output;\n}\n'
    );
  });

  it('a value with a hoisted loop: the loop comes first', () => {
    const bigSum = ['Sum', ['Sin', 'i'], ['Limits', 'i', 1, 1000]];
    expect(
      main(
        shader(
          [{ name: 'color', type: 'vec4f', location: 0 }],
          [
            {
              variable: 'output.color.rg',
              expression: ce.box(['Tuple', ['Add', bigSum, 1], 'x']),
            },
          ]
        )
      )
    ).toBe(
      '  var output: FragmentOutput;\n' +
        '  var _tv1: f32 = 0.0;\n' +
        '  for (var i: i32 = 1; i <= 1000; i++) {\n' +
        '    _tv1 += _gpu_sin(f32(i));\n' +
        '  }\n' +
        '  let _tv2 = vec2f(_tv1 + 1.0, input.x);\n' +
        '  output.color.r = _tv2.x;\n' +
        '  output.color.g = _tv2.y;\n' +
        '  return output;\n}\n'
    );
  });

  it('the temporary does not take the name of an output', () => {
    expect(
      main(
        shader(
          [{ name: '_tv1', type: 'vec2f', location: 0 }],
          [{ variable: 'output._tv1.yx', expression: ce.box('uv') }]
        )
      )
    ).toBe(
      '  var output: FragmentOutput;\n' +
        '  let _tv2 = input.uv;\n' +
        '  output._tv1.y = _tv2.x;\n' +
        '  output._tv1.x = _tv2.y;\n' +
        '  return output;\n}\n'
    );
  });

  it('one component, and GLSL, keep a single assignment', () => {
    expect(
      shader(
        [{ name: 'color', type: 'vec4f', location: 0 }],
        [{ variable: 'output.color.g', expression: ce.box('x') }]
      )
    ).toContain('  output.color.g = input.x;\n');
    expect(
      glsl.compileShader({
        type: 'fragment',
        inputs: [{ name: 'uv', type: 'vec2' }],
        outputs: [{ name: 'fragColor', type: 'vec4' }],
        body: [{ variable: 'fragColor.rg', expression: ce.box('uv') }],
      })
    ).toContain('  fragColor.rg = uv;\n');
  });
});

describe('CE-580 a component selection that is not valid is refused', () => {
  const fragment =
    (variable: string, type = 'vec4') =>
    () =>
      glsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'o', type }],
        body: [{ variable, expression: ce.box(['Tuple', 1, 2]) }],
      });

  it('a repeated component', () => {
    expect(fragment('o.xx')).toThrow(
      'Could not compile the body statement "o.xx" of `compileShader()`: ' +
        '"o.xx" selects the components "xx" of the output "o" (`vec4`), but ' +
        'an assignment cannot write a component more than once.'
    );
  });

  it('letters from two sets', () => {
    expect(fragment('o.xg')).toThrow(
      /but these letters are not all from one of the sets "xyzw", "rgba", "stpq"\./
    );
  });

  it('a component that the vector does not have', () => {
    expect(fragment('o.zw', 'vec3')).toThrow(
      /selects the components "zw" of the output "o" \(`vec3`\), but the vector has only 3 components\./
    );
  });

  it('a component of a scalar output', () => {
    expect(fragment('o.x', 'float')).toThrow(
      /selects the components "x" of the output "o" \(`float`\), but the output is not a vector\./
    );
  });

  it('WGSL has no `stpq` set', () => {
    expect(() =>
      wgsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'color', type: 'vec4f' }],
        body: [{ variable: 'output.color.s', expression: ce.box(1) }],
      })
    ).toThrow(
      /these letters are not all from one of the sets "xyzw", "rgba"\./
    );
  });
});

describe('CE-580 a value of another type than the target is refused', () => {
  it('WGSL: a vec2f into an f32 output', () => {
    expect(() =>
      wgsl.compileShader({
        type: 'fragment',
        inputs: [{ name: 'uv', type: 'vec2f', location: 0 }],
        outputs: [{ name: 'c', type: 'f32', location: 0 }],
        body: [{ variable: 'output.c', expression: ce.box('uv') }],
      })
    ).toThrow(
      'Could not compile the body statement "output.c" of ' +
        '`compileShader()`: the value has the type `vec2f`, and the target ' +
        '"output.c" has the type `f32`. WGSL does not convert the one to ' +
        'the other in an assignment. Give the value the type of the target, ' +
        'or declare the output with the type of the value.'
    );
  });

  it('GLSL: a float into a vec4 output', () => {
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'fragColor', type: 'vec4' }],
        body: [{ variable: 'fragColor', expression: ce.box(1) }],
      })
    ).toThrow(
      'Could not compile the body statement "fragColor" of ' +
        '`compileShader()`: the value has the type `float`, and the target ' +
        '"fragColor" has the type `vec4`. GLSL does not convert the one to ' +
        'the other in an assignment. Give the value the type of the target, ' +
        'or declare the output with the type of the value.'
    );
  });

  it('GLSL: a float into two components', () => {
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'fragColor', type: 'vec4' }],
        body: [{ variable: 'fragColor.rg', expression: ce.box(1) }],
      })
    ).toThrow(
      /the value has the type `float`, and the target "fragColor\.rg" has the type `vec2`/
    );
  });

  it('GLSL: a vec3 into gl_Position', () => {
    expect(() =>
      glsl.compileShader({
        type: 'vertex',
        inputs: [{ name: 'p', type: 'vec3' }],
        body: [{ variable: 'gl_Position', expression: ce.box('p') }],
      })
    ).toThrow(
      /the value has the type `vec3`, and the target "gl_Position" has the type `vec4`/
    );
  });

  it('GLSL: a boolean into a float output', () => {
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        inputs: [{ name: 'x', type: 'float' }],
        outputs: [{ name: 'o', type: 'float' }],
        body: [{ variable: 'o', expression: ce.box(['Less', 'x', 1]) }],
      })
    ).toThrow(
      /the value has the type `bool`, and the target "o" has the type `float`/
    );
  });

  it('GLSL ES: an integer vector into a float vector', () => {
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        uniforms: [{ name: 'k', type: 'ivec2' }],
        outputs: [{ name: 'o', type: 'vec2' }],
        body: [{ variable: 'o', expression: ce.box('k') }],
      })
    ).toThrow(
      /the value has the type `ivec2`, and the target "o" has the type `vec2`/
    );
  });
});

describe('CE-580 a compute shader cannot assign', () => {
  it('every body statement is refused, and the message names compile()', () => {
    expect(() =>
      wgsl.compileShader({
        type: 'compute',
        workgroupSize: [8],
        uniforms: [{ name: 'uT', type: 'float' }],
        body: [{ variable: 'r', expression: ce.box(['Multiply', 'uT', 2]) }],
      })
    ).toThrow(
      'Could not compile the body statement "r" of `compileShader()`: a ' +
        'compute shader from `compileShader()` cannot write a result. It has ' +
        'no outputs and no storage buffer, so the statement would assign a ' +
        'name that the shader does not declare. To compute values on the ' +
        'GPU, use `compile()` or `WGSLTarget.compileFieldFunction()`.'
    );
  });
});

describe('CE-580 a value whose type is not certain is not checked', () => {
  // The emitter gives the width of a compound value operator by operator, so
  // the type of `s * uv` is not known before it is emitted. Such a value is
  // not checked, and the shader is the same as before the check.
  const cases: Array<[string, unknown, string, string]> = [
    ['uv * s', ['Multiply', 'uv', 's'], 's * uv', 's * input.uv'],
    ['uv + uv', ['Add', 'uv', 'uv'], 'uv + uv', 'input.uv + input.uv'],
    ['-uv', ['Negate', 'uv'], '-uv', '-input.uv'],
    ['Sin(uv)', ['Sin', 'uv'], '_gpu_sin2(uv)', '_gpu_sin2(input.uv)'],
    [
      'If with vector branches',
      ['If', ['Greater', 's', 0], 'uv', ['Negate', 'uv']],
      '((0.0 < s) ? (uv) : (-uv))',
      'select(-input.uv, input.uv, 0.0 < s)',
    ],
  ];
  const glslShader = (expression: unknown, type = 'vec2') =>
    glsl.compileShader({
      type: 'fragment',
      inputs: [{ name: 'uv', type: 'vec2' }],
      uniforms: [{ name: 's', type: 'float' }],
      outputs: [{ name: 'c', type }],
      body: [{ variable: 'c', expression: ce.box(expression as never) }],
    });
  const wgslShader = (expression: unknown, type = 'vec2f') =>
    wgsl.compileShader({
      type: 'fragment',
      inputs: [{ name: 'uv', type: 'vec2f', location: 0 }],
      uniforms: [{ name: 's', type: 'f32' }],
      outputs: [{ name: 'c', type, location: 0 }],
      body: [{ variable: 'output.c', expression: ce.box(expression as never) }],
    });

  for (const [name, expression, glslCode, wgslCode] of cases) {
    it(`${name} into a vec2 output`, () => {
      expect(glslShader(expression)).toContain(`  c = ${glslCode};\n`);
      expect(wgslShader(expression)).toContain(`  output.c = ${wgslCode};\n`);
    });
  }

  it('a Block that returns a vector declares its local as a vector', () => {
    // The local `q` and the temporary `_tv1` were declared `float`, which a
    // `vec2` value does not fit.
    const block = [
      'Block',
      ['Declare', 'q'],
      ['Assign', 'q', ['Multiply', 2, 'uv']],
      'q',
    ];
    expect(glslShader(block)).toBe(
      '#version 300 es\n\nprecision highp float;\nprecision highp int;\n\n' +
        'in vec2 uv;\n\nout vec2 c;\n\nuniform float s;\n\n' +
        'void main() {\n' +
        '  vec2 _tv1;\n' +
        '  {\n' +
        '    vec2 q;\n' +
        '    q = 2.0 * uv;\n' +
        '    _tv1 = q;\n' +
        '  }\n' +
        '  c = _tv1;\n' +
        '}\n'
    );
    expect(wgslShader(block)).toBe(
      'struct FragmentInput {\n  @location(0) uv: vec2f,\n};\n\n' +
        'struct FragmentOutput {\n  @location(0) c: vec2f,\n};\n\n' +
        '@group(0) @binding(0) var<uniform> s: f32;\n\n' +
        '@fragment\nfn main(input: FragmentInput) -> FragmentOutput {\n' +
        '  var output: FragmentOutput;\n' +
        '  var _tv1: vec2f;\n' +
        '  {\n' +
        '    var q: vec2f;\n' +
        '    q = 2.0 * input.uv;\n' +
        '    _tv1 = q;\n' +
        '  }\n' +
        '  output.c = _tv1;\n' +
        '  return output;\n' +
        '}\n'
    );
  });

  it('a function of a vector expression takes the vector helper', () => {
    // `2·uv` was read as a float, so the `float` helper received a `vec2`.
    expect(glslShader(['Sin', ['Multiply', 2, 'uv']])).toContain(
      '  c = _gpu_sin2(2.0 * uv);\n'
    );
    expect(wgslShader(['Sin', ['Multiply', 2, 'uv']])).toContain(
      '  output.c = _gpu_sin2(2.0 * input.uv);\n'
    );
    expect(
      glsl.compileFunction(
        ce.box(['Block', ['Assign', 'q', ['Multiply', 2, 'v']], 'q']),
        'f',
        'vec2',
        [['v', 'vec2']]
      )
    ).toBe('vec2 f(vec2 v) {\n  vec2 q;\n  q = 2.0 * v;\n  return q;\n}');
  });

  it('a compound scalar into a vector output is refused', () => {
    expect(() => glslShader(['Multiply', 's', 's'], 'vec4')).toThrow(
      /the value has the type `float`, and the target "c" has the type `vec4`/
    );
    expect(() => wgslShader(['Sin', ['Add', 's', 1]], 'vec4f')).toThrow(
      /the value has the type `f32`, and the target "output\.c" has the type `vec4f`/
    );
  });
});

describe('CE-580 the GLSL outputs and built-in variables have a type', () => {
  it('gl_FragCoord into a vec4 output, and an output into another', () => {
    const shader = glsl.compileShader({
      type: 'fragment',
      outputs: [
        { name: 'c', type: 'vec4' },
        { name: 'd', type: 'vec4' },
      ],
      body: [
        { variable: 'c', expression: ce.box('gl_FragCoord') },
        { variable: 'd', expression: ce.box('c') },
      ],
    });
    expect(shader).toContain('  c = gl_FragCoord;\n  d = c;\n');
  });

  it('a built-in variable of another type is refused', () => {
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'o', type: 'float' }],
        body: [{ variable: 'o', expression: ce.box('gl_FrontFacing') }],
      })
    ).toThrow(/the value has the type `bool`, and the target "o"/);
    expect(() =>
      glsl.compileShader({
        type: 'vertex',
        outputs: [{ name: 'o', type: 'vec2' }],
        body: [{ variable: 'o', expression: ce.box('gl_Position') }],
      })
    ).toThrow(
      /the value has the type `vec4`, and the target "o" has the type `vec2`/
    );
  });
});

describe('CE-580 a matrix or an array is not a scalar or a vector', () => {
  it('GLSL: a mat2 uniform into a vec4 output', () => {
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        uniforms: [{ name: 'M', type: 'mat2' }],
        outputs: [{ name: 'o', type: 'vec4' }],
        body: [{ variable: 'o', expression: ce.box('M') }],
      })
    ).toThrow(
      'Could not compile the body statement "o" of `compileShader()`: the ' +
        'value has the type `mat2`, and the target "o" has the type `vec4`. ' +
        'GLSL does not convert the one to the other in an assignment.'
    );
  });

  it('WGSL: a mat2 uniform into two components (no `let` is written)', () => {
    expect(() =>
      wgsl.compileShader({
        type: 'fragment',
        uniforms: [{ name: 'M', type: 'mat2' }],
        outputs: [{ name: 'o', type: 'vec4f' }],
        body: [{ variable: 'output.o.rg', expression: ce.box('M') }],
      })
    ).toThrow(
      /the value has the type `mat2`, and the target "output\.o\.rg" has the type `vec2f`/
    );
  });

  it('GLSL: an array uniform into a float output', () => {
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        uniforms: [{ name: 'A', type: 'float[5]' }],
        outputs: [{ name: 'o', type: 'float' }],
        body: [{ variable: 'o', expression: ce.box('A') }],
      })
    ).toThrow(/the value has the type `float\[5\]`, and the target "o"/);
  });
});

describe('CE-580 review: qualifiers, integer outputs, GLSL compute', () => {
  it('a GLSL qualifier before the output type is ignored', () => {
    const shader = (variable: string, expression: unknown) =>
      glsl.compileShader({
        type: 'fragment',
        inputs: [{ name: 'uv', type: 'vec2' }],
        outputs: [{ name: 'o', type: 'highp vec4' }],
        body: [{ variable, expression: ce.box(expression as never) }],
      });
    expect(shader('o.rg', 'uv')).toContain('  o.rg = uv;\n');
    expect(() => shader('o', 1)).toThrow(
      /the value has the type `float`, and the target "o" has the type `vec4`/
    );
  });

  it('an integer output cannot receive a float value', () => {
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        uniforms: [{ name: 's', type: 'float' }],
        outputs: [{ name: 'k', type: 'int' }],
        body: [{ variable: 'k', expression: ce.box('s') }],
      })
    ).toThrow(
      'Could not compile the body statement "k" of `compileShader()`: the ' +
        'value has the type `float`, and the target "k" has the type `int`. ' +
        '`compileShader()` computes float values, and cannot assign an ' +
        'integer output. Declare the output with a float type (`float`).'
    );
    expect(() =>
      wgsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'k', type: 'vec2u' }],
        body: [{ variable: 'output.k', expression: ce.box(['Tuple', 1, 2]) }],
      })
    ).toThrow(
      /cannot assign an integer output\. Declare the output with a float type \(`vec2f`\)\./
    );
  });

  it('GLSL has no compute shader', () => {
    for (const body of [[], [{ variable: 'r', expression: ce.box(1) }]])
      expect(() =>
        glsl.compileShader({ type: 'compute' as never, body })
      ).toThrow(
        'Could not compile `compileShader()`: the GLSL target writes only ' +
          'vertex and fragment shaders, not a "compute" shader. GLSL ES 3.00 ' +
          '(WebGL 2) has no compute stage. For a compute shader, use the ' +
          'WGSL target.'
      );
  });
});

describe('CE-580 the GLSL outputs and built-ins are in the shape frame', () => {
  const main = (shader: string) => shader.slice(shader.indexOf('void main'));

  it('Sin(gl_FragCoord) takes the vec4 helper', () => {
    // It was `_gpu_sin(gl_FragCoord)`, a `vec4` passed to a `float` helper.
    expect(
      main(
        glsl.compileShader({
          type: 'fragment',
          outputs: [{ name: 'c', type: 'vec4' }],
          body: [
            { variable: 'c', expression: ce.box(['Sin', 'gl_FragCoord']) },
          ],
        })
      )
    ).toBe('void main() {\n  c = _gpu_sin4(gl_FragCoord);\n}\n');
  });

  it('an output read by a later statement keeps its type', () => {
    expect(
      main(
        glsl.compileShader({
          type: 'fragment',
          outputs: [
            { name: 'c', type: 'vec4' },
            { name: 'd', type: 'vec4' },
          ],
          body: [
            { variable: 'c', expression: ce.box(['Tuple', 1, 2, 3, 4]) },
            { variable: 'd', expression: ce.box(['Sin', 'c']) },
          ],
        })
      )
    ).toBe(
      'void main() {\n  c = vec4(1.0, 2.0, 3.0, 4.0);\n  d = _gpu_sin4(c);\n}\n'
    );
  });

  it('gl_VertexID is converted in float arithmetic, not when assigned to an int', () => {
    const vertex = (type: string, expression: unknown) =>
      main(
        glsl.compileShader({
          type: 'vertex',
          outputs: [{ name: 'o', type }],
          body: [{ variable: 'o', expression: ce.box(expression as never) }],
        })
      );
    // `gl_VertexID + 1.0` adds an `int` and a `float`, which GLSL ES refuses.
    expect(vertex('float', ['Add', 'gl_VertexID', 1])).toBe(
      'void main() {\n  o = float(gl_VertexID) + 1.0;\n}\n'
    );
    expect(vertex('int', 'gl_VertexID')).toBe(
      'void main() {\n  o = gl_VertexID;\n}\n'
    );
  });

  it('WGSL: a @builtin(position) input is a vec4f', () => {
    expect(
      wgsl.compileShader({
        type: 'fragment',
        inputs: [{ name: 'pos', type: 'vec4f', builtin: 'position' }],
        outputs: [{ name: 'c', type: 'vec4f', location: 0 }],
        body: [{ variable: 'output.c', expression: ce.box(['Sin', 'pos']) }],
      })
    ).toContain('  output.c = _gpu_sin4(input.pos);\n');
  });
});

describe('CE-580 a GLSL qualifier does not hide the declared type', () => {
  it('an input declared `highp vec2` is a vec2', () => {
    // It was read as a name of unknown type, so `Sin` took the float helper.
    expect(
      glsl.compileShader({
        type: 'fragment',
        inputs: [{ name: 'uv', type: 'highp vec2' }],
        outputs: [{ name: 'c', type: 'vec2' }],
        body: [{ variable: 'c', expression: ce.box(['Sin', 'uv']) }],
      })
    ).toContain('in highp vec2 uv;\n\nout vec2 c;\n');
    expect(
      glsl.compileShader({
        type: 'fragment',
        inputs: [{ name: 'uv', type: 'highp vec2' }],
        outputs: [{ name: 'c', type: 'vec2' }],
        body: [{ variable: 'c', expression: ce.box(['Sin', 'uv']) }],
      })
    ).toContain('  c = _gpu_sin2(uv);\n');
  });

  it('a compileFunction parameter declared `highp vec2` is a vec2', () => {
    expect(
      glsl.compileFunction(ce.box(['Sin', 'v']), 'f', 'vec2', [
        ['v', 'highp vec2'],
      ])
    ).toContain('vec2 f(highp vec2 v) {\n  return _gpu_sin2(v);\n}');
  });
});

describe('CE-580 the width of a Block local', () => {
  const code = (target: GLSLTarget | WGSLTarget, json: unknown) =>
    target.compile(ce.box(json as never), { constantFold: false }).code;

  it('Abs of a point is its length, a scalar', () => {
    // `Abs` of a point compiles to `Norm`, so the local is not a vector.
    const json = ['Block', ['Assign', 'q', ['Abs', ['Tuple', 'x', 1]]], 'q'];
    expect(code(glsl, json)).toBe(
      'float q;\nq = length(vec2(x, 1.0));\nreturn q;'
    );
    expect(code(wgsl, json)).toBe(
      'var q: f32;\nq = length(vec2f(x, 1.0));\nreturn q;'
    );
  });

  it('Abs of a vector input stays element-wise', () => {
    expect(
      glsl.compileFunction(
        ce.box(['Block', ['Assign', 'q', ['Abs', 'v']], 'q']),
        'f',
        'vec2',
        [['v', 'vec2']]
      )
    ).toBe('vec2 f(vec2 v) {\n  vec2 q;\n  q = abs(v);\n  return q;\n}');
  });

  it('a local declared `any` that holds a point', () => {
    const json = [
      'Block',
      ['Declare', 'p', "'any'"],
      ['Assign', 'p', ['List', 1, 2]],
      ['Assign', 'q', ['Sin', 'p']],
      'q',
    ];
    expect(code(glsl, json)).toBe(
      'vec2 q;\nvec2 p;\np = vec2(1.0, 2.0);\nq = _gpu_sin2(p);\nreturn q;'
    );
    expect(code(wgsl, json)).toBe(
      'var q: vec2f;\nvar p: vec2f;\np = vec2f(1.0, 2.0);\nq = _gpu_sin2(p);\nreturn q;'
    );
  });

  it('a local declared `real` that holds a point', () => {
    const json = [
      'Block',
      ['Declare', 'p', "'real'"],
      ['Assign', 'p', ['List', 'x', 2]],
      ['Assign', 'q', ['Add', 'p', 1]],
      'q',
    ];
    expect(code(glsl, json)).toBe(
      'vec2 q;\nvec2 p;\np = vec2(x, 2.0);\nq = p + 1.0;\nreturn q;'
    );
    expect(code(wgsl, json)).toBe(
      'var q: vec2f;\nvar p: vec2f;\np = vec2f(x, 2.0);\nq = p + 1.0;\nreturn q;'
    );
  });
});

describe('CE-580 a vector value of another width than the target', () => {
  it('WGSL: a vec3 expression into two components is refused', () => {
    expect(() =>
      wgsl.compileShader({
        type: 'fragment',
        inputs: [{ name: 'uv', type: 'vec3f', location: 0 }],
        outputs: [{ name: 'color', type: 'vec4f', location: 0 }],
        body: [
          {
            variable: 'output.color.rg',
            expression: ce.box(['Multiply', 2, 'uv']),
          },
        ],
      })
    ).toThrow(
      'Could not compile the body statement "output.color.rg" of ' +
        '`compileShader()`: the value has 3 components, and the target ' +
        '"output.color.rg" has the type `vec2f`. WGSL does not convert the ' +
        'one to the other in an assignment. Give the value the type of the ' +
        'target, or declare the output with the type of the value.'
    );
  });

  it('GLSL: a vec3 expression into two components or a vec2 output', () => {
    const shader = (variable: string, expression: unknown) =>
      glsl.compileShader({
        type: 'fragment',
        inputs: [{ name: 'uv', type: 'vec3' }],
        outputs: [
          { name: 'color', type: 'vec4' },
          { name: 'c', type: 'vec2' },
        ],
        body: [{ variable, expression: ce.box(expression as never) }],
      });
    expect(() => shader('color.rg', ['Multiply', 2, 'uv'])).toThrow(
      /the value has 3 components, and the target "color\.rg" has the type `vec2`/
    );
    expect(() => shader('c', ['Sin', 'uv'])).toThrow(
      /the value has 3 components, and the target "c" has the type `vec2`/
    );
  });

  it('a vector expression of the width of the target compiles', () => {
    expect(
      wgsl.compileShader({
        type: 'fragment',
        inputs: [{ name: 'uv', type: 'vec2f', location: 0 }],
        outputs: [{ name: 'color', type: 'vec4f', location: 0 }],
        body: [
          {
            variable: 'output.color.rg',
            expression: ce.box(['Multiply', 2, 'uv']),
          },
        ],
      })
    ).toContain(
      '  let _tv1 = 2.0 * input.uv;\n' +
        '  output.color.r = _tv1.x;\n' +
        '  output.color.g = _tv1.y;\n'
    );
    expect(
      glsl.compileShader({
        type: 'fragment',
        inputs: [{ name: 'uv', type: 'vec2' }],
        outputs: [{ name: 'color', type: 'vec4' }],
        body: [
          { variable: 'color.xy', expression: ce.box(['Multiply', 2, 'uv']) },
        ],
      })
    ).toContain('  color.xy = 2.0 * uv;\n');
  });
});

describe('CE-580 an integer name into an integer target of another kind', () => {
  const shader = (version: string, from: string, to: string) =>
    glsl.compileShader({
      type: 'vertex',
      version,
      inputs: [{ name: 'k', type: from }],
      outputs: [{ name: 'o', type: to }],
      body: [{ variable: 'o', expression: ce.box('k') }],
    });

  it('names the integer type of the name', () => {
    expect(() => shader('300 es', 'int', 'uint')).toThrow(
      'Could not compile the body statement "o" of `compileShader()`: the ' +
        'value has the type `int`, and the target "o" has the type `uint`. ' +
        'GLSL does not convert the one to the other in an assignment.'
    );
    expect(() => shader('450', 'uint', 'int')).toThrow(
      /the value has the type `uint`, and the target "o" has the type `int`\. GLSL does not convert/
    );
  });

  it('a conversion that the version has is accepted', () => {
    expect(shader('450', 'int', 'uint')).toContain('  o = k;\n');
    expect(shader('300 es', 'int', 'int')).toContain('  o = k;\n');
  });
});

describe('CE-580 complex arithmetic on a vector is refused', () => {
  it('javascript: a list literal plus i is a list of complex numbers', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    const result = compile(
      e.box(['Add', ['List', 'x', 2], 'ImaginaryUnit'] as never),
      { to: 'javascript' }
    );
    expect(result.success).toBe(true);
    expect(result.run!({ x: 3 })).toEqual([
      { re: 3, im: 1 },
      { re: 2, im: 1 },
    ]);
  });

  // A complex value is a `vec2(re, im)`, and the complex lowering read a real
  // operand as a scalar: `q + i` with a `vec2` local `q` emitted
  // `vec2(q, 1.0)`, which is not valid source.
  const withVector = (value: unknown) => [
    'Block',
    ['Declare', 'p', "'real'"],
    ['Assign', 'p', ['List', 'x', 2]],
    ['Assign', 'q', ['Add', 'p', 1]],
    value,
  ];
  const message = (head: string) =>
    `Could not compile \`${head}\`: the operand \`q\` is a vector of 2 ` +
    'components, and the value is complex. A list of complex numbers has no ' +
    'representation on the GPU targets (each complex number is a `vec2`), ' +
    'so complex arithmetic on a vector is not supported there.';

  for (const [name, target] of [
    ['GLSL', glsl],
    ['WGSL', wgsl],
  ] as const) {
    it(`${name}: q + i and q · i`, () => {
      expect(() =>
        target.compile(ce.box(withVector(['Add', 'q', ['Sqrt', -1]]) as never))
      ).toThrow(message('Add'));
      expect(() =>
        target.compile(
          ce.box(withVector(['Multiply', 'q', 'ImaginaryUnit']) as never)
        )
      ).toThrow(message('Multiply'));
    });

    it(`${name}: a list literal plus i, through compile()`, () => {
      // The engine types `[x, 2] + i` as `vector<complex^2>`: two complex
      // numbers, which a shader cannot hold. It emitted
      // `vec2(vec2(x, 2.0), 1.0)` behind a reported success.
      const e = new ComputeEngine();
      e.declare('x', 'real');
      for (const [head, json] of [
        ['Add', ['Add', ['List', 'x', 2], 'ImaginaryUnit']],
        ['Multiply', ['Multiply', ['List', 'x', 2], 'ImaginaryUnit']],
      ] as const) {
        const to = name === 'GLSL' ? 'glsl' : 'wgsl';
        const refusal =
          `Could not compile \`${head}\`: the operand \`[x,2]\` is a vector ` +
          'of 2 components, and the value is complex. A list of complex ' +
          'numbers has no representation on the GPU targets';
        expect(() =>
          compile(e.box(json as never), { to, fallback: false })
        ).toThrow(refusal);
        expect(() => target.compile(e.box(json as never))).toThrow(refusal);
        // With the default fallback, the result reports the failure.
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          expect(compile(e.box(json as never), { to }).success).toBe(false);
        } finally {
          warn.mockRestore();
        }
      }
    });

    it(`${name}: a real scalar operand is still promoted`, () => {
      const v2 = name === 'GLSL' ? 'vec2' : 'vec2f';
      expect(target.compile(ce.box(['Add', 'x', 'ImaginaryUnit'])).code).toBe(
        `${v2}(x, 1.0)`
      );
      expect(
        target.compile(ce.box(['Multiply', 'x', 'ImaginaryUnit'])).code
      ).toBe(`${v2}(0.0, x)`);
    });
  }
});

describe('CE-580 the width of a selection, a Block, and a WGSL split', () => {
  const shader = (uvType: string, expression: unknown, variable: string) =>
    wgsl.compileShader({
      type: 'fragment',
      inputs: [{ name: 'uv', type: uvType, location: 0 }],
      uniforms: [{ name: 's', type: 'f32' }],
      outputs: [{ name: 'color', type: 'vec4f', location: 0 }],
      body: [{ variable, expression: ce.box(expression as never) }],
    });
  const selection = [
    'If',
    ['Greater', 's', 0],
    ['Sin', 'uv'],
    ['Negate', 'uv'],
  ];
  const block = [
    'Block',
    ['Declare', 'q'],
    ['Assign', 'q', ['Multiply', 2, 'uv']],
    'q',
  ];

  it('an If of vec3 values into two components is refused', () => {
    expect(() => shader('vec3f', selection, 'output.color.rg')).toThrow(
      /the value has 3 components, and the target "output\.color\.rg" has the type `vec2f`/
    );
  });

  it('an If of vec2 values into two components compiles', () => {
    expect(shader('vec2f', selection, 'output.color.rg')).toContain(
      '  let _tv1 = select(-input.uv, _gpu_sin2(input.uv), 0.0 < s);\n' +
        '  output.color.r = _tv1.x;\n' +
        '  output.color.g = _tv1.y;\n'
    );
  });

  it('a Block that returns a vec3 into two components is refused', () => {
    expect(() => shader('vec3f', block, 'output.color.rg')).toThrow(
      /the value has 3 components, and the target "output\.color\.rg" has the type `vec2f`/
    );
  });

  it('a Sum of vectors has the width of its body', () => {
    const sum = ['Sum', ['Multiply', 'k', 'uv'], ['Limits', 'k', 1, 3]];
    expect(shader('vec2f', sum, 'output.color.ba')).toContain(
      '  let _tv1 = ((1.0 * input.uv) + (2.0 * input.uv) + (3.0 * input.uv));\n' +
        '  output.color.b = _tv1.x;\n' +
        '  output.color.a = _tv1.y;\n'
    );
    expect(() => shader('vec2f', sum, 'output.color.b')).toThrow(
      /the value has 2 components, and the target "output\.color\.b" has the type `f32`/
    );
  });

  it('a loop Sum of vectors has a vector accumulator', () => {
    // The accumulator was declared `float`, which a `vec2` term does not fit.
    const sum = ['Sum', ['Multiply', 'k', 'uv'], ['Limits', 'k', 1, 1000]];
    expect(shader('vec2f', sum, 'output.color.ba')).toContain(
      '  var _tv1: vec2f = vec2f(0.0);\n' +
        '  for (var k: i32 = 1; k <= 1000; k++) {\n' +
        '    _tv1 += f32(k) * input.uv;\n' +
        '  }\n'
    );
    expect(
      glsl.compileShader({
        type: 'fragment',
        inputs: [{ name: 'uv', type: 'vec2' }],
        uniforms: [{ name: 's', type: 'float' }],
        outputs: [
          { name: 'c', type: 'vec2' },
          { name: 'd', type: 'float' },
        ],
        body: [
          {
            variable: 'c',
            expression: ce.box([
              'Product',
              ['Multiply', 'k', 'uv'],
              ['Limits', 'k', 1, 1000],
            ] as never),
          },
          {
            variable: 'd',
            expression: ce.box([
              'Sum',
              ['Multiply', 'k', 's'],
              ['Limits', 'k', 1, 1000],
            ] as never),
          },
        ],
      })
    ).toContain(
      '  vec2 _tv1 = vec2(1.0);\n' +
        '  for (int k = 1; k <= 1000; k++) {\n' +
        '    _tv1 *= float(k) * uv;\n' +
        '  }\n' +
        '  c = _tv1;\n' +
        '  float _tv2 = 0.0;\n' +
        '  for (int k = 1; k <= 1000; k++) {\n' +
        '    _tv2 += float(k) * s;\n' +
        '  }\n' +
        '  d = _tv2;\n'
    );
  });

  it('a value whose width is not known is refused for a split only', () => {
    // `Clamp` of a vector is a vector, but no width is read from it here.
    const clamp = ['Clamp', 'uv', 0, 1];
    expect(() => shader('vec2f', clamp, 'output.color.ba')).toThrow(
      'Could not compile the body statement "output.color.ba" of ' +
        '`compileShader()`: the number of components of the value cannot be ' +
        'determined, and WGSL assigns a target of 2 components one component ' +
        'at a time. Assign the whole output, or one component in each ' +
        'statement (`output.color.b`).'
    );
    expect(shader('vec4f', clamp, 'output.color')).toContain(
      '  output.color = '
    );
  });
});

describe('CE-580 a Matrix literal has the type it is written with', () => {
  const glslShader = (type: string, rows: number[][]) =>
    glsl.compileShader({
      type: 'fragment',
      outputs: [{ name: 'c', type }],
      body: [
        {
          variable: 'c',
          expression: ce.box([
            'Matrix',
            ['List', ...rows.map((r) => ['List', ...r])],
          ] as never),
        },
      ],
    });

  it('a column Matrix is a vector', () => {
    expect(glslShader('vec2', [[1], [2]])).toContain('  c = vec2(1.0, 2.0);\n');
    expect(
      wgsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'c', type: 'vec2f' }],
        body: [
          {
            variable: 'output.c',
            expression: ce.box([
              'Matrix',
              ['List', ['List', 1], ['List', 2]],
            ] as never),
          },
        ],
      })
    ).toContain('  output.c = vec2f(1.0, 2.0);\n');
  });

  it('a row Matrix is an array of one row, and a square one a matrix', () => {
    expect(() => glslShader('vec2', [[1, 2]])).toThrow(
      /the value has the type `vec2\[1\]`, and the target "c" has the type `vec2`/
    );
    expect(() =>
      glslShader('vec4', [
        [1, 2],
        [3, 4],
      ])
    ).toThrow(/the value has the type `mat2`, and the target "c"/);
  });
});
