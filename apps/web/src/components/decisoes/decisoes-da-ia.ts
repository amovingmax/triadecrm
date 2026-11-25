/**
 * O aviso de decisão (25/11/2026), só na Imova e só para admin.
 *
 * Pedido do dono: "ao invés de passar a conversa para o corretor, a IA poderia somente
 * perguntar para os admins e os admins escolheriam a opção que a IA deve responder." Na
 * proposta de valor e na pergunta que só a Imova responde, a IA diz ao cliente que vai
 * verificar ("Vou repassar sua proposta ao diretor e te retorno"), NÃO passa a conversa e
 * pede a decisão. O cartão (`vigia-de-decisoes.tsx`) mostra o que o cliente escreveu e os
 * botões do protótipo aprovado:
 * - Proposta: Aceitar (a resposta leva o link da reunião online), Recusar, Negociar outro
 *   valor e Vou consultar o proprietário (o cliente é avisado, e o cartão continua aberto).
 * - Pergunta: as respostas que a IA sugeriu e Escrever outra resposta (a IA só ajusta o tom).
 *
 * O banco é quem decide quem vê e quem pode, e é quem escreve a mensagem
 * (`public.ia_decisao_decidir`, migração 20261125200000). Os textos daqui são a prévia:
 * escritos igual aos do banco (`app.ia_decisao_texto`).
 */
import { createClient } from '@/lib/supabase/client';

export type TipoDeDecisao = 'proposta' | 'pergunta';
export type SituacaoDaDecisao = 'aberta' | 'consultando';
export type Escolha = 'aceitar' | 'recusar' | 'contraproposta' | 'consultar' | 'sugestao' | 'escrita';

export interface Sugestao {
  readonly rotulo: string;
  readonly resposta: string;
}

export interface DecisaoDaIa {
  readonly id: string;
  readonly conversaId: string;
  readonly cliente: string;
  /** "Paula", quando o nome parece de gente: é como a mensagem chama o cliente. */
  readonly primeiroNome: string | null;
  /** Para onde vai "Ver conversa". */
  readonly caminho: string;
  readonly tipo: TipoDeDecisao;
  readonly situacao: SituacaoDaDecisao;
  /** As palavras do cliente. */
  readonly pergunta: string;
  /** O que a IA já respondeu ("Vou verificar e te retorno."). */
  readonly respostaDaIa: string | null;
  readonly sugestoes: readonly Sugestao[];
  readonly codigo: string | null;
  /** Como o cliente reconhece: "o terreno em Capim Macio". */
  readonly imovel: string | null;
  /** O título: "Terreno em Capim Macio". */
  readonly titulo: string | null;
  readonly area: number | null;
  readonly valorAnunciado: number | null;
  readonly valorProposto: number | null;
  readonly consultandoPor: string | null;
  readonly consultandoEm: string | null;
  readonly criadoEm: string;
}

export const CHAVE_DAS_DECISOES = ['ia-decisoes'] as const;

const texto = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

const inteiro = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.round(v)
    : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)
      ? Math.round(Number(v))
      : null;

function lerSugestoes(v: unknown): Sugestao[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      const rotulo = texto(o.rotulo);
      const resposta = texto(o.resposta);
      return rotulo === null || resposta === null ? null : { rotulo, resposta };
    })
    .filter((s): s is Sugestao => s !== null)
    .slice(0, 3);
}

/** Uma decisão como o banco devolve; null quando falta o que o cartão precisa. */
export function lerDecisao(valor: unknown): DecisaoDaIa | null {
  if (valor === null || typeof valor !== 'object') return null;
  const v = valor as Record<string, unknown>;
  const id = texto(v.id);
  const conversaId = texto(v.conversa_id);
  const criadoEm = texto(v.criado_em);
  const pergunta = texto(v.pergunta);
  if (id === null || conversaId === null || criadoEm === null || pergunta === null) return null;
  const valorProposto = inteiro(v.valor_proposto);
  // Proposta sem valor não tem o que aceitar: o cartão a mostra como pergunta.
  const tipo: TipoDeDecisao = v.tipo === 'proposta' && valorProposto !== null ? 'proposta' : 'pergunta';
  return {
    id,
    conversaId,
    cliente: texto(v.cliente) ?? 'Um cliente',
    primeiroNome: texto(v.primeiro_nome),
    caminho: texto(v.caminho) ?? '/conversas',
    tipo,
    situacao: v.situacao === 'consultando' ? 'consultando' : 'aberta',
    pergunta,
    respostaDaIa: texto(v.resposta_da_ia),
    sugestoes: tipo === 'pergunta' ? lerSugestoes(v.sugestoes) : [],
    codigo: texto(v.imovel_codigo),
    imovel: texto(v.imovel),
    titulo: texto(v.titulo),
    area: inteiro(v.area),
    valorAnunciado: inteiro(v.valor_anunciado),
    valorProposto,
    consultandoPor: texto(v.consultando_por),
    consultandoEm: texto(v.consultando_em),
    criadoEm,
  };
}

