---
title: Epsil Pragmas
sidebar_label: Pragmas
slug: /epsil/pragmas/
description: "Pragmas in Epsil: source forms the parser evaluates, injecting environment variables and other host values into a program before it runs."
hide_title: true
date: Last Modified
---
# Pragmas

Pragmas are source forms evaluated by the Epsil parser rather than at run time.
A pragma is replaced by its value while the program is being read, before
execution begins.

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

`#env()` reads host state and is therefore disabled by default: without
opting in, it produces a `host-pragma-disabled` diagnostic and the value
`Nothing`. A trusted host can enable it.

### Navigator Properties

Navigator properties are available when parsing takes place in a browser.

Use `#navigator()` to read a property of the browser's `navigator` object. Like
`#env()`, it is disabled unless the host opts in. It returns `Nothing` when the
browser property is
not available.

<!-- epsil-test: expect-diagnostics -->

```epsil
#navigator("userAgent")
```

## Parser Messages

`#error()` stops parsing, and reports an `error-directive` diagnostic:

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
- `#url`: the source URL the host supplied for the program, or `Nothing` when
  none was.
- `#filename`: the final path component of the source URL, or `Nothing` when no
  URL was supplied.
- `#date`: the current date in the `YYYY-MM-DD` format.
- `#time`: the current time in the `HH:MM:SS` format.

These six pragmas are always available. Epsil does not currently implement a
pragma for overriding the source location.
