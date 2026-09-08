/**
 * Complex compile mode, the lift-at-use wrap on a user-function call.
 *
 * A call whose declared result is wide (`number`) is wrapped in the
 * idempotent `_SYS.cplx` at its use (`liftWideResult`), so a complex-lane
 * consumer can read `.re`/`.im` off whatever the callee returns. When the
 * emitted callee body returns a `{re, im}` object by construction, the wrap
 * is redundant and is skipped (`userFunctions.complexShaped`); when the body
 * returns a plain real, or its value position is a selection, the wrap stays.
 * Either way the VALUE a consumer computes is the interpreter's.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

const CX = { mode: 'complex', fallback: false } as const;

function engineWith(body: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('b', '(number) -> number');
  ce.assign('b', ce.parse(body));
  ce.declare('z', 'complex');
  return ce;
}

describe('complex mode: the lift-at-use wrap on a user-function call', () => {
  // The identity `x ↦ x` qualifies through its declared result: assigned to
  // `b: (number) -> number`, its canonical body is `Block(Typed(x, number))`,
  // and that wide ascription node is what the lift wraps inside the body, so
  // the emitted `_fn_b` returns `_SYS.cplx(x)`. A bare parameter with no
  // ascription would not be recorded, and its call would keep the wrap.
  test.each([
    ['x \\mapsto 2x', { re: 3, im: 6 }],
    ['x \\mapsto x', { re: 2, im: 4 }],
    ['x \\mapsto x^2 + 1', { re: -1, im: 6 }],
    ['x \\mapsto \\sqrt{x}', { re: 2.272019649514069, im: 2.7861513777574234 }],
  ])('a body that builds a {re, im} object skips the wrap: %s', (body, sum) => {
    const ce = engineWith(body);
    const call = compile(ce.box(['b', 'z']), CX);
    expect(call.code).toBe('_fn_b(_.z)');
    const consumer = compile(ce.box(['Add', ['b', 'z'], 'z']), CX);
    expect(consumer.code).not.toContain('_SYS.cplx(_fn_b');
    const value = consumer.run!({ z: { re: 1, im: 2 } }) as {
      re: number;
      im: number;
    };
    expect(value.re).toBeCloseTo(sum.re, 12);
    expect(value.im).toBeCloseTo(sum.im, 12);
  });

  test('a body that returns a real keeps the call unwrapped and is read as a real', () => {
    // `|x|` of a complex is a plain number: the analysis calls the call real,
    // so no wrap is emitted and the consumer adds it to the real part.
    const ce = engineWith('x \\mapsto |x|');
    const consumer = compile(ce.box(['Add', ['b', 'z'], 'z']), CX);
    expect(consumer.code).toBe('({ re: (_.z).re + _fn_b(_.z), im: (_.z).im })');
    expect(consumer.run!({ z: { re: 1, im: 2 } })).toEqual({
      re: 1 + Math.sqrt(5),
      im: 2,
    });
  });

  test('a selection body keeps the wrap, and its value is the object it builds', () => {
    // `If(x > 0, x, 3)` over an unannotated `x` types `integer` (the
    // `unknown` arm is a placeholder the other arm absorbs), but the emitter
    // lifts the wide arm, so the body returns `{re, im}` in both arms. The
    // call-site analysis reads the block's VALUE, not its type, so the call
    // is complex-valued and the consumer reads `.re`/`.im` off the object.
    // It used to read the block's type, and compiled
    // `(_.z).re + _fn_b(_.z)` around the object: `"1[object Object]"`.
    const ce = engineWith('x \\mapsto \\mathrm{If}(x > 0, x, 3)');
    const call = compile(ce.box(['b', 'z']), CX);
    expect(call.code).toBe('_SYS.cplx(_fn_b(_.z))');
    const consumer = compile(ce.box(['Add', ['b', 'z'], 'z']), CX);
    const value = consumer.run!({ z: { re: 1, im: 2 } });
    // A complex `z` is not real, so `z > 0` is false and the arm is `3`.
    expect(value).toEqual({ re: 4, im: 2 });
    // The runner hands a real-valued result back as a plain number.
    expect(consumer.run!({ z: { re: 5, im: 0 } })).toBe(10);
  });

  test('a body with an early Return keeps the wrap', () => {
    // The last statement builds an object, but the early `Return` hands
    // back a plain number: the call is wrapped, and both paths are read
    // correctly.
    const ce = new ComputeEngine();
    ce.declare('b', '(number) -> number');
    ce.assign(
      'b',
      ce.box([
        'Function',
        [
          'Block',
          ['If', ['Less', 100, 'x'], ['Return', 3]],
          ['Multiply', 2, 'x'],
        ],
        'x',
      ])
    );
    ce.declare('z', 'complex');
    const call = compile(ce.box(['b', 'z']), CX);
    expect(call.code).toBe('_SYS.cplx(_fn_b(_.z))');
    const consumer = compile(ce.box(['Add', ['b', 'z'], 'z']), CX);
    expect(consumer.run!({ z: { re: 1, im: 2 } })).toEqual({ re: 3, im: 6 });
    expect(consumer.run!({ z: { re: 200, im: 0 } })).toBe(203);
  });

  test('a constant body is real and is read as a real', () => {
    const ce = engineWith('x \\mapsto 3');
    const consumer = compile(ce.box(['Add', ['b', 'z'], 'z']), CX);
    expect(consumer.run!({ z: { re: 1, im: 2 } })).toEqual({ re: 4, im: 2 });
  });
});
