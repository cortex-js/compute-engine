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

describe('Quantifier Evaluation', () => {
  describe('Symbolic Simplification', () => {
    it('should simplify ForAll with constant body', () => {
      expect(box(['ForAll', 'x', 'True'])).toMatchInlineSnapshot(`"True"`);
      expect(box(['ForAll', 'x', 'False'])).toMatchInlineSnapshot(`"False"`);
    });

    it('should simplify Exists with constant body', () => {
      expect(box(['Exists', 'x', 'True'])).toMatchInlineSnapshot(`"True"`);
      expect(box(['Exists', 'x', 'False'])).toMatchInlineSnapshot(`"False"`);
    });
  });

  describe('Finite Domain Evaluation', () => {
    it('should evaluate ForAll over finite sets', () => {
      // All elements > 0
      expect(
        box([
          'ForAll',
          ['Element', 'x', ['Set', 1, 2, 3]],
          ['Greater', 'x', 0],
        ])
      ).toMatchInlineSnapshot(`"True"`);

      // Not all elements > 2
      expect(
        box([
          'ForAll',
          ['Element', 'x', ['Set', 1, 2, 3]],
          ['Greater', 'x', 2],
        ])
      ).toMatchInlineSnapshot(`"False"`);
    });

    it('should evaluate Exists over finite sets', () => {
      // Some element > 2
      expect(
        box([
          'Exists',
          ['Element', 'x', ['Set', 1, 2, 3]],
          ['Greater', 'x', 2],
        ])
      ).toMatchInlineSnapshot(`"True"`);

      // No element > 5
      expect(
        box([
          'Exists',
          ['Element', 'x', ['Set', 1, 2, 3]],
          ['Greater', 'x', 5],
        ])
      ).toMatchInlineSnapshot(`"False"`);
    });

    it('should evaluate ExistsUnique over finite sets', () => {
      // Exactly one element = 2
      expect(
        box([
          'ExistsUnique',
          ['Element', 'x', ['Set', 1, 2, 3]],
          ['Equal', 'x', 2],
        ])
      ).toMatchInlineSnapshot(`"True"`);

      // Multiple elements > 1
      expect(
        box([
          'ExistsUnique',
          ['Element', 'x', ['Set', 1, 2, 3]],
          ['Greater', 'x', 1],
        ])
      ).toMatchInlineSnapshot(`"False"`);
    });

    it('should evaluate NotForAll and NotExists', () => {
      // Not all elements > 2 (negation of False = True)
      expect(
        box([
          'NotForAll',
          ['Element', 'x', ['Set', 1, 2, 3]],
          ['Greater', 'x', 2],
        ])
      ).toMatchInlineSnapshot(`"True"`);

      // Not exists element > 5 (negation of False = True)
      expect(
        box([
          'NotExists',
          ['Element', 'x', ['Set', 1, 2, 3]],
          ['Greater', 'x', 5],
        ])
      ).toMatchInlineSnapshot(`"True"`);
    });

    it('should evaluate over Range domains', () => {
      // All integers from 1 to 5 are > 0
      expect(
        box([
          'ForAll',
          ['Element', 'n', ['Range', 1, 5]],
          ['Greater', 'n', 0],
        ])
      ).toMatchInlineSnapshot(`"True"`);

      // Some integer from 1 to 5 equals 3
      expect(
        box([
          'Exists',
          ['Element', 'n', ['Range', 1, 5]],
          ['Equal', 'n', 3],
        ])
      ).toMatchInlineSnapshot(`"True"`);
    });
  });

  describe('Nested Quantifiers', () => {
    it('should evaluate nested ForAll over Cartesian product', () => {
      // All pairs (x,y) from {1,2}×{1,2} satisfy x+y > 0
      expect(
        box([
          'ForAll',
          ['Element', 'x', ['Set', 1, 2]],
          [
            'ForAll',
            ['Element', 'y', ['Set', 1, 2]],
            ['Greater', ['Add', 'x', 'y'], 0],
          ],
        ])
      ).toMatchInlineSnapshot(`"True"`);

      // Not all pairs satisfy x+y > 3 (1+1=2 fails)
      expect(
        box([
          'ForAll',
          ['Element', 'x', ['Set', 1, 2]],
          [
            'ForAll',
            ['Element', 'y', ['Set', 1, 2]],
            ['Greater', ['Add', 'x', 'y'], 3],
          ],
        ])
      ).toMatchInlineSnapshot(`"False"`);
    });

    it('should evaluate nested Exists over Cartesian product', () => {
      // Some pair (x,y) satisfies x+y = 4 (2+2)
      expect(
        box([
          'Exists',
          ['Element', 'x', ['Set', 1, 2]],
          [
            'Exists',
            ['Element', 'y', ['Set', 1, 2]],
            ['Equal', ['Add', 'x', 'y'], 4],
          ],
        ])
      ).toMatchInlineSnapshot(`"True"`);

      // No pair satisfies x+y = 5 (max is 4)
      expect(
        box([
          'Exists',
          ['Element', 'x', ['Set', 1, 2]],
          [
            'Exists',
            ['Element', 'y', ['Set', 1, 2]],
            ['Equal', ['Add', 'x', 'y'], 5],
          ],
        ])
      ).toMatchInlineSnapshot(`"False"`);
    });
  });
});

describe('CNF/DNF Conversion', () => {
  it('should convert to CNF', () => {
    // (A ∧ B) ∨ C → (A ∨ C) ∧ (B ∨ C)
    expect(
      box(['ToCNF', ['Or', ['And', 'A', 'B'], 'C']])
    ).toMatchInlineSnapshot(`(A || C) && (B || C)`);

    // A → B ≡ ¬A ∨ B (already in CNF)
    expect(box(['ToCNF', ['Implies', 'A', 'B']])).toMatchInlineSnapshot(
      `B || !A`
    );

    // ¬(A ∧ B) → ¬A ∨ ¬B (De Morgan)
    expect(
      box(['ToCNF', ['Not', ['And', 'A', 'B']]])
    ).toMatchInlineSnapshot(`!A || !B`);
  });

  it('should convert to DNF', () => {
    // (A ∨ B) ∧ C → (A ∧ C) ∨ (B ∧ C)
    expect(
      box(['ToDNF', ['And', ['Or', 'A', 'B'], 'C']])
    ).toMatchInlineSnapshot(`A && C || B && C`);

    // ¬(A ∨ B) → ¬A ∧ ¬B (De Morgan)
    expect(
      box(['ToDNF', ['Not', ['Or', 'A', 'B']]])
    ).toMatchInlineSnapshot(`!A && !B`);
  });

  it('should handle Equivalent', () => {
    // A ↔ B ≡ (¬A ∨ B) ∧ (¬B ∨ A) - order may vary
    expect(box(['ToCNF', ['Equivalent', 'A', 'B']])).toMatchInlineSnapshot(
      `(B || !A) && (A || !B)`
    );
  });

  it('should simplify constant expressions', () => {
    expect(box(['ToCNF', 'True'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['ToCNF', 'False'])).toMatchInlineSnapshot(`"False"`);
    expect(box(['ToDNF', 'True'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['ToDNF', 'False'])).toMatchInlineSnapshot(`"False"`);
  });
});
