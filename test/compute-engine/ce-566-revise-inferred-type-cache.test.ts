import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { noteReentrantSignatureRead } from '../../src/compute-engine/boxed-expression/declared-parameter-result';

// CE-566. A symbol whose type was inferred from its assigned value, and whose
// value is an expression that reads other symbols (`C_0 := Sum(…)` over `C`
// and `U`), has its type revised at each read against the current type of
// that value (`_reviseInferredType`, `boxed-value-definition.ts`). That type
// read is memoized on the bindings the value reads (the dependency snapshot
// of `collection-element-memo.ts`) instead of on the `any` cache axis, which
// each call of a function literal advances. The tests below check that the
// memo follows every change of what the value reads, that it is served
// across function calls, and that it is not served inside a call frame whose
// parameter has the name of a variable bound inside the value.

type ValueDef = {
  declaredType: { toString(): string };
  storedValue: Expression | undefined;
};

function valueDef(ce: ComputeEngine, name: string): ValueDef {
  const def = ce.lookupDefinition(name) as unknown as
    | { value: ValueDef }
    | undefined;
  if (def === undefined || !('value' in def))
    throw new Error(`no value definition for ${name}`);
  return def.value;
}

function chainEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('L', ce.box(['List', 3, 1, 3, 2]));
  ce.assign('C', ce.box(['Map', ['Function', ['Add', 'k', 1], 'k'], 'L']));
  ce.assign('U', ce.box(['Unique', 'C']));
  ce.assign(
    'C_0',
    ce.box([
      'Sum',
      ['If', ['Equal', 'C', ['At', 'U', 'i']], 'i', 0],
      ['Limits', 'i', 1, ['Length', 'U']],
    ])
  );
  ce.assign('X', ce.box(['Function', ['At', 'C_0', 'l'], 'l']));
  return ce;
}

describe('CE-566: the revised type of a symbol follows its dependencies', () => {
  test('a change of L to a list of another length and element type', () => {
    const ce = chainEngine();
    expect(ce.box('C_0').type.toString()).toBe('vector<integer^4>');
    expect(ce.box('C_0').evaluate().toString()).toBe('[1,2,1,3]');
    expect(ce.box(['X', 4]).evaluate().toString()).toBe('3');

    ce.assign('L', ce.box(['List', 0.5, 2.5]));
    expect(valueDef(ce, 'C_0').declaredType.toString()).toBe(
      'vector<integer^2>'
    );
    expect(ce.box('C_0').type.toString()).toBe('vector<integer^2>');
    expect(ce.box('C_0').evaluate().toString()).toBe('[1,2]');
    expect(ce.box(['X', 2]).evaluate().toString()).toBe('2');

    ce.assign('L', ce.box(['List', 3, 1, 3, 2]));
    expect(ce.box('C_0').type.toString()).toBe('vector<integer^4>');
    expect(ce.box(['X', 4]).evaluate().toString()).toBe('3');
  });

  test('a change of C to a value that is not a collection, and back', () => {
    const ce = chainEngine();
    expect(ce.box('C_0').type.toString()).toBe('vector<integer^4>');
    ce.assign('C', 5);
    expect(ce.box('C_0').type.toString()).toBe('list<any> | number');
    ce.assign('C', ce.box(['List', 7, 8, 7]));
    expect(ce.box('C_0').type.toString()).toBe('vector<integer^3>');
    expect(ce.box('C_0').evaluate().toString()).toBe('[1,2,1]');
    expect(ce.box(['X', 3]).evaluate().toString()).toBe('1');
  });

  test('the type of the call X(1) and its value follow a change of L', () => {
    const ce = chainEngine();
    const call = ce.box(['X', 1]);
    expect(call.evaluate().toString()).toBe('1');
    ce.assign('L', ce.box(['List', 9, 9]));
    expect(ce.box('C_0').type.toString()).toBe('vector<integer^2>');
    expect(ce.box(['X', 1]).evaluate().toString()).toBe('1');
    expect(ce.box(['X', 2]).evaluate().toString()).toBe('1');
  });

  test('a call of a function literal does not make the type read again', () => {
    const ce = chainEngine();
    const def = valueDef(ce, 'C_0');
    const value = def.storedValue!;
    expect(def.declaredType.toString()).toBe('vector<integer^4>');
    ce.box(['X', 1]).evaluate();

    // Count the reads of the type of the stored value: the memo answers the
    // revision without one. The getter is on the prototype, so an own
    // property of this one expression counts its reads only.
    const proto = Object.getPrototypeOf(value) as object;
    const getter = Object.getOwnPropertyDescriptor(
      proto,
      'type'
    )?.get?.bind(value);
    let reads = 0;
    Object.defineProperty(value, 'type', {
      configurable: true,
      get: () => {
        reads += 1;
        return getter!();
      },
    });
    try {
      ce.box(['X', 2]).evaluate();
      ce.box(['X', 3]).evaluate();
      reads = 0;
      expect(def.declaredType.toString()).toBe('vector<integer^4>');
      expect(reads).toBe(0);
      // A change of a dependency makes it read again.
      ce.assign('L', ce.box(['List', 1, 2]));
      reads = 0;
      expect(def.declaredType.toString()).toBe('vector<integer^2>');
      expect(reads).toBeGreaterThan(0);
    } finally {
      delete (value as unknown as { type?: unknown }).type;
    }
  });
});

