import { engine as ce } from '../utils';

describe('COMPILE', () => {
  describe('Expressions', () => {
    it('should compile (and simplify) a simple expression', () => {
      expect(
        ce.parse('3.45 + \\frac57').compile()?.toString()
      ).toMatchInlineSnapshot(`0.7142857142857143 + 3.45`);
    });

    it('should compile an expression with a constant', () => {
      expect(
        ce.parse('2\\exponentialE').compile()?.toString()
      ).toMatchInlineSnapshot(`2 * Math.E`);
    });

    it('should compile an expression with trig functions', () => {
      expect(
        ce.parse('2 \\cos(\\frac{\\pi}{5})').compile()?.toString()
      ).toMatchInlineSnapshot(`2 * Math.cos(0.2 * Math.PI)`);
    });
  });

  describe('Blocks', () => {
    it('should compile a simple block', () => {
      const expr = ce.box(['Block', ['Multiply', 10, 2]]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(`2 * 10`);
    });

    it('should compile a block with two statements', () => {
      const expr = ce.box(['Block', ['Add', 13, 15], ['Multiply', 10, 2]]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(`
        (() => {
        13 + 15;
        return 2 * 10
        })()
      `);
    });

    it('should compile a block with a declaration', () => {
      const expr = ce.box([
        'Block',
        ['Declare', 'x', 'Numbers'],
        ['Assign', 'x', 4.1],
        ['Multiply', 'x', 'n'],
      ]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(`
        (() => {
        let x;
        x = 4.1;
        return _.n * x
        })()
      `);
    });

    it('should compile a block with a return statement', () => {
      const expr = ce.box([
        'Block',
        ['Declare', 'x', 'Numbers'],
        ['Assign', 'x', 4.1],
        ['Return', ['Add', 'x', 1]],
        ['Multiply', 'x', 2],
      ]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(`
        (() => {
        let x;
        x = 4.1;
        return x + 1;
        return 2 * x
        })()
      `);
    });
  });

  describe('Imported Functions', () => {
    ce.declare('Foo', {
      signature: '(number) -> number',
      evaluate: ([x]) => ce.box(['Add', x, 1]),
    });

    it('should compile a function imported inline', () => {
      const fn = ce.box(['Foo', 3]).compile({
        functions: { Foo: (x) => x + 1 },
      })!;
      expect(fn()).toBe(4);
    });

    it('should compile a function referenced by name', () => {
      function foo(x) {
        return x + 1;
      }
      const fn = ce.box(['Foo', 3]).compile({
        functions: { Foo: foo },
      })!;
      expect(fn()).toBe(4);
    });

    it('should compile a function imported by name', () => {
      function foo(x) {
        return x + 1;
      }
      const fn = ce.box(['Foo', 3]).compile({
        functions: { Foo: 'foo' },
        imports: [foo],
      })!;
      expect(fn()).toBe(4);
    });
  });

  describe('Conditionals / Ifs', () => {
    it('should compile an if statement', () => {
      const expr = ce.box(['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(
        `((0 < _.x) ? (_.x) : (-_.x))`
      );
    });

    it('should compile an if statement with blocks', () => {
      const expr = ce.box([
        'If',
        ['Greater', 'x', 0],
        ['Block', 'x'],
        ['Block', ['Negate', 'x']],
      ]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(
        `((0 < _.x) ? (_.x) : (-_.x))`
      );
    });
  });

  describe('Custom Operators', () => {
    describe('Object-based operator overrides', () => {
      it('should override a single operator', () => {
        const expr = ce.parse('x + y');
        const compiled = expr.compile({
          operators: { Add: ['add', 11] },
        });
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(_.x, _.y)`
        );
      });

      it('should override multiple operators', () => {
        const expr = ce.parse('x + y * z');
        const compiled = expr.compile({
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
          },
        });
        // Note: canonical form may reorder arguments
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(mul(_.y, _.z), _.x)`
        );
      });

      it('should handle division override', () => {
        const expr = ce.parse('x / y');
        const compiled = expr.compile({
          operators: { Divide: ['div', 13] },
        });
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `div(_.x, _.y)`
        );
      });

      it('should override unary operators', () => {
        const expr = ce.parse('-x');
        const compiled = expr.compile({
          operators: { Negate: ['neg', 14] },
        });
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(`neg(_.x)`);
      });

      it('should handle subtraction with Negate override', () => {
        // Note: Subtraction is canonicalized to Add(x, Negate(y))
        const expr = ce.parse('x - y');
        const compiled = expr.compile({
          operators: {
            Add: ['add', 11],
            Negate: ['neg', 14],
          },
        });
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(_.x, neg(_.y))`
        );
      });

      it('should use default operators for non-overridden operators', () => {
        const expr = ce.parse('x + y - z');
        const compiled = expr.compile({
          operators: { Add: ['add', 11] },
        });
        // Note: Subtraction is canonicalized to Add(x, y, Negate(z))
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(_.x, _.y, -_.z)`
        );
      });
    });

    describe('Function-based operator overrides', () => {
      it('should override using a function', () => {
        const expr = ce.parse('x + y');
        const compiled = expr.compile({
          operators: (op) => (op === 'Add' ? ['add', 11] : undefined),
        });
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(_.x, _.y)`
        );
      });

      it('should fall back to defaults when function returns undefined', () => {
        const expr = ce.parse('x + y * z');
        const compiled = expr.compile({
          operators: (op) => (op === 'Add' ? ['add', 11] : undefined),
        });
        // Note: canonical form may reorder arguments
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(_.y * _.z, _.x)`
        );
      });
    });

    describe('Vector/matrix operations use case', () => {
      it('should compile vector addition to function call', () => {
        // Use case from Issue #240
        const expr = ce.box(['Add', ['List', 1, 1, 1], ['List', 1, 1, 1]]);
        const compiled = expr.compile({
          operators: { Add: ['add', 11] },
        });
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add([1, 1, 1], [1, 1, 1])`
        );
      });

      it('should execute vector operations with custom functions', () => {
        function add(a, b) {
          return a.map((v, i) => v + b[i]);
        }
        function mul(a, b) {
          return a.map((v, i) => v * b[i]);
        }

        const expr = ce.box([
          'Add',
          ['List', 1, 2, 3],
          ['Multiply', ['List', 2, 3, 4], ['List', 1, 1, 1]],
        ]);

        const compiled = expr.compile({
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
          },
          functions: { add, mul },
        });

        const result = compiled?.();
        expect(result).toEqual([3, 5, 7]);
      });
    });

    describe('Complex expressions with operator overrides', () => {
      it('should handle nested expressions', () => {
        const expr = ce.parse('(x + y) * (z + w)');
        const compiled = expr.compile({
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
          },
        });
        // Note: canonical form may reorder arguments
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `mul(add(_.w, _.z), add(_.x, _.y))`
        );
      });

      it('should handle expressions with multiple operator types', () => {
        const expr = ce.parse('x + y - z * w / v');
        const compiled = expr.compile({
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
            Divide: ['div', 13],
            Negate: ['neg', 14],
          },
        });
        // Note: Subtraction is canonicalized to Add with Negate
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(neg(mul(_.z, div(_.w, _.v))), _.x, _.y)`
        );
      });
    });

    describe('Precedence handling with custom operators', () => {
      it('should respect custom precedence', () => {
        const expr = ce.parse('x + y * z');
        const compiled = expr.compile({
          operators: {
            Add: ['add', 20], // Higher precedence than multiply
            Multiply: ['mul', 10],
          },
        });
        // Note: canonical form may reorder arguments
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(mul(_.y, _.z), _.x)`
        );
      });
    });

    describe('Partial overrides', () => {
      it('should allow overriding only some operators', () => {
        const expr = ce.parse('a + b * c - d / g');
        const compiled = expr.compile({
          operators: {
            Add: ['add', 11],
            // Multiply, Negate, Divide use defaults
          },
        });
        // Note: Subtraction is canonicalized to Add with Negate
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(_.b * _.c, _.a, -_.d / _.g)`
        );
      });
    });
  });
});
