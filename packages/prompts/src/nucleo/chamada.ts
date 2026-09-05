import { z } from 'zod';

import { PiiNaChamadaError, type ProblemaDePii, varrerMontagem, verificarSemPii } from './auditoria-pii';
import { type ContextoDoContato, type MapaDePseudonimos, Pseudonimizador } from './pseudonimizacao';
import {
  type ModeloAlvo,
  type PromptVersionado,
  type PropositoDeAiRun,
  versaoDoPrompt,
} from './versionamento';

/**
 * O único caminho sancionado entre um prompt e a API.
 *
 * `prepararChamada` faz cinco coisas, nesta ordem, e nenhuma é opcional: valida a entrada
 * contra o schema, pseudonimiza os campos declarados, **separa o que é nosso do que veio
 * de fora**, monta a mensagem e confere. Se sobrou telefone, e-mail ou @, a chamada não
 * sai. A conferência é outra implementação, em `auditoria-pii.ts`: ela não importa nada
 * da pseudonimização, aceita um critério de telefone estritamente mais frouxo e não
 * conhece nenhuma das exceções em que a regra se apoia. Uma é a regra; a outra é a
 * auditoria da regra, e as duas podem errar separado — que é a única forma de a segunda
 * servir para alguma coisa.
 *
 * ## O que é "de fora", e por que a separação é explícita (4ª versão, 2026-09-05)
 *
 * Até a 3ª versão a auditoria recebia `${sistema}\n${mensagem}` — a mensagem inteira,
 * prompt de sistema junto. Como os quatro prompts de sistema deste pacote já contêm, cada
 * um, janela de dez dígitos começando por DDD válido, a auditoria precisava de uma
 * fronteira de letra para não recusar 100% das chamadas. E a fronteira de letra era um
 * furo: `ddd 84 numero 988776655` passava inteiro.
 *
 * O prompt de sistema foi escrito por nós, está versionado no repositório e não tem PII.
 * Ele não precisa de auditoria. O que precisa é o texto de **origem não confiável** — a
 * transcrição do áudio, a anotação de quem ligou, a mensagem que o lead mandou, o nome
 * que alguém digitou. Só isso vai para `verificarSemPii`, já pseudonimizado, e lá a
 * janela corre sem fronteira nenhuma.
 *
 * ## As duas travas da 5ª versão (2026-09-05)
 *
 * A 4ª versão trancava a dimensão **campo** ("campo novo cai na auditoria sozinho") e
 * deixava duas frestas abertas, as duas na fronteira entre campos:
 *
 * 1. **Tipo esquecido em silêncio.** `trechosDeFora` sabia abrir string, número, lista e
 *    objeto simples. Para `Map`, `Set`, `Date` ou instância de classe, `Object.entries`
 *    devolvia `[]` e o campo **desaparecia da auditoria sem erro nenhum** — um
 *    `pistas: z.map(z.string(), z.string())` acrescentado amanhã levaria o telefone
 *    inteiro. A lista do que ela sabia abrir era o limite, e era um limite mudo.
 *    Agora `abrir` **exige** que todo valor seja abrível: o que ela não souber percorrer
 *    levanta `TipoNaoAuditavelError` com o caminho do campo. Falhar barulhento é o
 *    comportamento certo — a chamada não sair custa uma chamada; sair com telefone custa
 *    o guardrail. `Map`, `Set` e `Date` entraram na lista, mas o conserto não é a lista:
 *    é a lista ter deixado de ser o limite silencioso.
 * 2. **Telefone repartido entre dois campos.** `84 99988` no resumo da conversa e `0011`
 *    na mensagem: campo a campo, nenhum dos dois tem telefone. Agora a auditoria roda
 *    **também sobre a junção** — os trechos de fora concatenados, sem fronteira nenhuma
 *    entre eles. O que impedia isso na 4ª versão era o falso positivo: juntar `leadId`
 *    com `duracaoSeg` e as capturas soma dez dígitos sozinho, e barrava 1 dos 10
 *    exemplos reais dos próprios prompts. A junção agora corre **só sobre o texto que
 *    veio de uma pessoa de fora**; o metadado que o próprio Tríade escreveu (`leadId`,
 *    `canal`, `duracaoSeg`, `confiancaAsr`, flags) fica fora dela, declarado em
 *    `camposDoTriade`. Com a separação, os 10 exemplos passam e a junção pega o número
 *    repartido.
 *
 * **As duas classificações falham fechado.** Campo que ninguém declarou em
 * `camposDoTriade` é tratado como de fora — nunca como nosso. Tipo que ninguém ensinou a
 * abrir levanta erro — nunca é ignorado. Nas duas dimensões, o silêncio é sempre a favor
 * do guardrail.
 *
 * O que ele NÃO faz: chamar a rede. O objeto devolvido é tudo o que o worker precisa para
 * montar o `messages.create`, e é o que torna os evals possíveis sem credencial.
 */

