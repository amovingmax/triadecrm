/**
 * A conferência final, e a razão de ela existir num arquivo próprio.
 *
 * Este módulo **não importa nada de `pseudonimizacao.ts` nem de `telefone-br.ts`** — só o
 * tipo `TipoDePii`, que é um nome, não uma decisão. A lista de DDDs abaixo é uma cópia
 * deliberada: se as duas camadas compartilhassem o reconhecedor, a segunda seria a
 * primeira rodando de novo, e o guardrail de LGPD teria uma camada só disfarçada de duas.
 *
 * ## Ela é burra de propósito
 *
 * `verificarSemPii` faz **uma** coisa: projeta os dígitos do texto e procura qualquer
 * janela de 10 a 13 dígitos cujas duas primeiras casas formem um DDD. Não conhece faixa
 * de móvel nem de fixo, não conhece CEP, não conhece CNPJ, não confere dígito
 * verificador, não desconta nada.
 *
 * O desconto é justamente o que abriu o buraco na v2: descontar CNPJ pelo DV deixava
 * qualquer janela de 14 dígitos invisível, e bastava colar três números no fim de um
 * celular para calar a segunda camada. **Nunca acrescente desconto aqui.** Se um número
 * legítimo passar a barrar chamadas, o conserto é a REGRA substituir mais — é o que a
 * passada de `[[DOCUMENTO_n]]` da pseudonimização faz com uuid, CNPJ e CPF.
 *
 * Falso positivo aqui é aceitável: ela não corrompe texto, ela só impede a chamada de
 * sair (`PiiNaChamadaError`). Falso negativo é inaceitável.
 *
 * ## Nenhuma fronteira — e por que agora dá para não ter nenhuma (4ª versão, 2026-09-05)
 *
 * Até a 3ª versão a janela não atravessava letra. A fronteira não existia por gosto: a
 * auditoria varria a **mensagem inteira, prompt de sistema junto**, e os quatro prompts
 * de sistema deste pacote, sozinhos e sem nenhum dado de contato, já contêm janela de dez
 * dígitos começando por DDD válido (versões, limites, percentuais, exemplos). Sem
 * fronteira nenhuma, a auditoria recusaria 100% das chamadas, para sempre.
 *
 * O argumento estava certo e a solução estava errada, e o preço foi um furo de forma
 * óbvia: `ddd 84 numero 988776655` e `84 nove 8877 6655` atravessam a fronteira de letra
 * e saíam inteiros.
 *
 * O conserto não é afrouxar a janela, é **estreitar o que a auditoria enxerga**. O prompt
 * de sistema foi escrito por nós, está versionado no repositório e não tem PII nenhuma —
 * ele não precisa de auditoria. O que precisa é o que veio **de fora**: a transcrição, a
 * anotação, o nome, o que o lead escreveu. `prepararChamada` passa a esta função apenas
 * esses trechos, um a um, já pseudonimizados (ver `nucleo/chamada.ts`), e sobre eles a
 * janela corre **sem fronteira nenhuma — nem de letra**. Espaço, ponto, hífen, barra,
 * emoji, quebra de linha e agora também *palavra* deixaram de separar qualquer coisa.
 *
 * Desde a 5ª versão `prepararChamada` chama esta função mais uma vez, sobre a **junção**:
 * os mesmos trechos de fora colados um no outro, sem fronteira entre eles. É o que pega o
 * telefone que o lead reparte entre dois campos (`84 99988` no resumo da conversa, `0011`
 * na mensagem seguinte), que campo a campo nenhuma das duas camadas via. Esta função não
 * muda nada por isso — quem decide o que é "de fora" e em que ordem colar continua sendo
 * `chamada.ts`; aqui é sempre a mesma varredura burra, sobre um texto a mais.
 *
 * `varrerMontagem` é a sobra: a varredura antiga, com a fronteira de letra, aplicada à
 * mensagem inteira já montada. Ela não é a auditoria — é uma rede contra o que a
 * *montagem* possa inventar (um texto que `montarMensagem` traga de fora da entrada
 * validada e que, por isso, nunca chegaria à auditoria). Custa zero falso positivo: os
 * quatro prompts de sistema passam por ela limpos, e é isso que o eval prova.
 *
 * | | regra (`pseudonimizacao.ts`) | auditoria (aqui) |
 * |---|---|---|
 * | o que enxerga | os campos de entrada declarados | só os trechos de origem externa |
 * | onde procura | projeção do texto inteiro | projeção do trecho, sem fronteira |
 * | o que aceita | DDD válido + faixa de móvel/fixo da Anatel | 10 a 13 dígitos começando por DDD |
 * | o que recusa | CEP, data, valor, trecho que atravessa palavra | nada |
 * | falso negativo | evitado | inaceitável |
 * | falso positivo | evitado (estragaria o texto do modelo) | tolerado (a chamada só não sai) |
 */

