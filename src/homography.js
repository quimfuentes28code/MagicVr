// Homografías (transformaciones de perspectiva) entre cuadriláteros.
// Sirven para pegar el tablero a una mesa vista en ángulo y para «enderezar»
// lo que ve la cámara antes de reconocer una carta.

/** Matriz 3x3 (array de 9, h[8] = 1) que lleva los 4 puntos src a los 4 puntos dst. */
export function homography(src, dst) {
  // Sistema 8x8: para cada par (x,y)->(u,v)
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Aplica la homografía a un punto. */
export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Inversa de una homografía. */
export function invertH(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
  return inv.map((v) => v / inv[8]);
}

/** Cadena CSS matrix3d() de una homografía (con transform-origin 0 0). */
export function cssMatrix(H) {
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = H;
  return `matrix3d(${h0},${h3},0,${h6},${h1},${h4},0,${h7},0,0,1,0,${h2},${h5},0,${h8})`;
}

/** Rectángulo w×h → cuadrilátero (esquinas en orden: arriba-izq, arriba-der, abajo-der, abajo-izq). */
export const rectToQuad = (w, h, quad) => homography([[0, 0], [w, 0], [w, h], [0, h]], quad);