export interface ChamadaPreparada<Saida> {
  readonly modelo: ModeloAlvo;
  readonly proposito: PropositoDeAiRun;
  /** O valor de `ai_runs.prompt_version`. */
  readonly promptVersion: string;
  /** Bloco estável — é nele que vai o `cache_control`. */
  readonly sistema: string;
  /** Bloco volátil, já pseudonimizado. */
  readonly mensagem: string;
  readonly maxTokens: number;
  /** O mapa para reidratar a saída antes de uma pessoa ler. */
  readonly mapa: MapaDePseudonimos;
  /** Valida o JSON devolvido pelo modelo contra o schema de saída daquela versão. */
  readonly interpretar: (respostaDoModelo: unknown) => Saida;
}

/** Um pedaço de texto de origem não confiável, com o caminho de onde ele veio. */
export interface TrechoDeFora {
  /** `transcricaoBruta`, `caminho[2].texto`, `capturas.orcamento`. */
  readonly campo: string;
  readonly texto: string;
}

/**
 * O tipo que a auditoria não sabe abrir — e por isso não deixa passar.
 *
 * Não é erro de programação de quem chamou: é a auditoria dizendo que não tem como
 * afirmar que aquele valor não carrega telefone. Enquanto isso não for resolvido, a
 * chamada não sai.
 */
export class TipoNaoAuditavelError extends Error {
  readonly campo: string;
  readonly tipo: string;
  constructor(campo: string, tipo: string) {
    super(
      `A auditoria de PII não sabe auditar o valor em "${campo === '' ? '(raiz)' : campo}": ` +
        `${tipo}. Apareceu um tipo que a auditoria não sabe abrir, e um tipo que ela não sabe ` +
        'abrir é um campo sobre o qual ela não pode afirmar nada — pode haver telefone lá ' +
        'dentro. Isto precisa ser resolvido ANTES de a chamada sair: converta o valor para ' +
        'texto, número, lista, objeto simples, Map, Set ou Date antes de montar a entrada, ou ' +
        'ensine `abrir` (packages/prompts/src/nucleo/chamada.ts) a percorrer este tipo — e, ' +
        'no mesmo commit, acrescente o caso ao eval "nenhum TIPO de entrada escapa da ' +
        'auditoria". Ignorar em silêncio é o único desfecho proibido.',
    );
    this.name = 'TipoNaoAuditavelError';
    this.campo = campo;
    this.tipo = tipo;
  }
}

/**
 * A forma de um valor da entrada, para quem precisa percorrê-lo.
 *
 * `texto`, `numero` e `data` carregam dígito e são auditados. `sem-digito` (booleano,
 * nulo, ausente) não tem como carregar nenhum. O resto é contentor, e vem aberto.
 */
type Forma =
  | { readonly especie: 'texto'; readonly texto: string }
  | { readonly especie: 'numero'; readonly texto: string }
  | { readonly especie: 'data'; readonly texto: string }
  | { readonly especie: 'sem-digito' }
  | { readonly especie: 'lista'; readonly itens: readonly unknown[] }
  | { readonly especie: 'conjunto'; readonly itens: readonly unknown[] }
  | { readonly especie: 'mapa'; readonly pares: readonly (readonly [unknown, unknown])[] }
  | { readonly especie: 'registro'; readonly campos: readonly (readonly [string, unknown])[] };