describe('CE-566: a variable bound inside the value read by name', () => {
  // The type of `Map(x ↦ √x, [1, 2])` reads the sign of the body's `x` by
  // name through the current scope chain. Inside a call frame of a function
  // whose parameter is also `x`, that read finds the parameter's value. The
  // memo must give the same type as a fresh read, inside the frame and after
  // it.
  test('inside and after a call frame with a parameter of the same name', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'M',
      ce.box(['Map', ['Function', ['Sqrt', 'x'], 'x'], ['List', 1, 2]])
    );
    // The memoized read (`_liveValueType`, the read that the revision of
    // the inferred type makes) against a fresh read of the value's type.
    const def = valueDef(ce, 'M') as ValueDef & {
      _liveValueType(v: Expression): { toString(): string };
    };
    const pairs: [string, string][] = [];
    const record = () =>
      pairs.push([
        def._liveValueType(def.storedValue!).toString(),
        def.storedValue!.type.toString(),
      ]);
    ce.declare('probe', {
      signature: '(any) -> any',
      evaluate: (ops) => {
        record();
        return ops[0];
      },
    });
    ce.assign('f', ce.box(['Function', ['probe', 'x'], 'x']));

    record();
    ce.box(['f', 1]).evaluate();
    record();
    ce.box(['f', -1]).evaluate();
    record();
    ce.box(['f', 2]).evaluate();
    record();

    expect(pairs.length).toBe(7);
    for (const [memo, fresh] of pairs) expect(memo).toBe(fresh);
  });
});

describe('CE-566: the memo follows writes that move no other key', () => {
  type LiveDef = ValueDef & {
    _liveValueType(v: Expression): { toString(): string };
    _liveTypeMemo: unknown;
  };

  // A write of an operator's signature (the public `signature` setter)
  // advances the write version of the operator definition and the `any`
  // axis only. The memo records each applied operator with its write
  // version.
  test('a write of the signature of an applied operator', () => {
    const ce = new ComputeEngine();
    ce.declare('h', { signature: '(real) -> real' });
    ce.assign('a', ce.expr(['h', 'x']));
    const def = valueDef(ce, 'a') as LiveDef;
    const v = def.storedValue!;
    expect(def._liveValueType(v).toString()).toBe('real');
    const op = (
      ce.lookupDefinition('h') as unknown as {
        operator: { signature: unknown };
      }
    ).operator;
    op.signature = ce.type('(real) -> string');
    expect(v.type.toString()).toBe('string');
    expect(def._liveValueType(v).toString()).toBe('string');
    expect(ce.expr('a').type.toString()).toBe('string');
  });

  // A type read reads the definition of a variable bound inside the value
  // (the parameter of a function literal): a write of its type changes the
  // type of the value. The memo records the write version of that
  // definition.
  test('a write of the type of a variable bound inside the value', () => {
    const ce = new ComputeEngine();
    ce.assign('M', ce.expr(['Map', ['Function', 'x', 'x'], ['List', 1, 2]]));
    const def = valueDef(ce, 'M') as LiveDef;
    const v = def.storedValue!;
    expect(def._liveValueType(v).toString()).toBe('vector<integer^2>');
    // The definition that the occurrence of `x` in the body is bound to.
    const find = (e: Expression): Expression | undefined => {
      if (e.symbol === 'x' && e.valueDefinition !== undefined) return e;
      for (const op of e.ops ?? []) {
        const found = find(op);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const literal = v.ops!.find((op) => op.operator === 'Function')!;
    const x = find(literal.ops![0])!;
    (x.valueDefinition as unknown as { type: string }).type = 'boolean';
    expect(v.type.toString()).toBe('list<boolean^2>');
    expect(def._liveValueType(v).toString()).toBe('list<boolean^2>');
  });

  // While an inference rollback frame is open, a result is not stored: the
  // rollback restores types by writes that advance no key of the memo.
  test('no entry is stored while a rollback frame is open', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.expr(['Add', 'x', 1]));
    const def = valueDef(ce, 'a') as LiveDef;
    const v = def.storedValue!;
    const frames = (ce as unknown as { _rollbackFrames: unknown[] })
      ._rollbackFrames;
    def._liveTypeMemo = undefined;
    frames.push({});
    try {
      def._liveValueType(v);
      expect(def._liveTypeMemo).toBeUndefined();
    } finally {
      frames.pop();
    }
    def._liveValueType(v);
    expect(def._liveTypeMemo).toBeDefined();
  });

  // A computation that read a provisional signature (a re-entrant read of
  // the signature of a function whose derivation runs) is not stored.
  test('no entry is stored after a re-entrant signature read', () => {
    const ce = new ComputeEngine();
    ce.declare('g', {
      signature: '(any) -> real',
      type: () => {
        noteReentrantSignatureRead({});
        return 'real';
      },
    });
    ce.assign('a', ce.expr(['g', 'x']));
    const def = valueDef(ce, 'a') as LiveDef;
    const v = def.storedValue!;
    def._liveTypeMemo = undefined;
    expect(def._liveValueType(v).toString()).toBe('real');
    expect(def._liveTypeMemo).toBeUndefined();
  });
});
