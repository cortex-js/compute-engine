import {
  ComputeEngine,
  compile,
  createDocumentEnvironment,
  type DeclareDocumentInput,
  type DocumentImports,
  type DocumentSourceRow,
  type DocumentSyntax,
  type InspectableScope,
} from '../../src/compute-engine';
import { ConstantAssignmentError } from '../../src/compute-engine/constant-assignment-error';

const operatorOf = (json: unknown) =>
  Array.isArray(json) ? json[0] : undefined;

const syntax: DocumentSyntax = {
  split: (source) =>
    source.startsWith('v=') ? { head: 'v', body: '' } : undefined,
  recognize: (row) => ({
    role: 'value',
    head: { name: 'v', params: [] },
    bodyJson: ['List', Number(row.latex.slice(2))],
  }),
  normalize: (raw) => raw,
};
const rows = (n: number) => [
  { id: 'v', latex: 'v=' + n, valueType: 'list<number>' },
];
/** Prepare `input` and return the JSON of the row error of `id`. */
const rowError = (
  imports: DocumentImports,
  input: DocumentSourceRow[],
  documentSyntax: DocumentSyntax,
  id: string
) => {
  const revision = imports.prepare(input, documentSyntax);
  // Every input row has a raw entry, also a rejected fallback row.
  expect([...revision.rawRows.keys()].sort()).toEqual(
    input.map((row) => row.id).sort()
  );
  const error = revision.rowErrors.get(id)?.json;
  revision.dispose();
  return JSON.stringify(error);
};

test('disposing a factory leaves its existing children alive until they close', () => {
  const ce = new ComputeEngine();
  const create = jest.spyOn(ce, 'createScope');
  const environment = createDocumentEnvironment(ce, () =>
    ce.assign('profileValue', 5)
  );
  const imports = environment.createImports((input) =>
    input('slider', 'number')
  );
  const profileDisposal = jest.spyOn(create.mock.results[0].value, 'dispose');
  const importDisposal = jest.spyOn(create.mock.results[1].value, 'dispose');
  const first = imports.prepare(rows(1), syntax);

  environment.dispose();
  environment.dispose();
  expect(() => environment.createImports(() => {})).toThrow(
    'Document environment is disposed'
  );
  expect(profileDisposal).not.toHaveBeenCalled();
  const second = imports.prepare(rows(2), syntax);
  const readFirst = ce.expr('v', { scope: first.scope });
  const readSecond = ce.expr('v', { scope: second.scope });
  const pass = first.createValuePass(new Set(['v']));

  imports.dispose();
  imports.dispose();
  expect(() => imports.prepare(rows(3), syntax)).toThrow(
    'Document import factory is disposed'
  );
  expect(importDisposal).not.toHaveBeenCalled();
  expect(pass.run(() => readFirst.evaluate().json)).toEqual(['List', 1]);
  expect(readSecond.evaluate().json).toEqual(['List', 2]);

  second.dispose();
  expect(importDisposal).not.toHaveBeenCalled();
  expect(readFirst.evaluate().json).toEqual(['List', 1]);
  first.dispose();
  first.dispose();
  expect(importDisposal).toHaveBeenCalledTimes(1);
  expect(profileDisposal).toHaveBeenCalledTimes(1);
  expect(() => first.createValuePass(new Set())).toThrow(
    'Document revision is disposed'
  );
  expect(() => pass.run(() => readFirst.evaluate())).toThrow(
    'Document revision is disposed'
  );
  expect(() => pass.retain('v', readFirst, readFirst)).toThrow(
    'Document revision is disposed'
  );
  expect(() => first.collectionWriteError('v', readFirst)).toThrow(
    'Document revision is disposed'
  );
});

test('failed late preparation releases the draft and leaves an earlier revision usable', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const first = imports.prepare(rows(1), syntax);
  const originalStack = ce.contextStack;
  const createScope = ce.createScope.bind(ce);
  const created: InspectableScope[] = [];
  jest.spyOn(ce, 'createScope').mockImplementation((bindings, parent) => {
    const scope = createScope(bindings, parent);
    created.push(scope);
    jest.spyOn(scope, 'dispose');
    return scope;
  });
  const fault = new Error('host normalization failed');
  expect(() =>
    imports.prepare([...rows(7), { id: 'preview', latex: 'v' }], {
      ...syntax,
      normalize() {
        expect(ce.expr('v').evaluate().json).toEqual(['List', 7]);
        throw fault;
      },
    })
  ).toThrow(fault);
  expect(created[0].dispose).toHaveBeenCalledTimes(1);
  expect(ce.contextStack).toEqual(originalStack);
  expect(ce.lookupDefinition('v')).toBeUndefined();
  expect(ce.expr('v', { scope: first.scope }).evaluate().json).toEqual([
    'List',
    1,
  ]);

  const next = imports.prepare(rows(3), syntax);
  expect(ce.expr('v', { scope: next.scope }).evaluate().json).toEqual([
    'List',
    3,
  ]);
  const parent = next.scope.parent as InspectableScope;
  const parentDisposal = jest.spyOn(parent, 'dispose');
  imports.dispose();
  next.dispose();
  first.dispose();
  expect(parentDisposal).toHaveBeenCalledTimes(1);
  environment.dispose();
});

test('failed and asynchronous initializers close their input capability', async () => {
  const ce = new ComputeEngine();
  const create = jest.spyOn(ce, 'createScope');
  expect(() =>
    createDocumentEnvironment(ce, async () => {
      throw new Error('async profile failure');
    })
  ).toThrow('Document initialization must be synchronous');
  expect(ce.lookupDefinition('slider')).toBeUndefined();

  const environment = createDocumentEnvironment(ce, () => {});
  const profileDisposal = jest.spyOn(create.mock.results[1].value, 'dispose');
  let escaped: DeclareDocumentInput | undefined;
  const fault = new Error('host import failure');
  expect(() =>
    environment.createImports((declareInput) => {
      escaped = declareInput;
      declareInput('slider', 'number');
      throw fault;
    })
  ).toThrow(fault);
  expect(() => escaped?.('late', 'number')).toThrow(
    'Document imports are already prepared'
  );

  let lateFailure: unknown;
  expect(() =>
    environment.createImports(async (declareInput) => {
      await Promise.resolve();
      try {
        declareInput('late', 'number');
      } catch (error) {
        lateFailure = error;
      }
    })
  ).toThrow('Document initialization must be synchronous');
  await Promise.resolve();
  expect(lateFailure).toEqual(
    new Error('Document imports are already prepared')
  );
  expect(ce.lookupDefinition('slider')).toBeUndefined();
  expect(ce.lookupDefinition('late')).toBeUndefined();

  environment.dispose();
  expect(profileDisposal).toHaveBeenCalledTimes(1);
});

test('duplicate row identities fail before parsing and writable roles are revision-local', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const roles = new Set(['v']);
  const first = imports.prepare(rows(1), syntax, roles);
  roles.clear();
  const next = imports.prepare(rows(2), syntax, roles);
  const value = ce.expr(['List', 4, 5]);
  expect(first.collectionWriteError('v', value)).toBeUndefined();
  expect(next.collectionWriteError('v', value)).toBe(
    'v has no prepared writable slot'
  );

  const split = jest.fn(syntax.split);
  expect(() =>
    imports.prepare([...rows(3), ...rows(4)], { ...syntax, split })
  ).toThrow('Duplicate Document row ID: v');
  expect(split).not.toHaveBeenCalled();
  expect(ce.expr('v', { scope: first.scope }).evaluate().json).toEqual([
    'List',
    1,
  ]);
  expect(ce.expr('v', { scope: next.scope }).evaluate().json).toEqual([
    'List',
    2,
  ]);
  first.dispose();
  next.dispose();
  imports.dispose();
  environment.dispose();
});

test('one redraw shares reads, rejects async callbacks and takes fresh inputs in a new pass', async () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports((declareInput) => {
    declareInput('slider', 'number');
    ce.assign('slider', 2);
  });
  const revision = imports.prepare(rows(1), {
    ...syntax,
    recognize: () => ({
      role: 'value',
      head: { name: 'v', params: [] },
      bodyJson: ['List', 'slider'],
    }),
  });
  const read = () => ce.expr('v', { scope: revision.scope }).evaluate();
  const first = revision.createValuePass(new Set(['v']));
  const sampled = first.run(read);
  expect(sampled.json).toEqual(['List', 2]);
  expect(first.run(read)).toBe(sampled);
  expect(() =>
    first.run(async () => {
      throw new Error('async pass failure');
    })
  ).toThrow('Document value pass reads must be synchronous');
  await Promise.resolve();

  ce._inScope(revision.scope, () => ce.assign('slider', 9));
  const next = revision.createValuePass(new Set(['v']));
  expect(next.run(read).json).toEqual(['List', 9]);
  expect(() =>
    ce._inScope(revision.scope, () => ce.assign('slider', ce.string('bad')))
  ).toThrow();
  expect(next.run(read).json).toEqual(['List', 9]);
  revision.dispose();
  imports.dispose();
  environment.dispose();
});

