import {
  ComputeEngine,
  createDocumentEnvironment,
  type DeclareDocumentInput,
  type DocumentSyntax,
  type InspectableScope,
} from '../../src/compute-engine';
import { ConstantAssignmentError } from '../../src/compute-engine/constant-assignment-error';

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
  expect(() =>
    imports.prepare(
      [{ id: 'f', latex: 'f', effects: 'pure' }],
      fnSyntax(['Add', 'x', ['Random']])
    )
  ).toThrow('does not match');
  expect(() =>
    imports.prepare(
      [{ id: 'f', latex: 'f', resultType: 'list<number>' }],
      fnSyntax(['Add', 'x', 1])
    )
  ).toThrow('does not match');
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
    expect(() =>
      imports.prepare(
        [{ id: 'f', latex: 'f', resultType: 'list<real>', formalTypes }],
        sqrtSyntax
      )
    ).toThrow('does not match');
  }
  // A fully annotated row still refuses effects beyond the stated ones.
  expect(() =>
    imports.prepare(
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
      }
    )
  ).toThrow('does not match');
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
  expect(() =>
    imports.prepare(
      [{ id: 'v', latex: 'v=', valueType: 'list<number>' }],
      fieldSyntax
    )
  ).toThrow('v: initializer does not match list<number>');
  const ok = imports.prepare(
    [{ id: 'v', latex: 'v=', valueType: 'real' }],
    fieldSyntax
  );
  expect(ok.definitions[0].fieldParameters).toEqual(['x']);
  ok.dispose();
  imports.dispose();
  environment.dispose();
});
