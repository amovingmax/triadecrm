/**
 * Pseudonimização do que vai ao modelo (ADR-09; PRD §10 "Privacidade"; R06 IA-06).
 *
 * A regra é curta e não tem exceção: **nenhum prompt recebe telefone.** Nome, e-mail e
 * @instagram também saem, trocados por marcadores estáveis; o que volta do modelo é
 * reidratado antes de chegar a uma pessoa. O que identifica o caso para o modelo é o
 * `leadId`, e mais nada.
 *
 * ## O que mudou na 7ª versão (2026-09-05 — laudo §3.4)
 *
 * O número **ditado por extenso** — "oito quatro nove nove nove oito oito zero zero um
 * um" — passava inteiro. As seis versões anteriores procuram na projeção de dígitos, e um
 * número ditado não tem dígito: a projeção dele é vazia. Vazava até o telefone que o CRM
 * **já tem no cadastro**, pela passada 2, que este arquivo diz que "não pode falhar".
 * A passada 6 lê o texto em FICHAS (palavra de algarismo ou corrida de dígitos), soma os
 * dígitos da corrida e roda a mesma janela da Anatel sobre ela. Ver `corridasDitadas`
 * para as duas travas que seguram o falso positivo — medidas contra o mesmo corpus de 40
 * mensagens: continua em 5 de 40.
 *
 * ## O que mudou na 6ª versão (2026-09-05)
 *
 * O telefone **local, sem DDD**, deixou de ser reconhecido pela grafia. Até aqui a
 * passada 5 era uma expressão regular com hífen literal (`99988-0011`, `3222-1188`), e
 * quem escrevesse `99988 0011` ou `999880011` — o jeito comum de passar o próprio número
 * dentro da cidade — mandava o número inteiro para a Anthropic, sem a regra ver e sem a
 * auditoria ver. Repartido entre dois campos (`99988` num, `0011` noutro) escapava pelo
 * mesmo motivo: a junção não tem hífen nenhum.
 *
 * Agora é janela na projeção, como as outras passadas — com uma diferença que foi medida
 * antes de ser decidida: a janela local **não desliza**, ela é o grupo de dígitos
 * inteiro. Oito dígitos é entropia curta demais para uma corrediça; solta sobre a
 * projeção ela lê telefone em protocolo, em data e em sequência de anos. Medido: com a
 * janela deslizando, o corpus de 40 mensagens reais de fornecedor sai de 5 para **10**
 * bloqueios, os 10 exemplos reais dos próprios prompts saem de 0 para **3**, e a regra
 * passa a estragar texto (`protocolo 2026090512` vira `protocolo [[TELEFONE_2]]12`). Com
 * o corte no separador, mais a forma da pontuação (`pontuacaoEmFormaDeTelefone`), os três
 * números voltam a ser 5, 0 e 0 — os mesmos de antes do conserto. Ver `gruposDeDigitos`.
 *
 * ## O que mudou na 4ª versão (2026-09-05)
 *
 * A projeção continua exatamente como estava — ela funcionou. O que estava pela metade
 * era a pergunta que ela faz a cada caractere. A 3ª versão respondia "é dígito decimal?"
 * (categoria `Nd`), e por isso pegava árabe-índico e matemático negrito mas deixava passar
 * **circulado, sobrescrito e subscrito**, que são `No`. A pergunta agora é outra —
 * "*qual algarismo este ponto de código representa?*" —, respondida pelo NFKC daquele
 * ponto de código **sozinho** (nunca da string inteira, que muda de comprimento e destrói
 * o mapa de volta ao original). Ver `valorDoDigito`.
 *
 * ## Por que este arquivo foi reescrito (3ª versão, 2026-09-05)
 *
 * As duas versões anteriores detectavam telefone **reconhecendo formatação**: corridas
 * de dígitos separados por pontuação, com travas de comprimento e de "fronteira de
 * grupo". As duas caíram na conferência adversarial, e sempre do mesmo jeito — apareceu
 * uma arrumação que a heurística não previa. A mais simples de todas derrubou a v2:
 *
 *     salva ai: 84 99988 - 0011
 *
 * saía **literalmente assim** na mensagem que iria para a Anthropic, com a auditoria
 * devolvendo `[]`. Enquanto a detecção depender de reconhecer padrão de formatação,
 * sempre haverá uma formatação nova.
 *
 * Por isso a detecção agora acontece sobre a **projeção de dígitos**: uma vez por texto
 * monta-se a string com os dígitos do texto inteiro e o vetor que diz, para cada dígito,
 * o índice dele no original. Formatação deixa de existir como conceito —
 * `84 99988 - 0011`, `(84)99988.0011`, `84/99988/0011` e `8 4 9 9 9 8 8 0 0 1 1` são o
 * mesmo objeto para o algoritmo.
 *
 * ## As quatro passadas, nesta ordem
 *
 * 1. **Reservado.** Marcadores já colocados (`[[NOME_1]]`), e-mails e @ saem do caminho
 *    primeiro: os dígitos deles ficam bloqueados e não entram em nenhuma janela.
 * 2. **Telefone conhecido.** Para cada telefone que o CRM tem no cadastro, as variantes
 *    em dígitos (com e sem o `55`, com e sem o nono dígito) são procuradas como
 *    **substring da projeção**. Achou, sai — sem regex, sem trava de agrupamento, sem
 *    heurística de formatação, sem olhar para o texto. Este caminho não pode falhar: é
 *    o dado que o CRM tem em mãos, e seria absurdo confiá-lo a um acerto de regex.
 * 3. **Documento.** uuid, CNPJ (com dígito verificador conferido) e CPF viram
 *    `[[DOCUMENTO_n]]`. Não é telefone e não é o objetivo do guardrail — é o preço de
 *    manter a auditoria burra (veja `auditoria-pii.ts`): 14 dígitos crus barrariam a
 *    chamada, então a regra os remove em vez de a auditoria os perdoar. É o conserto
 *    "substituir mais", nunca "auditar menos". Mascarar também **não pode vazar**: o
 *    que vira marcador some do texto de qualquer jeito.
 * 4. **Telefone desconhecido.** Janela deslizante sobre a projeção, testando 13, 12, 11
 *    e 10 dígitos que sejam telefone brasileiro plausível pela numeração da Anatel
 *    (`telefone-br.ts`). Só **depois** de achar é que se olha o texto original — e só
 *    para **recusar**, nunca para deixar de procurar. Recusa-se quando o trecho
 *    atravessa uma palavra (nenhuma pessoa escreve telefone com letra no meio) ou cai
 *    dentro de um CEP, de uma data ou de um valor em reais. Na dúvida, substitui: um
 *    falso positivo custa uma palavra trocada no texto que vai ao modelo; um falso
 *    negativo custa um telefone real na API. Os dois não se equivalem.
 * 5. **Telefone local sem DDD.** Uma janela de 8 ou 9 dígitos que comece e termine onde
 *    houve separador, e que seja telefone local plausível pela Anatel. É a passada da 6ª
 *    versão, e a única em que a janela não desliza livre — ver `gruposDeDigitos` para o
 *    porquê medido.
 *
 * 6. **Ditado por extenso.** As dez palavras de algarismo (mais `meia`) viram dígitos numa
 *    fita própria, e a janela roda sobre ela. É a única passada que não usa a projeção,
 *    porque é a única cujo objeto não tem dígito nenhum. Ver `corridasDitadas`.
 *
 * O que a regra **recusa** continua no texto — e é exatamente por isso que a recusa é
 * segura: o que ela deixa passar, a auditoria de `auditoria-pii.ts` enxerga, e a chamada
 * não sai. A conferência final não está aqui, e é outra implementação de propósito.
 *
 * O marcador é `[[TIPO_n]]`: maiúsculo e com colchete duplo para não colidir com os
 * `[nome]` do roteiro de ligação nem com os `{{nome}}` dos modelos de mensagem.
 */