/** As decisões abertas, da mais antiga à mais nova. Quem não é admin recebe lista vazia. */
export async function lerDecisoesAbertas(): Promise<DecisaoDaIa[]> {
  const { data, error } = await createClient().rpc('ia_decisoes_abertas');
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : [])
    .map(lerDecisao)
    .filter((d): d is DecisaoDaIa => d !== null);
}

// ------------------------------------------------------------------ os valores

/** R$ 4.000.000 (como o banco escreve). */
export function reais(valor: number): string {
  return `R$ ${Math.round(valor)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** O valor curto do botão: "R$ 4 milhões", "R$ 4,3 milhões", "R$ 450 mil"; senão, inteiro. */
export function valorCurto(valor: number): string {
  if (valor >= 1_000_000 && valor % 100_000 === 0) {
    const milhoes = valor / 1_000_000;
    return `R$ ${String(milhoes).replace('.', ',')} ${milhoes === 1 ? 'milhão' : 'milhões'}`;
  }
  if (valor < 1_000_000 && valor >= 1_000 && valor % 1_000 === 0) return `R$ ${valor / 1_000} mil`;
  return reais(valor);
}

/** "11% abaixo do anunciado" (ou acima); null sem os dois valores. */
export function diferencaDoAnunciado(d: DecisaoDaIa): string | null {
  if (d.valorProposto === null || d.valorAnunciado === null) return null;
  const pct = Math.round((1 - d.valorProposto / d.valorAnunciado) * 100);
  if (pct === 0) return 'igual ao anunciado';
  return pct > 0 ? `${pct}% abaixo do anunciado` : `${-pct}% acima do anunciado`;
}

/** O valor que o admin digitou ("4.300.000", "4300000"), ou null. */
export function lerValorDigitado(digitado: string): number | null {
  const digitos = digitado.replace(/,\d{1,2}$/, '').replace(/\D/g, '');
  if (digitos === '' || digitos.length > 12) return null;
  const n = Number(digitos);
  return n > 0 ? n : null;
}

// ------------------------------------------------------------------ as prévias

function pelo(imovel: string | null): string {
  if (imovel?.startsWith('o ')) return `pelo ${imovel.slice(2)}`;
  if (imovel?.startsWith('a ')) return `pela ${imovel.slice(2)}`;
  return 'pelo imóvel';
}

function sujeito(imovel: string | null): string {
  return imovel !== null && /^(o|a) /.test(imovel)
    ? imovel.charAt(0).toUpperCase() + imovel.slice(1)
    : 'O imóvel';
}

/**
 * O que o cliente vai receber em cada botão da proposta. Escrito igual a
 * `app.ia_decisao_texto` (o banco é quem manda; isto é a prévia). No aceitar, o link da
 * reunião vai embaixo.
 */
export function textoDaProposta(
  qual: 'aceitar' | 'recusar' | 'contraproposta' | 'consultar',
  d: DecisaoDaIa,
  valor: number | null = null,
): string {
  const nome = d.primeiroNome;
  const prop = d.valorProposto === null ? 'o valor proposto' : reais(d.valorProposto);
  switch (qual) {
    case 'consultar':
      return `${nome === null ? 'Sua' : `${nome}, sua`} proposta de ${prop} já está com o proprietário. Assim que ele responder, te aviso por aqui.`;
    case 'aceitar':
      return `Boa notícia${nome === null ? '' : `, ${nome}`}: o proprietário aceitou sua proposta de ${prop} ${pelo(d.imovel)}. Para seguirmos, é só escolher o melhor dia e horário para conversarmos pelo link abaixo.`;
    case 'recusar':
      return `${nome === null ? 'O' : `${nome}, o`} proprietário não aceitou a proposta de ${prop}.${
        d.valorAnunciado === null ? '' : ` ${sujeito(d.imovel)} segue por ${reais(d.valorAnunciado)}.`
      } Se quiser fazer outra proposta, é só me dizer.`;
    case 'contraproposta':
      return `${nome === null ? 'O' : `${nome}, o`} proprietário não chegou aos ${prop}, mas aceita ${
        valor === null ? 'outro valor' : reais(valor)
      } ${pelo(d.imovel)}. Se fizer sentido para você, é só me dizer.`;
  }
}

// ------------------------------------------------------------------ a decisão

export interface ResultadoDaDecisao {
  readonly ok: boolean;
  readonly motivo: string | null;
  readonly mensagemSaiu: boolean;
  /** "ia" (a IA continua na conversa) ou "admin" (alguém tinha assumido a conversa). */
  readonly como: string | null;
  /** "Escrever outra resposta": a IA escreve a mensagem em seguida. */
  readonly iaEscreve: boolean;
  /** Quem decidiu antes (no `ja_decidido`). */
  readonly por: string | null;
}

export function lerResultado(valor: unknown): ResultadoDaDecisao {
  const v = (valor ?? {}) as Record<string, unknown>;
  return {
    ok: v.ok === true,
    motivo: texto(v.motivo),
    mensagemSaiu: v.mensagem_saiu === true,
    como: texto(v.como),
    iaEscreve: v.ia_escreve === true,
    por: texto(v.por),
  };
}

export async function decidir(
  id: string,
  escolha: Escolha,
  extras: { valor?: number | null; texto?: string | null; sugestao?: number | null } = {},
): Promise<ResultadoDaDecisao> {
  const { data, error } = await createClient().rpc('ia_decisao_decidir', {
    p_id: id,
    p_escolha: escolha,
    ...(extras.valor == null ? {} : { p_valor: extras.valor }),
    ...(extras.texto == null || extras.texto.trim() === '' ? {} : { p_texto: extras.texto.trim() }),
    ...(extras.sugestao == null ? {} : { p_sugestao: extras.sugestao }),
  });
  if (error) throw new Error(error.message);
  return lerResultado(data);
}

export interface Aviso {
  readonly titulo: string;
  readonly descricao: string | null;
  readonly tom: 'sucesso' | 'aviso' | 'erro';
}

const NAO_SAIU =
  'A decisão ficou registrada, mas a mensagem não saiu (a janela de 24 h pode ter fechado). Fale com o cliente pela conversa.';

/** O aviso depois da decisão, em palavras de quem usa. */
export function avisoDoResultado(escolha: Escolha, r: ResultadoDaDecisao): Aviso {
  if (!r.ok) {
    switch (r.motivo) {
      case 'ja_decidido':
        return {
          titulo: 'Outro admin já respondeu',
          descricao: r.por === null ? null : `Quem respondeu: ${r.por}.`,
          tom: 'aviso',
        };
      case 'nao_existe':
        return { titulo: 'Este aviso não existe mais', descricao: null, tom: 'aviso' };
      case 'sem_permissao':
        return { titulo: 'Só admin responde a IA', descricao: null, tom: 'erro' };
      case 'valor_invalido':
        return { titulo: 'Digite o valor que vocês aceitam', descricao: null, tom: 'erro' };
      case 'texto_vazio':
        return { titulo: 'Escreva o que a IA deve dizer', descricao: null, tom: 'erro' };
      default:
        return { titulo: 'Não deu para responder', descricao: 'Tente de novo.', tom: 'erro' };
    }
  }
  if (r.iaEscreve) {
    return {
      titulo: 'A IA vai responder o cliente',
      descricao: 'Ela escreve a sua resposta com o tom certo, sem acrescentar nada.',
      tom: 'sucesso',
    };
  }
  if (!r.mensagemSaiu) return { titulo: 'Decisão registrada', descricao: NAO_SAIU, tom: 'aviso' };
  const quem = r.como === 'admin' ? 'A mensagem saiu em seu nome' : 'A IA respondeu o cliente';
  if (escolha === 'consultar') {
    return {
      titulo: 'O cliente sabe que a proposta está com o proprietário',
      descricao: 'O aviso continua aberto até vocês responderem.',
      tom: 'sucesso',
    };
  }
  return { titulo: quem, descricao: 'A conversa continua com a IA.', tom: 'sucesso' };
}

/** As decisões que esta pessoa ainda não viu (para tocar só no que é novo). */
export function decisoesNaoVistas(
  decisoes: readonly DecisaoDaIa[],
  vistas: ReadonlySet<string>,
): DecisaoDaIa[] {
  return decisoes.filter((d) => !vistas.has(d.id));
}

/** A linha da notificação do sistema. */
export function linhaDaDecisao(d: DecisaoDaIa): string {
  return d.tipo === 'proposta' && d.valorProposto !== null
    ? `${d.cliente} oferece ${reais(d.valorProposto)}${d.imovel === null ? '' : ` ${pelo(d.imovel)}`}`
    : `${d.cliente} perguntou: “${d.pergunta}”`;
}
