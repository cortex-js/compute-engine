import { ComputeEngine } from '../../../src/compute-engine';

// CE-300.1: the `else` branch of `\keyword{if}` is optional. Without it, the
// parse gives an `If` with two operands, which is `Missing` when the
// condition is false. Before the fix, the parser declined the whole `if`
// and the keywords became text next to the operands, with `isValid: true`.

const ce = new ComputeEngine();

describe('CE-300.1 if without else', () => {
  test('keyword spelling', () => {
    const expr = ce.parse('\\keyword{if} x > 0 \\keyword{then} x');
    expect(expr.json).toEqual(['If', ['Less', 0, 'x'], 'x']);
    expect(expr.isValid).toBe(true);
  });

  test('text spelling', () => {
    expect(
      ce.parse('\\text{if } x > 0 \\text{ then } x^2').json
    ).toEqual(['If', ['Less', 0, 'x'], ['Power', 'x', 2]]);
  });

  test('the else branch is still read when present', () => {
    expect(
      ce.parse('\\keyword{if} x > 0 \\keyword{then} x \\keyword{else} -x').json
    ).toEqual(['If', ['Less', 0, 'x'], 'x', ['Negate', 'x']]);
  });

  test('an else after a nested if without else goes to the inner if', () => {
    expect(
      ce.parse(
        '\\keyword{if} a \\keyword{then} \\keyword{if} b \\keyword{then} 1 \\keyword{else} 2'
      ).json
    ).toEqual(['If', 'a', ['If', 'b', 1, 2]]);
  });

  test('the true branch ends at a closing delimiter', () => {
    expect(
      ce.parse('\\{\\keyword{if} x > 0 \\keyword{then} 1\\}').json
    ).toEqual(['Set', ['If', ['Less', 0, 'x'], 1]]);
  });

  test('the true branch ends at a comma of a list', () => {
    expect(
      ce.parse('[\\keyword{if} x>0 \\keyword{then} x, 2]').json
    ).toEqual(['List', ['If', ['Less', 0, 'x'], 'x'], 2]);
  });

  test('the true branch ends at a comma of a call', () => {
    expect(
      ce.parse('f(\\keyword{if} x>0 \\keyword{then} x, 3)').json
    ).toEqual(['f', ['If', ['Less', 0, 'x'], 'x'], 3]);
  });

  test('evaluation', () => {
    const expr = ce.parse('\\keyword{if} 2 > 1 \\keyword{then} 5');
    expect(expr.evaluate().json).toEqual(5);
  });
});
