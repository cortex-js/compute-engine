// Calculate the determinant of matrix

// Test: determinant([[1,3,7],[2,-1,4],[5,0,2]]) === -54

export function determinant(matrix: number[][]): number {
  const n = matrix.length;
  if (n === 1) return matrix[0][0];
  if (n === 2) return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];

  // m[0].reduce((r,e,i) =>
  // r+(-1)**(i+2)*e*determinant(m.slice(1).map(c =>
  // c.filter((_,j) => i != j))),0)

  const subMatrix: number[][] = [];
  let det = 0;
  for (let x = 0; x < n; x++) {
    let subI = 0;
    for (let i = 1; i < n; i++) {
      let subJ = 0;
      for (let j = 0; j < n; j++) {
        if (j === x) {
          continue;
        }
        subMatrix[subI][subJ] = matrix[i][j];
        subJ++;
      }
      subI++;
    }
    det = det + Math.pow(-1, x) * matrix[0][x] * determinant(subMatrix);
  }
  return det;
}
