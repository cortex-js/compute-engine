import { ComputeEngine } from '../../src/compute-engine';
import { parseSource } from '../../src/cli/check';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { checkEpsil } from '../../src/epsil/check-epsil';
import { asComputation } from '../../src/common/computation-depth';
import { _provisionalDependentCount } from '../../src/compute-engine/boxed-expression/provisional-application';

//
// The Epsil static check leaves the engine as it found it. The engine below
// already holds definitions that the checked programs redefine, narrow,
// extend with a clause or depend on: the check writes on them while it runs
// (later statements read what earlier ones wrote) and puts them back when it
// ends, with the registry of definitions to re-derive. The same program run
// for real afterwards gives what it gives on an engine that was never
// checked.
//

/** An engine that holds the definitions the programs below touch. */
function engineWithDefinitions(): ComputeEngine {
  const ce = new ComputeEngine();
  executeEpsil(ce, 'function h(x: integer) -> integer { x }');
  executeEpsil(ce, 'function k(x: string) -> string { x }');
  executeEpsil(ce, 'function f(x) { x + 1 }');
  executeEpsil(ce, 'function proc(cs) { clean(cs) + 1 }');
  ce.box('u');
  return ce;
}

const NAMES = ['h', 'k', 'f', 'proc', 'u', 'x', 'clean'];

/** What a check could change about a name: its binding record and halves
 * by identity, their types, effects and provenance histories. */
function stateOf(ce: ComputeEngine): unknown[] {
  return NAMES.map((name) => {
    const def = ce.lookupDefinition(name) as
      | {
          value?: {
            type: { toString(): string };
            _typeProvenance?: { type: { toString(): string } }[];
          };
          operator?: {
            signature: { toString(): string };
            effects: unknown;
            _typeProvenance?: { type: { toString(): string } }[];
          };
        }
      | undefined;
    const value = def?.value;
    const operator = def?.operator;
    return {
      name,
      def,
      value,
      operator,
      type: value?.type.toString(),
      signature: operator?.signature.toString(),
      effects: JSON.stringify(operator?.effects),
      history: [
        ...(value?._typeProvenance ?? []),
        ...(operator?._typeProvenance ?? []),
      ].map((e) => e.type.toString()),
      waitingOnName: _provisionalDependentCount(ce, name),
    };
  });
}

function check(ce: ComputeEngine, source: string) {
  const { ast } = parseSource(source, undefined, ce);
  return staticDiagnostics(ce, ast!, source);
}

describe('THE STATIC CHECK LEAVES THE ENGINE AS IT FOUND IT', () => {
  test.each([
    ['a clause added to a host function', 'function h(0) { 100 }\nh(0) + h(3)'],
    [
      'a redefinition with another signature',
      'function k(x: integer) -> integer { x }\nk(3)',
    ],
    ['a redefinition of a function', 'function f(x) { 2 * x }\nf(2)'],
    [
      'a definition that an outer function waits on',
      'function clean(v: list<number>) { v[1] }\nproc([10, 20])',
    ],
    ['a narrowing of an outer symbol', 'let z = u + 1\nz'],
  ])('%s', (_, source) => {
    const ce = engineWithDefinitions();
    const before = stateOf(ce);
    check(ce, source);
    const after = stateOf(ce);
    expect(after).toEqual(before);
    after.forEach((entry, i) => {
      const was = before[i] as Record<string, unknown>;
      const is = entry as Record<string, unknown>;
      expect(is.def).toBe(was.def);
      expect(is.value).toBe(was.value);
      expect(is.operator).toBe(was.operator);
    });

    // The program run for real after the check gives what it gives on an
    // engine that was never checked.
    const twin = engineWithDefinitions();
    expect(executeEpsil(ce, source).value.toString()).toBe(
      executeEpsil(twin, source).value.toString()
    );
  });
});

