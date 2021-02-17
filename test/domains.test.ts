import { Expression, Form, ComputeEngine } from '../src/public';
import { printExpression } from './utils';

beforeEach(() => {
  jest.spyOn(console, 'assert').mockImplementation((assertion) => {
    if (!assertion) debugger;
  });
  jest.spyOn(console, 'log').mockImplementation(() => {
    debugger;
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {
    debugger;
  });
  jest.spyOn(console, 'info').mockImplementation(() => {
    debugger;
  });
});
expect.addSnapshotSerializer({
  // test: (val): boolean => Array.isArray(val) || typeof val === 'object',
  test: (_val): boolean => true,

  serialize: (val, _config, _indentation, _depth, _refs, _printer): string => {
    return printExpression(val);
  },
});

const engine = new ComputeEngine();

describe('PARAMETRIC SIMPLIFICATION', () => {
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

// describe('DOMAIN UNIONS', () => {
//   test('Valid groups', () => {});
// });