describe('a new pass draws again from a random lazy collection at any depth', () => {
  // Twenty draws: two passes give the same list with probability 0.
  const draws = [
    'Comprehension',
    ['Random'],
    ['Element', 'n', ['Range', 1, 20]],
  ];
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  /** The elements of `H` in two reads of each of two passes. */
  const passes = (body: unknown, g: unknown = 0) => {
    const revision = imports.prepare(
      [
        { id: 'G', latex: 'G' },
        { id: 'H', latex: 'H' },
      ],
      {
        split: (source) => ({ head: source, body: '' }),
        recognize: (row) => ({
          role: 'value',
          head: { name: row.id, params: [] },
          bodyJson: (row.id === 'G' ? g : body) as never,
        }),
        normalize: (raw) => raw,
      }
    );
    expect(revision.rowErrors.size).toBe(0);
    const read = () =>
      [...ce.expr('H', { scope: revision.scope }).evaluate().each()].map(
        (x) => x.N().re
      );
    const result = [0, 1].map(() => {
      const pass = revision.createValuePass(new Set(['H']));
      return [pass.run(read), pass.run(read)];
    });
    revision.dispose();
    return result;
  };
  afterAll(() => {
    imports.dispose();
    environment.dispose();
  });

  test.each([
    [
      'ListJoin of a range and a comprehension',
      ['ListJoin', ['Range', 1, 3], draws],
    ],
    ['ListJoin of two comprehensions', ['ListJoin', draws, draws]],
    ['Reverse of a comprehension', ['Reverse', draws]],
  ])('%s', (_, body) => {
    const [[a, b], [c, d]] = passes(body);
    expect(b).toEqual(a);
    expect(d).toEqual(c);
    expect(c).not.toEqual(a);
    expect(c.slice(-20)).not.toEqual(a.slice(-20));
  });

  test('a value that holds the collection of a row outside the pass', () => {
    const [[a, b], [c, d]] = passes(['Reverse', 'G'], draws);
    expect(b).toEqual(a);
    expect(d).toEqual(c);
    expect(c).not.toEqual(a);
  });

  test('one pass shares the draws of a row among the rows that read it', () => {
    const revision = imports.prepare(
      [
        { id: 'G', latex: 'G' },
        { id: 'H', latex: 'H' },
        { id: 'J', latex: 'J' },
      ],
      {
        split: (source) => ({ head: source, body: '' }),
        recognize: (row) => ({
          role: 'value',
          head: { name: row.id, params: [] },
          bodyJson: (row.id === 'G'
            ? draws
            : row.id === 'H'
              ? ['Reverse', 'G']
              : ['ListJoin', 'G', 'G']) as never,
        }),
        normalize: (raw) => raw,
      }
    );
    expect(revision.rowErrors.size).toBe(0);
    const elements = (name: string) =>
      [...ce.expr(name, { scope: revision.scope }).evaluate().each()].map(
        (x) => x.N().re
      );
    // G, H and J in one pass: H reverses G's draws, and J joins them twice.
    const pass = revision.createValuePass(new Set(['G', 'H', 'J']));
    const [g, h, j] = pass.run(() => ['G', 'H', 'J'].map(elements));
    expect(h).toEqual([...g].reverse());
    expect(j).toEqual([...g, ...g]);
    // Only J in the pass: its two operands are one draw set.
    const alone = revision
      .createValuePass(new Set(['J']))
      .run(() => elements('J'));
    expect(alone.slice(20)).toEqual(alone.slice(0, 20));
    revision.dispose();
  });
});

test('failed profile and import initialization cannot publish a type or constructor', () => {
  const ce = new ComputeEngine();
  const registryError = /Type and protocol registries are read-only/;
  expect(() =>
    createDocumentEnvironment(ce, () => {
      ce.declareType('FailedProfileType', 'tuple<amount: integer>');
    })
  ).toThrow(registryError);
  expect(() => ce.type('FailedProfileType')).toThrow();
  expect(ce.lookupDefinition('FailedProfileType')).toBeUndefined();

  // A failed profile releases its lease. The next environment can read types
  // registered before it opens.
  ce.declareType('HostScalar', 'integer', { alias: true });
  const environment = createDocumentEnvironment(ce, () => {});
  const fault = new Error('refuse imports');
  expect(() =>
    environment.createImports((input) => {
      input('slider', 'HostScalar');
      expect(() =>
        ce.declareType('DocumentProbe', 'tuple<amount: integer>')
      ).toThrow(registryError);
      expect(() => ce.declareProtocol('DocumentProtocol', {})).toThrow(
        registryError
      );
      throw fault;
    })
  ).toThrow(fault);
  expect(() => ce.type('DocumentProbe')).toThrow();
  expect(ce.lookupDefinition('DocumentProbe')).toBeUndefined();
  expect(ce._protocolRegistry.DocumentProtocol).toBeUndefined();
  expect(ce.lookupDefinition('slider')).toBeUndefined();

  const imports = environment.createImports((input) =>
    input('slider', 'HostScalar')
  );
  imports.dispose();
  environment.dispose();
});

test('two live revisions share stable external type and protocol registries', () => {
  const ce = new ComputeEngine();
  const registryError = /Type and protocol registries are read-only/;
  ce.declareType('HostScalar', 'integer', { alias: true, fromStatement: true });
  const promise = ce._typeResolver.forward('ExistingPromise');
  ce.declareProtocol('HostMarker', {});
  ce.declareProtocolImplementation('integer', 'HostMarker', {});
  const environment = createDocumentEnvironment(ce, () => {});
  const makeImports = () =>
    environment.createImports((input) => input('slider', 'HostScalar'));
  const imports = makeImports();
  const secondImports = makeImports();
  const first = imports.prepare(rows(1), syntax);
  const second = secondImports.prepare(rows(2), syntax);

  const firstRead = ce.expr('v', { scope: first.scope });
  const secondRead = ce.expr('v', { scope: second.scope });
  const failed = new Error('refuse replacement');
  expect(() =>
    environment.createImports(() => {
      expect(() =>
        ce.declareType('HostScalar', 'string', {
          alias: true,
          fromStatement: true,
        })
      ).toThrow(registryError);
      expect(() =>
        ce.declareProtocolImplementation('string', 'HostMarker', {})
      ).toThrow(registryError);
      throw failed;
    })
  ).toThrow(failed);
  const type = ce.box(['DeclareType', 'RevisionType', { str: 'integer' }]);
  expect(type.toString()).toMatch(registryError);
  expect(ce.lookupDefinition('RevisionType')).toBeUndefined();
  const protocol = ce.box(['DeclareProtocol', 'RevisionProtocol']);
  expect(protocol.toString()).toMatch(registryError);
  expect(ce._protocolRegistry.RevisionProtocol).toBeUndefined();
  const conformance = ce.box([
    'DeclareConformance',
    { str: 'string' },
    ['List', 'HostMarker'],
  ]);
  expect(conformance.toString()).toMatch(registryError);
  const sum = ce.box([
    'DeclareSumType',
    { sym: 'RevisionSum' },
    ['Tuple', { str: 'revisionA' }, { str: 'nothing' }],
    ['Tuple', { str: 'revisionB' }, { str: 'boolean' }],
  ]);
  expect(sum.toString()).toMatch(registryError);
  expect(() => ce.type('RevisionSum')).toThrow();
  expect(ce.lookupDefinition('revisionA')).toBeUndefined();
  expect(() => ce._typeResolver.forward('RevisionPromise')).toThrow(
    registryError
  );
  expect(ce._typeRegistry.RevisionPromise).toBeUndefined();
  expect(() => ce.type('type ExistingPromise<integer>')).toThrow(registryError);
  expect(ce._typeRegistry.ExistingPromise).toBe(promise);
  expect(ce.type('HostScalar').matches('integer')).toBe(true);
  expect(ce._typeResolver.conformsTo!('integer', 'HostMarker')).toBe(true);
  expect(ce._typeResolver.conformsTo!('string', 'HostMarker')).toBe(false);
  expect(firstRead.evaluate().json).toEqual(['List', 1]);
  expect(secondRead.evaluate().json).toEqual(['List', 2]);

  // The registry lease belongs to the live profile, not its factory handle.
  environment.dispose();
  imports.dispose();
  secondImports.dispose();
  first.dispose();
  expect(() =>
    ce.declareType('HostScalar', 'string', { alias: true, fromStatement: true })
  ).toThrow(registryError);
  expect(secondRead.evaluate().json).toEqual(['List', 2]);
  const otherEnvironment = createDocumentEnvironment(ce, () => {});
  second.dispose();
  expect(() =>
    ce.declareType('HostScalar', 'string', { alias: true, fromStatement: true })
  ).toThrow(registryError);
  otherEnvironment.dispose();

  ce.declareType('ExistingPromise', 'integer', { alias: true });
  ce.declareType('HostScalar', 'string', { alias: true, fromStatement: true });
  ce.declareProtocolImplementation('string', 'HostMarker', {});
  expect(ce.type('HostScalar').matches('string')).toBe(true);
  expect(ce._typeResolver.conformsTo!('string', 'HostMarker')).toBe(true);
});

