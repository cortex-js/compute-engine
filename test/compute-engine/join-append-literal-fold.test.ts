import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * A `Join` whose operands are all list literals, and an `Append` whose
 * source is a list literal, fold into ONE list literal at canonicalization.
 *
 * Laziness is an optimization, not a contract: a view over materialized
 * literals costs more than the literal it stands for. Before the fold, the
 * accumulator loop `xs = Join(xs, [k])` built a `Join` with one operand per
 * turn, and each turn walked all of them several times over (validation,
 * overload resolution for the type, finiteness, purity, the rebuilt result's
 * type again): 2.9 s for 400 turns on a quiet box, growing four-fold per
 * doubling. With the fold the loop's value is a list literal, and a turn
 * costs one typed copy of it.
 */

const ce = new ComputeEngine();

describe('Join over list literals folds into one list literal', () => {
  test('box route', () => {
    const e = ce.box(['Join', ['List', 1, 2], ['List', 3]]);
    expect(e.operator).toBe('List');
    expect(e.json).toEqual(['List', 1, 2, 3]);
    expect(e.isLazyCollection).toBe(false);
  });

  test('ce.function route', () => {
    const e = ce.function('Join', [
      ce.box(['List', 1, 2]),
      ce.box(['List', 3]),
    ]);
    expect(e.json).toEqual(['List', 1, 2, 3]);
  });

  test('parse route', () => {
    const e = ce.parse('\\operatorname{join}([1, 2], [3, 4])');
    expect(e.json).toEqual(['List', 1, 2, 3, 4]);
  });

  test('a nested Join of literals folds through the same-head flatten', () => {
    const e = ce.box(['Join', ['Join', ['List', 1], ['List', 2]], ['List', 3]]);
    expect(e.json).toEqual(['List', 1, 2, 3]);
  });

  test('a unary Join of a list literal is the literal', () => {
    expect(ce.box(['Join', ['List', 1, 2]]).json).toEqual(['List', 1, 2]);
  });

  test('a scalar operand is wrapped first, then folded', () => {
    expect(ce.box(['Join', ['List', 1, 2], 3]).json).toEqual(['List', 1, 2, 3]);
  });

  test('the elements are shared, not re-boxed', () => {
    const a = ce.box(['List', 1, 2]);
    const b = ce.box(['List', 3]);
    const e = ce.function('Join', [a, b]);
    expect(e.ops![0]).toBe(a.ops![0]);
    expect(e.ops![2]).toBe(b.ops![0]);
  });

  test('the empty Join is not folded', () => {
    expect(ce.box(['Join']).json).toEqual(['Join']);
  });

  test('a tuple operand keeps the lazy view (an atomic element)', () => {
    const e = ce.box(['Join', ['List', 1], ['Tuple', 2, 3]]);
    expect(e.operator).toBe('Join');
    expect([...e.each()].map((x) => x.toString())).toEqual(['1', '(2, 3)']);
  });

  test('a symbol operand keeps the lazy view', () => {
    ce.declare('ys', 'list<integer>');
    expect(ce.box(['Join', ['List', 1], 'ys']).operator).toBe('Join');
  });

  test('a lazy operand keeps the lazy view', () => {
    expect(ce.box(['Join', ['List', 1], ['Range', 2, 3]]).operator).toBe(
      'Join'
    );
  });

  test('past the collection size cap the lazy view is kept', () => {
    const small = new ComputeEngine();
    small.maxCollectionSize = 3;
    const e = small.box(['Join', ['List', 1, 2], ['List', 3, 4]]);
    expect(e.operator).toBe('Join');
    expect(e.count).toBe(4);
    expect(small.box(['Join', ['List', 1, 2], ['List', 3]]).operator).toBe(
      'List'
    );
  });
});