import type { TipoDePii } from './pseudonimizacao';

export interface ProblemaDePii {
  readonly tipo: TipoDePii;
  readonly trecho: string;
  /**
   * O campo de entrada de onde o trecho veio, quando quem chamou sabe dizer. É
   * `prepararChamada` que preenche; `verificarSemPii` sozinha não tem como saber.
   */
  readonly campo?: string;
}

/**
 * Cópia deliberada da lista da Anatel. Copiar em vez de importar é o que garante que as
 * duas camadas possam errar separado — que é a única forma de a segunda servir para
 * alguma coisa. Se a Anatel mexer na numeração, as duas listas mudam em dois commits, e
 * é bom que seja assim: um deles é revisado sabendo que mexe no guardrail.
 */
const DDDS: ReadonlySet<number> = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77,
  79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

const LETRA = /\p{L}/u;

/** Os comprimentos, do maior para o menor: o `+55` tem de vencer o nacional. */
const COMPRIMENTOS = [13, 12, 11, 10] as const;

interface Segmento {
  readonly digitos: string;
  readonly posicoes: readonly number[];
  readonly fins: readonly number[];
}

/**
 * **Qual algarismo este ponto de código representa?** — implementação própria, sem uma
 * linha em comum com a da regra, que responde à mesma pergunta de outro jeito.
 *
 * A pergunta é feita ponto de código por ponto de código sobre o texto original: NFKC
 * aplicado à string inteira muda o comprimento (`⑴` vira `(1)`) e destrói o índice de
 * volta. Aplicado a um ponto de código só, ele responde e o índice continua exato.
 *
 * Cobre, sem tabela: ASCII; qualquer coisa cuja decomposição de compatibilidade seja um
 * único algarismo depois de descartada a moldura — largura inteira `８`, negrito
 * matemático `𝟴`, sobrescrito `⁸`, subscrito `₈`, circulado `⑧`, entre parênteses `⑻`,
 * com ponto `⒏`; e os dígitos decimais sem decomposição (`Nd`: `٨`, `८`), pelo começo do
 * bloco de dez. Recusa o que não é um algarismo: `⑩` (`10`), `½` (`1⁄2`), `㎡` (`m2`).
 *
 * As sete faixas decorativas do fim são a exceção assumida: `⓵ ❶ ➀ ➊ ⓿ 🄋 🄌` não são
 * `Nd` e não têm decomposição — o Unicode não expõe o valor numérico delas em JavaScript,
 * e não há o que calcular. É lista escrita à mão, e é a única parte deste arquivo que
 * envelhece.
 */
const DIGITO = /\p{Nd}/u;
const ALGARISMO_ASCII = /^[0-9]$/;
/** Tudo que pode sobrar em volta do algarismo depois do NFKC e não é o algarismo. */
const SO_MOLDURA = /^[()[\]{}.,\u2044\uFF0E\uFF0C\s]$/u;
/** Primeiro ponto de código de cada família decorativa que vale 1…9. */
const DECORATIVOS_UM_A_NOVE: readonly number[] = [0x24f5, 0x2776, 0x2780, 0x278a];
/** Os zeros decorativos, que não seguem nenhuma família. */
const DECORATIVOS_ZERO: readonly number[] = [0x24ff, 0x1f10b, 0x1f10c];

function valorDoDigito(caractere: string): string | undefined {
  if (ALGARISMO_ASCII.test(caractere)) return caractere;

  // 1. NFKC do ponto de código sozinho, jogando fora a moldura. Sobrou um algarismo e
  //    mais nada? É ele. Sobrou outra coisa junto, é outra coisa.
  const partes = [...caractere.normalize('NFKC')].filter((parte) => !SO_MOLDURA.test(parte));
  if (partes.length === 1 && ALGARISMO_ASCII.test(partes[0] as string)) return partes[0];

  const codigo = caractere.codePointAt(0) as number;

  // 2. Dígito decimal sem decomposição: onde começa o bloco de dez deste caractere?
  if (DIGITO.test(caractere)) {
    for (let recuo = 0; recuo <= 9; recuo += 1) {
      const inicio = codigo - recuo;
      if (
        DIGITO.test(String.fromCodePoint(inicio)) &&
        !DIGITO.test(String.fromCodePoint(inicio - 1))
      ) {
        return String(recuo);
      }
    }
    return undefined;
  }

  // 3. As faixas decorativas sem valor computável.
  if (DECORATIVOS_ZERO.includes(codigo)) return '0';
  const familia = DECORATIVOS_UM_A_NOVE.find(
    (primeiro) => codigo >= primeiro && codigo <= primeiro + 8,
  );
  return familia === undefined ? undefined : String(codigo - familia + 1);
}

