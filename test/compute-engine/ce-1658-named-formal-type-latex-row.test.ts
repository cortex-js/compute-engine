/**
 * CE-1658: a Document row whose LaTeX body is read with a formal of a type
 * that the host declared by name is prepared. `prepare` threw
 * `Failed to parse type "Pt"`: the parser boxed the formal types without the
 * engine's type resolver. A formal type that does not parse is an error of
 * its row.
 */
import {
  ComputeEngine,
  createDocumentEnvironment,
  type DocumentSyntax,
} from '../../src/compute-engine';

/** A syntax whose `recognize` gives the head only: CE reads the body. */
const latexSyntax = (ce: ComputeEngine): DocumentSyntax => ({
  split(source) {
    const i = source.indexOf('=');
    return i <= 0
      ? undefined
      : { head: source.slice(0, i), body: source.slice(i + 1) };
  },
  recognize(row, _names, raw) {
    const entry = raw ?? ce.parse(row.latex, { form: 'raw' }).json;
    if (!Array.isArray(entry) || entry.length !== 3) return undefined;
    const head = entry[1];
    if (
      Array.isArray(head) &&
      head[0] === 'InvisibleOperator' &&
      typeof head[1] === 'string' &&
      Array.isArray(head[2]) &&
      head[2][0] === 'Delimiter'
    ) {
      const params = head[2].slice(1);
      if (params.every((p) => typeof p === 'string'))
        return {
          role: 'function',
          head: { name: head[1], params: params as string[] },
        };
    }
    return undefined;
  },
  normalize: (raw) => raw,
});

/** The row errors of one row `g` with the formal type `type` for `q`. */
function rowErrors(latex: string, type: string) {
  const ce = new ComputeEngine();
  // The registries are read-only while a Document is live: the engine
  // declares the alias first.
  ce.declareType('Pt', 'tuple<real, real>', { alias: true });
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const revision = imports.prepare(
    [{ id: 'g', latex, formalTypes: { q: type } }],
    latexSyntax(ce)
  );
  try {
    expect(revision.definitions.map((d) => d.name)).toEqual(['g']);
    return [...revision.rowErrors].map(([id, error]) => [id, error.json]);
  } finally {
    revision.dispose();
    imports.dispose();
    environment.dispose();
  }
}

// The body `q+1` of a tuple is ill-typed. A `%` comment is a row boundary:
// CE does not read that row with the definition parser, but parses its body
// as a formula with the formals in scope.
describe.each([
  ['read with the definition parser', ''],
  ['parsed as a formula', ' % note'],
])('a formal type in a row whose LaTeX body CE reads, %s', (_, comment) => {
  test('can be a type that the host declared by name', () => {
    expect(rowErrors('g(q)=q' + comment, 'Pt')).toEqual([]);
  });

  test('declared by name gives the same row error as its definition', () => {
    const expected = rowErrors('g(q)=q+1' + comment, 'tuple<real, real>');
    expect(expected).toHaveLength(1);
    expect(rowErrors('g(q)=q+1' + comment, 'Pt')).toEqual(expected);
  });

  test.each(['Nope', 'tuple<'])(
    'that does not parse (%s) is an error of the row',
    (type) => {
      const errors = rowErrors('g(q)=q' + comment, type);
      expect(errors).toHaveLength(1);
      expect(errors[0][0]).toBe('g');
      expect(JSON.stringify(errors[0][1])).toContain(
        `"'invalid-type-annotation'"`
      );
    }
  );
});
