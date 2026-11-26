import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  epsilProgramSites,
  type EpsilProgramSites,
} from '../../src/epsil/program-sites';

//
// `epsilProgramSites()` (CE-1255.2, CE-1628): the sites of the names of a
// program, with the binding each one resolves to. The host of a notebook
// code cell reads from it which sites name a binding outside the cell. The
// programs of the first groups are the acceptance cases of
// `docs/plans/2026-11-19-program-sites.md`; their values are checked
// against the interpreter in the same scopes.
//

/** An engine with the scope of a notebook section (`k = 5`, `p = 5`,
 * `q = 7`, or the names of `outer`) and, over it, the scope of a cell. */
function cellEngine(
  outer: Record<string, number> = { k: 5, p: 5, q: 7 }
): ComputeEngine {
  const ce = new ComputeEngine();
  ce.pushScope();
  for (const [name, value] of Object.entries(outer)) {
    ce.declare(name, 'integer');
    ce.assign(name, value);
  }
  ce.pushScope();
  return ce;
}

function sitesOf(source: string): EpsilProgramSites {
  return epsilProgramSites(cellEngine(), source);
}

/** Each site as `text@start role[ deferred] kind name`. */
function shape(source: string, result: EpsilProgramSites): string[] {
  return result.sites.map((site) => {
    const binding = result.bindings[site.binding];
    return `${source.slice(site.start, site.end)}@${site.start} ${site.role}${
      site.deferred ? ' deferred' : ''
    } ${binding.kind} ${binding.name}`;
  });
}

/** The sites of the external binding `name`, as `start role[ deferred]`. */
function external(result: EpsilProgramSites, name: string): string[] {
  return result.sites
    .filter((site) => {
      const binding = result.bindings[site.binding];
      return binding.kind === 'external' && binding.name === name;
    })
    .map(
      (site) => `${site.start} ${site.role}${site.deferred ? ' deferred' : ''}`
    );
}

/** The value of `source` in a cell scope, and the values of the outer
 * names after the run. */
function run(
  source: string,
  outer?: Record<string, number>
): { value: unknown; outer: Record<string, unknown> } {
  const ce = cellEngine(outer);
  const value = executeEpsil(ce, source).value?.json;
  ce.popScope();
  const after: Record<string, unknown> = {};
  for (const name of Object.keys(outer ?? { k: 5, p: 5, q: 7 }))
    after[name] = ce.box(name).evaluate().json;
  return { value, outer: after };
}

/** `source` with the text of each site of the external binding `from`
 * replaced by `to`. */
function renameExternal(source: string, from: string, to: string): string {
  const result = sitesOf(source);
  let text = source;
  for (const site of [...result.sites].reverse()) {
    const binding = result.bindings[site.binding];
    if (binding.kind === 'external' && binding.name === from)
      text = text.slice(0, site.start) + to + text.slice(site.end);
  }
  return text;
}

