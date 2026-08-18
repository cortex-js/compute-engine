// End-to-end tests for the Epsil language server, driven over stdio LSP —
// the same wire protocol VS Code speaks. Run with `npm test` (which builds
// first); each scenario spawns a fresh server process.
import { LspClient } from './lsp-client.mjs';

const URI = 'file:///tmp/lsp-test.epsil';

let failures = 0;
let current = '';
function check(label, ok, detail) {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}: [${current}] ${label}${ok ? '' : ` — ${detail}`}`
  );
  if (!ok) failures += 1;
}

async function scenario(name, capabilities, body) {
  current = name;
  const client = new LspClient(capabilities);
  try {
    await client.initialize();
    await body(client);
  } catch (error) {
    check('scenario completed', false, error.stack ?? error.message);
  } finally {
    client.kill();
  }
}

// ── Hover ───────────────────────────────────────────────────────────────
const HOVER_SOURCE = [
  'function foo(x: string, n: integer) { x }',
  '// remember to call Length here',
  'const s = "call Length first"',
  'const total = Length([1, 2, 3]) + Pi',
  '/// Doubles its argument.',
  '/// Second **line**.',
  'twice(x) = 2 * x',
].join('\n');

await scenario('hover', undefined, async (c) => {
  await c.open(URI, HOVER_SOURCE);

  const length = await c.hover(URI, 3, 14);
  check(
    'a library function shows its signature and description',
    length?.contents.value.includes('Length: (any) -> integer') === true &&
      length.contents.value.includes('*function*') &&
      length.contents.value.toLowerCase().includes('number of elements'),
    JSON.stringify(length)
  );
  check(
    'the hover range covers the name',
    length?.range.start.character === 14 && length.range.end.character === 20,
    JSON.stringify(length?.range)
  );

  const pi = await c.hover(URI, 3, 34);
  check(
    'a constant shows its type and value',
    pi?.contents.value.includes('Pi: finite_real') === true &&
      pi.contents.value.includes('3.14159'),
    JSON.stringify(pi)
  );

  const foo = await c.hover(URI, 0, 10);
  check(
    "a function defined in the file shows its header, not its body",
    foo?.contents.value.includes(
      'function foo(x: string, n: integer)'
    ) === true && !foo.contents.value.includes('{'),
    JSON.stringify(foo)
  );

  const documented = await c.hover(URI, 6, 1);
  check(
    'a documented function shows its doc comment below the header',
    documented?.contents.value.includes('twice(x)') === true &&
      documented.contents.value.includes('Doubles its argument.') &&
      documented.contents.value.includes('Second **line**.') &&
      !documented.contents.value.includes('///'),
    JSON.stringify(documented)
  );

  const declared = await c.hover(URI, 3, 6);
  check(
    'a const shows its declaring statement',
    declared?.contents.value.includes('const total = Length([1, 2, 3]) + Pi') ===
      true,
    JSON.stringify(declared)
  );

  // Text that merely LOOKS like a name is not one: the lexer decides.
  const inComment = await c.hover(URI, 1, 21);
  check('a name inside a comment has no hover', inComment === null, JSON.stringify(inComment));
  const inString = await c.hover(URI, 2, 17);
  check('a name inside a string has no hover', inString === null, JSON.stringify(inString));
  const onNumber = await c.hover(URI, 3, 24);
  check('a number has no hover', onNumber === null, JSON.stringify(onNumber));
  const onKeyword = await c.hover(URI, 0, 0);
  check('a keyword has no hover', onKeyword === null, JSON.stringify(onKeyword));
});

// ── Diagnostics: signature notes ────────────────────────────────────────
await scenario('signature notes', undefined, async (c) => {
  const diagnostics = await c.open(URI, 'let a = Ln()\na');
  const [first] = diagnostics;
  // For a full-capability client the message is a one-line headline: notes
  // live in the hover's markdown section instead of being folded in.
  check(
    'the message stays a one-line headline without the note',
    first !== undefined &&
      !first.message.includes('note:') &&
      !first.message.includes('\n'),
    JSON.stringify(diagnostics)
  );
  check(
    'the diagnostic keeps its code and severity',
    first?.code === 'static-type-error' && first.severity === 1,
    JSON.stringify(first)
  );
  const hover = await c.hover(URI, 0, 9);
  check(
    'the signature note appears in the hover instead',
    hover?.contents.value.includes(
      '*note:* `Ln` has signature `(number, base: number?) -> number`'
    ) === true,
    JSON.stringify(hover)
  );
});

await scenario('user-defined callee', undefined, async (c) => {
  // The static pass checks calls to a function the file itself defines, so
  // the definition site is reachable — and becomes navigable related
  // information rather than a sentence.
  const diagnostics = await c.open(
    URI,
    'function parseDigits(cs: string, i: integer) {\n  i\n}\n\nparseDigits("42")'
  );
  const [first] = diagnostics;
  check(
    'a wrong call to a local function is reported, headline only',
    first?.message.includes('a required argument is missing') === true &&
      !first.message.includes('note:') &&
      !first.message.includes('has signature'),
    JSON.stringify(diagnostics)
  );
  check(
    'the definition is published as related information',
    first?.relatedInformation?.[0]?.message === '`parseDigits` is defined here' &&
      first.relatedInformation[0].location.range.start.line === 0 &&
      first.relatedInformation[0].location.range.start.character === 9,
    JSON.stringify(first?.relatedInformation)
  );
  check(
    'and the call itself is what gets underlined',
    first?.range.start.line === 4 && first.range.start.character === 0,
    JSON.stringify(first?.range)
  );
});

// ── Hover: the diagnostic's notes rendered rich ─────────────────────────
// `Diagnostic.message` is plain text wherever the editor shows it, so it is
// kept to a one-line headline; the notes appear only in the hover, as
// markdown — backtick quotes become code spans, and a "defined here" note
// quotes the definition line in a highlighted code block.
await scenario('diagnostic hover', undefined, async (c) => {
  await c.open(
    URI,
    'function parseDigits(cs: string, i: integer) {\n  i\n}\n\nparseDigits("42")'
  );

  const onCall = await c.hover(URI, 4, 3);
  const value = onCall?.contents.value ?? '';
  check(
    'the headline is not restated in the hover markdown',
    !value.includes('a required argument is missing'),
    JSON.stringify(onCall)
  );
  check(
    'notes render as their own paragraphs',
    value.includes('*note:*') && value.includes('`parseDigits` has signature'),
    value
  );
  // Hovering the callee's NAME: the symbol hover already captions this very
  // declaration, so the note's own "Declaration of …" quote is elided
  // rather than shown twice.
  check(
    'the "defined here" quote is elided when the symbol hover shows it',
    value.split('Declaration of `parseDigits`').length === 2 &&
      !value.includes('is defined here') &&
      !value.includes('function parseDigits(cs: string, i: integer) {'),
    value
  );
  check(
    'the symbol hover follows, separated by a rule',
    value.includes('\n\n---\n\n') &&
      // The declaration hover quotes the HEADER, which stops before the body.
      value.includes(
        '```epsil\nfunction parseDigits(cs: string, i: integer)\n```'
      ),
    value
  );

  // Inside the argument string there is no identifier, so this hover is
  // served by the diagnostic alone — no symbol hover, no elision, and it
  // anchors to no range. The note reads like the declaration hover and
  // quotes the raw source LINE (brace included).
  const inArgument = await c.hover(URI, 4, 13);
  const argValue = inArgument?.contents.value ?? '';
  check(
    'a diagnostic hover needs no identifier under the cursor',
    argValue.includes('`parseDigits` has signature') &&
      argValue.includes('Declaration of `parseDigits` (line 1):') &&
      argValue.includes(
        '```epsil\nfunction parseDigits(cs: string, i: integer) {'
      ) &&
      inArgument.range === undefined,
    JSON.stringify(inArgument)
  );

  // Away from the diagnostic, the hover is the plain symbol hover.
  const offDiagnostic = await c.hover(URI, 0, 10);
  check(
    'off the diagnostic no error section is added',
    offDiagnostic?.contents.value.includes('note:') === false,
    JSON.stringify(offDiagnostic)
  );

  // The overlap is half-open, matching the published range: the call's last
  // character (the `)` at 16) is covered, the position just past it is not.
  const atLastChar = await c.hover(URI, 4, 16);
  check(
    'the diagnostic hover covers its last character',
    atLastChar?.contents.value.includes('`parseDigits` has signature') === true,
    JSON.stringify(atLastChar)
  );
  const pastEnd = await c.hover(URI, 4, 17);
  check(
    'and stops at the end of the underline',
    pastEnd === null,
    JSON.stringify(pastEnd)
  );
});