import {
  COMPRIMENTOS_DE_TELEFONE,
  COMPRIMENTOS_LOCAIS,
  eDataCompacta,
  eTelefoneBrasileiro,
  eTelefoneLocalBrasileiro,
  variantesDoTelefoneConhecido,
} from './telefone-br';

export type TipoDePii = 'NOME' | 'EMPRESA' | 'TELEFONE' | 'EMAIL' | 'INSTAGRAM' | 'DOCUMENTO';

export interface ContextoDoContato {
  /**
   * O identificador que o modelo enxerga. Não é PII e não é trocado — e por isso ele
   * chega à mensagem em claro, passando pela auditoria como qualquer outro texto.
   *
   * **Use um id curto (`lead-0f21`), nunca o uuid cru da linha.** Um uuid tem 32 dígitos
   * hexadecimais e, medido sobre 20 mil sorteios, 11,1% deles contêm uma corrida de dez
   * algarismos começando por um DDD válido — e a auditoria, que é burra de propósito,
   * recusa a chamada. Um em cada nove leads pararia sem motivo.
   */
  readonly leadId: string;
  readonly nome?: string | null;
  readonly empresa?: string | null;
  readonly telefones?: readonly string[];
  readonly emails?: readonly string[];
  readonly instagram?: string | null;
}

export interface MapaDePseudonimos {
  readonly leadId: string;
  /** marcador → valor original. É o que reidrata a saída. */
  readonly porMarcador: ReadonlyMap<string, string>;
}

export interface ResultadoDaPseudonimizacao {
  readonly texto: string;
  readonly mapa: MapaDePseudonimos;
}

const ACENTOS = /[\u0300-\u036f]/g;