// A write that the text of the program does not name: each writer records
// the definition before its first write.
describe('THE CHECK PUTS BACK A DEFINITION THAT THE PROGRAM DOES NOT NAME', () => {
  function halves(ce: ComputeEngine, name: string) {
    const def = ce.lookupDefinition(name) as
      { value?: object; operator?: object } | undefined;
    return [def, def?.value, def?.operator];
  }

  test('a macro that redefines a host function', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function f(x) { x + 1 }');
    ce.declare('M', {
      macro: ['DefineFunction', 'f', ['Function', ['Multiply', 2, 'x'], 'x']],
    });
    const before = halves(ce, 'f');
    checkEpsil(ce, 'M');
    expect(halves(ce, 'f')).toEqual(before);
    halves(ce, 'f').forEach((h, i) => expect(h).toBe(before[i]));
    expect(executeEpsil(ce, 'f(2)').value.toString()).toBe('3');
  });

  test('a repair that rebuilds a host function', () => {
    const ce = new ComputeEngine();
    ce.declare('v', { type: 'number', inferred: true });
    ce.parse('h \\coloneq () \\mapsto g(v)').evaluate();
    const before = [halves(ce, 'v'), halves(ce, 'h')];
    const types = [ce.box('v').type.toString(), ce.box('h').type.toString()];
    checkEpsil(ce, 'function g(a: integer) { a }');
    expect([halves(ce, 'v'), halves(ce, 'h')]).toEqual(before);
    expect([ce.box('v').type.toString(), ce.box('h').type.toString()]).toEqual(
      types
    );
  });

  test('a name that canonicalization makes', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function f_1(x) { x + 1 }');
    const before = halves(ce, 'f_1');
    staticDiagnostics(
      ce,
      [
        'Block',
        [
          'DefineFunction',
          ['Subscript', 'f', 1],
          ['Function', ['Multiply', 2, 'x'], 'x'],
        ],
      ],
      ''
    );
    halves(ce, 'f_1').forEach((h, i) => expect(h).toBe(before[i]));
    expect(ce.box(['f_1', 2]).evaluate().toString()).toBe('3');
  });

  test('a use of an outer symbol as a bound', () => {
    // The record of the uses of `u` that map over a collection
    // (`SCALAR_USES_MAP`, `boxed-symbol.ts`) is put back with `u`.
    const program = 'function q() { u + 1 }\nfunction r() { u[1] }\nr()';
    const ce = new ComputeEngine();
    ce.declare('u', 'unknown');
    checkEpsil(ce, 'Range(u)');
    const fresh = new ComputeEngine();
    fresh.declare('u', 'unknown');
    expect(checkEpsil(ce, program).diagnostics).toEqual(
      checkEpsil(fresh, program).diagnostics
    );
    expect(ce.box('u').type.toString()).toBe(fresh.box('u').type.toString());
  });

  test('a narrowing during the check inside a computation is undone at once', () => {
    // `x` is `number`. A handler that the check runs narrows it to
    // `integer` and types `x + 1` while the narrowing is in force. The
    // restore at the end of the check puts `number` back and sends a
    // widening event, so the type cached during the check is computed again,
    // even inside a computation, where a narrowing alone waits for its end.
    const ce = new ComputeEngine();
    ce.declare('x', { type: 'number', inferred: true });
    const sum = ce.box(['Add', 'x', 1]);
    let inside = '';
    ce.declare('Narrow', {
      signature: '(any) -> any',
      canonical: () => {
        const def = ce.lookupDefinition('x') as {
          value: { _setType(t: () => unknown): void };
        };
        def.value._setType(() => ce.type('integer'));
        ce._noteStateEvent({ kind: 'inference', valueType: true });
        inside = sum.type.toString();
        return ce.number(1);
      },
    });
    const after = asComputation(() => {
      staticDiagnostics(ce, ['Block', ['Narrow', 1]], '');
      return sum.type.toString();
    });
    expect({ inside, after, x: ce.box('x').type.toString() }).toEqual({
      inside: 'integer',
      after: 'number',
      x: 'number',
    });
  });
});