test('failed import initialization leaves no value-kind registration', () => {
  const ce = new ComputeEngine();
  const registryError = /Value-kind registrations are read-only/;
  ce.declareType('docprobe', 'value', { mint: false });
  const definition = {
    signature: '(integer) -> docprobe' as const,
    arithmetic: { negate: () => undefined },
  };
  const environment = createDocumentEnvironment(ce, () => {});
  const fault = new Error('refuse imports');
  expect(() =>
    environment.createImports(() => {
      expect(() => ce.declare('DocKind', definition)).toThrow(registryError);
      expect(ce.lookupDefinition('DocKind')).toBeUndefined();
      throw fault;
    })
  ).toThrow(fault);
  expect(ce.lookupDefinition('DocKind')).toBeUndefined();
  expect(ce._kindRegistry.types.has('docprobe')).toBe(false);
  expect(ce._kindRegistry.withValues.has('docprobe')).toBe(false);

  environment.dispose();
  ce.declare('DocKind', definition);
  expect(ce._kindRegistry.types.has('docprobe')).toBe(true);
});

test('a live revision protects a saved value’s kind arithmetic', () => {
  const ce = new ComputeEngine();
  const registryError = /Value-kind registrations are read-only/;
  ce.declareType('docprobe', 'value', { mint: false });
  ce.declare('DocKind', {
    signature: '(integer) -> docprobe',
    arithmetic: { negate: () => ce.box(['DocKind', -7]) },
  });
  const saved = ce.box(['DocKind', 7]);
  const negated = () =>
    ce.expr(['Negate', saved], { form: 'structural' }).canonical.evaluate()
      .json;
  const binding = ce.lookupDefinition('DocKind');
  expect(negated()).toEqual(['DocKind', -7]);

  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const revision = imports.prepare(rows(1), syntax);
  environment.dispose();
  imports.dispose();

  ce.assign('ordinary', 9);
  expect(() => ce.undeclare(['ordinary', 'DocKind'])).toThrow(registryError);
  expect(ce.expr('ordinary').evaluate().json).toBe(9);
  expect(() =>
    ce.declare('DocKind', { arithmetic: undefined }, { extend: true })
  ).toThrow(registryError);
  expect(() =>
    ce.declare(
      'DocKind',
      {
        arithmetic: { negate: () => ce.box(['DocKind', -8]) },
      },
      { extend: true }
    )
  ).toThrow(registryError);
  expect(() => ce.assign('DocKind', 2)).toThrow(registryError);
  expect(() =>
    ce.loadLibrary({
      name: 'late-kind',
      definitions: {
        OrdinaryLate: { signature: '(integer) -> integer' },
        KindLate: {
          signature: '(integer) -> docprobe',
          arithmetic: { negate: () => undefined },
        },
      },
    })
  ).toThrow(registryError);
  expect(ce.lookupDefinition('OrdinaryLate')).toBeUndefined();
  expect(ce.lookupDefinition('KindLate')).toBeUndefined();
  expect(ce.lookupDefinition('DocKind')).toBe(binding);
  expect(negated()).toEqual(['DocKind', -7]);
  expect(ce.expr('v', { scope: revision.scope }).evaluate().json).toEqual([
    'List',
    1,
  ]);

  revision.dispose();
  ce.undeclare(['ordinary', 'DocKind']);
  expect(ce.lookupDefinition('ordinary')).toBeUndefined();
  expect(ce.lookupDefinition('DocKind')).toBeUndefined();
  expect(negated()).toEqual(['Negate', ['DocKind', 7]]);
});

test('published bindings and namespaces refuse writes through the active scope', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const revision = imports.prepare(rows(1), syntax);
  const retained = ce.expr('v', { scope: revision.scope });
  const value = ce.box(['List', 7]);
  ce.pushScope(revision.scope);
  try {
    expect(() => ce.assign('v', value)).toThrow(ConstantAssignmentError);
    expect(() => ce.undeclare('v')).toThrow(ConstantAssignmentError);
    expect(() => ce.declare('added', 'integer')).toThrow(
      ConstantAssignmentError
    );
    expect(() => ce.assign('added', 9)).toThrow(ConstantAssignmentError);
    expect(() => ce.box(['Assign', 'v', ['List', 7]]).evaluate()).toThrow(
      ConstantAssignmentError
    );
    expect(() => ce.withValues({ v: value }, () => {})).toThrow(
      ConstantAssignmentError
    );
    expect(ce.box(['Add', 'added', 1]).evaluate().json).toEqual([
      'Add',
      'added',
      1,
    ]);
    expect(ce.lookupDefinition('added')).toBeUndefined();
    expect(retained.evaluate().json).toEqual(['List', 1]);

    ce.pushScope();
    try {
      ce.declare('scratch', 'integer');
      ce.assign('scratch', 9);
      expect(ce.box('scratch').evaluate().json).toBe(9);
      expect(() => ce.assign('v', value)).toThrow(ConstantAssignmentError);
    } finally {
      ce.popScope();
    }
    expect(ce.lookupDefinition('scratch')).toBeUndefined();
  } finally {
    ce.popScope();
    revision.dispose();
    imports.dispose();
    environment.dispose();
  }
});

test('published writable rows and declared inputs admit value writes only', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports((input) =>
    input('slider', 'number')
  );
  const revision = imports.prepare(rows(1), syntax, new Set(['v', 'absent']));
  const value = ce.box(['List', 7, 8]);
  ce.pushScope(revision.scope);
  try {
    const binding = ce.lookupDefinition('v');
    expect(revision.collectionWriteError('v', value)).toBeUndefined();
    ce.assign('v', value);
    expect(ce.box('v').evaluate().json).toEqual(['List', 7, 8]);
    expect(ce.lookupDefinition('v')).toBe(binding);
    expect(() => ce.assign('v', ce.string('wrong'))).toThrow();
    expect(() => ce.undeclare('v')).toThrow(ConstantAssignmentError);
    expect(() => ce.assign('absent', 9)).toThrow(ConstantAssignmentError);
    ce.assign('slider', 3);
    expect(ce.box('slider').evaluate().json).toBe(3);
    expect(
      ce.withValues({ slider: 8 }, () => ce.box('slider').evaluate().json)
    ).toBe(8);
    expect(ce.box('slider').evaluate().json).toBe(3);
  } finally {
    ce.popScope();
    revision.dispose();
    imports.dispose();
    environment.dispose();
  }
});

test('a refused retype or value write of a sealed binding leaves its assumptions', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports((input) => input('s', 'real'));
  const revision = imports.prepare(rows(1), syntax);
  ce.pushScope(revision.scope);
  try {
    ce.assume(ce.box(['Greater', 's', 0]));
    expect(ce.box('s').isPositive).toBe(true);
    expect(() => {
      ce.box('s').type = 'integer';
    }).toThrow(ConstantAssignmentError);
    expect(ce.box('s').type.toString()).toBe('real');
    expect(ce.box('s').isPositive).toBe(true);
    expect(() => {
      ce.box('v').value = ce.box(['List', 7]);
    }).toThrow(ConstantAssignmentError);
    expect(ce.box('v').evaluate().json).toEqual(['List', 1]);
  } finally {
    ce.popScope();
    revision.dispose();
    imports.dispose();
    environment.dispose();
  }
});

