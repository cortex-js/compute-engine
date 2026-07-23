---
title: Cortex Source Code
sidebar_label: Source Code
slug: /cortex/source-code/
description: "Cortex Source Code"
hide_title: true
date: Last Modified
---
# Source Code

## Encoding

Cortex's JavaScript API accepts a string. A host reading a Cortex source file
should decode it as UTF-8 and should write identifiers in
[Unicode NFC form](https://www.unicode.org/reports/tr15/tr15-50.html), as
required by the MathJSON symbol contract.

The Cortex parser does not decode files or strip a byte-order mark. File I/O
and decoding are the responsibility of the host. Inside a string literal,
Unicode code points can also be written with
[escape sequences](/cortex/literals/#escape-sequence).

## File Extension

The conventional file extensions are `.cortex` and `.cx`.

## MIME-type

The project uses `text/cortex` as its media-type convention. It is not a
registered IANA media type.

## Command line

Installing `@cortex-js/compute-engine` provides the `cortex` command:

```shell
cortex --eval "1 + 2"
cortex program.cx
cortex --json program.cortex
```

With no file or `--eval`, `cortex` starts an interactive REPL when standard
input is a terminal; otherwise it reads a program from standard input. The
command applies a 10-second evaluation limit by default. Use
`--time-limit <milliseconds>` to change it or `--time-limit 0` to disable it.
Run `cortex --help` for the complete option list.

See [Cortex CLI](/cortex/cli/) for installation, output modes, REPL commands,
diagnostics, and exit-status behavior.

## Hashbang Comment

A hashbang comment can appear at the absolute start of the source and is ignored
by the Cortex parser. It can be used to run an executable source file through
the installed command:

```cortex
#!/usr/bin/env cortex
```