await scenario('diagnostic hover with CR line endings', undefined, async (c) => {
  // Lines separated by lone carriage returns — a break the language (and the
  // diagnostic renderer) recognizes. The quoted line and the line numbers
  // must follow those rules, not just '\n'.
  await c.open(
    URI,
    'function parseDigits(cs: string, i: integer) {\r  i\r}\r\rparseDigits("42")'
  );
  // Inside the argument string: no symbol hover, so the "defined here" note
  // renders in full.
  const hover = await c.hover(URI, 4, 13);
  const value = hover?.contents.value ?? '';
  check(
    'the "defined here" quote is the definition line, not the whole document',
    value.includes(
      '```epsil\nfunction parseDigits(cs: string, i: integer) {\n```'
    ),
    value
  );
  check(
    'captions still number lines correctly',
    value.includes('Declaration of `parseDigits` (line 1):'),
    value
  );
});

await scenario(
  'signature notes without relatedInformation',
  { textDocument: { publishDiagnostics: {} } },
  async (c) => {
    const diagnostics = await c.open(URI, 'let a = Ln()\na');
    check(
      'a client without the capability still gets the note',
      diagnostics[0]?.message.includes('note: `Ln` has signature') === true,
      JSON.stringify(diagnostics)
    );
    check(
      'and no relatedInformation is sent',
      diagnostics[0]?.relatedInformation === undefined,
      JSON.stringify(diagnostics[0])
    );
  }
);

