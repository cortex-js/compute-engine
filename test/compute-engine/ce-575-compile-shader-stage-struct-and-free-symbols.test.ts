import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

// CE-575. `compileShader()` named the WGSL input struct `VertexInput` for
// every stage, and it emitted a body that reads a symbol that no input or
// uniform declares. Such a shader fails only when the GPU compiles it.

const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('k', 'real');
  ce.assign('a', 5);
  ce.parse('h(t) := t^2 + 1').evaluate();
  ce.parse('f(t) := t + z').evaluate();
  return ce;
}

const wgslFragment = (expression: unknown) =>
  wgsl.compileShader({
    type: 'fragment',
    inputs: [{ name: 'uv', type: 'float', location: 0 }],
    uniforms: [{ name: 'uT', type: 'float' }],
    outputs: [{ name: 'c', type: 'float', location: 0 }],
    body: [{ variable: 'output.c', expression: expression as never }],
  });

const glslFragment = (expression: unknown) =>
  glsl.compileShader({
    type: 'fragment',
    inputs: [{ name: 'uv', type: 'float' }],
    uniforms: [{ name: 'uT', type: 'float' }],
    outputs: [{ name: 'c', type: 'float' }],
    body: [{ variable: 'c', expression: expression as never }],
  });

describe('CE-575 the WGSL input struct is named for its stage', () => {
  it('vertex: VertexInput (unchanged)', () => {
    const shader = wgsl.compileShader({
      type: 'vertex',
      inputs: [{ name: 'p', type: 'vec3', location: 0 }],
      outputs: [{ name: 'pos', type: 'vec4', builtin: 'position' }],
      body: [],
    });
    expect(shader).toContain('struct VertexInput {');
    expect(shader).toContain('fn main(input: VertexInput) -> VertexOutput');
  });

  it('fragment: FragmentInput', () => {
    const shader = wgsl.compileShader({
      type: 'fragment',
      inputs: [{ name: 'uv', type: 'vec2', location: 0 }],
      outputs: [{ name: 'c', type: 'vec4', location: 0 }],
      body: [],
    });
    expect(shader).toContain('struct FragmentInput {');
    expect(shader).toContain('fn main(input: FragmentInput) -> FragmentOutput');
    expect(shader).not.toContain('VertexInput');
  });

  it('compute: ComputeInput, and no return type', () => {
    const shader = wgsl.compileShader({
      type: 'compute',
      workgroupSize: [8],
      inputs: [
        { name: 'gid', type: 'vec3<u32>', builtin: 'global_invocation_id' },
      ],
      uniforms: [{ name: 'uT', type: 'float' }],
      body: [
        { variable: 'r', expression: engine().box(['Multiply', 'uT', 2]) },
      ],
    });
    expect(shader).toBe(
      'struct ComputeInput {\n' +
        '  @builtin(global_invocation_id) gid: vec3<u32>,\n' +
        '};\n\n' +
        '@group(0) @binding(0) var<uniform> uT: f32;\n\n' +
        '@compute\n' +
        '@workgroup_size(8)\n' +
        'fn main(input: ComputeInput) {\n' +
        '  r = 2.0 * uT;\n' +
        '}\n'
    );
  });

  it('compute: outputs are refused (a compute entry point returns nothing)', () => {
    expect(() =>
      wgsl.compileShader({
        type: 'compute',
        outputs: [{ name: 'c', type: 'float', location: 0 }],
        body: [],
      })
    ).toThrow(/a WGSL compute shader has no stage outputs/);
  });

  it('compute: an input with no built-in is refused', () => {
    expect(() =>
      wgsl.compileShader({
        type: 'compute',
        inputs: [{ name: 'p', type: 'float', location: 0 }],
        body: [],
      })
    ).toThrow(/these compute shader inputs have no `builtin`: "p"/);
  });
});

