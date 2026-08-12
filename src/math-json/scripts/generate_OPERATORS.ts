#!/usr/bin/env -S npx tsx

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line import/no-unresolved
import { getStandardLibrary } from '../../compute-engine/library/library.js';

const CATEGORY: Record<string, string> = {
  'core': 'Core',
  'control-structures': 'Control Structures',
  'logic': 'Logic',
  'collections': 'Collections',
  'colors': 'Colors',
  'relop': 'Relational Operators',
  'arithmetic': 'Arithmetic',
  'other': 'Other',
  'trigonometry': 'Trigonometry',
  'calculus': 'Calculus',
  'polynomials': 'Polynomials',
  'combinatorics': 'Combinatorics',
  'number-theory': 'Number Theory',
  'linear-algebra': 'Linear Algebra',
  'statistics': 'Statistics',
  'units': 'Units',
  'physics': 'Physics',
};

const CATEGORY_DESCRIPTION: Record<string, string> = {
  'Core': 'Foundational language and expression constructs.',
  'Control Structures': 'Conditionals and structural evaluation forms.',
  'Logic': 'Boolean logic and logical predicates.',
  'Collections': 'Collection constructors and collection transforms.',
  'Colors': 'Color models and color operations.',
  'Relational Operators': 'Comparisons and relational predicates.',
  'Arithmetic': 'Numeric arithmetic and elementary operations.',
  'Other': 'Operators that do not belong to a standard category.',
  'Trigonometry': 'Trigonometric and inverse trigonometric functions.',
  'Calculus': 'Calculus operators such as differentiation and integration.',
  'Polynomials': 'Polynomial algebra and polynomial analysis.',
  'Combinatorics': 'Counting and combinatorial functions.',
  'Number Theory': 'Integer arithmetic and number theoretic functions.',
  'Linear Algebra': 'Vector, matrix, and tensor operations.',
  'Statistics': 'Statistical functions and probability distributions.',
  'Units': 'Unit and dimension-related operations.',
  'Physics': 'Physical constants and physics-specific functions.',
};

type DefRecord = Record<string, unknown>;

function isObj(x: unknown): x is DefRecord {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function isOperatorDef(d: unknown): boolean {
  return (
    isObj(d) &&
    ('evaluate' in d ||
      'signature' in d ||
      'sgn' in d ||
      'complexity' in d ||
      'canonical' in d)
  );
}

function isValueDef(d: unknown): boolean {
  return (
    isObj(d) &&
    ('value' in d ||
      'constant' in d ||
      'inferred' in d ||
      'subscriptEvaluate' in d ||
      ('type' in d && typeof d.type !== 'function'))
  );
}

function arityFromSignature(sig: unknown): string {
  if (!sig || typeof sig !== 'string') return 'unknown';
  // An effect specifier may sit between the argument list and the arrow —
  // a space-separated word list (`(any) scope -> string`, or `any` for the
  // any-set; see `effectSetToString()` in common/type/effects.ts).
  //
  // A POLYMORPHIC signature (`(collection<T>, …) -> … where T`, the Design D
  // spelling of every converted collection operator) carries a trailing
  // `where` clause. The quantifier says nothing about arity, and the arity
  // regex below is anchored on the LEADING parameter list, so the clause
  // needs no stripping — the match simply stops before it.
  const match = sig
    .trim()
    .match(/^\((.*)\)\s*(?:[a-z_]+(?:\s+[a-z_]+)*\s*)?->/);
  if (!match) return 'unknown';
  const args = match[1].trim();
  if (args === '') return '0';
  // Split, and read the optional/variadic markers, at the TOP LEVEL only. A
  // parameter type can carry commas and markers of its own —
  // `reducer: callback<(unknown, T) -> unknown>` is ONE parameter, and a naive
  // `split(',')` counted `Fold` as 4-ary.
  const params = topLevelParams(args);
  if (params.some((p) => /[*+]$/.test(p))) return 'variadic';
  if (params.some((p) => p.endsWith('?'))) return 'optional';
  return String(params.length);
}

/** `args` split on the commas that separate PARAMETERS — those outside any
 * `(`, `<` or `[` group. The `>` of an ARROW (`->`) closes nothing: without
 * that exclusion `callback<(unknown, T) -> unknown>` reads as unbalanced and
 * every parameter after it merges into one. */
function topLevelParams(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === '(' || c === '<' || c === '[') depth++;
    else if ((c === '>' && args[i - 1] !== '-') || c === ')' || c === ']')
      depth--;
    if (c === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += c;
  }
  out.push(current.trim());
  return out.filter(Boolean);
}

