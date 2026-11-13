import { ComputeEngine } from '../../src/compute-engine';
import type { SemiBoxedExpression } from '../../src/compute-engine';

//
// A function literal that mentions the name it is assigned to is a recursive
// definition only when the mention denotes the binding being assigned. A
// closure that reads another binding of that name keeps reading it.
//

const fn = (body: SemiBoxedExpression, ...params: string[]) =>
  ['Function', body, ...params] as SemiBoxedExpression;
const assign = (name: string, value: SemiBoxedExpression) =>
  ['Assign', name, value] as SemiBoxedExpression;
const declare = (name: string, value: SemiBoxedExpression) =>
  ['Declare', name, "'unknown'", value] as SemiBoxedExpression;

// The value of the last statement. Every statement before it must not give an
// error, so that a failed assignment does not pass unnoticed.
function run(...statements: SemiBoxedExpression[]) {
  const ce = new ComputeEngine();
  let result = ce.Nothing as ReturnType<typeof ce.box>;
  for (const statement of statements) {
    expect(result.operator).not.toBe('Error');
    result = ce.box(statement).evaluate();
  }
  return result.json;
}

// The value of the last statement, for a program whose global assignment gives
// an effect error although it stores its value: with `h` defined first, the
// assignment of a global named as a local of `h` gives that error. The test
// checks only the binding that the stored closure reads. ROADMAP.md, CE-819.
function lastValue(...statements: SemiBoxedExpression[]) {
  const ce = new ComputeEngine();
  let result = ce.Nothing as ReturnType<typeof ce.box>;
  for (const statement of statements) result = ce.box(statement).evaluate();
  return result.json;
}

// h(n) returns a closure that reads the local `g` of its own call of `h`.
const h = assign(
  'h',
  fn(
    ['Block', declare('g', fn(0, 'z')), fn(['Add', ['g', 'z'], 'n'], 'z')],
    'n'
  )
);
// k(n) stores a closure of `h` in a local that is also named `g`.
const makeK = (argument: SemiBoxedExpression) =>
  assign(
    'k',
    fn(
      [
        'Block',
        declare('g', ['h', argument]),
        fn(['Add', ['g', 'z'], 'n'], 'z'),
      ],
      'n'
    )
  );

describe('a closure assigned to a name that it reads as another binding', () => {
  test('two functions with a local of the same name keep their own binding', () => {
    expect(run(h, makeK('n'), ['Apply', ['k', 1], 0])).toEqual(2);
  });

  test('the closure keeps the parameter of its own call', () => {
    expect(run(h, makeK(['Add', 'n', 10]), ['Apply', ['k', 1], 0])).toEqual(12);
  });

  test('.N() gives the same value', () => {
    const ce = new ComputeEngine();
    ce.box(h).evaluate();
    ce.box(makeK('n')).evaluate();
    expect(ce.box(['Apply', ['k', 1], 0]).N().re).toEqual(2);
  });

  test('evaluateAsync() gives the same value', async () => {
    const ce = new ComputeEngine();
    ce.box(h).evaluate();
    ce.box(makeK('n')).evaluate();
    const result = await ce.box(['Apply', ['k', 1], 0]).evaluateAsync();
    expect(result.json).toEqual(2);
  });

  test('a local that holds a number is read as a number', () => {
    expect(
      run(
        assign(
          'h',
          fn(['Block', declare('g', 10), fn(['Add', 'g', 'n'], 'z')], 'n')
        ),
        makeK('n'),
        ['Apply', ['k', 1], 0]
      )
    ).toEqual(12);
  });

  test('a global of the same name is another binding', () => {
    expect(lastValue(h, assign('g', ['h', 1]), ['g', 0])).toEqual(1);
  });

  test('each call of a recursive function keeps its own local', () => {
    expect(
      run(
        assign(
          'h',
          fn(
            [
              'Block',
              declare('g', [
                'If',
                ['Greater', 'n', 0],
                ['h', ['Subtract', 'n', 1]],
                fn(0, 'z'),
              ]),
              fn(['Add', ['g', 'z'], 'n'], 'z'),
            ],
            'n'
          )
        ),
        ['Apply', ['h', 2], 0]
      )
    ).toEqual(3);
  });

  test('a local declared in an inner block does not capture the global', () => {
    expect(
      run(
        assign('g', fn(5, 't')),
        assign('f', fn(['Add', ['g', 'z'], 1], 'z')),
        [
          'Block',
          ['Declare', 'g', 'unknown', fn(9, 't')],
          assign('g', 'f'),
          ['g', 0],
        ]
      )
    ).toEqual(6);
  });

  test('a local declared in an inner block does not capture the outer local', () => {
    expect(
      run([
        'Block',
        declare('g', fn(0, 'z')),
        declare('f', fn(['Add', ['g', 'z'], 1], 'z')),
        [
          'Block',
          ['Declare', 'g', 'unknown', fn(9, 't')],
          assign('g', 'f'),
          ['g', 0],
        ],
      ])
    ).toEqual(1);
  });

  test('a recursive closure of a factory reads its own local', () => {
    expect(
      run(
        assign(
          'mk',
          fn(
            [
              'Block',
              declare(
                'f',
                fn(
                  [
                    'If',
                    ['LessEqual', 'x', 0],
                    'n',
                    ['f', ['Subtract', 'x', 1]],
                  ],
                  'x'
                )
              ),
              'f',
            ],
            'n'
          )
        ),
        assign('f', ['mk', 5]),
        ['f', 2]
      )
    ).toEqual(5);
  });
});

