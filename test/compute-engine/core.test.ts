import { ComputeEngine } from '../../src/compute-engine.ts';

export const ce = new ComputeEngine();

describe('TAUTOLOGY a = 1', () => {
  test(`a.value`, () => {
    expect(ce.box('a').evaluate()).toMatchInlineSnapshot(`"a"`);
  });
});