function descrever(valor: unknown): string {
  if (typeof valor === 'symbol') return `símbolo (${String(valor)})`;
  if (typeof valor === 'function') return 'função';
  if (typeof valor !== 'object' || valor === null) return `valor do tipo ${typeof valor}`;
  const prototipo = Object.getPrototypeOf(valor) as { constructor?: { name?: string } } | null;
  const nome = prototipo?.constructor?.name;
  return nome === undefined || nome === '' ? 'objeto de origem desconhecida' : `instância de ${nome}`;
}

/**
 * Os campos próprios de um objeto simples — **todos**, e não só os enumeráveis por
 * `Object.entries`.
 *
 * Chave de símbolo e propriedade de acesso (getter) param a auditoria: a primeira é
 * invisível para `Object.entries` e a segunda pode devolver qualquer coisa a cada
 * leitura. Nos dois casos, o certo é falhar barulhento.
 */
function camposDe(valor: object, caminho: string): readonly (readonly [string, unknown])[] {
  const campos: Array<readonly [string, unknown]> = [];
  for (const chave of Reflect.ownKeys(valor)) {
    if (typeof chave === 'symbol') {
      throw new TipoNaoAuditavelError(caminho, `chave de símbolo (${String(chave)})`);
    }
    const descritor = Object.getOwnPropertyDescriptor(valor, chave) as PropertyDescriptor;
    if (!('value' in descritor)) {
      throw new TipoNaoAuditavelError(
        caminho === '' ? chave : `${caminho}.${chave}`,
        'propriedade de acesso (getter/setter)',
      );
    }
    campos.push([chave, descritor.value] as const);
  }
  return campos;
}

/**
 * **Tudo tem de ser abrível.** O que não for, para a chamada.
 *
 * Esta função é a única que decide o que a travessia sabe percorrer, e ela não tem ramo
 * de escape: o caminho de saída para um valor que ela não reconhece é `throw`, nunca
 * `return []`. É a diferença entre a 4ª e a 5ª versão — antes, um `Map` sumia da
 * auditoria sem uma linha de log.
 *
 * "Objeto simples" é objeto com protótipo `Object.prototype` ou nulo. Instância de classe
 * fica de fora de propósito: ela pode ter estado em protótipo, em campo não enumerável ou
 * atrás de getter, e a auditoria não tem como garantir que viu tudo.
 */
function abrir(valor: unknown, caminho: string): Forma {
  if (typeof valor === 'string') return { especie: 'texto', texto: valor };
  if (typeof valor === 'number' || typeof valor === 'bigint') {
    return { especie: 'numero', texto: String(valor) };
  }
  if (typeof valor === 'boolean' || valor === null || valor === undefined) {
    return { especie: 'sem-digito' };
  }
  if (Array.isArray(valor)) return { especie: 'lista', itens: valor as readonly unknown[] };
  if (valor instanceof Set) return { especie: 'conjunto', itens: [...valor] };
  if (valor instanceof Map) return { especie: 'mapa', pares: [...valor.entries()] };
  if (valor instanceof Date) {
    // Data inválida não tem ISO; `String(...)` devolve "Invalid Date", que também é
    // auditável. O que não pode acontecer é a data sumir da varredura.
    const texto = Number.isNaN(valor.getTime()) ? String(valor) : valor.toISOString();
    return { especie: 'data', texto };
  }
  if (typeof valor === 'object') {
    const prototipo = Object.getPrototypeOf(valor) as object | null;
    if (prototipo === Object.prototype || prototipo === null) {
      return { especie: 'registro', campos: camposDe(valor, caminho) };
    }
  }
  throw new TipoNaoAuditavelError(caminho, descrever(valor));
}

