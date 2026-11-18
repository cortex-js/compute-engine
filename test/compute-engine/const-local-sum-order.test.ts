import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

describe('the order of a sum with a const local', () => {
  it('a sum of a const local and a number keeps the number first', () => {
    const ce = new ComputeEngine();
    const D = [
      'Dictionary',
      ['KeyValuePair', { str: 'value' }, ['Floor', 'x']],
      ['KeyValuePair', { str: 'constant' }, 'True'],
    ];
    expect(
      ce.box(['Block', ['Declare', 'i', D], ['Add', 30001, 'i']] as never).json
    ).toEqual(['Block', ['Declare', 'i', D], ['Add', 30001, 'i']]);
    expect(
      ce.box(['Block', ['Declare', 'i', D], ['Add', 'zz', 'i']] as never).json
    ).toEqual(['Block', ['Declare', 'i', D], ['Add', 'zz', 'i']]);
  });

  it('a const local and a global constant of the same name order the same way', () => {
    const local = new ComputeEngine();
    const D = [
      'Dictionary',
      ['KeyValuePair', { str: 'value' }, ['Floor', 'x']],
      ['KeyValuePair', { str: 'constant' }, 'True'],
    ];
    const block = local.box([
      'Block',
      ['Declare', 'i', D],
      ['Add', 30001, 'i'],
    ] as never).json as unknown[];
    const global = new ComputeEngine();
    expect(executeEpsil(global, 'const i = floor(x)').diagnostics).toEqual([]);
    expect(global.box(['Add', 30001, 'i']).json).toEqual(block[2]);
    expect(block[2]).toEqual(['Add', 30001, 'i']);
  });

  it('a constant such as Pi still sorts after a number', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Add', 'x', 'Pi', 30001]).json).toEqual([
      'Add',
      'x',
      30001,
      'Pi',
    ]);
  });
});
