import { engine } from '../utils';

function checkRandomExpression(): string | undefined {
  engine.forget('x');
  const expr = engine.box(['RandomExpression']).evaluate();
  if (!expr.isValid) {
    console.log(expr.toString());
    return expr.toString();
  }
  const expr2 = engine.parse(expr.latex);
  if (!expr2.isSame(expr)) {
    console.log(expr.toString());
    return expr.toString();
  }
  return undefined;
}

function checkSimplification(): string | undefined {
  engine.forget('x');
  const expr = engine.box(['RandomExpression']).evaluate();
  const simp = expr.simplify();

  for (let x = -100; x < 100; x += 25) {
    engine.set({ x: x });
    if (!expr.evaluate().isEqual(simp.evaluate())) return expr.toString();
  }
  engine.forget('x');
  return undefined;
}

describe.skip('RANDOM EXPRESSION', () => {
  for (let i = 50; i > 0; i--)
    test(`Checking expressions for LaTeX round-tripping`, () =>
      expect(checkRandomExpression()).toBeUndefined());
  for (let i = 50; i > 0; i--)
    test(`Checking expressions for simplification`, () =>
      expect(checkSimplification()).toBeUndefined());
});
