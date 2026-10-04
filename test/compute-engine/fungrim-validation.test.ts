import * as path from 'node:path';

import { runStage1 } from '../../scripts/fungrim/box-check';
import { createEngine, loadCorpus } from '../../scripts/fungrim/load';

const corpus = loadCorpus(path.resolve(__dirname, '../../data/fungrim'));

describe('Fungrim Dirichlet compatibility', () => {
  test('boxes the character and L-function corpus without changing its baseline', () => {
    const topics = new Set(['dirichlet', 'const_catalan', 'pi']);
    const report = runStage1(corpus, (entry) => topics.has(entry.topic));
    expect(report.total).toBe(181);
    expect(report.failures).toEqual([]);
  });

  test('keeps function-valued corpus characters and L(s, chi) uninterpreted', () => {
    const ce = createEngine(corpus.declarations);
    ce.declare('chi', 'function');
    for (const formula of [
      ['DirichletCharacter', 4, 3],
      ['DirichletCharacter', 4, 3, 3],
      ['DirichletL', 1, ['DirichletCharacter', 4, 3]],
      ['DirichletL', 2, 'chi'],
    ] as const) {
      const expr = ce.expr(formula);
      expect(expr.isValid).toBe(true);
      expect(expr.evaluate().json).toEqual(expr.json);
    }
  });

  test('does not weaken integer arguments in the character corpus', () => {
    const ce = createEngine(corpus.declarations);
    expect(ce.expr(['DirichletCharacter', 4, 1.5]).isValid).toBe(false);
  });

  test('retains the numeric built-ins when compatibility is disabled', () => {
    const ce = createEngine(corpus.declarations, { compat: false });
    expect(ce.expr(['DirichletCharacter', 4, 2, 3]).evaluate().json).toBe(-1);
    expect(ce.expr(['DirichletL', 3, 2, -2]).evaluate().json).toEqual([
      'Rational',
      -2,
      9,
    ]);
    expect(ce.expr(['DirichletCharacter', 4, 3]).isValid).toBe(false);
    expect(
      ce.expr(['DirichletL', 1, ['DirichletCharacter', 4, 3]]).isValid
    ).toBe(false);
  });
});