test('the interpreter fallback of a declined compilation runs with free inputs in a revision scope', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const rowSyntax: DocumentSyntax = {
    split: (source) => {
      const i = source.indexOf('=');
      return i <= 0
        ? undefined
        : { head: source.slice(0, i), body: source.slice(i + 1) };
    },
    recognize: (row) => ({
      role: 'value',
      head: { name: row.latex.slice(0, row.latex.indexOf('=')), params: [] },
    }),
    normalize: (raw) => raw,
  };
  const revision = imports.prepare(
    [
      { id: 'K', latex: 'K=3' },
      { id: 'p', latex: 'p=[10,20,30]' },
    ],
    rowSyntax
  );
  expect(revision.rowErrors.size).toBe(0);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  ce.pushScope(revision.scope);
  try {
    // `Expand` makes each compilation decline: `run` is the interpreter.
    const declined = (json: unknown) => {
      const result = compile(ce.box(json as never), { to: 'javascript' });
      expect(result.success).toBe(false);
      return result.run as (vars: Record<string, unknown>) => unknown;
    };
    // A free input that is not a row is substituted, as a compiled run
    // reads it, and no name is declared.
    expect(declined(['Expand', ['Add', 'K', 'Q']])({ Q: 4 })).toBe(7);
    expect(declined(['Expand', ['At', 'p', 's']])({ s: 2 })).toBe(20);
    expect(
      declined(['Expand', ['Add', ['At', 'L', 2], 'K']])({ L: [5, 6, 7] })
    ).toBe(9);
    // An input named `__proto__` is a name like any other.
    expect(
      declined(['Expand', ['Add', 'K', '__proto__']])(
        JSON.parse('{"__proto__": 4}')
      )
    ).toBe(7);
    // The variable of a binder of the same name is not substituted.
    expect(
      declined(['Expand', ['Add', 'Q', ['Sum', 'Q', ['Limits', 'Q', 1, 3]]]])({
        Q: 10,
      })
    ).toBe(16);
    // A row read with no run argument.
    expect(declined(['Expand', ['Add', 'K', 1]])({})).toBe(4);
    // A run argument does not write a published row.
    expect(() => declined(['Expand', ['Add', 'K', 1]])({ K: 5 })).toThrow(
      ConstantAssignmentError
    );
    expect(() =>
      declined(['Expand', ['At', 'p', 's']])({ p: [1, 2, 3], s: 2 })
    ).toThrow(ConstantAssignmentError);
  } finally {
    ce.popScope();
    warn.mockRestore();
  }
  // No scope of the revision chain, the system scope included, holds a
  // declaration of the inputs.
  let root = revision.scope;
  for (
    let scope: typeof revision.scope | null = revision.scope;
    scope;
    scope = scope.parent
  ) {
    root = scope;
    for (const name of ['Q', 's', 'L'])
      expect(scope.bindings.has(name)).toBe(false);
  }
  ce.assign('Q', 9);
  expect(ce.context.lexicalScope.bindings.has('Q')).toBe(true);
  expect(root.bindings.has('Q')).toBe(false);
  revision.dispose();
  imports.dispose();
  environment.dispose();
});

test('the interpreter fallback of a declined compilation reads a declared input through a row', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports((input) => input('Q', 'real'));
  const revision = imports.prepare(
    [
      { id: 'g', latex: 'g=Q+1' },
      { id: 'h', latex: 'h=2g' },
      { id: 'w', latex: 'w=Q+3' },
      { id: 'f', latex: 'f(x)=x+Q' },
    ],
    latexSyntax(ce),
    new Set(['w'])
  );
  expect(revision.rowErrors.size).toBe(0);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  ce.pushScope(revision.scope);
  try {
    const runOf = (json: unknown, success: boolean) => {
      const result = compile(ce.box(json as never), { to: 'javascript' });
      expect(result.success).toBe(success);
      return result.run as (vars: Record<string, unknown>) => unknown;
    };
    // `Expand` makes each compilation decline: its `run` is the
    // interpreter, and gives the value of the compiled run.
    for (const [body, q4, q10] of [
      [['Add', 'g', 0], 5, 11],
      [['Add', 'h', 0], 10, 22],
      [['Add', 'w', 0], 7, 13],
      [['f', 2], 6, 12],
    ] as const) {
      const compiled = runOf(body, true);
      const declined = runOf(['Expand', body], false);
      expect(compiled({ Q: 4 })).toBe(q4);
      expect(declined({ Q: 4 })).toBe(q4);
      // A second run with another value is not served the first one.
      expect(compiled({ Q: 10 })).toBe(q10);
      expect(declined({ Q: 10 })).toBe(q10);
    }
  } finally {
    ce.popScope();
    warn.mockRestore();
  }
  revision.dispose();
  imports.dispose();
  environment.dispose();
});

test('a stated result type or effect is checked when some formals are unannotated', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const fnSyntax = (
    body: Parameters<DocumentSyntax['normalize']>[0]
  ): DocumentSyntax => ({
    split: () => ({ head: 'f', body: '' }),
    recognize: () => ({
      role: 'function',
      head: { name: 'f', params: ['x'] },
      bodyJson: body,
    }),
    normalize: (raw) => raw,
  });
  expect(
    rowError(
      imports,
      [{ id: 'f', latex: 'f', effects: 'pure' }],
      fnSyntax(['Add', 'x', ['Random']]),
      'f'
    )
  ).toContain('does not match');
  expect(
    rowError(
      imports,
      [{ id: 'f', latex: 'f', resultType: 'list<number>' }],
      fnSyntax(['Add', 'x', 1]),
      'f'
    )
  ).toContain('does not match');
  const ok = imports.prepare(
    [{ id: 'f', latex: 'f', effects: 'pure', resultType: 'number' }],
    fnSyntax(['Add', 'x', 1])
  );
  expect(ok.rowErrors.size).toBe(0);
  ok.dispose();
  const promised = imports.prepare(
    [{ id: 'f', latex: 'f', resultType: 'real' }],
    fnSyntax(['Power', 'x', 2])
  );
  expect(promised.rowErrors.size).toBe(0);
  promised.dispose();
  const named = imports.prepare(
    [{ id: 'f', latex: 'f', effects: 'pure' }],
    fnSyntax(['Add', 'x', 1])
  );
  expect(
    ce
      .expr(['f', ['NamedArgument', "'x'", 2]], { scope: named.scope })
      .evaluate().json
  ).toEqual(3);
  named.dispose();
  imports.dispose();
  environment.dispose();
});

test('a stated result is a promise with or without formal annotations', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const sqrtSyntax: DocumentSyntax = {
    split: () => ({ head: 'f', body: '' }),
    recognize: () => ({
      role: 'function',
      head: { name: 'f', params: ['x'] },
      bodyJson: ['Sqrt', 'x'],
    }),
    normalize: (raw) => raw,
  };
  // The inferred result of Sqrt(x) for a real x is complex: not a subtype
  // of real, but not disjoint from it.
  for (const formalTypes of [undefined, { x: 'real' }]) {
    const revision = imports.prepare(
      [{ id: 'f', latex: 'f', resultType: 'real', formalTypes }],
      sqrtSyntax
    );
    expect(revision.rowErrors.size).toBe(0);
    expect(
      ce.expr(['f', 4], { scope: revision.scope }).evaluate().json
    ).toEqual(2);
    revision.dispose();
    expect(
      rowError(
        imports,
        [{ id: 'f', latex: 'f', resultType: 'list<real>', formalTypes }],
        sqrtSyntax,
        'f'
      )
    ).toContain('does not match');
  }
  // A fully annotated row still refuses effects beyond the stated ones.
  expect(
    rowError(
      imports,
      [
        {
          id: 'f',
          latex: 'f',
          resultType: 'real',
          effects: 'pure',
          formalTypes: { x: 'real' },
        },
      ],
      {
        ...sqrtSyntax,
        recognize: () => ({
          role: 'function',
          head: { name: 'f', params: ['x'] },
          bodyJson: ['Add', 'x', ['Random']],
        }),
      },
      'f'
    )
  ).toContain('does not match');
  imports.dispose();
  environment.dispose();
});

test('a field value is checked against its stated value type', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  const fieldSyntax: DocumentSyntax = {
    ...syntax,
    fieldAxes: new Set(['x']),
    recognize: () => ({
      role: 'value',
      head: { name: 'v', params: [] },
      bodyJson: 'x',
    }),
  };
  expect(
    rowError(
      imports,
      [{ id: 'v', latex: 'v=', valueType: 'list<number>' }],
      fieldSyntax,
      'v'
    )
  ).toContain('v: initializer does not match list<number>');
  const ok = imports.prepare(
    [{ id: 'v', latex: 'v=', valueType: 'real' }],
    fieldSyntax
  );
  expect(ok.definitions[0].fieldParameters).toEqual(['x']);
  ok.dispose();
  imports.dispose();
  environment.dispose();
});

