import { ComputeEngine, compile } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

// CE-580. `compileShader()` wrote each body statement as
// `<variable> = <code>;` and did not check the target `variable`. A target
// that is not an output of the shader, a value whose type is not the type of
// the target, and an assignment in a compute shader (which has no outputs)
// gave a shader that fails only when the GPU compiles it. Each one is now
// refused when the shader is compiled.

const ce = new ComputeEngine();
const glsl = new GLSLTarget();

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
    // The fragment gives `ivec2` no type, so each conversion declines.
    expect(() => shader('330', 'vec2')).toThrow(/The name `k` is declared `ivec2`, which has no type in the GLSL fragment/);
    expect(() => shader('450', 'uvec2')).toThrow(/The name `k` is declared `ivec2`, which has no type in the GLSL fragment/);
    expect(() => shader('330', 'uvec2')).toThrow(/The name `k` is declared `ivec2`, which has no type in the GLSL fragment/);
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
});

describe('CE-580 GLSL writes a target of several components at once', () => {
  it('a GLSL target of several components is one assignment', () => {
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
});

describe('CE-580 a value of another type than the target is refused', () => {
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
    ).toThrow(/The name `k` is declared `ivec2`, which has no type in the GLSL fragment/);
  });
});

describe('CE-580 a value whose type is not certain is not checked', () => {
  // The emitter gives the width of a compound value operator by operator, so
  // the type of `s * uv` is not known before it is emitted. Such a value is
  // not checked, and the shader is the same as before the check.
  const cases: Array<[string, unknown, string]> = [
    ['uv * s', ['Multiply', 'uv', 's'], 's * uv'],
    ['uv + uv', ['Add', 'uv', 'uv'], 'uv + uv'],
    ['-uv', ['Negate', 'uv'], '-uv'],
    ['Sin(uv)', ['Sin', 'uv'], '_gpu_sin2(uv)'],
    [
      'If with vector branches',
      ['If', ['Greater', 's', 0], 'uv', ['Negate', 'uv']],
      '((0.0 < s) ? (uv) : (-uv))',
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

  for (const [name, expression, glslCode] of cases) {
    it(`${name} into a vec2 output`, () => {
      expect(glslShader(expression)).toContain(`  c = ${glslCode};\n`);
    });
  }

  it('a Block that returns a vector declares its local as a vector', () => {
    // The local `q` and the temporary `_tv1` were declared `float`, which a
    // `vec2` value does not fit.
    const block = [
      'Block',
      ['Declare', 'q', "'unknown'", ['Multiply', 2, 'uv']],
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
  });

  it('a function of a vector expression takes the vector helper', () => {
    // `2·uv` was read as a float, so the `float` helper received a `vec2`.
    expect(glslShader(['Sin', ['Multiply', 2, 'uv']])).toContain(
      '  c = _gpu_sin2(2.0 * uv);\n'
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
      /The name `M` is declared `mat2`, which has no type in the GLSL fragment/
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
    ).toThrow(
      /The name `A` is declared `float\[5\]`, which has no type in the GLSL fragment/
    );
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
  });

  it('GLSL has no compute shader', () => {
    for (const body of [[], [{ variable: 'r', expression: ce.box(1) }]])
      expect(() =>
        glsl.compileShader({ type: 'compute' as never, body })
      ).toThrow(
        'Could not compile `compileShader()`: the GLSL target writes only ' +
          'vertex and fragment shaders, not a "compute" shader. GLSL ES 3.00 ' +
          '(WebGL 2) has no compute stage.'
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
  const code = (target: GLSLTarget, json: unknown) =>
    target.compile(ce.box(json as never), { constantFold: false }).code;

  it('Abs of a point is its length, a scalar', () => {
    // `Abs` of a point compiles to `Norm`, so the local is not a vector.
    const json = ['Block', ['Assign', 'q', ['Abs', ['Tuple', 'x', 1]]], 'q'];
    expect(code(glsl, json)).toBe(
      'float q;\nq = length(vec2(x, 1.0));\nreturn q;'
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
      ['Declare', 'p', "'any'", ['List', 1, 2]],
      ['Assign', 'q', ['Sin', 'p']],
      'q',
    ];
    // The fragment gives a local a scalar, complex or point type.
    expect(() => code(glsl, json)).toThrow(
      /The local `p` is a list: a function body of the GLSL fragment has scalar, complex or point locals/
    );
  });

  // The declared type `real` and the assigned list have different shape
  // classes. The declared type of a local settles its shape, so the
  // compilation declines (CE-712.1, the simple rule for assignments).
  it('a local declared `real` that is assigned a point declines', () => {
    const json = [
      'Block',
      ['Declare', 'p', "'real'", ['List', 'x', 2]],
      ['Assign', 'q', ['Add', 'p', 1]],
      'q',
    ];
    expect(() => code(glsl, json)).toThrow(
      /The local `p` is declared `real`, and its value has the type `list<real, 2>`/
    );
  });
});

describe('CE-580 a vector value of another width than the target', () => {
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
    ['Declare', 'p', "'real'", ['List', 'x', 2]],
    ['Assign', 'q', ['Add', 'p', 1]],
    value,
  ];
  // The fragment refuses the local `p`, which is declared `real` and holds a
  // list, before the complex arithmetic is reached.
  const message = (_head: string) =>
    'The local `p` is declared `real`, and its value has the type ' +
    '`list<real, 2>`.';

  for (const [name, target] of [['GLSL', glsl]] as const) {
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
        const to = 'glsl';
        const refusal = `No signature of \`${head}\` in the GLSL fragment takes operands of the types`;
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
      const v2 = 'vec2';
      expect(target.compile(ce.box(['Add', 'x', 'ImaginaryUnit'])).code).toBe(
        `${v2}(x, 1.0)`
      );
      expect(
        target.compile(ce.box(['Multiply', 'x', 'ImaginaryUnit'])).code
      ).toBe(`${v2}(0.0, x)`);
    });
  }
});

describe('CE-580 the width of a loop Sum', () => {
  it('a loop Sum of vectors has a vector accumulator', () => {
    // The accumulator was declared `float`, which a `vec2` term does not fit.
    expect(() =>
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
    ).toThrow(
      /The body of `Product` has the type `point<2>`, and an aggregate of the GLSL fragment adds or multiplies/
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
    expect(() => glslShader('vec2', [[1], [2]])).toThrow(
      /The head `Matrix` is outside the GLSL fragment/
    );
  });

  it('a row Matrix is an array of one row, and a square one a matrix', () => {
    expect(() => glslShader('vec2', [[1, 2]])).toThrow(
      /The head `Matrix` is outside the GLSL fragment/
    );
    expect(() =>
      glslShader('vec4', [
        [1, 2],
        [3, 4],
      ])
    ).toThrow(/The head `Matrix` is outside the GLSL fragment/);
  });
});

describe('a type spelling that is not GLSL in a declaration', () => {
  // GLSL has no `vec3f` type: writing `uniform vec3f u;` gives a shader that
  // does not compile on the GPU, so the declaration is refused.
  const shader = (declared: { uniform?: string; output?: string }) =>
    glsl.compileShader({
      type: 'fragment',
      uniforms: [{ name: 'u', type: declared.uniform ?? 'vec3' }],
      outputs: [{ name: 'o', type: declared.output ?? 'vec3' }],
      body: [{ variable: 'o', expression: ce.box(['Multiply', 2, 'u']) }],
    });

  it('is refused for a uniform', () => {
    expect(() => shader({ uniform: 'vec3f' })).toThrow(
      'Could not compile `compileShader()`: the declared type `vec3f` of ' +
        '"u" is not a GLSL type.'
    );
    expect(() => shader({ uniform: 'highp vec3<f32>' })).toThrow(
      /the declared type `highp vec3<f32>` of "u" is not a GLSL type/
    );
  });

  it('is refused for an output', () => {
    expect(() => shader({ output: 'vec3f' })).toThrow(
      /the declared type `vec3f` of "o" is not a GLSL type/
    );
  });

  it('the GLSL spelling compiles', () => {
    expect(shader({})).toContain('uniform vec3 u;\n');
  });
});

describe('a type spelling that is not GLSL in a compileFunction() signature', () => {
  // `compileFunction()` writes the signature with the types as given, so
  // `f32 f(f32 x)` would be a function that does not compile on the GPU.
  const fn = (ret: string, param: string) =>
    glsl.compileFunction(ce.box(['Add', 'x', 1]), 'f', ret, [['x', param]]);

  it('is refused for a parameter', () => {
    expect(() => fn('float', 'f32')).toThrow(
      'Could not compile `compileFunction()`: the declared type `f32` of ' +
        'the parameter "x" is not a GLSL type.'
    );
  });

  it('is refused for the result', () => {
    expect(() => fn('f32', 'float')).toThrow(
      /the declared type `f32` of the result is not a GLSL type/
    );
  });

  it('the GLSL spelling compiles', () => {
    expect(fn('float', 'float')).toBe(
      'float f(float x) {\n  return x + 1.0;\n}'
    );
  });
});
