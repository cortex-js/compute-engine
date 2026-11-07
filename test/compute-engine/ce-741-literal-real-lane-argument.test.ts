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

const BODIES: Record<string, MathJsonExpression> = {
  Mod: ['Mod', 'x', 3],
  Remainder: ['Remainder', 'x', 3],
  Floor: ['Floor', 'x'],
  Ceil: ['Ceil', 'x'],
  Round: ['Round', 'x'],
  If: ['If', ['Greater', 'x', 0], ['Mod', 'x', 3], 'x'],
};

/** The interpreter's value at `y = 16`. */
const AT_16: Record<string, number> = {
  Mod: 1,
  Remainder: 1,
  Floor: 4,
  Ceil: 4,
  Round: 4,
  If: 1,
};

function local(body: MathJsonExpression, arg: MathJsonExpression) {
  return [
    'Block',
    ['Assign', 'f', ['Function', body, 'x']],
    ['f', arg],
  ] as MathJsonExpression;
}

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
  for (const [form, build] of [
    ['a Block local', local],
    ['an Apply of the literal', applied],
  ] as const) {
    describe(form, () => {
      for (const [name, body] of Object.entries(BODIES)) {
        it(`${name}: f(Sqrt(y)) at y = 16 is the interpreter's value`, () => {
          const ce = engine();
          const expr = ce.box(build(body, ['Sqrt', 'y']));
          const r = compile(expr, CX);
          expect(r.success).toBe(true);
          expect(r.code).toContain('_SYS.crealElements(_SYS.csqrt(');
          expect(r.run!({ y: 16 })).toBe(AT_16[name]);
          ce.assign('y', 16);
          expect(expr.evaluate().re).toBe(AT_16[name]);
        });
      }

      it('a non-real argument gives NaN', () => {
        // The interpreter gives an `incompatible-type` error for `Mod(4i, 3)`.
        const r = compile(engine().box(build(BODIES.Mod, ['Sqrt', 'y'])), CX);
        expect(r.run!({ y: -16 })).toBeNaN();
      });

      it('a list argument is projected element by element', () => {
        const r = compile(engine().box(build(BODIES.Mod, ['Sqrt', 'L'])), CX);
        expect(r.success).toBe(true);
        expect(r.run!({ L: [16, 25, -4] })).toEqual([1, 2, NaN]);
      });

      it('a parameter on the complex lane receives the complex value', () => {
        const r = compile(
          engine().box(build(['Add', 'x', 1], ['Sqrt', 'y'])),
          CX
        );
        expect(r.code).not.toContain('crealElements');
        expect(r.run!({ y: 16 })).toBe(5);
        expect(r.run!({ y: -16 })).toEqual({ re: 1, im: 4 });
      });
    });
  }

  it('two parameters: only the real-lane one is projected', () => {
    const ce = engine();
    const expr = ce.box([
      'Block',
      [
        'Assign',
        'g',
        ['Function', ['Add', ['Mod', 'x', 3], 'z'], 'x', 'z'],
      ],
      ['g', ['Sqrt', 'y'], ['Sqrt', 'y']],
    ]);
    const r = compile(expr, CX);
    expect(r.code).toContain(
      'g(_SYS.crealElements(_SYS.csqrt(({ re: _.y, im: 0 }))), ' +
        '_SYS.csqrt(({ re: _.y, im: 0 })))'
    );
    expect(r.run!({ y: 16 })).toBe(5);
  });

  it('a call of a local inside another local', () => {
    const ce = engine();
    const expr = ce.box([
      'Block',
      ['Assign', 'f', ['Function', ['Mod', 'x', 3], 'x']],
      ['Assign', 'h', ['Function', ['f', ['Sqrt', 'u']], 'u']],
      ['h', 'y'],
    ]);
    const r = compile(expr, CX);
    expect(r.success).toBe(true);
    expect(r.run!({ y: 16 })).toBe(1);
  });

  it('a call of a local defined later in the block', () => {
    // The body of `g` compiles before the `Assign` of `f`, so the call
    // cannot read anything recorded when `f` compiles.
    const ce = engine();
    const expr = ce.box([
      'Block',
      ['Assign', 'g', ['Function', ['f', ['Sqrt', 'u']], 'u']],
      ['Assign', 'f', ['Function', ['Mod', 'x', 3], 'x']],
      ['g', 'y'],
    ]);
    const r = compile(expr, CX);
    expect(r.success).toBe(true);
    expect(r.run!({ y: 16 })).toBe(1);
    // A second compilation of the same expression gives the same code.
    expect(compile(expr, CX).code).toBe(r.code);
  });

  it('a compilation in strict mode does not change a later one in complex mode', () => {
    const ce = engine();
    const expr = ce.box([
      'Block',
      ['Assign', 'g', ['Function', ['f', ['Sqrt', 'u']], 'u']],
      ['Assign', 'f', ['Function', ['Add', 'x', 1], 'x']],
      ['g', 'y'],
    ]);
    compile(expr, { to: 'javascript', fallback: false });
    const r = compile(expr, CX);
    expect(r.code).not.toContain('crealElements');
    expect(r.run!({ y: -16 })).toEqual({ re: 1, im: 4 });
  });

  it('a parameter annotated `real` in an Apply of the literal', () => {
    const ce = engine();
    const expr = ce.box([
      'Apply',
      ['Function', ['Mod', 'x', 3], ['Typed', 'x', { str: 'real' }]],
      ['Sqrt', 'y'],
    ]);
    const r = compile(expr, CX);
    expect(r.success).toBe(true);
    expect(r.run!({ y: 16 })).toBe(1);
  });

  for (const [form, build] of [
    ['a Block local', local],
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
      expect(r.code).not.toContain('crealElements');
      expect(r.run!({ y: -16 })).toEqual({ re: 1, im: 4 });
    });
  }

  it('the strict mode keeps the real lane and passes no projection', () => {
    const r = compile(engine().box(local(BODIES.Mod, ['Sqrt', 'y'])), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('crealElements');
    expect(r.run!({ y: 16 })).toBe(1);
  });
});