// Rows parsed by the CE LaTeX parser through the fast definition path.
// `f(x)` has the raw head `["InvisibleOperator", "f", ["Delimiter", "x"]]`.
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
    if (typeof head === 'string')
      return { role: 'value', head: { name: head, params: [] } };
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

describe('row content errors are reported per row', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  afterAll(() => {
    imports.dispose();
    environment.dispose();
  });
  const prepare = (input: DocumentSourceRow[], writable?: Set<string>) => {
    const revision = imports.prepare(input, latexSyntax(ce), writable);
    // Every input row has a raw entry, also an error row.
    expect([...revision.rawRows.keys()].sort()).toEqual(
      input.map((row) => row.id).sort()
    );
    return revision;
  };
  const error = (
    revision: ReturnType<typeof prepare>,
    id: string
  ): string | undefined => {
    const diagnostic = revision.rowErrors.get(id);
    return diagnostic === undefined
      ? undefined
      : JSON.stringify(diagnostic.json);
  };
  const value = (revision: ReturnType<typeof prepare>, expr: string) =>
    ce.parse(expr, { scope: revision.scope }).evaluate().json;

  test('a valid row recognized without a raw entry has its own parse', () => {
    // The comma at depth 0 sends `h` to the fallback recognition, and this
    // host returns no `rawEntry` there.
    const revision = prepare([
      { id: 'h', latex: 'h=\\{1,2\\}' },
      { id: 'g', latex: 'g(x)=x' },
    ]);
    expect(revision.rowErrors.size).toBe(0);
    expect(operatorOf(revision.rawRows.get('h'))).toBe('Equal');
    revision.dispose();
  });

  test('a head that a later row changes is a row error', () => {
    // This host reads `f` as a function only once `g` is declared, so the
    // confirming call (which sees the later row `g`) gives another head.
    const base = latexSyntax(ce);
    const headSyntax: DocumentSyntax = {
      ...base,
      recognize(row, names, raw) {
        const found = base.recognize(row, names, raw);
        if (found?.head.name !== 'f' || names.has('g')) return found;
        return { role: 'value', head: { name: 'f', params: [] } };
      },
    };
    const rows: DocumentSourceRow[] = [
      { id: 'f', latex: 'f(x)=x+1' },
      { id: 'g', latex: 'g=1' },
    ];
    const revision = imports.prepare(rows, headSyntax);
    expect([...revision.rawRows.keys()].sort()).toEqual(['f', 'g']);
    expect(error(revision, 'f')).toContain('Definition head changed');
    // The row keeps its parsed entry, not the diagnostic.
    expect(operatorOf(revision.rawRows.get('f'))).toBe('Equal');
    expect(error(revision, 'g')).toBeUndefined();
    expect(value(revision, 'g')).toBe(1);
    revision.dispose();
  });

  test('a value cycle through a subscript rejects its component', () => {
    const revision = prepare([
      { id: 'a', latex: 'a=b_1' },
      { id: 'b', latex: 'b=a_1' },
      { id: 'c', latex: 'c=2' },
      { id: 'd', latex: 'd=a_1' },
    ]);
    expect(error(revision, 'b')).toContain('Value initialization cycle');
    expect(error(revision, 'a')).toContain('invalid-document-dependency');
    expect(error(revision, 'd')).toContain('invalid-document-dependency');
    expect(revision.rowReferences.get('d')).toContain('a');
    expect(error(revision, 'c')).toBeUndefined();
    expect(value(revision, 'c')).toBe(2);
    revision.dispose();
  });

  test('a reader of a rejected indexed base gets a dependency error', () => {
    for (const base of [
      { id: 'L', latex: 'L=[1,2]', valueType: 'string' },
      { id: 'L', latex: 'L=[1,2]+&' },
    ]) {
      const revision = prepare([{ id: 'y', latex: 'y=L_1' }, base]);
      expect(error(revision, 'L')).toBeDefined();
      expect(error(revision, 'y')).toContain('invalid-document-dependency');
      expect(revision.rowReferences.get('y')).toContain('L');
      revision.dispose();
    }
  });

  test('a valid indexed base absorbed into a name adds no reference', () => {
    const revision = prepare([
      { id: 'a', latex: 'a=1' },
      { id: 'y', latex: 'y=a_1' },
    ]);
    expect(revision.rowErrors.size).toBe(0);
    expect(revision.rowReferences.get('y')).not.toContain('a');
    revision.dispose();
  });

  test('a blank definition body is a row error on both parse paths', () => {
    // `f(x)=` has an empty split body and takes the recognition path;
    // `f(x)= ` takes the definition parser.
    for (const latex of ['f(x)=', 'f(x)= ']) {
      const revision = prepare([
        { id: 'f', latex },
        { id: 'g', latex: 'g=1' },
      ]);
      expect(error(revision, 'f')).toContain('Incomplete definition body');
      expect(error(revision, 'g')).toBeUndefined();
      expect(value(revision, 'g')).toBe(1);
      revision.dispose();
    }
  });

  test('a body that the definition parser cannot finish is a row error', () => {
    for (const body of ['x+1&', ' ']) {
      const revision = prepare([
        { id: 'f', latex: 'f(x)=' + body },
        { id: 'g', latex: 'g(x)=2x' },
        { id: 'h', latex: 'h(x)=f(x)' },
      ]);
      expect(error(revision, 'f')).toContain('Incomplete definition body');
      expect(JSON.stringify(revision.rawRows.get('f'))).toContain(
        'Incomplete definition body'
      );
      expect(error(revision, 'h')).toContain('invalid-document-dependency');
      expect(error(revision, 'g')).toBeUndefined();
      expect(value(revision, 'g(3)')).toBe(6);
      revision.dispose();
    }
  });

  test('a body that contradicts its stated type rejects the row and its readers', () => {
    const fn = prepare([
      { id: 'f', latex: 'f(x)=x+1', resultType: 'list<number>' },
      { id: 'c', latex: 'c=f(1)' },
      { id: 'd', latex: 'd=2' },
    ]);
    expect(error(fn, 'f')).toContain('does not match');
    expect(error(fn, 'c')).toContain('invalid-document-dependency');
    expect(value(fn, 'd')).toBe(2);
    fn.dispose();
    const v = prepare([
      { id: 'a', latex: 'a=1', valueType: 'string' },
      { id: 'c', latex: 'c=a+1' },
      { id: 'd', latex: 'd=2' },
    ]);
    expect(error(v, 'a')).toContain('a: initializer does not match string');
    expect(error(v, 'c')).toContain('invalid-document-dependency');
    expect(value(v, 'd')).toBe(2);
    v.dispose();
  });

  test('a body that applies an undeclared function is a row error', () => {
    const revision = prepare([
      { id: 'g', latex: 'g(t)=2h(t)' },
      { id: 'c', latex: 'c=2' },
    ]);
    expect(error(revision, 'g')).toContain('provisional heads h');
    expect(value(revision, 'c')).toBe(2);
    revision.dispose();
  });

  test('a reader of an error row sees no value of an earlier revision', () => {
    const good = prepare([
      { id: 'a', latex: 'a=1' },
      { id: 'c', latex: 'c=a+1' },
    ]);
    expect(value(good, 'c')).toBe(2);
    const bad = prepare([
      { id: 'a', latex: 'a=1', valueType: 'string' },
      { id: 'c', latex: 'c=a+1' },
    ]);
    expect(error(bad, 'c')).toContain('invalid-document-dependency');
    expect(value(bad, 'c')).not.toBe(2);
    expect(value(bad, 'a')).not.toBe(1);
    expect(value(good, 'c')).toBe(2);
    bad.dispose();
    good.dispose();
  });

  test('an error row refuses a held value, also when it is writable', () => {
    const revision = prepare(
      [
        { id: 'a', latex: 'a=b_1' },
        { id: 'b', latex: 'b=a_1' },
        { id: 'v', latex: 'v=1', valueType: 'string' },
      ],
      new Set(['a', 'b', 'v'])
    );
    const held = ce.box(5);
    for (const name of ['a', 'b', 'v']) {
      expect(typeof revision.collectionWriteError(name, held)).toBe('string');
      ce.pushScope(revision.scope);
      try {
        expect(() => ce.assign(name, held)).toThrow(ConstantAssignmentError);
      } finally {
        ce.popScope();
      }
      expect(value(revision, name)).not.toBe(5);
    }
    revision.dispose();
  });

  test('a recursion with no base case is a row error', () => {
    for (const { input, failed, dependent } of [
      {
        input: [{ id: 'f', latex: 'f(x)=f(x-1)+1' }],
        failed: 'f',
        dependent: undefined,
      },
      {
        input: [
          { id: 'f', latex: 'f(x)=g(x)+1' },
          { id: 'g', latex: 'g(x)=f(x)' },
        ],
        failed: 'g',
        dependent: 'f',
      },
    ]) {
      const revision = prepare([...input, { id: 'y', latex: 'y=f(2)' }]);
      expect(error(revision, failed)).toContain(
        'Recursive definition with no base case: ' + failed
      );
      if (dependent !== undefined)
        expect(error(revision, dependent)).toContain(
          'invalid-document-dependency'
        );
      expect(error(revision, 'y')).toContain('invalid-document-dependency');
      // A call is an error value, not a recursion-limit throw.
      expect(operatorOf(value(revision, 'f(3)'))).toBe('Error');
      revision.dispose();
    }
  });

  test('a recursion with an arm that may not recurse is accepted', () => {
    for (const [latex, result] of [
      [
        'f(n)=\\begin{cases}1&n\\le0\\\\n f(n-1)&\\text{otherwise}\\end{cases}',
        6,
      ],
      // The call is under a short-circuit `And`.
      ['f(x)=x>0\\land f(x-1)', 'False'],
      // The call is under the binder of a `Sum`.
      ['f(x)=1+\\sum_{k=1}^{x-1}f(k)', 4],
      ['f(x)=x^2', 9],
    ] as const) {
      const revision = prepare([{ id: 'f', latex }]);
      expect(revision.rowErrors.size).toBe(0);
      expect(value(revision, 'f(3)')).toBe(result);
      revision.dispose();
    }
    // The only call is under `Hold`, which is not a strict operator.
    const holdSyntax: DocumentSyntax = {
      split: () => ({ head: 'f', body: '' }),
      recognize: () => ({
        role: 'function',
        head: { name: 'f', params: ['x'] },
        bodyJson: ['Hold', ['f', ['Subtract', 'x', 1]]],
      }),
      normalize: (raw) => raw,
    };
    const revision = imports.prepare([{ id: 'f', latex: 'f' }], holdSyntax);
    expect(revision.rowErrors.size).toBe(0);
    expect(operatorOf(value(revision, 'f(3)'))).toBe('Hold');
    revision.dispose();
  });
});

