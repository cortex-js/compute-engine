import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// The operators that order values (`Max`, `Min`, `Supremum`, `Infimum`,
// `Clamp`, `ElementMax`, `ElementMin`, `Sort`, `MaxBy`, `MinBy`, `ArgMax`,
// `ArgMin`, `Median`, `Quartiles`, `Mode`) order two DIFFERENT numbers
// exactly, with no tolerance. Before, they compared with the engine tolerance
// (1e-10): `1e-12` and `2e-12` were a tie, and a tie kept the first operand,
// so `Max(1e-12, 2e-12)` answered `1e-12`. The compiled `Math.max` was
// already exact, so the interpreter and the compiled code disagreed.
//
// Equality (`isEqual`, `Equal`) keeps the tolerance: the controls below.
//
// The expected values are hand calculations: 2e-12 > 1e-12, and
// 1/3 = 0.333333333333… > 0.33333333333.

const ce = new ComputeEngine();

const evalBox = (x: any) => ce.box(x).evaluate().toString();
const evalParse = (s: string) => ce.parse(s).evaluate().toString();

describe('EXACT ORDERING OF CLOSE MACHINE NUMBERS', () => {
  test('Max and Min, box route', () => {
    expect(evalBox(['Max', 1e-12, 2e-12])).toBe('2e-12');
    expect(evalBox(['Max', 2e-12, 1e-12])).toBe('2e-12');
    expect(evalBox(['Min', 2e-12, 1e-12])).toBe('1e-12');
    expect(evalBox(['Min', 1e-12, 2e-12])).toBe('1e-12');
    expect(evalBox(['Max', 1, 1.00000000001])).toBe('1.00000000001');
    expect(evalBox(['Min', 1.00000000001, 1])).toBe('1');
  });

  test('Max and Min, parse route', () => {
    expect(evalParse('\\max(0.000000000001, 0.000000000002)')).toBe('2e-12');
    expect(evalParse('\\min(0.000000000002, 0.000000000001)')).toBe('1e-12');
  });

  test('Max and Min of a list of machine numbers', () => {
    // A list of machine numbers takes a scan over its doubles.
    expect(evalBox(['Max', ['List', 1e-12, 2e-12]])).toBe('2e-12');
    expect(evalBox(['Min', ['List', 2e-12, 1e-12]])).toBe('1e-12');
    expect(evalParse('\\max([0.000000000001, 0.000000000002])')).toBe('2e-12');
  });

  test('An exact value against a close float', () => {
    // 1/3 is larger than 0.33333333333, in either operand order.
    expect(evalBox(['Max', ['Rational', 1, 3], 0.33333333333])).toBe('1/3');
    expect(evalBox(['Max', 0.33333333333, ['Rational', 1, 3]])).toBe('1/3');
    expect(evalParse('\\max(0.33333333333, \\frac13)')).toBe('1/3');
  });

  test('Two equal values are a tie that keeps the first operand', () => {
    expect(evalBox(['Max', 1, 1.0])).toBe('1');
  });

  test('Supremum and Infimum', () => {
    expect(evalBox(['Supremum', 1e-12, 2e-12])).toBe('2e-12');
    expect(evalBox(['Infimum', 2e-12, 1e-12])).toBe('1e-12');
  });

  test('ElementMax, ElementMin and Clamp', () => {
    expect(evalBox(['ElementMax', 1e-12, 2e-12])).toBe('2e-12');
    expect(evalBox(['ElementMin', 2e-12, 1e-12])).toBe('1e-12');
    expect(evalBox(['Clamp', 1e-12, 2e-12, 3e-12])).toBe('2e-12');
    expect(evalBox(['Clamp', 5e-12, 2e-12, 3e-12])).toBe('3e-12');
    expect(
      evalParse(
        '\\operatorname{Clamp}(0.000000000005, 0.000000000002, 0.000000000003)'
      )
    ).toBe('3e-12');
  });

  test('Sort', () => {
    expect(evalBox(['Sort', ['List', 2e-12, 1e-12, 3e-12]])).toBe(
      '[1e-12,2e-12,3e-12]'
    );
    expect(
      evalParse(
        '\\operatorname{Sort}([0.000000000002, 0.000000000001, 0.000000000003])'
      )
    ).toBe('[1e-12,2e-12,3e-12]');
    // π = 3.14159265358979…, between the two floats.
    expect(
      evalParse('\\operatorname{Sort}([\\pi, 3.14159265359, 3.14159265358])')
    ).toBe('[3.14159265358,pi,3.14159265359]');
  });

  test('Sort by a key', () => {
    expect(
      evalParse(
        '\\operatorname{Sort}([2, 1, 3], x \\mapsto x \\times 10^{-12})'
      )
    ).toBe('[1,2,3]');
  });

  test('ArgMax, ArgMin, MaxBy and MinBy', () => {
    expect(evalBox(['ArgMax', ['List', 1e-12, 2e-12]])).toBe('2');
    expect(evalBox(['ArgMin', ['List', 2e-12, 1e-12]])).toBe('2');
    expect(
      evalParse(
        '\\operatorname{MaxBy}([0.000000000001, 0.000000000002], x \\mapsto x)'
      )
    ).toBe('2e-12');
    expect(
      evalParse(
        '\\operatorname{MinBy}([0.000000000002, 0.000000000001], x \\mapsto x)'
      )
    ).toBe('1e-12');
  });

  test('Median, Quartiles and Mode', () => {
    expect(evalBox(['Median', ['List', 3e-12, 1e-12, 2e-12]])).toBe('2e-12');
    expect(
      evalBox(['Quartiles', ['List', 3e-12, 1e-12, 2e-12, 4e-12, 5e-12]])
    ).toBe('(1.5e-12, 3e-12, 4.5e-12)');
    expect(evalBox(['Mode', ['List', 1e-12, 2e-12, 2e-12]])).toBe('2e-12');
  });

  test('The interpreter agrees with the compiled Math.max and Math.min', () => {
    const args = { x: 1e-12, y: 2e-12 };
    for (const [src, expected] of [
      ['\\max(x, y)', 2e-12],
      ['\\min(y, x)', 1e-12],
    ] as const) {
      const compiled = compile(ce.parse(src));
      expect(compiled?.run?.(args)).toBe(expected);
      expect(
        ce
          .parse(src)
          .subs({ x: ce.number(args.x), y: ce.number(args.y) })
          .evaluate().re
      ).toBe(expected);
    }
  });
});