function protegerProfundo(
  valor: unknown,
  pseudonimizador: Pseudonimizador,
  caminho: string,
): unknown {
  const forma = abrir(valor, caminho);
  switch (forma.especie) {
    case 'texto':
      return pseudonimizador.proteger(forma.texto);
    case 'numero':
    case 'data':
    case 'sem-digito':
      return valor;
    case 'lista':
      return forma.itens.map((item, indice) =>
        protegerProfundo(item, pseudonimizador, `${caminho}[${indice}]`),
      );
    case 'conjunto':
      return new Set(
        forma.itens.map((item, indice) =>
          protegerProfundo(item, pseudonimizador, `${caminho}[conjunto ${indice}]`),
        ),
      );
    case 'mapa':
      return new Map(
        forma.pares.map(([chave, item], indice) => [
          protegerProfundo(chave, pseudonimizador, `${caminho}[chave ${indice}]`),
          protegerProfundo(item, pseudonimizador, `${caminho}[valor ${indice}]`),
        ]),
      );
    case 'registro': {
      // O protótipo é preservado: um objeto de protótipo nulo continua de protótipo nulo,
      // e a travessia seguinte volta a enxergá-lo do mesmo jeito.
      const alvo = Object.create(Object.getPrototypeOf(valor) as object | null) as Record<
        string,
        unknown
      >;
      for (const [chave, item] of forma.campos) {
        alvo[chave] = protegerProfundo(
          item,
          pseudonimizador,
          caminho === '' ? chave : `${caminho}.${chave}`,
        );
      }
      return alvo;
    }
  }
}

/**
 * Todo escalar que a entrada validada contém, em qualquer profundidade, com o caminho.
 *
 * É a lista do que a auditoria enxerga, e ela é obtida **por varredura, nunca por
 * declaração**: não há como um campo novo ficar de fora por esquecimento, e — desde a 5ª
 * versão — não há como um **tipo** novo ficar de fora por omissão. Número entra junto com
 * texto (um `z.number()` sem teto carrega onze dígitos tão bem quanto uma string), e o
 * **nome** de cada campo entra também: `montarMensagem` imprime as chaves de um
 * `z.record()` na mensagem, e uma chave é texto como outro qualquer. Booleano e nulo
 * ficam de fora porque não têm como carregar dígito nenhum.
 *
 * Levanta `TipoNaoAuditavelError` diante de qualquer valor que não saiba abrir.
 */
export function trechosDeFora(entrada: unknown, prefixo = ''): TrechoDeFora[] {
  const forma = abrir(entrada, prefixo);
  switch (forma.especie) {
    case 'texto':
    case 'numero':
    case 'data':
      return [{ campo: prefixo, texto: forma.texto }];
    case 'sem-digito':
      return [];
    case 'lista':
      return forma.itens.flatMap((item, indice) => trechosDeFora(item, `${prefixo}[${indice}]`));
    case 'conjunto':
      return forma.itens.flatMap((item, indice) =>
        trechosDeFora(item, `${prefixo}[conjunto ${indice}]`),
      );
    case 'mapa':
      return forma.pares.flatMap(([chave, item], indice) => [
        ...trechosDeFora(chave, `${prefixo}[chave ${indice}]`),
        ...trechosDeFora(item, `${prefixo}[valor ${indice}]`),
      ]);
    case 'registro':
      return forma.campos.flatMap(([chave, item]) => {
        const caminho = prefixo === '' ? chave : `${prefixo}.${chave}`;
        return [
          { campo: `${caminho}[nome do campo]`, texto: chave },
          ...trechosDeFora(item, caminho),
        ];
      });
  }
}

