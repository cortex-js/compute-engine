import { Expression } from '../../../src/math-json';
import { engine } from '../../utils';

function json(latex: string): Expression {
  return engine.parse(latex)?.json ?? '';
}
describe('INTEGRAL', () => {
  test('simple with no index', () => {
    expect(json('\\int\\sin x + 1 = 2')).toMatchInlineSnapshot(
      `['Equal', ['Integrate', ['Add', ['Sin', 'x'], 1]], 2]`
    );
  });

  test('simple with d', () => {
    expect(json('\\int\\sin x \\mathrm{d} x+1 = 2')).toMatchInlineSnapshot(
      `['Equal', ['Add', ['Integrate', ['Lambda', ['Sin', '_']], ['Single', 'x']], 1], 2]`
    );
  });
  test('simple with mathrm', () => {
    expect(json('\\int\\sin x dx+1 = 2')).toMatchInlineSnapshot(
      `['Equal', ['Add', ['Integrate', ['Lambda', ['Sin', '_']], ['Single', 'x']], 1], 2]`
    );
  });
  test('simple with mathrm with spacing', () => {
    expect(json('\\int\\sin x \\, \\mathrm{d}x+1 = 2')).toMatchInlineSnapshot(
      `['Equal', ['Add', ['Integrate', ['Lambda', ['Multiply', ['Sin', '_'], ['HorizontalSpacing', 3]]], ['Single', 'x']], 1], 2]`
    );
  });

  test('simple with lower bound', () => {
    expect(json('\\int_0\\sin x \\, \\mathrm{d}x+1 = 2')).toMatchInlineSnapshot(
      `['Equal', ['Add', ['Integrate', ['Lambda', ['Multiply', ['Sin', '_'], ['HorizontalSpacing', 3]]], ['Single', 'x']], 1], 2]`
    );
  });

  test('simple with upper bound', () => {
    expect(
      json('\\int^\\infty\\sin x \\, \\mathrm{d}x+1 = 2')
    ).toMatchInlineSnapshot(
      `['Equal', ['Add', ['Integrate', ['Lambda', ['Multiply', ['Sin', '_'], ['HorizontalSpacing', 3]]], ['Triple', 'x', 1, {num: '+Infinity'}]], 1], 2]`
    );
  });
  test('simple with lower and upper bound', () => {
    expect(
      json('\\int^\\infty_0\\sin x \\, \\mathrm{d}x+1 = 2')
    ).toMatchInlineSnapshot(
      `['Equal', ['Add', ['Integrate', ['Lambda', ['Multiply', ['Sin', '_'], ['HorizontalSpacing', 3]]], ['Triple', 'x', 0, {num: '+Infinity'}]], 1], 2]`
    );
  });

  test('simple with lower and upper bound and no index', () => {
    expect(json('\\int^\\infty_0\\sin x +1 = 2')).toMatchInlineSnapshot(
      `['Equal', ['Integrate', ['Add', ['Sin', 'x'], 1], ['Triple', '', 0, {num: '+Infinity'}]], 2]`
    );
  });
});
