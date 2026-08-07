---
title: Epsil Pragmas
sidebar_label: Pragmas
slug: /epsil/pragmas/
description: "Pragmas in Epsil: source forms the parser evaluates, injecting environment variables and other host values into MathJSON before the program runs."
hide_title: true
date: Last Modified
---
# Pragmas

Pragmas are source forms evaluated by the Epsil parser. Their values are
inserted into the produced MathJSON before ordinary program execution begins.

## Environment Variables

Environment variables are defined in the host process when Epsil is parsed
under Node.js. In Unix, they are set using a
shell-specific syntax (`export VARIABLE=value` in bash shells, for example).

Environment variables are not normally available when parsing takes place in a
browser.

Use `#env()` to read an environment variable:

<!-- epsil-test: expect-diagnostics -->

```epsil
#env("DEBUG")
```

Some common environment variables include:

- `NO_COLOR`: if set, color output to the terminal should be avoided
- `TERM`: describe the capabilities of the output terminal, e.g.
  `xterm-256color`
- `HOME`: path to the user home directory
- `TEMP`: path to a temporary file directory

`#env()` reads host state and is therefore disabled by default. Calling
`parseEpsil()` or `executeEpsil()` without opting in produces a
`host-pragma-disabled` diagnostic and the value `Nothing`. A trusted host can
enable it with `{ allowHostPragmas: true }`.

### Navigator Properties

Navigator properties are available when parsing takes place in a browser.

Use `#navigator()` to read a property of the browser's `navigator` object. Like
`#env()`, it is disabled unless the host passes
`{ allowHostPragmas: true }`. It returns `Nothing` when the browser property is
not available.

<!-- epsil-test: expect-diagnostics -->

```epsil
#navigator("userAgent")
```

## Parser Messages

`#error()` stops parsing. A direct call to `parseEpsil()` throws a
`FatalParsingError`; `executeEpsil()` catches it and returns an
`error-directive` diagnostic instead:

<!-- epsil-test: expect-diagnostics -->

```epsil
#error("File cannot be compiled")
```

`#warning()` does not write to the console and does not add a diagnostic. It
evaluates at parse time to its message string, allowing parsing to continue:

```epsil
#warning("TODO: Implement function")
```

## Other Pragmas

The following pragmas are replaced with the indicated value:

- `#line`: the current source line number. The first line is line 1.
- `#column`: the current column number. The first column is column 1.
- `#url`: the source URL passed to `parseEpsil()` or `executeEpsil()`, or
  `Nothing` when none was supplied.
- `#filename`: the final path component of the source URL, or `Nothing` when no
  URL was supplied.
- `#date`: the current date in the `YYYY-MM-DD` format.
- `#time`: the current time in the `HH:MM:SS` format.

These six pragmas are always available. Epsil does not currently implement a
pragma for overriding the source location.
