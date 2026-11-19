// Arredondamentos de dinheiro (2 casas) e quantidade (3 casas), sem erro de ponto flutuante acumulado.
export const round = (value, decimals) => {
  const f = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * f) / f;
};
export const money = (v) => round(v, 2);
export const qty = (v) => round(v, 3);