describe('a parameter read only as a join operand', () => {
  type Json = Parameters<DocumentSyntax['normalize']>[0];
  const joinSyntax = (bodyJson: Json): DocumentSyntax => ({
    split: () => ({ head: 'f', body: '' }),
    recognize: () => ({
      role: 'function',
      head: { name: 'f', params: ['y'] },
      bodyJson,
    }),
    normalize: (raw) => raw,
  });
  const call = (revision: { scope: InspectableScope }, arg: unknown) =>
    JSON.stringify(
      ce.expr(['f', arg as Json], { scope: revision.scope }).evaluate().json
    );
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  // A join takes a scalar operand as one element, so the parameter is any
  // value: a scalar argument is admitted, and a list argument is spliced,
  // not broadcast over.
  for (const head of ['ListJoin', 'Join']) {
    test(head + ': a scalar is one element and a list is spliced', () => {
      const environment = createDocumentEnvironment(ce, () => {});
      const imports = environment.createImports(() => {});
      for (const extra of [{}, { resultType: 'list<any>' }]) {
        const revision = imports.prepare(
          [{ id: 'f', latex: 'f', ...extra }],
          joinSyntax([head, ['List', 1, 2], 'y'])
        );
        expect(revision.rowErrors.size).toBe(0);
        expect(call(revision, 7)).toBe('["List",1,2,7]');
        expect(call(revision, ['List', 3, 4])).toBe('["List",1,2,3,4]');
        revision.dispose();
      }
      imports.dispose();
      environment.dispose();
    });
  }

  test('a spread parameter takes a scalar argument', () => {
    const environment = createDocumentEnvironment(ce, () => {});
    const imports = environment.createImports(() => {});
    const revision = imports.prepare(
      [{ id: 'f', latex: 'f' }],
      joinSyntax(['List', ['Spread', 'y'], 0])
    );
    expect(call(revision, 5)).toBe('["List",5,0]');
    expect(call(revision, ['List', 9])).toBe('["List",9,0]');
    revision.dispose();
    imports.dispose();
    environment.dispose();
  });

  test('a parameter that another operator reads keeps its inferred type', () => {
    const environment = createDocumentEnvironment(ce, () => {});
    const imports = environment.createImports(() => {});
    const revision = imports.prepare(
      [{ id: 'f', latex: 'f' }],
      joinSyntax(['ListJoin', ['List', 1, 2], 'y', ['Length', 'y']])
    );
    expect(ce.expr('f', { scope: revision.scope }).type.toString()).toBe(
      '(y: collection) -> list<any>'
    );
    expect(call(revision, 7)).toContain('incompatible-type');
    expect(call(revision, ['List', 3, 4])).toBe('["List",1,2,3,4,2]');
    revision.dispose();
    imports.dispose();
    environment.dispose();
  });
});

describe('the result of a recursive function with no stated result', () => {
  type Json = Parameters<DocumentSyntax['normalize']>[0];
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  afterAll(() => {
    imports.dispose();
    environment.dispose();
  });
  // Each row is a function definition given as the JSON of its body.
  const prepare = (defs: Record<string, [string[], Json]>) =>
    imports.prepare(
      Object.keys(defs).map((id) => ({ id, latex: id })),
      {
        split: () => ({ head: 'f', body: '' }),
        recognize: (row) => ({
          role: 'function',
          head: { name: row.id, params: defs[row.id][0] },
          bodyJson: defs[row.id][1],
        }),
        normalize: (raw) => raw,
      }
    );
  const typeOf = (revision: { scope: InspectableScope }, name: string) =>
    ce.expr(name, { scope: revision.scope }).type.toString();
  const call = (revision: { scope: InspectableScope }, expr: Json) =>
    JSON.stringify(ce.expr(expr, { scope: revision.scope }).evaluate().json);
  const step = (name: string, ...args: Json[]): Json => [
    name,
    ['Subtract', args[0], 1],
    ...args.slice(1),
  ];
  const cases = (k: string, base: Json, recursive: Json): Json => [
    'Which',
    ['LessEqual', k, 0],
    base,
    'True',
    recursive,
  ];

  test('is the join of its base arms, widened, when the body confirms it', () => {
    const revision = prepare({
      r: [
        ['n'],
        cases('n', ['Tuple', 0, 0], ['Add', step('r', 'n'), ['Tuple', 1, 1]]),
      ],
      s: [
        ['n'],
        cases('n', ['Tuple', 0, 0], ['Add', step('s', 'n'), ['Tuple', 'n', 1]]),
      ],
      C: [
        ['k', 'q'],
        cases(
          'k',
          ['Tuple', 0, 0],
          ['Add', step('C', 'k', 'q'), ['Tuple', 'q', 'q']]
        ),
      ],
      z: [['n'], cases('n', 1, ['Multiply', step('z', 'n'), 'ImaginaryUnit'])],
      f: [['n'], cases('n', 1, ['Multiply', 'n', step('f', 'n')])],
      M: [
        ['n'],
        cases('n', ['List', 0], ['Join', step('M', 'n'), ['List', 'n']]),
      ],
      e: [['n'], cases('n', 1, step('o', 'n'))],
      o: [['n'], cases('n', 0, step('e', 'n'))],
    });
    expect(revision.rowErrors.size).toBe(0);
    expect(typeOf(revision, 'r')).toBe(
      '(unknown) any -> tuple<number, number>'
    );
    expect(call(revision, ['r', 3])).toBe('["Tuple",3,3]');
    expect(typeOf(revision, 's')).toBe(
      '(unknown) any -> tuple<number, number>'
    );
    expect(call(revision, ['s', 3])).toBe('["Tuple",6,3]');
    expect(typeOf(revision, 'C')).toBe(
      '(unknown, unknown) any -> tuple<number, number>'
    );
    expect(call(revision, ['C', 2, 3])).toBe('["Tuple",6,6]');
    expect(typeOf(revision, 'z')).toBe('(unknown) any -> number');
    expect(call(revision, ['z', 3])).toBe('["Complex",0,-1]');
    expect(typeOf(revision, 'f')).toBe('(unknown) any -> number');
    expect(call(revision, ['f', 3])).toBe('6');
    expect(typeOf(revision, 'M')).toBe('(unknown) any -> list<number>');
    expect(call(revision, ['M', 2])).toBe('["List",0,1,2]');
    expect(typeOf(revision, 'e')).toBe('(unknown) any -> number');
    expect(typeOf(revision, 'o')).toBe('(unknown) any -> number');
    expect(call(revision, ['e', 3])).toBe('0');
    revision.dispose();
  });

  test('stays open when no guess is made or the body refuses it', () => {
    const revision = prepare({
      // The base arm is a parameter: the guess would be `unknown`.
      P: [
        ['k', 'q'],
        cases('k', 'q', ['Add', step('P', 'k', 'q'), ['Tuple', 1, 2]]),
      ],
      // `(0, 0) + q` with `q` unknown is not a `tuple<number, number>`.
      B: [
        ['k', 'q'],
        cases('k', ['Tuple', 0, 0], ['Add', step('B', 'k', 'q'), 'q']),
      ],
      // A list recursion keeps `list<any>`: `[]` gives the open guess
      // `list<unknown>`.
      L: [
        ['n'],
        cases('n', ['List'], ['ListJoin', step('L', 'n'), ['List', 'n']]),
      ],
    });
    expect(revision.rowErrors.size).toBe(0);
    expect(typeOf(revision, 'P')).toBe('(unknown, unknown) any -> unknown');
    expect(call(revision, ['P', 3, ['Tuple', 1, 1]])).toBe('["Tuple",4,7]');
    expect(typeOf(revision, 'B')).toBe('(unknown, unknown) any -> unknown');
    expect(call(revision, ['B', 2, ['Tuple', 1, 3]])).toBe('["Tuple",2,6]');
    expect(typeOf(revision, 'L')).toBe('(unknown) any -> list<any>');
    expect(call(revision, ['L', 3])).toBe('["List",1,2,3]');
    revision.dispose();
  });
});

