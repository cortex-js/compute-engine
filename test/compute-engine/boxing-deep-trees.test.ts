import type { MathJsonExpression } from '../../src/math-json/types';
import { ComputeEngine } from '../../src/compute-engine';
import { _setBoxingDevolveThreshold } from '../../src/compute-engine/boxed-expression/box';

/**
 * Boxing used to recurse once per level of the tree it was boxing, so a tree
 * only a few hundred levels deep exhausted the JS stack: `ce.parse('1-2-3-…')`
 * threw `RangeError: Maximum call stack size exceeded` past about 500 terms,
 * because the LaTeX parser returns a left-nested
 * `Subtract(Subtract(Subtract(1, 2), 3), …)` and every level cost five frames.
 * The same limit reached any deep tree — a `Sin` nest, a deep operand list —
 * whatever produced it.
 *
 * Past `boxingDevolveThreshold` levels (`boxed-expression/box.ts`) boxing now
 * stops recursing and boxes the rest of the subtree with an explicit work
 * stack: the operands are boxed bottom-up and each node is built from operands
 * that are boxed already, so the stack depth no longer follows the depth of
 * the input. Nothing about the RESULT changes, which is what the identity pin
 * below asserts: the same tree boxed with the threshold lowered far enough to
 * take the devolved route gives the same expression as the recursive route.
 *
 * Three walks outside boxing had the same defect and are fixed with the same
 * remedy — `containsError` (`latex-syntax/parse.ts`) and
 * `normalizeContinuationRanges` (`latex-syntax/dictionary/definitions-core.ts`),
 * both post-parse passes over the MathJSON, and `BoxedFunction.isValid`, which
 * settles a node from its operands. Without them a deep chain still overflowed
 * before boxing was reached, or the first read of its validity did.
 *
 * `(((…x…)))` built as MathJSON is a separate case. A LAZY operator's
 * operands reach its canonical handler raw, and `Delimiter`'s handler
 * canonicalizes its held operand itself, so the recursion is the handler's,
 * where boxing has no say. Past about 1 000 levels the handler overflowed,
 * the recovery in `applyOperatorDefinition` logged the `RangeError` and
 * returned a NON-canonical `Delimiter`. The handler (`library/core.ts`) now
 * removes consecutive parenthesis wrappers in a loop before it canonicalizes
 * the innermost operand. The walk that looks for objects owned by another
 * engine (`containsForeignEngineObject`, `type-guards.ts`) was recursive too,
 * and now uses a work stack.
 *
 * What is NOT covered: the LaTeX parser's own grammar recursion
 * (`parseEnclosure → parsePrimary → parseExpression`) stops at about 1 870
 * levels of `(((…)))`.
 */

/** `1-2-3-…-n` as LaTeX. */
function subtractionChain(n: number): string {
  const terms: string[] = [];
  for (let i = 1; i <= n; i++) terms.push(String(i));
  return terms.join('-');
}

/** `1 - (2 + 3 + … + n)`. */
function subtractionChainValue(n: number): number {
  return 1 - ((n * (n + 1)) / 2 - 1);
}

/** `head(head(…head(leaf)…))`, `n` levels deep. */
function nest(head: string, n: number, leaf: MathJsonExpression = 'x') {
  let d: MathJsonExpression = leaf;
  for (let i = 0; i < n; i++) d = [head, d];
  return d;
}

/** A left-nested `Subtract` chain as MathJSON, the shape the parser returns
 *  for `1-2-3-…`. */
function subtractionChainJson(n: number): MathJsonExpression {
  let d: MathJsonExpression = 1;
  for (let i = 2; i <= n; i++) d = ['Subtract', d, i];
  return d;
}