describe('CE-575 a body that reads an undeclared symbol is refused', () => {
  it('compute stage, x + y: the message names both symbols', () => {
    const ce = engine();
    expect(() =>
      wgsl.compileShader({
        type: 'compute',
        workgroupSize: [8],
        inputs: [
          { name: 'gid', type: 'vec3<u32>', builtin: 'global_invocation_id' },
        ],
        body: [{ variable: 'r', expression: ce.parse('x+y') }],
      })
    ).toThrow(
      'Could not compile `compileShader()`: the body reads "x", "y", which ' +
        'no input or uniform of the shader declares. The emitted WGSL would ' +
        'read an undeclared name. Declare each name as an input or a ' +
        'uniform, or assign it a value.'
    );
  });

  it('the symbols of every statement are named', () => {
    const ce = engine();
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        outputs: [
          { name: 'c', type: 'float' },
          { name: 'd', type: 'float' },
        ],
        body: [
          { variable: 'c', expression: ce.parse('x+1') },
          { variable: 'd', expression: ce.parse('2y') },
        ],
      })
    ).toThrow(/the body reads "x", "y", which no input or uniform/);
  });

  for (const [name, shade] of [
    ['WGSL', wgslFragment],
    ['GLSL', glslFragment],
  ] as const) {
    it(`${name}: a declared symbol with no value is refused`, () => {
      expect(() => shade(engine().box(['Add', 'k', 'uv']))).toThrow(
        /the body reads "k", which no input or uniform/
      );
    });

    it(`${name}: a free symbol in the body of a user function is refused`, () => {
      expect(() => shade(engine().box(['f', 'uv']))).toThrow(
        /the body reads "z", which no input or uniform/
      );
    });

    it(`${name}: the declared names and the bound names still compile`, () => {
      const ce = engine();
      const cases: Array<[unknown, string]> = [
        // An input and a uniform.
        [ce.box(['Multiply', 'uT', 'uv']), 'uT'],
        // Library constants.
        [ce.box(['Add', 'uv', 'Pi', 'ExponentialE']), '3.14159265359'],
        // A symbol with a value in the engine folds.
        [ce.box(['Add', 'a', 'uv']), '5.0'],
        // The index of a `Sum` and of a `Product`.
        [
          ce.box(['Sum', ['Multiply', 'n', 'uv'], ['Limits', 'n', 1, 4]]),
          '4.0',
        ],
        [ce.box(['Product', ['Add', 'n', 'uv'], ['Limits', 'n', 1, 4]]), '4.0'],
        // A function-literal parameter.
        [ce.box(['Apply', ['Function', ['Add', 'q', 1], 'q'], 'uv']), '1.0'],
        // A user function, whose parameter is bound in its body.
        [ce.box(['h', 'uv']), '_fn_h('],
        // A `Block` local.
        [
          ce.box([
            'Block',
            ['Assign', 'w', ['Multiply', 2, 'uv']],
            ['Add', 'w', 1],
          ]),
          '_tv1',
        ],
      ];
      for (const [expr, fragment] of cases)
        expect(shade(expr)).toContain(fragment);
    });
  }

  it('GLSL: a `gl_` built-in variable and an output are in scope', () => {
    const ce = engine();
    expect(glslFragment(ce.box(['Add', 'gl_FragCoord', 1]))).toContain(
      'c = gl_FragCoord + 1.0;'
    );
    expect(glslFragment(ce.box(['Add', 'c', 1]))).toContain('c = c + 1.0;');
  });

  it('GLSL: a `gl_` name that is not a built-in of the stage is refused', () => {
    const ce = engine();
    expect(() => glslFragment(ce.box(['Add', 'gl_typo', 1]))).toThrow(
      /the body reads "gl_typo"/
    );
    // `gl_VertexID` is a built-in of the vertex stage only.
    expect(() => glslFragment(ce.box(['Add', 'gl_VertexID', 1]))).toThrow(
      /the body reads "gl_VertexID"/
    );
  });

  it('WGSL: a `gl_` name and a bare output name are refused', () => {
    // WGSL has no global built-in variables (a built-in value is an
    // entry-point input), and an output is a field of the `output` struct.
    const ce = engine();
    expect(() => wgslFragment(ce.box(['Add', 'gl_FragCoord', 1]))).toThrow(
      /the body reads "gl_FragCoord"/
    );
    expect(() => wgslFragment(ce.box(['Add', 'c', 1]))).toThrow(
      /the body reads "c"/
    );
  });
});

