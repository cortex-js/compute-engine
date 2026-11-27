/**
 * CE-1906: compiled code calls a function of the host with a `List`
 * literal whose element is a free name that holds a list, directly or
 * through `listFrom()` of a rest parameter. The engine holds the value of
 * the name as a `List` literal, which the interpreter passes as it is, so
 * the code makes the same value (`capturedLiterals` in `hostCall()` of
 * `compilation/ir/lower.ts`). A name that holds a `Range` still declines:
 * the interpreter passes `List(Range(...))`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { executeEpsil } from '../../src/epsil';

/** Runs `src`, then calls the value of `frame` once compiled and once
 *  interpreted: the JSON of the arguments of `show` in each run, or the
 *  message of the decline for the compiled run. */
function run(src: string): {
  compiled: string[] | { declined: string };
  interpreted: string[];
} {
  const ce = new ComputeEngine();
  const seen: string[] = [];
  ce.declare('show', {
    signature: '(any) -> nothing',
    pure: false,
    evaluate: (ops) => {
      seen.push(JSON.stringify(ops[0].json));
      return ce.Nothing;
    },
  });
  expect(executeEpsil(ce, src).diagnostics.map((d) => d.message)).toEqual([]);
  const frame = ce.expr('frame').evaluate();
  let compiled: string[] | { declined: string };
  try {
    const result = compile(frame, { to: 'javascript', fallback: false });
    result.run!(0);
    compiled = [...seen];
  } catch (e) {
    compiled = { declined: (e as Error).message };
  }
  seen.length = 0;
  ce.function('Apply', [frame, ce.number(0)]).evaluate();
  return { compiled, interpreted: [...seen] };
}

describe('a list variable inside a list argument of a function of the host', () => {
  test.each([
    [
      'a list literal of a list variable',
      'let v = [1, 2]\nlet frame = (t: real) => do { show([v]); 0 }',
      '["List",["List",1,2]]',
    ],
    [
      'a list literal of a nested list variable',
      'let v = [[1, 2], [3, 4]]\nlet frame = (t: real) => do { show([v, v]); 0 }',
      '["List",["List",["List",1,2],["List",3,4]],["List",["List",1,2],["List",3,4]]]',
    ],
    [
      'listFrom of a rest parameter (the draw of a Tycho notebook)',
      'let v = [1, 2]\nfunction draw(...args) -> nothing { show(listFrom(args)) }\nlet frame = (t: real) => do { draw(v); 0 }',
      '["List",["List",1,2]]',
    ],
    [
      'the list variable alone',
      'let v = [1, 2]\nlet frame = (t: real) => do { show(v); 0 }',
      '["List",1,2]',
    ],
  ])('%s: compiled as interpreted', (_, src, call) => {
    expect(run(src)).toEqual({ compiled: [call], interpreted: [call] });
  });

  test('a variable that holds a range declines: the interpreter keeps the range', () => {
    expect(
      run('let w = 1..3\nlet frame = (t: real) => do { show([w]); 0 }')
    ).toEqual({
      compiled: { declined: expect.stringMatching(/lazy collection/) },
      interpreted: ['["List",["Range",1,3,1]]'],
    });
  });
});
