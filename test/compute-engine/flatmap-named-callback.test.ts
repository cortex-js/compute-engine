import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// `FlatMap(xs, f)` with a callback `f` that is a symbol naming a user
// function gives the same values as the same callback written inline.
//
// A consumer that walks the view (`ListFrom`, `Count`, `Sum`) needs to know
// that the view is finite. For a finite source, the `isFinite` handler of
// `FlatMap` reads that from the type of the callback result: a scalar, or a
// collection with a fixed length. An inline literal is canonicalized with its
// parameter typed by the elements, so `x ↦ [x, x]` over `[1, 2]` gives
// `vector<integer^2>`. The signature of `f := x ↦ [x, x]` was inferred with
// the parameter `unknown`, and is `(unknown) -> list<unknown>`, which has no
// fixed length. So `ListFrom(FlatMap([1, 2], f))` stayed unevaluated. Now a
// user function whose signature has a parameter typed `unknown` is typed by
// its call on one element of the source, under the same condition as for a
// callback of `Map`. With a source that can hold `Missing`, that call also
// describes an absent cell, so the type gets no extra `nan` arm.
//
// A callback result of a tuple type is finite too: a tuple has a fixed
// number of components.

const ce = new ComputeEngine();
ce.box(['Assign', 'twice', ['Function', ['List', 'x', 'x'], 'x']]).evaluate();
ce.box(['Assign', 'pair', ['Function', ['Tuple', 'x', 'x'], 'x']]).evaluate();
ce.parse('\\operatorname{twiceTex} := x \\mapsto [x, x]').evaluate();

const SOURCE = ['List', 1, 2];
const TWICE_LITERAL = ['Function', ['List', 'x', 'x'], 'x'];
const PAIR_LITERAL = ['Function', ['Tuple', 'x', 'x'], 'x'];

function evaluate(json: unknown): Expression {
  return ce.box(json as Parameters<typeof ce.box>[0]).evaluate();
}

function show(x: Expression): string {
  return JSON.stringify(x.json);
}

describe('FlatMap with a callback that names a user function', () => {
  test('ListFrom over the view is listed (MathJSON definition)', () => {
    expect(show(evaluate(['ListFrom', ['FlatMap', SOURCE, 'twice']]))).toBe(
      '["List",1,1,2,2]'
    );
  });

  test('ListFrom over the view is listed (LaTeX definition and call)', () => {
    expect(
      show(
        ce
          .parse(
            '\\operatorname{ListFrom}(\\operatorname{FlatMap}([1, 2], \\operatorname{twiceTex}))'
          )
          .evaluate()
      )
    ).toBe('["List",1,1,2,2]');
  });

  test('the view is finite and typed as with the inline literal', () => {
    const named = ce.box(['FlatMap', SOURCE, 'twice']);
    const inline = ce.box(['FlatMap', SOURCE, TWICE_LITERAL]);
    expect(named.isFiniteCollection).toBe(true);
    expect(inline.isFiniteCollection).toBe(true);
    expect(named.type.toString()).toBe('list<integer>');
    expect(inline.type.toString()).toBe('list<integer>');
  });

  test.each([
    ['ListFrom', '["List",1,1,2,2]'],
    ['Count', '4'],
    ['Length', '4'],
    ['Sum', '6'],
    ['Max', '2'],
  ])('%s over the view', (op, expected) => {
    expect(show(evaluate([op, ['FlatMap', SOURCE, 'twice']]))).toBe(expected);
    expect(show(evaluate([op, ['FlatMap', SOURCE, TWICE_LITERAL]]))).toBe(
      expected
    );
  });

  test('a view over the view is listed', () => {
    expect(
      show(
        evaluate([
          'ListFrom',
          ['Map', ['Function', ['Multiply', 'x', 10], 'x'], ['FlatMap', SOURCE, 'twice']],
        ])
      )
    ).toBe('["List",10,10,20,20]');
    expect(
      show(evaluate(['ListFrom', ['FlatMap', ['FlatMap', SOURCE, 'twice'], 'twice']]))
    ).toBe('["List",1,1,1,1,2,2,2,2]');
  });

  test('over a source with an absent cell, the type is that of the inline literal', () => {
    const engine = new ComputeEngine();
    engine
      .box(['Assign', 'twice', ['Function', ['List', 'x', 'x'], 'x']])
      .evaluate();
    engine.declare('l', 'list<integer | missing>');
    engine.box(['Assign', 'l', ['List', 1, 'Missing']]).evaluate();
    const named = engine.box(['FlatMap', 'l', 'twice']);
    const inline = engine.box(['FlatMap', 'l', TWICE_LITERAL]);
    expect(named.type.toString()).toBe('list<integer | missing>');
    expect(inline.type.toString()).toBe('list<integer | missing>');
    expect(show(named.evaluate({ materialization: true }))).toBe(
      '["List",1,1,"Missing","Missing"]'
    );
  });

  test('evaluateAsync lists the view', async () => {
    const x = await ce
      .box(['ListFrom', ['FlatMap', SOURCE, 'twice']])
      .evaluateAsync();
    expect(show(x)).toBe('["List",1,1,2,2]');
  });
});

describe('FlatMap with a callback whose result is a tuple', () => {
  test.each([
    ['inline literal', PAIR_LITERAL],
    ['named function', 'pair'],
  ])('%s', (_label, callback) => {
    const view = ce.box(['FlatMap', SOURCE, callback]);
    expect(view.isFiniteCollection).toBe(true);
    expect(show(evaluate(['ListFrom', ['FlatMap', SOURCE, callback]]))).toBe(
      '["List",1,1,2,2]'
    );
    expect(show(evaluate(['Count', ['FlatMap', SOURCE, callback]]))).toBe('4');
  });
});

// An empty source gives no inner result, so the view is empty and finite
// whatever the callback returns, also a callback whose result has no fixed
// length (`Range(1, x)`) or is infinite (`Range(1, ∞)`).
describe('FlatMap over an empty source', () => {
  test.each([
    ['open-length result', ['Function', ['Range', 1, 'x'], 'x']],
    ['infinite result', ['Function', ['Range', 1, 'PositiveInfinity'], 'x']],
    ['named function', 'twice'],
  ])('%s', (_label, callback) => {
    const view = ['FlatMap', ['List'], callback];
    expect(ce.box(view as any).isFiniteCollection).toBe(true);
    expect(show(evaluate(['ListFrom', view]))).toBe('["List"]');
    expect(show(evaluate(['Count', view]))).toBe('0');
    expect(show(evaluate(['Sum', view]))).toBe('0');
    expect(show(evaluate(['Reduce', view, 'Add', 0]))).toBe('0');
    expect(show(evaluate(['Max', view]))).toBe('"NaN"');
  });
});
