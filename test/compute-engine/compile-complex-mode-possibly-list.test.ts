import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * The `complex` compile mode and an operand that may be a number or a list
 * and may hold a complex value (ROADMAP CE-215.2): `b: broadcastable<number>`,
 * `u: number | list<number>`. The mode declined such an operand, where the
 * default mode compiles it. The scalar and the cells now take their lane from
 * the same evidence, and the code dispatches on the shape of the value when
 * it runs: a number, a `{re, im}` object, or an array of either. Each value
 * is compared with the interpreter.
 */

type Complex = { re: number; im: number };
type Value = number | Complex | Value[];

function literal(v: Value): unknown {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return ['List', ...v.map(literal)];
  return ['Complex', v.re, v.im];
}

/** The interpreter's value as a compiled value: a number when the imaginary
 * part is zero, `{re, im}` otherwise, arrays for lists, booleans. */
function plain(e: any): unknown {
  if (e.symbol === 'True') return true;
  if (e.symbol === 'False') return false;
  if (e.operator === 'List') return e.ops.map(plain);
  return e.im === 0 ? e.re : { re: e.re, im: e.im };
}

function closeTo(actual: unknown, expected: unknown): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    const a = actual as unknown[];
    expect(a.length).toBe(expected.length);
    expected.forEach((x, i) => closeTo(a[i], x));
    return;
  }
  if (typeof expected === 'boolean') {
    expect(actual).toBe(expected);
    return;
  }
  const e =
    typeof expected === 'number'
      ? { re: expected, im: 0 }
      : (expected as Complex);
  const a =
    typeof actual === 'number' ? { re: actual, im: 0 } : (actual as Complex);
  expect(a.re).toBeCloseTo(e.re, 12);
  expect(a.im).toBeCloseTo(e.im, 12);
}

describe('CE-215.2: the complex mode compiles a possibly-list operand', () => {

  test('Sum(Rest(p)) + 1 over tensor<number> declines', () => {
    // The elements of a tensor of unknown rank are `number | tensor<number>`:
    // a number or a list. The shape is not settled, and the fold declines
    // (ROADMAP CE-805).
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    const r = compile(ce.box(['Add', ['Sum', ['Rest', 'p']], 1]), {
      to: 'javascript',
      mode: 'complex',
    } as any) as any;
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('outside-profile');
    // The interpreter gives the value that the compilation leaves to it.
    ce.assign(
      'p',
      ce.box([
        'List',
        ['List', 1, 2],
        ['List', 3, 4],
        ['List', 5, 6],
      ])
    );
    expect(
      ce.box(['Add', ['Sum', ['Rest', 'p']], 1]).evaluate().json
    ).toEqual(['List', 9, 11]);
  });

});