describe('WGSL compileShader(): declaration types and slots', () => {
  it('an integer or unsigned GLSL vector type becomes its WGSL type', () => {
    const shader = wgsl.compileShader({
      type: 'compute',
      workgroupSize: [8],
      inputs: [{ name: 'gid', type: 'uvec3', builtin: 'global_invocation_id' }],
      uniforms: [{ name: 'uA', type: 'ivec2' }],
      body: [],
    });
    expect(shader).toContain('@builtin(global_invocation_id) gid: vec3u,');
    expect(shader).toContain('var<uniform> uA: vec2i;');
    expect(shader).not.toMatch(/[iu]vec[234]/);
  });

  it('a boolean uniform, input or output is refused', () => {
    for (const options of [
      { uniforms: [{ name: 'uB', type: 'bool' }] },
      { uniforms: [{ name: 'uB', type: 'bvec4' }] },
      { inputs: [{ name: 'flag', type: 'bool', location: 0 }] },
      { outputs: [{ name: 'flag', type: 'bool', location: 0 }] },
    ])
      expect(() =>
        wgsl.compileShader({ type: 'fragment', body: [], ...options })
      ).toThrow(/"flag"|"uB"/);
  });

  it('a missing location or binding takes the next free one', () => {
    const shader = wgsl.compileShader({
      type: 'fragment',
      inputs: [
        { name: 'pos', type: 'vec4', builtin: 'position' },
        { name: 'uv', type: 'vec2' },
        { name: 'n', type: 'vec3', location: 0 },
      ],
      outputs: [
        { name: 'a', type: 'vec4' },
        { name: 'b', type: 'vec4' },
      ],
      uniforms: [
        { name: 'u1', type: 'float' },
        { name: 'u2', type: 'float', binding: 0 },
        { name: 'u3', type: 'float', group: 1 },
      ],
      body: [],
    });
    expect(shader).toContain('@location(1) uv: vec2f,');
    expect(shader).toContain('@location(0) n: vec3f,');
    expect(shader).toContain('@location(0) a: vec4f,');
    expect(shader).toContain('@location(1) b: vec4f,');
    expect(shader).toContain('@group(0) @binding(1) var<uniform> u1: f32;');
    expect(shader).toContain('@group(0) @binding(0) var<uniform> u2: f32;');
    expect(shader).toContain('@group(1) @binding(0) var<uniform> u3: f32;');
  });

  it('two declarations at the same location or binding are refused', () => {
    expect(() =>
      wgsl.compileShader({
        type: 'fragment',
        uniforms: [
          { name: 'u1', type: 'float', binding: 2 },
          { name: 'u2', type: 'float', binding: 2 },
        ],
        body: [],
      })
    ).toThrow(/"u1" and "u2" have the same binding \(group 0, 2\)/);
    expect(() =>
      wgsl.compileShader({
        type: 'vertex',
        inputs: [
          { name: 'p', type: 'vec3', location: 1 },
          { name: 'q', type: 'vec3', location: 1 },
        ],
        body: [],
      })
    ).toThrow(/"p" and "q" have the same location \(1\)/);
  });
});