function asDescription(def: DefRecord): string | undefined {
  const description = def.description;
  if (Array.isArray(description)) {
    const text = description.join('\n\n').trim();
    return text === '' ? undefined : text;
  }
  if (typeof description === 'string') {
    const text = description.trim();
    return text === '' ? undefined : text;
  }
  return undefined;
}

function asExamples(def: DefRecord): string[] | undefined {
  const examples = def.examples;
  if (!examples) return undefined;
  if (Array.isArray(examples)) return examples.map((x: unknown) => String(x));
  return [String(examples)];
}

function buildPayload() {
  const definitions: { library: string; name: string; def: DefRecord }[] = [];

  for (const lib of getStandardLibrary()) {
    const tables = lib.definitions
      ? Array.isArray(lib.definitions)
        ? lib.definitions
        : [lib.definitions]
      : [];

    for (const table of tables) {
      for (const [name, def] of Object.entries(table)) {
        if (isObj(def)) definitions.push({ library: lib.name, name, def });
      }
    }
  }

  const operators = definitions
    .filter((x) => x.name !== '__unit__' && isOperatorDef(x.def))
    .map(({ library, name, def }) => {
      const entry: {
        name: string;
        category: string;
        arity: string;
        signature: string;
        associative: boolean;
        commutative: boolean;
        idempotent: boolean;
        lazy: boolean;
        broadcastable: boolean;
        description?: string;
        wikidata?: string;
        examples?: string[];
      } = {
        name,
        category: CATEGORY[library] ?? library,
        arity: arityFromSignature(def.signature),
        signature:
          typeof def.signature === 'string'
            ? def.signature
            : def.signature
              ? String(def.signature)
              : '(any*) -> unknown',
        associative: Boolean(def.associative),
        commutative: Boolean(def.commutative),
        idempotent: Boolean(def.idempotent),
        lazy: Boolean(def.lazy),
        broadcastable: Boolean(def.broadcastable),
      };

      const description = asDescription(def);
      if (description) entry.description = description;
      if (typeof def.wikidata === 'string' && def.wikidata !== '')
        entry.wikidata = def.wikidata;

      const examples = asExamples(def);
      if (examples) entry.examples = examples;

      return entry;
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const constants = definitions
    .filter((x) => isValueDef(x.def) && x.def.isConstant === true)
    .map(({ library, name, def }) => {
      const entry: {
        name: string;
        category: string;
        type: string;
        description?: string;
        wikidata?: string;
        value?: string;
      } = {
        name,
        category: CATEGORY[library] ?? library,
        type:
          typeof def.type === 'string'
            ? def.type
            : def.type
              ? String(def.type)
              : 'unknown',
      };

      const description = asDescription(def);
      if (description) entry.description = description;
      if (typeof def.wikidata === 'string' && def.wikidata !== '')
        entry.wikidata = def.wikidata;

      if (def.value !== undefined && typeof def.value !== 'function') {
        entry.value =
          typeof def.value === 'string' ? def.value : JSON.stringify(def.value);
      }

      return entry;
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return { operators, constants };
}

function buildCategories(payload: ReturnType<typeof buildPayload>) {
  const allCategories = new Set([
    ...Object.values(CATEGORY),
    ...payload.operators.map((x) => x.category),
    ...payload.constants.map((x) => x.category),
  ]);
  const categoryNames = Array.from(allCategories).sort((a, b) =>
    a.localeCompare(b)
  );

  const categories: Record<
    string,
    { description: string; operators: string[]; constants: string[] }
  > = {};
  for (const category of categoryNames) {
    categories[category] = {
      description: CATEGORY_DESCRIPTION[category] ?? '',
      operators: payload.operators
        .filter((x) => x.category === category)
        .map((x) => x.name)
        .sort((a, b) => a.localeCompare(b)),
      constants: payload.constants
        .filter((x) => x.category === category)
        .map((x) => x.name)
        .sort((a, b) => a.localeCompare(b)),
    };
  }

  return categories;
}

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(here, 'OPERATORS.json');
const categoriesOutputPath = resolve(dirname(outputPath), 'CATEGORIES.json');
const payload = buildPayload();
const categoriesPayload = buildCategories(payload);

writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n');
writeFileSync(
  categoriesOutputPath,
  JSON.stringify(categoriesPayload, null, 2) + '\n'
);
console.log(
  `Wrote ${outputPath} with ${payload.operators.length} operators and ${payload.constants.length} constants.`
);
console.log(
  `Wrote ${categoriesOutputPath} with ${
    Object.keys(categoriesPayload).length
  } categories.`
);
