---
title: Epsil Source Code
sidebar_label: Source Code
slug: /epsil/source-code/
description: "Source code requirements for Epsil: UTF-8 decoding, Unicode NFC normalization of identifiers, and how line terminators and whitespace are treated."
hide_title: true
date: Last Modified
---
# Source Code

## Encoding

Epsil's JavaScript API accepts a string. A host reading an Epsil source file
should decode it as UTF-8 and should write identifiers in
[Unicode NFC form](https://www.unicode.org/reports/tr15/tr15-50.html), as
required by the MathJSON symbol contract.

The Epsil parser does not decode files or strip a byte-order mark. File I/O
and decoding are the responsibility of the host. Inside a string literal,
Unicode code points can also be written with
[escape sequences](/epsil/literals/#escape-sequence).

## File Extension

The conventional file extension is `.epsil`.

## MIME-type

The project uses `text/epsil` as its media-type convention. It is not a
registered IANA media type.

## Command line

Installing `@cortex-js/compute-engine` provides the `epsil` command:

```shell
epsil --eval "1 + 2"
epsil program.epsil
epsil --json program.epsil
```

With no file or `--eval`, `epsil` starts an interactive REPL when standard
input is a terminal; otherwise it reads a program from standard input. The
command applies a 10-second evaluation limit by default. Use
`--time-limit <milliseconds>` to change it or `--time-limit 0` to disable it.
Run `epsil --help` for the complete option list.

See [Epsil CLI](/epsil/cli/) for installation, output modes, REPL commands,
diagnostics, and exit-status behavior.

## Hashbang Comment

A hashbang comment can appear at the absolute start of the source and is ignored
by the Epsil parser. It can be used to run an executable source file through
the installed command:

```epsil
#!/usr/bin/env epsil
```

