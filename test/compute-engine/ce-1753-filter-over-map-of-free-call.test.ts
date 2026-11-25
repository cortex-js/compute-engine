/**
 * CE-1753: a `Map` whose function calls a name with no definition
 * (`k ↦ g(k)`) gives canonical elements. The fused path of `Map`
 * (`map-lowering.ts`) rebuilt the call `g(1)` without the home scope of its
 * free head, so the call was not canonical, and the comparison
 * `g(1) < 2.5` in a `Filter` predicate threw "Not canonical". The level now
 * goes through the general path, which keeps the call node.
 */
import {
  ComputeEngine,
  createDocumentEnvironment,
  type DocumentSyntax,
} from '../../src/compute-engine';

type Json = Parameters<DocumentSyntax['normalize']>[0];

const MAP_G: Json = ['Map', ['Function', ['g', 'k'], 'k'], ['Range', 1, 3]];
const LESS: Json = ['Function', ['Less', 'k', 2.5], 'k'];

/** The message of the error that `run` throws, or `undefined`. */
function thrown(run: () => unknown): string | undefined {
  try {
    run();
  } catch (e) {
    return (e as Error).message;
  }
  return undefined;
}

/** Prepare a Document with the rows `rows`, then evaluate the row `c`. */
function evaluateRow(rows: Record<string, [string[], Json]>): Json {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const revision = imports.prepare(
    Object.keys(rows).map((id) => ({ id, latex: id })),
    {
      split: (source) =>
        source in rows ? { head: source, body: '' } : undefined,
      recognize: (row) => ({
        role: rows[row.id][0].length === 0 ? 'value' : 'function',
        head: { name: row.id, params: rows[row.id][0] },
        bodyJson: rows[row.id][1],
      }),
      normalize: (raw) => raw,
      fieldAxes: new Set<string>(),
    }
  );
  ce.pushScope(revision.scope);
  try {
    return ce.box('c').evaluate().json as Json;
  } finally {
    ce.popScope();
    revision.dispose();
    imports.dispose();
    environment.dispose();
  }
}

describe('CE-1753: Map over a call of a name with no definition', () => {
  test('the elements are canonical', () => {
    const ce = new ComputeEngine();
    const m = ce.box(MAP_G).evaluate();
    const elements = [...m.each()];
    expect(elements.map((x) => x.json)).toEqual([
      ['g', 1],
      ['g', 2],
      ['g', 3],
    ]);
    expect(elements.every((x) => x.isCanonical)).toBe(true);
    const second = ce.box(['At', MAP_G, 2]).evaluate();
    expect(second.json).toEqual(['g', 2]);
    expect(second.isCanonical).toBe(true);
  });

  test('Filter reports the predicate as for a list of the same calls', () => {
    const ce = new ComputeEngine();
    const literal = thrown(() =>
      ce
        .box([
          'Length',
          ['Filter', ['List', ['g', 1], ['g', 2], ['g', 3]], LESS],
        ])
        .evaluate()
    );
    expect(literal).toMatch(/^Filter predicate must return/);
    expect(
      thrown(() => ce.box(['Length', ['Filter', MAP_G, LESS]]).evaluate())
    ).toBe(literal);
    expect(
      thrown(() => ce.box(['Length', ['Filter', MAP_G, LESS]]).N())
    ).toBe(literal);
  });

  test('a definition made after the Map is boxed is used', () => {
    const ce = new ComputeEngine();
    const m = ce.box(['Map', ['Function', ['h', 'k'], 'k'], ['Range', 1, 3]]);
    ce.declare('h', 'function');
    ce.assign('h', ce.box(['Function', ['Multiply', 'x', 2], 'x']));
    expect(
      ce.box(['Length', ['Filter', m, ['Function', ['Less', 'k', 4.5], 'k']]])
        .evaluate().json
    ).toBe(2);
  });

  test('a Document: the rows of the witness', () => {
    const rows: Record<string, [string[], Json]> = {
      L: [[], MAP_G],
      P: [[], ['Filter', 'L', LESS]],
      c: [[], ['Length', 'P']],
    };
    expect(thrown(() => evaluateRow(rows))).toMatch(
      /^Filter predicate must return/
    );
    // A row that defines `g` gives the count.
    expect(evaluateRow({ g: [['x'], 'x'], ...rows })).toBe(2);
  });
});
