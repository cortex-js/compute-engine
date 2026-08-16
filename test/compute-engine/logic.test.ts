import { engine as ce } from '../utils';

function box(expr: any) {
  return ce.expr(expr).evaluate().toString();
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

  it('should cancel repeated Xor operands (a ⊕ a = False)', () => {
    // Uppercase boolean symbols avoid retyping x/y/z used by later
    // arithmetic-sensitive tests in this shared engine.
    // Xor(Xor(A, B), B) → A
    expect(box(['Xor', ['Xor', 'A', 'B'], 'B'])).toMatchInlineSnapshot(`A`);
    // Even multiplicity cancels to False
    expect(box(['Xor', 'A', 'A'])).toMatchInlineSnapshot(`"False"`);
    // Odd multiplicity leaves one survivor
    expect(box(['Xor', 'A', 'A', 'A'])).toMatchInlineSnapshot(`A`);
    // Distinct operands are preserved
    expect(box(['Xor', 'A', 'B'])).toMatchInlineSnapshot(`Xor(A, B)`);
    // Multiple pairs cancel, distinct survivors remain
    expect(box(['Xor', 'A', 'B', 'B', 'C'])).toMatchInlineSnapshot(`Xor(A, C)`);
    expect(box(['Xor', 'A', 'A', 'B', 'B'])).toMatchInlineSnapshot(`"False"`);
    // Cancellation composes with a True operand: Xor(True, A, A) = True
    expect(box(['Xor', 'True', 'A', 'A'])).toMatchInlineSnapshot(`"True"`);
  });
});

