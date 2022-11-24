import { engine } from '../utils';

function checkRandomExpression(): string | undefined {
  engine.forget('x');
  const expr = engine.box(['RandomExpression']).evaluate();
  const expr2 = engine.parse(expr.latex);
  if (!expr2.isSame(expr)) return expr.toString();

  const simp = expr.simplify();

  for (let x = -100; x < 100; x += 25) {
    engine.set({ x: x });
    if (!expr.evaluate().isEqual(simp.evaluate())) return expr.toString();
  }
  engine.forget('x');
  return undefined;
}

describe('RANDOM EXPRESSION', () => {
  for (let i = 50; i > 0; i--)
    test(`Checking 100 expressions`, () =>
      expect(checkRandomExpression()).toBeUndefined());
});