/** minúsculo, sem acento, espaços colapsados. Espelha `app.search_name` do banco. */
export function chaveDeComparacao(valor: string): string {
  return valor.normalize('NFD').replace(ACENTOS, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** `@fulano`, `fulano` e `instagram.com/fulano` são o mesmo perfil. */
function usuarioDoInstagram(valor: string): string {
  return valor
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/$/, '');
}

function escaparRegex(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const EMAIL = /[\p{L}0-9._%+-]+@[\p{L}0-9-]+(?:\.[\p{L}0-9-]+)+/gu;
const INSTAGRAM_URL = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[\p{L}0-9_.]+\/?/giu;
const INSTAGRAM_ARROBA = /@[\p{L}0-9_.]{2,30}/gu;

/**
 * Os marcadores que esta própria classe coloca. O `_n` deles é dígito, e dígito entra na
 * projeção: sem tirá-los do caminho, `[[NOME_1]] 84988887777` viraria uma janela de dez
 * dígitos começando no `1` do marcador. O contador é limitado a duas casas de propósito
 * — quanto menos dígito este padrão puder engolir, menos ele serve de esconderijo.
 */
const MARCADOR = /\[\[(?:NOME|EMPRESA|TELEFONE|EMAIL|INSTAGRAM|DOCUMENTO)_\d{1,2}\]\]/g;

/** Uma letra qualquer. Telefone não tem letra no meio; palavra tem. */
const LETRA = /\p{L}/u;

/**
 * Os separadores que cabem **dentro** de um telefone, para efeito de agrupamento.
 *
 * Espaço e caractere invisível são livres: `8 4 9 9 9 8 8 0 0 1 1` é um número escrito
 * por gente de verdade, e o espaço de largura zero é o truque de sempre para quebrar
 * varredura. Hífen (em todas as suas grafias), ponto, ponto médio, separador decimal
 * árabe e uns poucos vizinhos também separam dígitos do mesmo número, mas **contam** —
 * ver `pontuacaoEmFormaDeTelefone`. Barra, vírgula, dois-pontos, ponto e vírgula, barra
 * vertical e qualquer letra **fecham** o grupo, e é isso que mantém `12/12/2026` sendo
 * três grupos de dígitos em vez de um de oito, e `99988-0011; 98888-7777` sendo dois
 * telefones em vez de um grupo de dezoito.
 */
const ESPACO_OU_INVISIVEL = /[\s\u00a0\u200b-\u200f\u2060\ufeff\u00ad]/u;
const PONTUACAO_DE_TELEFONE = /[-\u2010-\u2015\u2212\uff0d.\uff0e\u00b7\u2022\u2043\u30fb\u066b\u066c_~*+]/u;

/**
 * Grafias que **não são telefone** e que a regra não substitui: o texto sai inteiro
 * para o modelo, e a janela que cair dentro delas é recusada. Recusar aqui é seguro
 * porque o que fica no texto continua exposto à auditoria — nenhuma destas grafias é
 * comprida o bastante para esconder um telefone dentro de si.
 */
const GRAFIAS_NAO_TELEFONICAS: readonly RegExp[] = [
  /(?<!\d)\d{5}-\d{3}(?!\d)/g, // CEP
  /(?<!\d)\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?(?!\d)/g, // data/hora ISO
  /(?<!\d)\d{2}\/\d{2}\/\d{4}(?!\d)/g, // data BR
  /(?<!\d)\d{2}\/\d{2}\/\d{2}(?!\d)/g,
  /R\$\s?\d[\d.,]*/g, // valor em reais
];

/**
 * Grafias que a regra **substitui** por `[[DOCUMENTO_n]]`. Aqui não há risco de vazar:
 * o que vira marcador some do texto. O que se ganha é a auditoria poder continuar burra
 * — um uuid ou um CNPJ crus barrariam a chamada, e barrar toda mensagem que cita um
 * CNPJ seria inutilizar o produto. CPF entra de brinde: pelo ADR-09 ele nem deveria
 * existir no CRM, e se aparecer numa transcrição é melhor que não chegue ao modelo.
 */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const CPF = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g;
const CNPJ = /(?<!\d)(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})(?!\d)/g;

function digitoDeControle(base: string, pesoInicial: number): number {
  let soma = 0;
  let peso = pesoInicial;
  for (const caractere of base) {
    soma += Number(caractere) * peso;
    peso = peso === 2 ? 9 : peso - 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * Confere os dois dígitos verificadores. Só a **regra** pode se dar a esse luxo: se o DV
 * não bate, não é CNPJ, e os 14 dígitos voltam a ser candidatos a telefone. A auditoria
 * não faz nada disso — foi exatamente o desconto por DV que abriu, na v2, um buraco de
 * 14 dígitos onde bastava colar três números no fim de um celular para calar a segunda
 * camada.
 */
function eCnpj(digitos: string): boolean {
  if (digitos.length !== 14 || /^(\d)\1{13}$/.test(digitos)) return false;
  return (
    digitoDeControle(digitos.slice(0, 12), 5) === Number(digitos[12]) &&
    digitoDeControle(digitos.slice(0, 13), 6) === Number(digitos[13])
  );
}

/**
 * A pontuação de dentro do grupo está no lugar em que um telefone a põe?
 *
 * Um local escrito com pontuação leva **um** hífen (ou um ponto), e ele cai depois do
 * quarto dígito num número de oito (`3222-1188`) ou depois do quinto num de nove
 * (`99988-0011`). Mais de um, ou em outro lugar, é outra coisa — e são justamente as
 * outras coisas de oito dígitos que enchem o mundo:
 *
 * - `59082-050` — CEP: um hífen, mas depois do **quinto** dígito num grupo de oito.
 * - `2026-09-05` — data ISO: dois hífens.
 * - `21.11.2026` — data com ponto: dois pontos.
 * - `12.345.678` — começo de CNPJ: dois pontos.
 *
 * Espaço não conta e pode aparecer à vontade: ele não distingue nada.
 */
function pontuacaoEmFormaDeTelefone(
  posicoes: readonly number[],
  comprimento: number,
): boolean {
  if (posicoes.length === 0) return true;
  if (posicoes.length > 1) return false;
  return posicoes[0] === comprimento - 4;
}

interface Ocorrencia {
  readonly inicio: number;
  readonly fim: number;
  readonly tipo: TipoDePii;
  readonly original: string;
  /**
   * Os dígitos que este trecho VALE, quando o texto não os tem escritos.
   *
   * Existe por causa da passada 6: `oito quatro nove nove nove oito oito zero zero um um`
   * é um telefone sem um algarismo dentro. A chave do marcador é feita dos dígitos (é o
   * que faz `(84) 99988-0011` e `+5584999880011` virarem o mesmo `[[TELEFONE_1]]`), e sem
   * este campo o número ditado cairia na chave vazia — todos os telefones ditados de uma
   * conversa viravam um marcador só.
   */
  readonly digitos?: string;
}

type Intervalo = readonly [number, number];

/**
 * A projeção: os dígitos do texto inteiro, sem nada mais, e o índice original de cada um.
 * É construída uma vez por texto e é sobre ela que toda a detecção acontece.
 */
interface Projecao {
  readonly digitos: string;
  /** Onde cada dígito começa no texto original. */
  readonly posicoes: readonly number[];
  /** Onde cada dígito termina. Só difere de `posicoes[k] + 1` fora do BMP — os
   * algarismos "estilizados" (𝟴𝟰𝟵…) que as redes sociais espalharam ocupam dois
   * code units, e cortar no meio deles corromperia o texto. */
  readonly fins: readonly number[];
}

/**
 * **Qual algarismo este ponto de código representa?** — 0 a 9, ou nenhum.
 *
 * A pergunta é feita **ponto de código por ponto de código, sobre o texto original**, e é
 * isso que mantém a projeção alinhada com o texto: um ponto de código entra, um algarismo
 * (ou nada) sai, e o índice de volta continua exato. Normalizar a string inteira com NFKC
 * seria mais curto e está errado — NFKC muda o comprimento (`⑴` vira `(1)`), e com o
 * comprimento vai embora o mapa de volta ao original, que é o que permite recortar o
 * telefone sem corromper o resto da frase. Foi por aí que a 3ª versão ficou pela metade:
 * ela tratou `Nd` (árabe-índico, matemático negrito) e parou ali, e algarismo circulado,
 * sobrescrito e subscrito — que são `No`, não `Nd` — passaram inteiros.
 *
 * A resposta sai de quatro mecanismos, nesta ordem:
 *
 * 1. **ASCII.** O caso de quase todo texto, resolvido sem alocar nada.
 * 2. **NFKC do ponto de código SOZINHO.** Se a decomposição de compatibilidade daquele
 *    caractere, tirada a moldura (parêntese, ponto, vírgula), for um único algarismo
 *    ASCII e nenhuma letra, é esse o algarismo. Isto cobre, sem citar nenhum deles:
 *    largura inteira (`８`), matemático negrito (`𝟴`), sobrescrito (`⁸`), subscrito (`₈`),
 *    circulado (`⑧`, `⓪`), entre parênteses (`⑻`), com ponto (`⒏`, `🄀`) — e as famílias
 *    que o Unicode ainda vier a acrescentar com decomposição, sem tabela para manter.
 *    Recusa o que só *parece*: `⑩` decompõe em `10` (é dez, não um algarismo), `½` em
 *    `1⁄2`, `㎡` em `m2` (tem letra), `Ⅷ` em `VIII`, `º` em `o`.
 * 3. **Dígito decimal sem decomposição** (categoria `Nd`): árabe-índico `٨`, devanagári
 *    `८` e as dezenas de escritas iguais a essas. O valor é calculado procurando o começo
 *    do bloco de dez que contém o caractere — de novo, sem lista.
 * 4. **A exceção honesta.** Quatro famílias decorativas (`⓵`, `❶`, `➀`, `➊`) e três zeros
 *    soltos (`⓿`, `🄋`, `🄌`) não são `Nd` **e** não têm decomposição nenhuma: o Unicode
 *    não expõe, em JavaScript, o valor numérico delas. Para essas não há o que calcular —
 *    são faixas escritas à mão, e é a única parte deste arquivo que envelhece. Estão aqui
 *    porque qualquer pessoa lê `➑➍` como `84`, e falso negativo não se negocia.
 */
const DIGITO_UNICODE = /\p{Nd}/u;
/** Moldura de algarismo: o que o NFKC devolve *em volta* do dígito, e não é o dígito. */
const MOLDURA_DO_ALGARISMO = /[()[\]{}.,\u2044\uFF0E\uFF0C\s]/u;

/** Ponto de código inicial de cada família decorativa que vale 1…9, e os zeros soltos. */
const FAMILIAS_DECORATIVAS: readonly number[] = [
  0x24f5, // ⓵ ⓶ ⓷ … double circled
  0x2776, // ❶ ❷ ❸ … dingbat negative circled
  0x2780, // ➀ ➁ ➂ … dingbat circled sans-serif
  0x278a, // ➊ ➋ ➌ … dingbat negative circled sans-serif
];
const ZEROS_DECORATIVOS: ReadonlySet<number> = new Set([0x24ff, 0x1f10b, 0x1f10c]);

/** O algarismo que a decomposição de compatibilidade revela, quando revela um só. */
function algarismoPorCompatibilidade(caractere: string): string | undefined {
  const compativel = caractere.normalize('NFKC');
  if (compativel === caractere) return undefined;
  let achado: string | undefined;
  for (const parte of compativel) {
    if (parte >= '0' && parte <= '9') {
      // Dois algarismos não são um algarismo: `⑩` → `10`, `⑽` → `(10)`, `½` → `1⁄2`.
      if (achado !== undefined) return undefined;
      achado = parte;
      continue;
    }
    // Letra ou qualquer coisa que não seja moldura desqualifica: `㎡` → `m2`, `⒑` → `10.`.
    if (LETRA.test(parte) || !MOLDURA_DO_ALGARISMO.test(parte)) return undefined;
  }
  return achado;
}

/** O algarismo de um `Nd` sem decomposição: o começo do bloco de dez que o contém. */
function algarismoPorBloco(caractere: string): string | undefined {
  if (!DIGITO_UNICODE.test(caractere)) return undefined;
  const codigo = caractere.codePointAt(0) as number;
  for (let valor = 0; valor <= 9; valor += 1) {
    const zero = codigo - valor;
    if (
      DIGITO_UNICODE.test(String.fromCodePoint(zero)) &&
      !DIGITO_UNICODE.test(String.fromCodePoint(zero - 1))
    ) {
      return String(valor);
    }
  }
  return undefined;
}

function algarismoDecorativo(caractere: string): string | undefined {
  const codigo = caractere.codePointAt(0) as number;
  if (ZEROS_DECORATIVOS.has(codigo)) return '0';
  for (const inicio of FAMILIAS_DECORATIVAS) {
    if (codigo >= inicio && codigo <= inicio + 8) return String(codigo - inicio + 1);
  }
  return undefined;
}

function valorDoDigito(caractere: string): string | undefined {
  if (caractere >= '0' && caractere <= '9') return caractere;
  return (
    algarismoPorCompatibilidade(caractere) ??
    algarismoPorBloco(caractere) ??
    algarismoDecorativo(caractere)
  );
}

/** Os dígitos de um valor qualquer, em ASCII. É a chave de comparação de telefone. */
function digitosDe(valor: string): string {
  let saida = '';
  for (const caractere of valor) saida += valorDoDigito(caractere) ?? '';
  return saida;
}

function projetar(texto: string): Projecao {
  const digitos: string[] = [];
  const posicoes: number[] = [];
  const fins: number[] = [];
  for (let i = 0; i < texto.length;) {
    const codigo = texto.codePointAt(i) as number;
    const largura = codigo > 0xffff ? 2 : 1;
    const algarismo = valorDoDigito(String.fromCodePoint(codigo));
    if (algarismo !== undefined) {
      digitos.push(algarismo);
      posicoes.push(i);
      fins.push(i + largura);
    }
    i += largura;
  }
  return { digitos: digitos.join(''), posicoes, fins };
}

/**
 * Um grupo de dígitos: a corrida contígua que sobrevive aos separadores de telefone.
 *
 * Os índices são os da **projeção**, não os do texto — quem os traduz de volta é
 * `registrarTelefone`, como em qualquer outra passada.
 */
interface GrupoDeDigitos {
  readonly inicio: number;
  readonly fim: number;
  /**
   * Os deslocamentos, dentro do grupo, em que **algum** separador apareceu — mais o `0`
   * do começo e o comprimento do fim. São as únicas posições em que uma janela local pode
   * começar ou terminar: é isso que a impede de deslizar para dentro de uma corrida de
   * dígitos e ler telefone em `2026090512`.
   */
  readonly cortes: readonly number[];
  /** Desses, os que são hífen ou ponto — a pontuação que um telefone conta. */
  readonly pontuacoes: readonly number[];
}

/**
 * Os grupos de dígitos do texto.
 *
 * Existem por um motivo só, e ele é medido: **oito e nove dígitos é janela curta demais
 * para correr solta sobre a projeção.** A janela de 10 a 13 se sustenta porque o DDD mais
 * a faixa da Anatel a tornam improvável por acaso; a de 8 acha telefone em toda parte —
 * deslizando sobre `2026090512` (protocolo) ela lê `20260905`, e sobre `182025222026`
 * ("18 eventos em 2025 e 22 em 2026") ela lê `20252220`. Medido: a janela solta leva o
 * corpus de 40 mensagens reais de 5 para 10 bloqueios e os 10 exemplos dos próprios
 * prompts de 0 para 3.
 *
 * O grupo é a resposta, e com ele os **cortes**: a janela local só pode começar e
 * terminar onde houve um separador (ou na ponta do grupo). Dentro de uma corrida de
 * dígitos sem nenhum separador, ela não tem onde parar — e é por isso que `2026090512`,
 * dez dígitos corridos, não vira telefone, enquanto `99988 0011 98888 7777` vira dois.
 *
 * Isto continua não sendo detecção por grafia: a formatação não decide **se** o número é
 * procurado, e sim onde a janela pode cortar. Espaço, invisível, hífen e ponto não
 * quebram o grupo — `99988 0011`, `99988-0011`, `9 9988 0011` e `999880011` são o mesmo
 * grupo. Letra, barra, vírgula e o resto quebram, e é o que mantém `12/12/2026` sendo
 * três grupos de dígitos em vez de um de oito.
 */
function gruposDeDigitos(texto: string): GrupoDeDigitos[] {
  const grupos: GrupoDeDigitos[] = [];
  let inicio = -1;
  let indice = 0;
  let cortes: number[] = [];
  let pontuacoes: number[] = [];
  let pendentesDeCorte: number[] = [];
  let pendentesDePontuacao: number[] = [];
  const fechar = (): void => {
    if (inicio >= 0) {
      grupos.push({ inicio, fim: indice, cortes: [...cortes, indice - inicio], pontuacoes });
    }
    inicio = -1;
    cortes = [];
    pontuacoes = [];
    pendentesDeCorte = [];
    pendentesDePontuacao = [];
  };
  for (let i = 0; i < texto.length; ) {
    const codigo = texto.codePointAt(i) as number;
    const largura = codigo > 0xffff ? 2 : 1;
    const caractere = String.fromCodePoint(codigo);
    if (valorDoDigito(caractere) !== undefined) {
      if (inicio < 0) {
        inicio = indice;
        cortes = [0];
      } else {
        // Separador só está DENTRO do grupo se vier outro dígito depois dele: o ponto
        // final de `liga no 3222-1188.` está fora do número.
        cortes.push(...pendentesDeCorte);
        pontuacoes.push(...pendentesDePontuacao);
      }
      pendentesDeCorte = [];
      pendentesDePontuacao = [];
      indice += 1;
    } else if (inicio >= 0) {
      const deslocamento = indice - inicio;
      if (PONTUACAO_DE_TELEFONE.test(caractere)) {
        pendentesDeCorte.push(deslocamento);
        pendentesDePontuacao.push(deslocamento);
      } else if (ESPACO_OU_INVISIVEL.test(caractere)) pendentesDeCorte.push(deslocamento);
      else fechar();
    }
    i += largura;
  }
  fechar();
  return grupos;
}

/**
 * Onde uma janela local pode começar ou terminar: os cortes do grupo, mais o ponto logo
 * depois dos **zeros de discagem** de cada corte.
 *
 * `0 99988 0011` e `099988-0011` são o mesmo número que `99988 0011` — o zero da frente é
 * prefixo de discagem, não dígito do telefone, e sem esta linha um zero colado desarmaria
 * a passada inteira. Zero é o único dígito que abre fronteira: qualquer outro colado na
 * frente é um dígito de verdade, e um número com um dígito a mais não é este número.
 */
function fronteirasLocais(digitos: string, grupo: GrupoDeDigitos): number[] {
  const fronteiras = new Set(grupo.cortes);
  const comprimento = grupo.fim - grupo.inicio;
  for (const corte of grupo.cortes) {
    let cursor = corte;
    while (cursor < comprimento && digitos[grupo.inicio + cursor] === '0') cursor += 1;
    if (cursor > corte) fronteiras.add(cursor);
  }
  return [...fronteiras].sort((a, b) => a - b);
}

/**
 * ===========================================================================
 * O NÚMERO DITADO POR EXTENSO (7ª versão, 2026-09-05 — laudo §3.4)
 * ===========================================================================
 *
 * "meu whats é oito quatro nove nove nove oito oito zero zero um um."
 *
 * As seis versões anteriores procuram telefone na **projeção de dígitos**, e isso
 * funcionou justamente porque apaga a formatação. Um número ditado, porém, não tem
 * formatação nem dígito: a projeção dele é **vazia**, e as duas camadas olhavam o texto e
 * não viam número nenhum. Escapava até o telefone que o CRM já tem no cadastro — a
 * passada 2, a que o arquivo diz que "não pode falhar".
 *
 * A leitura nova é uma fita própria, e não um remendo na projeção: o texto é lido em
 * FICHAS, e cada ficha vale um ou mais algarismos — uma palavra de algarismo vale um, uma
 * corrida de dígitos vale os dela. Fichas seguidas, separadas só por espaço, hífen, ponto
 * ou vírgula, formam uma CORRIDA, e é sobre os dígitos da corrida que a janela roda, nos
 * mesmos comprimentos da Anatel. `84 nove nove seis quatro cinco seis zero cinco quatro`
 * — meio escrito, meio ditado, que é o que mais aparece em transcrição — é uma corrida só.
 *
 * ## As duas travas contra o falso positivo, e por que são estas
 *
 * Falso positivo aqui **estraga o texto que vai ao modelo**: trocar "são oito eventos por
 * mês" por um marcador piora a resposta e não protege ninguém. As travas:
 *
 * 1. **A corrida precisa de pelo menos uma palavra.** Corrida só de dígitos é assunto das
 *    passadas 2, 4 e 5, que já a resolvem melhor (com zonas de CEP, data e valor).
 * 2. **Janela local (8 e 9 dígitos) só vale a corrida INTEIRA.** É a mesma aritmética da
 *    passada 5: oito dígitos é entropia curta, e deslizar dentro da corrida acha telefone
 *    onde não há. O caso concreto que isto barra é a contagem — "um, dois, três, quatro,
 *    cinco, seis, sete, oito, nove" tem, deslizando, um `23456789` que passa pela Anatel.
 *    Exigindo a corrida inteira, ela é `123456789`, que não começa com 9 e não é telefone.
 *    Para 10 a 13 dígitos a janela pode deslizar: ali o DDD mais a faixa da Anatel
 *    sustentam a decisão, e é isso que salva a pessoa que repete um dígito no fim.
 *
 * A variante conhecida (o telefone do cadastro) não passa por trava nenhuma: é o dado que
 * o CRM tem em mãos, e ele sai onde aparecer.
 */

/**
 * As dez palavras de algarismo. `meia` entra porque é como se dita o seis no Brasil
 * ("meia-um-dois"), e `uma`/`duas` porque a transcrição escreve o que foi falado.
 * A chave é comparada sem acento e em minúsculas (`três` → `tres`).
 */
const ALGARISMO_POR_EXTENSO: ReadonlyMap<string, string> = new Map([
  ['zero', '0'],
  ['um', '1'],
  ['uma', '1'],
  ['dois', '2'],
  ['duas', '2'],
  ['tres', '3'],
  ['quatro', '4'],
  ['cinco', '5'],
  ['seis', '6'],
  ['meia', '6'],
  ['sete', '7'],
  ['oito', '8'],
  ['nove', '9'],
]);

/** O que pode aparecer ENTRE duas fichas sem quebrar a corrida. Vírgula entra: quem dita
 * um número pontua ("oito quatro, nove nove seis..."). Barra, dois-pontos e o resto não. */
const SEPARADOR_DITADO =
  /[\s\u00a0\u200b-\u200f\u2060\ufeff\u00ad,.\u00b7\u2022\u2043\u30fb\-\u2010-\u2015\u2212\uff0d\uff0e]/u;

/** Uma ficha: o pedaço de texto que vale um ou mais algarismos. */
interface FichaDitada {
  readonly digitos: string;
  readonly inicio: number;
  readonly fim: number;
  readonly porExtenso: boolean;
  /** Os índices da projeção que esta ficha ocupa (vazio quando é palavra). */
  readonly naProjecao: readonly number[];
}

/** Uma corrida de fichas seguidas, e os dígitos que ela soma. */
interface CorridaDitada {
  readonly fichas: readonly FichaDitada[];
  readonly digitos: string;
  /** Deslocamento em dígitos do começo de cada ficha, mais o total no fim. */
  readonly deslocamentos: readonly number[];
}

/** minúsculo e sem acento, para `Três` e `tres` serem a mesma palavra. */
function palavraNormalizada(valor: string): string {
  return valor.normalize('NFD').replace(ACENTOS, '').toLowerCase();
}

/**
 * As corridas de fichas do texto.
 *
 * `quebrar` diz se uma ficha de dígitos já foi consumida por outra passada — quando foi,
 * a corrida termina ali, para a passada 6 não engolir o que a 4 ou a 5 já trocaram.
 */
function corridasDitadas(
  texto: string,
  indiceDaPosicao: ReadonlyMap<number, number>,
  jaConsumido: (indices: readonly number[]) => boolean,
): CorridaDitada[] {
  const corridas: CorridaDitada[] = [];
  let fichas: FichaDitada[] = [];

  const fechar = (): void => {
    if (fichas.length > 0 && fichas.some((f) => f.porExtenso)) {
      const deslocamentos: number[] = [];
      let soma = 0;
      for (const ficha of fichas) {
        deslocamentos.push(soma);
        soma += ficha.digitos.length;
      }
      deslocamentos.push(soma);
      corridas.push({
        fichas,
        digitos: fichas.map((f) => f.digitos).join(''),
        deslocamentos,
      });
    }
    fichas = [];
  };

  for (let i = 0; i < texto.length; ) {
    const codigo = texto.codePointAt(i) as number;
    const largura = codigo > 0xffff ? 2 : 1;
    const caractere = String.fromCodePoint(codigo);

    if (valorDoDigito(caractere) !== undefined) {
      // Uma corrida de dígitos é UMA ficha: `99988` vale cinco algarismos de uma vez.
      let cursor = i;
      let digitos = '';
      const naProjecao: number[] = [];
      while (cursor < texto.length) {
        const c = texto.codePointAt(cursor) as number;
        const w = c > 0xffff ? 2 : 1;
        const algarismo = valorDoDigito(String.fromCodePoint(c));
        if (algarismo === undefined) break;
        digitos += algarismo;
        const k = indiceDaPosicao.get(cursor);
        if (k !== undefined) naProjecao.push(k);
        cursor += w;
      }
      if (jaConsumido(naProjecao)) fechar();
      else fichas.push({ digitos, inicio: i, fim: cursor, porExtenso: false, naProjecao });
      i = cursor;
      continue;
    }

    if (LETRA.test(caractere)) {
      let cursor = i;
      while (cursor < texto.length) {
        const c = texto.codePointAt(cursor) as number;
        const w = c > 0xffff ? 2 : 1;
        if (!LETRA.test(String.fromCodePoint(c))) break;
        cursor += w;
      }
      const algarismo = ALGARISMO_POR_EXTENSO.get(palavraNormalizada(texto.slice(i, cursor)));
      if (algarismo === undefined) fechar();
      else fichas.push({ digitos: algarismo, inicio: i, fim: cursor, porExtenso: true, naProjecao: [] });
      i = cursor;
      continue;
    }

    if (!SEPARADOR_DITADO.test(caractere)) fechar();
    i += largura;
  }
  fechar();
  return corridas;
}

function intervalosDe(texto: string, padroes: readonly RegExp[]): Intervalo[] {
  const intervalos: Intervalo[] = [];
  for (const padrao of padroes) {
    for (const achado of texto.matchAll(padrao)) {
      if (achado.index !== undefined)
        intervalos.push([achado.index, achado.index + achado[0].length]);
    }
  }
  return intervalos;
}

function dentro(intervalos: readonly Intervalo[], posicao: number): boolean {
  return intervalos.some(([a, b]) => posicao >= a && posicao < b);
}

/** `+`, `(` e `[` grudados no primeiro dígito fazem parte do telefone, não da frase. */
const PREFIXOS_DE_TELEFONE = new Set(['+', '(', '[']);

function recuarSobrePrefixo(texto: string, inicio: number): number {
  let cursor = inicio;
  while (cursor > 0 && PREFIXOS_DE_TELEFONE.has(texto[cursor - 1] as string)) cursor -= 1;
  return cursor;
}

/** As ocorrências que a varredura encontra, em ordem e sem sobreposição. */
function varrer(texto: string, variantes: readonly string[]): Ocorrencia[] {
  const achados: Ocorrencia[] = [];
  const reservado: Intervalo[] = [];

  const coletar = (regex: RegExp, tipo: TipoDePii): void => {
    for (const achado of texto.matchAll(regex)) {
      if (achado.index === undefined) continue;
      // Espaço/pontuação de borda não fazem parte do dado; devolvê-los evita comer a
      // vírgula que separa o e-mail do resto da frase.
      const aparado = achado[0].replace(/[\s.,;:)-]+$/u, '');
      if (aparado.length === 0) continue;
      const inicio = achado.index;
      const fim = inicio + aparado.length;
      if (reservado.some(([a, b]) => inicio < b && fim > a)) continue;
      achados.push({ inicio, fim, tipo, original: aparado });
      reservado.push([inicio, fim]);
    }
  };

  // ------------------------------------------------------------- 1. reservado
  for (const achado of texto.matchAll(MARCADOR)) {
    if (achado.index !== undefined) reservado.push([achado.index, achado.index + achado[0].length]);
  }
  coletar(EMAIL, 'EMAIL');
  coletar(INSTAGRAM_URL, 'INSTAGRAM');
  coletar(INSTAGRAM_ARROBA, 'INSTAGRAM');

  const projecao = projetar(texto);
  const total = projecao.digitos.length;
  const bloqueado = projecao.posicoes.map((posicao) => dentro(reservado, posicao));

  const livre = (inicio: number, comprimento: number): boolean => {
    for (let k = inicio; k < inicio + comprimento; k += 1) if (bloqueado[k]) return false;
    return true;
  };
  const bloquear = (inicio: number, comprimento: number): void => {
    for (let k = inicio; k < inicio + comprimento; k += 1) bloqueado[k] = true;
  };
  const registrarTelefone = (indice: number, comprimento: number): void => {
    const inicio = recuarSobrePrefixo(texto, projecao.posicoes[indice] as number);
    const fim = projecao.fins[indice + comprimento - 1] as number;
    achados.push({ inicio, fim, tipo: 'TELEFONE', original: texto.slice(inicio, fim) });
    bloquear(indice, comprimento);
  };
  /** Onde cada dígito da projeção está no texto — a passada 6 anda pelo texto, não por ela. */
  const indiceDaPosicao = new Map<number, number>();
  projecao.posicoes.forEach((posicao, k) => indiceDaPosicao.set(posicao, k));

  // ------------------------------------------------- 2. telefone conhecido
  // Substring da projeção, e nada mais. Se os dígitos do telefone do contato estão no
  // texto, em qualquer arrumação, eles saem. Sem olhar a formatação, sem exceção.
  for (let i = 0; i < total;) {
    if (bloqueado[i]) {
      i += 1;
      continue;
    }
    const variante = variantes.find(
      (candidata) =>
        i + candidata.length <= total &&
        projecao.digitos.startsWith(candidata, i) &&
        livre(i, candidata.length),
    );
    if (variante === undefined) {
      i += 1;
      continue;
    }
    registrarTelefone(i, variante.length);
    i += variante.length;
  }

  // ------------------------------------------------------------ 3. documento
  const documentos: Intervalo[] = [];
  for (const achado of texto.matchAll(UUID)) {
    if (achado.index !== undefined)
      documentos.push([achado.index, achado.index + achado[0].length]);
  }
  for (const achado of texto.matchAll(CPF)) {
    if (achado.index !== undefined)
      documentos.push([achado.index, achado.index + achado[0].length]);
  }
  for (const achado of texto.matchAll(CNPJ)) {
    if (achado.index === undefined) continue;
    if (!eCnpj(achado[0].replace(/\D/g, ''))) continue;
    documentos.push([achado.index, achado.index + achado[0].length]);
  }
  for (const [inicio, fim] of documentos) {
    const indices: number[] = [];
    for (let k = 0; k < total; k += 1) {
      const posicao = projecao.posicoes[k] as number;
      if (posicao >= inicio && posicao < fim) indices.push(k);
    }
    if (indices.length === 0) continue;
    if (indices.some((k) => bloqueado[k])) continue;
    achados.push({ inicio, fim, tipo: 'DOCUMENTO', original: texto.slice(inicio, fim) });
    for (const k of indices) bloqueado[k] = true;
  }

  // -------------------------------------------------- 4. telefone desconhecido
  const zonas = intervalosDe(texto, GRAFIAS_NAO_TELEFONICAS);
  const tocaZona = (indice: number, comprimento: number): boolean => {
    for (let k = indice; k < indice + comprimento; k += 1) {
      if (dentro(zonas, projecao.posicoes[k] as number)) return true;
    }
    return false;
  };

  for (let i = 0; i < total;) {
    if (bloqueado[i]) {
      i += 1;
      continue;
    }
    let escolhido = 0;
    for (const comprimento of COMPRIMENTOS_DE_TELEFONE) {
      if (i + comprimento > total) continue;
      if (!livre(i, comprimento)) continue;
      if (!eTelefoneBrasileiro(projecao.digitos.slice(i, i + comprimento))) continue;
      // Só aqui a formatação entra, e só para RECUSAR. Nunca para deixar de procurar.
      const inicio = projecao.posicoes[i] as number;
      const fim = (projecao.posicoes[i + comprimento - 1] as number) + 1;
      if (LETRA.test(texto.slice(inicio, fim))) continue;
      if (tocaZona(i, comprimento)) continue;
      escolhido = comprimento;
      break;
    }
    if (escolhido === 0) {
      i += 1;
      continue;
    }
    registrarTelefone(i, escolhido);
    i += escolhido;
  }

  // ------------------------------------------------------- 5. local sem DDD
  // O caso comum, e o que esteve aberto até a 6ª versão: a pessoa passa o próprio número
  // dentro da cidade, sem DDD e sem hífen — `99988 0011`, `999880011`, `3222 1188`. Até
  // aqui só a grafia com hífen literal era reconhecida, e quem não apertasse essa tecla
  // mandava o número inteiro para a Anthropic.
  //
  // Agora é janela na projeção, como nas outras passadas — só que ela **corta onde houve
  // separador**, e não em qualquer dígito. A restrição não é frescura: é o preço de uma
  // janela de oito dígitos, que solta acha telefone em data, CEP e protocolo.
  for (const grupo of gruposDeDigitos(texto)) {
    const fronteiras = fronteirasLocais(projecao.digitos, grupo);
    for (const abertura of fronteiras) {
      // Os dois comprimentos são tentados, do maior para o menor: uma janela de nove que
      // não passe pela numeração não pode impedir a de oito que começa no mesmo lugar.
      for (const comprimento of COMPRIMENTOS_LOCAIS) {
        if (!fronteiras.includes(abertura + comprimento)) continue;
        const comeco = grupo.inicio + abertura;
        if (!livre(comeco, comprimento)) continue;
        const digitos = projecao.digitos.slice(comeco, comeco + comprimento);
        if (!eTelefoneLocalBrasileiro(digitos)) continue;
        // Corrida sem corte nenhum no meio: é aqui, e só aqui, que a data compacta
        // (`20260905`) é indistinguível de um fixo — e é aqui que ela é recusada.
        const corrida = !fronteiras.some((f) => f > abertura && f < abertura + comprimento);
        if (corrida && eDataCompacta(digitos)) continue;
        const dentroDaJanela = grupo.pontuacoes
          .filter((p) => p > abertura && p < abertura + comprimento)
          .map((p) => p - abertura);
        if (!pontuacaoEmFormaDeTelefone(dentroDaJanela, comprimento)) continue;
        // As mesmas recusas das outras passadas, pelo texto e só para recusar.
        const inicio = projecao.posicoes[comeco] as number;
        const fim = projecao.fins[comeco + comprimento - 1] as number;
        if (LETRA.test(texto.slice(inicio, fim))) continue;
        if (tocaZona(comeco, comprimento)) continue;
        registrarTelefone(comeco, comprimento);
        break;
      }
    }
  }

  // -------------------------------------------------- 6. ditado por extenso
  // O número que não tem dígito nenhum: `oito quatro nove nove nove oito oito zero zero
  // um um`. Roda por último porque é a única passada que anda pelo TEXTO e não pela
  // projeção — e porque, andando por último, ela vê o que as outras já consumiram e não
  // engole trecho já trocado. Ver o bloco de comentário de `corridasDitadas`.
  for (const corrida of corridasDitadas(texto, indiceDaPosicao, (indices) =>
    indices.some((k) => bloqueado[k]),
  )) {
    const total = corrida.digitos.length;
    let ficha = 0;
    while (ficha < corrida.fichas.length) {
      const abertura = corrida.deslocamentos[ficha] as number;
      let escolhida = -1;
      let janela = '';
      for (let fim = corrida.fichas.length; fim > ficha; fim -= 1) {
        const comprimento = (corrida.deslocamentos[fim] as number) - abertura;
        if (comprimento < 8 || comprimento > 13) continue;
        const digitos = corrida.digitos.slice(abertura, abertura + comprimento);
        // A variante conhecida não passa por trava nenhuma: é o dado do cadastro.
        const conhecida = variantes.includes(digitos);
        const nacional = comprimento >= 10 && eTelefoneBrasileiro(digitos);
        // Local só vale a corrida INTEIRA — a trava 2 do comentário acima.
        const local =
          comprimento <= 9 &&
          abertura === 0 &&
          comprimento === total &&
          eTelefoneLocalBrasileiro(digitos);
        if (!conhecida && !nacional && !local) continue;
        // Uma janela só de dígitos escritos é assunto das passadas 2, 4 e 5.
        if (!corrida.fichas.slice(ficha, fim).some((f) => f.porExtenso)) continue;
        escolhida = fim;
        janela = digitos;
        break;
      }
      if (escolhida < 0) {
        ficha += 1;
        continue;
      }
      const primeira = corrida.fichas[ficha] as FichaDitada;
      const ultima = corrida.fichas[escolhida - 1] as FichaDitada;
      achados.push({
        inicio: recuarSobrePrefixo(texto, primeira.inicio),
        fim: ultima.fim,
        tipo: 'TELEFONE',
        original: texto.slice(recuarSobrePrefixo(texto, primeira.inicio), ultima.fim),
        digitos: janela,
      });
      for (const f of corrida.fichas.slice(ficha, escolhida)) {
        for (const k of f.naProjecao) bloqueado[k] = true;
      }
      ficha = escolhida;
    }
  }

  // Empate no início: fica o mais longo. É o que faz o e-mail engolir o telefone que
  // está dentro dele (`84988887777@gmail.com` é um e-mail, não um telefone e um resto).
  achados.sort((a, b) => a.inicio - b.inicio || b.fim - a.fim);
  const semSobreposicao: Ocorrencia[] = [];
  let ultimoFim = -1;
  for (const achado of achados) {
    if (achado.inicio >= ultimoFim) {
      semSobreposicao.push(achado);
      ultimoFim = achado.fim;
    }
  }
  return semSobreposicao;
}

/**
 * Troca PII por marcadores em um ou mais textos, com um mapa comum.
 *
 * Vários textos de uma vez (a transcrição, a observação, as capturas) porque o mesmo
 * telefone tem de virar o mesmo `[[TELEFONE_1]]` em todos eles — senão o resumo fala de
 * dois números onde só existe um.
 */
export class Pseudonimizador {
  readonly #leadId: string;
  readonly #porMarcador = new Map<string, string>();
  readonly #porValor = new Map<string, string>();
  readonly #contadores = new Map<TipoDePii, number>();
  /**
   * Marcadores criados a partir do cadastro, antes de qualquer texto. Servem para
   * reservar a ordem (o telefone do contato é sempre `[[TELEFONE_1]]`), mas o valor
   * guardado neles é o do banco — e reidratar tem de devolver o texto como ele estava
   * escrito. Na primeira vez que o marcador aparece de verdade num texto, o valor do
   * cadastro é substituído pelo que estava lá, e o marcador sai desta lista.
   */
  readonly #reservados = new Set<string>();
  readonly #conhecidos: Array<{ regex: RegExp; tipo: TipoDePii }> = [];
  /** As formas em dígitos dos telefones do cadastro, da mais longa para a mais curta. */
  readonly #variantesDeTelefone: string[] = [];

  #reservando = false;

  constructor(contexto: ContextoDoContato) {
    this.#leadId = contexto.leadId;
    this.#reservando = true;

    // Registrar é reservar o marcador E ensinar a regex. Reservar sozinho já resolve
    // metade do problema: o rascunho que o modelo escreve usa `[[NOME_1]]` mesmo quando
    // o nome nunca apareceu na entrada, e sem a reserva não haveria o que reidratar.
    const registrarConhecido = (valor: string | null | undefined, tipo: TipoDePii): void => {
      const limpo = (valor ?? '').trim();
      if (limpo.length < 2) return;
      this.#marcadorPara(tipo, limpo);
      this.#conhecidos.push({ regex: this.#regexDoConhecido(limpo, tipo), tipo });
    };

    // O telefone do cadastro é trocado por casamento sobre os DÍGITOS, não por regex de
    // texto: é o único jeito de pegar `+55 84 99988-0011`, `(84) 99988-0011`,
    // `84.99988.0011`, `84 99988 - 0011` e `84 9988-0011` (sem o nono dígito) com a
    // mesma verdade — a do banco. Registrar aqui também reserva a ordem: o telefone do
    // contato é sempre `[[TELEFONE_1]]`.
    for (const telefone of contexto.telefones ?? []) {
      const variantes = variantesDoTelefoneConhecido(telefone);
      if (variantes.length === 0) continue;
      this.#marcadorPara('TELEFONE', telefone);
      this.#variantesDeTelefone.push(...variantes);
    }
    this.#variantesDeTelefone.sort((a, b) => b.length - a.length);

    // Ordem importa: e-mail e @ antes do nome, para o nome não comer o começo do e-mail.
    for (const email of contexto.emails ?? []) registrarConhecido(email, 'EMAIL');
    registrarConhecido(contexto.instagram, 'INSTAGRAM');
    registrarConhecido(contexto.empresa, 'EMPRESA');
    registrarConhecido(contexto.nome, 'NOME');
    // O primeiro nome sozinho é como a pessoa aparece na conversa ("obrigado, Heloísa").
    const primeiroNome = (contexto.nome ?? '').trim().split(/\s+/)[0];
    if (primeiroNome !== undefined && primeiroNome.length >= 3) {
      registrarConhecido(primeiroNome, 'NOME');
    }
    this.#reservando = false;
  }

  #regexDoConhecido(valor: string, tipo: TipoDePii): RegExp {
    if (tipo === 'INSTAGRAM') {
      const arroba = valor.replace(/^@/, '');
      return new RegExp(`@?${escaparRegex(arroba)}`, 'gi');
    }
    // Nome, empresa e e-mail: fronteira de palavra, insensível a caixa. O acento não é
    // normalizado de propósito — trocar "Heloisa" por "Heloísa" mudaria o texto.
    return new RegExp(`\\b${escaparRegex(valor)}\\b`, 'gi');
  }

  #marcadorPara(tipo: TipoDePii, original: string, digitosDitados?: string): string {
    // A chave é o que faz duas grafias do mesmo dado virarem o mesmo marcador.
    // Telefone casa pelos 8 dígitos finais: `(84) 99999-0000`, `+5584999990000` e
    // `84 99999 0000` são o mesmo número — e é também o que faz a forma sem o nono
    // dígito cair no mesmo marcador da forma com ele. Documento casa pelos dígitos,
    // para `12.345.678/0001-95` e `12345678000195` não virarem dois. @ casa pelo usuário.
    const chave =
      tipo === 'TELEFONE'
        ? `TELEFONE:${(digitosDitados ?? digitosDe(original)).slice(-8)}`
        : tipo === 'DOCUMENTO'
          ? `DOCUMENTO:${original.replace(/[^0-9a-z]/gi, '').toLowerCase()}`
          : tipo === 'INSTAGRAM'
            ? `INSTAGRAM:${chaveDeComparacao(usuarioDoInstagram(original))}`
            : `${tipo}:${chaveDeComparacao(original)}`;
    const existente = this.#porValor.get(chave);
    if (existente !== undefined) {
      if (this.#reservados.delete(existente)) this.#porMarcador.set(existente, original);
      return existente;
    }
    const proximo = (this.#contadores.get(tipo) ?? 0) + 1;
    this.#contadores.set(tipo, proximo);
    const marcador = `[[${tipo}_${proximo}]]`;
    this.#porValor.set(chave, marcador);
    this.#porMarcador.set(marcador, original);
    if (this.#reservando) this.#reservados.add(marcador);
    return marcador;
  }

  /** Troca PII por marcadores. Chame quantas vezes precisar: o mapa é o mesmo. */
  proteger(texto: string): string {
    let saida = texto;
    for (const { regex, tipo } of this.#conhecidos) {
      saida = saida.replace(new RegExp(regex.source, regex.flags), (achado) =>
        achado.trim().length === 0 ? achado : this.#marcadorPara(tipo, achado),
      );
    }
    const achados = varrer(saida, this.#variantesDeTelefone);
    if (achados.length === 0) return saida;
    let resultado = '';
    let cursor = 0;
    for (const achado of achados) {
      resultado += saida.slice(cursor, achado.inicio);
      resultado += this.#marcadorPara(achado.tipo, achado.original, achado.digitos);
      cursor = achado.fim;
    }
    return resultado + saida.slice(cursor);
  }

  get mapa(): MapaDePseudonimos {
    return { leadId: this.#leadId, porMarcador: new Map(this.#porMarcador) };
  }
}

/** Atalho para um texto só. */
export function pseudonimizar(
  texto: string,
  contexto: ContextoDoContato,
): ResultadoDaPseudonimizacao {
  const pseudonimizador = new Pseudonimizador(contexto);
  return { texto: pseudonimizador.proteger(texto), mapa: pseudonimizador.mapa };
}

/** Devolve os valores reais ao texto que veio do modelo, antes de uma pessoa o ler. */
export function reidratar(texto: string, mapa: MapaDePseudonimos): string {
  let saida = texto;
  for (const [marcador, original] of mapa.porMarcador) {
    saida = saida.split(marcador).join(original);
  }
  return saida;
}
