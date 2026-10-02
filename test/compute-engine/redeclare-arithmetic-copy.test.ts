import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// Redeclaring a library arithmetic operator with an unchanged copy of its
// definition (`ce.declare('Sqrt', { ...ce.lookupDefinition('Sqrt').operator
// })`, the idiom of `doc/06-guide-augmenting.md`, "Overloading Functions")
// must give the same canonical form, type and value as the library operator
// (user decision 2026-10-01, issue #394).
//
// These eleven operators get their canonical form by name in
// `makeNumericFunction` (`boxed-expression/box.ts`). A user definition of one
// of these names shadows the library operator (user decision 2026-09-27), so
// before the fix a copy sent the call to the generic boxing code: `Add(2, x,
// 5)` stayed `2 + x + 5` and `Sqrt(8)` stayed `sqrt(8)`. Their library
// definitions now carry a `canonical` handler (`numericCanonicalHandler`,
// `boxed-expression/canonical-numeric.ts`), which a copy takes along.
//

const NAMES = [
  'Add',
  'Multiply',
  'Negate',
  'Square',
  'Sqrt',
  'Exp',
  'Ln',
  'Log',
  'Power',
  'Root',
  'Divide',
] as const;

const INPUTS: any[] = [
  ['Add', 2, 'x', 5],
  ['Add', 1, "'s'"],
  ['Add', 1, 'ImaginaryUnit'],
  ['Add', 'w', 1],
  ['Add', ['Add', 'x', 1], 2],
  ['Multiply', 2, 'x', 3],
  ['Multiply', ['Sqrt', 2], ['Sqrt', 2]],
  ['Multiply', 1, "'s'"],
  ['Negate', 3],
  ['Negate', ['Negate', 'x']],
  ['Square', 3],
  ['Square', 'x', 'y'],
  ['Sqrt', 8],
  ['Sqrt', -4],
  ['Exp', ['Ln', 'x']],
  ['Ln', 1],
  ['Ln', ['Exp', 2]],
  ['Ln', 1, 2],
  ['Log', 8, 2],
  ['Log', 1, 1],
  ['Log', 1],
  ['Log', 'x'],
  ['Ln', 'x'],
  ['Sqrt', 'x'],
  ['Multiply', 'u', 2],
  ['Power', 2, 3],
  ['Power', 'x', 0],
  ['Power', 'x', ['Rational', 1, 3]],
  ['Root', 8, 3],
  ['Divide', 6, 4],
  ['Divide', 'x', 'x'],
  ['Divide', 'x', 2, 3],
  ['Divide', 0, 0],
  ['Divide', 'x'],
];

const LATEX = [
  '1+w',
  '\\sqrt{2}\\sqrt{2}',
  '\\sqrt{8}',
  '\\frac{x^2-1}{x-1}',
  'e^{\\ln x}',
  '\\log_2 8',
  '\\sqrt[3]{27}',
  '(a+b)(c+d)',
  '\\frac{1}{2}+\\frac{1}{3}',
  '3x-x',
];

/** Everything a user can observe of an expression right after boxing: its
 * canonical form, validity, type, the types of its free variables (the
 * inference it made), and its value. */
function observe(ce: ComputeEngine, input: any): string {
  const expr = typeof input === 'string' ? ce.parse(input) : ce.box(input);
  const vars = expr.freeVariables
    .map((v) => `${v}: ${ce.box(v).type.toString()}`)
    .join(', ');
  return [
    JSON.stringify(expr.json),
    `canonical=${expr.isCanonical}`,
    `valid=${expr.isValid}`,
    `type=${expr.type.toString()}`,
    `vars=[${vars}]`,
    `evaluate=${expr.evaluate().toString()}`,
    `N=${expr.N().toString()}`,
    `simplify=${expr.simplify().toString()}`,
  ].join(' ');
}

function redeclared(name: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare(name, { ...ce.lookupDefinition(name)!.operator! } as any);
  return ce;
}

