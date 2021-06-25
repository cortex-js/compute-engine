import { ComputeEngine } from '../src/compute-engine';
import './utils';

const engine = new ComputeEngine();

describe.skip('PARAMETRIC SIMPLIFICATION', () => {
  test('String', () => {
    expect(engine.evaluate(['String'])).toMatchInlineSnapshot(``);
    expect(engine.evaluate(['String', 5])).toMatchInlineSnapshot(``);
    expect(engine.evaluate(['String', 5, 5])).toMatchInlineSnapshot(``);
    expect(engine.evaluate(['String', 5, 11])).toMatchInlineSnapshot(``);
    expect(engine.evaluate(['String', 0])).toMatchInlineSnapshot(``);
    expect(engine.evaluate(['String', 0, 0])).toMatchInlineSnapshot(``);
    expect(
      engine.evaluate(['String', 0, { num: '+Infinity' }])
    ).toMatchInlineSnapshot(``);
    expect(
      engine.evaluate(['String', { num: '+Infinity' }, { num: '+Infinity' }])
    ).toMatchInlineSnapshot(``);
    expect(
      engine.evaluate(['String', { num: '+Infinity' }])
    ).toMatchInlineSnapshot(``);
    expect(engine.evaluate(['String', 3.2, 4.7])).toMatchInlineSnapshot(``);
    expect(engine.evaluate(['String', -5, 5])).toMatchInlineSnapshot(``);
    expect(engine.evaluate(['String', 11, 5])).toMatchInlineSnapshot(``);
    expect(
      engine.evaluate(['String', { num: '-Infinity' }, { num: '+Infinity' }])
    ).toMatchInlineSnapshot(``);
    expect(
      engine.evaluate(['String', { num: '-Infinity' }, { num: '+Infinity' }])
    ).toMatchInlineSnapshot(``);
    expect(engine.evaluate(['String', 'x', 'y'])).toMatchInlineSnapshot(``);
    expect(
      engine.evaluate(['String', 'Nothing', 'Nothing'])
    ).toMatchInlineSnapshot(``);
    expect(
      engine.evaluate(['String', ['Add', 3, 2], ['Divide', 22, 2]])
    ).toMatchInlineSnapshot(``);
  });
  test('Valid groups', () => {
    expect(
      engine.evaluate(['Union', 'RealNumber', 'Integer'])
    ).toMatchInlineSnapshot(``);
  });
});

describe('SUBSETS', () => {
  test('Numbers', () => {
    expect(engine.isSubsetOf('RealNumber', 'RealNumber')).toBeTruthy();
    expect(engine.isSubsetOf('Integer', 'RealNumber')).toBeTruthy();
    expect(
      engine.isSubsetOf('NaturalNumber', 'ExtendedRealNumber')
    ).toBeTruthy();
    expect(engine.isSubsetOf('RealNumber', 'Integer')).toBeFalsy();
    expect(
      engine.isSubsetOf(
        ['Intersection', 'RationalNumber', 'NaturalNumber'],
        'RealNumber'
      )
    ).toBeTruthy();
  });
});
// describe('DOMAIN UNIONS', () => {
//   test('Valid groups', () => {});
// });
