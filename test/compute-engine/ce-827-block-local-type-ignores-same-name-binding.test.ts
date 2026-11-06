/**
 * CE-827. The type of a block is read after the scope of the block was left.
 * An occurrence of a local of the block then cannot reach its own binding,
 * and the read by name found another binding of the same name, for example a
 * global. With `n := [1, 2]`, `Block(Declare(n, "real", 2), n + 1)` was typed
 * `list<real>`, and its value is `3`.
 *
 * A type computation now reads no binding for a block local when the only
 * binding of the name that it can reach is not a local of that block
 * (`isOutsideBindingOfBlockLocal()`, `boxed-expression/binders.ts`). Each
 * test compares the type with the type that the same expression has in an
 * engine with no global of that name.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

type Json = Parameters<ComputeEngine['box']>[0];

/** An engine where `name` is a global that holds the list `[1, 2]`. */
function engineWithGlobalList(name: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign(name, ce.box(['List', 1, 2]));
  return ce;
}

/** The type of `json` before a run, its value, and its type after the run. */
function typeValueType(ce: ComputeEngine, json: Json): [string, unknown, string] {
  const e = ce.box(json);
  const before = e.type.toString();
  const value = e.evaluate().json;
  return [before, value, e.type.toString()];
}

const WITNESS: Json = ['Block', ['Declare', 'n', "'real'", 2], ['Add', 'n', 1]];

