/**
 * CE-1706: a Document value row bound to a formula (`k = 2x_w`, its type
 * inferred) is an `inputs` name of a compilation also when the expression
 * reads it through a function row (`X(x, y) = kx/y`): its value is hidden
 * and its type kept, when the given type fits in it. It declined with "has
 * no declared type".
 */
import {
  ComputeEngine,
  compile,
  createDocumentEnvironment,
  type DocumentSyntax,
} from '../../src/compute-engine';

type Json = Parameters<DocumentSyntax['normalize']>[0];

describe('a formula row read through a function row is an input', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports((input) => {
    input('x', 'real');
    input('y', 'real');
    input('x_w', 'real');
  });
  const rows: Record<string, [string[], Json]> = {
    k: [[], ['Multiply', 2, 'x_w']],
    X: [
      ['x', 'y'],
      ['Divide', ['Multiply', 'k', 'x'], 'y'],
    ],
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
      fieldAxes: new Set(['x', 'y']),
    }
  );
  afterAll(() => {
    revision.dispose();
    imports.dispose();
    environment.dispose();
  });
  // The expression is boxed and compiled in the scope of the revision, as
  // a host does.
  const compileX = (options: object) => {
    ce.pushScope(revision.scope);
    try {
      return compile(ce.box(['X', 'x', 'y']), {
        fallback: false,
        ...options,
      } as never) as unknown as { code: string; run: (v: object) => number };
    } finally {
      ce.popScope();
    }
  };

  test('glsl reads the uniform', () => {
    const result = compileX({
      to: 'glsl',
      vars: { x: 'x', y: 'y', k: 'u_k' },
      inputs: { k: 'real' },
    });
    expect(result.code).toContain('u_k');
    expect(result.code).not.toContain('u_x_w');
  });

  test.each(['real', 'integer'])('javascript, k given as %s', (type) => {
    expect(compileX({ inputs: { k: type } }).run({ x: 2, y: 1, k: 3 })).toBe(6);
  });

  test('a type that does not fit the row still declines', () => {
    expect(() => compileX({ inputs: { k: 'list<real>' } })).toThrow(
      /has no declared type/
    );
  });
});

describe('the formula of an accepted input is not read', () => {
  // `k = c x_w` with `c` a constant: `k` is given, so its formula, and `c`,
  // are not read, and the name `c` in `inputs` has no effect. It declined
  // with "is a constant" when `k` was read through `f`.
  const ce = new ComputeEngine();
  ce.declare('x_w', 'real');
  ce.declare('t', 'real');
  ce.declare('c', { type: 'real', constant: true, value: 3 });
  ce.assign('k', ce.box(['Multiply', 'c', 'x_w']));
  ce.assign('f', ce.box(['Function', ['Multiply', 'k', 't'], 't']));

  test.each([
    ['through f', ['f', 't']],
    ['direct', ['Multiply', 'k', 't']],
  ] as const)('%s', (_, json) => {
    const result = compile(ce.box(json as never), {
      fallback: false,
      inputs: { k: 'real', c: 'real' },
    } as never) as unknown as { run: (v: object) => number };
    expect(result.run({ t: 2, k: 5 })).toBe(10);
  });
});
