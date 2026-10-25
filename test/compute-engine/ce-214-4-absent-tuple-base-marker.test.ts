/**
 * ROADMAP CE-214.4: the marker of an element read whose base is absent.
 *
 * With `tup := t ↦ (t, 2t)` (typed `(unknown) -> tuple<number, number>`),
 * `x: any` and `x = []`, `tup(x)` is an empty list, its first element
 * `At(tup(x), 1)` is absent, and the interpreter answers `NaN` for
 * `At(At(tup(x), 1), 2)`: it types the read from the values, as `number`
 * (slot 2 of `tuple<number, number>`). The compiled code answered `Missing`
 * (`undefined`), because the static type of the base, built from `x: any`,
 * also has a `list<any>` arm. The user decided on 2026-10-25 (option (c))
 * that the interpreter is unchanged and that the compiled code takes the
 * marker from the slots of the tuples in the static type of the base.
 *
 * The same rule applies to a base typed by one tuple
 * (`b: list<tuple<number, string>>`, `At(At(b, 1), 1)`), and a slot typed
 * `unknown` is no longer read as a number: the join of the slots of
 * `tuple<unknown, number>` is `number`, and the compiled read of slot 1 gave
 * `NaN` where the interpreter gives `Missing`.
 *
 * Each case compares the compiled run (no fallback) with `.evaluate()`.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { TEST_PYTHON } from './test-python';

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

const TUP: unknown = ['Function', ['Tuple', 't', ['Multiply', 2, 't']], 't'];

/** The interpreter's value as the compiled code spells it: `NaN`, `undefined`
 * for `Missing`, a number, a string, or an array. */
function interpreted(ce: ComputeEngine, json: unknown): unknown {
  const v = ce.box(json as never).evaluate().json;
  const convert = (x: unknown): unknown => {
    if (x === 'Missing') return undefined;
    if (x === 'NaN') return NaN;
    if (Array.isArray(x) && (x[0] === 'List' || x[0] === 'Tuple'))
      return x.slice(1).map(convert);
    // A string is spelled `'r'` in MathJSON.
    if (typeof x === 'string' && /^'.*'$/.test(x)) return x.slice(1, -1);
    if (typeof x === 'object' && x !== null && 'str' in x)
      return (x as { str: string }).str;
    return x;
  };
  return convert(v);
}

function compiled(ce: ComputeEngine, json: unknown, vars: object): unknown {
  const r = compile(ce.box(json as never), {
    to: 'javascript',
    fallback: false,
  } as never);
  expect(r.success).toBe(true);
  return r.run!(vars as never);
}

/** The JavaScript value of `v` as MathJSON: the inner arrays of a list of
 * tuples are tuples. */
function tupleListJson(v: unknown[][]): unknown {
  return [
    'List',
    ...v.map((t) => [
      'Tuple',
      ...t.map((c) =>
        c === undefined
          ? 'Missing'
          : typeof c === 'string'
            ? { str: c }
            : Array.isArray(c)
              ? ['List', ...c]
              : c
      ),
    ]),
  ];
}

describe('CE-214.4: tup(x) with x: any', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'any');
    ce.assign('tup', ce.box(TUP as never));
    return ce;
  }
  const R: unknown = ['At', ['tup', 'x'], 1];

  test.each([
    [['At', R, 1]],
    [['At', R, 2]],
    [['At', R, 3]],
    [['At', R, -1]],
    [['First', R]],
    [['Second', R]],
    // `Last` declined this operand ("not an indexed collection") while
    // `First` and `Second` compiled it.
    [['Last', R]],
  ])('%j agrees with the interpreter', (json) => {
    for (const x of [[], [1, 2]]) {
      const ce = engine();
      const c = compiled(ce, json, { x });
      ce.assign('x', ce.box(['List', ...x] as never));
      expect(c).toEqual(interpreted(ce, json));
    }
  });

  test('the reported read is NaN on both routes for x = []', () => {
    const json = ['At', R, 2];
    const ce = engine();
    expect(compiled(ce, json, { x: [] })).toBeNaN();
    ce.assign('x', ce.box(['List']));
    expect(ce.box(json as never).evaluate().json).toBe('NaN');
  });
});

