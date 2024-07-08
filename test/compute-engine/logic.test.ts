import { engine as ce } from '../utils';

function box(expr: any) {
  return ce.box(expr).evaluate().toString();
}

describe('Logic', () => {
  it('should evaluate True and False', () => {
    expect(box('True')).toMatchInlineSnapshot(`"True"`);
    expect(box('False')).toMatchInlineSnapshot(`"False"`);
  });

  it('should evaluate Not', () => {
    expect(box(['Not', 'True'])).toMatchInlineSnapshot(`"False"`);
    expect(box(['Not', 'False'])).toMatchInlineSnapshot(`"True"`);
  });

  it('should evaluate And', () => {
    expect(box(['And', 'True', 'True'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['And', 'True', 'False'])).toMatchInlineSnapshot(`"False"`);
    expect(box(['And', 'False', 'True'])).toMatchInlineSnapshot(`"False"`);
    expect(box(['And', 'False', 'False'])).toMatchInlineSnapshot(`"False"`);
  });
  it('should evaluate Or', () => {
    expect(box(['Or', 'True', 'True'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['Or', 'True', 'False'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['Or', 'False', 'True'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['Or', 'False', 'False'])).toMatchInlineSnapshot(`"False"`);
  });

  it('should evaluate Implies', () => {
    expect(box(['Implies', 'True', 'True'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['Implies', 'True', 'False'])).toMatchInlineSnapshot(`"False"`);
    expect(box(['Implies', 'False', 'True'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['Implies', 'False', 'False'])).toMatchInlineSnapshot(`"True"`);
  });

  it('should evaluate Equivalent', () => {
    expect(box(['Equivalent', 'True', 'True'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['Equivalent', 'True', 'False'])).toMatchInlineSnapshot(
      `"False"`
    );
    expect(box(['Equivalent', 'False', 'True'])).toMatchInlineSnapshot(
      `"False"`
    );
    expect(box(['Equivalent', 'False', 'False'])).toMatchInlineSnapshot(
      `"True"`
    );
  });
});

describe('Kronecker Delta', () => {
  it('should evaluate Kronecker Delta with one argument', () => {
    expect(box(['KroneckerDelta', 1])).toMatchInlineSnapshot(`0`);
    expect(box(['KroneckerDelta', 0])).toMatchInlineSnapshot(`0`);
  });
  it('should evaluate Kronecker Delta with two arguments', () => {
    expect(box(['KroneckerDelta', 1, 1])).toMatchInlineSnapshot(`1`);
    expect(box(['KroneckerDelta', 1, 2])).toMatchInlineSnapshot(`0`);
  });
  it('should evaluate Kronecker Delta with more than two arguments', () => {
    expect(box(['KroneckerDelta', 5, 5, 5])).toMatchInlineSnapshot(`1`);
    expect(box(['KroneckerDelta', 5, 3, 5])).toMatchInlineSnapshot(`0`);
  });
});

describe('Iverson Bracket', () => {
  it('should evaluate Iverson Bracket', () => {
    expect(box(['Boole', ['Equal', 1, 1]])).toMatchInlineSnapshot(`1`);
    expect(box(['Boole', ['Equal', 1, 2]])).toMatchInlineSnapshot(`0`);
  });
});
