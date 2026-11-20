export type Celula = string | number | boolean | null | undefined;

function escapar(valor: Celula): string {
  if (valor === null || valor === undefined) return '';
  let texto = String(valor);

  // Evita injeção de fórmula em planilhas (Excel/Sheets) em textos que começam com = + - @
  if (typeof valor === 'string' && /^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;

  if (/[",\r\n]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

// CSV no padrão RFC 4180 (separador vírgula), com BOM para o Excel reconhecer UTF-8.
export function gerarCsv(colunas: string[], linhas: Celula[][]): string {
  const todas = [colunas, ...linhas];
  return '\uFEFF' + todas.map((linha) => linha.map(escapar).join(',')).join('\r\n') + '\r\n';
}