describe('a mention of the assigned binding stays a recursive call', () => {
  const factorial = fn(
    [
      'If',
      ['LessEqual', 'n', 1],
      1,
      ['Multiply', 'n', ['fact', ['Subtract', 'n', 1]]],
    ],
    'n'
  );

  test('a literal assigned at the top level', () => {
    expect(run(assign('fact', factorial), ['fact', 4])).toEqual(24);
  });

  test('a literal boxed before the assignment', () => {
    const ce = new ComputeEngine();
    ce.assign('fact', ce.box(factorial));
    expect(ce.box(['fact', 4]).evaluate().json).toEqual(24);
  });

  test('a literal boxed before the name is declared in a pushed scope', () => {
    const ce = new ComputeEngine();
    const literal = ce.box(factorial);
    ce.pushScope();
    ce.declare('fact', 'function');
    ce.assign('fact', literal);
    expect(ce.box(['fact', 4]).evaluate().json).toEqual(24);
    ce.popScope();
  });

  const localRecursion = declare(
    'f',
    fn(
      [
        'If',
        ['LessEqual', 'x', 0],
        0,
        ['Add', 'n', ['f', ['Subtract', 'x', 1]]],
      ],
      'x'
    )
  );

  test('a local of a function body', () => {
    expect(
      run(assign('t', fn(['Block', localRecursion, ['f', 3]], 'n')), ['t', 2])
    ).toEqual(6);
  });

  test('a local of a block nested in a function body', () => {
    expect(
      run(assign('t', fn(['Block', ['Block', localRecursion, ['f', 3]]], 'n')), [
        't',
        2,
      ])
    ).toEqual(6);
  });

  test('a reassignment of a name that has a value', () => {
    expect(
      run(
        assign('f', fn(10, 'x')),
        assign(
          'f',
          fn(
            ['If', ['LessEqual', 'x', 0], 11, ['f', ['Subtract', 'x', 1]]],
            'x'
          )
        ),
        ['f', 3]
      )
    ).toEqual(11);
  });

  test('a free name of a closure reads the function assigned to it later', () => {
    // The literal has no binding of `g` outside it, so `g` is the global.
    expect(
      run(
        assign('w', fn(fn(['If', ['LessEqual', 'z', 0], 'n', ['g', ['Subtract', 'z', 1]]], 'z'), 'n')),
        assign('g', ['w', 7]),
        ['g', 2]
      )
    ).toEqual(7);
  });
});