describe('Kronecker Delta', () => {
  // CORRECTNESS_FINDINGS.md CR-P1-3: unary KroneckerDelta(n) = δ_{n,0}, so
  // KroneckerDelta(0) = 1 (standard convention; matches Mathematica).
  it('should evaluate Kronecker Delta with one argument', () => {
    expect(box(['KroneckerDelta', 1])).toMatchInlineSnapshot(`0`);
    expect(box(['KroneckerDelta', 0])).toMatchInlineSnapshot(`1`);
    expect(box(['KroneckerDelta', 3])).toMatchInlineSnapshot(`0`);
  });
  it('Kronecker Delta of a free symbol stays symbolic', () => {
    expect(box(['KroneckerDelta', 'x'])).toMatchInlineSnapshot(
      `KroneckerDelta(x)`
    );
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
    return ce.expr(expr).simplify().toString();
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
      expect(
        simplify(['Or', 'A', 'B', ['And', 'A', 'C']])
      ).toMatchInlineSnapshot(`A || B`);
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
    const result = ce.expr(['TruthTable', 'A']).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[["A","Result"],["False","False"],["True","True"]]`
    );
  });

  it('should generate truth table for And', () => {
    const result = ce.expr(['TruthTable', ['And', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[["A","B","Result"],["False","False","False"],["False","True","False"],["True","False","False"],["True","True","True"]]`
    );
  });

  it('should generate truth table for Or', () => {
    const result = ce.expr(['TruthTable', ['Or', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[["A","B","Result"],["False","False","False"],["False","True","True"],["True","False","True"],["True","True","True"]]`
    );
  });

  it('should generate truth table for Xor', () => {
    const result = ce.expr(['TruthTable', ['Xor', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[["A","B","Result"],["False","False","False"],["False","True","True"],["True","False","True"],["True","True","False"]]`
    );
  });

  it('should generate truth table for Implies', () => {
    const result = ce.expr(['TruthTable', ['Implies', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[["A","B","Result"],["False","False","True"],["False","True","True"],["True","False","False"],["True","True","True"]]`
    );
  });
});

describe('Prime Implicants and Minimal Forms', () => {
  it('should find prime implicants for simple expressions', () => {
    // A AND B has one prime implicant: A ∧ B
    const result = ce.expr(['PrimeImplicants', ['And', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[A && B]`);
  });

  it('should find prime implicants for OR', () => {
    // A OR B has two prime implicants: A and B
    const result = ce.expr(['PrimeImplicants', ['Or', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[B,A]`);
  });

  it('should find prime implicants that simplify', () => {
    // AB ∨ A¬B = A (combining two minterms into one prime implicant)
    const result = ce
      .expr([
        'PrimeImplicants',
        ['Or', ['And', 'A', 'B'], ['And', 'A', ['Not', 'B']]],
      ])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[A]`);
  });

  it('should find prime implicants for tautology', () => {
    // A ∨ ¬A is True, so the only prime implicant is True
    const result = ce
      .expr(['PrimeImplicants', ['Or', 'A', ['Not', 'A']]])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["True"]`);
  });

  it('should find prime implicants for contradiction', () => {
    // A ∧ ¬A is False, so there are no prime implicants
    const result = ce
      .expr(['PrimeImplicants', ['And', 'A', ['Not', 'A']]])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[]`);
  });

  it('should find prime implicates for simple expressions', () => {
    // A AND B: the prime implicates are A and B (clauses that must be true)
    const result = ce.expr(['PrimeImplicates', ['And', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[A,B]`);
  });

  it('should find prime implicates for OR', () => {
    // A OR B has one prime implicate: A ∨ B
    const result = ce.expr(['PrimeImplicates', ['Or', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[A || B]`);
  });

  it('should compute minimal DNF', () => {
    // AB ∨ A¬B ∨ ¬AB simplifies to A ∨ B
    // (covers minterms 01, 10, 11 = A∨B)
    const result = ce
      .expr([
        'MinimalDNF',
        [
          'Or',
          ['And', 'A', 'B'],
          ['And', 'A', ['Not', 'B']],
          ['And', ['Not', 'A'], 'B'],
        ],
      ])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`B || A`);
  });

  it('should compute minimal DNF for simple AND', () => {
    // A ∧ B is already minimal
    const result = ce.expr(['MinimalDNF', ['And', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`A && B`);
  });

  it('should compute minimal DNF for tautology', () => {
    const result = ce
      .expr(['MinimalDNF', ['Or', 'A', ['Not', 'A']]])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`"True"`);
  });

  it('should compute minimal DNF for contradiction', () => {
    const result = ce
      .expr(['MinimalDNF', ['And', 'A', ['Not', 'A']]])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`"False"`);
  });

  it('should compute minimal CNF', () => {
    // (A ∨ B) ∧ (A ∨ ¬B) simplifies to A
    const result = ce
      .expr([
        'MinimalCNF',
        ['And', ['Or', 'A', 'B'], ['Or', 'A', ['Not', 'B']]],
      ])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`A`);
  });

  it('should compute minimal CNF for simple OR', () => {
    // A ∨ B is already a single clause
    const result = ce.expr(['MinimalCNF', ['Or', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`A || B`);
  });

  it('should compute minimal CNF for tautology', () => {
    const result = ce
      .expr(['MinimalCNF', ['Or', 'A', ['Not', 'A']]])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`"True"`);
  });

  it('should compute minimal CNF for contradiction', () => {
    const result = ce
      .expr(['MinimalCNF', ['And', 'A', ['Not', 'A']]])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`"False"`);
  });

  it('should handle three variables', () => {
    // (A ∧ B ∧ C) ∨ (A ∧ B ∧ ¬C) = A ∧ B
    const result = ce
      .expr([
        'MinimalDNF',
        ['Or', ['And', 'A', 'B', 'C'], ['And', 'A', 'B', ['Not', 'C']]],
      ])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`A && B`);
  });

  it('should find prime implicants for XOR', () => {
    // A XOR B = (A ∧ ¬B) ∨ (¬A ∧ B) - two prime implicants
    const result = ce.expr(['PrimeImplicants', ['Xor', 'A', 'B']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[!A && B,A && !B]`);
  });
});

// REVIEW.md B19: KroneckerDelta/Boole mapped *undetermined* comparisons to 0;
// they must stay symbolic when equality/truth cannot be decided.
describe('KroneckerDelta / Boole stay symbolic when undetermined (REVIEW.md B19)', () => {
  it('KroneckerDelta of free symbols is symbolic', () => {
    expect(box(['KroneckerDelta', 'x', 'y'])).toMatchInlineSnapshot(
      `KroneckerDelta(x, y)`
    );
    expect(box(['KroneckerDelta', 'x', 'y', 'z'])).toMatchInlineSnapshot(
      `KroneckerDelta(x, y, z)`
    );
  });
  it('KroneckerDelta still resolves decidable cases', () => {
    expect(box(['KroneckerDelta', 'x', 'x'])).toBe('1');
    expect(box(['KroneckerDelta', 'x', ['Add', 'x', 1]])).toBe('0');
    expect(box(['KroneckerDelta', 2, 2])).toBe('1');
    expect(box(['KroneckerDelta', 2, 3])).toBe('0');
  });
  it('Boole of an undetermined predicate is symbolic', () => {
    expect(box(['Boole', ['Greater', 'x', 3]])).toMatchInlineSnapshot(
      `Boole(3 < x)`
    );
    expect(box(['Boole', 'True'])).toBe('1');
    expect(box(['Boole', 'False'])).toBe('0');
  });
});

describe('And/Or are SHORT-CIRCUIT forms (fixed 2026-08-15)', () => {
  // `And`/`Or` evaluate their operands left to right, in the order written,
  // and stop at the first operand that decides the result. Before this they
  // were declared eager and commutative: every operand was evaluated, and
  // canonicalization SORTED them, so `Or(F(), G())` could run `G` first.
  // Each witness below is a function that logs its own name when it runs, so
  // `calls` spells out which operands ran and in what order.
  const { ComputeEngine } = require('../../src/compute-engine');
  const sc = new ComputeEngine();
  let calls: string[] = [];
  sc.declare('scT', {
    signature: '() -> boolean',
    evaluate: () => {
      calls.push('T');
      return sc.True;
    },
  });
  sc.declare('scF', {
    signature: '() -> boolean',
    evaluate: () => {
      calls.push('F');
      return sc.False;
    },
  });
  const run = (json: any): any => {
    calls = [];
    return sc.expr(json).evaluate().json;
  };

  it('operands are NOT reordered at canonicalization', () => {
    expect(sc.expr(['And', 'q', 'p', 'a']).json).toEqual([
      'And',
      'q',
      'p',
      'a',
    ]);
    expect(sc.expr(['Or', 'q', 'p']).json).toEqual(['Or', 'q', 'p']);
    // Nested same-operator operands are still flattened, in written order.
    expect(sc.expr(['And', ['And', 'b', 'a'], 'c']).json).toEqual([
      'And',
      'b',
      'a',
      'c',
    ]);
    // Every operator that short-circuits keeps its written order, for the
    // same reason: the `commutative` flag sorts the operands, and the
    // short-circuit is defined over the order as written.
    expect(sc.expr(['Nand', 'q', 'p']).json).toEqual(['Nand', 'q', 'p']);
    expect(sc.expr(['Nor', 'q', 'p']).json).toEqual(['Nor', 'q', 'p']);
    // `Xor` cannot short-circuit — every operand affects the result — so it
    // keeps the flag and still sorts. This is the contrast that makes the
    // rule above a consequence of short-circuiting rather than a blanket
    // change to the logical operators.
    expect(sc.expr(['Xor', 'q', 'p']).json).toEqual(['Xor', 'p', 'q']);
  });

  it('And stops at the first False; the rest never runs', () => {
    expect(run(['And', 'False', ['scT']])).toBe('False');
    expect(calls).toEqual([]);
    expect(run(['And', ['scF'], ['scT']])).toBe('False');
    expect(calls).toEqual(['F']);
    expect(run(['And', ['scT'], ['scF'], ['scT']])).toBe('False');
    expect(calls).toEqual(['T', 'F']);
    // No decider: every operand runs, left to right.
    expect(run(['And', ['scT'], ['scT']])).toBe('True');
    expect(calls).toEqual(['T', 'T']);
  });

  it('Or stops at the first True; the rest never runs', () => {
    expect(run(['Or', 'True', ['scF']])).toBe('True');
    expect(calls).toEqual([]);
    expect(run(['Or', ['scT'], ['scF']])).toBe('True');
    expect(calls).toEqual(['T']);
    expect(run(['Or', ['scF'], ['scT'], ['scF']])).toBe('True');
    expect(calls).toEqual(['F', 'T']);
    expect(run(['Or', ['scF'], ['scF']])).toBe('False');
    expect(calls).toEqual(['F', 'F']);
  });

  it('a guarded read is never evaluated when the guard fails', () => {
    sc.assign('scXs', sc.expr(['List', 1, 2, 3]));
    sc.assign('scK', 5);
    expect(
      run([
        'And',
        ['LessEqual', 'scK', 3],
        ['Greater', ['At', 'scXs', 'scK'], 0],
      ])
    ).toBe('False');
    sc.assign('scK', 2);
    expect(
      run([
        'And',
        ['LessEqual', 'scK', 3],
        ['Greater', ['At', 'scXs', 'scK'], 0],
      ])
    ).toBe('True');
  });

  it('operand types are still validated at canonicalization', () => {
    // The lazy route bypasses the framework validation; the canonical handler
    // runs it itself.
    expect(sc.expr(['And', 1, 2]).isValid).toBe(false);
    expect(sc.expr(['Or', 'True', 'False']).isValid).toBe(true);
  });

  it('an operand that evaluates to an error stops the walk, like a decider', () => {
    // `Error` is as final as `False`: evaluating past it would run the
    // operands the failed one was guarding.
    const r = run(['And', 'True', ['Error', "'x'"], ['scT']]);
    expect(r[0]).toBe('Error');
    expect(calls).toEqual([]);
  });

  it('the async route awaits async-only operands and short-circuits too', async () => {
    sc.declare('scAT', {
      signature: '() -> boolean',
      evaluateAsync: async () => {
        calls.push('AT');
        return sc.True;
      },
    });
    calls = [];
    expect(
      (await sc.expr(['And', ['scAT'], ['scF'], ['scAT']]).evaluateAsync()).json
    ).toBe('False');
    expect(calls).toEqual(['AT', 'F']);
    calls = [];
    expect(
      (await sc.expr(['Or', ['scF'], ['scAT'], ['scF']]).evaluateAsync()).json
    ).toBe('True');
    expect(calls).toEqual(['F', 'AT']);
  });

  it('an element-wise application evaluates every operand: the shape follows the TYPES', () => {
    // A collection-shaped operand (by type) makes the application element-wise
    // and the result a list — so it cannot short-circuit past the collection,
    // whichever way the collection is spelled: literal, symbol-bound, or the
    // value of a call. Every operand runs once, left to right.
    sc.declare('scL', {
      signature: '() -> list<boolean>',
      evaluate: () => {
        calls.push('L');
        return sc.expr(['List', 'True', 'False']);
      },
    });
    sc.assign('scXs', sc.expr(['List', 'True', 'False']));
    expect(run(['And', 'False', ['List', 'True', 'False']])).toEqual([
      'List',
      'False',
      'False',
    ]);
    expect(run(['And', 'False', 'scXs'])).toEqual(['List', 'False', 'False']);
    expect(run(['And', 'False', ['scL']])).toEqual(['List', 'False', 'False']);
    expect(calls).toEqual(['L']);
    expect(sc.expr(['And', 'False', ['scL']]).type.toString()).toBe(
      'list<boolean>'
    );
    expect(run(['Or', ['scT'], ['scL']])).toEqual(['List', 'True', 'True']);
    expect(calls).toEqual(['T', 'L']);
    // A tuple is atomic, not a broadcast source; an `unknown`-typed operand
    // is not collection-shaped and does not defeat short-circuiting.
    expect(run(['And', 'False', ['scUndeclaredFn']])).toBe('False');
  });

  it('Nand/Nor/Implies short-circuit the same way (ruled 2026-08-15)', () => {
    // `Nand` = ¬And: stops at the first False (→ True); `Nor` = ¬Or: stops at
    // the first True (→ False); `Implies`: a False antecedent decides (→ True)
    // without evaluating the consequent. None is reordered.
    expect(run(['Nand', ['scF'], ['scT']])).toBe('True');
    expect(calls).toEqual(['F']);
    expect(run(['Nand', ['scT'], ['scT']])).toBe('False');
    expect(calls).toEqual(['T', 'T']);
    expect(run(['Nor', ['scT'], ['scF']])).toBe('False');
    expect(calls).toEqual(['T']);
    expect(run(['Nor', ['scF'], ['scF']])).toBe('True');
    expect(calls).toEqual(['F', 'F']);
    expect(run(['Implies', ['scF'], ['scT']])).toBe('True');
    expect(calls).toEqual(['F']);
    expect(run(['Implies', ['scT'], ['scF']])).toBe('False');
    expect(calls).toEqual(['T', 'F']);
    expect(sc.expr(['Nor', 'q', 'p']).json).toEqual(['Nor', 'q', 'p']);
    // Kleene over absence, as for And/Or: a decider wins, else Missing.
    expect(run(['Nand', 'True', 'Missing'])).toBe('Missing');
    expect(run(['Nand', 'Missing', 'False'])).toBe('True');
    expect(run(['Nor', 'False', 'Missing'])).toBe('Missing');
    expect(run(['Implies', 'True', 'Missing'])).toBe('Missing');
    expect(run(['Implies', 'Missing', 'False'])).toBe('Missing');
    expect(sc.expr(['Implies', 'Missing', 'True']).isValid).toBe(true);
    // `Nand`/`Nor` are NOT associative, so nesting is kept, unlike And/Or.
    expect(sc.expr(['Nand', ['Nand', 'a', 'b'], 'c']).json).toEqual([
      'Nand',
      ['Nand', 'a', 'b'],
      'c',
    ]);
  });

  it('collection-valued operands still broadcast element-wise', () => {
    expect(
      run(['And', ['List', 'True', 'False'], ['List', 'True', 'True']])
    ).toEqual(['List', 'True', 'False']);
    sc.assign('scBs', sc.expr(['List', 'True', 'False']));
    // The collection only appears once the symbol is evaluated.
    expect(run(['And', 'scBs', 'True'])).toEqual(['List', 'True', 'False']);
    expect(run(['Or', 'scBs', ['List', 'False', 'False']])).toEqual([
      'List',
      'True',
      'False',
    ]);
  });

  it('Kleene over absence is unchanged: a deciding operand wins, Missing propagates', () => {
    expect(run(['And', 'Missing', 'False'])).toBe('False');
    expect(run(['And', 'True', 'Missing'])).toBe('Missing');
    expect(run(['Or', 'Missing', 'True'])).toBe('True');
    expect(run(['Or', 'False', 'Missing'])).toBe('Missing');
  });

  it('symbolic simplifications are order-independent and still fire', () => {
    expect(run(['And', 'p', ['Not', 'p']])).toBe('False');
    expect(run(['Or', ['Not', 'p'], 'p'])).toBe('True');
    expect(run(['Or', 'p', ['And', 'p', 'q']])).toBe('p');
    expect(run(['And', 'p', ['Or', 'q', 'p']])).toBe('p');
    // Hidden one level down (as `toCNF`'s distribution builds them).
    expect(run(['Or', ['Not', 'A'], ['Or', 'A', ['Not', 'C']]])).toBe('True');
  });
});