/** `caminho[2].texto` → `caminho`; `capturas.orcamento` → `capturas`. */
export function raizDoCampo(campo: string): string {
  const corte = campo.search(/[.[]/);
  return corte === -1 ? campo : campo.slice(0, corte);
}

const NAO_ENCONTRADO = Number.MAX_SAFE_INTEGER;

/**
 * Os trechos na ordem em que o modelo vai lê-los.
 *
 * A junção reconstrói um telefone repartido entre campos, e para isso a ordem importa:
 * `84 99988` + `0011` é um telefone, `0011` + `84 99988` não é. A ordem certa é a da
 * mensagem montada — é ela que o modelo lê —, e não a ordem das chaves do schema, que em
 * `classificar-intencao` já é outra (`mensagem` vem antes de `resumoDaConversa` no
 * schema, e depois dele na mensagem). Trecho que não apareça literalmente na mensagem vai
 * para o fim, na ordem em que foi declarado.
 */
function naOrdemDaMensagem(trechos: readonly TrechoDeFora[], mensagem: string): TrechoDeFora[] {
  return trechos
    .map((trecho, indice) => {
      const posicao = trecho.texto === '' ? -1 : mensagem.indexOf(trecho.texto);
      return { trecho, indice, posicao: posicao === -1 ? NAO_ENCONTRADO : posicao };
    })
    .sort((a, b) => a.posicao - b.posicao || a.indice - b.indice)
    .map(({ trecho }) => trecho);
}

export function prepararChamada<Entrada, Saida>(
  prompt: PromptVersionado<Entrada, Saida>,
  entradaBruta: unknown,
  contexto: ContextoDoContato,
): ChamadaPreparada<Saida> {
  const validada = prompt.entrada.parse(entradaBruta);
  const pseudonimizador = new Pseudonimizador(contexto);

  // As duas asserções abaixo são a fronteira entre o genérico do prompt e a travessia
  // campo a campo. O schema já validou a forma; aqui só se troca texto por texto.
  const comoRegistro = validada as unknown as Record<string, unknown>;
  const protegido: Record<string, unknown> = { ...comoRegistro };
  for (const campo of prompt.camposDeTexto) {
    if (!(campo in protegido)) {
      throw new Error(`${prompt.id}@v${prompt.versao}: campo de texto inexistente: ${campo}.`);
    }
    protegido[campo] = protegerProfundo(protegido[campo], pseudonimizador, campo);
  }
  for (const campo of prompt.camposDoTriade) {
    if (!(campo in protegido)) {
      throw new Error(`${prompt.id}@v${prompt.versao}: campo do Tríade inexistente: ${campo}.`);
    }
  }
  const segura = protegido as unknown as Entrada;
  const mensagem = prompt.montarMensagem(segura);

  // A auditoria, sobre o que veio de fora e só sobre isso — sem fronteira nenhuma.
  const trechos = trechosDeFora(protegido);
  const problemas: ProblemaDePii[] = trechos.flatMap(({ campo, texto }) =>
    verificarSemPii(texto).map((problema) => ({ ...problema, campo })),
  );

  // A junção: os trechos de **origem externa** colados um no outro, sem fronteira entre
  // eles, para o telefone repartido entre dois campos virar uma corrida que a janela pega.
  // O metadado que o próprio Tríade escreveu fica fora — é ele que somava dez dígitos
  // sozinho e barrava exemplo legítimo. Campo não declarado em `camposDoTriade` é de
  // fora: a classificação falha fechado.
  const nossos = new Set(prompt.camposDoTriade);
  const externos = trechos.filter(({ campo }) => !nossos.has(raizDoCampo(campo)));
  const juncoes = new Set([
    naOrdemDaMensagem(externos, mensagem)
      .map(({ texto }) => texto)
      .join(''),
    externos.map(({ texto }) => texto).join(''),
  ]);
  for (const juncao of juncoes) {
    problemas.push(
      ...verificarSemPii(juncao).map((problema) => ({
        ...problema,
        campo: 'junção do texto de fora',
      })),
    );
  }

  // A rede de segurança, sobre a montagem inteira: pega o que `montarMensagem` trouxer
  // de fora da entrada validada, que por definição não está em campo nenhum.
  problemas.push(
    ...varrerMontagem(`${prompt.sistema}\n${mensagem}`).map((problema) => ({
      ...problema,
      campo: 'montagem',
    })),
  );
  if (problemas.length > 0) throw new PiiNaChamadaError(problemas);

  return {
    modelo: prompt.modelo,
    proposito: prompt.proposito,
    promptVersion: versaoDoPrompt(prompt),
    sistema: prompt.sistema,
    mensagem,
    maxTokens: prompt.maxTokens,
    mapa: pseudonimizador.mapa,
    interpretar: (respostaDoModelo: unknown): Saida => prompt.saida.parse(respostaDoModelo),
  };
}

/**
 * O JSON Schema da saída, para `output_config.format` (saída estruturada do ADR-10).
 *
 * Sai do próprio schema zod da versão: um só lugar define o formato, e não há como o
 * schema que valida divergir do schema que o modelo recebeu.
 */
export function esquemaDeSaida(prompt: { readonly saida: z.ZodType }): Record<string, unknown> {
  return z.toJSONSchema(prompt.saida) as Record<string, unknown>;
}
