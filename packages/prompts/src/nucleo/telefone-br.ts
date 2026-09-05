/**
 * O que é, e o que não é, um telefone brasileiro — em dígitos.
 *
 * Este módulo é a **regra**. Ele existe separado porque a auditoria
 * (`auditoria-pii.ts`) não pode importar nada daqui: se as duas camadas
 * compartilhassem o reconhecedor, a segunda seria a primeira rodando de novo, e o
 * guardrail de LGPD teria uma camada só disfarçada de duas.
 *
 * A régua é a numeração da Anatel, não a aparência do texto:
 *
 * - `13` = `55` + móvel nacional (11)
 * - `12` = `55` + nacional de 10
 * - `11` = DDD + `9` + 8 dígitos começando em 6–9 (móvel do plano atual)
 * - `10` = DDD + 8 dígitos começando em 2–9 (fixo, ou móvel antigo sem o nono dígito)
 * - `9` e `8` = o mesmo, **sem o DDD** — ver `eTelefoneLocalBrasileiro`
 *
 * Exigir DDD válido é o que separa telefone de CEP (8 dígitos), de número de pedido e
 * de CNPJ: `59082050` não tem para onde crescer, e `2026-09-05` começa em `20`, que não
 * é DDD. É por isso que aqui não há lista de "coisas que parecem telefone e não são":
 * a lista foi trocada por um teste positivo, que erra menos e não precisa de manutenção.
 */

/** DDDs em uso no Brasil. Sem 0 em nenhuma das duas casas — nenhum DDD tem. */
const DDDS: ReadonlySet<number> = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77,
  79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export function dddValido(doisDigitos: string): boolean {
  return DDDS.has(Number(doisDigitos));
}

/** `digitos` tem de ser só dígitos. Decide pelo comprimento, na ordem da numeração. */
export function eTelefoneBrasileiro(digitos: string): boolean {
  if (digitos.length === 13 || digitos.length === 12) {
    return digitos.startsWith('55') && eTelefoneBrasileiro(digitos.slice(2));
  }
  if (digitos.length === 11) {
    return dddValido(digitos.slice(0, 2)) && digitos[2] === '9' && /[6-9]/.test(digitos[3] ?? '');
  }
  if (digitos.length === 10) {
    return dddValido(digitos.slice(0, 2)) && /[2-9]/.test(digitos[2] ?? '');
  }
  return false;
}

/** Os comprimentos testados, do maior para o menor: o `+55` tem de vencer o nacional. */
export const COMPRIMENTOS_DE_TELEFONE: readonly number[] = [13, 12, 11, 10];

/**
 * O telefone **local**, escrito sem DDD — o caso comum de quem passa o próprio número
 * dentro da cidade: `99988 0011`, `999880011`, `3222 1188`, `32221188`.
 *
 * São 9 ou 8 dígitos, e a régua continua sendo a numeração e não a aparência:
 *
 * - `9` = `9` + 8 dígitos começando em 6–9 (móvel do plano atual, sem o DDD)
 * - `8` = 8 dígitos começando em 2–9 (fixo, ou móvel antigo sem o nono dígito)
 *
 * O par de anos é a única recusa aritmética: `2020-2024` é 8 dígitos começando em 2 e
 * aparece em texto de verdade ("de 2020 a 2024 eu trabalhei sozinho").
 *
 * **Oito e nove dígitos é janela curta, e o mundo está cheio de número de oito dígitos**
 * — CEP tem oito, data sem separador tem oito, dois preços seguidos têm oito. Por isso
 * este teste sozinho NÃO é suficiente para trocar nada: quem chama tem de exigir também
 * que a janela **comece e termine onde houve um separador** e que a pontuação esteja onde
 * um telefone a põe (ver `pseudonimizacao.ts`, passada 5). Aqui está só a parte que a
 * Anatel decide.
 */
export const COMPRIMENTOS_LOCAIS: readonly number[] = [9, 8];

