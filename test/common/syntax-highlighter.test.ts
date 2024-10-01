import { parseCode } from '../../src/common/syntax-highlighter';

describe('highlight some TypeScript', () => {
  it('should highlight literals', () => {
    expect(parseCode('123.45e16 + "hello" + true + /a(a*)/g'))
      .toMatchInlineSnapshot(`
      [
        {
          "content": "123.45e16",
          "tag": "literal",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "+",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": ""hello"",
          "tag": "literal",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "+",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "true",
          "tag": "literal",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "+",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "/a(a*)/",
          "tag": "literal",
        },
        {
          "content": "g",
          "tag": "identifier",
        },
      ]
    `);
  });

  it('should highlight keywords', () => {
    expect(parseCode('let done = false; while(a) {if (true) b else c} '))
      .toMatchInlineSnapshot(`
      [
        {
          "content": "let",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "done",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "false",
          "tag": "literal",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "while",
          "tag": "keyword",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "a",
          "tag": "identifier",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "if",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "true",
          "tag": "literal",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "b",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "else",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "c",
          "tag": "identifier",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
      ]
    `);
  });

  it('should highlight comments', () => {
    expect(
      parseCode(`const a; // An inline comment
    // another inline comment
    const b;
    
    /** A comment block on one line */
    
    const c;
    /* A comment block
       on multiple lines
    */

    /* A comment block
       on multiple lines
       // with an inline comment
       and an \\*/ escape end of comment
    */


       `)
    ).toMatchInlineSnapshot(`
      [
        {
          "content": "const",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "a",
          "tag": "identifier",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "// An inline comment",
          "tag": "comment",
        },
        {
          "content": "
          ",
          "tag": "default",
        },
        {
          "content": "// another inline comment",
          "tag": "comment",
        },
        {
          "content": "
          ",
          "tag": "default",
        },
        {
          "content": "const",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "b",
          "tag": "identifier",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
          
          ",
          "tag": "default",
        },
        {
          "content": "/** A comment block on one line */",
          "tag": "comment",
        },
        {
          "content": "
          
          ",
          "tag": "default",
        },
        {
          "content": "const",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "c",
          "tag": "identifier",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
          ",
          "tag": "default",
        },
        {
          "content": "/* A comment block
             on multiple lines
          */",
          "tag": "comment",
        },
        {
          "content": "

          ",
          "tag": "default",
        },
        {
          "content": "/* A comment block
             on multiple lines
             // with an inline comment
             and an \\*/ escape end of comment
          */",
          "tag": "comment",
        },
        {
          "content": "


             ",
          "tag": "default",
        },
      ]
    `);
  });

  it('should highlight long code block', () => {
    expect(
      parseCode(`let letNumber = 10;
        const constNumber = 20;
        
        const bool: boolean = true;
        const list: number[] = [1, 2, 3];
        const array: Array<number> = [1, 2, 3];
        const pair: [string, number] = ['hello', 10];
        
        for (let i = 0; i < list.length; i += 1) {
          console.log(list[i]);
        }
        
        if (bool) {
          console.log('True');
        } else {
          console.log('False');
        }
        
        const str: string = 'Jake';
        const templateStr: string = \`Hello, \${str}!\`;
        
        // A comment
        
        /*
         * Multiline comments
         * Multiline comments
         *\/
        
        interface SquareConfig {
          label: string;
          color?: string;
          width?: number;
          [propName: string]: any;
        }
        
        interface SearchFunc {
          (source: string, subString: string): boolean;
        }
        
        enum Color {
          Red,
          Green,
        }
        
        type Easing = "ease-in" | "ease-out" | "ease-in-out";
        
        class Greeter {
          private readonly greeting: string;
        
          constructor(message: string) {
            this.greeting = message;
          }
        
          greet() {
            return "Hello, " + this.greeting;
          }
        }
        
        let greeter = new Greeter("world");
        
        class Animal {
          move(distanceInMeters: number = 0) {
            console.log(\`Animal moved \${distanceInMeters}m.\`);
          }
        }
        
        class Dog extends Animal {
          bark() {
            console.log("Woof! Woof!");
          }
        }
        
        const dog = new Dog();
        dog.bark();
        dog.move(10);
        dog.bark();
        
        class Point {
          x: number;
          y: number;
        }
        
        interface Point3d extends Point {
          z: number;
        }
        
        let point3d: Point3d = { x: 1, y: 2, z: 3 };
        
        function add(x, y) {
          return x + y;
        }
        
        let myAdd = function (x, y) {
          return x + y;
        };
        
        (function () {
          console.log('IIFE');
        }());
        
        function identity<T>(arg: T): T {
          return arg;
        }
        
        let myIdentity: <T>(arg: T) => T = identity;
        
        class GenericNumber<T> {
          zeroValue: T;
          add: (x: T, y: T) => T;
        }
        `)
    ).toMatchInlineSnapshot(`
      [
        {
          "content": "let",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "letNumber",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "10",
          "tag": "literal",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "const",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "constNumber",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "20",
          "tag": "literal",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "const",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "bool",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "boolean",
          "tag": "type",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "true",
          "tag": "literal",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "const",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "list",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "number",
          "tag": "type",
        },
        {
          "content": "[",
          "tag": "punctuation",
        },
        {
          "content": "]",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "[",
          "tag": "punctuation",
        },
        {
          "content": "1",
          "tag": "literal",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "2",
          "tag": "literal",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "3",
          "tag": "literal",
        },
        {
          "content": "]",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "const",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "array",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Array",
          "tag": "type",
        },
        {
          "content": "<",
          "tag": "punctuation",
        },
        {
          "content": "number",
          "tag": "type",
        },
        {
          "content": ">",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "[",
          "tag": "punctuation",
        },
        {
          "content": "1",
          "tag": "literal",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "2",
          "tag": "literal",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "3",
          "tag": "literal",
        },
        {
          "content": "]",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "const",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "pair",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "[",
          "tag": "punctuation",
        },
        {
          "content": "string",
          "tag": "type",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "number",
          "tag": "type",
        },
        {
          "content": "]",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "[",
          "tag": "punctuation",
        },
        {
          "content": "'hello'",
          "tag": "literal",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "10",
          "tag": "literal",
        },
        {
          "content": "]",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "for",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "let",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "i",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "0",
          "tag": "literal",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "i",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "<",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "list",
          "tag": "identifier",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "length",
          "tag": "identifier",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "i",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "+=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "1",
          "tag": "literal",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "console",
          "tag": "identifier",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "log",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "list",
          "tag": "identifier",
        },
        {
          "content": "[",
          "tag": "punctuation",
        },
        {
          "content": "i",
          "tag": "identifier",
        },
        {
          "content": "]",
          "tag": "punctuation",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "if",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "bool",
          "tag": "identifier",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "console",
          "tag": "identifier",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "log",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "'True'",
          "tag": "literal",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "else",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "console",
          "tag": "identifier",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "log",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "'False'",
          "tag": "literal",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "const",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "str",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "string",
          "tag": "type",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "'Jake'",
          "tag": "literal",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "const",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "templateStr",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "string",
          "tag": "type",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " \`",
          "tag": "default",
        },
        {
          "content": "Hello",
          "tag": "identifier",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " $",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "str",
          "tag": "identifier",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "!",
          "tag": "operator",
        },
        {
          "content": "\`",
          "tag": "default",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "// A comment",
          "tag": "comment",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "/*
               * Multiline comments
               * Multiline comments
               */",
          "tag": "comment",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "interface",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "SquareConfig",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "label",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "string",
          "tag": "type",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "color",
          "tag": "identifier",
        },
        {
          "content": "?",
          "tag": "operator",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "string",
          "tag": "type",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "width",
          "tag": "identifier",
        },
        {
          "content": "?",
          "tag": "operator",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "number",
          "tag": "type",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "[",
          "tag": "punctuation",
        },
        {
          "content": "propName",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "string",
          "tag": "type",
        },
        {
          "content": "]",
          "tag": "punctuation",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "any",
          "tag": "type",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "interface",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "SearchFunc",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "source",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "string",
          "tag": "type",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "subString",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "string",
          "tag": "type",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "boolean",
          "tag": "type",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "enum",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Color",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "Red",
          "tag": "identifier",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "Green",
          "tag": "identifier",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "type",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Easing",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": ""ease-in"",
          "tag": "literal",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "|",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": ""ease-out"",
          "tag": "literal",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "|",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": ""ease-in-out"",
          "tag": "literal",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "class",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Greeter",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "private",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "readonly",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "greeting",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "string",
          "tag": "type",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              
                ",
          "tag": "default",
        },
        {
          "content": "constructor",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "message",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "string",
          "tag": "type",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                  ",
          "tag": "default",
        },
        {
          "content": "this",
          "tag": "literal",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "greeting",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "message",
          "tag": "identifier",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
                ",
          "tag": "default",
        },
        {
          "content": "greet",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                  ",
          "tag": "default",
        },
        {
          "content": "return",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": ""Hello, "",
          "tag": "literal",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "+",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "this",
          "tag": "literal",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "greeting",
          "tag": "identifier",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "let",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "greeter",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "new",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Greeter",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": ""world"",
          "tag": "literal",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "class",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Animal",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "move",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "distanceInMeters",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "number",
          "tag": "type",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "0",
          "tag": "literal",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                  ",
          "tag": "default",
        },
        {
          "content": "console",
          "tag": "identifier",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "log",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "\`",
          "tag": "default",
        },
        {
          "content": "Animal",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "moved",
          "tag": "identifier",
        },
        {
          "content": " $",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "distanceInMeters",
          "tag": "identifier",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "m",
          "tag": "identifier",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "\`",
          "tag": "default",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "class",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Dog",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "extends",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Animal",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "bark",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                  ",
          "tag": "default",
        },
        {
          "content": "console",
          "tag": "identifier",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "log",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": ""Woof! Woof!"",
          "tag": "literal",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "const",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "dog",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "new",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Dog",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "dog",
          "tag": "identifier",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "bark",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "dog",
          "tag": "identifier",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "move",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "10",
          "tag": "literal",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "dog",
          "tag": "identifier",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "bark",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "class",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Point",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "x",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "number",
          "tag": "type",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "y",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "number",
          "tag": "type",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "interface",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Point3d",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "extends",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Point",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "z",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "number",
          "tag": "type",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "let",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "point3d",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "Point3d",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "x",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "1",
          "tag": "literal",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "y",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "2",
          "tag": "literal",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "z",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "3",
          "tag": "literal",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "function",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "add",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "x",
          "tag": "identifier",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "y",
          "tag": "identifier",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "return",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "x",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "+",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "y",
          "tag": "identifier",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "let",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "myAdd",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "function",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "x",
          "tag": "identifier",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "y",
          "tag": "identifier",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "return",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "x",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "+",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "y",
          "tag": "identifier",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "function",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "console",
          "tag": "identifier",
        },
        {
          "content": ".",
          "tag": "punctuation",
        },
        {
          "content": "log",
          "tag": "identifier",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "'IIFE'",
          "tag": "literal",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "function",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "identity",
          "tag": "identifier",
        },
        {
          "content": "<",
          "tag": "punctuation",
        },
        {
          "content": "T",
          "tag": "identifier",
        },
        {
          "content": ">",
          "tag": "punctuation",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "arg",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "T",
          "tag": "identifier",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "T",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "return",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "arg",
          "tag": "identifier",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "let",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "myIdentity",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "<",
          "tag": "punctuation",
        },
        {
          "content": "T",
          "tag": "identifier",
        },
        {
          "content": ">",
          "tag": "punctuation",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "arg",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "T",
          "tag": "identifier",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=>",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "T",
          "tag": "identifier",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "identity",
          "tag": "identifier",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              
              ",
          "tag": "default",
        },
        {
          "content": "class",
          "tag": "keyword",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "GenericNumber",
          "tag": "identifier",
        },
        {
          "content": "<",
          "tag": "punctuation",
        },
        {
          "content": "T",
          "tag": "identifier",
        },
        {
          "content": ">",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "{",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "zeroValue",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "T",
          "tag": "identifier",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
                ",
          "tag": "default",
        },
        {
          "content": "add",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "(",
          "tag": "punctuation",
        },
        {
          "content": "x",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "T",
          "tag": "identifier",
        },
        {
          "content": ",",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "y",
          "tag": "identifier",
        },
        {
          "content": ":",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "T",
          "tag": "identifier",
        },
        {
          "content": ")",
          "tag": "punctuation",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "=>",
          "tag": "operator",
        },
        {
          "content": " ",
          "tag": "default",
        },
        {
          "content": "T",
          "tag": "identifier",
        },
        {
          "content": ";",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
        {
          "content": "}",
          "tag": "punctuation",
        },
        {
          "content": "
              ",
          "tag": "default",
        },
      ]
    `);
  });
});
