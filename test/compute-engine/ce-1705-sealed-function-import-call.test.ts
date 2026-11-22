/**
 * CE-1705: a Document row that applies an import declared `unknown` or
 * `function`, with a `Function` literal as its value, is prepared. The
 * import is sealed, so its value cannot change, and the call does not wait
 * on a later definition of the name. The row was refused with
 * `provisional heads f`.
 */
import {
  ComputeEngine,
  createDocumentEnvironment,
  type DocumentSyntax,
} from '../../src/compute-engine';

type Json = Parameters<DocumentSyntax['normalize']>[0];

function prepareWith(type: string) {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports((input) => {
    input('x', 'real');
    ce.box([
      'Declare',
      'f',
      { str: type },
      ['Function', ['Multiply', 2, 't'], 't'],
    ] as never).evaluate();
  });
  const rows: Record<string, [string[], Json]> = {
    g: [['x'], ['Add', ['f', 'x'], 1]],
    y: [[], ['f', 3]],
  };
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
      fieldAxes: new Set(['x']),
      reservedImportNames: new Set(['f']),
    }
  );
  const value = (expr: Json) =>
    JSON.stringify(ce.expr(expr, { scope: revision.scope }).evaluate().json);
  const result = {
    errors: JSON.stringify(
      [...revision.rowErrors].map(([id, e]) => [id, e.json])
    ),
    g2: value(['g', 2]),
    y: value('y'),
  };
  revision.dispose();
  imports.dispose();
  environment.dispose();
  return result;
}

describe('a row that applies a function import of an open type', () => {
  test.each(['unknown', 'function', '(t: unknown) -> unknown'])(
    'declared %s',
    (type) => {
      expect(prepareWith(type)).toEqual({ errors: '[]', g2: '5', y: '6' });
    }
  );
});