function eAno(quatroDigitos: string): boolean {
  const numero = Number(quatroDigitos);
  return quatroDigitos.length === 4 && numero >= 1900 && numero <= 2100;
}

/**
 * Oito dígitos corridos que são uma **data compacta**, não um telefone: `20260905`
 * (`aaaammdd`) e `21112026` (`ddmmaaaa`). É a forma mais comum de oito dígitos seguidos
 * depois do CEP, e a única que dá para separar sem inventar heurística: ou os quatro
 * primeiros são um ano e os quatro últimos um mês e um dia válidos, ou o contrário.
 *
 * Custa um falso negativo, e ele foi contado: um fixo local começando em 20xx cujos
 * quatro últimos dígitos formem um `mmdd` válido é ~0,1% dos prefixos possíveis, e mesmo
 * ele volta a ser reconhecido se estiver escrito com qualquer separador — `3101 2026` e
 * `3101-2026` não são "corridos" e não passam por aqui. Do outro lado, a auditoria é uma
 * implementação separada e **não** conhece esta recusa: se a regra errar, a chamada não
 * sai, que é o desfecho certo.
 */
export function eDataCompacta(digitos: string): boolean {
  if (digitos.length !== 8) return false;
  const mesEDia = (mm: string, dd: string): boolean =>
    Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31;
  if (eAno(digitos.slice(0, 4)) && mesEDia(digitos.slice(4, 6), digitos.slice(6))) return true;
  return eAno(digitos.slice(4)) && mesEDia(digitos.slice(2, 4), digitos.slice(0, 2));
}

export function eTelefoneLocalBrasileiro(digitos: string): boolean {
  if (digitos.length === 9) {
    return digitos[0] === '9' && /[6-9]/.test(digitos[1] ?? '');
  }
  if (digitos.length === 8) {
    if (!/[2-9]/.test(digitos[0] ?? '')) return false;
    return !(eAno(digitos.slice(0, 4)) && eAno(digitos.slice(4)));
  }
  return false;
}

/**
 * Todas as formas em que um telefone que o CRM **já conhece** pode aparecer escrito,
 * reduzidas a dígitos. É o que permite trocá-lo por casamento direto, sem depender de
 * a varredura genérica acertar.
 *
 * O nono dígito entra e sai porque cadastro antigo e recado de cliente discordam o
 * tempo todo: quem tem `84 99988-0011` no banco recebe `84 9988-0011` no WhatsApp. E o
 * DDD entra e sai porque dentro da cidade ninguém o escreve: quem tem `84 99988-0011` no
 * banco recebe `99988 0011`.
 */
export function variantesDoTelefoneConhecido(telefone: string): string[] {
  const digitos = telefone.replace(/\D/g, '');
  const nacional = digitos.startsWith('55') && digitos.length >= 12 ? digitos.slice(2) : digitos;
  if (nacional.length !== 10 && nacional.length !== 11) return [];

  const formas = new Set<string>([nacional]);
  if (nacional.length === 11 && nacional[2] === '9') {
    formas.add(nacional.slice(0, 2) + nacional.slice(3));
  }
  if (nacional.length === 10) {
    formas.add(`${nacional.slice(0, 2)}9${nacional.slice(2)}`);
  }
  for (const forma of [...formas]) formas.add(`55${forma}`);
  // As formas **locais**, sem DDD: dentro da cidade é assim que a pessoa passa o próprio
  // número. Aqui elas não dependem de nada — nem da forma do grupo, nem da pontuação, nem
  // da numeração da Anatel: são os dígitos que o CRM tem em mãos, procurados como
  // substring. É o que torna o número do cadastro imune a toda a heurística de local.
  for (const forma of [...formas]) {
    if (forma.length === 10 || forma.length === 11) formas.add(forma.slice(2));
  }
  // Do mais longo para o mais curto: com `+55 84 99988-0011`, casar `84999880011`
  // primeiro deixaria o `+55` solto no texto que vai ao modelo.
  return [...formas].sort((a, b) => b.length - a.length);
}
