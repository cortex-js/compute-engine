import { ComputeEngine } from '../../src/compute-engine';

//
// A block that is built again with the same scope (`subs()`) keeps the locals
// that its `Declare` statements make.
//

describe('THE LOCALS OF A BLOCK SCOPE', () => {
  test('a block built again with the same scope keeps its locals', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Declare', 't', "'unknown'", ['Add', 'k', 1]],
      ['Declare', 'u', "'unknown'", 't'],
      ['Add', 'u', 'k'],
    ]);
    const scope = block.localScope!;
    const again = block.subs({ k: 3 });
    expect(again.localScope).toBe(scope);
    // A run of the new block does not write a `u` made after it.
    ce.assign('u', 100);
    expect(again.evaluate().json).toBe(7);
    expect(ce.box('u').evaluate().json).toBe(100);
  });
});