// ── Diagnostics: the plain path still works ─────────────────────────────
await scenario('fixit diagnostic', undefined, async (c) => {
  const diagnostics = await c.open(URI, 'const f = x -> x + 1');
  check(
    'the mapsto-arrow diagnostic underlines just the arrow',
    diagnostics[0]?.range.start.character === 12 &&
      diagnostics[0].range.end.character === 14,
    JSON.stringify(diagnostics[0]?.range)
  );
  check(
    'and carries the explanation as its message',
    diagnostics[0]?.message.includes('use the mapsto arrow "=>"') === true,
    JSON.stringify(diagnostics[0]?.message)
  );
});

// ── Representation views (the `epsil/view` request) ────────────────────
await scenario('representation views', undefined, async (c) => {
  // The trig argument is the variable `x`, not a constant: the compiler folds
  // any constant subtree at compile time, so `Sin(Pi / 6)` would reach the
  // compiled views as the literal `0.5` and the checks below could not see
  // whether each target lowers `Sin` to its own spelling.
  await c.open(URI, 'let x = 42\nx + Sin(x / 6)');

  const ast = await c.request('epsil/view', { uri: URI, view: 'ast' });
  check(
    'the parsed view shows shorthand MathJSON of the raw parse',
    ast?.content.includes('"Block"') === true &&
      ast.content.includes('"Declare"') &&
      // `let` parse sugar, still undesugared at this stage.
      ast.content.includes('"KeyValuePair"') &&
      ast.content.startsWith('// MathJSON as parsed'),
    JSON.stringify(ast)
  );

  const canonical = await c.request('epsil/view', {
    uri: URI,
    view: 'canonical',
  });
  check(
    'the canonical view lists one entry per statement',
    canonical?.content.startsWith('// Canonical MathJSON') === true &&
      canonical.content.includes('["Declare","x"') &&
      canonical.content.includes('"Sin"'),
    JSON.stringify(canonical)
  );

  const js = await c.request('epsil/view', { uri: URI, view: 'javascript' });
  check(
    'the JavaScript view shows the compiled program',
    js?.content.includes('let x = 42') === true &&
      js.content.includes('Math.sin'),
    JSON.stringify(js)
  );

  const py = await c.request('epsil/view', { uri: URI, view: 'python' });
  check(
    'the Python view shows the compiled program, commented in Python',
    py?.content.startsWith('# Compiled to Python') === true &&
      py.content.includes('np.sin'),
    JSON.stringify(py)
  );

  const glsl = await c.request('epsil/view', { uri: URI, view: 'glsl' });
  check(
    'the GLSL view shows the compiled program',
    glsl?.content.startsWith('// Compiled to GLSL') === true &&
      glsl.content.includes('float x;'),
    JSON.stringify(glsl)
  );

  const unknown = await c.request('epsil/view', {
    uri: 'file:///tmp/not-open.epsil',
    view: 'ast',
  });
  check('a document the server is not tracking yields null', unknown === null, JSON.stringify(unknown));
});

await scenario('representation views on a broken program', undefined, async (c) => {
  await c.open(URI, 'let = 42');

  const ast = await c.request('epsil/view', { uri: URI, view: 'ast' });
  check(
    'the parsed view reports the errors and still shows the recovered AST',
    ast?.content.includes('// error, line 1:') === true,
    JSON.stringify(ast)
  );

  const canonical = await c.request('epsil/view', {
    uri: URI,
    view: 'canonical',
  });
  check(
    'the canonicalizing views decline until the program parses',
    canonical?.content.includes('needs a program that parses') === true &&
      canonical.content.includes('// error, line 1:'),
    JSON.stringify(canonical)
  );
});

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
