/**
 * CE-1709: a recursive function row of a prepared Document with no stated
 * effect has the least effects that hold those of its body. A body with no
 * effect is `pure`, so the applications of the row are kept: a body that
 * calls itself twice is no longer evaluated once per path. The row had the
 * effects `any`.
 */
import {
  ComputeEngine,
  createDocumentEnvironment,
  type DocumentSyntax,
} from '../../src/compute-engine';

type Json = Parameters<DocumentSyntax['normalize']>[0];

function prepare(
  rows: Record<string, [string[], Json]>,
  effects: Record<string, 'pure' | 'random'> = {}
) {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const revision = imports.prepare(
    Object.keys(rows).map((id) => ({
      id,
      latex: id,
      ...(effects[id] === undefined ? {} : { effects: effects[id] }),
    })),
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
  const inScope = <T>(fn: () => T): T => {
    ce.pushScope(revision.scope);
    try {
      return fn();
    } finally {
      ce.popScope();
    }
  };
  return {
    ce,
    revision,
    typeOf: (name: string) =>
      inScope(() =>
        String(
          (ce.lookupDefinition(name) as { value?: { type: unknown } })?.value
            ?.type
        )
      ),
    evaluate: (json: Json) => inScope(() => ce.box(json).evaluate()),
    dispose: () => {
      revision.dispose();
      imports.dispose();
      environment.dispose();
    },
  };
}

const twice = (f: string): Json => [
  'Which',
  ['Equal', 'n', 0],
  1,
  'True',
  ['Add', [f, ['Subtract', 'n', 1]], [f, ['Subtract', 'n', 1]]],
];

test('a self-recursive row with a pure body is pure, and its calls are kept', () => {
  const doc = prepare({ F: [['n'], twice('F')] });
  try {
    expect(doc.revision.rowErrors.size).toBe(0);
    expect(doc.typeOf('F')).toBe('(unknown) pure -> number');
    // 2^40 evaluations without the memo: this returns only when the
    // applications are kept.
    expect(doc.evaluate(['F', 40]).toString()).toBe(String(2n ** 40n));
  } finally {
    doc.dispose();
  }
});

test('a mutual recursion with pure bodies is pure', () => {
  const doc = prepare({ A: [['n'], twice('B')], B: [['n'], twice('A')] });
  try {
    expect(doc.revision.rowErrors.size).toBe(0);
    expect(doc.typeOf('A')).toBe('(unknown) pure -> number');
    expect(doc.typeOf('B')).toBe('(unknown) pure -> number');
    expect(doc.evaluate(['A', 30]).toString()).toBe(String(2 ** 30));
  } finally {
    doc.dispose();
  }
});

test('a recursive row that draws a random number has the effect random', () => {
  // The body is not pure: the row is not refused, and its effects widen.
  const doc = prepare({
    R: [
      ['n'],
      [
        'Which',
        ['Equal', 'n', 0],
        ['Random'],
        'True',
        ['Add', ['R', ['Subtract', 'n', 1]], 1],
      ],
    ],
  });
  try {
    expect(doc.revision.rowErrors.size).toBe(0);
    expect(doc.typeOf('R')).toMatch(/\) random -> /);
    const value = doc.evaluate(['R', 3]).re;
    expect(value).toBeGreaterThanOrEqual(3);
    expect(value).toBeLessThan(4);
  } finally {
    doc.dispose();
  }
});

// A body that draws a random number at its base case, `n = 0`.
const drawsAtBase = (next: Json): Json => [
  'Which',
  ['Equal', 'n', 0],
  ['Random'],
  'True',
  next,
];
const call = (f: string): Json => [f, ['Subtract', 'n', 1]];
const passes = (next: Json): Json => [
  'Which',
  ['Equal', 'n', 0],
  0,
  'True',
  next,
];

test('an effect that reaches a row only through a call of the component widens it', () => {
  // A draws nothing itself; it calls B, which draws.
  const doc = prepare({
    A: [['n'], passes(call('B'))],
    B: [['n'], drawsAtBase(['Add', call('A'), 1])],
  });
  try {
    expect(doc.revision.rowErrors.size).toBe(0);
    expect(doc.typeOf('A')).toMatch(/\) random -> /);
    expect(doc.typeOf('B')).toMatch(/\) random -> /);
  } finally {
    doc.dispose();
  }
});

test('a row that states pure and calls a row that draws is refused', () => {
  const doc = prepare(
    {
      A: [['n'], passes(call('B'))],
      B: [['n'], drawsAtBase(call('A'))],
    },
    { A: 'pure' }
  );
  try {
    expect(doc.revision.rowErrors.size).toBeGreaterThan(0);
  } finally {
    doc.dispose();
  }
});

test('a row that calls a row stated random is random', () => {
  const doc = prepare(
    {
      A: [['n'], drawsAtBase(call('B'))],
      B: [['n'], passes(call('A'))],
    },
    { A: 'random' }
  );
  try {
    expect(doc.revision.rowErrors.size).toBe(0);
    expect(doc.typeOf('A')).toMatch(/\) random -> /);
    expect(doc.typeOf('B')).toMatch(/\) random -> /);
  } finally {
    doc.dispose();
  }
});