describe('CE-214.4: a base typed by one tuple', () => {
  const R: unknown = ['At', 'b', 1];
  const reads: unknown[] = [
    ['At', R, 1],
    ['At', R, 2],
    ['At', R, 3],
    ['At', R, -1],
    ['First', R],
    ['Second', R],
    ['Last', R],
  ];
  test.each([
    ['list<tuple<number, string>>', [[], [[1, 's']]]],
    ['list<tuple<number | missing, string>>', [[], [[undefined, 's']]]],
    ['list<tuple<unknown, number>>', [[], [['s', 2]], [[3, 2]], [[[1, 2], 2]]]],
    ['list<tuple<string, string>>', [[], [['r', 's']]]],
    ['list<tuple<integer, real>>', [[], [[1, 2.5]]]],
  ])('%s', (type, values) => {
    for (const json of reads)
      for (const b of values as unknown[][][]) {
        const ce = new ComputeEngine();
        ce.declare('b', type);
        const c = compiled(ce, json, { b });
        ce.assign('b', ce.box(tupleListJson(b) as never));
        expect([json, b, c]).toEqual([json, b, interpreted(ce, json)]);
      }
  });

  test('a declared base whose read is typed `any` keeps Missing', () => {
    // The base type has a `list<any>` arm and no symbol typed `any`: the
    // interpreter keeps the declared type, and answers `Missing`.
    const ce = new ComputeEngine();
    ce.declare('b', 'list<list<any> | tuple<number, number>>');
    const json = ['At', R, 2];
    expect(compiled(ce, json, { b: [] })).toBeUndefined();
    ce.assign('b', ce.box(['List']));
    expect(ce.box(json as never).evaluate().json).toBe('Missing');
  });

  test('`Third` past the end of a tuple with an `unknown` slot', () => {
    // A position past the end of `tuple<unknown, number>` has the read type
    // `unknown`. `Third` compiled to `_SYS.nth`, which answered `Missing`
    // for an absent base, where the interpreter and `At(…, 3)` answer `NaN`.
    for (const b of [[], [['s', 2]], [[3, 2]]]) {
      for (const json of [
        ['Third', ['First', 'b']],
        ['At', ['First', 'b'], 3],
      ]) {
        const ce = new ComputeEngine();
        ce.declare('b', 'list<tuple<unknown, number>>');
        const c = compiled(ce, json, { b });
        ce.assign('b', ce.box(tupleListJson(b) as never));
        expect([json, b, c]).toEqual([json, b, interpreted(ce, json)]);
      }
    }
    for (const p of [undefined, ['s', 2], [3, 2]]) {
      for (const json of [
        ['Third', 'p'],
        ['At', 'p', 3],
      ]) {
        const ce = new ComputeEngine();
        ce.declare('p', 'missing | tuple<unknown, number>');
        const c = compiled(ce, json, { p });
        ce.assign(
          'p',
          ce.box(
            (p === undefined
              ? 'Missing'
              : [
                  'Tuple',
                  typeof p[0] === 'string' ? { str: p[0] } : p[0],
                  p[1],
                ]) as never
          )
        );
        expect([json, p, c]).toEqual([json, p, interpreted(ce, json)]);
      }
    }
  });

  test('a symbol typed `any` in an index does not change the marker', () => {
    // `i: any` is an index, not the collection: the interpreter keeps the
    // declared type of `b` and answers `Missing`. The compiled code read
    // the tuples of the type of `b` because `i` was typed `any`, and gave
    // `NaN`.
    for (const json of [
      ['At', ['At', 'b', 'i'], 1],
      ['At', ['At', 'b', 'i'], 2],
      ['Second', ['At', 'b', 'i']],
    ]) {
      const ce = new ComputeEngine();
      ce.declare('b', 'list<list<any> | tuple<number, number>>');
      ce.declare('i', 'any');
      const c = compiled(ce, json, { b: [], i: 1 });
      ce.assign('b', ce.box(['List']));
      ce.assign('i', 1);
      expect([json, c]).toEqual([json, interpreted(ce, json)]);
      expect(c).toBeUndefined();
    }
  });
});

