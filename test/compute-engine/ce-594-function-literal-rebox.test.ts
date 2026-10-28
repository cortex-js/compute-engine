/**
 * CE-594: assigning a function literal whose body shares its nodes takes
 * time and memory linear in the number of distinct nodes.
 *
 * Two parts of `ce.assign()` box a canonical literal again, so that its
 * body is canonicalized afresh:
 * - a literal that names the function it is assigned to (a recursive
 *   definition) is boxed again once the name is declared as a function, so
 *   that the self-call binds to it;
 * - under a declared signature, the declared result or parameter types are
 *   written on the literal (`Typed`), and the literal is boxed again.
 * Each boxed the MathJSON of the literal, which has one copy of a shared
 * node for each path from the root. Both now box a raw copy of the literal
 * that keeps shared nodes shared. The recursion check of a recursive
 * literal (`nestedLiteralCallsCycle()`) read each path too.
 *
 * Measured on 2026-10-28 before the change: a recursive literal over
 * `Max(t, t)` nested 18 deep took 20 s to assign (3.5 GB), and the body
 * `e_{k+1} = e_k + sin(e_k)` 18 deep under `(real) -> real` took 9 s
 * (2.4 GB); at depth 20 both ran out of memory. After: under 50 ms at
 * depth 30.
 *
 * Each test measures its own time: a jest time limit cannot stop a
 * synchronous test. The limit of 2 s is far above the expected time.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const DEPTH = 30;

function timed<T>(f: () => T): [T, number] {
  const start = performance.now();
  const value = f();
  return [value, performance.now() - start];
}

/** The number of distinct node objects reachable from `e`. */
function distinctNodes(e: Expression): number {
  const seen = new Set<Expression>();
  const walk = (node: Expression): void => {
    if (seen.has(node)) return;
    seen.add(node);
    for (const op of node.ops ?? []) walk(op);
  };
  walk(e);
  return seen.size;
}

/** `r := n ↦ Max(t, t)` nested `depth` deep, with the leaf
 * `If(n < 1, 0, r(n − 1))`. */
function assignRecursiveTower(ce: ComputeEngine, depth: number): number {
  const n = ce.symbol('n');
  const leaf = ce.function('If', [
    ce.function('Less', [n, ce.number(1)]),
    ce.number(0),
    ce.function('r', [ce.function('Subtract', [n, ce.number(1)])]),
  ]);
  let t = leaf;
  for (let i = 0; i < depth; i++) t = ce.function('Max', [t, t]);
  const literal = ce.function('Function', [t, n]);
  return timed(() => ce.assign('r', literal))[1];
}

/** `h := t ↦ e_depth` under the declaration `signature`, with
 * `e_0 = t + c` and `e_{k+1} = e_k + sin(e_k)`. */
function assignDeclaredChain(
  ce: ComputeEngine,
  signature: string,
  depth: number
): number {
  ce.declare('c', 'real');
  const t = ce.symbol('t');
  let e = ce.function('Add', [t, ce.symbol('c')]);
  for (let i = 0; i < depth; i++)
    e = ce.function('Add', [e, ce.function('Sin', [e])]);
  ce.declare('h', signature);
  const literal = ce.function('Function', [e, t]);
  return timed(() => ce.assign('h', literal))[1];
}

function storedLiteral(ce: ComputeEngine, id: string): Expression {
  const def = ce.lookupDefinition(id) as {
    operator?: { _lambdaLiteral?: Expression };
    value?: { value?: Expression };
  };
  return (def.operator?._lambdaLiteral ?? def.value?.value)!;
}