describe('an unchanged copy of an arithmetic operator definition', () => {
  describe.each(NAMES)('%s', (name) => {
    test.each([...INPUTS, ...LATEX].map((x) => [JSON.stringify(x), x]))(
      '%s',
      (_label, input) => {
        expect(observe(redeclared(name), input)).toBe(
          observe(new ComputeEngine(), input)
        );
      }
    );
  });

  test('the cases recorded in the defect report', () => {
    const add = redeclared('Add');
    expect(add.box(['Add', 2, 'x', 5]).toString()).toBe('x + 7');
    expect(add.box(['Add', 1, "'s'"]).isValid).toBe(false);
    expect(add.box(['Add', 1, 'ImaginaryUnit']).type.toString()).toBe(
      'complex'
    );
    const sum = add.parse('1+w');
    expect(sum.type.toString()).toBe('number');
    expect(add.box('w').type.toString()).toBe('number');

    const sqrt = redeclared('Sqrt');
    expect(sqrt.box(['Sqrt', 8]).toString()).toBe('2sqrt(2)');
    expect(sqrt.parse('\\sqrt{2}\\sqrt{2}').toString()).toBe('2');
  });

  test('a copy that overrides `evaluate` keeps the canonical form', () => {
    // The idiom of `doc/06-guide-augmenting.md`: the new handler delegates
    // to the old one for the cases it does not change.
    const ce = new ComputeEngine();
    const oldSqrt = ce.lookupDefinition('Sqrt')!.operator!;
    ce.declare('Sqrt', {
      ...oldSqrt,
      evaluate: (ops, options) => {
        if (ops[0].symbol === 'y') return options.engine.number(42);
        return oldSqrt.evaluate!(ops, options);
      },
    });
    expect(ce.box(['Sqrt', 8]).toString()).toBe('2sqrt(2)');
    expect(ce.box(['Sqrt', 'y']).evaluate().toString()).toBe('42');
    expect(ce.box(['Sqrt', 'x']).evaluate().toString()).toBe('sqrt(x)');
  });
});

describe('a user definition that differs still shadows the library operator', () => {
  test('a definition without the library canonical handler', () => {
    const ce = new ComputeEngine();
    ce.declare('Square', {
      signature: '(number) -> number',
      evaluate: ([x], { engine }) => engine.box(['Add', x, 100]).evaluate(),
    });
    expect(ce.box(['Square', 3]).evaluate().toString()).toBe('103');
  });

  test('a copy with its own canonical handler', () => {
    const ce = new ComputeEngine();
    ce.declare('Sqrt', {
      ...ce.lookupDefinition('Sqrt')!.operator!,
      canonical: (ops, { engine }) => engine._fn('Sqrt', ops),
    });
    expect(ce.box(['Sqrt', 8]).toString()).toBe('sqrt(8)');
  });

  test.each([
    ['function Square(x) { x + 100 }\nSquare(3)', '103'],
    ['function Sqrt(x) { x + 100 }\nSqrt(4)', '104'],
    ['function Add(x, y) { x * y }\nAdd(3, 4)', '12'],
    ['function Ln(x) { x + 100 }\nLn(1)', '101'],
  ])('an Epsil function %j', (source, value) => {
    expect(executeEpsil(new ComputeEngine(), source).value.toString()).toBe(
      value
    );
  });

  test('a parameter named like the operator is the argument', () => {
    expect(
      executeEpsil(
        new ComputeEngine(),
        '((Sqrt) => Sqrt(8))(x => x + 100)'
      ).value.toString()
    ).toBe('108');
  });
});

