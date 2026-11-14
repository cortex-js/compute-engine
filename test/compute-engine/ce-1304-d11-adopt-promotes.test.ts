import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// CE-1304: when an assignment gives an inferred name a value of another kind
// (the D11 adopt), the stored type is the value's promoted type, as for a
// fresh declaration: a storage position widens a literal type to its tier.
describe('CE-1304: the D11 adopt stores the promoted type', () => {
  test('a list, then a number: the type is integer, not 7', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 1, 2]));
    ce.assign('L', 7);
    expect(ce.box('L').type.toString()).toBe('integer');
    expect(ce.box(['Equal', 'L', 7]).type.toString()).toBe('boolean');
  });

  test('code compiled in that state reads the input', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 1, 2]));
    ce.assign('L', 7);
    const c = compile(ce.box(['If', ['Equal', 'L', 7], 1, 2]), {
      to: 'javascript',
      fallback: false,
      vars: { L: '_.L' },
    });
    expect(c.run!({ L: 8 })).toBe(2);
    expect(c.run!({ L: 7 })).toBe(1);
  });

  test('a list, then a rational: the type is real', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 1, 2]));
    ce.assign('L', ce.box(['Rational', 1, 2]));
    expect(ce.box('L').type.toString()).toBe('real');
  });

  test('a list, then a string keeps the string type', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 1, 2]));
    ce.assign('L', ce.box({ str: 'ab' }));
    expect(ce.box('L').type.toString()).toBe('string');
  });
});
