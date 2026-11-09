// A shader declares an input with a size fixed at compile time: a scalar, a
// vector, a matrix or an array of a stated length. No declaration holds a
// list of unknown length. A read of an input whose type is a collection with
// no static length therefore declines on the shader targets. Before this
// rule, with `L: list<real>`, `L` compiled to the GLSL code `L` with
// `success: true`, and no shader could declare `L` (CE-779).

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const glsl = new GLSLTarget();
const TARGETS = [['glsl', glsl]] as const;

function engineWith(decls: Record<string, string>): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(decls))
    ce.declare(name, type as never);
  return ce;
}

describe('A shader input with no static length declines', () => {
  const UNSIZED = [
    'list<real>',
    'list',
    'set<real>',
    'collection<real>',
    'indexed_collection<real>',
    'dictionary<real>',
    'matrix',
  ];

  describe.each(TARGETS)('on %s', (_, target) => {
    test.each(UNSIZED)('an input of type %s', (type) => {
      const ce = engineWith({ L: type });
      // The GLSL fragment refuses the symbol before any code is written.
      expect(() => target.compile(ce.box('L'))).toThrow(
        /has no type in the GLSL fragment|has no static count/
      );
    });

    // GLSL has no array of zero elements.
    test('an input that is a list of no element', () => {
      const ce = engineWith({ L: 'list<real^0>' });
      expect(() => target.compile(ce.box('L'))).toThrow(
        /The input `L` has the type `list<real, 0>`, which the GLSL target cannot hold as an input/
      );
    });

    test('an input that `vars` maps to a uniform', () => {
      const ce = engineWith({ L: 'list<real>' });
      expect(() =>
        target.compile(ce.box('L'), { vars: { L: 'u_L' } } as never)
      ).toThrow(/The list `L` has no static count: name it in the `storage` option/);
    });

    test('with `fallback: true` the interpreter gives the value', () => {
      const ce = engineWith({ L: 'list<real>' });
      const r = target.compile(ce.box('L'), { fallback: true } as never);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/has no static count/);
      expect(String(r.run?.({ L: [1, 2] }))).toBe('1,2');
    });

    test('an input with a static length still compiles', () => {
      const ce = engineWith({
        V: 'list<real^3>',
        W: 'list<real^7>',
        M: 'matrix<real^2x2>',
      });
      for (const name of ['V', 'W'])
        expect(target.compile(ce.box(name)).code).toBe(name);
      // The GLSL fragment has no matrix type.
      expect(() => target.compile(ce.box('M'))).toThrow(
        /has no type in the GLSL fragment/
      );
    });
  });
});