describe('boxing a deep tree', () => {
  test('a 5 000-term subtraction chain parses and evaluates', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(subtractionChain(5000));
    expect(expr.evaluate().re).toBe(subtractionChainValue(5000));
  });

  test('a 5 000-term subtraction chain boxed from MathJSON evaluates', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(subtractionChainJson(5000));
    expect(expr.evaluate().re).toBe(subtractionChainValue(5000));
  });

  test('a raw-boxed 5 000-term chain canonicalizes and evaluates', () => {
    const ce = new ComputeEngine();
    const raw = ce.parse(subtractionChain(5000), { form: 'raw' });
    expect(raw.isCanonical).toBe(false);
    expect(raw.canonical.evaluate().re).toBe(subtractionChainValue(5000));
  });

  test('a 2 000-deep Sin nest boxes canonically', () => {
    const ce = new ComputeEngine();
    let expr = ce.box(nest('Sin', 2000));
    let depth = 0;
    while (expr.operator === 'Sin') {
      expr = expr.op1;
      depth += 1;
    }
    expect(depth).toBe(2000);
    expect(expr.symbol).toBe('x');
  });

  test('a 2 000-deep Sin nest boxes raw, and canonicalizes afterwards', () => {
    const ce = new ComputeEngine();
    const raw = ce.box(nest('Sin', 2000), { form: 'raw' });
    expect(raw.isCanonical).toBe(false);
    let expr = raw.canonical;
    let depth = 0;
    while (expr.operator === 'Sin') {
      expr = expr.op1;
      depth += 1;
    }
    expect(depth).toBe(2000);
  });
});

describe('a deep chain of Delimiter', () => {
  /** Call `fn` and return its result and the `console.error` calls it made. */
  function withConsoleErrors<T>(fn: () => T): [T, unknown[][]] {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = fn();
      return [result, spy.mock.calls.slice()];
    } finally {
      spy.mockRestore();
    }
  }

  test('a 1 500-deep Delimiter chain boxes canonically', () => {
    const ce = new ComputeEngine();
    const [expr, errors] = withConsoleErrors(() =>
      ce.box(nest('Delimiter', 1500, 1))
    );
    expect(errors).toEqual([]);
    expect(expr.isCanonical).toBe(true);
    expect(expr.json).toBe(1);
    expect(expr.evaluate().json).toBe(1);
  });

  test('a 60 000-deep Delimiter chain boxes canonically', () => {
    const ce = new ComputeEngine();
    const [expr, errors] = withConsoleErrors(() =>
      ce.box(nest('Delimiter', 60000, 'x'))
    );
    expect(errors).toEqual([]);
    expect(expr.symbol).toBe('x');
  });

  test('a deep chain with explicit parentheses, raw-boxed then canonicalized', () => {
    const ce = new ComputeEngine();
    let d: MathJsonExpression = ['Add', 'x', 1];
    for (let i = 0; i < 1500; i++) d = ['Delimiter', d, "'()'"];
    const [expr, errors] = withConsoleErrors(
      () => ce.box(d, { form: 'raw' }).canonical
    );
    expect(errors).toEqual([]);
    expect(expr.isCanonical).toBe(true);
    expect(JSON.stringify(expr.json)).toBe('["Add","x",1]');
  });

  test('the innermost Delimiter keeps its meaning', () => {
    // Removing the outer parentheses must not change what the innermost
    // Delimiter means: a sequence is a tuple, a bracket stays a Delimiter.
    const ce = new ComputeEngine();
    const [tuple, errors1] = withConsoleErrors(() =>
      ce.box(nest('Delimiter', 1500, ['Delimiter', ['Sequence', 1, 2]]))
    );
    expect(errors1).toEqual([]);
    expect(JSON.stringify(tuple.json)).toBe('["Tuple",1,2]');

    const [bracket, errors2] = withConsoleErrors(() =>
      ce.box(nest('Delimiter', 1500, ['Delimiter', 'x', "'[]'"]))
    );
    expect(errors2).toEqual([]);
    expect(bracket.isCanonical).toBe(true);
    expect(JSON.stringify(bracket.json)).toBe(
      JSON.stringify(ce.box(['Delimiter', 'x', "'[]'"]).json)
    );
  });

  test('a deep raw tree is adopted after an object was constructed', () => {
    // Once an object exists in the process, every function construction
    // checks its operands for an object owned by another engine. That walk
    // was recursive and overflowed on a deep tree.
    // The tree is boxed BEFORE the object exists: boxing it afterwards runs
    // the same walk once per level, which costs time quadratic in the depth.
    const ce = new ComputeEngine();
    const raw = ce.box(nest('Sin', 60000), { form: 'raw' });
    ce.declareType('DeepBox', { kind: 'record', elements: {} });
    ce._object('DeepBox', {});
    const expr = ce.function('Cos', [raw], { form: 'raw' });
    expect(expr.operator).toBe('Cos');
  });
});

