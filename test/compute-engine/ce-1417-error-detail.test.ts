import { ComputeEngine, compile } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { describeError } from '../../src/epsil/static-diagnostics';

/**
 * CE-1417. A color string that names no color and a unit conversion between
 * two dimensions gave the error `incompatible-type` with no payload, which
 * Epsil printed as "incompatible type: " with a trailing space. The error
 * now names what was expected and what was given, and `parseColor()` of
 * `@arnog/colors` is not called for a string that it does not read, so it
 * does not write a warning to the console.
 */

const ce = new ComputeEngine();

function evaluate(json: any): string {
  return ce.expr(json).evaluate().toString();
}

/** The message of the error value of an Epsil program, as the CLI prints it. */
function errorMessage(source: string): string {
  const value = executeEpsil(new ComputeEngine(), source).value;
  expect(value.operator).toBe('Error');
  return describeError(value.json);
}

let warnings: unknown[][] = [];
const originalWarn = console.warn;
beforeEach(() => {
  warnings = [];
  console.warn = (...message: unknown[]) => {
    warnings.push(message);
  };
});
afterEach(() => {
  console.warn = originalWarn;
});

describe('CE-1417 a color string that names no color', () => {
  test.each([
    'nosuchcolor',
    'rebeccapurple',
    'nosuch/50',
    'foo-500',
    'lab(1 2 3)',
    'rgb(1 2)',
  ])('Color(%p) is an error that names the string', (s) => {
    expect(evaluate(['Color', { str: s }])).toBe(
      `Error(ErrorCode("incompatible-type", "color", "\\"${s}\\""))`
    );
    expect(warnings).toEqual([]);
  });

  test.each(['nosuchcolor', 'rgb(1 2)'])(
    'compiled Color(%p) throws, with no warning',
    (s) => {
      const r = compile(ce.expr(['Color', { str: s }]));
      expect(r.success).toBe(true);
      expect(() => r.run!({})).toThrow(/Unknown color/);
      expect(warnings).toEqual([]);
    }
  );

  test.each([
    ['red', 'Oklch'],
    ['red/50', 'Oklch'],
    ['blue-500', 'Oklch'],
    ['dark-grey', 'Oklch'],
    ['transparent', 'Oklch'],
    ['#f00f', 'Oklch'],
    ['rgb(0 0 0 / 0)', 'Oklch'],
    ['hsl(120deg 50% 50%)', 'Oklch'],
    ['hsl(120° 50% 50%)', 'Oklch'],
    ['rgb(1 2 3)/50', 'Oklch'],
    ['oklch(50% 0.3 240)', 'Oklch'],
  ])('Color(%p) is still a color', (s, head) => {
    expect(ce.expr(['Color', { str: s }]).evaluate().operator).toBe(head);
    expect(warnings).toEqual([]);
  });

  test('another color operator names the operand that is not a color', () => {
    expect(evaluate(['ColorMix', { str: 'red' }, { str: 'zz' }])).toBe(
      'Error(ErrorCode("incompatible-type", "color", "\\"zz\\""))'
    );
    expect(evaluate(['ColorToString', { str: 'zz' }])).toBe(
      'Error(ErrorCode("incompatible-type", "color", "\\"zz\\""))'
    );
    expect(warnings).toEqual([]);
  });

  test('Epsil prints the expected and the given value', () => {
    expect(errorMessage('color("nosuchcolor")')).toBe(
      'expected `color`, got `"nosuchcolor"`'
    );
    expect(warnings).toEqual([]);
  });
});

describe('CE-1417 a conversion to a unit of another dimension', () => {
  test('the error names the target unit and the unit of the quantity', () => {
    expect(evaluate(['UnitConvert', ['Quantity', 2, 'h'], 'm'])).toBe(
      'Error(ErrorCode("incompatible-type", "m", "h"))'
    );
    expect(
      evaluate(['UnitConvert', ['Quantity', 2, ['Divide', 'm', 's']], 'kg'])
    ).toBe('Error(ErrorCode("incompatible-type", "kg", "m/s"))');
  });

  test('Epsil prints the two units', () => {
    expect(errorMessage('unitConvert(quantity(2, h), "m")')).toBe(
      'expected `m`, got `h`'
    );
  });
});

describe('CE-1417 an incompatible-type error with no payload', () => {
  test('reads with no trailing separator', () => {
    expect(describeError(['Error', "'incompatible-type'"])).toBe(
      'incompatible type'
    );
  });
});
