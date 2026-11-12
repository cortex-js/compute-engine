import { ComputeEngine } from '../../src/compute-engine';

// `ce.withValues(values, fn)` writes each value into the binding that is
// visible when it is called, runs `fn`, and puts back the earlier state of
// each binding when `fn` returns or throws (`withValuesFn()`,
// `src/compute-engine/engine-declarations.ts`).

describe('ce.withValues', () => {
  test('a symbol with no value reads the value inside fn only', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const expr = ce.parse('a+1');
    expect(expr.evaluate().toString()).toBe('a + 1');

    const inside = ce.withValues({ a: 3 }, () => ({
      old: expr.evaluate().re,
      fresh: ce.parse('a+1').evaluate().re,
    }));
    expect(inside).toEqual({ old: 4, fresh: 4 });

    expect(expr.evaluate().toString()).toBe('a + 1');
    expect(ce.box('a').type.toString()).toBe('real');
    expect(ce.box('a').value).toBeUndefined();
  });

  test('the body of a stored function reads the value', () => {
    // A call resolves the names of the body in the scope where the function
    // was defined, so a declaration in a new scope would not reach `a`.
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.parse('f(x) := x + a').evaluate();
    const call = ce.parse('f(2)');
    expect(ce.withValues({ a: 1 }, () => call.evaluate().re)).toBe(3);
    expect(ce.withValues({ a: 1 }, () => ce.parse('f(2)').evaluate().re)).toBe(
      3
    );
    expect(call.evaluate().toString()).toBe('a + 2');
  });

  test('the value of another symbol reads the value', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.parse('c := a + 1').evaluate();
    const expr = ce.parse('2c');
    expect(ce.withValues({ a: 1 }, () => expr.evaluate().re)).toBe(4);
    expect(expr.evaluate().toString()).toBe('2(a + 1)');
  });

  test('a cached sign does not cross the boundary of the call', () => {
    // The sign of `a + 1` is unknown outside and positive inside. Neither
    // reading may be served on the other side.
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const expr = ce.parse('a+1');
    expect(expr.isPositive).toBeUndefined();
    expect(ce.withValues({ a: 3 }, () => expr.isPositive)).toBe(true);
    expect(expr.isPositive).toBeUndefined();
  });

  test('an assigned value is replaced inside fn and comes back after it', () => {
    const ce = new ComputeEngine();
    ce.assign('b', 5);
    const expr = ce.parse('b^2');
    expect(ce.withValues({ b: 2 }, () => expr.evaluate().re)).toBe(4);
    expect(expr.evaluate().re).toBe(25);
    expect(ce.box('b').value?.re).toBe(5);
  });

  test('the value undefined gives the symbol no value inside fn', () => {
    const ce = new ComputeEngine();
    ce.assign('b', 5);
    const expr = ce.parse('b^2');
    expect(
      ce.withValues({ b: undefined }, () => expr.evaluate().toString())
    ).toBe('b^2');
    expect(expr.evaluate().re).toBe(25);
  });

  test('a name with no binding is declared, and has no value after the call', () => {
    const ce = new ComputeEngine();
    expect(
      ce.withValues({ zz: 7 }, () => ce.box(['Add', 'zz', 1]).evaluate().re)
    ).toBe(8);
    // The same state as after a use of the name with no value.
    const def = ce.lookupDefinition('zz');
    expect(def !== undefined && 'value' in def).toBe(true);
    if (def !== undefined && 'value' in def) {
      expect(def.value.value).toBeUndefined();
      expect(def.value.type.toString()).toBe('unknown');
      expect(def.value.inferredType).toBe(true);
    }
    expect(ce.box(['Add', 'zz', 1]).evaluate().isNumberLiteral).toBe(false);
  });

  test('a list value reaches a sum over its elements', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    const sum = ce.parse('\\sum_{k=1}^{3} L_k');
    expect(
      ce.withValues({ L: ce.box(['List', 1, 2, 3]) }, () => sum.evaluate().re)
    ).toBe(6);
    expect(sum.evaluate().isNumberLiteral).toBe(false);
  });

  test('N() reads the value', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const expr = ce.parse('\\sqrt{a}');
    expect(ce.withValues({ a: 4 }, () => expr.N().re)).toBe(2);
    expect(expr.N().toString()).toBe('sqrt(a)');
  });

  test('an inferred type is widened inside fn, and put back after it', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('q+1');
    const typeBefore = ce.box('q').type.toString();
    expect(ce.withValues({ q: 2.5 }, () => expr.evaluate().re)).toBe(3.5);
    expect(ce.box('q').type.toString()).toBe(typeBefore);
  });

  test('a value that the declared type does not admit throws and changes nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    const expr = ce.parse('a+b');
    expect(() =>
      ce.withValues({ a: 2, b: ce.box(['List', 1, 2]) }, () => expr.evaluate())
    ).toThrow(/not compatible with the type "real"/);
    expect(ce.box('a').value).toBeUndefined();
    expect(ce.box('a').type.toString()).toBe('real');
    expect(expr.evaluate().toString()).toBe('a + b');
  });

  test('a constant, a function definition and a function value throw before any write', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('k', { type: 'real', value: 2, isConstant: true });
    ce.declare('g', { evaluate: ([x]) => x });
    const expr = ce.parse('a+1');
    expect(() => ce.withValues({ a: 2, k: 3 }, () => 0)).toThrow();
    expect(() => ce.withValues({ a: 2, g: 3 }, () => 0)).toThrow(
      /function definition/
    );
    expect(() =>
      ce.withValues({ a: 2, h: ce.parse('x \\mapsto x^2') }, () => 0)
    ).toThrow(/is a function/);
    expect(() => ce.withValues({ a: 2, h: () => ce.One }, () => 0)).toThrow(
      /is a function/
    );
    expect(ce.box('k').value?.re).toBe(2);
    expect(expr.evaluate().toString()).toBe('a + 1');
  });

  test('a throw of fn puts back the values', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const expr = ce.parse('a+1');
    expect(() =>
      ce.withValues({ a: 2 }, () => {
        throw new Error('stop');
      })
    ).toThrow('stop');
    expect(expr.evaluate().toString()).toBe('a + 1');
  });

  test('an assignment inside fn is undone too', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.withValues({ a: 2 }, () => ce.assign('a', 5));
    expect(ce.box('a').value).toBeUndefined();
  });

  test('an inner call replaces the value of an outer call', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const expr = ce.parse('a+1');
    const result = ce.withValues({ a: 2 }, () => [
      ce.withValues({ a: 10 }, () => expr.evaluate().re),
      expr.evaluate().re,
    ]);
    expect(result).toEqual([11, 3]);
    expect(expr.evaluate().toString()).toBe('a + 1');
  });

  test('a call during an evaluation binds the value', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.parse('f(x) := x + a').evaluate();
    const call = ce.parse('f(2)');
    ce.declare('Probe', {
      signature: '() -> real',
      evaluate: (_ops, { engine }) =>
        engine.number(engine.withValues({ a: 4 }, () => call.evaluate().re)),
    });
    expect(ce.box(['Probe']).evaluate().re).toBe(6);
    expect(call.evaluate().toString()).toBe('a + 2');
  });

  test('no values runs fn', () => {
    const ce = new ComputeEngine();
    expect(ce.withValues({}, () => 42)).toBe(42);
  });

  test('a function assigned inside fn is undone', () => {
    // The assignment replaces the value definition of the binding by an
    // operator definition; the restore puts the value definition back.
    const ce = new ComputeEngine();
    ce.assign('a', 5);
    ce.withValues({ a: 2 }, () => ce.assign('a', ce.parse('x \\mapsto x+1')));
    const def = ce.lookupDefinition('a');
    expect(def !== undefined && 'value' in def).toBe(true);
    expect(ce.box('a').value?.re).toBe(5);
    expect(ce.parse('a+1').evaluate().re).toBe(6);
  });

  test('boxing a value does not change the type that is put back', () => {
    // Boxing `a + 1` can narrow the inferred type of `a`; the copy of `a` is
    // made before.
    const ce = new ComputeEngine();
    ce.symbol('a');
    const typeBefore = ce.box('a').type.toString();
    ce.withValues({ a: 2, b: ['Add', 'a', 1] }, () => 0);
    expect(ce.box('a').type.toString()).toBe(typeBefore);
  });

  test('a refused value throws before an earlier name is written', () => {
    // With a write before the refusal, `uu` would take the type `integer`
    // of `q`, and keep it.
    const ce = new ComputeEngine();
    ce.declare('q', 'integer');
    ce.declare('b', 'real');
    ce.symbol('uu');
    const typeBefore = ce.box('uu').type.toString();
    expect(() =>
      ce.withValues({ q: 'uu', b: ce.box(['List', 1, 2]) }, () => 0)
    ).toThrow();
    expect(ce.box('uu').type.toString()).toBe(typeBefore);
  });

  test('a function type that a value removes comes back after the call', () => {
    // The parser types `h` in `h(x)` as a function. A number value removes
    // the function arm of the type; the restore puts it back.
    const ce = new ComputeEngine();
    const call = ce.parse('h(x)');
    const typeBefore = ce.box('h').type.toString();
    const callTypeBefore = call.type.toString();
    ce.withValues({ h: 3 }, () => ce.box('h').type.toString());
    expect(ce.box('h').type.toString()).toBe(typeBefore);
    expect(call.type.toString()).toBe(callTypeBefore);
  });

  test('a function and then a value assigned inside fn are undone', () => {
    // The second assignment puts a new value definition on the record.
    const ce = new ComputeEngine();
    ce.assign('a', 5);
    ce.withValues({ a: 2 }, () => {
      ce.assign('a', ce.parse('x \\mapsto x+1'));
      ce.assign('a', 9);
    });
    expect(ce.box('a').value?.re).toBe(5);
    expect(ce.parse('a+1').evaluate().re).toBe(6);
  });

  test('an object of another engine throws', () => {
    // Boxing would replace the object by an error expression.
    const ce = new ComputeEngine();
    const other = new ComputeEngine();
    other.declareType('Box', { kind: 'record', elements: {} });
    const foreign = other._object('Box', {});
    ce.declare('a', 'unknown');
    expect(() => ce.withValues({ a: foreign }, () => 0)).toThrow(
      /object-foreign-engine/
    );
    expect(ce.box('a').value).toBeUndefined();
  });

  test('a name that a stored function body applies throws', () => {
    // A value would rewrite the body of `f` as the product `a·(t+1)`, and
    // the restore of `a` would not undo it.
    const ce = new ComputeEngine();
    ce.parse('f(t) := a(t+1)').evaluate();
    const before = ce.parse('f(1)').evaluate().toString();
    expect(() => ce.withValues({ a: 2 }, () => 0)).toThrow(/Declare "a"/);
    expect(ce.parse('f(1)').evaluate().toString()).toBe(before);
  });

  test('the value undefined keeps a value that an assumption gives', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.assume(ce.parse('a = 3'));
    expect(
      ce.withValues({ a: undefined }, () => ce.parse('a+1').evaluate().re)
    ).toBe(4);
  });

  // CE-1192. No public program makes a restore fail, so the tests replace
  // the internal restore of the value definition.
  function breakRestore(ce: ComputeEngine, name: string): Error {
    const def = ce.lookupDefinition(name) as unknown as {
      value: { _restoreCheckpointSnapshot: (s: unknown) => void };
    };
    const restoreError = new Error('restore failed');
    def.value._restoreCheckpointSnapshot = () => {
      throw restoreError;
    };
    return restoreError;
  }

  test('a restore failure is thrown when fn returns', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const restoreError = breakRestore(ce, 'a');
    let thrown: unknown;
    try {
      ce.withValues({ a: 3 }, () => 0);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(restoreError);
  });

  test('when fn throws and a restore fails, both errors are thrown', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    const restoreError = breakRestore(ce, 'a');
    const fnError = new Error('fn failed');
    let thrown: unknown;
    try {
      ce.withValues({ a: 3, b: 4 }, () => {
        throw fnError;
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([fnError, restoreError]);
    expect((thrown as AggregateError).cause).toBe(fnError);
    // The failure of `a` does not stop the restore of `b`.
    expect(ce.box('b').value).toBeUndefined();
  });

  test('when fn throws and every restore succeeds, its error is thrown', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const fnError = new Error('fn failed');
    let thrown: unknown;
    try {
      ce.withValues({ a: 3 }, () => {
        throw fnError;
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(fnError);
    expect(ce.box('a').value).toBeUndefined();
  });
});

describe('the snapshot of a value definition', () => {
  // `ce.withValues()` puts back the earlier state of a binding with the
  // snapshot of its value definition (`_checkpointSnapshot()`). Adding a
  // mutable field to the class requires extending the snapshot and a test.
  // This test fails when a field is added without being captured: the failure
  // names the field, so the fix is to add it to the snapshot or to the
  // exclusion list below with a reason.

  /** Not captured, each for a reason stated on `_checkpointSnapshot`. */
  const VALUE_DEF_EXCLUSIONS = new Set([
    'name', // identity
    '_engine', // identity
    '_writeVersion', // monotone counter: BUMPED by a restore, never restored
    '_unsubscribeFromConfigurationChange', // live handle owned by dispose()
    // A memo of the effective type, not state: it is keyed on the fact index
    // it was computed from and on `_writeVersion`, so a restore that moves
    // either one retires it, and a stale entry can never be served.
    '_effectiveType',
    // A memo of the signature derived from `_signatureSkeleton`, keyed on
    // the skeleton and on the stored value's type object: a restore that
    // moves either one makes it miss.
    '_signatureMemo',
    // A re-entrancy guard of `_deriveSignature`, true only during the call.
    '_derivingSignature',
    // The list hypothesis a recursive call reads while `_deriveSignature`
    // verifies it, set only during that pass.
    '_recursionResult',
    // A memo of the skeleton `_wildcardRecursiveSignature` derives a
    // signature from, keyed on the identity of the stored literal and on the
    // engine versions: a restore that changes the stored value makes it
    // miss.
    '_wildcardSkeleton',
    // A memo of the effects of a stored `Function` literal, keyed on the
    // identity of the literal and on the conformance-registry version. The
    // version is a counter that only increases, so a restore that changes
    // the stored value or the registry makes the memo miss.
    '_literalRegistryEffects',
    // A memo of the live type of the stored value, keyed on the identity of
    // the value, on the world version and on the write version of every
    // definition the value reads.
    '_liveTypeMemo',
    // The number of live evaluation contexts whose scope holds the
    // definition: it counts frames of the stack, which a restore does not
    // change, so it is not a state of the record.
    '_holders',
  ]);

  test('every mutable field of a value definition is in its snapshot', () => {
    const ce = new ComputeEngine();
    ce.assign('drift', ce.number(1));
    const def = ce.lookupDefinition('drift') as { value: any };
    const captured = new Set(
      Object.keys(def.value._checkpointSnapshot() as object)
    );
    const missing = Object.getOwnPropertyNames(def.value).filter(
      (f) => !captured.has(f) && !VALUE_DEF_EXCLUSIONS.has(f)
    );
    expect(missing).toEqual([]);
  });

  test('a value-definition snapshot round-trips every field it captures', () => {
    const ce = new ComputeEngine();
    ce.assign('rt', ce.number(1));
    const half = (ce.lookupDefinition('rt') as { value: any }).value;
    const before = half._checkpointSnapshot() as Record<string, unknown>;

    // Move a representative field on each axis the tuple covers.
    half.holdUntil = 'never';
    half.inferredType = !half.inferredType;
    half._isConstant = true;

    half._restoreCheckpointSnapshot(before);
    const after = half._checkpointSnapshot() as Record<string, unknown>;
    for (const key of Object.keys(before))
      expect([key, after[key]]).toEqual([key, before[key]]);
  });
});
