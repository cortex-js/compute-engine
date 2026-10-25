import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// CE-161: the ASCII form of `Limit` names the variable of the limit, as the
// LaTeX form does (`\lim_{x\to a}`).
describe('CE-161 Limit toString() prints the variable', () => {
  test('a limit at a symbol', () => {
    const e = ce.box([
      'Limit',
      ['Function', ['Divide', 1, ['Subtract', 'x', 'a']], 'x'],
      'a',
    ]);
    expect(e.toString()).toBe('lim_(x -> a) {1 / (-a + x)}');
  });

  test('a limit at a number, from a parse', () => {
    expect(ce.parse('\\lim_{t\\to 2} t^2').toString()).toBe(
      'lim_(t -> 2) {t^2}'
    );
  });

  test('a limit at infinity', () => {
    expect(ce.parse('\\lim_{x\\to\\infty} f(x)').toString()).toBe(
      'lim_(x -> +oo) {f(x)}'
    );
  });
});
