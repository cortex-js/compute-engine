/**
 * `BigDecimal.precision` is one static for the program, but each engine has
 * its own precision (#556): an engine computes at its own precision whatever
 * other engines were built or set to, also when their evaluations interleave.
 */
import { BigDecimal } from '../../src/big-decimal';
import { ComputeEngine } from '../../src/compute-engine';

const digits = (ce: ComputeEngine, e: any = ['Divide', 1, 7]) =>
  ce
    .expr(e)
    .N()
    .toString()
    .replace(/[^0-9]/g, '').length;

const sqrt2 = (ce: ComputeEngine) => ce.expr(['Sqrt', 2]).N().toString();

describe('engine precision isolation', () => {
  test('a second engine does not change the first (#556)', () => {
    const a = new ComputeEngine();
    a.precision = 30;
    expect(sqrt2(a)).toBe('1.41421356237309504880168872421');
    const b = new ComputeEngine();
    b.precision = 'machine';
    a.precision = 30; // already 30: must still compute at 30
    expect(sqrt2(a)).toBe('1.41421356237309504880168872421');
    expect(b.precision).toBeLessThan(16);
    expect(sqrt2(b).replace(/[^0-9]/g, '').length).toBeLessThanOrEqual(17);
  });

  test('constructing an engine does not change another', () => {
    const ce = new ComputeEngine();
    ce.precision = 70;
    expect(digits(ce)).toBe(71);
    new ComputeEngine();
    expect(ce.precision).toBe(70);
    expect(digits(ce)).toBe(71);
    ce.precision = 70;
    expect(digits(ce)).toBe(71);
  });

  test('the static is as it was after the engine works', () => {
    const ce = new ComputeEngine({ precision: 90 });
    ce.precision = 60;
    const before = BigDecimal.precision;
    digits(ce);
    ce.parse('\\frac{1}{7}').N();
    ce.number('0.1234567890123456789012345678901234567890');
    ce.expr(['Sqrt', 2]).evaluate().toString();
    new ComputeEngine({ precision: 120 });
    expect(BigDecimal.precision).toBe(before);
  });

  test('each route reads the own precision of the engine', () => {
    const hi = new ComputeEngine({ precision: 60 });
    const lo = new ComputeEngine({ precision: 25 });
    expect(digits(hi, ['Divide', 1, 7])).toBe(61);
    expect(digits(lo, ['Divide', 1, 7])).toBe(26);
    expect(hi.parse('\\frac{1}{7}').N().toString()).toMatch(/^0\.\d{60}$/);
    expect(lo.parse('\\frac{1}{7}').N().toString()).toMatch(/^0\.\d{25}$/);
    // an interleaved sequence
    for (let i = 0; i < 3; i++) {
      expect(digits(lo, ['Sqrt', 3])).toBe(25);
      expect(digits(hi, ['Sqrt', 3])).toBe(60);
    }
  });

  test('a machine-precision engine is not affected by a wide one', () => {
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    const wide = new ComputeEngine({ precision: 100 });
    expect(digits(wide)).toBe(101);
    expect(digits(machine)).toBeLessThanOrEqual(18);
    expect(digits(wide)).toBe(101);
  });

  test('an engine called from inside another one computes at its own', () => {
    const outer = new ComputeEngine({ precision: 40 });
    const inner = new ComputeEngine({ precision: 20 });
    let innerDigits = 0;
    let outerAfter = 0;
    outer.declare('Probe', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        innerDigits = digits(inner);
        outerAfter = digits(outer);
        return x;
      },
    } as never);
    outer.expr(['Probe', 1]).evaluate();
    expect(innerDigits).toBe(21);
    expect(outerAfter).toBe(41);
  });

  test('an exception in one engine leaves the other intact', () => {
    const hi = new ComputeEngine({ precision: 80 });
    const lo = new ComputeEngine({ precision: 20 });
    hi.declare('Boom', {
      signature: '(number) -> number',
      evaluate: () => {
        throw new Error('boom');
      },
    } as never);
    expect(() => hi.expr(['Boom', 1]).evaluate()).toThrow('boom');
    expect(digits(lo)).toBe(21);
    expect(digits(hi)).toBe(81);
    const outside = BigDecimal.precision;
    expect(() => hi.expr(['Boom', 1]).evaluate()).toThrow('boom');
    expect(BigDecimal.precision).toBe(outside);
  });

  test('N(x, p) raises the working precision of its own engine only', () => {
    const a = new ComputeEngine({ precision: 20 });
    const b = new ComputeEngine({ precision: 20 });
    const r = a
      .expr(['N', ['Divide', 1, 7], 60])
      .evaluate()
      .toString();
    expect(r.replace(/[^0-9]/g, '').length).toBeGreaterThanOrEqual(60);
    expect(digits(b)).toBe(21);
    expect(digits(a)).toBe(21);
  });

  describe('asynchronous evaluation', () => {
    function gated(ce: ComputeEngine) {
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const started = new Promise<void>((r) => (entered = r));
      ce.declare('Gate', {
        signature: '() -> number',
        pure: false,
        evaluateAsync: async () => {
          entered();
          await gate;
          // after the await, another engine has run in between
          return ce.expr(['Divide', 1, 7]).N();
        },
      } as never);
      return { release, started };
    }

    test('engines interleaved at an await keep their own precision', async () => {
      const hi = new ComputeEngine({ precision: 70 });
      const lo = new ComputeEngine({ precision: 25 });
      const g = gated(hi);
      const pending = hi.expr(['Gate']).evaluateAsync();
      await g.started;
      // the other engine runs, sync and async, while `hi` is suspended
      expect(digits(lo)).toBe(26);
      const loAsync = await lo.expr(['Divide', 1, 7]).N().evaluateAsync();
      expect(loAsync.toString().replace(/[^0-9]/g, '').length).toBe(26);
      g.release();
      expect((await pending).toString().replace(/[^0-9]/g, '').length).toBe(71);
      expect(digits(lo)).toBe(26);
    });

    test('one evaluation awaiting inside another', async () => {
      const hi = new ComputeEngine({ precision: 70 });
      const lo = new ComputeEngine({ precision: 25 });
      const loHandle = gated(lo);
      let inner: Promise<string> | undefined;
      hi.declare('Nest', {
        signature: '() -> number',
        pure: false,
        evaluateAsync: async () => {
          inner = lo
            .expr(['Gate'])
            .evaluateAsync()
            .then((x) => x.toString());
          await loHandle.started;
          const mine = hi.expr(['Divide', 1, 7]).N();
          loHandle.release();
          await inner;
          return hi.expr(['Divide', 1, 7]).N().add(mine).mul(0);
        },
      } as never);
      await hi.expr(['Nest']).evaluateAsync();
      expect((await inner!).replace(/[^0-9]/g, '').length).toBe(26);
      expect(digits(hi)).toBe(71);
      expect(digits(lo)).toBe(26);
    });

    test('a built-in async evaluation keeps the precision across slices', async () => {
      const hi = new ComputeEngine({ precision: 60 });
      const lo = new ComputeEngine({ precision: 20 });
      const sum = (ce: ComputeEngine) =>
        ce
          .expr([
            'Sum',
            ['Divide', 1, ['Power', 'k', 2]],
            ['Limits', 'k', 1, 300],
          ])
          .evaluateAsync({ numericApproximation: true });
      const [a, b] = await Promise.all([sum(hi), sum(lo)]);
      const count = (x: any) =>
        x
          .N()
          .toString()
          .replace(/[^0-9]/g, '').length;
      expect(count(a)).toBeGreaterThan(30);
      expect(count(b)).toBeLessThan(30);
      expect(digits(hi)).toBe(61);
      expect(digits(lo)).toBe(21);
    });

    test('a rejected async evaluation leaves the static as it was', async () => {
      const hi = new ComputeEngine({ precision: 80 });
      hi.declare('AsyncBoom', {
        signature: '() -> number',
        pure: false,
        evaluateAsync: async () => {
          await Promise.resolve();
          throw new Error('async boom');
        },
      } as never);
      const before = BigDecimal.precision;
      await expect(hi.expr(['AsyncBoom']).evaluateAsync()).rejects.toThrow(
        'async boom'
      );
      expect(BigDecimal.precision).toBe(before);
      expect(digits(hi)).toBe(81);
    });
  });
});
