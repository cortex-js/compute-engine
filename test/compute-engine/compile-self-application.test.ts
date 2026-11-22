import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// A function literal applied to itself declines (its argument is a
// function value passed to a function, docs/COMPILATION-MODEL.md, "Function
// values", #639); the same recursion written as a named function with a
// declared signature compiles on JavaScript and equals `evaluate()`.

const ce = new ComputeEngine();
ce.declare('T', 'list<integer>');

const body = (call: MathJsonExpression): MathJsonExpression => [
  'If',
  ['Equal', ['Length', 't'], 0],
  0,
  ['Add', ['First', 't'], call],
];
const self: MathJsonExpression = [
  'Function',
  body(['self', 'self', ['Rest', 't']]),
  'self',
  't',
];

ce.declare('s', '(list<integer>) -> integer');
ce.assign('s', ce.box(['Function', body(['s', ['Rest', 't']]), 't']));

const at = (expr: MathJsonExpression, T: number[]) =>
  ce
    .box(expr)
    .subs({ T: ce.box(['List', ...T]) })
    .evaluate().re;

describe('recursion', () => {
  it('a self-application declines, and the interpreter gives its value', () => {
    const expr: MathJsonExpression = ['Apply', self, self, 'T'];
    expect(() => compile(ce.box(expr), { fallback: false })).toThrow(
      /a function value/
    );
    expect(at(expr, [1, 2, 3])).toBe(6);
  });

  it('a named function with a declared signature compiles', () => {
    const c = compile(ce.box(['s', 'T']), { fallback: false }) as any;
    for (const T of [[], [5], [1, 2, 3]]) {
      expect(c.run({ T })).toBe(at(['s', 'T'], T));
      expect(c.run({ T })).toBe(at(['Apply', self, self, 'T'], T));
    }
  });

  it('declines on GLSL', () => {
    expect(() =>
      compile(ce.box(['s', 'T']), { to: 'glsl', fallback: false })
    ).toThrow(/Could not compile/);
  });
});