describe('CE-827: THE TYPE OF A BLOCK LOCAL IGNORES A GLOBAL OF THE SAME NAME', () => {
  test('a declared local: the type is that of the local, before and after a run', () => {
    expect(typeValueType(engineWithGlobalList('n'), WITNESS)).toEqual([
      'real',
      3,
      'real',
    ]);
    // The same answer as in an engine with no global `n`.
    expect(typeValueType(new ComputeEngine(), WITNESS)).toEqual([
      'real',
      3,
      'real',
    ]);
  });

  test('a global that is assigned after the block was boxed', () => {
    const ce = new ComputeEngine();
    const e = ce.box(WITNESS);
    expect(e.type.toString()).toBe('real');
    ce.assign('n', ce.box(['List', 1, 2]));
    expect(e.type.toString()).toBe('real');
    expect(e.evaluate().json).toBe(3);
    expect(e.type.toString()).toBe('real');
  });

  test('a local that a first assignment makes', () => {
    const ce = new ComputeEngine();
    // `q` has no binding when the block is boxed, so the assignment makes a
    // local. The global `q` is made after.
    const e = ce.box(['Block', ['Assign', 'q', 2], ['Add', 'q', 1]]);
    ce.assign('q', ce.box(['List', 1, 2]));
    expect(e.type.toString()).toBe('integer');
    expect(e.evaluate().json).toBe(3);
    expect(e.type.toString()).toBe('integer');
    // The run wrote the local, not the global.
    expect(ce.box('q').evaluate().json).toEqual(['List', 1, 2]);
  });

  test('a read of the local from a nested block', () => {
    const json: Json = [
      'Block',
      ['Declare', 'n', "'real'", 2],
      ['Block', ['Add', 'n', 1]],
    ];
    expect(typeValueType(engineWithGlobalList('n'), json)).toEqual([
      'real',
      3,
      'real',
    ]);
  });

  test('a read of the local from a branch of a conditional', () => {
    const json: Json = [
      'Block',
      ['Declare', 'n', "'real'", 2],
      ['If', ['Greater', 'n', 1], ['Add', 'n', 1], 0],
    ];
    const withGlobal = typeValueType(engineWithGlobalList('n'), json);
    expect(withGlobal).toEqual(typeValueType(new ComputeEngine(), json));
    expect(withGlobal[1]).toBe(3);
    // Before the fix: `integer | list<real>`.
    expect(withGlobal[0]).not.toContain('list');
  });

  test('a nested block that declares the same name reads its own local', () => {
    const json: Json = [
      'Block',
      ['Declare', 'n', "'real'", 2],
      [
        'Block',
        ['Declare', 'n', "'list<real>'", ['List', 5, 6]],
        ['Add', 'n', 1],
      ],
    ];
    expect(typeValueType(engineWithGlobalList('n'), json)).toEqual([
      'list<real>',
      ['List', 6, 7],
      'list<real>',
    ]);
  });

  test('a block in the body of a big operator', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Sum',
      ['Block', ['Declare', 'm', "'real'", 'k'], ['Multiply', 'm', 2]],
      ['Limits', 'k', 1, 3],
    ]);
    ce.assign('m', ce.box(['List', 1, 2]));
    expect(e.type.toString()).toBe('real');
    expect(e.evaluate().json).toBe(12);
    expect(e.type.toString()).toBe('real');
  });

  test('a local of the body of a function literal', () => {
    const types = (ce: ComputeEngine): string[] => {
      const f = ce.box([
        'Function',
        ['Block', ['Declare', 'n', "'real'", 2], ['Add', 'n', 'x']],
        'x',
      ]);
      ce.assign('f', f);
      const call = ce.box(['f', 3]);
      const before = [f.type.toString(), call.type.toString()];
      expect(call.evaluate().json).toBe(5);
      return [...before, f.type.toString(), call.type.toString()];
    };
    const withGlobal = types(engineWithGlobalList('n'));
    expect(withGlobal).toEqual(types(new ComputeEngine()));
    // Before the fix: `(x: unknown) -> list<number>`.
    expect(withGlobal[0]).toBe('(x: unknown) -> number');
  });

  test('the Epsil form: a `let` local of a function', () => {
    const types = (ce: ComputeEngine): string[] => {
      executeEpsil(ce, 'function f() { let n: real = 2; n + 1 }');
      const before = [ce.box('f').type.toString(), ce.box(['f']).type.toString()];
      expect(executeEpsil(ce, 'f()').value?.json).toBe(3);
      return [
        ...before,
        ce.box('f').type.toString(),
        ce.box(['f']).type.toString(),
      ];
    };
    const withGlobal = types(engineWithGlobalList('n'));
    expect(withGlobal).toEqual(types(new ComputeEngine()));
    // Before the fix: `() -> list<real>`.
    expect(withGlobal[0]).toBe('() -> real');
  });

  test('a function literal that a block returns, called after the run', () => {
    const run = (ce: ComputeEngine): unknown[] => {
      const e = ce.box([
        'Block',
        ['Declare', 'n', "'real'", 2],
        ['Function', ['Add', 'n', 'x'], 'x'],
      ]);
      const before = e.type.toString();
      const closure = e.evaluate();
      ce.assign('g', closure);
      const call = ce.box(['g', 1]);
      return [
        before,
        closure.type.toString(),
        call.type.toString(),
        call.evaluate().json,
        call.type.toString(),
      ];
    };
    const withGlobal = run(engineWithGlobalList('n'));
    expect(withGlobal).toEqual(run(new ComputeEngine()));
    // Before the fix: `(x: unknown) -> list<number>`, and `list<real>` for
    // the call, whose value is `3`.
    expect(withGlobal).toEqual([
      '(x: unknown) -> number',
      '(x: unknown) -> number',
      'number',
      3,
      'number',
    ]);
  });

  test('the other binding is a shield of the name (`HoldValues`)', () => {
    // `HoldValues(y + 1, y)` hides the value of `y` with a binding of its
    // own, which is not the local of the block either.
    const json: Json = [
      'Block',
      ['Declare', 'y', "'real'", 3],
      ['HoldValues', ['Add', 'y', 1], 'y'],
    ];
    const withGlobal = typeValueType(engineWithGlobalList('y'), json);
    expect(withGlobal).toEqual(typeValueType(new ComputeEngine(), json));
    // Before the fix: `list<real>`.
    expect(withGlobal).toEqual(['real', ['Add', 'y', 1], 'real']);
  });

  test('the local is the upper bound of a sum', () => {
    const json: Json = [
      'Block',
      ['Declare', 'y', "'integer'", 3],
      ['Sum', ['Multiply', 'y', 'k'], ['Limits', 'k', 1, 'y']],
    ];
    // Before the fix: `list<integer>`.
    expect(typeValueType(engineWithGlobalList('y'), json)).toEqual([
      'integer',
      18,
      'integer',
    ]);
  });

  test('the global keeps its value and its type', () => {
    const ce = engineWithGlobalList('n');
    const e = ce.box(WITNESS);
    expect(e.evaluate().json).toBe(3);
    const n = ce.box('n');
    expect(n.evaluate().json).toEqual(['List', 1, 2]);
    expect(ce.box(['Add', 'n', 1]).evaluate().json).toEqual(['List', 2, 3]);
    expect(ce.box(['Add', 'n', 1]).type.toString()).toBe('vector<integer^2>');
  });
});