describe('the library canonical handler and the operator flags', () => {
  test('a user canonical handler with `associative` is still refused', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('MyPlus', {
        signature: '(number+) -> number',
        associative: true,
        canonical: (ops, { engine }) => engine._fn('MyPlus', ops),
      })
    ).toThrow(/incompatible/);
  });

  test('the library handler on another operator is removed, its flags apply', () => {
    // The `Add` handler is kept only on a definition named `Add`. On `Foo`
    // it is removed, so the `involution` flag is not refused and applies:
    // `Foo(Foo(x))` is `x`. Before, the handler stayed and `Foo(x)` boxed
    // as `Add(x)`, that is `x`.
    const ce = new ComputeEngine();
    ce.declare('Foo', {
      signature: '(number) -> number',
      canonical: ce.lookupDefinition('Add')!.operator!.canonical,
      involution: true,
    });
    expect(ce.lookupDefinition('Foo')!.operator!.canonical).toBeUndefined();
    expect(ce.box(['Foo', 'x']).json).toEqual(['Foo', 'x']);
    expect(ce.box(['Foo', ['Foo', 'x']]).json).toEqual('x');
  });

  test('a copy of `Add` with a changed flag does not keep the handler', () => {
    const ce = new ComputeEngine();
    ce.declare('Add', {
      ...ce.lookupDefinition('Add')!.operator!,
      idempotent: false,
    });
    expect(ce.lookupDefinition('Add')!.operator!.canonical).toBeUndefined();
  });
});

/** The library definition of `name`, without its `name` field, so that it
 * can be declared under another name. */
function libraryDefinitionWithoutName(ce: ComputeEngine, name: string): any {
  const { name: _name, ...rest } = ce.lookupDefinition(name)!.operator! as any;
  return rest;
}

describe('a copy under another name keeps its own head and evaluate', () => {
  test.each([
    ['Ln', 'MyLn', ['x']],
    ['Sqrt', 'MySqrt', ['x']],
    ['Add', 'MyAdd', ['x', 1, 2]],
    ['Power', 'MyPower', ['x', 3]],
  ])('%s copied as %s', (name, myName, args) => {
    const ce = new ComputeEngine();
    ce.declare(myName, {
      ...libraryDefinitionWithoutName(ce, name),
      evaluate: (_ops, { engine }) => engine.number(5),
    });
    const expr = ce.box([myName, ...(args as any[])]);
    expect(expr.operator).toBe(myName);
    expect(expr.json).toEqual([myName, ...(args as any[])]);
    expect(expr.evaluate().toString()).toBe('5');
  });
});

describe('a copy that changes what canonicalization depends on', () => {
  test('a copy of `Sqrt` with another signature uses the generic route', () => {
    const ce = new ComputeEngine();
    ce.declare('Sqrt', {
      ...ce.lookupDefinition('Sqrt')!.operator!,
      signature: '(string) -> string',
      evaluate: (_ops, { engine }) => engine.string('ok'),
    });
    const expr = ce.box(['Sqrt', "'a'"]);
    expect(expr.json).toEqual(['Sqrt', "'a'"]);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toBe('"ok"');
  });

  test('a copy of `Sqrt` with the same signature as a string keeps the form', () => {
    const ce = new ComputeEngine();
    ce.declare('Sqrt', {
      ...ce.lookupDefinition('Sqrt')!.operator!,
      signature: '(complex | infinity) -> complex | infinity',
    });
    expect(ce.box(['Sqrt', 8]).toString()).toBe('2sqrt(2)');
  });

  test('a copy that changes only metadata keeps the form', () => {
    const ce = new ComputeEngine();
    ce.declare('Ln', {
      ...ce.lookupDefinition('Ln')!.operator!,
      description: 'My logarithm',
      wikidata: 'Q0',
      examples: ['\\ln 2'],
    });
    expect(ce.box(['Ln', 1]).toString()).toBe('0');
  });
});

test('the library handler is marked with a global symbol', () => {
  // Another bundle of the engine has its own copy of the registry module, so
  // it recognizes the handler by this global symbol only
  // (`numeric-canonical-registry.ts`).
  const ce = new ComputeEngine();
  const handler = ce.lookupDefinition('Add')!.operator!.canonical as any;
  expect(handler[Symbol.for('cortex-js.numericCanonical')].name).toBe('Add');
});