/**
 * A projeção de dígitos.
 *
 * `quebrarNaLetra: false` — o modo da auditoria — não quebra em nada: a formatação
 * inteira deixa de existir, palavra inclusive. `true` é o modo da rede de segurança
 * `varrerMontagem`, que roda sobre a mensagem já montada e por isso precisa da fronteira
 * mínima para não acusar o prompt de sistema.
 */
function projetar(texto: string, quebrarNaLetra: boolean): Segmento[] {
  const segmentos: Segmento[] = [];
  let digitos: string[] = [];
  let posicoes: number[] = [];
  let fins: number[] = [];
  const fechar = (): void => {
    if (digitos.length > 0) segmentos.push({ digitos: digitos.join(''), posicoes, fins });
    digitos = [];
    posicoes = [];
    fins = [];
  };
  for (let i = 0; i < texto.length;) {
    const codigo = texto.codePointAt(i) as number;
    const largura = codigo > 0xffff ? 2 : 1;
    const caractere = String.fromCodePoint(codigo);
    const algarismo = valorDoDigito(caractere);
    if (algarismo !== undefined) {
      digitos.push(algarismo);
      posicoes.push(i);
      fins.push(i + largura);
    } else if (quebrarNaLetra && LETRA.test(caractere)) {
      fechar();
    }
    i += largura;
  }
  fechar();
  return segmentos;
}

/**
 * O telefone **local, sem DDD** — `99988 0011`, `999880011`, `3222 1188`, `32221188`.
 *
 * Até a 5ª versão a auditoria só via a grafia com hífen literal, e quem não apertasse a
 * tecla passava. Agora é janela sobre os dígitos, como o resto — com uma restrição que
 * não é frescura e foi medida: a janela local só começa e termina **onde houve um
 * separador**, nunca no meio de uma corrida de dígitos. Oito dígitos é curto:
 * deslizando livre, a auditoria lê telefone em `2026090512`
 * (protocolo), em `59082050` (CEP) e em `182025222026` ("18 eventos em 2025 e 22 em
 * 2026"). Medido: o corpus de 40 mensagens reais de fornecedor sai de 5 bloqueios para
 * 10, e os 10 exemplos reais dos próprios prompts, de 0 para 3.
 *
 * Esta é uma implementação própria, sem uma linha em comum com a da regra, e continua
 * mais frouxa que ela em tudo o que decide: aceita 9 dígitos começando em 6–9 (a regra
 * exige `9` seguido de 6–9), aceita 8 dígitos começando em 2–9 (a regra também, mas com
 * as zonas de CEP, data e valor por cima), e não conhece exceção nenhuma. As duas únicas
 * recusas são aritméticas e existem porque aparecem em texto de verdade: o par de anos
 * (`1990-2020`) e a pontuação fora do lugar em que um telefone a põe.
 */
const COMPRIMENTOS_LOCAIS = [9, 8] as const;
/** Espaço e invisível separam dígitos do mesmo número e não contam. */
const ESPACO_LOCAL = /[\s\u00a0\u200b-\u200f\u2060\ufeff\u00ad]/u;
/** Hífen e ponto separam dígitos do mesmo número, mas contam: um só, e no lugar certo. */
const PONTUACAO_LOCAL = /[-\u2010-\u2015\u2212\uff0d.\uff0e\u00b7\u2022\u2043\u30fb\u066b\u066c_~*+]/u;

function eAno(valor: string): boolean {
  const numero = Number(valor);
  return valor.length === 4 && numero >= 1900 && numero <= 2100;
}

/**
 * `3222-1188` põe o hífen depois do 4º dígito; `99988-0011`, depois do 5º. O CEP
 * `59082-050` põe depois do 5º num grupo de oito, a data ISO `2026-09-05` põe dois, e
 * `21.11.2026` põe dois pontos. Nenhuma pontuação é o caso mais comum e passa direto.
 */
function pontuacaoNoLugarDeTelefone(
  posicoes: readonly number[],
  comprimento: number,
): boolean {
  return posicoes.length === 0 || (posicoes.length === 1 && posicoes[0] === comprimento - 4);
}