describe('THE RESTORE POINT OF A CHECK BELONGS TO ITS ENGINE', () => {
  test('a declaration on another engine during a check stays', () => {
    const a = new ComputeEngine();
    const b = new ComputeEngine();
    a.declare('OnB', {
      signature: '(any) -> any',
      canonical: () => {
        b.declare('w', 'integer');
        return a.number(1);
      },
    });
    staticDiagnostics(a, ['Block', ['OnB', 1]], '');
    expect(b.lookupDefinition('w')).toBeDefined();
  });

  test('a write on the engine of a check during a nested check on another engine is put back', () => {
    const a = new ComputeEngine();
    const b = new ComputeEngine();
    a.declare('x', { type: 'number', inferred: true });
    b.declare('NarrowA', {
      signature: '(any) -> any',
      canonical: () => {
        const def = a.lookupDefinition('x') as {
          value: { _setType(t: () => unknown): void };
        };
        def.value._setType(() => a.type('integer'));
        return b.number(1);
      },
    });
    a.declare('CheckB', {
      signature: '(any) -> any',
      canonical: () => {
        staticDiagnostics(b, ['Block', ['NarrowA', 1]], '');
        return a.number(1);
      },
    });
    staticDiagnostics(a, ['Block', ['CheckB', 1]], '');
    expect(a.box('x').type.toString()).toBe('number');
  });

  test('a conformance that a dispatcher of the engine reads is put back', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'protocol Speaker {\n  function speak(self: Self) -> string\n}\nfunction probe() { speak(1) }'
    );
    const fields = () => {
      const speak = (ce.lookupDefinition('speak') as any)?.operator;
      const probe = (ce.lookupDefinition('probe') as any)?.operator;
      return [speak, probe].map((op) => [
        JSON.stringify(op?.effects),
        op?.readsRandomFrame,
        op?.signature.toString(),
      ]);
    };
    const before = fields();
    checkEpsil(
      ce,
      'type number is Speaker {\n  function speak(self: Self) -> string { Random() }\n}\nprobe()'
    );
    expect(fields()).toEqual(before);
  });
});

describe('THE CHECK PUTS BACK THE HOLDER COUNTS OF THE FRAMES', () => {
  // The first of two halves that the check declares in one outer entry.
  let firstY: object | undefined;
  function counts(ce: ComputeEngine) {
    return (ce as any)._evalContextStack.map((frame: any) =>
      [...(frame._countedDefs ?? [])].map((d: any) => [
        d.name,
        d._holders,
        d.disposed,
      ])
    );
  }
  function counted(ce: ComputeEngine): unknown[] {
    return (ce as any)._evalContextStack.flatMap((frame: any) => [
      ...(frame._countedDefs ?? []),
    ]);
  }

  test.each([
    [
      'an assignment to an outer function, then an undeclare in its scope',
      (ce: ComputeEngine, scope: unknown) => {
        ce.assign('f', 5);
        (ce as any)._inScope(scope, () => ce.undeclare('f'));
      },
    ],
    [
      'an assignment to an outer function, then a declaration in its scope',
      (ce: ComputeEngine, scope: unknown) => {
        ce.assign('f', 5);
        ce.declare('f', 'integer', scope as never);
      },
    ],
    [
      'two declarations in an outer scope',
      (ce: ComputeEngine, scope: unknown) => {
        ce.declare('y', { constant: true, value: 1 }, scope as never);
        firstY = (ce.lookupDefinition('y') as { value: object }).value;
        ce.declare('y', { constant: true, value: 2 }, scope as never);
      },
    ],
  ])('%s', (_, write) => {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(number) -> number', evaluate: ([x]) => x });
    const scope = ce.context.lexicalScope;
    const before = counts(ce);
    const defs = counted(ce);
    const binding = ce.lookupDefinition('f');
    ce.declare('Write', {
      signature: '(any) -> any',
      canonical: () => {
        write(ce, scope);
        return ce.number(1);
      },
    });
    staticDiagnostics(ce, ['Block', ['Write', 1]], '');
    expect(counts(ce)).toEqual(before);
    counted(ce).forEach((d, i) => expect(d === defs[i]).toBe(true));
    expect(ce.lookupDefinition('f')).toBe(binding);
    expect(ce.lookupDefinition('y')).toBeUndefined();
    // A half that the check declared in an outer scope is disposed.
    if (firstY !== undefined)
      expect((firstY as { disposed: boolean }).disposed).toBe(true);
  });
});
