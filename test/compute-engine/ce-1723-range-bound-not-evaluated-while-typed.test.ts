/**
 * CE-1723: the type of a call over `Range(1, Length(P))` is read from the
 * type of the range. The broadcast typing and the argument check of a
 * function literal read the count of the range only when the type does not
 * decide, so reading the formula does not compute the elements of `P`. They
 * read the count first: the prepare of a Document evaluated each element of
 * `P`, and the count computed inside the type computation could be wrong
 * (`Sin(Range(1, Length(P)))` was `[Sin(1), 0]`) or throw.
 */
import {
  ComputeEngine,
  createDocumentEnvironment,
  type DocumentSyntax,
} from '../../src/compute-engine';

type Json = Parameters<DocumentSyntax['normalize']>[0];

const R: Json = ['Range', 1, ['Length', 'P']];

/** Prepare a Document with the rows of the witness and the row `c`. The
 * host predicate `Keep` counts its calls. */
function prepare(c: Json) {
  const ce = new ComputeEngine();
  let calls = 0;
  const environment = createDocumentEnvironment(ce, () => {
    ce.declare('Keep', {
      signature: '(real) -> boolean',
      pure: true,
      evaluate: ([x]) => {
        calls += 1;
        return x.re < 30.5 ? ce.True : ce.False;
      },
    });
  });
  const imports = environment.createImports((input) => input('w', 'real'));
  const rows: Record<string, [string[], Json]> = {
    q: [
      ['x', 'y'],
      ['Add', 'x', 'y', 'w'],
    ],
    L: [[], ['Map', ['Function', ['Multiply', 2, 'k'], 'k'], ['Range', 1, 40]]],
    P: [[], ['Filter', 'L', ['Function', ['Keep', 'k'], 'k']]],
    c: [[], c],
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
      fieldAxes: new Set<string>(),
    }
  );
  const callsAfterPrepare = calls;
  ce.pushScope(revision.scope);
  let value: Json;
  try {
    value = ce.box('c').evaluate().json as Json;
  } finally {
    ce.popScope();
    revision.dispose();
    imports.dispose();
    environment.dispose();
  }
  return { callsAfterPrepare, rowErrors: revision.rowErrors.size, value };
}

// The elements of `P` are 2, 4, …, 30: 15 elements.
const indexes = Array.from({ length: 15 }, (_, i) => i + 1);

describe('CE-1723: a Document row over Range(1, Length(P))', () => {
  test.each([
    [
      'a call of a function row',
      ['q', 0, R],
      ['List', ...indexes.map((i) => ['Add', 'w', i])],
    ],
    ['Sin', ['Sin', R], ['List', ...indexes.map((i) => ['Sin', i])]],
    ['Add', ['Add', R, 1], ['List', ...indexes.map((i) => i + 1)]],
    // The call nested in another operator, as in the corpus row
    // `hsv(q(0, 1..Length(P_1)) × 360, 0.8, 0.9)`.
    [
      'a call of a function row times 360',
      ['Multiply', ['q', 0, R], 360],
      ['List', ...indexes.map((i) => ['Multiply', 360, ['Add', 'w', i]])],
    ],
    [
      'Sin plus 1',
      ['Add', ['Sin', R], 1],
      ['List', ...indexes.map((i) => ['Add', 1, ['Sin', i]])],
    ],
  ] as [string, Json, Json][])(
    '%s: the prepare computes no element of P',
    (_, c, expected) => {
      const { callsAfterPrepare, rowErrors, value } = prepare(c);
      expect(rowErrors).toBe(0);
      expect(callsAfterPrepare).toBe(0);
      expect(value).toEqual(expected);
    }
  );
});

describe('CE-1723: boxing over Range(1, Length(P)) on the engine scope', () => {
  // The predicate `k < 2.5` does not decide inside the type computation,
  // where `k` has no value, and `Filter` threw while the formula was boxed.
  function engine() {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['Map', ['Function', 'k', 'k'], ['Range', 1, 4]]));
    ce.assign(
      'P',
      ce.box(['Filter', 'L', ['Function', ['Less', 'k', 2.5], 'k']])
    );
    ce.declare('w', 'real');
    ce.assign('q', ce.box(['Function', ['Add', 'x', 'y', 'w'], 'x', 'y']));
    return ce;
  }

  test.each([
    [['q', 0, R], ['List', ['Add', 'w', 1], ['Add', 'w', 2]]],
    [['Sin', R], ['List', ['Sin', 1], ['Sin', 2]]],
    [['Multiply', 2, R], ['List', 2, 4]],
    [['Less', R, 2], ['List', 'True', 'False']],
  ] as [Json, Json][])('%j', (input, expected) => {
    const ce = engine();
    const expr = ce.box(input);
    expect(expr.type.toString()).toMatch(/^list</);
    expect(expr.evaluate().json).toEqual(expected);
  });
});
