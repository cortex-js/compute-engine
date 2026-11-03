/**
 * CE-712.2: an absent list argument beside a list argument in the static
 * map of a user-function call on interval-js.
 *
 * The case declared `L: list<real> | missing`. `Missing` is a result only
 * (user decision of 2026-11-02, `docs/ERROR-MODEL.md`): a declared type
 * cannot name `missing`, so no compiled input is declared absent and the
 * case has no input left to compile.
 */

import { ComputeEngine } from '../../src/compute-engine';

describe('CE-712.2: an absent list argument beside a list argument', () => {
  test('a list input cannot be declared absent', () => {
    const ce = new ComputeEngine();
    expect(() => ce.declare('L', 'list<real> | missing')).toThrow(
      /cannot be declared/
    );
  });
});
