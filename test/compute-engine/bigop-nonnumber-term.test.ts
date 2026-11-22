import { ComputeEngine } from '../../src/compute-engine';

/**
 * A `Sum` or a `Product` with no indexing set and one term that has no free
 * variable is its own value only when the term can be a number (CE-961).
 */
function engine() {
  const ce = new ComputeEngine();
  ce.declareType('subset', 'expression');
  ce.declare('Subset', '(integer, list<integer>) -> subset');
  return ce;
}

const show = (e: { json: unknown }) => JSON.stringify(e.json);

describe('a big op over one term that is not a number', () => {
  test.each(['Sum', 'Product'])(
    '%s of an opaque value stays unevaluated',
    (op) => {
      const ce = engine();
      const expr = ce.box([op, ['Subset', 5, ['List', 1, 3, 4]]]);
      const json = `["${op}",["Subset",5,["List",1,3,4]]]`;
      expect(show(expr.evaluate())).toBe(json);
      expect(show(expr.N())).toBe(json);
    }
  );

  test('Sum and Product of True agree', () => {
    const ce = engine();
    const sum = ce.box(['Sum', 'True']);
    const product = ce.box(['Product', 'True']);
    expect(show(sum.evaluate())).toBe('["Sum","True"]');
    expect(show(product.evaluate())).toBe('["Product","True"]');
  });

  test('a symbol of the opaque type stays unevaluated', () => {
    const ce = engine();
    ce.declare('q', 'subset');
    expect(show(ce.box(['Sum', 'q']).evaluate())).toBe('["Sum","q"]');
    expect(show(ce.box(['Product', 'q']).evaluate())).toBe('["Product","q"]');
  });

  test('a call that returns a string stays unevaluated', () => {
    const ce = engine();
    ce.declare('g', '() -> string');
    expect(show(ce.box(['Sum', ['g']]).evaluate())).toBe('["Sum",["g"]]');
  });
});

describe('a big op over one term that can be a number', () => {
  test.each([
    [['Sum', 7], '7'],
    [['Product', 7], '7'],
    [['Sum', 'Pi'], 'pi'],
    [['Product', 'Pi'], 'pi'],
    [['Sum', ['Sin', 2]], 'sin(2)'],
    [['Sum', ['Complex', 1, 1]], '(1 + i)'],
    [['Sum', 'Missing'], '"Missing"'],
    [['Product', 'Missing'], '"Missing"'],
    [['Sum', ['Tuple', 1, 2]], '3'],
  ])('%j', (json, text) => {
    const ce = engine();
    expect(
      ce
        .box(json as any)
        .evaluate()
        .toString()
    ).toBe(text);
  });

  test('a free variable stays unevaluated', () => {
    const ce = engine();
    expect(show(ce.box(['Sum', 'x']).evaluate())).toBe('["Sum","x"]');
    expect(show(ce.box(['Product', 'x']).evaluate())).toBe('["Product","x"]');
  });
});