describe('CE-594: a recursive literal over a shared tower', () => {
  test('is assigned in linear time', () => {
    const ce = new ComputeEngine();
    const ms = assignRecursiveTower(ce, DEPTH);
    expect(ms).toBeLessThan(2000);
    expect(distinctNodes(storedLiteral(ce, 'r'))).toBeLessThan(100);
    expect(ce.box(['r', 2]).type.toString()).toBe('integer');
  });

  test('has the same value as before at a small depth', () => {
    const ce = new ComputeEngine();
    assignRecursiveTower(ce, 2);
    const leaf = ['If', ['Less', 'n', 1], 0, ['r', ['Add', 'n', -1]]];
    expect(storedLiteral(ce, 'r').json).toEqual([
      'Function',
      ['Block', ['Max', ['Max', leaf, leaf], ['Max', leaf, leaf]]],
      'n',
    ]);
    expect(ce.symbol('r').type.toString()).toBe('(n: unknown) -> integer');
    expect(ce.box(['r', 3]).evaluate().toString()).toBe('0');
  });
});

describe('CE-594: a literal over a shared graph under a declared signature', () => {
  // The declared result `real` is written on the literal: the body alone
  // types `number`.
  test('the result ascription takes linear time', () => {
    const ce = new ComputeEngine();
    const ms = assignDeclaredChain(ce, '(real) -> real', DEPTH);
    expect(ms).toBeLessThan(2000);
    expect(distinctNodes(storedLiteral(ce, 'h'))).toBeLessThan(500);
    expect(ce.box(['h', 0.5]).type.toString()).toBe('real');
  });

  // The declared parameter type `list<real>` is written on the literal too.
  test('the parameter ascription takes linear time', () => {
    const ce = new ComputeEngine();
    const ms = assignDeclaredChain(ce, '(list<real>) -> real', DEPTH);
    expect(ms).toBeLessThan(2000);
    expect(distinctNodes(storedLiteral(ce, 'h'))).toBeLessThan(500);
  });

  test('has the same value as before at a small depth', () => {
    const body = [
      'Add',
      'c',
      't',
      ['Sin', ['Add', 'c', 't']],
      ['Sin', ['Add', 'c', 't', ['Sin', ['Add', 'c', 't']]]],
    ];
    const ce = new ComputeEngine();
    assignDeclaredChain(ce, '(real) -> real', 2);
    expect(storedLiteral(ce, 'h').json).toEqual([
      'Function',
      ['Block', ['Typed', body, "'real'"]],
      't',
    ]);
    expect(ce.symbol('h').type.toString()).toBe('(real) -> real');
    expect(ce.box(['h', 1]).evaluate().toString()).toBe(
      'c + sin(c + 1) + sin(c + sin(c + 1) + 1) + 1'
    );

    const ce2 = new ComputeEngine();
    assignDeclaredChain(ce2, '(list<real>) -> real', 2);
    expect(storedLiteral(ce2, 'h').json).toEqual([
      'Function',
      ['Block', ['Typed', body, "'real'"]],
      ['Typed', 't', "'list<real>'"],
    ]);
    expect(ce2.symbol('h').type.toString()).toBe('(list<real>) -> real');
    expect(
      ce2
        .box(['h', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe(
      '[c + sin(c + 1) + sin(c + sin(c + 1) + 1) + 1,c + sin(c + 2) + sin(c + sin(c + 2) + 2) + 2]'
    );
  });
});

describe('CE-594: an invalid literal keeps the MathJSON route', () => {
  // A literal that holds an `Error` node is re-boxed from its MathJSON, not
  // from the raw copy: the `canonical` read of an invalid raw node returns
  // it unchanged, where boxing the MathJSON canonicalizes the nodes around
  // the error. The assignment outcomes below are those of the code before
  // the raw copy (measured on 8fe7cfa73).
  test('a recursive literal with an Error node is refused', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.assign(
        'r',
        ce.box([
          'Function',
          [
            'If',
            ['Less', 'n', 1],
            ['List', 0, ['Error', "'bad'"]],
            ['List', ['r', ['Subtract', 'n', 1]], 1],
          ],
          'n',
        ])
      )
    ).toThrow(/Invalid function/);
  });

  test('a declared signature over a body with an Error node is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(real) -> real');
    expect(() =>
      ce.assign(
        'h',
        ce.box(['Function', ['Add', 'x', ['Error', "'bad'"]], 'x'])
      )
    ).toThrow();
  });
});
