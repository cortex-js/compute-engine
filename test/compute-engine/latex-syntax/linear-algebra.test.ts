import { engine as ce } from '../../utils';

const m4 = ['List', ['List', 1, 2], ['List', 3, 4]];

const v1 = ['Vector', 5, 7, 0, -1];

describe('Parsing environments', () => {
  it('should parse a pmatrix', () => {
    const result = ce.parse('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');
    expect(result.toString()).toMatchInlineSnapshot(`Matrix([[a,b],[c,d]])`);
  });

  it('should parse a pmatrix with optional column format', () => {
    const result = ce.parse(
      '\\begin{pmatrix}[ll] a & b \\\\ c & d \\end{pmatrix}'
    );
    expect(result.toString()).toMatchInlineSnapshot(
      `Matrix([[a,b],[c,d]], (), <<)`
    );
  });

  it('should parse a bmatrix', () => {
    const result = ce.parse('\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}');
    expect(result.toString()).toMatchInlineSnapshot(
      `Matrix([[a,b],[c,d]], [])`
    );
  });

  it('should parse a Bmatrix', () => {
    const result = ce.parse('\\begin{Bmatrix} a & b \\\\ c & d \\end{Bmatrix}');
    expect(result.toString()).toMatchInlineSnapshot(
      `Matrix([[a,b],[c,d]], {})`
    );
  });

  it('should parse a vmatrix', () => {
    const result = ce.parse('\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}');
    expect(result.toString()).toMatchInlineSnapshot(
      `Matrix([[a,b],[c,d]], ||)`
    );
  });

  it('should parse a Vmatrix', () => {
    const result = ce.parse('\\begin{Vmatrix} a & b \\\\ c & d \\end{Vmatrix}');
    expect(result.toString()).toMatchInlineSnapshot(
      `Matrix([[a,b],[c,d]], ‖‖)`
    );
  });

  it('should parse a dcases', () => {
    const result = ce.parse('\\begin{dcases} a & b \\\\ c & d \\end{dcases}');
    expect(result.toString()).toMatchInlineSnapshot(`Which(b, a, d, c)`);
  });

  it('should parse a rcases', () => {
    const result = ce.parse('\\begin{rcases} a & b \\\\ c & d \\end{rcases}');
    expect(result.toString()).toMatchInlineSnapshot(`Which(b, a, d, c)`);
  });

  it('should parse an array', () => {
    const result = ce.parse('\\begin{array}{cc} a & b \\\\ c & d \\end{array}');
    expect(result.toString()).toMatchInlineSnapshot(
      `Matrix([[a,b],[c,d]], .., ==)`
    );
  });

  it('should parse a matrix environment', () => {
    const result = ce.parse('\\begin{matrix} a & b \\\\ c & d \\end{matrix}');
    expect(result.toString()).toMatchInlineSnapshot(
      `Matrix([[a,b],[c,d]], ..)`
    );
  });

  it('should parse an environment wrapped with delimiters', () => {
    const result = ce.parse(
      '\\left(\\begin{matrix} a & b \\\\ c & d \\end{matrix}\\right)'
    );
    expect(result.toString()).toMatchInlineSnapshot(`Matrix([[a,b],[c,d]])`);
  });

  it('should parse an environment with custom delimiters', () => {
    const result = ce.parse(
      '\\left\\lbrack\\begin{array}{cc} a & b \\\\ c & d \\end{array}\\right\\rbrack'
    );
    expect(result.toString()).toMatchInlineSnapshot(
      `[Matrix([[a,b],[c,d]], .., ==)]`
    );
  });
});

describe('Parsing vectors', () => {
  it('should parse a pmatrix vector', () => {
    const result = ce.parse('\\begin{pmatrix} a \\\\ b \\\\ c \\end{pmatrix}');
    expect(result.toString()).toMatchInlineSnapshot(`Matrix([[a],[b],[c]])`);
  });
});