function pythonHasNumpy(): boolean {
  try {
    if (TEST_PYTHON === undefined || !fs.existsSync(TEST_PYTHON)) return false;
    execFileSync(TEST_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const describePython = pythonHasNumpy() ? describe : describe.skip;

describePython('CE-214.4: Python, a base typed by one tuple', () => {
  // The same reads as above, run as compiled Python. An absent base gave
  // `None` for every read, where the interpreter answers `NaN` for a read
  // typed as a number (`At(At(b, 1), 1)` with `b: list<tuple<number,
  // string>>` and `b = []`). A read past the end of `("s", 2)` for
  // `b: list<tuple<unknown, number>>` gave `nan`, the marker of the join of
  // the slots, where the interpreter picks `Missing` from the cells.
  const R: unknown = ['At', 'b', 1];
  const reads: unknown[] = [
    ['At', R, 1],
    ['At', R, 2],
    ['At', R, 3],
    ['At', R, -1],
    ['First', R],
    ['Second', R],
    ['Last', R],
  ];
  /** A Python literal for a JavaScript value: `None` for `undefined`. */
  const py = (c: unknown): string =>
    c === undefined
      ? 'None'
      : typeof c === 'string'
        ? JSON.stringify(c)
        : String(c);
  /** The interpreter's value spelled as the Python `repr`. */
  const asRepr = (v: unknown): string =>
    v === undefined
      ? 'None'
      : typeof v === 'number' && Number.isNaN(v)
        ? 'nan'
        : typeof v === 'string'
          ? `'${v}'`
          : String(v);
  test.each([
    ['list<tuple<number, string>>', [[], [[1, 's']]]],
    ['list<tuple<number | missing, string>>', [[], [[undefined, 's']]]],
    ['list<tuple<unknown, number>>', [[], [['s', 2]], [[3, 2]]]],
    ['list<tuple<string, string>>', [[], [['r', 's']]]],
    ['list<tuple<integer, real>>', [[], [[1, 2.5]]]],
  ])('%s', (type, values) => {
    const cases: [unknown, unknown[][]][] = [];
    const lines: string[] = ['import numpy as np', 'import math'];
    for (const json of reads)
      for (const b of values as unknown[][][]) {
        const ce = new ComputeEngine();
        ce.declare('b', type);
        const name = `f${cases.length}`;
        lines.push(
          new PythonTarget().compileFunction(ce.box(json as never), name, ['b'])
        );
        const arg = `[${b.map((t) => `(${t.map(py).join(', ')},)`).join(', ')}]`;
        lines.push(
          `_r = ${name}(${arg})`,
          `print('nan' if isinstance(_r, float) and math.isnan(_r) else repr(_r))`
        );
        ce.assign('b', ce.box(tupleListJson(b) as never));
        cases.push([json, b]);
        (cases.at(-1) as unknown[]).push(asRepr(interpreted(ce, json)));
      }
    const out = execFileSync(TEST_PYTHON!, ['-c', lines.join('\n')], {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n');
    expect(cases.map((c, i) => [...c.slice(0, 2), out[i]])).toEqual(
      cases.map((c) => [c[0], c[1], c[2]])
    );
  });

  test('a symbol typed `any` in an index does not change the marker', () => {
    // `i: any` is an index, not the collection: the interpreter keeps the
    // declared type of `b` and answers `Missing` (`None`). The compiled
    // code gave `nan`.
    const lines: string[] = ['import numpy as np', 'import math'];
    const expected: string[] = [];
    const reads: unknown[] = [
      ['At', ['At', 'b', 'i'], 1],
      ['At', ['At', 'b', 'i'], 2],
    ];
    for (const [k, json] of reads.entries()) {
      const ce = new ComputeEngine();
      ce.declare('b', 'list<list<any> | tuple<number, number>>');
      ce.declare('i', 'any');
      lines.push(
        new PythonTarget().compileFunction(ce.box(json as never), `f${k}`, [
          'b',
          'i',
        ]),
        `_r = f${k}([], 1)`,
        `print('nan' if isinstance(_r, float) and math.isnan(_r) else repr(_r))`
      );
      ce.assign('b', ce.box(['List']));
      ce.assign('i', 1);
      expected.push(asRepr(interpreted(ce, json)));
    }
    const out = execFileSync(TEST_PYTHON!, ['-c', lines.join('\n')], {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n');
    expect(out).toEqual(expected);
    expect(out).toEqual(['None', 'None']);
  });

  test('`tup(x)` with `x: any` declines on Python', () => {
    // The Python target has no lowering for a call of a function assigned
    // to a symbol, so the reads of `tup(x)` above do not compile on Python:
    // the interpreter evaluates them.
    const ce = new ComputeEngine();
    ce.declare('x', 'any');
    ce.assign('tup', ce.box(TUP as never));
    expect(() =>
      new PythonTarget().compile(
        ce.box(['At', ['At', ['tup', 'x'], 1], 2] as never)
      )
    ).toThrow(/tup/);
  });
});
