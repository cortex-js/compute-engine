// Corpus + declarations loading for the Fungrim validation harness
// (FUNGRIM-PLAN-1-TRANSLATOR.md §5).
//
// Responsibilities:
//  - read data/fungrim/corpus/*.json, declarations.json, MANIFEST.json
//  - create a ComputeEngine with all symbol shells declared in a child scope
//    (incl. the LambertW re-declaration: CE's LambertW is 1-arg principal
//    branch, the corpus emits 2-arg ["LambertW", z, k] — see the `existing`
//    note in declarations.json / SPIKE-DECISIONS.md)
//  - per-entry variable type inference from assumptions (SPIKE-DECISIONS.md
//    cross-cutting finding #2: symbolic derivative orders / integer slots
//    produce bogus incompatible-type errors unless variables are typed)

import * as fs from 'node:fs';
import * as path from 'node:path';

import { ComputeEngine } from '../../src/compute-engine';

export type Entry = {
  id: string;
  formula: unknown;
  variables: string[];
  assumptions: unknown;
  class: string;
  subclass: string | null;
  heads: string[];
  guardLevel: 'none' | 'real-simple' | 'complex-domain' | 'undischargeable';
  flavor: string | null;
  references: unknown;
  topics: string[];
  directedInfinity?: boolean;
  indexedFamilies?: string[];
  // injected at load time:
  topic: string;
};

export type Declarations = {
  generator: string;
  declarations: Record<
    string,
    { signature: string; description?: string; arity?: number | number[] }
  >;
  existing: Record<string, unknown>;
};

export type Corpus = {
  entries: Entry[];
  declarations: Declarations;
  topics: string[];
};

export function loadCorpus(dir: string): Corpus {
  const corpusDir = path.join(dir, 'corpus');
  const entries: Entry[] = [];
  const topics: string[] = [];
  for (const file of fs.readdirSync(corpusDir).sort()) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(corpusDir, file), 'utf8'));
    topics.push(data.topic);
    for (const e of data.entries) entries.push({ ...e, topic: data.topic });
  }
  // Deterministic global order (ids are unique across topics)
  entries.sort((a, b) => a.id.localeCompare(b.id));
  const declarations: Declarations = JSON.parse(
    fs.readFileSync(path.join(dir, 'declarations.json'), 'utf8')
  );
  return { entries, declarations, topics };
}

/**
 * Compatibility re-declarations: CE built-ins whose declared signature is
 * narrower than the Fungrim semantics the corpus relies on. Shadowing them
 * in the shells scope makes the corpus boxable; the cost is that the
 * shadowing declaration has NO evaluator (numeric evaluation is lost), so
 * Stage 2 runs with `compat: false` and treats the affected entries as
 * not-evaluable instead.
 *
 *  - LambertW: corpus emits ["LambertW", z, k] for branch k
 *    (SPIKE-DECISIONS.md; CE is 1-arg principal branch).
 *  - Digamma: Fungrim DigammaFunction(z, m) is the order-m polygamma;
 *    CE Digamma is (number) -> number (1-arg). ~40 entries.
 *  - Binomial: Fungrim Binomial(z, k) is the generalized binomial over
 *    complex z; CE is (integer, integer) -> integer. ~17 entries.
 *  - Fibonacci: Fungrim generalizes Fibonacci to complex argument (Binet);
 *    CE is (integer) -> integer.
 *  - HilbertMatrix: declarations.json mis-declares the codomain as
 *    `complex`; it is a matrix (Determinant(HilbertMatrix(n)) occurs).
 */
export const COMPAT_OVERRIDES: Record<string, string> = {
  LambertW: '(complex, integer?) -> complex',
  Digamma: '(complex, integer?) -> complex',
  Binomial: '(complex, complex) -> complex',
  Fibonacci: '(complex) -> complex',
  HilbertMatrix: '(integer) -> matrix',
};

/**
 * declarations.json types Fungrim domains (AlgebraicNumbers, Lattice, Rings,
 * SL2Z, ...) as `collection<...>`, but CE's SetMinus/Union/Intersection
 * require `set` operands (every Fungrim domain is mathematically a set).
 * Rewrite `collection` -> `set` in shell signatures. (`set` is a subtype of
 * `collection`, so Element/indexing-set usages keep working.)
 */
function setify(signature: string): string {
  return signature.replace(/\bcollection\b/g, 'set');
}

/**
 * Create a ComputeEngine with every shell declared in a dedicated child
 * scope. With `compat` (default true, used by Stage 1), the
 * COMPAT_OVERRIDES widenings are applied; Stage 2 passes `compat: false`
 * to keep the built-ins' numeric evaluators. Entry-specific variable
 * declarations go in a further nested scope (see `withEntryScope`).
 */
