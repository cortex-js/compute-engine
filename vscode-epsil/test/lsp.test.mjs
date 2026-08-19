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
  // A documented code links to its section of the hosted error reference.
  check(
    'the code links to its explanation',
    first?.codeDescription?.href ===
      'https://epsil.dev/errors/#static-type-error',
    JSON.stringify(first?.codeDescription)
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
    check(
      'and no codeDescription either, absent that capability',
      diagnostics[0]?.codeDescription === undefined,
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

  // A fixit-carrying diagnostic closes its hover with a preview of the line
  // as it would read once the quick fix is applied.
  const hover = await c.hover(URI, 0, 13);
  const value = hover?.contents.value ?? '';
  check(
    'the hover previews the fixed line',
    value.includes('*fix:* Use the function arrow') &&
      value.includes('```epsil\nconst f = x => x + 1\n```'),
    value
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
  const diagnostics = await c.open(URI, 'let = 42');
  // `symbol-expected` has an entry in the error reference, so it links;
  // `closing-bracket-expected` (below) has none, so it must not — a code is
  // never a dead link.
  check(
    'a documented parse-error code links to the reference',
    diagnostics[0]?.code === 'symbol-expected' &&
      diagnostics[0].codeDescription?.href ===
        'https://epsil.dev/errors/#symbol-expected',
    JSON.stringify(diagnostics[0])
  );
  const unclosed = await c.open(URI, '(1');
  check(
    'an undocumented code carries no codeDescription',
    unclosed[0]?.code === 'closing-bracket-expected' &&
      unclosed[0].codeDescription === undefined,
    JSON.stringify(unclosed[0])
  );
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

// ── Navigation: definition, references, highlights, rename ─────────────
//
// One program exercises the scope rules end to end: an outer `x`, a
// function-local `y`, a shadowing local `x` (uses above it bind outward —
// interpreter-verified semantics), and uses of everything at top level.
const NAV_SOURCE = [
  'let x = 1', //          0
  'function f() {', //     1
  ' let y = x', //         2  ← this x is the OUTER x
  ' let x = 2', //         3
  ' x + y', //             4  ← this x is the INNER x
  '}', //                  5
  'x + f(x)', //           6
].join('\n');

await scenario('navigation', undefined, async (c) => {
  await c.open(URI, NAV_SOURCE);

  const outer = await c.request('textDocument/definition', {
    textDocument: { uri: URI },
    position: { line: 6, character: 0 },
  });
  check(
    'go-to-definition from a top-level use finds the outer let',
    outer?.range.start.line === 0 && outer.range.start.character === 4,
    JSON.stringify(outer)
  );

  const inner = await c.request('textDocument/definition', {
    textDocument: { uri: URI },
    position: { line: 4, character: 1 },
  });
  check(
    'go-to-definition under a shadowing let finds the local, not the outer',
    inner?.range.start.line === 3 && inner.range.start.character === 5,
    JSON.stringify(inner)
  );

  const fn = await c.request('textDocument/definition', {
    textDocument: { uri: URI },
    position: { line: 6, character: 5 },
  });
  check(
    'go-to-definition on a call finds the function statement',
    fn?.range.start.line === 1 && fn.range.start.character === 9,
    JSON.stringify(fn)
  );

  const references = await c.request('textDocument/references', {
    textDocument: { uri: URI },
    position: { line: 0, character: 4 },
    context: { includeDeclaration: true },
  });
  check(
    'references to the outer x span its declaration and every co-binding use',
    references?.length === 4 &&
      references.some((r) => r.range.start.line === 2) &&
      references.filter((r) => r.range.start.line === 6).length === 2 &&
      // The shadowed uses on lines 3–4 belong to the INNER x.
      !references.some(
        (r) => r.range.start.line === 3 || r.range.start.line === 4
      ),
    JSON.stringify(references)
  );

  const highlights = await c.request('textDocument/documentHighlight', {
    textDocument: { uri: URI },
    position: { line: 4, character: 1 },
  });
  check(
    'occurrence highlights cover the inner x only, write-kinded at its definition',
    highlights?.length === 2 &&
      highlights[0].range.start.line === 3 &&
      highlights[0].kind === 3 && // Write
      highlights[1].range.start.line === 4 &&
      highlights[1].kind === 2, // Read
    JSON.stringify(highlights)
  );

  const prepared = await c.request('textDocument/prepareRename', {
    textDocument: { uri: URI },
    position: { line: 2, character: 5 },
  });
  check(
    'prepareRename answers the name token range and placeholder',
    prepared?.placeholder === 'y' &&
      prepared.range.start.line === 2 &&
      prepared.range.start.character === 5 &&
      prepared.range.end.character === 6,
    JSON.stringify(prepared)
  );

  const rename = await c.request('textDocument/rename', {
    textDocument: { uri: URI },
    position: { line: 2, character: 5 },
    newName: 'total',
  });
  const edits = rename?.changes?.[URI];
  check(
    'renaming the local y edits its two occurrences and nothing else',
    edits?.length === 2 &&
      edits.every((e) => e.newText === 'total') &&
      edits[0].range.start.line === 2 &&
      edits[1].range.start.line === 4 &&
      edits[1].range.start.character === 5,
    JSON.stringify(rename)
  );

  const captured = await c.requestRaw('textDocument/rename', {
    textDocument: { uri: URI },
    position: { line: 4, character: 1 },
    newName: 'y',
  });
  check(
    'a rename that would capture an existing name is refused',
    captured.error?.message.includes('already in use') === true,
    JSON.stringify(captured)
  );

  const notAName = await c.request('textDocument/definition', {
    textDocument: { uri: URI },
    position: { line: 1, character: 0 }, // the `function` keyword
  });
  check('a non-name position has no definition', notAName === null, JSON.stringify(notAName));
});

await scenario(
  'outline',
  { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
  async (c) => {
    await c.open(URI, NAV_SOURCE);
    const symbols = await c.request('textDocument/documentSymbol', {
      textDocument: { uri: URI },
    });
    const f = symbols?.find((s) => s.name === 'f');
    check(
      'the outline nests function-local declarations under the function',
      symbols?.length === 2 &&
        symbols[0].name === 'x' &&
        symbols[0].kind === 13 && // Variable
        f?.kind === 12 && // Function
        f.children.map((s) => s.name).join(',') === 'y,x',
      JSON.stringify(symbols)
    );
  }
);

await scenario('outline for a flat client', undefined, async (c) => {
  await c.open(URI, NAV_SOURCE);
  const symbols = await c.request('textDocument/documentSymbol', {
    textDocument: { uri: URI },
  });
  check(
    'a client without hierarchy support gets a flat SymbolInformation list',
    symbols?.length === 4 &&
      symbols.every((s) => s.location?.uri === URI) &&
      symbols.map((s) => s.name).join(',') === 'x,f,y,x',
    JSON.stringify(symbols)
  );
});

await scenario('rename refusals', undefined, async (c) => {
  await c.open(
    URI,
    ['type Point = tuple<number, number>', 'let z = Pi + 1', 'w = z'].join('\n')
  );

  const type = await c.requestRaw('textDocument/prepareRename', {
    textDocument: { uri: URI },
    position: { line: 0, character: 5 },
  });
  check(
    'a type cannot be renamed — its annotation uses live in strings',
    type.error?.message.includes('Cannot rename a type') === true,
    JSON.stringify(type)
  );

  const library = await c.requestRaw('textDocument/prepareRename', {
    textDocument: { uri: URI },
    position: { line: 1, character: 8 },
  });
  check(
    'a library builtin cannot be renamed',
    library.error?.message.includes('library') === true,
    JSON.stringify(library)
  );

  const reserved = await c.requestRaw('textDocument/rename', {
    textDocument: { uri: URI },
    position: { line: 1, character: 4 },
    newName: 'while',
  });
  check(
    'a reserved word is refused as a new name',
    reserved.error?.message.includes('reserved word') === true,
    JSON.stringify(reserved)
  );

  const invalid = await c.requestRaw('textDocument/rename', {
    textDocument: { uri: URI },
    position: { line: 1, character: 4 },
    newName: '9bad',
  });
  check(
    'a non-name is refused as a new name',
    invalid.error?.message.includes('not a valid symbol name') === true,
    JSON.stringify(invalid)
  );

  const collides = await c.requestRaw('textDocument/rename', {
    textDocument: { uri: URI },
    position: { line: 1, character: 4 },
    newName: 'w',
  });
  check(
    'renaming z to a name already used in its scope is refused',
    collides.error?.message.includes('already in use') === true,
    JSON.stringify(collides)
  );

  const wildcard = await c.requestRaw('textDocument/rename', {
    textDocument: { uri: URI },
    position: { line: 1, character: 4 },
    newName: '_',
  });
  check(
    'the discard wildcard is refused as a new name',
    wildcard.error?.message.includes('discard wildcard') === true,
    JSON.stringify(wildcard)
  );

  const unterminated = await c.requestRaw('textDocument/rename', {
    textDocument: { uri: URI },
    position: { line: 1, character: 4 },
    newName: '`bad',
  });
  check(
    'an unterminated verbatim spelling is refused as a new name',
    unterminated.error?.message.includes('not a valid symbol name') === true,
    JSON.stringify(unterminated)
  );

  const glyphReserved = await c.requestRaw('textDocument/rename', {
    textDocument: { uri: URI },
    position: { line: 1, character: 4 },
    newName: '∞',
  });
  check(
    'a glyph that cooks to a reserved literal is refused by its cooked name',
    glyphReserved.error?.message.includes('reserved word') === true &&
      glyphReserved.error.message.includes('Infinity'),
    JSON.stringify(glyphReserved)
  );

  const renamed = await c.request('textDocument/rename', {
    textDocument: { uri: URI },
    position: { line: 1, character: 4 },
    newName: 'q',
  });
  check(
    'a conflict-free rename of the same symbol succeeds',
    renamed?.changes?.[URI]?.length === 2,
    JSON.stringify(renamed)
  );
});

await scenario('rename capture by the library and by labels', undefined, async (c) => {
  await c.open(URI, 'k + 1');
  const intoLibrary = await c.requestRaw('textDocument/rename', {
    textDocument: { uri: URI },
    position: { line: 0, character: 0 },
    newName: 'Pi',
  });
  check(
    'a free name cannot be renamed INTO a library name',
    intoLibrary.error?.message.includes('library name') === true,
    JSON.stringify(intoLibrary)
  );

  await c.open(URI, 'g(a) = a + 1\ng(a: 2)');
  const labeled = await c.requestRaw('textDocument/prepareRename', {
    textDocument: { uri: URI },
    position: { line: 0, character: 2 },
  });
  check(
    'a parameter passed by name at a call site refuses rename',
    labeled.error?.message.includes('passes it by name') === true,
    JSON.stringify(labeled)
  );
});

await scenario('rename on a broken parse', undefined, async (c) => {
  await c.open(URI, 'q = 2\nlet = 1');
  const refused = await c.requestRaw('textDocument/rename', {
    textDocument: { uri: URI },
    position: { line: 0, character: 0 },
    newName: 'r',
  });
  check(
    'rename is refused while the file has parse errors',
    refused.error?.message.includes('parse errors') === true,
    JSON.stringify(refused)
  );
  const prepared = await c.requestRaw('textDocument/prepareRename', {
    textDocument: { uri: URI },
    position: { line: 0, character: 0 },
  });
  check(
    'prepareRename agrees with rename on a broken parse',
    prepared.error?.message.includes('parse errors') === true,
    JSON.stringify(prepared)
  );
});

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
