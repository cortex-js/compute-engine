import { ComputeEngine } from '../../src/compute-engine';

/**
 * Assigning a FUNCTION LITERAL to a subscripted name is an explicit error
 * (user ruling 2026-08-15, option (d) — see the "Assigning a lambda to a
 * SUBSCRIPTED name" entry in ROADMAP.md).
 *
 * The notation `l_P := P ↦ body` is genuinely ambiguous: it reads either as
 * defining a function NAMED `l_P` (Desmos treats a subscript as pure
 * spelling — documents routinely use `f` and `f_x` as unrelated names) or as
 * defining a FAMILY `l` indexed by `P` whose members are functions
 * (`T_n := x ↦ cos(n·arccos x)`). Before the ruling, every variant fell into
 * the sequence-definition machinery, which bound the BASE letter to a
 * function-returning-function nobody intended — or nothing at all — and
 * reported nothing: the assignment silently vanished (it took two sessions
 * to attribute; the Desmos importer independently measured a base-letter
 * clobber through its public `definitions` seam).
 *
 * Corpus-safety (field-verified by the Tycho importer, 687 states): their
 * pipeline only ever emits head-application assignments (`l_P(P) := …`), so
 * the error is unreachable from imported Desmos content. The neighboring
 * spellings pinned below must keep working verbatim.
 */

const LAMBDA_BODY = 'P \\mapsto \\sqrt{P[1]^2+P[2]^2}';

describe('subscripted-name LHS with a function-literal RHS is refused', () => {
  test('undeclared joined name: error, and NOTHING is bound', () => {
    const ce = new ComputeEngine();
    const r = ce
      .parse(`l_{P}\\coloneq ${LAMBDA_BODY}`, { strict: false })
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(JSON.stringify(r.json)).toContain('ambiguous-assignment');
    // The pre-ruling behavior bound the BASE letter to a
    // function-returning-function; neither symbol may be touched now.
    expect(ce.box('l').evaluate().toString()).toBe('l');
    expect(ce.box('l_P').evaluate().toString()).toBe('"l_P"');
  });

  test('declared joined name + lambda: BINDS the declared symbol (declared-wins ruling)', () => {
    // Declaration presence resolves the ambiguity (second-half ruling,
    // 2026-08-15): the declared joined name takes the assignment, so the
    // lambda binds `l_P` — the original Tycho row-4 shape is functional —
    // and the `ambiguous-assignment` error covers the UNDECLARED case only.
    const ce = new ComputeEngine();
    ce.declare('l_P', { signature: '(unknown) -> unknown' });
    const r = ce
      .parse(`l_{P}\\coloneq ${LAMBDA_BODY}`, { strict: false })
      .evaluate();
    expect(r.operator).not.toBe('Error');
    expect(
      ce.parse('l_{P}([3,4])', { strict: false }).evaluate().toString()
    ).toBe('5');
  });

  test('numeric subscript: same error (`b_1 := x ↦ x²` was garbage too)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .parse('b_1 \\coloneq x \\mapsto x^2', { strict: false })
      .evaluate();
    expect(r.operator).toBe('Error');
  });

  test('the error names the disambiguating spellings', () => {
    const ce = new ComputeEngine();
    const r = ce
      .parse(`l_{P}\\coloneq ${LAMBDA_BODY}`, { strict: false })
      .evaluate();
    const s = JSON.stringify(r.json);
    expect(s).toContain('l_P');
    expect(s).toContain('ambiguous');
  });
});

describe('the neighboring spellings are unchanged', () => {
  test('integer recurrence: a_1 := 1; a_n := a_{n-1} + 2', () => {
    const ce = new ComputeEngine();
    ce.parse('a_1 \\coloneq 1', { strict: false }).evaluate();
    ce.parse('a_n \\coloneq a_{n-1} + 2', { strict: false }).evaluate();
    expect(ce.parse('a_4', { strict: false }).evaluate().toString()).toBe('7');
  });

  test('non-lambda family: l_P := P² + 1 defines l', () => {
    const ce = new ComputeEngine();
    ce.parse('l_P \\coloneq P^2 + 1', { strict: false }).evaluate();
    expect(ce.parse('l(3)', { strict: false }).evaluate().toString()).toBe(
      '10'
    );
  });

  test('head-application defines the joined symbol (the Tycho importer shape)', () => {
    const ce = new ComputeEngine();
    ce.declare('l_P', { signature: '(unknown) -> unknown' });
    ce.parse('l_{P}(P)\\coloneq \\sqrt{P[1]^2+P[2]^2}', {
      strict: false,
    }).evaluate();
    expect(
      ce.parse('l_{P}([3,4])', { strict: false }).evaluate().toString()
    ).toBe('5');
  });

  test('declared joined name + expression: assigns the SYMBOL, base letter untouched', () => {
    // The collision case the declared-wins ruling exists for: a declared
    // `l_P` must take `l_{P} := P²+1` as a value assignment — defining a
    // family on the base letter `l` instead would silently shadow the
    // declaration (and documents use `f` and `f_x` as unrelated names).
    const ce = new ComputeEngine();
    ce.declare('l_P', 'unknown');
    ce.parse('l_{P} \\coloneq P^2+1', { strict: false }).evaluate();
    expect(ce.box('l_P').evaluate().toString()).toBe('P^2 + 1');
    expect(ce.box('l').evaluate().toString()).toBe('l');
  });

  test('declared NUMERIC joined name wins over the sequence base case', () => {
    const ce = new ComputeEngine();
    ce.declare('b_1', 'number');
    ce.parse('b_1 \\coloneq 5', { strict: false }).evaluate();
    expect(ce.box('b_1').evaluate().toString()).toBe('5');
  });

  test('re-running a sequence base case still updates the sequence store', () => {
    // Sequence definitions register no `a_1`/`a_n` symbol definitions, so
    // declared-wins never captures a recurrence re-run.
    const ce = new ComputeEngine();
    ce.parse('a_1 \\coloneq 1', { strict: false }).evaluate();
    ce.parse('a_1 \\coloneq 3', { strict: false }).evaluate();
    ce.parse('a_n \\coloneq a_{n-1} + 2', { strict: false }).evaluate();
    expect(ce.parse('a_3', { strict: false }).evaluate().toString()).toBe('7');
  });

  test('the API route is untouched: ce.assign(name, ⟨Function value⟩)', () => {
    // The ruling is notation-level. Consumers assign lambda VALUES to
    // subscript-spelled names via the API (the importer's alias and
    // recursive-lambda routes) — that must keep working.
    const ce = new ComputeEngine();
    ce.assign('m_1', ce.parse('x \\mapsto 2x', { strict: false }));
    expect(ce.parse('m_1(4)', { strict: false }).evaluate().toString()).toBe(
      '8'
    );
  });
});