describe('Serializing matrix with delimiters', () => {
  it('should serialize a matrix with default delimiter', () => {
    const result = ce.box(['Matrix', m4]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{pmatrix}1 & 2\\\\
      3 & 4\\end{pmatrix}
    `);
  });

  it('should serialize a matrix with () delimiters', () => {
    const result = ce.box(['Matrix', m4, { str: '()' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{pmatrix}1 & 2\\\\
      3 & 4\\end{pmatrix}
    `);
  });

  it('should serialize a matrix with [] delimiters', () => {
    const result = ce.box(['Matrix', m4, { str: '[]' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{bmatrix}1 & 2\\\\
      3 & 4\\end{bmatrix}
    `);
  });

  it('should serialize a matrix with {} delimiters', () => {
    const result = ce.box(['Matrix', m4, { str: '{}' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{Bmatrix}1 & 2\\\\
      3 & 4\\end{Bmatrix}
    `);
  });
  it('should serialize a matrix with || delimiters', () => {
    const result = ce.box(['Matrix', m4, { str: '||' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{vmatrix}1 & 2\\\\
      3 & 4\\end{vmatrix}
    `);
  });
  it('should serialize a matrix with ‖‖ delimiters', () => {
    const result = ce.box(['Matrix', m4, { str: '‖‖' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{Vmatrix}1 & 2\\\\
      3 & 4\\end{Vmatrix}
    `);
  });
  it('should parse a matrix with {. delimiters', () => {
    const result = ce.box(['Matrix', m4, { str: '{.' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{dcases}1 & 2\\\\
      3 & 4\\end{dcases}
    `);
  });
  it('should serialize a matrix with .} delimiters', () => {
    const result = ce.box(['Matrix', m4, { str: '.}' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{rcases}1 & 2\\\\
      3 & 4\\end{rcases}
    `);
  });
  it('should serialize a matrix with no delimiters', () => {
    const result = ce.box(['Matrix', m4, { str: '..' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{matrix}1 & 2\\\\
      3 & 4\\end{matrix}
    `);
  });
  it('should serialize a matrix with <> delimiters', () => {
    const result = ce.box(['Matrix', m4, { str: '<>' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\left\\langle\\begin{array}{}1 & 2\\\\
      3 & 4\\end{array}\\right\\rangle
    `);
  });
});

describe('Serializing matrix with column format', () => {
  it('should parse a matrix left aligned cells', () => {
    const result = ce.box(['Matrix', m4, { str: '[]' }, { str: '<<<<' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{bmatrix}[llll]1 & 2\\\\
      3 & 4\\end{bmatrix}
    `);
  });
  it('should parse a matrix centered aligned cells', () => {
    const result = ce.box(['Matrix', m4, { str: '[]' }, { str: '====' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{bmatrix}[cccc]1 & 2\\\\
      3 & 4\\end{bmatrix}
    `);
  });
  it('should parse a matrix right aligned cells', () => {
    const result = ce.box(['Matrix', m4, { str: '[]' }, { str: '>>>>' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{bmatrix}[rrrr]1 & 2\\\\
      3 & 4\\end{bmatrix}
    `);
  });
  it('should parse a matrix with mixed aligned cells', () => {
    const result = ce.box(['Matrix', m4, { str: '[]' }, { str: '>=<' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{bmatrix}[rcl]1 & 2\\\\
      3 & 4\\end{bmatrix}
    `);
  });
});

describe('Serializing vectors', () => {
  it('should serialize a default vector', () => {
    const result = ce.box(['Vector', 5, 7, 0, -1]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{pmatrix}5\\\\
      7\\\\
      0\\\\
      -1\\end{pmatrix}
    `);
  });

  it('should serialize a default vector with delimiters', () => {
    const result = ce.box(['Matrix', ['Vector', 5, 7, 0, -1], { str: '[]' }]);
    expect(result.latex).toMatchInlineSnapshot(`
      \\begin{bmatrix}5\\\\
      7\\\\
      0\\\\
      -1\\end{bmatrix}
    `);
  });
});
