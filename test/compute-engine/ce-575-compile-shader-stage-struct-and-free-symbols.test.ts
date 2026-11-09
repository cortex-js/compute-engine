import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

// CE-575. `compileShader()` emitted a body that reads a symbol that no
// input or uniform declares. Such a shader fails only when the GPU compiles
// it.

const glsl = new GLSLTarget();

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real | signed_infinity | nan');
  ce.declare('k', 'real');
  ce.assign('a', 5);
  ce.parse('h(t) := t^2 + 1').evaluate();
  ce.parse('f(t) := t + z').evaluate();
  return ce;
}

const glslFragment = (expression: unknown) =>
  glsl.compileShader({
    type: 'fragment',
    inputs: [{ name: 'uv', type: 'float' }],
    uniforms: [{ name: 'uT', type: 'float' }],
    outputs: [{ name: 'c', type: 'float' }],
    body: [{ variable: 'c', expression: expression as never }],
  });

describe('CE-575 a body that reads an undeclared symbol is refused', () => {
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

  for (const [name, shade] of [['GLSL', glslFragment]] as const) {
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
      // A function-literal parameter: the GLSL fragment takes `Apply` only
      // as the application of a derivative.
      expect(() =>
        shade(ce.box(['Apply', ['Function', ['Add', 'q', 1], 'q'], 'uv']))
      ).toThrow(
        /`Apply` is in the GLSL fragment only as the application of a derivative whose closed form/
      );
    });
  }

  it('GLSL: a `gl_` built-in variable and an output are in scope', () => {
    const ce = engine();
    // `gl_FragCoord` is a `vec4`, so the output that receives it is a `vec4`
    // too: a `float` output is refused (CE-580).
    expect(
      glsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'c', type: 'vec4' }],
        body: [
          { variable: 'c', expression: ce.box(['Add', 'gl_FragCoord', 1]) },
        ],
      })
    ).toContain('c = gl_FragCoord + 1.0;');
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
});

describe('compileShader(): review cases', () => {
  it('a declaration shadows an engine value of the same name', () => {
    const ce = engine();
    ce.assign('q', ce.parse('w+1'));
    const options = (variable: string) => ({
      type: 'fragment' as const,
      uniforms: [{ name: 'q', type: 'float' }],
      outputs: [{ name: 'o', type: 'float', location: 0 }],
      body: [{ variable, expression: ce.parse('q*2') }],
    });
    expect(new GLSLTarget().compileShader(options('o'))).toContain('2.0 * q');
  });
});

describe('compileShader(): second review cases', () => {
  it('a name in a branch that the emitter writes is refused', () => {
    // The GLSL target writes the two branches of `If(True, 1, x)`, so `x`
    // is read.
    const ce = engine();
    for (const target of [new GLSLTarget()])
      expect(() =>
        target.compileShader({
          type: 'fragment',
          outputs: [{ name: 'o', type: 'float', location: 0 }],
          body: [
            {
              variable: 'o',
              expression: ce.box(['If', 'True', 1, 'x']),
            },
          ],
        })
      ).toThrow(/the body reads "x"/);
  });
});

describe('compileShader(): third review case', () => {
  it('a local of a library helper is not read as a free symbol', () => {
    // `x^0` folds to `1.0`, so the emitted code never reads `x`; the gamma
    // helper has a local or parameter of its own that may be named `x`.
    const ce = engine();
    for (const target of [new GLSLTarget()]) {
      const shader = target.compileShader({
        type: 'fragment',
        uniforms: [{ name: 'u', type: 'float' }],
        outputs: [{ name: 'o', type: 'float', location: 0 }],
        body: [
          {
            variable: 'o',
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
    for (const target of [new GLSLTarget()]) {
      const shader = target.compileShader({
        type: 'fragment',
        uniforms: [{ name: 'u', type: 'float' }],
        outputs: [{ name: 'o', type: 'float', location: 0 }],
        body: [
          {
            variable: 'o',
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
