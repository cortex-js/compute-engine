import {
  SYS_HELPERS,
  makeSysHelpers,
} from '../../src/compute-engine/compilation/javascript-runtime';

//
// The `_SYS` bundle of one compiled function: the shared helpers come from
// `SYS_HELPERS` through the prototype chain, and the engine-bound helpers are
// its own members.
//

describe('the helper bundle of a compiled function', () => {
  test('inherits the shared helpers and holds its own', () => {
    const sys = makeSysHelpers({
      random: Math.random,
      frame: () => undefined,
      setFrame: () => {},
      deadline: () => undefined,
    } as never);
    expect(Object.getPrototypeOf(sys)).toBe(SYS_HELPERS);
    for (const name of [
      'drawNextRandomNumber',
      'countLoopPass',
      'resetLoopPasses',
      'integrate',
      'integrateMC',
    ])
      expect(Object.prototype.hasOwnProperty.call(sys, name)).toBe(true);
    expect(sys.binomial).toBe(SYS_HELPERS.binomial);
  });
});