describe('the devolved route gives the same expression as the recursive one', () => {
  // A tree of 150 levels boxed with the threshold at 50 takes the devolved
  // route for two thirds of its depth; the same tree at the default threshold
  // (200) is boxed by the recursion from top to bottom. The two must agree.
  const DEPTH = 150;
  const LOWERED = 50;

  let previousThreshold: number | undefined;

  afterEach(() => {
    if (previousThreshold !== undefined)
      _setBoxingDevolveThreshold(previousThreshold);
    previousThreshold = undefined;
  });

  /** Box `expr` twice on one engine, once by each route, and once more on a
   *  fresh engine by the devolved route. Compares the expression itself
   *  (`isSame`), its MathJSON and its LaTeX. */
  function expectSameBothRoutes(
    expr: MathJsonExpression,
    options?: { form: 'raw' | 'canonical' | ['Flatten', 'Order'] }
  ): void {
    const ce = new ComputeEngine();
    const recursive = ce.box(expr, options);

    previousThreshold = _setBoxingDevolveThreshold(LOWERED);
    const devolved = ce.box(expr, options);
    // A fresh engine, in case boxing the tree once left the first engine in a
    // state (a declaration, an inferred type) the second box could read.
    const devolvedFresh = new ComputeEngine().box(expr, options);
    _setBoxingDevolveThreshold(previousThreshold);
    previousThreshold = undefined;

    expect(devolved.isSame(recursive)).toBe(true);
    expect(JSON.stringify(devolved.json)).toBe(JSON.stringify(recursive.json));
    expect(devolved.latex).toBe(recursive.latex);
    expect(JSON.stringify(devolvedFresh.json)).toBe(
      JSON.stringify(recursive.json)
    );
    expect(devolvedFresh.latex).toBe(recursive.latex);
  }

  test('a left-nested Subtract chain', () => {
    expectSameBothRoutes(subtractionChainJson(DEPTH));
  });

  test('a left-nested Subtract chain, raw', () => {
    expectSameBothRoutes(subtractionChainJson(DEPTH), { form: 'raw' });
  });

  test('a left-nested Subtract chain, in a partial form', () => {
    // A partial form reaches the devolve with `canonical` set to the FORM
    // LIST, and the operands are boxed with the same options the construction
    // itself carries. Pinned here because it is the one form whose operand
    // options are neither "no options at all" (canonical) nor plain `false`.
    expectSameBothRoutes(subtractionChainJson(DEPTH), {
      form: ['Flatten', 'Order'],
    });
  });

  test('a Sin nest', () => {
    expectSameBothRoutes(nest('Sin', DEPTH));
  });

  test('a Sin nest, raw', () => {
    expectSameBothRoutes(nest('Sin', DEPTH), { form: 'raw' });
  });

  test('a nest of mixed heads, with a wide node at every level', () => {
    let d: MathJsonExpression = 'x';
    for (let i = 0; i < DEPTH; i++) {
      const head = ['Sin', 'Cos', 'Negate', 'Square'][i % 4];
      d = ['Add', [head, d], i, ['List', 1, 2, 3]];
    }
    expectSameBothRoutes(d);
  });

  test('a nest under an operator that holds its operand', () => {
    // `Hold` is one of the heads the devolve declines (it boxes its operand
    // with `boxHold`, not the way an ordinary operand is boxed), so this pins
    // that declining it leaves the result alone.
    expectSameBothRoutes(['Hold', nest('Sin', DEPTH)]);
  });

  test('a nest under a lazy operator', () => {
    // `Delimiter` is lazy: its operands reach its canonical handler raw, so
    // the devolve declines it too.
    expectSameBothRoutes(nest('Delimiter', DEPTH));
  });

  test('a nest with an undeclared head', () => {
    expectSameBothRoutes(nest('deepUnknownHead', DEPTH));
  });

  test('a declined operand is boxed before its eager siblings', () => {
    // The ordering witness. Boxing is not free of effects, and the effects
    // depend on the order operands are boxed in: canonicalizing `Not(zz)`
    // infers `zz: boolean` and canonicalizing `Sin(zz)` infers `zz: number`,
    // so whichever of the two is boxed FIRST decides the type of `zz` and the
    // other comes back holding an `incompatible-type` error. The recursive
    // route boxes the operands of a `Tuple` left to right, so the error lands
    // on the SECOND operand.
    //
    // `Delimiter` is lazy, so the devolved walk declines to descend into the
    // first operand, while `Sin(zz)` is an ordinary node it builds as soon as
    // it reaches it. A declined operand that was left raw for the enclosing
    // construction to box afterwards was therefore boxed AFTER its later
    // sibling: the error landed on `Not` instead, and it did so only past the
    // devolve threshold, so the result of boxing this node depended on how
    // deep in the tree it sat.
    const witness: MathJsonExpression = [
      'Tuple',
      ['Delimiter', ['Not', 'zz']],
      ['Sin', 'zz'],
    ];
    let d: MathJsonExpression = witness;
    for (let i = 0; i < DEPTH; i++) d = ['Sin', d];

    const recursiveEngine = new ComputeEngine();
    const recursive = recursiveEngine.box(d);

    previousThreshold = _setBoxingDevolveThreshold(LOWERED);
    const devolvedEngine = new ComputeEngine();
    const devolved = devolvedEngine.box(d);
    _setBoxingDevolveThreshold(previousThreshold);
    previousThreshold = undefined;

    expect(JSON.stringify(devolved.json)).toBe(JSON.stringify(recursive.json));
    expect(devolved.latex).toBe(recursive.latex);
    expect(devolvedEngine.box('zz').type.toString()).toBe(
      recursiveEngine.box('zz').type.toString()
    );

    // Which way round: the first operand is the one that got to infer, the
    // second is the one holding the error.
    for (const boxed of [recursive, devolved]) {
      let node = boxed;
      while (node.operator !== 'Tuple') node = node.op1;
      expect(node.op1.operator).toBe('Not');
      expect(node.op1.op1.symbol).toBe('zz');
      expect(node.op1.isValid).toBe(true);
      expect(node.op2.operator).toBe('Sin');
      expect(node.op2.isValid).toBe(false);
    }
    expect(recursiveEngine.box('zz').type.toString()).toBe('boolean');
  });

  test('a deep tree canonicalized after a raw box', () => {
    const ce = new ComputeEngine();
    const recursive = ce.box(subtractionChainJson(DEPTH), {
      form: 'raw',
    }).canonical;

    previousThreshold = _setBoxingDevolveThreshold(LOWERED);
    const devolved = new ComputeEngine().box(subtractionChainJson(DEPTH), {
      form: 'raw',
    }).canonical;
    _setBoxingDevolveThreshold(previousThreshold);
    previousThreshold = undefined;

    expect(JSON.stringify(devolved.json)).toBe(JSON.stringify(recursive.json));
    expect(devolved.latex).toBe(recursive.latex);
  });
});