interface GrupoLocal {
  readonly digitos: string;
  /** Onde cada dígito do grupo começa no texto original. */
  readonly posicoes: readonly number[];
  /** Onde cada dígito do grupo termina no texto original. */
  readonly fins: readonly number[];
  /** Deslocamentos em que houve separador, mais as duas pontas: onde a janela pode cortar. */
  readonly cortes: readonly number[];
  /** Desses, os que são hífen ou ponto. */
  readonly pontuacoes: readonly number[];
}

/** Os grupos de dígitos do texto, com onde cada um começa e termina no original. */
function gruposLocais(texto: string): GrupoLocal[] {
  const grupos: GrupoLocal[] = [];
  let digitos = '';
  let posicoes: number[] = [];
  let fins: number[] = [];
  let cortes: number[] = [];
  let pontuacoes: number[] = [];
  let pendentesDeCorte: number[] = [];
  let pendentesDePontuacao: number[] = [];
  const fechar = (): void => {
    if (digitos.length > 0) {
      grupos.push({ digitos, posicoes, fins, cortes: [...cortes, digitos.length], pontuacoes });
    }
    digitos = '';
    posicoes = [];
    fins = [];
    cortes = [];
    pontuacoes = [];
    pendentesDeCorte = [];
    pendentesDePontuacao = [];
  };
  for (let i = 0; i < texto.length; ) {
    const codigo = texto.codePointAt(i) as number;
    const largura = codigo > 0xffff ? 2 : 1;
    const caractere = String.fromCodePoint(codigo);
    const algarismo = valorDoDigito(caractere);
    if (algarismo !== undefined) {
      // Separador só está dentro do número se vier outro dígito depois dele.
      if (digitos.length === 0) cortes = [0];
      else {
        cortes.push(...pendentesDeCorte);
        pontuacoes.push(...pendentesDePontuacao);
      }
      pendentesDeCorte = [];
      pendentesDePontuacao = [];
      digitos += algarismo;
      posicoes.push(i);
      fins.push(i + largura);
    } else if (digitos.length > 0) {
      if (PONTUACAO_LOCAL.test(caractere)) {
        pendentesDeCorte.push(digitos.length);
        pendentesDePontuacao.push(digitos.length);
      } else if (ESPACO_LOCAL.test(caractere)) pendentesDeCorte.push(digitos.length);
      else fechar();
    }
    i += largura;
  }
  fechar();
  return grupos;
}

/** Os cortes do grupo mais o ponto logo depois dos zeros de discagem de cada corte. */
function fronteirasDoGrupo(grupo: GrupoLocal): number[] {
  const fronteiras = new Set(grupo.cortes);
  for (const corte of grupo.cortes) {
    let cursor = corte;
    while (cursor < grupo.digitos.length && grupo.digitos[cursor] === '0') cursor += 1;
    if (cursor > corte) fronteiras.add(cursor);
  }
  return [...fronteiras].sort((a, b) => a - b);
}

/**
 * Oito dígitos corridos que leem uma data (`20260905`, `21112026`) e não um telefone.
 *
 * É a única recusa que esta camada acrescentou junto com a janela local, e ela existe por
 * aritmética, não por gosto: sem ela, toda mensagem que trouxesse uma data compacta
 * **barraria a chamada** — e barrar chamada legítima é o produto parando. A recusa vale
 * só para a corrida sem separador nenhum: `3101 2026` e `3101-2026` continuam telefone.
 *
 * Ela não afrouxa a janela de 10 a 13 dígitos, que continua sem desconto de espécie
 * alguma. O preço é conhecido e está no README: um fixo local de oito dígitos escrito
 * corrido e com forma de data não é acusado por ninguém.
 */
function eDataCompactaAuditada(digitos: string): boolean {
  const ano = (quatro: string): boolean => Number(quatro) >= 1900 && Number(quatro) <= 2100;
  const mesDia = (mm: string, dd: string): boolean =>
    Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31;
  if (digitos.length !== 8) return false;
  if (ano(digitos.slice(0, 4)) && mesDia(digitos.slice(4, 6), digitos.slice(6))) return true;
  return ano(digitos.slice(4)) && mesDia(digitos.slice(2, 4), digitos.slice(0, 2));
}

function eLocalAuditado(digitos: string): boolean {
  if (digitos.length === 9) return /[6-9]/.test(digitos[0] ?? '');
  if (digitos.length === 8) {
    if (!/[2-9]/.test(digitos[0] ?? '')) return false;
    return !(eAno(digitos.slice(0, 4)) && eAno(digitos.slice(4)));
  }
  return false;
}

/** Verificações próprias de e-mail e @: mais cruas que as da regra, e por isso pegam mais. */
const EMAIL_AUDITADO = /[^\s@]+@[^\s@]+\.[^\s@,;]{2,}/g;
const INSTAGRAM_AUDITADO = /(?:^|[^\w@])(@[A-Za-z0-9._]{2,}|(?:www\.)?instagram\.com\/\S+)/g;

