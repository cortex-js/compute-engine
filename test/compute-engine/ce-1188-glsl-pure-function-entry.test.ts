/**
 * On the GLSL target, a `functions` entry that the caller declares pure
 * (`{ source, pure: true }`) has no effect other than its value. The
 * common-subexpression pass computes its call once, and a lowering may
 * write the call more than once or compute it ahead of other code, as on
 * the JavaScript target. An entry with no such declaration (a plain name)
 * still counts as code that the caller supplies, so these expressions
 * decline for it.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();
ce.declare('F', '(real) -> real');
ce.declare('x', 'real');
ce.declare('n', 'integer');
const glsl = new GLSLTarget();

const pure = { functions: { F: { source: 'myFn', pure: true } } };
const notDeclared = { functions: { F: 'myFn' } };

describe('CE-1188: a pure `functions` entry on GLSL', () => {
  it('an operand that the lowering writes twice computes the call once', () => {
    const expr = ce.box(['Cot', ['F', 'x']]);
    expect(glsl.canCompile(expr, pure)).toEqual({ ok: true });
    expect(glsl.compile(expr, pure).code).toBe(
      [
        'float _tv1 = myFn(x);',
        'return (_gpu_cos(_tv1) / _gpu_sin(_tv1));',
      ].join('\n')
    );
    expect(glsl.canCompile(expr, notDeclared).ok).toBe(false);
  });

  it('a loop may run ahead of the call', () => {
    const expr = ce.box([
      'Add',
      ['F', 'x'],
      ['Sum', ['Add', ['F', 'x'], 'k'], ['Limits', 'k', 1, 'n']],
    ]);
    expect(glsl.canCompile(expr, pure)).toEqual({ ok: true });
    expect(glsl.compile(expr, pure).code).toBe(
      [
        '_gpu_passes = 0;',
        'float _tv1 = 0.0;',
        'for (int k = 1; k <= int(floor(n)); k++) {',
        '  if (++_gpu_passes > 10000) break;',
        '  _tv1 += float(k) + myFn(x);',
        '}',
        'float _tv2 = _tv1 + myFn(x);',
        'return _gpu_passes > 10000 ? _gpu_nan() : _tv2;',
      ].join('\n')
    );
    expect(() => glsl.compile(expr, notDeclared)).toThrow(
      /ahead of the rest of its statement/
    );
  });
});