describe('A TIE IS EXACT TOO', () => {
  // Two elements tie only when they are identical (`isSame`). A pair that
  // cannot be ordered and is not identical makes `Sort`, `MaxBy`, `MinBy`,
  // `ArgMax` and `ArgMin` undetermined, so the application stays
  // unevaluated. Before, such a pair tied when it was equal within the
  // engine tolerance. The two complex values below differ by 10^-12.
  const close = [
    'List',
    ['Complex', 1, 1],
    ['Add', ['Complex', 1, 1], ['Power', 10, -12]],
  ];

  test('Identical elements tie', () => {
    expect(evalBox(['Sort', ['List', 'Pi', 'Pi']])).toBe('[pi,pi]');
    expect(evalBox(['Sort', ['List', 'x', 'x']])).toBe('[x,x]');
    expect(evalParse('\\operatorname{Sort}([\\pi, \\pi])')).toBe('[pi,pi]');
    expect(evalBox(['ArgMax', ['List', 'Pi', 'Pi']])).toBe('1');
  });

  test('Equal keys keep the first element', () => {
    const abs = ['Function', ['Abs', 't'], 't'];
    expect(evalBox(['MaxBy', ['List', 1, -1, 2, -2], abs])).toBe('2');
    expect(evalBox(['ArgMax', ['List', 1, -1, 2, -2], abs])).toBe('3');
    expect(evalBox(['MinBy', ['List', 1, -1, 2, -2], abs])).toBe('1');
    expect(evalBox(['ArgMin', ['List', 1, -1, 2, -2], abs])).toBe('1');
    expect(evalBox(['Sort', ['List', 2, -1, 1, -2], abs])).toBe('[-1,1,2,-2]');
  });

  test('Two different values within the tolerance do not tie', () => {
    expect(ce.box(['Sort', close]).evaluate().operator).toBe('Sort');
    expect(
      ce.box(['MaxBy', close, ['Function', 't', 't']]).evaluate().operator
    ).toBe('MaxBy');
    expect(
      ce.box(['Sort', close, ['Function', 't', 't']]).evaluate().operator
    ).toBe('Sort');
  });
});

describe('SIGNED ZERO', () => {
  test('Max and Min of 0 and -0 agree with the compiled Math.max and Math.min', () => {
    // Math.max(-0, 0) is 0 and Math.min(0, -0) is -0.
    const max = compile(ce.parse('\\max(x, y)'))!;
    for (const [x, y] of [
      [-0, 0],
      [0, -0],
    ]) {
      const compiled = max.run!({ x, y }) as number;
      expect(Object.is(compiled, 0)).toBe(true);
      expect(Object.is(ce.box(['Max', x, y]).evaluate().re, compiled)).toBe(
        true
      );
      expect(
        Object.is(ce.function('Max', [ce.list([x, y])]).evaluate().re, compiled)
      ).toBe(true);
    }
  });
});

describe('EQUALITY KEEPS THE ENGINE TOLERANCE', () => {
  test('isEqual and Equal', () => {
    expect(ce.box(1e-12).isEqual(ce.box(2e-12))).toBe(true);
    expect(ce.box(['Equal', 1e-12, 2e-12]).evaluate().symbol).toBe('True');
  });
});

// Complex numbers have no order. Two complex values whose difference is real
// (`1 + i` and `(1 + i) + 10^-12`) must not be ordered by that difference.
describe('COMPLEX VALUES ARE NOT ORDERED', () => {
  test('ArgMax, Max and Sort stay unevaluated', () => {
    const pair = ['List', ['Complex', 1, 1], ['Add', ['Complex', 1, 1], 1e-12]];
    expect(ce.box(['ArgMax', pair] as any).evaluate().operator).toBe('ArgMax');
    expect(ce.box(['Max', 1, ['Complex', 1, 1]]).evaluate().operator).toBe(
      'Max'
    );
    expect(ce.box(['Sort', pair] as any).evaluate().operator).toBe('Sort');
  });

  test('real constants are still ordered', () => {
    expect(
      ce.box(['Sort', ['List', 3, 'Pi', 1]]).evaluate().toString()
    ).toBe('[1,3,pi]');
  });
});
