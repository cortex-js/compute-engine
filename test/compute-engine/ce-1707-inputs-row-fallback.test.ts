/**
 * CE-1707: the interpreter fallback of a compilation whose `inputs` names a
 * Document row gives the row the value of the run, also in the body of a
 * function row that reads it. The run threw `Cannot assign a value to the
 * constant "k"`: the row is sealed.
 */
import {
  ComputeEngine,
  compile,
  createDocumentEnvironment,
  type DocumentSyntax,
} from '../../src/compute-engine';
import {
  assertWritableImport,
  withAdmittedValueWrites,
  withoutAdmittedValueWrites,
} from '../../src/compute-engine/boxed-expression/prepared-import-binding';

type Json = Parameters<DocumentSyntax['normalize']>[0];

describe('the fallback of an inputs compilation gives a row its value', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports((input) => {
    input('x', 'real');
    input('x_w', 'real');
  });
  // `Factor` does not compile: each compilation below falls back.
  const rows: Record<string, [string[], Json]> = {
    k: [[], ['Multiply', 2, 'x_w']],
    n: [[], ['Floor', 'x_w']],
    X: [['x'], ['Factor', ['Multiply', 'k', 'x']]],
    Y: [['x'], ['Multiply', 'k', 'x']],
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
    }
  );
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => {
    warn.mockRestore();
    revision.dispose();
    imports.dispose();
    environment.dispose();
  });
  const compileIn = (json: Json, inputs?: object) => {
    ce.pushScope(revision.scope);
    try {
      return compile(ce.box(json as never), { inputs } as never) as unknown as {
        success: boolean;
        run: (v: object) => number;
      };
    } finally {
      ce.popScope();
    }
  };

  test.each([
    ['through a function row', ['X', 'x']],
    ['in a held operand that calls a function row', ['Factor', ['Y', 'x']]],
    ['read directly', ['Factor', ['Multiply', 'k', 'x']]],
  ] as const)('%s', (_, json) => {
    const result = compileIn(json as Json, { k: 'real' });
    expect(result.success).toBe(false);
    expect(result.run({ x: 1, k: 3, x_w: 10 })).toBe(3);
    // The row keeps its formula after the run.
    expect(result.run({ x: 1, x_w: 10 })).toBe(20);
  });

  test('the compiled code gives the same value', () => {
    const result = compileIn(['Y', 'x'], { k: 'real' });
    expect(result.success).toBe(true);
    expect(result.run({ x: 1, k: 3 })).toBe(3);
  });

  test('the row keeps its value outside the run', () => {
    const valueOfK = () => {
      ce.pushScope(revision.scope);
      try {
        return ce.box('k').evaluate().toString();
      } finally {
        ce.popScope();
      }
    };
    const before = valueOfK();
    compileIn(['X', 'x'], { k: 'real' }).run({ x: 1, k: 3, x_w: 10 });
    expect(valueOfK()).toBe(before);
    expect(before).not.toBe('3');
  });

  test('a row whose type is narrower than the given type is not written', () => {
    // `n` is an integer row: a `real` input value could be outside it.
    const result = compileIn(['Factor', ['Multiply', 'n', 'x']], {
      n: 'real',
    });
    expect(() => result.run({ x: 1, n: 0.5, x_w: 10 })).toThrow(
      /Cannot assign a value to the constant "n"/
    );
  });

  test('the window admits the write, not the evaluation inside it', () => {
    // `fallbackRun` evaluates in `withoutAdmittedValueWrites()`: a write
    // there, as by a nested fallback run with no \`inputs\`, is refused.
    const k = revision.scope.bindings.get('k') as { value: object };
    const write = () => assertWritableImport('k', k.value);
    const rows = new Set([k.value]);
    expect(write).toThrow(/Cannot assign a value to the constant "k"/);
    withAdmittedValueWrites(rows, () => {
      expect(write).not.toThrow();
      withoutAdmittedValueWrites(() =>
        expect(write).toThrow(/Cannot assign a value to the constant "k"/)
      );
      expect(write).not.toThrow();
    });
    expect(write).toThrow(/Cannot assign a value to the constant "k"/);
  });

  test('a run key that is not an inputs name still cannot write a row', () => {
    const result = compileIn(['X', 'x']);
    expect(() => result.run({ x: 1, k: 3, x_w: 10 })).toThrow(
      /Cannot assign a value to the constant "k"/
    );
  });
});
