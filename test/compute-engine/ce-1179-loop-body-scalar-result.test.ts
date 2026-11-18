import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// CE-1179. A call of a function with a declared scalar result and a list
// parameter, whose body ends after a loop, keeps its declared result when
// each argument is a value of the type annotated on its parameter. The walk
// of the body gives no type for a loop, and the type of the body as it was
// boxed (the operand of the return marker) bounds the value when the body
// has no `Return`, calls no user function and captures only declared names.
//

function engine(body: string): ComputeEngine {
  const ce = new ComputeEngine();
  const checked = executeEpsil(
    ce,
    `function f(B: list<integer>, k: integer) -> integer {\n${body}\n}`
  );
  expect(checked.diagnostics).toEqual([]);
  ce.declare('L', 'list<integer>');
  return ce;
}

describe('CE-1179: a declared scalar result after a loop', () => {
  test('a count accumulated in a loop keeps the declared result', () => {
    const ce = engine('let n = 0\nfor j in 1..k { n = n + j }\nn');
    expect(ce.box(['f', 'L', 3]).type.toString()).toBe('integer');
    expect(ce.box(['f', ['List', 1, 2], 3]).type.toString()).toBe('integer');
  });

  test('a list value after a loop keeps its list type', () => {
    const ce = engine('for j in 1..k { }\n2 * B');
    const call = ce.box(['f', 'L', 3]);
    expect(call.type.toString()).toBe('list<integer>');
    ce.assign('L', ce.box(['List', 1, 2, 3]));
    expect(call.evaluate().json).toEqual(['List', 2, 4, 6]);
  });

  test('an early Return of the list argument keeps the list arm', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        [
          'Block',
          [
            'Loop',
            ['Block', ['If', ['Greater', 'j', 1], ['Return', 'B']]],
            ['Element', 'j', ['Range', 1, 'k']],
          ],
          ['Typed', 3, "'integer'"],
        ],
        ['Typed', 'B', "'list<integer>'"],
        ['Typed', 'k', "'integer'"],
      ])
    );
    ce.declare('L', 'list<integer>');
    expect(ce.box(['f', 'L', 3]).type.toString()).toBe(
      'integer | list<any>'
    );
  });

  test('a dynamic captured value cannot widen the numeric local contract', () => {
    // An explicitly dynamic captured value can change from scalar to list.
    // The body-local `n` refuses a list store; no list result is admitted.
    const ce = new ComputeEngine();
    const checked = executeEpsil(
      ce,
      `let X: any = 1
function f(B: list<integer>, k: integer) -> integer {
  let n = 0
  for j in 1..k { n = n + j + X }
  n
}
X = [1, 2]
`
    );
    expect(checked.diagnostics).toEqual([]);
    ce.declare('L', 'list<integer>');
    expect(ce.box(['f', 'L', 3]).type.toString()).toBe('integer');
    expect(ce.box(['f', ['List', 1], 3]).evaluate().operator).toBe('Error');
  });

  test('a call of a user function in the body keeps the list arm', () => {
    // The result of `g` reads the explicitly dynamic captured value `X`.
    const ce = new ComputeEngine();
    const checked = executeEpsil(
      ce,
      `let X: any = 1
function g(m: integer) { X + m }
function f(B: list<integer>, k: integer) -> integer {
  let n = 0
  for j in 1..k { n = n + g(j) }
  n
}
X = [1, 2]
`
    );
    expect(checked.diagnostics).toEqual([]);
    ce.declare('L', 'list<integer>');
    expect(ce.box(['f', 'L', 3]).type.toString()).toBe('integer | list<any>');
  });

  test('a call of a user function that is assigned again keeps the list arm', () => {
    const ce = new ComputeEngine();
    const checked = executeEpsil(
      ce,
      `function g(m: integer) { m }
function f(B: list<integer>, k: integer) -> integer {
  let n = 0
  for j in 1..k { n = n + g(j) }
  n
}
`
    );
    expect(checked.diagnostics).toEqual([]);
    ce.assign('g', ce.parse('(m) \\mapsto [m, m]'));
    ce.declare('L', 'list<integer>');
    expect(ce.box(['f', 'L', 3]).type.toString()).toBe('integer | list<any>');
  });

  test('a captured name with a declared type keeps the declared result', () => {
    const ce = new ComputeEngine();
    const checked = executeEpsil(
      ce,
      `let X: integer = 1
function f(B: list<integer>, k: integer) -> integer {
  let n = 0
  for j in 1..k { n = n + j + X }
  n
}
`
    );
    expect(checked.diagnostics).toEqual([]);
    ce.declare('L', 'list<integer>');
    expect(ce.box(['f', 'L', 3]).type.toString()).toBe('integer');
  });

  test('an argument outside the annotated parameter type keeps the list arm', () => {
    const ce = engine('let n = 0\nfor j in 1..k { n = n + j }\nn');
    ce.declare('R', 'list<real>');
    expect(ce.box(['f', 'R', 3]).type.toString()).toBe('integer | list<any>');
  });
});
