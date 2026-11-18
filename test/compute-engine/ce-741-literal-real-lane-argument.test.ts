import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * A complex argument at a parameter of a `Function` literal that the
 * compiled body reads on the real lane, in `mode: 'complex'` on JavaScript.
 *
 * A use in the body can narrow a parameter with no declared type to a real
 * type: in `x ↦ Mod(x, 3)` the parameter `x` is typed `real`, and the body
 * is `_SYS.floorMod(x, 3)`. The call passes the real projection of the
 * argument (`_SYS.crealElements`): its real part when the value is real,
 * `NaN` otherwise. A call of a function defined on the engine already did
 * this (`realLaneArguments` in `compilation/compile-user-calls.ts`); a
 * `Block` local and an `Apply` of the literal passed the `{ re, im }`
 * object, and `f(Sqrt(y))` at `y = 16` gave `NaN` (or `4` for the `If`
 * body) where the interpreter gives `1`.
 *
 * The call reads the lane of each parameter from the literal alone, from
 * the type of the parameter (`literalRealLaneArguments()` in
 * `compilation/compile-function-literals.ts`), so the code does not depend
 * on the order of compilation or on an earlier compilation.
 */

const CX = { to: 'javascript', mode: 'complex', fallback: false } as const;

function applied(body: MathJsonExpression, arg: MathJsonExpression) {
  return ['Apply', ['Function', body, 'x'], arg] as MathJsonExpression;
}

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('y', 'real');
  ce.declare('L', 'list<real>');
  return ce;
}

describe('CE-741: a complex argument at a real-lane parameter of a literal', () => {
  // The compiler declines a `Block` local that holds a function literal.
  for (const [form, build] of [
    ['an Apply of the literal', applied],
  ] as const) {
    describe(form, () => {
      it('a parameter on the complex lane receives the complex value', () => {
        const r = compile(
          engine().box(build(['Add', 'x', 1], ['Sqrt', 'y'])),
          CX
        );
        expect(r.run!({ y: 16 })).toBe(5);
        expect(r.run!({ y: -16 })).toEqual({ re: 1, im: 4 });
      });
    });
  }

  for (const [form, build] of [
    ['an Apply of the literal', applied],
  ] as const) {
    it(`a declared signature \`(x: real) -> real\` does not narrow the body (${form})`, () => {
      // The signature does not narrow the symbol `x`, so the body `x + 1`
      // reads it on the complex lane, and the argument is passed whole.
      const ce = engine();
      const body: MathJsonExpression = [
        'Typed',
        ['Add', 'x', 1],
        { str: '(x: real) -> real' },
      ];
      const r = compile(ce.box(build(body, ['Sqrt', 'y'])), CX);
      expect(r.run!({ y: -16 })).toEqual({ re: 1, im: 4 });
    });
  }
});