describe('call-site types', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {});
  const imports = environment.createImports(() => {});
  afterAll(() => {
    imports.dispose();
    environment.dispose();
  });
  const callSiteTypes = (input: DocumentSourceRow[]) => {
    const revision = imports.prepare(input, latexSyntax(ce));
    expect(revision.rowErrors.size).toBe(0);
    const result = Object.fromEntries(
      revision.definitions.map((d) => [d.name, d.callSiteTypes])
    );
    revision.dispose();
    return result;
  };
  const d = { id: 'd', latex: 'd(p)=\\sqrt{p.x^2+p.y^2}' };
  const h = { id: 'h', latex: 'h(v)=v' };

  test('join the widened argument types of every call', () => {
    const points = [
      d,
      { id: 'A', latex: 'A=d((3,4))' },
      { id: 'B', latex: 'B=d((1,2))' },
    ];
    expect(callSiteTypes(points)).toEqual({
      d: ['tuple<real, real>'],
      A: undefined,
      B: undefined,
    });
    // A point and a list of points give their union.
    expect(
      callSiteTypes([...points, { id: 'C', latex: 'C=d([(3,4),(6,8)])' }]).d
    ).toEqual(['list<tuple<real, real>^2> | tuple<real, real>']);
    // A list keeps its length; two lengths give the type join.
    expect(callSiteTypes([h, { id: 'A', latex: 'A=h([1,2,3])' }]).h).toEqual([
      'vector<real^3>',
    ]);
    expect(
      callSiteTypes([
        h,
        { id: 'A', latex: 'A=h([1,2,3])' },
        { id: 'B', latex: 'B=h([1,2])' },
      ]).h
    ).toEqual(['vector<real^2> | vector<real^3>']);
    // A number that may be complex is a `number`.
    expect(
      callSiteTypes([
        h,
        { id: 'A', latex: 'A=h(2.5)' },
        { id: 'B', latex: 'B=h(i)' },
      ]).h
    ).toEqual(['number']);
  });

  test('is undefined with no call or with an open argument', () => {
    expect(callSiteTypes([d]).d).toEqual([undefined]);
    // `q` is inferred as `collection<any> | tuple`, which has an open part.
    expect(
      callSiteTypes([
        d,
        { id: 'g', latex: 'g(q)=d(q)' },
        { id: 'E', latex: 'E=g((1,1))' },
      ])
    ).toEqual({ d: [undefined], g: ['tuple<real, real>'], E: undefined });
  });

  test('ignore an open argument when another call has a closed one', () => {
    const rows = [
      d,
      { id: 'g', latex: 'g(q)=d(q)' },
      { id: 'E', latex: 'E=g((1,1))' },
      { id: 'A', latex: 'A=d((3,4))' },
    ];
    const entry = callSiteTypes(rows).d;
    expect(entry).toEqual(['tuple<real, real>']);
    // The entry describes the closed call only. Declared as the formal type,
    // it still accepts a call with an `unknown` argument.
    const revision = imports.prepare(
      [
        { ...d, formalTypes: { p: entry[0]! } },
        { id: 'g', latex: 'g(q)=d(q)', formalTypes: { q: 'unknown' } },
        { id: 'A', latex: 'A=d((3,4))' },
      ],
      latexSyntax(ce)
    );
    expect(revision.rowErrors.size).toBe(0);
    expect(
      ce.parse('g((3,4))', { scope: revision.scope }).evaluate().json
    ).toEqual(5);
    revision.dispose();
  });

  test('read a typed formal as shadowing the function of its name', () => {
    // The call `f(1)` in `g` calls the formal `f`, not the row `f`.
    expect(
      callSiteTypes([
        { id: 'f', latex: 'f(x)=x' },
        { id: 'A', latex: 'A=f((1,2))' },
        {
          id: 'g',
          latex: 'g(f)=f(1)',
          formalTypes: { f: '(real) -> real' },
        },
      ]).f
    ).toEqual(['tuple<real, real>']);
  });

  describe('of rows given as JSON', () => {
    type Json = Parameters<DocumentSyntax['normalize']>[0];
    const h: [string[], Json] = [['v'], 'v'];
    // A row with parameters is a function, a row without is a value.
    const jsonCallSiteTypes = (defs: Record<string, [string[], Json]>) => {
      const revision = imports.prepare(
        Object.keys(defs).map((id) => ({ id, latex: id })),
        {
          split: () => ({ head: 'f', body: '' }),
          recognize: (row) => ({
            role: defs[row.id][0].length > 0 ? 'function' : 'value',
            head: { name: row.id, params: defs[row.id][0] },
            bodyJson: defs[row.id][1],
          }),
          normalize: (raw) => raw,
        }
      );
      expect(revision.rowErrors.size).toBe(0);
      const result = revision.definitions.find(
        (d) => d.name === 'h'
      )!.callSiteTypes;
      revision.dispose();
      return result;
    };
    const point: [string[], Json] = [[], ['h', ['Tuple', 1, 2]]];

    test('are undefined when the function is read as a value', () => {
      expect(
        jsonCallSiteTypes({ h, k: [['u'], 'u'], A: point, B: [[], ['k', 'h']] })
      ).toEqual([undefined]);
    });

    test('read the operands of a document function named Hold', () => {
      // `Hold` is a row of the document, not the library operator: `h` is
      // read as a value.
      expect(
        jsonCallSiteTypes({
          h,
          Hold: [['y'], 'y'],
          A: point,
          B: [[], ['Hold', 'h']],
        })
      ).toEqual([undefined]);
    });

    test('skip the operands of Hold', () => {
      expect(
        jsonCallSiteTypes({ h, A: point, B: [[], ['Hold', ['h', 'x']]] })
      ).toEqual(['tuple<real, real>']);
    });

    test('join the arms of a union that widen to the same type', () => {
      // `(1.5, 2, 0)` and `(1, 2.5, 3)` have different literal types that
      // both widen to `tuple<real, real, real>`.
      expect(
        jsonCallSiteTypes({
          h,
          A: [[], ['h', ['List', ['Tuple', 1.5, 2, 0], ['Tuple', 1, 2.5, 3]]]],
        })
      ).toEqual(['list<tuple<real, real, real>^2>']);
    });

    test('read the values of a dictionary', () => {
      expect(
        jsonCallSiteTypes({
          h,
          A: [[], ['Dictionary', ['KeyValuePair', "'k'", ['h', 1]]]],
        })
      ).toEqual(['real']);
    });

    test('are undefined for a record with an open field named name', () => {
      const record = (value: Json): [string[], Json] => [
        [],
        ['h', ['Dictionary', ['KeyValuePair', "'name'", value]]],
      ];
      expect(jsonCallSiteTypes({ h, A: record('x') })).toEqual([undefined]);
      expect(jsonCallSiteTypes({ h, A: record(1) })).toEqual([
        'record{name: integer}',
      ]);
    });
  });

  test('are undefined for an argument of a transparent alias type', () => {
    // The registries are read-only while a Document is live: an engine of
    // its own declares the alias first.
    const engine = new ComputeEngine();
    engine.declareType('OpenRows', 'list<any>', { alias: true });
    const env = createDocumentEnvironment(engine, () => {});
    const imp = env.createImports(() => {});
    const bodies: Record<string, [string[], unknown]> = {
      h: [['v'], 'v'],
      g: [['q'], ['h', 'q']],
    };
    const revision = imp.prepare(
      [
        { id: 'h', latex: 'h' },
        { id: 'g', latex: 'g', formalTypes: { q: 'OpenRows' } },
      ],
      {
        split: () => ({ head: 'f', body: '' }),
        recognize: (row) => ({
          role: 'function',
          head: { name: row.id, params: bodies[row.id][0] },
          bodyJson: bodies[row.id][1] as never,
        }),
        normalize: (raw) => raw,
      }
    );
    expect(revision.rowErrors.size).toBe(0);
    expect(
      revision.definitions.find((d) => d.name === 'h')!.callSiteTypes
    ).toEqual([undefined]);
    revision.dispose();
    imp.dispose();
    env.dispose();
  });

  describe('of formula rows', () => {
    type Json = Parameters<DocumentSyntax['normalize']>[0];
    const engine = new ComputeEngine();
    const env = createDocumentEnvironment(engine, () => {});
    // The axis `t` is also an input declared `real`.
    const imp = env.createImports((input) => {
      input('s', 'real');
      input('t', 'real');
    });
    afterAll(() => {
      imp.dispose();
      env.dispose();
    });
    const defs: Record<string, [string[], Json]> = {
      g: [['v'], 'v'],
      d: [
        ['p'],
        [
          'Sqrt',
          ['Add', ['Square', ['At', 'p', 1]], ['Square', ['At', 'p', 2]]],
        ],
      ],
      // `P(k, q) = q` when `k <= 0`, else `P(k - 1, q) + (1, 1)`.
      P: [
        ['k', 'q'],
        [
          'Which',
          ['LessEqual', 'k', 0],
          'q',
          'True',
          ['Add', ['P', ['Subtract', 'k', 1], 'q'], ['Tuple', 1, 1]],
        ],
      ],
      // `H(f) = f(1)`, with `f: (real) -> real`.
      H: [['f'], ['f', 1]],
    };
    // A row whose ID is in `defs` is a function definition given as JSON,
    // and one whose ID is in `values` a value row. Any other row is a
    // formula row, parsed from its LaTeX, or given as `{ json }`.
    type Formula = string | { json: Json };
    const prepareRows = (
      formulas: Formula[],
      values: Record<string, Json> = {}
    ) => {
      const json = new Map<string, Json>();
      return imp.prepare(
        [
          ...Object.keys(defs).map((id) => ({
            id,
            latex: id,
            ...(id === 'H' ? { formalTypes: { f: '(real) -> real' } } : {}),
          })),
          ...Object.keys(values).map((id) => ({ id, latex: id })),
          ...formulas.map((formula, i) => {
            if (typeof formula === 'string')
              return { id: 'F' + i, latex: formula };
            json.set('F' + i, formula.json);
            return { id: 'F' + i, latex: '0' };
          }),
        ],
        {
          split: (source) =>
            source in defs || source in values
              ? { head: 'f', body: '' }
              : undefined,
          recognize: (row) =>
            row.id in defs
              ? {
                  role: 'function',
                  head: { name: row.id, params: defs[row.id][0] },
                  bodyJson: defs[row.id][1],
                }
              : row.id in values
                ? {
                    role: 'value',
                    head: { name: row.id, params: [] },
                    bodyJson: values[row.id],
                  }
                : undefined,
          normalize: (raw) => raw,
          lowerBody: (raw, row) => json.get(row.id) ?? raw,
          fieldAxes: new Set(['x', 't']),
        }
      );
    };
    const formulaCallSiteTypes = (
      formulas: Formula[],
      values: Record<string, Json> = {}
    ) => {
      const revision = prepareRows(formulas, values);
      expect(revision.rowErrors.size).toBe(0);
      expect(revision.definitions.map((def) => def.name)).toEqual([
        ...Object.keys(defs),
        ...Object.keys(values),
      ]);
      const result = Object.fromEntries(
        revision.definitions.map((def) => [def.name, def.callSiteTypes])
      );
      revision.dispose();
      return result;
    };

    test('give the types of the arguments of their calls', () => {
      // The recursive call gives `k - 1` and the open `q`; the plot row
      // gives the point, and its axis `t` is open.
      expect(formulaCallSiteTypes([]).P).toEqual(['number', undefined]);
      expect(formulaCallSiteTypes(['(P(t,(1,0)))']).P).toEqual([
        'number',
        'tuple<real, real>',
      ]);
      expect(
        formulaCallSiteTypes(['g(2.5)', '\\sum_{k=1}^{3} g(k)']).g
      ).toEqual(['real']);
    });

    test('read a free name as the input of that name, or as open', () => {
      // `s` is an input declared `real`; `u` is not declared.
      expect(formulaCallSiteTypes(['d((s,1))']).d).toEqual([
        'tuple<real, real>',
      ]);
      expect(formulaCallSiteTypes(['y=d((u,1))']).d).toEqual([undefined]);
    });

    test('read an argument that reads a field axis or value as open', () => {
      // `x` and `t` are field axes, and `V` a field value that reads `x`.
      // The other arguments of the row still give evidence.
      expect(formulaCallSiteTypes(['(P(x,(1,0)))']).P).toEqual([
        'number',
        'tuple<real, real>',
      ]);
      const V = { V: ['Add', 'x', 1] as Json };
      expect(formulaCallSiteTypes(['(P(V,(1,0)))'], V).P).toEqual([
        'number',
        'tuple<real, real>',
      ]);
      expect(formulaCallSiteTypes(['g(V)'], V).g).toEqual([undefined]);
      // The axis `t` is open even though an input of that name is `real`.
      expect(formulaCallSiteTypes(['g(t)', 'g(t+1)']).g).toEqual([undefined]);
      // The index of a sum named `t` is not the axis.
      expect(formulaCallSiteTypes(['\\sum_{t=1}^{3} g(t)']).g).toEqual([
        'real',
      ]);
    });

    test('read each row in a scope of its own', () => {
      // The declaration of `u` in one row does not type `u` in another.
      const declares: Formula = {
        json: ['Program', ['Declare', 'u', "'real'"], ['d', ['Tuple', 1, 2]]],
      };
      expect(formulaCallSiteTypes([declares, 'g(u)']).g).toEqual([undefined]);
    });

    test('leave the signature of a function passed as a value unchanged', () => {
      const signatures = (formulas: Formula[]) => {
        const revision = prepareRows(formulas);
        const result = ['g', 'd', 'P', 'H'].map((name) =>
          engine.expr(name, { scope: revision.scope }).type.toString()
        );
        revision.dispose();
        return result;
      };
      expect(
        signatures([
          { json: ['Map', ['List', 1, 2], 'g'] },
          { json: ['H', 'g'] },
          { json: ['H', 'd'] },
          '(P(2,(1,0)))',
        ])
      ).toEqual(signatures([]));
    });

    test('give no evidence, and no error, for an invalid row', () => {
      expect(formulaCallSiteTypes(['g(\\frac{1}{})']).g).toEqual([undefined]);
      expect(formulaCallSiteTypes(['g(\\frac{1}{})', 'g(2)']).g).toEqual([
        'real',
      ]);
    });

    test('are undefined when the row reads the function as a value', () => {
      expect(formulaCallSiteTypes(['g(2)', 'g']).g).toEqual([undefined]);
    });

    test('do not declare the free names of the row in the revision', () => {
      const revision = prepareRows(['(P(t,(1,0)))', 'd((u,1))']);
      expect([...revision.scope.bindings.keys()].sort()).toEqual([
        'H',
        'P',
        'd',
        'g',
      ]);
      revision.dispose();
    });
  });

  test('do not change the contract of the function', () => {
    const revision = imports.prepare(
      [h, { id: 'A', latex: 'A=h(2)' }],
      latexSyntax(ce)
    );
    expect(revision.definitions[0].callSiteTypes).toEqual(['real']);
    expect(
      ce.parse('h("ab")', { scope: revision.scope }).evaluate().json
    ).toEqual("'ab'");
    revision.dispose();
  });
});
