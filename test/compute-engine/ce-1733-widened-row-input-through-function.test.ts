/**
 * CE-1733: a Document row whose inferred type is narrower than the type that
 * `inputs` gives it (`k = \max(y_w, 0.01)`, typed `real<0.01..>`, given as
 * `real`) is an input of a compilation that reads it through a function row
 * (`X(x, y) = kx/y`): the body is typed with the given type for the time of
 * the compilation, as an occurrence of `k` in the expression is. It declined
 * with "has no declared type".
 */
import {
  ComputeEngine,
  compile,
  createDocumentEnvironment,
  type DocumentSyntax,
} from '../../src/compute-engine';

type Json = Parameters<DocumentSyntax['normalize']>[0];

type Compiled = { code: string; run: (v: object) => unknown };

function prepareRows(rows: Record<string, [string[], Json]>) {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports((input) => {
    input('x', 'real');
    input('y', 'real');
    input('y_w', 'real');
  });
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
      fieldAxes: new Set(['x', 'y']),
    }
  );
  // The expression is boxed and compiled in the scope of the revision, as
  // a host does.
  const inScope = <T>(fn: () => T): T => {
    ce.pushScope(revision.scope);
    try {
      return fn();
    } finally {
      ce.popScope();
    }
  };
  const compileIn = (json: Json, options: object): Compiled =>
    inScope(
      () =>
        compile(ce.box(json as never), {
          fallback: false,
          ...options,
        } as never) as unknown as Compiled
    );
  const dispose = () => {
    revision.dispose();
    imports.dispose();
    environment.dispose();
  };
  return { ce, inScope, compileIn, dispose };
}

describe('a row typed with a range, given as real, read through a function', () => {
  const doc = prepareRows({
    k: [[], ['Max', 'y_w', 0.01]],
    X: [
      ['x', 'y'],
      ['Divide', ['Multiply', 'k', 'x'], 'y'],
    ],
    S: [['x'], ['Multiply', ['Sqrt', 'k'], 'x']],
  });
  afterAll(() => doc.dispose());

  test('the row has a range type', () => {
    expect(doc.inScope(() => doc.ce.box('k').type.toString())).toBe(
      'real<0.01..>'
    );
  });

  test('glsl reads the uniform', () => {
    const result = doc.compileIn(['X', 'x', 'y'], {
      to: 'glsl',
      vars: { x: 'x', y: 'y', k: 'u_k' },
      inputs: { k: 'real' },
    });
    expect(result.code).toContain('u_k');
    expect(result.code).not.toContain('y_w');
  });

  test('javascript reads the input, also outside the range of the row', () => {
    const result = doc.compileIn(['X', 'x', 'y'], { inputs: { k: 'real' } });
    expect(result.run({ x: 2, y: 1, k: -4 })).toBe(-8);
  });

  test('the body is typed with the given type, as a direct read is', () => {
    // The types read before the compilation are cached outside it, and
    // are not served inside it.
    const typeOfS = () =>
      doc.inScope(() => doc.ce.box(['S', 'x']).type.toString());
    const before = typeOfS();
    // With `k` read as `real`, the square root of a negative `k` is
    // complex, as for `√k x` with `k` in the expression.
    const options = { mode: 'complex', inputs: { k: 'real' } };
    const through = doc.compileIn(['S', 'x'], options);
    const direct = doc.compileIn(['Multiply', ['Sqrt', 'k'], 'x'], options);
    expect(through.run({ x: 2, k: -4 })).toEqual({ re: 0, im: 4 });
    expect(direct.run({ x: 2, k: -4 })).toEqual({ re: 0, im: 4 });
    expect(typeOfS()).toBe(before);
  });

  test('a range that overlaps the range of the row', () => {
    const result = doc.compileIn(['X', 'x', 'y'], {
      inputs: { k: 'real<-5..5>' },
    });
    expect(result.run({ x: 2, y: 1, k: -4 })).toBe(-8);
  });

  test('the row keeps its type after the compilation', () => {
    doc.compileIn(['X', 'x', 'y'], { inputs: { k: 'real' } });
    expect(doc.inScope(() => doc.ce.box('k').type.toString())).toBe(
      'real<0.01..>'
    );
  });

  test('a type that does not fit the row still declines', () => {
    expect(() =>
      doc.compileIn(['X', 'x', 'y'], { inputs: { k: 'list<real>' } })
    ).toThrow(/has no declared type/);
  });
});

describe('an integer row given as real, read through a function', () => {
  const doc = prepareRows({
    n: [[], ['Floor', 'y_w']],
    F: [['x'], ['Multiply', ['Floor', 'n'], 'x']],
  });
  afterAll(() => doc.dispose());

  test('the floor of the input is kept', () => {
    const result = doc.compileIn(['F', 'x'], { inputs: { n: 'real' } });
    expect(result.run({ x: 1, n: 2.5 })).toBe(2);
  });
});
