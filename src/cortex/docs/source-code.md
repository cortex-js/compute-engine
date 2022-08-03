---
title: Cortex Source Code
permalink: /cortex/source-code/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
---

# Source Code

## Encoding

Cortex source code is using the UTF-8 Unicode encoding in [NFC form](https://www.unicode.org/reports/tr15/tr15-50.html).

Unicode codepoints that are not in NFC form can be represented in 
[strings](/cortex/literals/#strings) using escape sequences.

A stream or file containing Cortex source code may begin with a UTF-8 BOM, that
is the byte sequence `0xEF, 0xBB, 0xBF`. If present, the BOM is ignored.

When modifying a Cortex source file, if it had a BOM when read, it should 
include the BOM when written. This is important to avoid spurious changes 
when using source code control tools.

## File Extension

When stored in a file, the **file extension** is `.cortex` or `.cx`.

## MIME-type

The recommended **MIME media type** for Cortex source code is `text/cortex`.


## Hashbang Comment

A **Hashbang Comment** can be included as the first line of a Cortex source file
prefixed with `#!`. Its content indicate the command line interpreter to use:

```
#!/usr/bin/cortex
```
