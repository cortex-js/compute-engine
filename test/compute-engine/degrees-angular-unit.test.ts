/**
 * A degree literal (`30^\circ`, parsed as `Degrees(30)`) is an angle in the
 * engine's `angularUnit`: `Degrees` converts degrees to that unit, and the
 * trigonometric functions then read the value in that same unit. So
 * `\sin(30^\circ)` is `1/2` whatever the unit.
 *
 * Before this was pinned, `Degrees` always converted to RADIANS, and in
 * grad or turn mode `\sin(30^\circ)` read `π/6` as grads (0.0082) or as
 * turns (−0.1477).
 */

import { ComputeEngine } from '../../src/compute-engine';

type AngularUnit = 'rad' | 'deg' | 'grad' | 'turn';
const UNITS: AngularUnit[] = ['rad', 'deg', 'grad', 'turn'];

function engine(unit: AngularUnit): ComputeEngine {
  const ce = new ComputeEngine();
  ce.angularUnit = unit;
  return ce;
}

describe('DEGREE LITERALS IN EVERY ANGULAR UNIT', () => {
  test.each(UNITS)('%s: exact special values', (unit) => {
    const ce = engine(unit);
    expect(ce.parse('\\sin(30^\\circ)').evaluate().toString()).toBe('1/2');
    expect(ce.parse('\\cos(60^\\circ)').evaluate().toString()).toBe('1/2');
    expect(ce.parse('\\tan(45^\\circ)').evaluate().toString()).toBe('1');
    expect(ce.parse('\\sin(90^\\circ)').evaluate().toString()).toBe('1');
  });

  test.each(UNITS)('%s: numeric values', (unit) => {
    const ce = engine(unit);
    expect(ce.parse('\\sin(30^\\circ)').N().re).toBeCloseTo(0.5, 12);
    expect(ce.parse('\\cos(60^\\circ)').N().re).toBeCloseTo(0.5, 12);
    expect(ce.parse('\\tan(45^\\circ)').N().re).toBeCloseTo(1, 12);
  });

  test.each(UNITS)('%s: degree literal on an assigned symbol', (unit) => {
    const ce = engine(unit);
    ce.assign('y', 30);
    expect(ce.parse('\\sin(y^\\circ)').evaluate().toString()).toBe('1/2');
    expect(ce.parse('\\sin(y^\\circ)').N().re).toBeCloseTo(0.5, 12);
  });

  test.each(UNITS)('%s: DMS', (unit) => {
    const ce = engine(unit);
    expect(ce.box(['Sin', ['DMS', 30]]).evaluate().toString()).toBe('1/2');
    expect(ce.box(['Sin', ['DMS', 29, 60]]).evaluate().toString()).toBe(
      '1/2'
    );
    expect(ce.parse("\\sin(29^\\circ 60')").evaluate().toString()).toBe('1/2');
  });

  test('the literal is converted to the engine unit', () => {
    expect(engine('rad').box(['Degrees', 30]).toString()).toBe('1/6 * pi');
    expect(engine('deg').box(['Degrees', 30]).toString()).toBe('30');
    expect(engine('grad').box(['Degrees', 30]).toString()).toBe('100/3');
    expect(engine('turn').box(['Degrees', 30]).toString()).toBe('1/12');
    // The evaluate handler agrees with the canonical handler.
    expect(engine('grad').box(['Degrees', 'Pi']).evaluate().toString()).toBe(
      '10/9 * pi'
    );
    expect(engine('turn').box(['Degrees', 'Pi']).evaluate().toString()).toBe(
      '1/360 * pi'
    );
  });

  test.each(['rad', 'grad', 'turn'] as AngularUnit[])(
    '%s: a symbolic degree literal round-trips through LaTeX',
    (unit) => {
      const ce = engine(unit);
      const expr = ce.parse('x^\\circ');
      expect(expr.json).toEqual(['Degrees', 'x']);
      expect(expr.latex).toBe('x\\degree');
      expect(ce.parse(expr.latex).json).toEqual(['Degrees', 'x']);
    }
  );

  test('deg: a symbolic degree literal is the angle itself', () => {
    // In degree mode `Degrees` is the identity, so the wrapper disappears.
    expect(engine('deg').parse('x^\\circ').json).toBe('x');
  });
});

describe('DEGREE LITERALS — compiled output agrees with evaluate()', () => {
  test.each(UNITS)('%s: javascript', (unit) => {
    const ce = engine(unit);
    const js = ce._getCompilationTarget('javascript')!;
    expect(js.compile(ce.parse('\\sin(x^\\circ)')).run!({ x: 30 })).toBeCloseTo(
      0.5,
      12
    );
    // A bare degree literal compiles to its value in the engine unit.
    expect(js.compile(ce.parse('x^\\circ')).run!({ x: 30 })).toBeCloseTo(
      ce.parse('x^\\circ').subs({ x: 30 }).N().re,
      12
    );
  });

  test.each(UNITS)('%s: interval-js', (unit) => {
    const ce = engine(unit);
    const ijs = ce._getCompilationTarget('interval-js')!;
    const r = ijs.compile(ce.parse('\\sin(x^\\circ)')).run!({ x: 30 }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(r.kind).toBe('interval');
    expect(r.value.lo).toBeLessThanOrEqual(0.5);
    expect(r.value.hi).toBeGreaterThanOrEqual(0.5);
    expect(r.value.hi - r.value.lo).toBeLessThan(1e-12);
  });

  test('rad: interval-js encloses π/180', () => {
    const ce = engine('rad');
    const ijs = ce._getCompilationTarget('interval-js')!;
    const r = ijs.compile(ce.parse('x^\\circ')).run!({ x: 1 }) as {
      value: { lo: number; hi: number };
    };
    // π/180 = 0.017453292519943295769236907684886…; the double nearest to
    // it is the same as `Math.PI / 180`, so the enclosure must be wider.
    expect(r.value.lo).toBeLessThan(Math.PI / 180);
    expect(r.value.hi).toBeGreaterThan(Math.PI / 180);
  });

  test('rad: python lowers Degrees to radians', () => {
    const ce = engine('rad');
    const py = ce._getCompilationTarget('python')!;
    expect(py.compile(ce.parse('\\sin(x^\\circ)')).code).toBe(
      'np.sin((x * np.pi / 180))'
    );
  });
});