describe('EPSIL PROGRAM SITES — the sites of an external binding', () => {
  test('a function body reads a `let` that comes after it', () => {
    const source = 'function g() { k }\nlet k = 7\ng()';
    expect(external(sitesOf(source), 'k')).toEqual([]);
    expect(run(source).value).toBe(7);
  });

  test('a lambda body reads a `let` that comes after it', () => {
    const source = 'let h = () => k\nlet k = 7\nh()';
    expect(external(sitesOf(source), 'k')).toEqual([]);
    expect(run(source).value).toBe(7);
  });

  test('the initializer of a `let` reads the outer binding', () => {
    const source = 'let k = k + 1\nk';
    const result = sitesOf(source);
    expect(shape(source, result)).toEqual([
      'k@4 definition program k',
      'k@8 read external k',
      'k@14 read program k',
    ]);
    expect(run(source).value).toBe(6);
  });

  test('a direct use before the `let` names the binding of the program', () => {
    const source = 'let j = k\nlet k = 1';
    expect(external(sitesOf(source), 'k')).toEqual([]);
  });

  test('a read after a loop on the name is external', () => {
    const source = 'for k in 1..2 { k }\nk';
    expect(external(sitesOf(source), 'k')).toEqual(['20 read']);
    expect(run(source).value).toBe(5);
  });

  test('a `let` in a loop body does not bind a top-level read', () => {
    const source =
      'let s = 0\nfor j in 1..2 { let k = 100; s = s + k }\n[s, k]';
    expect(external(sitesOf(source), 'k')).toEqual(['55 read']);
    expect(run(source).value).toEqual(['List', 200, 5]);
  });

  test('a `let` of a block binds a read above it in the block', () => {
    const source = 'do { let h = () => k; let k = 7; h() }\nk';
    expect(external(sitesOf(source), 'k')).toEqual(['39 read']);
    expect(run(source).value).toBe(5);
  });

  test('a lambda in the initializer of a `let` reads the outer binding', () => {
    const source = 'let k = do { let h = () => k; h }\nk()';
    expect(external(sitesOf(source), 'k')).toEqual(['27 read deferred']);
    expect(run(source).value).toBe(5);
  });

  test('a recursive `let` names itself when nothing outside binds it', () => {
    const source = 'let f = (n) => if n == 0 { 1 } else { n * f(n - 1) }\nf(3)';
    const result = sitesOf(source);
    expect(result.bindings.map((b) => `${b.kind} ${b.name}`)).toEqual([
      'program f',
      'local n',
    ]);
    expect(run(source).value).toBe(6);
  });

  test('a function literal as the initializer names its own binding', () => {
    for (const source of [
      'let k = (n) => if n == 0 { 1 } else { n * k(n - 1) }\nk(3)',
      'do { let k = (n) => if n == 0 { 1 } else { n * k(n - 1) }; k(3) }',
    ]) {
      expect([source, external(sitesOf(source), 'k')]).toEqual([source, []]);
      expect(run(source).value).toBe(6);
    }
  });

  test('the collection of a `for` clause is read outside the loop', () => {
    // The loop reads its collection once, before the first pass, so a name
    // there is the binding around the loop, not the loop variable.
    const loop = 'let s = 0\nfor k in 1..k { s += k }\ns';
    expect(external(sitesOf(loop), 'k')).toEqual(['22 read']);
    expect(run(loop).value).toBe(15);
    const list = '[k for k in 1..k]';
    expect(external(sitesOf(list), 'k')).toEqual(['15 read']);
    expect(run(list).value).toEqual(['List', 1, 2, 3, 4, 5]);
    // The names of a destructuring pattern follow the same rule.
    const pattern = '[p + q for (p, q) in [(1, p), (q, 5)]]';
    expect(external(sitesOf(pattern), 'p')).toEqual(['26 read']);
    expect(external(sitesOf(pattern), 'q')).toEqual(['31 read']);
    expect(run(pattern).value).toEqual(['List', 6, 12]);
    // The collection of an earlier clause reads the outer binding, and the
    // collection of a later clause reads the variable of an earlier one.
    const source = '[a + k for a in 1..k, k in 1..2]';
    expect(external(sitesOf(source), 'k')).toEqual(['19 read']);
    expect((run(source).value as unknown[]).length).toBe(11);
    const later = '[k for k in 1..2, k in 1..k]';
    expect(external(sitesOf(later), 'k')).toEqual([]);
    expect(run(later).value).toEqual(['List', 1, 1, 2]);
  });

  test('a library spelling that the interpreter rewrites is `library`', () => {
    // The interpreter calls the library function in a body above the `let`
    // of that name (CE-1826).
    const source = 'let h = () => mean([1, 3])\nlet mean = (x) => 7\nh()';
    expect(shape(source, sitesOf(source))).toEqual([
      'h@4 definition program h',
      'mean@14 read deferred library Mean',
      'mean@31 definition program mean',
      'x@39 definition local x',
      'h@47 read program h',
    ]);
    expect(run(source).value).toBe(2);
    // Such a call binds its variable, as the library function does.
    const binder = 'function g() { sum(k^2, k in 1..3) }\nlet sum = 5\ng()';
    expect(external(sitesOf(binder), 'k')).toEqual([]);
    expect(run(binder).value).toBe(14);
    const after = 'let mean = 7\nmean';
    expect(shape(after, sitesOf(after))).toEqual([
      'mean@4 definition program mean',
      'mean@13 read program mean',
    ]);
  });

  test('parameters, binders and patterns are local', () => {
    for (const source of [
      'function g(k) { k }\ng(1)',
      'let g = (k) => k + 1',
      'match 3 { k => k + 1 }',
      '[k for k in 1..3]',
      'sum(k, k in 1..3)',
      'let (k, m) = (1, 2)\nk + m',
      'for (k, m) in [(1, 2)] { k + m }',
    ])
      expect([source, external(sitesOf(source), 'k')]).toEqual([source, []]);
  });
});

