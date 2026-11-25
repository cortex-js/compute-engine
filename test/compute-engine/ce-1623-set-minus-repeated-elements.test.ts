import { ComputeEngine } from '../../src/compute-engine';

//
// CE-1623: the evaluated `SetMinus` of a source that is not a set (a symbol
// that holds a string or a list) kept each repeated element of the source,
// so `SetMinus(s)` with `s := "hello"` held `l` twice until it was evaluated
// a second time. The iterator and the count of the unevaluated form already
// kept the first occurrence only; the evaluated form now does the same.
//

const json = (ce: ComputeEngine, e: unknown) =>
  ce.expr(e as any).evaluate().json;

describe('CE-1623 SETMINUS OF A SOURCE WITH REPEATED ELEMENTS', () => {
  test('The characters of a text, at the first evaluation', () => {
    const ce = new ComputeEngine();
    ce.assign('s', ce.expr({ str: 'hello' }));
    const once = ce.expr(['SetMinus', 's']).evaluate();
    expect(once.json).toEqual([
      'Set',
      ['CharacterFrom', "'o'"],
      ['CharacterFrom', "'e'"],
      ['CharacterFrom', "'h'"],
      ['CharacterFrom', "'l'"],
    ]);
    expect(once.evaluate().json).toEqual(once.json);
  });

  test('A removed character, and a repeated character that stays', () => {
    const ce = new ComputeEngine();
    ce.assign('s', ce.expr({ str: 'hello' }));
    expect(json(ce, ['SetMinus', 's', ['Set', { str: 'h' }]])).toEqual([
      'Set',
      ['CharacterFrom', "'o'"],
      ['CharacterFrom', "'e'"],
      ['CharacterFrom', "'l'"],
    ]);
  });

  test('A symbol that holds a list with a repeated element', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.expr(['List', 1, 1, 2]));
    expect(json(ce, ['SetMinus', 'L'])).toEqual(['Set', 1, 2]);
    expect(json(ce, ['SetMinus', 'L', 2])).toEqual(['Set', 1]);
  });

  test('The evaluated set has as many elements as the count says', () => {
    const ce = new ComputeEngine();
    ce.assign('s', ce.expr({ str: 'banana' }));
    const expr = ce.expr(['SetMinus', 's']);
    expect(expr.count).toBe(3);
    expect(expr.evaluate().count).toBe(3);
  });
});