describe('Append to a list literal folds into one list literal', () => {
  test('each appended value is one element, a list value included', () => {
    expect(ce.box(['Append', ['List', 1, 2], 3]).json).toEqual([
      'List',
      1,
      2,
      3,
    ]);
    expect(ce.box(['Append', ['List', 1, 2], 3, 4]).json).toEqual([
      'List',
      1,
      2,
      3,
      4,
    ]);
    expect(ce.box(['Append', ['List', 1], ['List', 2, 3]]).json).toEqual([
      'List',
      1,
      ['List', 2, 3],
    ]);
  });

  test('a symbol value is an element that resolves at evaluation', () => {
    const local = new ComputeEngine();
    local.assign('y', local.number(5));
    const e = local.box(['Append', ['List', 1, 2], 'y']);
    expect(e.json).toEqual(['List', 1, 2, 'y']);
    expect(e.evaluate().toString()).toBe('[1,2,5]');
    local.assign('y', local.number(7));
    expect(e.evaluate().toString()).toBe('[1,2,7]');
  });

  test('a tuple source is enumerated, so it keeps the lazy view', () => {
    const e = ce.box(['Append', ['Tuple', 1, 2], 3]);
    expect(e.operator).toBe('Append');
    expect(e.count).toBe(3);
  });

  test('an invalid appended value declines the fold', () => {
    const e = ce.box(['Append', ['List', 1, 2], 'Nothing']);
    expect(e.isValid).toBe(false);
    expect(e.operator).toBe('Append');
  });

  test('past the collection size cap the lazy view is kept', () => {
    const small = new ComputeEngine();
    small.maxCollectionSize = 3;
    expect(small.box(['Append', ['List', 1, 2], 3, 4]).operator).toBe('Append');
    expect(small.box(['Append', ['List', 1, 2], 3]).operator).toBe('List');
  });
});

describe('the accumulator loop holds a list literal', () => {
  test('Join accumulator through Assign', () => {
    const local = new ComputeEngine();
    local.assign('xs', local.box(['List']));
    for (let k = 1; k <= 300; k++)
      local.assign(
        'xs',
        local
          .function('Join', [local.symbol('xs'), local.box(['List', k])])
          .evaluate()
      );
    const xs = local.symbol('xs').evaluate();
    expect(xs.operator).toBe('List');
    expect(xs.nops).toBe(300);
    expect(xs.type.toString()).toBe('vector<integer^300>');
  });

  test('Append accumulator through Assign', () => {
    const local = new ComputeEngine();
    local.assign('xs', local.box(['List']));
    for (let k = 1; k <= 300; k++)
      local.assign(
        'xs',
        local
          .function('Append', [local.symbol('xs'), local.number(k)])
          .evaluate()
      );
    const xs = local.symbol('xs').evaluate();
    expect(xs.operator).toBe('List');
    expect(xs.nops).toBe(300);
  });

  test('the Epsil growing-list idioms', () => {
    const local = new ComputeEngine();
    for (const step of [
      'xs = Join(xs, [k])',
      'xs = Append(xs, k)',
      'xs = [...xs, k]',
    ]) {
      const r = executeEpsil(
        local,
        `let xs = []; for k in 1..300 { ${step} }; xs`
      );
      expect(r.value.operator).toBe('List');
      expect(r.value.nops).toBe(300);
    }
  });
});

describe('a folded list awaits an asynchronous element', () => {
  // `List` is `lazy`, so its elements reach its handlers unevaluated on the
  // async route too. Before `List` had an `evaluateAsync` handler, an
  // element whose operator has only an asynchronous handler stayed
  // unevaluated inside a list literal — and the fold routed
  // `Append([1], AsyncOnly())` into that gap.
  const declareAsyncOnly = (engine: ComputeEngine) =>
    engine.declare('AsyncOnly', {
      signature: '() -> number',
      evaluateAsync: async () => engine.number(7),
    } as any);

  test('a list literal', async () => {
    const local = new ComputeEngine();
    declareAsyncOnly(local);
    const e = local.box(['List', 1, ['AsyncOnly']]);
    expect((await e.evaluateAsync()).toString()).toBe('[1,7]');
    expect((await e.evaluateAsync({ materialization: true })).toString()).toBe(
      '[1,7]'
    );
  });

  test('a folded Append and a folded Join', async () => {
    const local = new ComputeEngine();
    declareAsyncOnly(local);
    expect(
      (
        await local.box(['Append', ['List', 1], ['AsyncOnly']]).evaluateAsync()
      ).toString()
    ).toBe('[1,7]');
    expect(
      (
        await local
          .box(['Join', ['List', 1], ['List', ['AsyncOnly']]])
          .evaluateAsync()
      ).toString()
    ).toBe('[1,7]');
  });

  test('a set literal', async () => {
    const local = new ComputeEngine();
    declareAsyncOnly(local);
    expect(
      (await local.box(['Set', 1, ['AsyncOnly']]).evaluateAsync()).toString()
    ).toBe('Set(1, 7)');
  });
});

