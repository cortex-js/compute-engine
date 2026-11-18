/**
 * `Linspace` on `interval-js`. The target had no lowering for it, so a
 * `Linspace` at the root, in `Sum` or as a loop source refused to compile.
 * Now a `Linspace` whose count is known at compile time (omitted, or a
 * number literal) is spelled as the array of the enclosures of its samples
 * (the interval mode, `compilation/ir/lower.ts`). Each
 * enclosure must contain the sample that the interpreter computes.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';

/** The diagnostic of the decline that `f` throws. */
function declineOf(f: () => unknown) {
  try {
    f();
  } catch (e) {
    return compileDiagnosticOf(e);
  }
  throw new Error('no decline');
}

function engine() {
  const ce = new ComputeEngine();
  ce.declare('m', 'integer');
  return ce;
}

describe('interval-js: Linspace', () => {
  test('an assignment in an endpoint is invalid, and the compile declines', () => {
    // An assignment as an operand of `Linspace` is the static error
    // `assignment-in-operand`.
    const json = [
      'Block',
      ['Declare', 'c', "'unknown'", 0],
      ['Loop', 0, ['Element', 'k', ['Linspace', ['Assign', 'c', 1], 9, 0]]],
      'c',
    ];
    expect(engine().box(json as any).isValid).toBe(false);
    const d = declineOf(() =>
      compile(engine().box(json as any), {
        to: 'interval-js',
        fallback: false,
      })
    );
    expect(d.code).toBe('static-type-error');
  });

  test('a NaN count declines: it has no value in the interpreter', () => {
    const d = declineOf(() =>
      compile(engine().box(['Linspace', 0, 1, 'NaN']), {
        to: 'interval-js',
        fallback: false,
      })
    );
    expect(d).toMatchObject({ code: 'outside-profile', operator: 'Linspace' });
  });

  test('a count that is an input declines', () => {
    // The length of the list would depend on an interval: the interpreter
    // evaluates it.
    const d = declineOf(() =>
      compile(engine().box(['Linspace', 0, 1, 'm']), {
        to: 'interval-js',
        fallback: false,
      })
    );
    expect(d).toMatchObject({ code: 'outside-profile', operator: 'Linspace' });
  });
});
