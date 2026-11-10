/**
 * On the GLSL target, code that the caller supplies (a `vars` entry whose
 * source is not a plain read, a `functions` entry not declared pure, a
 * `compile` handler) is computed into a temporary of its shader type before
 * its statement, once per occurrence, in the order of the interpreter
 * (`gpu-caller-binding.ts`). A piece in a branch or a loop body is computed
 * at the start of that branch or of each iteration.
 *
 * `canCompile()` accepts each expression below, and `compile()` writes the
 * code shown. Before this, `compile()` declined the five expressions of the
 * first test although `canCompile()` accepted them.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();
ce.declare('W', 'real');
ce.declare('V', 'list<real^3>');
ce.declare('c', 'boolean');
ce.declare('n', 'integer');
ce.declare('a', 'real');
ce.assign('a', ce.box(['Max', 'V']));
const glsl = new GLSLTarget();
const vars = { W: 'nextValue()', V: 'vec3(nextValue())' };

const MAX_V = (t: string) => `(_gpu_max(_gpu_max(${t}.x, ${t}.y), ${t}.z))`;

function compiles(expr: any, code: string[]): void {
  const boxed = Array.isArray(expr) ? ce.box(expr as any) : expr;
  expect(glsl.canCompile(boxed, { vars })).toEqual({ ok: true });
  expect(glsl.compile(boxed, { vars }).code).toBe(code.join('\n'));
}

describe('CE-1176: caller code on GLSL is bound to temporaries', () => {
  it('the witnesses compile, with the caller code in the order of the interpreter', () => {
    compiles(
      ['Add', 'W', ['Max', 'V']],
      [
        'float _tv1 = nextValue();',
        'vec3 _tv2 = vec3(nextValue());',
        `return _tv1 + ${MAX_V('_tv2')};`,
      ]
    );
    compiles(
      ['Tuple', 'W', ['Max', 'V']],
      [
        'float _tv1 = nextValue();',
        'vec3 _tv2 = vec3(nextValue());',
        `return vec2(_tv1, ${MAX_V('_tv2')});`,
      ]
    );
    compiles(
      ['Add', 'W', ['Sum', ['Power', 'V', 2]]],
      [
        'float _tv1 = nextValue();',
        'vec3 _tv2 = vec3(nextValue());',
        'return _tv1 + dot(_tv2, _tv2);',
      ]
    );
    // The `W` of the loop body runs once per iteration, after the outer `W`.
    compiles(
      ['Add', 'W', ['Sum', ['Add', 'W', 'k'], ['Limits', 'k', 1, 'n']]],
      [
        '_gpu_passes = 0;',
        'float _tv1 = nextValue();',
        'float _tv2 = 0.0;',
        'for (int k = 1; k <= int(floor(n)); k++) {',
        '  if (++_gpu_passes > 10000) break;',
        '  float _tv3 = nextValue();',
        '  _tv2 += _tv3 + float(k);',
        '}',
        'float _tv4 = _tv1 + _tv2;',
        'return _gpu_passes > 10000 ? _gpu_nan() : _tv4;',
      ]
    );
    // `V` runs only when its branch is taken.
    compiles(
      ['If', 'c', ['Max', 'V'], 0],
      [
        'float _tv1;',
        'if (c) {',
        '  vec3 _tv2 = vec3(nextValue());',
        `  _tv1 = ${MAX_V('_tv2')};`,
        '} else {',
        '  _tv1 = 0.0;',
        '}',
        'return _tv1;',
      ]
    );
  });

  it('each occurrence is one evaluation', () => {
    compiles(
      ['Add', 'W', 'W'],
      [
        'float _tv1 = nextValue();',
        'float _tv2 = nextValue();',
        'return _tv1 + _tv2;',
      ]
    );
    // One node object at two places of the tree is evaluated at each place
    // by the interpreter.
    const w = ce.symbol('W');
    compiles(ce.function('Add', [w, ce.function('Sin', [w])]), [
      'float _tv1 = nextValue();',
      'float _tv2 = nextValue();',
      'return _tv1 + _gpu_sin(_tv2);',
    ]);
    // `a` has the value `Max(V)`: each read of `a` evaluates it.
    compiles(
      ['Add', 'a', 'a'],
      [
        'vec3 _tv1 = vec3(nextValue());',
        `float _tv2 = ${MAX_V('_tv1')};`,
        'vec3 _tv3 = vec3(nextValue());',
        `float _tv4 = ${MAX_V('_tv3')};`,
        'return _tv2 + _tv4;',
      ]
    );
  });

  it('caller code that a lowering writes twice runs once', () => {
    compiles(
      ['Cot', 'W'],
      ['float _tv1 = nextValue();', 'return (_gpu_cos(_tv1) / _gpu_sin(_tv1));']
    );
  });

  it('an operand evaluated on a condition runs in its branch', () => {
    // `And(c, b)` is written `If(c, b, False)`.
    compiles(
      ['And', 'c', ['Less', ['Max', 'V'], 0]],
      [
        'bool _tv1;',
        'if (c) {',
        '  vec3 _tv2 = vec3(nextValue());',
        `  _tv1 = ${MAX_V('_tv2')} < 0.0;`,
        '} else {',
        '  _tv1 = false;',
        '}',
        'return _tv1;',
      ]
    );
    // A chained comparison stops at the first pair that is false.
    compiles(
      ['Less', 0, 'W', ['Max', 'V']],
      [
        'float _tv1 = nextValue();',
        'bool _tv2;',
        'if (0.0 < _tv1) {',
        '  vec3 _tv3 = vec3(nextValue());',
        `  _tv2 = _tv1 < ${MAX_V('_tv3')};`,
        '} else {',
        '  _tv2 = false;',
        '}',
        'return _tv2;',
      ]
    );
    // A selection in statement position whose branches assign.
    compiles(
      [
        'Block',
        ['Declare', 's', 'real', 0],
        ['If', 'c', ['Assign', 's', ['Max', 'V']], ['Assign', 's', 'W']],
        's',
      ],
      [
        'float s;',
        's = 0.0;',
        'if (c) {',
        '  vec3 _tv2 = vec3(nextValue());',
        `  s = ${MAX_V('_tv2')};`,
        '} else {',
        '  float _tv1 = nextValue();',
        '  s = _tv1;',
        '}',
        'return s;',
      ]
    );
  });

  it('a user function written as a GLSL function binds its own caller code', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('W', 'real');
    ce2.declare('y', 'real');
    ce2.declare('k', '(real) -> real');
    ce2.assign('k', ce2.box(['Function', ['Cot', ['Add', 'x', 'W']], 'x']));
    const result = glsl.compile(ce2.box(['k', 'y']), { vars });
    expect(result.preamble).toContain(
      [
        'float _fn_k(float x) {',
        '  float _tv1 = nextValue();',
        '  return (_gpu_cos(_tv1 + x) / _gpu_sin(_tv1 + x));',
        '}',
      ].join('\n')
    );
    expect(result.code).toBe('_fn_k(y)');
  });

  // These decline: the code would run on a condition, at a position with no
  // statement of its own. `canCompile()` accepts them (`docs/COMPILATION-MODEL.md`,
  // known limitations).
  it('caller code evaluated on a condition with no place for a statement declines', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('W', 'real');
    ce2.declare('y', 'real');
    ce2.declare('n', 'integer');
    ce2.declare('c', 'boolean');
    // In the body of a user function, `And` and a chained comparison are
    // not written as an `If`.
    ce2.declare('g', '(real) -> boolean');
    ce2.assign('g', ce2.box(['Function', ['Less', 'x', 1, 'W', 2], 'x']));
    ce2.declare('h', '(real) -> boolean');
    ce2.assign(
      'h',
      ce2.box([
        'Function',
        ['And', ['Greater', 'x', 0], ['Greater', 'W', 0]],
        'x',
      ])
    );
    const declines = (expr: any, options: any = { vars }) =>
      expect(() => glsl.compile(ce2.box(expr), options)).toThrow(
        /is evaluated on a condition and contains code that the caller supplies/
      );
    declines(['g', 'y']);
    declines(['h', 'y']);
    // A guard of a `Loop` is evaluated on each pass.
    declines([
      'Block',
      ['Declare', 's', 'real', 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'i']],
        ['Element', 'i', ['Range', 1, 'n'], ['Less', 0, 'W']],
      ],
      's',
    ]);
    // An `And` that the caller maps is not written as an `If`.
    declines(['And', 'c', ['Less', 'W', 0]], {
      vars,
      functions: { And: 'myAnd' },
    });
  });
});
