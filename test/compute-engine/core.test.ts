import { ComputeEngine } from '../../src/compute-engine';

export const ce = new ComputeEngine();

describe('TAUTOLOGY a = 1', () => {
  test(`a.value`, () => {
    expect(ce.box('a').evaluate()).toMatchInlineSnapshot(`"a"`);
  });
});