// A declared signature on the name that stores a closure builds the literal
// again, with the declared parameter types and result on it. The new literal
// must read the bindings of the call that made the closure, not those of the
// scope of the declaration. ROADMAP.md, CE-820.
describe('a closure stored under a declared signature', () => {
  const realToReal = { str: '(real) -> real' };

  test('a global declared with a value reads the local of the call', () => {
    expect(
      run(h, ['Declare', 'q', realToReal, ['h', 1]], ['q', 0])
    ).toEqual(1);
  });

  test('a global declared first, then assigned, reads the local of the call', () => {
    // A `Declare` statement of a function type needs a value
    // (`declaration-without-value`), so the type is declared with the API.
    const ce = new ComputeEngine();
    ce.box(h).evaluate();
    ce.declare('q', '(real) -> real');
    expect(ce.box(assign('q', ['h', 1])).evaluate().operator).toBe('Function');
    expect(ce.box(['q', 0]).evaluate().json).toEqual(1);
  });

  test('a local of the same name as the local of the call is another binding', () => {
    expect(
      run(
        h,
        assign(
          'k',
          fn(
            [
              'Block',
              ['Declare', 'g', realToReal, ['h', 'n']],
              fn(['Add', ['g', 'z'], 'n'], 'z'),
            ],
            'n'
          )
        ),
        ['Apply', ['k', 1], 0]
      )
    ).toEqual(2);
  });

  test('a declared list parameter is stamped on the literal, which keeps its bindings', () => {
    const typedList = ['Typed', 'L', { str: 'list<real>' }] as SemiBoxedExpression;
    expect(
      run(
        assign(
          'h',
          fn(
            [
              'Block',
              declare('g', fn(['Length', 'L'], typedList)),
              fn(['Add', ['g', 'L'], 'n'], 'L'),
            ],
            'n'
          )
        ),
        ['Declare', 'q', { str: '(list<real>) -> real' }, ['h', 1]],
        ['q', ['List', 5, 6]]
      )
    ).toEqual(3);
  });

  test('ce.declare() with a closure value reads the local of the call', () => {
    const ce = new ComputeEngine();
    ce.box(h).evaluate();
    const closure = ce.box(['h', 1]).evaluate();
    ce.declare('q', { type: '(real) -> real', value: closure });
    expect(ce.box(['q', 0]).evaluate().json).toEqual(1);
  });

  test('evaluateAsync() gives the same value', async () => {
    const ce = new ComputeEngine();
    ce.box(h).evaluate();
    ce.box(['Declare', 'q', realToReal, ['h', 1]]).evaluate();
    const result = await ce.box(['q', 0]).evaluateAsync();
    expect(result.json).toEqual(1);
  });

  // A signature with a `where` clause is written on the literal as one
  // marker around its body, by another rebuild than a signature without one.
  describe.each(['(T) -> T where T', '(T) -> real where T'])(
    'under the polymorphic signature %s',
    (signature) => {
      test('a global reads the local of the call', () => {
        expect(
          run(h, ['Declare', 'q', { str: signature }, ['h', 1]], ['q', 0])
        ).toEqual(1);
      });

      test('a local of the same name as the local of the call is another binding', () => {
        expect(
          run(
            h,
            assign(
              'k',
              fn(
                [
                  'Block',
                  ['Declare', 'g', { str: signature }, ['h', 'n']],
                  fn(['Add', ['g', 'z'], 'n'], 'z'),
                ],
                'n'
              )
            ),
            ['Apply', ['k', 1], 0]
          )
        ).toEqual(2);
      });
    }
  );

  test('a type name declared after the closure was made is written on its parameter', () => {
    // The literal is built again in the scope of the call that made the
    // closure. A declared type is known in every scope of the engine, so
    // `list<meter>` names the same type there as in the scope of the
    // declaration.
    const ce = new ComputeEngine();
    ce.box(
      assign(
        'h',
        fn(['Block', fn(['Add', ['Length', 'L'], 'n'], 'L')], 'n')
      )
    ).evaluate();
    const closure = ce.box(['h', 1]).evaluate();
    ce.pushScope();
    ce.declareType('meter', 'real', { alias: true });
    ce.declare('q', { type: '(list<meter>) -> real', value: closure });
    const stored = ce.box('q').value!;
    ce.popScope();
    expect(stored.type.toString()).toBe('(L: list<meter>) -> real');
    expect(
      ce.box(['Apply', stored, ['List', 5, 6]]).evaluate().json
    ).toEqual(3);
  });

  test('a type name declared after the closure was made is valid in a polymorphic signature', () => {
    const ce = new ComputeEngine();
    ce.box(h).evaluate();
    const closure = ce.box(['h', 1]).evaluate();
    ce.pushScope();
    ce.declareType('meter', 'real', { alias: true });
    ce.declare('q', { type: '(T) -> meter where T', value: closure });
    expect(ce.box('q').value!.isValid).toBe(true);
    expect(ce.box(['q', 0]).evaluate().json).toEqual(1);
    ce.popScope();
  });
});
