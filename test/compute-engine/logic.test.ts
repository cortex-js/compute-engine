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

  it('should evaluate Xor', () => {
    expect(box(['Xor', 'True', 'True'])).toMatchInlineSnapshot(`"False"`);
    expect(box(['Xor', 'True', 'False'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['Xor', 'False', 'True'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['Xor', 'False', 'False'])).toMatchInlineSnapshot(`"False"`);
  });

  it('should evaluate Nand', () => {
    expect(box(['Nand', 'True', 'True'])).toMatchInlineSnapshot(`"False"`);
    expect(box(['Nand', 'True', 'False'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['Nand', 'False', 'True'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['Nand', 'False', 'False'])).toMatchInlineSnapshot(`"True"`);
  });

  it('should evaluate Nor', () => {
    expect(box(['Nor', 'True', 'True'])).toMatchInlineSnapshot(`"False"`);
    expect(box(['Nor', 'True', 'False'])).toMatchInlineSnapshot(`"False"`);
    expect(box(['Nor', 'False', 'True'])).toMatchInlineSnapshot(`"False"`);
    expect(box(['Nor', 'False', 'False'])).toMatchInlineSnapshot(`"True"`);
  });

  // N-ary operator tests
  it('should evaluate n-ary Xor (parity)', () => {
    // XOR with 3 arguments: true when odd number are true
    expect(box(['Xor', 'True', 'True', 'True'])).toMatchInlineSnapshot(
      `"True"`
    );
    expect(box(['Xor', 'True', 'True', 'False'])).toMatchInlineSnapshot(
      `"False"`
    );
    expect(box(['Xor', 'True', 'False', 'False'])).toMatchInlineSnapshot(
      `"True"`
    );
    expect(box(['Xor', 'False', 'False', 'False'])).toMatchInlineSnapshot(
      `"False"`
    );
  });

  it('should evaluate n-ary Nand', () => {
    // NAND is NOT(AND(...))
    expect(box(['Nand', 'True', 'True', 'True'])).toMatchInlineSnapshot(
      `"False"`
    );
    expect(box(['Nand', 'True', 'True', 'False'])).toMatchInlineSnapshot(
      `"True"`
    );
    expect(box(['Nand', 'False', 'False', 'False'])).toMatchInlineSnapshot(
      `"True"`
    );
  });

  it('should evaluate n-ary Nor', () => {
    // NOR is NOT(OR(...))
    expect(box(['Nor', 'False', 'False', 'False'])).toMatchInlineSnapshot(
      `"True"`
    );
    expect(box(['Nor', 'True', 'False', 'False'])).toMatchInlineSnapshot(
      `"False"`
    );
    expect(box(['Nor', 'True', 'True', 'True'])).toMatchInlineSnapshot(
      `"False"`
    );
  });

  // Partial evaluation tests
  it('should partially evaluate Xor with symbolic arguments', () => {
    // XOR(True, x) = NOT(x)
    expect(box(['Xor', 'True', 'A'])).toMatchInlineSnapshot(`!A`);
    // XOR(False, x) = x
    expect(box(['Xor', 'False', 'A'])).toMatchInlineSnapshot(`A`);
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
        box(['ForAll', ['Element', 'x', ['Set', 1, 2, 3]], ['Greater', 'x', 0]])
      ).toMatchInlineSnapshot(`"True"`);

      // Not all elements > 2
      expect(
        box(['ForAll', ['Element', 'x', ['Set', 1, 2, 3]], ['Greater', 'x', 2]])
      ).toMatchInlineSnapshot(`"False"`);
    });

    it('should evaluate Exists over finite sets', () => {
      // Some element > 2
      expect(
        box(['Exists', ['Element', 'x', ['Set', 1, 2, 3]], ['Greater', 'x', 2]])
      ).toMatchInlineSnapshot(`"True"`);

      // No element > 5
      expect(
        box(['Exists', ['Element', 'x', ['Set', 1, 2, 3]], ['Greater', 'x', 5]])
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
        box(['ForAll', ['Element', 'n', ['Range', 1, 5]], ['Greater', 'n', 0]])
      ).toMatchInlineSnapshot(`"True"`);

      // Some integer from 1 to 5 equals 3
      expect(
        box(['Exists', ['Element', 'n', ['Range', 1, 5]], ['Equal', 'n', 3]])
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
      `!A || B`
    );

    // ¬(A ∧ B) → ¬A ∨ ¬B (De Morgan)
    expect(box(['ToCNF', ['Not', ['And', 'A', 'B']]])).toMatchInlineSnapshot(
      `!A || !B`
    );
  });

  it('should convert to DNF', () => {
    // (A ∨ B) ∧ C → (A ∧ C) ∨ (B ∧ C)
    expect(
      box(['ToDNF', ['And', ['Or', 'A', 'B'], 'C']])
    ).toMatchInlineSnapshot(`A && C || B && C`);

    // ¬(A ∨ B) → ¬A ∧ ¬B (De Morgan)
    expect(box(['ToDNF', ['Not', ['Or', 'A', 'B']]])).toMatchInlineSnapshot(
      `!A && !B`
    );
  });

  it('should handle Equivalent', () => {
    // A ↔ B ≡ (¬A ∨ B) ∧ (¬B ∨ A) - order may vary
    expect(box(['ToCNF', ['Equivalent', 'A', 'B']])).toMatchInlineSnapshot(
      `(!A || B) && (!B || A)`
    );
  });

  it('should handle Xor', () => {
    // A ⊕ B ≡ (A ∨ B) ∧ (¬A ∨ ¬B) in CNF
    expect(box(['ToCNF', ['Xor', 'A', 'B']])).toMatchInlineSnapshot(
      `(A || B) && (!A || !B)`
    );

    // A ⊕ B ≡ (A ∧ ¬B) ∨ (¬A ∧ B) in DNF
    expect(box(['ToDNF', ['Xor', 'A', 'B']])).toMatchInlineSnapshot(
      `!B && A || !A && B`
    );
  });

  it('should simplify constant expressions', () => {
    expect(box(['ToCNF', 'True'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['ToCNF', 'False'])).toMatchInlineSnapshot(`"False"`);
    expect(box(['ToDNF', 'True'])).toMatchInlineSnapshot(`"True"`);
    expect(box(['ToDNF', 'False'])).toMatchInlineSnapshot(`"False"`);
  });

  it('should handle Nand', () => {
    // NAND(A, B) ≡ ¬(A ∧ B) ≡ ¬A ∨ ¬B in CNF
    expect(box(['ToCNF', ['Nand', 'A', 'B']])).toMatchInlineSnapshot(
      `!A || !B`
    );
    // In DNF it's the same (already in DNF form)
    expect(box(['ToDNF', ['Nand', 'A', 'B']])).toMatchInlineSnapshot(
      `!A || !B`
    );
  });

  it('should handle Nor', () => {
    // NOR(A, B) ≡ ¬(A ∨ B) ≡ ¬A ∧ ¬B in CNF
    expect(box(['ToCNF', ['Nor', 'A', 'B']])).toMatchInlineSnapshot(`!A && !B`);
    // In DNF it's the same (already in DNF form)
    expect(box(['ToDNF', ['Nor', 'A', 'B']])).toMatchInlineSnapshot(`!A && !B`);
  });

  it('should handle n-ary operators in CNF/DNF', () => {
    // n-ary XOR - order of clauses may vary (AND is commutative)
    expect(box(['ToCNF', ['Xor', 'A', 'B', 'C']])).toMatchInlineSnapshot(
      `(A || B || C) && (!A || !B || C) && (!B || A || !C) && (!A || B || !C)`
    );
    // n-ary NAND
    expect(box(['ToCNF', ['Nand', 'A', 'B', 'C']])).toMatchInlineSnapshot(
      `!A || !B || !C`
    );
    // n-ary NOR
    expect(box(['ToCNF', ['Nor', 'A', 'B', 'C']])).toMatchInlineSnapshot(
      `!A && !B && !C`
    );
  });
});

describe('Satisfiability and Tautology', () => {
  it('should check satisfiability of simple expressions', () => {
    // True is satisfiable
    expect(box(['IsSatisfiable', 'True'])).toMatchInlineSnapshot(`"True"`);
    // False is not satisfiable
    expect(box(['IsSatisfiable', 'False'])).toMatchInlineSnapshot(`"False"`);
    // A single variable is satisfiable (can be True)
    expect(box(['IsSatisfiable', 'A'])).toMatchInlineSnapshot(`"True"`);
    // A AND NOT(A) is not satisfiable (contradiction)
    expect(
      box(['IsSatisfiable', ['And', 'A', ['Not', 'A']]])
    ).toMatchInlineSnapshot(`"False"`);
    // A OR NOT(A) is satisfiable (tautology)
    expect(
      box(['IsSatisfiable', ['Or', 'A', ['Not', 'A']]])
    ).toMatchInlineSnapshot(`"True"`);
  });

  it('should check satisfiability of complex expressions', () => {
    // (A AND B) is satisfiable
    expect(box(['IsSatisfiable', ['And', 'A', 'B']])).toMatchInlineSnapshot(
      `"True"`
    );
    // (A AND B AND NOT(A)) is not satisfiable
    expect(
      box(['IsSatisfiable', ['And', 'A', 'B', ['Not', 'A']]])
    ).toMatchInlineSnapshot(`"False"`);
  });

  it('should check if expressions are tautologies', () => {
    // True is a tautology
    expect(box(['IsTautology', 'True'])).toMatchInlineSnapshot(`"True"`);
    // False is not a tautology
    expect(box(['IsTautology', 'False'])).toMatchInlineSnapshot(`"False"`);
    // A single variable is not a tautology
    expect(box(['IsTautology', 'A'])).toMatchInlineSnapshot(`"False"`);
    // A OR NOT(A) is a tautology (law of excluded middle)
    expect(
      box(['IsTautology', ['Or', 'A', ['Not', 'A']]])
    ).toMatchInlineSnapshot(`"True"`);
    // A AND NOT(A) is not a tautology
    expect(
      box(['IsTautology', ['And', 'A', ['Not', 'A']]])
    ).toMatchInlineSnapshot(`"False"`);
  });

  it('should verify logical laws', () => {
    // Double negation: NOT(NOT(A)) ↔ A
    expect(
      box(['IsTautology', ['Equivalent', ['Not', ['Not', 'A']], 'A']])
    ).toMatchInlineSnapshot(`"True"`);
    // De Morgan: NOT(A AND B) ↔ (NOT(A) OR NOT(B))
    expect(
      box([
        'IsTautology',
        [
          'Equivalent',
          ['Not', ['And', 'A', 'B']],
          ['Or', ['Not', 'A'], ['Not', 'B']],
        ],
      ])
    ).toMatchInlineSnapshot(`"True"`);
    // Modus Ponens: ((A → B) AND A) → B
    expect(
      box([
        'IsTautology',
        ['Implies', ['And', ['Implies', 'A', 'B'], 'A'], 'B'],
      ])
    ).toMatchInlineSnapshot(`"True"`);
  });
});

describe('Logic Simplification Rules', () => {
  function simplify(expr: any) {
    return ce.box(expr).simplify().toString();
  }

  describe('Absorption', () => {
    it('should simplify A ∧ (A ∨ B) → A', () => {
      expect(simplify(['And', 'A', ['Or', 'A', 'B']])).toMatchInlineSnapshot(
        `A`
      );
    });

    it('should simplify A ∨ (A ∧ B) → A', () => {
      expect(simplify(['Or', 'A', ['And', 'A', 'B']])).toMatchInlineSnapshot(
        `A`
      );
    });

    it('should simplify (A ∨ B) ∧ A → A', () => {
      expect(simplify(['And', ['Or', 'A', 'B'], 'A'])).toMatchInlineSnapshot(
        `A`
      );
    });

    it('should simplify (A ∧ B) ∨ A → A', () => {
      expect(simplify(['Or', ['And', 'A', 'B'], 'A'])).toMatchInlineSnapshot(
        `A`
      );
    });

    it('should simplify complex absorption A ∧ B ∧ (A ∨ C) → A ∧ B', () => {
      expect(
        simplify(['And', 'A', 'B', ['Or', 'A', 'C']])
      ).toMatchInlineSnapshot(`A && B`);
    });

    it('should simplify complex absorption A ∨ B ∨ (A ∧ C) → A ∨ B', () => {
      expect(simplify(['Or', 'A', 'B', ['And', 'A', 'C']])).toMatchInlineSnapshot(
        `A || B`
      );
    });
  });

  describe('Idempotence', () => {
    it('should simplify A ∧ A → A', () => {
      expect(simplify(['And', 'A', 'A'])).toMatchInlineSnapshot(`A`);
    });

    it('should simplify A ∨ A → A', () => {
      expect(simplify(['Or', 'A', 'A'])).toMatchInlineSnapshot(`A`);
    });

    it('should simplify A ∧ A ∧ A → A', () => {
      expect(simplify(['And', 'A', 'A', 'A'])).toMatchInlineSnapshot(`A`);
    });
  });

  describe('Complementation', () => {
    it('should simplify A ∧ ¬A → False', () => {
      expect(simplify(['And', 'A', ['Not', 'A']])).toMatchInlineSnapshot(
        `"False"`
      );
    });

    it('should simplify A ∨ ¬A → True', () => {
      expect(simplify(['Or', 'A', ['Not', 'A']])).toMatchInlineSnapshot(
        `"True"`
      );
    });
  });

  describe('Identity', () => {
    it('should simplify A ∧ True → A', () => {
      expect(simplify(['And', 'A', 'True'])).toMatchInlineSnapshot(`A`);
    });

    it('should simplify A ∨ False → A', () => {
      expect(simplify(['Or', 'A', 'False'])).toMatchInlineSnapshot(`A`);
    });
  });

  describe('Domination', () => {
    it('should simplify A ∧ False → False', () => {
      expect(simplify(['And', 'A', 'False'])).toMatchInlineSnapshot(`"False"`);
    });

    it('should simplify A ∨ True → True', () => {
      expect(simplify(['Or', 'A', 'True'])).toMatchInlineSnapshot(`"True"`);
    });
  });

  describe('Double Negation', () => {
    it('should simplify ¬¬A → A', () => {
      expect(simplify(['Not', ['Not', 'A']])).toMatchInlineSnapshot(`A`);
    });

    it('should simplify ¬¬¬A → ¬A', () => {
      expect(simplify(['Not', ['Not', ['Not', 'A']]])).toMatchInlineSnapshot(
        `!A`
      );
    });
  });
});

describe('Truth Table Generation', () => {
  it('should generate truth table for simple expressions', () => {
    const result = ce.box(['TruthTable', 'A']).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[["A","Result"],["False","False"],["True","True"]]`
    );
  });

  it('should generate truth table for And', () => {
    const result = ce.box(['TruthTable', ['And', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[["A","B","Result"],["False","False","False"],["False","True","False"],["True","False","False"],["True","True","True"]]`
    );
  });

  it('should generate truth table for Or', () => {
    const result = ce.box(['TruthTable', ['Or', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[["A","B","Result"],["False","False","False"],["False","True","True"],["True","False","True"],["True","True","True"]]`
    );
  });

  it('should generate truth table for Xor', () => {
    const result = ce.box(['TruthTable', ['Xor', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[["A","B","Result"],["False","False","False"],["False","True","True"],["True","False","True"],["True","True","False"]]`
    );
  });

  it('should generate truth table for Implies', () => {
    const result = ce.box(['TruthTable', ['Implies', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[["A","B","Result"],["False","False","True"],["False","True","True"],["True","False","False"],["True","True","True"]]`
    );
  });
});
