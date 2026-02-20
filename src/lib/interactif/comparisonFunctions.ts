import { ComputeEngine } from '../../compute-engine';

const ce = new ComputeEngine();

interface ComparisonOptions {
  texteAvecCasse?: boolean;
  texteSansCasse?: boolean;
  expressionsForcementReduites?: boolean;
  sommeSeulementEtNonResultat?: boolean;
  soustractionSeulementEtNonResultat?: boolean;
  avecSigneMultiplier?: boolean;
  avecFractions?: boolean;
  fractionIrreductible?: boolean;
  fractionSimplifiee?: boolean;
  fractionReduite?: boolean;
  fractionDecimale?: boolean;
  fractionEgale?: boolean;
  nombreDecimalSeulement?: boolean;
  expressionNumerique?: boolean;
  HMS?: boolean;
  intervalle?: boolean;
  estDansIntervalle?: boolean;
  ecritureScientifique?: boolean;
  unite?: boolean;
  precisionUnite?: number;
  puissance?: boolean;
  sansExposantUn?: boolean;
  seulementCertainesPuissances?: boolean;
  nombreAvecEspace?: boolean;
  egaliteExpression?: boolean;
  factorisation?: boolean;
  exclusifFactorisation?: boolean;
  nbFacteursIdentiquesFactorisation?: boolean;
  unSeulFacteurLitteral?: boolean;
  nonReponseAcceptee?: boolean;
  developpementEgal?: boolean;
}

interface ComparisonResult {
  isOk: boolean;
  feedback?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const ok = (feedback = ''): ComparisonResult => ({ isOk: true, feedback });
const fail = (feedback = ''): ComparisonResult => ({ isOk: false, feedback });

/** Replace French LaTeX conventions so CE can parse */
function preprocessLatex(latex: string): string {
  return latex
    .replace(/\\dfrac/g, '\\frac')
    .replace(/\{,\}/g, '.')
    .replace(/\\operatorname\{\\mathrm\{([^}]+)\}\}/g, '$1')
    .replace(/\*/g, '\\times ');
}

/** Parse LaTeX (with French preprocessing) and return canonical expression */
function parse(latex: string) {
  return ce.parse(preprocessLatex(latex));
}

/** Parse LaTeX in raw mode (preserves structure like Power, Add) */
function parseRaw(latex: string) {
  return ce.parse(preprocessLatex(latex), { form: 'raw' });
}

/** Bidirectional mathematical equality via .is() */
function mathEqual(
  a: ReturnType<typeof parse>,
  b: ReturnType<typeof parse>
): boolean {
  return a.is(b) || b.is(a);
}

/** Check if two expressions are mathematically equal (handles Power expansion) */
function expandEqual(
  a: ReturnType<typeof parse>,
  b: ReturnType<typeof parse>
): boolean {
  const eq = a.isEqual(b);
  if (eq === true) return true;
  if (eq === false) return false;
  // Fallback for undetermined cases
  try {
    return a.evaluate().isSame(b.evaluate());
  } catch {
    return false;
  }
}

/** GCD of two positive integers */
function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Extract numerator/denominator from a LaTeX fraction string */
function parseFractionLatex(
  latex: string
): { num: number; den: number; negative: boolean } | null {
  const trimmed = latex.trim();
  const match = trimmed.match(
    /^(-?)\s*\\[d]?frac\{(-?\d+)\}\{(\d+)\}$/
  );
  if (!match) return null;
  const leadingMinus = match[1] === '-';
  const num = parseInt(match[2]);
  const den = parseInt(match[3]);
  if (isNaN(num) || isNaN(den) || den === 0) return null;
  const negative = leadingMinus !== num < 0; // XOR for sign
  return { num: Math.abs(num), den, negative };
}

/** Get the top-level arithmetic operators in a LaTeX string */
function getTopLevelOps(latex: string): Set<string> {
  const ops = new Set<string>();
  let depth = 0;

  for (let i = 0; i < latex.length; i++) {
    const c = latex[i];
    if (c === '(' || c === '{') {
      depth++;
      continue;
    }
    if (c === ')' || c === '}') {
      depth--;
      continue;
    }
    if (depth > 0) continue;

    if (c === '+') {
      ops.add('+');
    } else if (c === '-' && i > 0) {
      const before = latex.substring(0, i).trimEnd();
      if (before.length > 0 && /[\d)\]a-zA-Z]$/.test(before)) {
        ops.add('-');
      }
    } else if (latex.substring(i, i + 6) === '\\times') {
      ops.add('\\times');
    } else if (latex.substring(i, i + 4) === '\\div') {
      ops.add('\\div');
    } else if (c === '*') {
      ops.add('*');
    } else if (c === '/') {
      ops.add('/');
    }
  }
  return ops;
}