describe('EPSIL PROGRAM SITES — the external bindings a program writes', () => {
  test('a compound assignment reads and writes at one site', () => {
    const source = 'p += 1\np';
    const result = sitesOf(source);
    expect(external(result, 'p')).toEqual(['0 read-write', '7 read']);
    expect(result.externalWrites).toEqual(['p']);
    expect(run(source).outer.p).toBe(6);
  });

  test('a tuple target writes each name', () => {
    const source = '(p, q) := (1, 2)';
    const result = sitesOf(source);
    expect(external(result, 'p')).toEqual(['1 write']);
    expect(result.externalWrites).toEqual(['p', 'q']);
    expect(run(source).outer).toEqual({ k: 5, p: 1, q: 2 });
  });

  test('a write in a lambda body is deferred and in the set', () => {
    const source = 'let f = () => do { p = 9 }\nf()';
    const result = sitesOf(source);
    expect(external(result, 'p')).toEqual(['19 write deferred']);
    expect(result.externalWrites).toEqual(['p']);
    expect(run(source).outer.p).toBe(9);
  });

  test('an assignment at the top level writes the outer binding', () => {
    const source = 'p = 9';
    expect(sitesOf(source).externalWrites).toEqual(['p']);
    expect(run(source).outer.p).toBe(9);
  });

  test('an indexed or field target reads and writes its collection', () => {
    for (const source of ['p[k] = 3', 'p[k] += 3', 'p.x = k']) {
      const result = sitesOf(source);
      expect([source, external(result, 'p')]).toEqual([
        source,
        ['0 read-write'],
      ]);
      expect(result.externalWrites).toEqual(['p']);
      expect(external(result, 'k').length).toBe(1);
    }
  });

  test('a `let` of the name is not a write of the outer binding', () => {
    const source = 'let p = 9\np = 10\np';
    expect(sitesOf(source).externalWrites).toEqual([]);
    expect(run(source).outer.p).toBe(5);
  });

  test('a function writes a top-level variable declared after it', () => {
    const source = 'function g(k) scope { t = k + 1; t }\nlet t = 0\n[g(1), t]';
    const result = sitesOf(source);
    expect(shape(source, result)).toContain('t@22 write deferred program t');
    expect(result.externalWrites).toEqual([]);
    expect(run(source).value).toEqual(['List', 2, 2]);
  });

  test('an assignment to a name with no binding is unresolved', () => {
    const source = 'zz = 9';
    const result = sitesOf(source);
    expect(shape(source, result)).toEqual(['zz@0 write unresolved zz']);
    expect(result.externalWrites).toEqual([]);
  });
});

describe('EPSIL PROGRAM SITES — the rename of an external binding', () => {
  // The renamed program, with the outer binding renamed too, has the value
  // of the original: the query gave each site of the outer `k` and no site
  // of a binding of the program with the same name.
  test.each([
    'function g() { k }\nlet k = 7\ng()',
    'let h = () => k\nlet k = 7\nh()',
    'let k = k + 1\nk',
    'for k in 1..2 { k }\nk',
    'let s = 0\nfor j in 1..2 { let k = 100; s = s + k }\n[s, k]',
    'let k = do { let h = () => k; h }\nk()',
    'function g(k) { k }\ng(1) + k',
    'match k { 5 => k + 1, m => m }',
    'sum(k * j, j in 1..k) + sum(k, k in 1..3)',
    'let g = () => do { k = k + 1 }\ng()\nk',
    'k += 1\n[j + k for j in 1..k]',
    'let k = (n) => if n == 0 { 1 } else { n * k(n - 1) }\nk(3)',
    'let s = 0\nfor k in 1..k { s += k }\ns + k',
    '[a + k for a in 1..k, k in 1..2]',
  ])('%s', (source) => {
    const renamed = renameExternal(source, 'k', 'kk');
    const before = run(source);
    const after = run(renamed, { kk: 5, p: 5, q: 7 });
    expect(after.value).toEqual(before.value);
    expect(after.outer.kk).toEqual(before.outer.k);
  });

  test('the rename rewrites only the external sites', () => {
    expect(renameExternal('let k = k + 1\nk', 'k', 'kk')).toBe(
      'let k = kk + 1\nk'
    );
    expect(renameExternal('for k in 1..2 { k }\nk', 'k', 'kk')).toBe(
      'for k in 1..2 { k }\nkk'
    );
    expect(renameExternal('`k` + 1', 'k', 'kk')).toBe('kk + 1');
  });
});

