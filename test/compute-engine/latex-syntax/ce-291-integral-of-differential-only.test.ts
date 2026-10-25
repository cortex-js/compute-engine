import { ComputeEngine } from '../../../src/compute-engine';

// CE-291.1: an integral whose body is only the differential (`\int dx`,
// `\int (dx)`) is the integral of 1. Before the fix, the parser found no
// integrand and gave an `unexpected-command` error.

const ce = new ComputeEngine();
const raw = (s: string) => ce.parse(s, { form: 'raw' }).json;

describe('CE-291.1 integral of the differential only', () => {
  test('\\int dx', () => {
    expect(raw('\\int dx')).toEqual(['Integrate', 1, 'x']);
    expect(ce.parse('\\int dx').evaluate().json).toEqual('x');
  });

  test('\\int (dx)', () => {
    expect(raw('\\int (dx)')).toEqual(['Integrate', 1, 'x']);
  });

  test('\\int \\mathrm{d}x', () => {
    expect(raw('\\int \\mathrm{d}x')).toEqual(['Integrate', 1, 'x']);
  });

  test('with limits', () => {
    expect(raw('\\int_0^1 dx')).toEqual([
      'Integrate',
      1,
      ['Tuple', 'x', 0, 1],
    ]);
    expect(ce.parse('\\int_0^1 dx').evaluate().json).toEqual(1);
  });

  test('a bare \\int is still an error', () => {
    expect(ce.parse('\\int').isValid).toBe(false);
  });
});