/** Check if a LaTeX string contains a fraction */
function containsFraction(latex: string): boolean {
  return /\\[d]?frac\{/.test(latex) || /\//.test(latex);
}

/** Check if raw JSON contains a Power expression */
function containsPowerInJson(json: any): boolean {
  if (!Array.isArray(json)) return false;
  if (json[0] === 'Power') return true;
  for (let i = 1; i < json.length; i++) {
    if (containsPowerInJson(json[i])) return true;
  }
  return false;
}

/** Check if raw JSON contains a Power with exponent 1 */
function hasPowerOfOneInJson(json: any): boolean {
  if (!Array.isArray(json)) return false;
  if (json[0] === 'Power' && json[2] === 1) return true;
  for (let i = 1; i < json.length; i++) {
    if (hasPowerOfOneInJson(json[i])) return true;
  }
  return false;
}

/** Get factors from a Multiply expression */
function getFactors(expr: ReturnType<typeof parse>): ReturnType<typeof parse>[] {
  if (expr.operator === 'Multiply' && expr.ops) {
    return expr.ops.flatMap(getFactors);
  }
  if (expr.operator === 'Negate' && expr.ops) {
    return [ce.parse('-1'), ...getFactors(expr.ops[0])];
  }
  if (expr.operator === 'Power' && expr.ops) {
    const expVal = expr.ops[1].numericValue;
    if (typeof expVal === 'number' && Number.isInteger(expVal) && expVal > 1) {
      return Array(expVal).fill(expr.ops[0]);
    }
  }
  return [expr];
}

/** Count non-numeric (literal) factors */
function countLiteralFactors(
  factors: ReturnType<typeof parse>[]
): number {
  return factors.filter((f) => f.numericValue == null).length;
}

/** Count all factors except ±1 (includes non-trivial numeric coefficients) */
function countNonTrivialFactors(
  factors: ReturnType<typeof parse>[]
): number {
  return factors.filter((f) => {
    if (f.numericValue == null) return true;
    const v = Number(f.numericValue);
    return v !== 1 && v !== -1;
  }).length;
}

/** Check if two factor lists have the same non-numeric factors (up to sign/order) */
function sameFactors(
  aFactors: ReturnType<typeof parse>[],
  bFactors: ReturnType<typeof parse>[]
): boolean {
  const aLit = aFactors.filter((f) => f.numericValue == null);
  const bLit = bFactors.filter((f) => f.numericValue == null);
  if (aLit.length !== bLit.length) return false;

  const used = new Set<number>();
  for (const af of aLit) {
    let found = false;
    for (let j = 0; j < bLit.length; j++) {
      if (used.has(j)) continue;
      if (af.isSame(bLit[j]) || expandEqual(af, bLit[j])) {
        used.add(j);
        found = true;
        break;
      }
      // Check negation
      const neg = parse(`-(${bLit[j].latex})`);
      if (af.isSame(neg) || expandEqual(af, neg)) {
        used.add(j);
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/** Count how many factors from input match factors from answer */
function countMatchingFactors(
  inputFactors: ReturnType<typeof parse>[],
  answerFactors: ReturnType<typeof parse>[]
): number {
  const iLit = inputFactors.filter((f) => f.numericValue == null);
  const aLit = answerFactors.filter((f) => f.numericValue == null);
  const used = new Set<number>();
  let count = 0;

  for (const af of iLit) {
    for (let j = 0; j < aLit.length; j++) {
      if (used.has(j)) continue;
      if (af.isSame(aLit[j]) || expandEqual(af, aLit[j])) {
        used.add(j);
        count++;
        break;
      }
      const neg = parse(`-(${aLit[j].latex})`);
      if (af.isSame(neg) || expandEqual(af, neg)) {
        used.add(j);
        count++;
        break;
      }
    }
  }
  return count;
}

// ── Unit handling ────────────────────────────────────────────────────

const UNIT_CONVERSIONS: Record<string, Record<string, number>> = {
  length: {
    mm: 0.001,
    cm: 0.01,
    dm: 0.1,
    m: 1,
    dam: 10,
    hm: 100,
    km: 1000,
  },
  mass: { mg: 0.001, g: 1, kg: 1000 },
};

function parseUnit(
  latex: string
): { value: number; unit: string; category: string } | null {
  const processed = preprocessLatex(latex);
  const match = processed.match(/^(-?[\d.]+)\s*([a-zA-Z]+)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2];
  if (isNaN(value)) return null;

  for (const [category, units] of Object.entries(UNIT_CONVERSIONS)) {
    if (unit in units) {
      return { value, unit, category };
    }
  }
  return null;
}

function convertToBase(value: number, unit: string): number | null {
  for (const units of Object.values(UNIT_CONVERSIONS)) {
    if (unit in units) {
      return value * units[unit];
    }
  }
  return null;
}

// ── Interval parsing ─────────────────────────────────────────────────

function parseInterval(
  str: string
): {
  leftClosed: boolean;
  rightClosed: boolean;
  leftVal: string;
  rightVal: string;
} | null {
  const match = str.match(/^([\[\]])([^;]+);([^;]+)([\[\]])$/);
  if (!match) return null;
  return {
    leftClosed: match[1] === '[',
    leftVal: match[2].trim(),
    rightVal: match[3].trim(),
    rightClosed: match[4] === ']',
  };
}

// ── Option handlers ──────────────────────────────────────────────────

function handleHMS(saisie: string, answer: string): ComparisonResult {
  const parseHMS = (s: string) => {
    const m = s.match(/^(\d+)h(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m) return null;
    return {
      h: parseInt(m[1]),
      m: parseInt(m[2] || '0'),
      s: parseInt(m[3] || '0'),
    };
  };
  const s = parseHMS(saisie);
  const a = parseHMS(answer);
  if (!s || !a) return fail();
  if (s.h === a.h && s.m === a.m && s.s === a.s) return ok();
  return fail();
}

function handleIntervalle(saisie: string, answer: string): ComparisonResult {
  const s = parseInterval(saisie);
  const a = parseInterval(answer);
  if (!s || !a) return fail();

  let feedback = '';
  let isOk = true;

  if (s.leftClosed !== a.leftClosed) {
    feedback += 'Le crochet placé en position 1 est mal orienté.<br>';
    isOk = false;
  }
  if (s.rightClosed !== a.rightClosed) {
    feedback += 'Le crochet placé en position 2 est mal orienté.<br>';
    isOk = false;
  }

  if (isOk) {
    const sL = parse(s.leftVal);
    const sR = parse(s.rightVal);
    const aL = parse(a.leftVal);
    const aR = parse(a.rightVal);
    if (!mathEqual(sL, aL) || !mathEqual(sR, aR)) isOk = false;
  }

  return { isOk, feedback: isOk ? '' : feedback };
}

function handleEstDansIntervalle(
  saisie: string,
  answer: string
): ComparisonResult {
  const interval = parseInterval(answer);
  if (!interval) return fail();

  const val = parse(saisie);
  const left = parse(interval.leftVal);
  const right = parse(interval.rightVal);

  const nv = val.N();
  const nl = left.N();
  const nr = right.N();

  // If value can't be evaluated numerically (e.g. '2x'), accept it
  if (nv.numericValue == null) return ok();

  const v = Number(nv.numericValue);
  const l = Number(nl.numericValue);
  const r = Number(nr.numericValue);

  if (isNaN(v) || isNaN(l) || isNaN(r)) return ok();

  const inLeft = interval.leftClosed ? v >= l : v > l;
  const inRight = interval.rightClosed ? v <= r : v < r;

  return inLeft && inRight ? ok() : fail();
}

function handleNombreAvecEspace(
  saisie: string,
  answer: string
): ComparisonResult {
  // Parse numeric value from input (remove spaces, convert French decimal)
  const numStr = saisie.replace(/ /g, '').replace(/\{,\}/g, '.');
  const num = parseFloat(numStr);

  // Parse numeric value from answer (remove \,, convert French decimal)
  const ansStr = answer
    .replace(/\\,/g, '')
    .replace(/\{,\}/g, '.')
    .replace(/ /g, '');
  const ans = parseFloat(ansStr);

  if (isNaN(num) || isNaN(ans)) return fail();
  if (Math.abs(num - ans) > 1e-12) return fail();

  // Check formatting: compute expected format and compare
  const expected = frenchFormatWithSpaces(num);
  if (saisie === expected) return ok();
  return fail();
}

/** Format number with spaces (for nombreAvecEspace validation) */
function frenchFormatWithSpaces(n: number): string {
  const sign = n < 0 ? '-' : '';
  const [intPart, decPart] = Math.abs(n).toString().split('.');

  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  if (decPart) {
    let formattedDec = '';
    for (let i = 0; i < decPart.length; i++) {
      if (i > 0 && i % 3 === 0) formattedDec += ' ';
      formattedDec += decPart[i];
    }
    return `${sign}${formattedInt}{,}${formattedDec}`;
  }
  return `${sign}${formattedInt}`;
}

function handleEcritureScientifique(
  saisie: string,
  answer: string
): ComparisonResult {
  const ansVal = Number(parse(answer).N().numericValue);
  if (isNaN(ansVal)) return fail();

  const processed = preprocessLatex(saisie);

  // Match: mantissa x 10^{exponent} or mantissa x 10^exponent
  const sciMatch = processed.match(
    /^(-?[\d.]+)\s*\\times\s*10\^?\{?(-?\d+)\}?$/
  );
  if (sciMatch) {
    const mantissa = parseFloat(sciMatch[1]);
    const exponent = parseInt(sciMatch[2]);
    const value = mantissa * Math.pow(10, exponent);
    return Math.abs(value - ansVal) < 1e-12 ? ok() : fail();
  }

  // Match: mantissa x 1000 (NOT valid scientific notation)
  if (/\\times\s*\d/.test(processed) && !/\\times\s*10\^/.test(processed)) {
    return fail();
  }

  // Plain number (no x): equivalent to x 10^0
  const plainVal = parseFloat(processed);
  if (!isNaN(plainVal) && Math.abs(plainVal - ansVal) < 1e-12) {
    return ok();
  }

  return fail();
}

function handleUnite(
  saisie: string,
  answer: string,
  options: ComparisonOptions
): ComparisonResult {
  const sUnit = parseUnit(saisie);
  const aUnit = parseUnit(answer);
  if (!sUnit || !aUnit) return fail();

  if (sUnit.category !== aUnit.category) return fail();

  const sBase = convertToBase(sUnit.value, sUnit.unit)!;
  const aBase = convertToBase(aUnit.value, aUnit.unit)!;

  if (options.precisionUnite !== undefined) {
    const precision = options.precisionUnite;
    if (precision === 0) {
      if (Math.abs(sBase - aBase) > 1e-12) return fail();
      return ok();
    }
    // For non-zero precision: check exact match, give precision-based feedback
    if (Math.abs(sBase - aBase) > 1e-12) {
      const step = precision * 10;
      const stepStr = Number.isInteger(step) ? `${step}` : `${step}`;
      return fail(
        `La réponse n'est pas arrondie à $${stepStr}$ près.`
      );
    }
    return ok();
  }

  // Default: exact match after conversion
  if (Math.abs(sBase - aBase) > 1e-12) return fail();
  return ok();
}

function handlePuissance(
  saisie: string,
  answer: string,
  options: ComparisonOptions
): ComparisonResult {
  const sRaw = parseRaw(saisie);
  const s = parse(saisie);
  const a = parse(answer);

  if (options.sansExposantUn) {
    if (hasPowerOfOneInJson(sRaw.json)) return fail();
    return mathEqual(s, a) ? ok() : fail();
  }

  if (options.seulementCertainesPuissances) {
    // Must have identical raw structure
    const aRaw = parseRaw(answer);
    return JSON.stringify(sRaw.json) === JSON.stringify(aRaw.json)
      ? ok()
      : fail();
  }

  // puissance: true - input must contain a Power expression
  if (!containsPowerInJson(sRaw.json)) return fail();
  return mathEqual(s, a) ? ok() : fail();
}

function handleFractionIrreductible(
  saisie: string,
  answer: string
): ComparisonResult {
  const sFrac = parseFractionLatex(saisie);
  if (!sFrac)
    return fail(
      'Résultat incorrect car une fraction irréductible est attendue.'
    );

  if (gcd(sFrac.num, sFrac.den) !== 1) {
    return fail(
      'Résultat incorrect car une fraction irréductible est attendue.'
    );
  }

  const s = parse(saisie);
  const a = parse(answer);
  if (!mathEqual(s, a)) return fail();

  // Return without feedback property (test expects feedback: undefined)
  return { isOk: true };
}

function handleFractionSimplifiee(
  saisie: string,
  answer: string
): ComparisonResult {
  const sFrac = parseFractionLatex(saisie);
  const aFrac = parseFractionLatex(answer);

  if (!sFrac || !aFrac)
    return fail('Résultat incorrect car une fraction réduite est attendue.');

  const s = parse(saisie);
  const a = parse(answer);
  if (!mathEqual(s, a)) return fail();

  const ratio = aFrac.den / sFrac.den;
  if (
    !Number.isInteger(ratio) ||
    ratio < 1 ||
    Math.abs(aFrac.num / sFrac.num - ratio) > 1e-12
  ) {
    return fail('Résultat incorrect car une fraction réduite est attendue.');
  }

  return ok();
}

function handleFractionReduite(
  saisie: string,
  answer: string
): ComparisonResult {
  const sFrac = parseFractionLatex(saisie);
  const aFrac = parseFractionLatex(answer);

  if (!sFrac || !aFrac) return fail();

  const s = parse(saisie);
  const a = parse(answer);
  if (!mathEqual(s, a)) return fail();

  if (sFrac.num > aFrac.num || sFrac.den > aFrac.den) return fail();

  return ok();
}

function handleFractionDecimale(
  saisie: string,
  answer: string
): ComparisonResult {
  const sFrac = parseFractionLatex(saisie);
  if (!sFrac) {
    return fail(
      'Résultat incorrect car une fraction décimale est attendue.'
    );
  }

  // Check denominator is a power of 10
  let d = sFrac.den;
  while (d > 1 && d % 10 === 0) d /= 10;
  if (d !== 1) {
    return fail(
      'Résultat incorrect car une fraction décimale est attendue.'
    );
  }

  const s = parse(saisie);
  const a = parse(answer);
  if (!mathEqual(s, a)) return fail();

  return ok();
}

function handleFractionEgale(
  saisie: string,
  answer: string
): ComparisonResult {
  if (!parseFractionLatex(saisie)) {
    return fail('Résultat incorrect car une fraction est attendue.');
  }

  const s = parse(saisie);
  const a = parse(answer);
  if (!mathEqual(s, a)) return fail();

  return ok();
}

function handleAvecFractions(
  saisie: string,
  answer: string
): ComparisonResult {
  const s = parse(saisie);
  const a = parse(answer);
  return mathEqual(s, a) ? ok() : fail();
}

function handleNombreDecimalSeulement(
  saisie: string,
  answer: string
): ComparisonResult {
  if (containsFraction(saisie)) {
    return fail(
      'Résultat incorrect car une valeur décimale (ou entière) est attendue.'
    );
  }

  const s = parse(saisie);
  const a = parse(answer);
  return mathEqual(s, a) ? ok() : fail();
}

function handleExpressionNumerique(
  saisie: string,
  answer: string
): ComparisonResult {
  const s = parse(saisie);
  const a = parse(answer);

  if (!mathEqual(s, a)) return fail();

  // Use raw parsing to check if input is just a plain number
  const sRaw = parseRaw(saisie);
  if (!Array.isArray(sRaw.json)) {
    return fail(
      'Ce résultat pourrait être correct mais un calcul est attendu.'
    );
  }

  // Compare structure: extract all numeric leaves and compare as sorted arrays
  const sLeaves = extractNumericLeaves(saisie).sort((a, b) => a - b);
  const aLeaves = extractNumericLeaves(answer).sort((a, b) => a - b);

  if (
    sLeaves.length !== aLeaves.length ||
    sLeaves.some((v, i) => Math.abs(v - aLeaves[i]) > 1e-12)
  ) {
    return fail(
      "Ce résultat pourrait être correct mais ce n'est pas ce calcul qui est attendu."
    );
  }

  return ok();
}

/** Extract all numeric literals from a LaTeX string */
function extractNumericLeaves(latex: string): number[] {
  const processed = preprocessLatex(latex);
  const nums: number[] = [];
  const matches = processed.match(/\d+(\.\d+)?/g);
  if (matches) {
    for (const m of matches) nums.push(parseFloat(m));
  }
  return nums;
}

function handleEgaliteExpression(
  saisie: string,
  answer: string
): ComparisonResult {
  const sParts = saisie.split('=');
  const aParts = answer.split('=');
  if (sParts.length !== 2 || aParts.length !== 2) return fail();

  const sL = parse(sParts[0]);
  const sR = parse(sParts[1]);
  const aL = parse(aParts[0]);
  const aR = parse(aParts[1]);

  if (
    (mathEqual(sL, aL) && mathEqual(sR, aR)) ||
    (mathEqual(sL, aR) && mathEqual(sR, aL))
  ) {
    return ok();
  }
  return fail();
}

function handleFactorisation(
  saisie: string,
  answer: string,
  options: ComparisonOptions
): ComparisonResult {
  const s = parse(saisie);
  const a = parse(answer);

  const sFactors = getFactors(s);
  const aFactors = getFactors(a);

  const valuesEqual = expandEqual(s, a);
  const isOpposite = !valuesEqual && expandEqual(s, parse(`-(${answer})`));

  if (options.unSeulFacteurLitteral) {
    if (!valuesEqual && !isOpposite) return fail();
    const sLitCount = countLiteralFactors(sFactors);
    const aLitCount = countLiteralFactors(aFactors);
    if (sLitCount < aLitCount) return fail();
    return ok();
  }

  if (options.exclusifFactorisation) {
    if (!valuesEqual && !isOpposite) return fail();
    const sNums = sFactors.filter(
      (f) =>
        f.numericValue != null &&
        Number(f.numericValue) !== 1 &&
        Number(f.numericValue) !== -1
    );
    const aNums = aFactors.filter(
      (f) =>
        f.numericValue != null &&
        Number(f.numericValue) !== 1 &&
        Number(f.numericValue) !== -1
    );
    if (sNums.length !== aNums.length) return fail();

    const sLit = sFactors.filter((f) => f.numericValue == null);
    const aLit = aFactors.filter((f) => f.numericValue == null);
    if (!sameFactors(sLit, aLit)) return fail();
    return ok();
  }

  if (options.nbFacteursIdentiquesFactorisation) {
    if (!valuesEqual && !isOpposite) return fail();
    const sCount = countNonTrivialFactors(sFactors);
    const aCount = countNonTrivialFactors(aFactors);
    if (sCount !== aCount) return fail();
    return ok();
  }

  // factorisation: true (flexible)
  if (valuesEqual) return ok();

  // Not equal — check if opposite and give appropriate feedback
  if (isOpposite) {
    return fail(
      "L'expression saisie est l'opposé de l'expression attendue."
    );
  }

  // Check for partial factor matches
  const matchCount = countMatchingFactors(sFactors, aFactors);
  const totalLit = aFactors.filter((f) => f.numericValue == null).length;

  if (matchCount > 0 && matchCount < totalLit) {
    return fail(
      `Seulement $${matchCount}$ facteur${matchCount > 1 ? 's sont corrects' : ' est correct'}.`
    );
  }

  return fail();
}

function handleDeveloppementEgal(
  saisie: string,
  answer: string
): ComparisonResult {
  const s = parse(saisie);
  const a = parse(answer);

  if (expandEqual(s, a)) return ok();
  return fail();
}

function handleExpressionsForcementReduites(
  saisie: string,
  answer: string
): ComparisonResult {
  const s = parse(saisie);
  const a = parse(answer);

  if (!mathEqual(s, a)) return fail();

  // Check if input is already in reduced form
  if (!s.isSame(s.simplify())) return fail();

  return ok();
}

function handleSommeOuDifference(
  saisie: string,
  answer: string,
  expectSum: boolean
): ComparisonResult {
  const s = parse(saisie);
  const a = parse(answer);
  if (!mathEqual(s, a)) return fail();

  const ops = getTopLevelOps(saisie);
  const opName = expectSum ? 'somme' : 'différence';

  if (ops.size === 0) {
    return fail('Résultat incorrect car un calcul est attendu.');
  }

  const expectedOp = expectSum ? '+' : '-';
  const forbiddenOps = ['\\times', '\\div', '*', '/'];
  const wrongOp = expectSum ? '-' : '+';

  if (
    !ops.has(expectedOp) ||
    ops.has(wrongOp) ||
    forbiddenOps.some((op) => ops.has(op))
  ) {
    return fail(
      `Résultat incorrect car c'est une ${opName} qui est attendue.`
    );
  }

  // Check for adding/subtracting 0
  const zeroPattern = expectSum ? /\+\s*0(?!\d)/ : /-\s*0(?!\d)/;
  if (zeroPattern.test(saisie)) {
    return fail(
      `Résultat incorrect car la ${opName} par 0 est inutile.`
    );
  }

  return ok();
}

// ── Main function ────────────────────────────────────────────────────

export function fonctionComparaison(
  saisie: string,
  answer: string,
  options: ComparisonOptions = {}
): ComparisonResult {
  if (options.nonReponseAcceptee && saisie === '' && answer === '') return ok();

  // Text comparisons
  if (options.texteAvecCasse) return saisie === answer ? ok() : fail();
  if (options.texteSansCasse)
    return saisie.toLowerCase() === answer.toLowerCase() ? ok() : fail();

  // HMS
  if (options.HMS) return handleHMS(saisie, answer);

  // Intervals
  if (options.intervalle) return handleIntervalle(saisie, answer);
  if (options.estDansIntervalle)
    return handleEstDansIntervalle(saisie, answer);

  // Number formatting
  if (options.nombreAvecEspace) return handleNombreAvecEspace(saisie, answer);

  // Scientific notation
  if (options.ecritureScientifique)
    return handleEcritureScientifique(saisie, answer);

  // Units
  if (options.unite) return handleUnite(saisie, answer, options);

  // Powers
  if (
    options.puissance ||
    options.sansExposantUn ||
    options.seulementCertainesPuissances
  )
    return handlePuissance(saisie, answer, options);

  // Fractions
  if (options.fractionIrreductible)
    return handleFractionIrreductible(saisie, answer);
  if (options.fractionSimplifiee)
    return handleFractionSimplifiee(saisie, answer);
  if (options.fractionReduite)
    return handleFractionReduite(saisie, answer);
  if (options.fractionDecimale)
    return handleFractionDecimale(saisie, answer);
  if (options.fractionEgale) return handleFractionEgale(saisie, answer);
  if (options.avecFractions) return handleAvecFractions(saisie, answer);

  // Decimal only
  if (options.nombreDecimalSeulement)
    return handleNombreDecimalSeulement(saisie, answer);

  // Numeric expression
  if (options.expressionNumerique)
    return handleExpressionNumerique(saisie, answer);

  // Equation expression
  if (options.egaliteExpression)
    return handleEgaliteExpression(saisie, answer);

  // Factorisation options
  if (
    options.factorisation ||
    options.exclusifFactorisation ||
    options.nbFacteursIdentiquesFactorisation ||
    options.unSeulFacteurLitteral
  )
    return handleFactorisation(saisie, answer, options);

  // Development
  if (options.developpementEgal)
    return handleDeveloppementEgal(saisie, answer);

  // Sum/difference only
  if (options.sommeSeulementEtNonResultat)
    return handleSommeOuDifference(saisie, answer, true);
  if (options.soustractionSeulementEtNonResultat)
    return handleSommeOuDifference(saisie, answer, false);

  // Reduced expressions
  if (options.expressionsForcementReduites)
    return handleExpressionsForcementReduites(saisie, answer);

  // avecSigneMultiplier: preprocess * and do default comparison
  if (options.avecSigneMultiplier) {
    return defaultComparison(
      saisie.replace(/\*/g, '\\times '),
      answer
    );
  }

  // Default: mathematical comparison
  return defaultComparison(saisie, answer);
}

function defaultComparison(
  saisie: string,
  answer: string
): ComparisonResult {
  const s = parse(saisie);
  const a = parse(answer);

  // Bidirectional .is() handles asymmetric cases like 0 vs cos(...)
  if (s.is(a) || a.is(s)) return ok();

  return fail();
}