/**
 * O guardrail que não confia em ninguém, rodando sobre **um trecho de origem externa**,
 * já pseudonimizado: a transcrição, a anotação, a mensagem do lead, o nome digitado.
 * Sem fronteira nenhuma — nem de letra. Se sobrou telefone, e-mail ou @, a chamada não
 * sai. Quem separa "texto nosso" de "texto de fora" é `prepararChamada`.
 */
export function verificarSemPii(texto: string): ProblemaDePii[] {
  return varrer(texto, false);
}

/**
 * A rede de segurança sobre a mensagem **inteira** já montada (prompt de sistema junto),
 * com a fronteira de letra. Não substitui a auditoria e não é ela: existe só para pegar
 * o que a montagem trouxer de fora da entrada validada — texto que, por não estar em
 * campo nenhum, jamais chegaria a `verificarSemPii`. Sem a fronteira, os quatro prompts
 * de sistema deste pacote barrariam toda chamada; com ela, custa zero falso positivo.
 */
export function varrerMontagem(texto: string): ProblemaDePii[] {
  return varrer(texto, true);
}

function varrer(texto: string, quebrarNaLetra: boolean): ProblemaDePii[] {
  const problemas: ProblemaDePii[] = [];
  /** O que já foi acusado, para não reportar a mesma janela quatro vezes. */
  const acusados: Array<[number, number]> = [];
  const registrar = (tipo: TipoDePii, inicio: number, fim: number): void => {
    if (acusados.some(([a, b]) => inicio < b && fim > a)) return;
    acusados.push([inicio, fim]);
    problemas.push({ tipo, trecho: texto.slice(inicio, fim) });
  };

  // E-mail e @ primeiro: um telefone escrito dentro de um e-mail é um e-mail, e é assim
  // que ele deve ser acusado.
  for (const achado of texto.matchAll(EMAIL_AUDITADO)) {
    if (achado.index === undefined) continue;
    registrar('EMAIL', achado.index, achado.index + achado[0].length);
  }
  for (const achado of texto.matchAll(INSTAGRAM_AUDITADO)) {
    if (achado.index === undefined) continue;
    const valor = achado[1] as string;
    const inicio = achado.index + achado[0].length - valor.length;
    registrar('INSTAGRAM', inicio, inicio + valor.length);
  }

  for (const segmento of projetar(texto, quebrarNaLetra)) {
    const total = segmento.digitos.length;
    let i = 0;
    while (i < total) {
      const comprimento = COMPRIMENTOS.find(
        (candidato) => i + candidato <= total && DDDS.has(Number(segmento.digitos.slice(i, i + 2))),
      );
      if (comprimento === undefined) {
        i += 1;
        continue;
      }
      registrar(
        'TELEFONE',
        segmento.posicoes[i] as number,
        segmento.fins[i + comprimento - 1] as number,
      );
      i += comprimento;
    }
  }

  for (const grupo of gruposLocais(texto)) {
    const fronteiras = fronteirasDoGrupo(grupo);
    for (const abertura of fronteiras) {
      for (const comprimento of COMPRIMENTOS_LOCAIS) {
        if (!fronteiras.includes(abertura + comprimento)) continue;
        const digitos = grupo.digitos.slice(abertura, abertura + comprimento);
        if (!eLocalAuditado(digitos)) continue;
        const corrida = !fronteiras.some((f) => f > abertura && f < abertura + comprimento);
        if (corrida && eDataCompactaAuditada(digitos)) continue;
        const dentroDaJanela = grupo.pontuacoes
          .filter((p) => p > abertura && p < abertura + comprimento)
          .map((p) => p - abertura);
        if (!pontuacaoNoLugarDeTelefone(dentroDaJanela, comprimento)) continue;
        registrar(
          'TELEFONE',
          grupo.posicoes[abertura] as number,
          grupo.fins[abertura + comprimento - 1] as number,
        );
        break;
      }
    }
  }

  return problemas;
}

export class PiiNaChamadaError extends Error {
  readonly problemas: readonly ProblemaDePii[];
  constructor(problemas: readonly ProblemaDePii[]) {
    super(
      `A chamada ao modelo carregaria dado pessoal: ${problemas
        .map((p) => `${p.tipo}${p.campo === undefined ? '' : ` em ${p.campo}`} (${p.trecho})`)
        .join(', ')}.`,
    );
    this.name = 'PiiNaChamadaError';
    this.problemas = problemas;
  }
}
