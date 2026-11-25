/**
 * CE-1799: a Document row that states a type that does not parse (a formal
 * type, the result type of a function row, the value type of a value row) is
 * an error of that row, whether the host gives the body as MathJSON or CE
 * reads it from the LaTeX. `prepare` does not throw, and the other rows are
 * prepared.
 */
import {
  ComputeEngine,
  createDocumentEnvironment,
  type DocumentSourceRow,
  type DocumentSyntax,
} from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

/** The head of a row `f(q)=…` (a function) or `a=…` (a value). */
function headOf(latex: string) {
  const head = latex.slice(0, latex.indexOf('='));
  const call = /^(\w)\((\w)\)$/.exec(head);
  return call
    ? { role: 'function' as const, head: { name: call[1], params: [call[2]] } }
    : { role: 'value' as const, head: { name: head, params: [] } };
}

const split: DocumentSyntax['split'] = (source) => {
  const i = source.indexOf('=');
  return i <= 0
    ? undefined
    : { head: source.slice(0, i), body: source.slice(i + 1) };
};

/** CE reads the body of each row from its LaTeX. */
const latexSyntax: DocumentSyntax = {
  split,
  recognize: (row) => headOf(row.latex),
  normalize: (raw) => raw,
};

/** The host gives the body of each row as MathJSON. `split` gives no body,
 * so the row is not read with the definition parser. */
const jsonSyntax = (
  bodies: Record<string, MathJsonExpression>
): DocumentSyntax => ({
  split: (source) => ({ head: source.slice(0, source.indexOf('=')), body: '' }),
  recognize: (row) => ({ ...headOf(row.latex), bodyJson: bodies[row.id] }),
  normalize: (raw) => raw,
});

/** The row errors of `rows`, as `[id, JSON text]` pairs. */
function rowErrors(rows: DocumentSourceRow[], syntax: DocumentSyntax) {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const revision = imports.prepare(rows, syntax);
  try {
    expect(revision.definitions).toHaveLength(rows.length);
    return [...revision.rowErrors].map(([id, error]) => [
      id,
      JSON.stringify(error.json),
    ]);
  } finally {
    revision.dispose();
    imports.dispose();
    environment.dispose();
  }
}

const invalidAnnotation = (type: string) =>
  expect.stringMatching(
    new RegExp(`invalid-type-annotation.*"'\\\\"${type}\\\\"'"`)
  );

describe.each([
  ['the host gives as MathJSON', jsonSyntax({ g: 'q', a: 1 })],
  ['CE reads from the LaTeX', latexSyntax],
])('a row whose body %s', (_, syntax) => {
  describe.each(['Nope', 'tuple<'])('with the type %s', (type) => {
    const escaped = type.replace('<', '\\<');
    test.each<[string, Partial<DocumentSourceRow>]>([
      ['a formal type', { formalTypes: { q: type } }],
      [
        'a formal type, with a result type',
        { formalTypes: { q: type }, resultType: 'real' },
      ],
      ['a result type', { resultType: type }],
      [
        'a result type, with a formal type',
        { formalTypes: { q: 'real' }, resultType: type },
      ],
    ])('as %s is an error of the function row', (_, types) => {
      expect(
        rowErrors([{ id: 'g', latex: 'g(q)=q', ...types }], syntax)
      ).toEqual([['g', invalidAnnotation(escaped)]]);
    });

    test('as the value type is an error of the value row', () => {
      expect(
        rowErrors([{ id: 'a', latex: 'a=1', valueType: type }], syntax)
      ).toEqual([['a', invalidAnnotation(escaped)]]);
    });
  });

  test('a type that parses only inside a signature is an error', () => {
    expect(
      rowErrors(
        [{ id: 'g', latex: 'g(q)=q', formalTypes: { q: 'real+' } }],
        syntax
      )
    ).toEqual([['g', invalidAnnotation('real\\+')]]);
  });

  test('stated types that parse are accepted', () => {
    expect(
      rowErrors(
        [
          {
            id: 'g',
            latex: 'g(q)=q',
            formalTypes: { q: 'real' },
            resultType: 'real | string',
          },
          { id: 'a', latex: 'a=1', valueType: 'integer' },
        ],
        syntax
      )
    ).toEqual([]);
  });
});

test.each([
  ['CE reads from the LaTeX', latexSyntax],
  [
    'the host gives as MathJSON',
    jsonSyntax({ g: 'q', h: ['Add', ['g', 'x'], 1], a: 2 }),
  ],
])(
  'a row that reads the refused row is refused; another row is prepared (bodies that %s)',
  (_, syntax) => {
    const rows: DocumentSourceRow[] = [
      {
        id: 'g',
        latex: 'g(q)=q',
        formalTypes: { q: 'Nope' },
        resultType: 'real',
      },
      { id: 'h', latex: 'h(x)=g(x)+1' },
      { id: 'a', latex: 'a=2' },
    ];
    expect(rowErrors(rows, syntax)).toEqual([
      ['g', invalidAnnotation('Nope')],
      ['h', expect.stringContaining('invalid-document-dependency')],
    ]);
  }
);

test('a refused row keeps the entry that the host gave for it', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const rawEntry: MathJsonExpression = ['Assign', 'g', 'q'];
  const revision = imports.prepare(
    [{ id: 'g', latex: 'g(q)=q', formalTypes: { q: 'Nope' } }],
    {
      ...jsonSyntax({ g: 'q' }),
      recognize: (row) => ({ ...headOf(row.latex), bodyJson: 'q', rawEntry }),
    }
  );
  try {
    expect(revision.rawRows.get('g')).toEqual(rawEntry);
    expect(JSON.stringify(revision.rowErrors.get('g')?.json)).toEqual(
      invalidAnnotation('Nope')
    );
  } finally {
    revision.dispose();
    imports.dispose();
    environment.dispose();
  }
});

test('a type stated for a name that is not a formal is not read', () => {
  expect(
    rowErrors(
      [{ id: 'g', latex: 'g(q)=q', formalTypes: { z: 'Nope' } }],
      latexSyntax
    )
  ).toEqual([]);
});
