// The declines of a value kind in `compile()`
// (`docs/plans/2026-10-26-value-kinds.md`, section 4.8).

import { ComputeEngine, compile } from '../../src/compute-engine';
import { declareMyMod, declareUserMeasurement } from './value-kinds-helpers';

describe('VALUE KINDS: COMPILE CONTRACT', () => {
  test('a residue class declines, with the message that names `residue`', () => {
    const ce = new ComputeEngine();
    declareMyMod(ce);
    ce.declare('x', 'real');
    expect(() =>
      compile(ce.box(['Add', 'x', ['MyMod', 2, 5]]), { fallback: false })
    ).toThrow(/Could not compile/);
    expect(() =>
      compile(ce.box(['Add', 'x', ['ResidueClass', 2, 5]]), {
        fallback: false,
      })
    ).toThrow(/Could not compile/);
  });

  test('a kind with no `compile` declines, with the message that names it', () => {
    const ce = new ComputeEngine();
    declareUserMeasurement(ce);
    ce.declare('U', 'umeasurement');
    expect(() => compile(ce.box(['Sin', 'U']), { fallback: false })).toThrow(
      /Could not compile/
    );
  });
});