export function createEngine(
  declarations: Declarations,
  options?: { compat?: boolean }
): ComputeEngine {
  const compat = options?.compat ?? true;
  const ce = new ComputeEngine();
  ce.pushScope(undefined, 'fungrim-shells');
  for (const [name, rec] of Object.entries(declarations.declarations)) {
    const sig =
      compat && COMPAT_OVERRIDES[name]
        ? COMPAT_OVERRIDES[name]
        : setify(rec.signature);
    ce.declare(name, sig);
  }
  if (compat)
    for (const [name, sig] of Object.entries(COMPAT_OVERRIDES))
      if (!(name in declarations.declarations)) ce.declare(name, sig);
  return ce;
}

/** Map a MathJSON domain expression (RHS of an Element conjunct) to a CE type. */
export function inferType(dom: unknown): string {
  if (typeof dom === 'string') {
    if (
      [
        'Integers',
        'NonNegativeIntegers',
        'PositiveIntegers',
        'NonPositiveIntegers',
        'NegativeIntegers',
        'Primes',
      ].includes(dom)
    )
      return 'integer';
    if (dom === 'RationalNumbers') return 'rational';
    if (dom === 'RealNumbers') return 'real';
    return 'complex';
  }
  if (Array.isArray(dom)) {
    if (dom[0] === 'Interval') return 'real';
    if (dom[0] === 'Range' || dom[0] === 'Divisors') return 'integer';
    if (dom[0] === 'SetMinus') return inferType(dom[1]);
    // Element(n, Set(2, 3, 7, ...)) — explicit finite integer sets
    if (
      dom[0] === 'Set' &&
      dom.length > 1 &&
      dom.slice(1).every((x) => typeof x === 'number' && Number.isInteger(x))
    )
      return 'integer';
  }
  return 'complex';
}

/**
 * Infer a type for each variable of an entry from its `Element` conjuncts
 * (assumptions and formula-internal indexing sets alike). Variables without
 * an Element conjunct default to `complex`.
 */
export function variableTypes(e: Entry): Record<string, string> {
  const types: Record<string, string> = {};
  const walk = (x: unknown): void => {
    if (!Array.isArray(x)) return;
    if (x[0] === 'Element' && typeof x[1] === 'string' && x.length >= 3)
      types[x[1]] ??= inferType(x[2]);
    for (const y of x) walk(y);
  };
  walk(e.assumptions);
  walk(e.formula);
  return types;
}

/** Find the Element domain (raw MathJSON) declared for each variable in the assumptions. */
export function variableDomains(e: Entry): Record<string, unknown> {
  const domains: Record<string, unknown> = {};
  const walk = (x: unknown): void => {
    if (!Array.isArray(x)) return;
    if (x[0] === 'Element' && typeof x[1] === 'string' && x.length >= 3)
      domains[x[1]] ??= x[2];
    for (const y of x) walk(y);
  };
  walk(e.assumptions);
  return domains;
}

/**
 * For variables that have no `Element` conjunct (e.g. AsymptoticTo entries
 * with null assumptions), refine `complex` to `integer` when the variable is
 * passed directly to a slot whose declared parameter type is integer
 * (BellNumber(n), Totient(n), ...). Signature is read from the engine so
 * shells and compat overrides are respected.
 */
function refineTypesFromIntegerSlots(
  ce: ComputeEngine,
  e: Entry,
  types: Record<string, string>
): void {
  const untyped = e.variables.filter((v) => !(v in types));
  if (untyped.length === 0) return;
  const paramTypes = new Map<string, string[]>();
  const paramsOf = (head: string): string[] => {
    if (paramTypes.has(head)) return paramTypes.get(head)!;
    let params: string[] = [];
    try {
      const t = ce.box(head).type.toString();
      const m = t.match(/^\((.*)\)\s*->/);
      if (m) params = m[1].split(',').map((s) => s.trim());
    } catch {
      /* not a known function head */
    }
    paramTypes.set(head, params);
    return params;
  };
  const walk = (x: unknown): void => {
    if (!Array.isArray(x)) return;
    if (typeof x[0] === 'string') {
      const params = paramsOf(x[0]);
      for (let i = 1; i < x.length; i++) {
        const arg = x[i];
        if (typeof arg === 'string' && untyped.includes(arg)) {
          const p = params[Math.min(i - 1, params.length - 1)];
          if (p?.startsWith('integer')) types[arg] ??= 'integer';
        }
      }
    }
    for (const y of x) walk(y);
  };
  walk(e.formula);
}

/**
 * Run `fn` inside a fresh scope where the entry's variables are declared
 * with their inferred types. Declaration failures (e.g. a variable name
 * colliding with a CE built-in constant) are tolerated: boxing still works,
 * the built-in semantics apply.
 */
export function withEntryScope<T>(
  ce: ComputeEngine,
  e: Entry,
  fn: () => T
): T {
  ce.pushScope();
  try {
    const types = variableTypes(e);
    refineTypesFromIntegerSlots(ce, e, types);
    for (const v of e.variables) {
      try {
        ce.declare(v, types[v] ?? 'complex');
      } catch {
        /* name collides with a CE built-in — leave as-is */
      }
    }
    return fn();
  } finally {
    ce.popScope();
  }
}