describe('EPSIL PROGRAM SITES — bindings', () => {
  test('library, external, unresolved and verbatim names', () => {
    const source = 'sum(k^2, k in 1..3) + sin(π) + zz + `sin` + q';
    expect(shape(source, sitesOf(source))).toEqual([
      'sum@0 read library Sum',
      'k@4 read local k',
      'k@9 read local k',
      'sin@22 read library Sin',
      'π@26 read library Pi',
      'zz@31 read unresolved zz',
      '`sin`@36 read unresolved sin',
      'q@44 read external q',
    ]);
  });

  test('a parameter that has the name of a library binder is local', () => {
    const source = 'let f = (sum) => sum + 1';
    expect(shape(source, sitesOf(source))).toEqual([
      'f@4 definition program f',
      'sum@9 definition local sum',
      'sum@17 read deferred local sum',
    ]);
  });

  test('two bindings of one name have two identities', () => {
    const source = 'let a = 1\nlet f = (a) => a\na';
    const result = sitesOf(source);
    expect(result.bindings).toEqual([
      { name: 'a', kind: 'program', form: 'variable' },
      { name: 'f', kind: 'program', form: 'variable' },
      { name: 'a', kind: 'local', form: 'parameter' },
    ]);
    expect(result.sites.map((s) => s.binding)).toEqual([0, 1, 2, 2, 0]);
  });

  test('the same name in two scopes of the engine gives two external bindings', () => {
    const ce = cellEngine();
    expect(epsilProgramSites(ce, 'k').bindings).toEqual([
      { name: 'k', kind: 'external', scopeDepth: 1 },
    ]);
    ce.declare('k', 'string');
    expect(epsilProgramSites(ce, 'k').bindings).toEqual([
      { name: 'k', kind: 'external', scopeDepth: 0 },
    ]);
  });

  test('one site for a name after an astral character', () => {
    const source = 'let s = "😀"; let k2 = 1; k2';
    const result = sitesOf(source);
    expect(shape(source, result)).toEqual([
      's@4 definition program s',
      'k2@18 definition program k2',
      'k2@26 read program k2',
    ]);
  });

  test('a label and a type name in an annotation read no value', () => {
    const source =
      'type point = tuple<x: number, y: number>\n' +
      'let pt: point = point(1, 2)\n' +
      'function g(a: point = pt) { a }\n' +
      'g(a: pt)';
    const roles = shape(source, sitesOf(source));
    expect(roles).toContain('point@49 reference program point');
    expect(roles).toContain('point@57 read program point');
    expect(roles).toContain('pt@91 read deferred program pt');
    expect(roles).toContain('a@103 reference local a');
  });

  test('the query declares nothing on the engine', () => {
    const ce = cellEngine();
    epsilProgramSites(ce, 'let fresh = 1\ntype t = integer\nfresh');
    expect(ce.lookupDefinition('fresh')).toBeUndefined();
    expect(epsilProgramSites(ce, 'fresh').bindings).toEqual([
      { name: 'fresh', kind: 'unresolved' },
    ]);
  });

  test('a program with a parse error or an `#error` directive', () => {
    expect(sitesOf('#error "stop"').sites).toEqual([]);
    const source = 'let x = (k +';
    expect(shape(source, sitesOf(source))).toContain('k@9 read external k');
  });
});

describe('EPSIL PROGRAM SITES — statements', () => {
  test('the program bindings each statement reads, defines and writes', () => {
    const source =
      'const c = 2\n' +
      'function g(x = c) { t = x; h(x) }\n' +
      'function h(x) { x + c }\n' +
      'let t = 0\n' +
      't += g(1) + k';
    const result = sitesOf(source);
    const names = (indexes: number[]): string[] =>
      indexes.map((i) => result.bindings[i].name);
    expect(
      result.statements.map((s) => ({
        text: source.slice(s.start, s.end).split(' ').slice(0, 2).join(' '),
        reads: names(s.reads),
        defines: names(s.defines),
        writes: names(s.writes),
      }))
    ).toEqual([
      { text: 'const c', reads: [], defines: ['c'], writes: [] },
      {
        text: 'function g(x',
        reads: ['c', 'h'],
        defines: ['g'],
        writes: ['t'],
      },
      { text: 'function h(x)', reads: ['c'], defines: ['h'], writes: [] },
      { text: 'let t', reads: [], defines: ['t'], writes: [] },
      { text: 't +=', reads: ['t', 'g'], defines: [], writes: ['t'] },
    ]);
    // The reads and the write of the body of `g` are deferred.
    expect(
      result.sites
        .filter((site) => site.statement === 1 && site.deferred)
        .map((site) => source.slice(site.start, site.end))
    ).toEqual(['c', 't', 'x', 'h', 'x']);
  });

  test('both operands of `v / v` are sites', () => {
    const source = 'let v = 3.0\nv / v';
    const result = sitesOf(source);
    expect(result.sites.filter((site) => site.statement === 1).length).toBe(2);
  });
});
