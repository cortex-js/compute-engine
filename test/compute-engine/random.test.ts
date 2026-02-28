import { engine } from '../utils';

function checkLatexRoundtrip(): string | undefined {
  engine.forget('x');
  const expr = engine.expr(['RandomExpression']).evaluate();
  if (!expr.isValid) {
    console.info(expr.toString());
    return expr.toString();
  }
  const expr2 = engine.parse(expr.latex);
  if (!expr2.isSame(expr)) {
    const repeat = expr2.isSame(expr);
    console.info(expr.toString());
    return expr.toString();
  }
  return undefined;
}

function checkSimplification(): string | undefined {
  engine.forget('x');
  const expr = engine.expr(['RandomExpression']).evaluate();
  const simp = expr.simplify();

  for (let i = 0; i <= 100; i++) {
    engine.assign({ x: Math.random() * 2000 - 1000 });
    if (!expr.evaluate().isEqual(simp.evaluate())) {
      console.info(expr.evaluate().toString());
      console.info(simp.evaluate().toString());
      return expr.toString();
    }
  }
  engine.forget('x');
  return undefined;
}

describe.skip('RANDOM EXPRESSION', () => {
  for (let i = 50; i > 0; i--)
    test(`Checking expressions for LaTeX round-tripping`, () =>
      expect(checkLatexRoundtrip()).toBeUndefined());

  for (let i = 50; i > 0; i--)
    test(`Checking expressions for simplification`, () =>
      expect(checkSimplification()).toBeUndefined());
});