describe('the async route honors the evaluation options', () => {
  // The base `evaluateAsync` of a leaf forwards its options: a number under
  // `numericApproximation` floats on the async route as it does on the sync
  // one. Before, `[1/3].evaluateAsync({ numericApproximation: true })` kept
  // the rational.
  test('numericApproximation reaches the elements of a list literal', async () => {
    const local = new ComputeEngine();
    const l = local.box(['List', ['Rational', 1, 3], ['Sqrt', 2]]);
    expect(
      (await l.evaluateAsync({ numericApproximation: true })).toString()
    ).toBe(l.N().toString());
    const a = local.box(['Add', ['Rational', 1, 3], 1]);
    expect(
      (await a.evaluateAsync({ numericApproximation: true })).toString()
    ).toBe(a.N().toString());
  });

  test('a set comprehension awaits its domain and body', async () => {
    const local = new ComputeEngine();
    local.declare('AsyncOnly', {
      signature: '(number) -> number',
      evaluateAsync: async ([x]) => local.number((x.re ?? 0) * 10),
    } as any);
    const s = local.parse('\\{ \\mathrm{AsyncOnly}(k) : k \\in \\{1, 2\\} \\}');
    expect((await s.evaluateAsync()).toString()).toBe('Set(10, 20)');
  });
});

describe('a set comprehension on the async route', () => {
  // The MathJSON form A of a comprehension: the condition rides inside the
  // `Element`. (The LaTeX form `\{ k : k \in D, cond \}` parses the
  // condition as a second `Set` operand, which neither route reads as a
  // comprehension — recorded in `ROADMAP.md`.) The predicate is itself an
  // asynchronous-only operator: a comparison such as `Less` holds its
  // operands and evaluates them synchronously, so an asynchronous-only
  // operand inside one is not awaited on either route.
  const declareAsyncPred = (engine: ComputeEngine) =>
    engine.declare('AsyncPred', {
      signature: '(number) -> boolean',
      evaluateAsync: async ([x]) =>
        (x.re ?? 0) > 1 ? engine.True : engine.False,
    } as any);

  test('awaits the condition, and drops the values it refutes', async () => {
    const local = new ComputeEngine();
    declareAsyncPred(local);
    const s = local.box([
      'Set',
      'k',
      ['Element', 'k', ['Set', 1, 2, 3], ['AsyncPred', 'k']],
    ]);
    expect((await s.evaluateAsync()).toString()).toBe('Set(2, 3)');
  });

  test('stays symbolic when the condition is undecidable', async () => {
    const local = new ComputeEngine();
    local.declare('y', 'integer');
    const s = local.box([
      'Set',
      'k',
      ['Element', 'k', ['Set', 1, 2], ['Greater', 'k', 'y']],
    ]);
    // Parity with the synchronous route, which declines too.
    expect((await s.evaluateAsync()).toString()).toBe(s.evaluate().toString());
    expect((await s.evaluateAsync()).isSame(s)).toBe(true);
  });

  test('awaits the values of an enumerable literal domain', async () => {
    const local = new ComputeEngine();
    local.declare('AsyncOnly', {
      signature: '(number) -> number',
      evaluateAsync: async ([x]) => local.number((x.re ?? 0) * 10),
    } as any);
    const s = local.box([
      'Set',
      'k',
      ['Element', 'k', ['Set', ['AsyncOnly', 1], 2]],
    ]);
    expect((await s.evaluateAsync()).toString()).toBe('Set(10, 2)');
    // The synchronous route evaluates an extracted value too.
    local.assign('x', local.number(5));
    expect(
      local
        .box(['Set', 'k', ['Element', 'k', ['Set', 'x', 2]]])
        .evaluate()
        .toString()
    ).toBe('Set(5, 2)');
  });

  test('forwards numericApproximation to the body on both routes', async () => {
    const local = new ComputeEngine();
    const s = local.box([
      'Set',
      ['Divide', 'k', 3],
      ['Element', 'k', ['Set', 1]],
    ]);
    expect(s.N().toString()).toBe('Set(0.333333333333333333333)');
    expect(
      (await s.evaluateAsync({ numericApproximation: true })).toString()
    ).toBe(s.N().toString());
  });
});

describe('a unary Join is its operand whatever the size', () => {
  test('the size cap bounds the copy, not the identity', () => {
    const small = new ComputeEngine();
    small.maxCollectionSize = 3;
    const big = small.box(['List', 1, 2, 3, 4, 5]);
    expect(small.function('Join', [big])).toBe(big);
  });
});
