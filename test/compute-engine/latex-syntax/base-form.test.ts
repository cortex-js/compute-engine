import { Expression } from '../../../src/math-json';
import { engine } from '../../utils';

function json(latex: string): Expression {
  return engine.parse(latex)?.json ?? '';
}

describe('BASE FORM', () => {
  test('binary', () => {
    expect(json('\\text{00111}_{2}')).toMatchInlineSnapshot(
      `["Subscript", "'00111'", 2]`
    );
    expect(json('\\text{00111}_2')).toMatchInlineSnapshot(
      `["Subscript", "'00111'", 2]`
    );
    expect(json('\\text{00\\;111}_2')).toMatchInlineSnapshot(
      `["Subscript", "'00\\;111'", 2]`
    );
    expect(json('(\\text{00\\;111})_2')).toMatchInlineSnapshot(
      `["Subscript", ["Delimiter", "'00\\;111'"], 2]`
    );
  });
  test('decimal', () => {
    expect(json('\\text{123}_{10}')).toMatchInlineSnapshot(
      `["Subscript", "'123'", 10]`
    );
    expect(json('\\text{12c3}_{10}')).toMatchInlineSnapshot(
      `["Subscript", "'12c3'", 10]`
    );
  });
  test('hexadecimal', () => {
    expect(json('\\text{a1b23}_{16}')).toMatchInlineSnapshot(
      `["Subscript", "'a1b23'", 16]`
    );
    expect(json('\\text{1x2gc3}_{16}')).toMatchInlineSnapshot(
      `["Subscript", "'1x2gc3'", 16]`
    );
  });
  test('base 36', () => {
    expect(json('\\text{a1xy9zb23}_{36}')).toMatchInlineSnapshot(
      `["Subscript", "'a1xy9zb23'", 36]`
    );
  });
  test('base 37', () => {
    expect(json('\\text{a1b23}_{37}')).toMatchInlineSnapshot(
      `["Subscript", "'a1b23'", 37]`
    );
    expect(json('\\text{1x2gc3}_{37}')).toMatchInlineSnapshot(
      `["Subscript", "'1x2gc3'", 37]`
    );
  });
});