describe('compileShader(): review cases', () => {
  it('a declaration shadows an engine value of the same name', () => {
    const ce = engine();
    ce.assign('q', ce.parse('w+1'));
    const options = {
      type: 'fragment' as const,
      uniforms: [{ name: 'q', type: 'float' }],
      outputs: [{ name: 'o', type: 'float', location: 0 }],
      body: [{ variable: 'o', expression: ce.parse('q*2') }],
    };
    expect(new GLSLTarget().compileShader(options)).toContain('2.0 * q');
    expect(new WGSLTarget().compileShader(options)).toContain('2.0 * q');
  });

  it('an integer value between the stages is flat on WGSL', () => {
    const vertex = new WGSLTarget().compileShader({
      type: 'vertex',
      inputs: [{ name: 'id', type: 'uint', location: 0 }],
      outputs: [
        { name: 'pos', type: 'vec4', builtin: 'position' },
        { name: 'cell', type: 'ivec2' },
        { name: 'w', type: 'float' },
      ],
      body: [],
    });
    expect(vertex).toContain('@location(0) id: u32,');
    expect(vertex).toContain('@location(0) @interpolate(flat) cell: vec2i,');
    expect(vertex).toContain('@location(1) w: f32,');
    const fragment = new WGSLTarget().compileShader({
      type: 'fragment',
      inputs: [{ name: 'cell', type: 'ivec2' }],
      body: [],
    });
    expect(fragment).toContain('@location(0) @interpolate(flat) cell: vec2i,');
  });
});

describe('compileShader(): second review cases', () => {
  it('a name in a branch that the emitter writes is refused', () => {
    // Both targets write the two branches of `If(True, 1, x)`
    // (`select(x, 1.0, true)` on WGSL), so `x` is read.
    const ce = engine();
    for (const target of [new GLSLTarget(), new WGSLTarget()])
      expect(() =>
        target.compileShader({
          type: 'fragment',
          outputs: [{ name: 'o', type: 'float', location: 0 }],
          body: [{ variable: 'o', expression: ce.box(['If', 'True', 1, 'x']) }],
        })
      ).toThrow(/the body reads "x"/);
  });

  it('an integer type written with spaces is flat too', () => {
    const fragment = new WGSLTarget().compileShader({
      type: 'fragment',
      inputs: [{ name: 'cell', type: 'vec3< u32 >' }],
      body: [],
    });
    expect(fragment).toContain('@interpolate(flat) cell');
  });
});

describe('compileShader(): third review case', () => {
  it('a local of a library helper is not read as a free symbol', () => {
    // `x^0` folds to `1.0`, so the emitted code never reads `x`; the gamma
    // helper has a local or parameter of its own that may be named `x`.
    const ce = engine();
    for (const target of [new GLSLTarget(), new WGSLTarget()]) {
      const shader = target.compileShader({
        type: 'fragment',
        uniforms: [{ name: 'u', type: 'float' }],
        outputs: [{ name: 'o', type: 'float', location: 0 }],
        body: [
          {
            variable: target instanceof WGSLTarget ? 'output.o' : 'o',
            expression: ce.function(
              'Add',
              [
                ce.function('Power', [ce.symbol('x'), ce.number(0)], {
                  form: 'structural',
                }),
                ce.function('Gamma', [ce.symbol('u')]),
              ],
              { form: 'structural' }
            ),
          },
        ],
      });
      expect(shader).toContain('_gpu_gamma(u)');
    }
  });
});

describe('compileShader(): fourth review case', () => {
  it('a dropped free symbol does not match a parameter of a user function', () => {
    const ce = engine();
    ce.parse('f(x) := x + 1').evaluate();
    for (const target of [new GLSLTarget(), new WGSLTarget()]) {
      const shader = target.compileShader({
        type: 'fragment',
        uniforms: [{ name: 'u', type: 'float' }],
        outputs: [{ name: 'o', type: 'float', location: 0 }],
        body: [
          {
            variable: target instanceof WGSLTarget ? 'output.o' : 'o',
            expression: ce.function(
              'Add',
              [
                ce.function('Power', [ce.symbol('x'), ce.number(0)], {
                  form: 'structural',
                }),
                ce.function('f', [ce.symbol('u')]),
              ],
              { form: 'structural' }
            ),
          },
        ],
      });
      expect(shader).toContain('_fn_f(u)');
    }
  });
});
