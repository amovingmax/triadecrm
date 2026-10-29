import * as z from 'zod';
import type { Json } from '@komune/schema';

import type { MensagemDoFio } from './tipos';

/**
 * O que não é texto nem arquivo, lido de `messages.conteudo` (27/10/2026).
 *
 * ===========================================================================
 * UMA FORMA SÓ, NOS DOIS SENTIDOS
 * ===========================================================================
 * A migração `20261027110000_whatsapp_completo` guarda num `jsonb` tudo o que
 * o WhatsApp tem além do corpo: a localização, o cartão de contato, os botões e
 * a lista que uma pessoa monta, a opção que o contato escolheu, o anúncio de
 * onde ele veio, o erro da Meta e o aviso do que a Meta não entrega. O webhook
 * (entrada) e a tela (saída) escrevem a MESMA forma, então quem lê é um só.
 *
 * As chaves convivem: a entrada é gravada com `conteudo || extra`, e uma
 * mensagem pode trazer o anúncio E a localização. Por isso o resultado é um
 * objeto com cada parte possivelmente vazia, e não uma união.
 *
 * Nada aqui confia no banco: o `jsonb` não tem esquema, e uma chave com o tipo
 * errado vira "não veio", nunca uma tela quebrada.
 */

export type Localizacao = {
  latitude: number;
  longitude: number;
  nome: string | null;
  endereco: string | null;
};

export type TelefoneDoCartao = { numero: string; tipo: string | null; waId: string | null };

export type CartaoDeContato = {
  nome: string;
  telefones: TelefoneDoCartao[];
  emails: string[];
  empresa: string | null;
};

export type Interativo =
  | { tipo: 'botoes'; botoes: string[] }
  | { tipo: 'lista'; botao: string; itens: { titulo: string; descricao: string | null }[] }
  | { tipo: 'pedir_localizacao' };

export type RespostaEscolhida = { titulo: string; descricao: string | null };

export type Anuncio = { titulo: string | null; corpo: string | null; url: string | null };

export type ErroDaMeta = { codigo: string | null; titulo: string | null; detalhe: string | null };

export type ConteudoLido = {
  localizacao: Localizacao | null;
  contatos: CartaoDeContato[];
  interativo: Interativo | null;
  resposta: RespostaEscolhida | null;
  anuncio: Anuncio | null;
  erro: ErroDaMeta | null;
  /** O tipo que a Meta disse não entregar (`edit`, `poll_creation`, `view_once`…). */
  naoSuportado: string | null;
  /** "Encaminhada com frequência" — a Meta marca, o WhatsApp mostra as duas setas. */
  muitoEncaminhada: boolean;
  /** Os textos de antes, quando o contato editou (formato do Coexistence). */
  versoes: string[];
};

export const CONTEUDO_VAZIO: ConteudoLido = {
  localizacao: null,
  contatos: [],
  interativo: null,
  resposta: null,
  anuncio: null,
  erro: null,
  naoSuportado: null,
  muitoEncaminhada: false,
  versoes: [],
};

// `nullish` + `catch`: a chave que falta, o nulo e o tipo errado viram `null`.
// (No zod 4, `z.unknown()` sozinho recusa a chave ausente.)
const textoOuNulo = z
  .string()
  .nullish()
  .catch(null)
  .transform((v) => (v && v.trim() !== '' ? v.trim() : null));

const numero = z.union([z.number(), z.string().trim().min(1)]).pipe(z.coerce.number());

const localizacaoSchema = z.object({
  latitude: numero,
  longitude: numero,
  nome: textoOuNulo,
  endereco: textoOuNulo,
});

const cartaoSchema = z.object({
  nome: z.string().trim().min(1),
  telefones: z
    .array(
      z.object({
        numero: z.string().trim().min(1),
        tipo: textoOuNulo,
        wa_id: textoOuNulo,
      }),
    )
    .catch([]),
  emails: z.array(z.string()).catch([]),
  empresa: textoOuNulo,
});

const interativoSchema = z.union([
  z.object({
    tipo: z.literal('botoes'),
    botoes: z.array(z.string().trim().min(1)).min(1),
  }),
  z.object({
    tipo: z.literal('lista'),
    botao: z.string().trim().min(1),
    itens: z.array(z.object({ titulo: z.string().trim().min(1), descricao: textoOuNulo })).min(1),
  }),
  z.object({ tipo: z.literal('pedir_localizacao') }),
]);

const respostaSchema = z.object({ titulo: z.string().trim().min(1), descricao: textoOuNulo });

const anuncioSchema = z.object({ titulo: textoOuNulo, corpo: textoOuNulo, url: textoOuNulo });

const erroSchema = z.object({
  codigo: z
    .unknown()
    .optional()
    .transform((v) =>
      typeof v === 'number' ? String(v) : typeof v === 'string' && v.trim() ? v.trim() : null,
    ),
  titulo: textoOuNulo,
  detalhe: textoOuNulo,
});

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function lerLocalizacao(bruto: Record<string, unknown>): Localizacao | null {
  if (!('latitude' in bruto) || !('longitude' in bruto)) return null;
  const lido = localizacaoSchema.safeParse(bruto);
  if (!lido.success) return null;
  const { latitude, longitude } = lido.data;
  if (!coordenadasValidas(latitude, longitude)) return null;
  return lido.data;
}

/** Lê `messages.conteudo`. Nulo, vazio ou com outra forma dá `CONTEUDO_VAZIO`. */
export function lerConteudo(valor: Json | null | undefined): ConteudoLido {
  const bruto = objeto(valor);
  if (!bruto) return CONTEUDO_VAZIO;

  const contatos = Array.isArray(bruto.contatos)
    ? bruto.contatos.flatMap((c) => {
        const lido = cartaoSchema.safeParse(c);
        if (!lido.success) return [];
        return [
          {
            nome: lido.data.nome,
            telefones: lido.data.telefones.map((t) => ({
              numero: t.numero,
              tipo: t.tipo,
              waId: t.wa_id,
            })),
            emails: lido.data.emails.filter((e) => e.trim() !== ''),
            empresa: lido.data.empresa,
          },
        ];
      })
    : [];

  const interativo = interativoSchema.safeParse(bruto.interativo);
  const resposta = respostaSchema.safeParse(bruto.resposta);
  const anuncio = anuncioSchema.safeParse(bruto.anuncio);
  const erro = erroSchema.safeParse(bruto.erro);
  const naoSuportado = objeto(bruto.nao_suportado)?.tipo;

  return {
    localizacao: lerLocalizacao(bruto),
    contatos,
    interativo: interativo.success
      ? interativo.data.tipo === 'lista'
        ? {
            tipo: 'lista',
            botao: interativo.data.botao,
            itens: interativo.data.itens.map((i) => ({ titulo: i.titulo, descricao: i.descricao })),
          }
        : interativo.data
      : null,
    resposta: resposta.success ? resposta.data : null,
    anuncio:
      anuncio.success && (anuncio.data.titulo || anuncio.data.corpo || anuncio.data.url)
        ? anuncio.data
        : null,
    erro:
      erro.success && (erro.data.codigo || erro.data.titulo || erro.data.detalhe)
        ? erro.data
        : null,
    naoSuportado:
      typeof naoSuportado === 'string' && naoSuportado.trim() !== '' ? naoSuportado.trim() : null,
    muitoEncaminhada: bruto.muito_encaminhada === true,
    versoes: Array.isArray(bruto.versoes)
      ? bruto.versoes.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      : [],
  };
}

// ---------------------------------------------------------------------------
// A localização: o link do mapa e o que a pessoa cola
// ---------------------------------------------------------------------------

export function coordenadasValidas(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** O link que abre o ponto no Google Maps, no celular e no computador. */
export function linkDoMapa(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

export type CoordenadasLidas =
  | { ok: true; latitude: number; longitude: number }
  | { ok: false; motivo: 'vazio' | 'link_curto' | 'nao_entendi' | 'fora_do_mapa' };

const NUMERO = String.raw`-?\d{1,3}(?:\.\d+)?`;
/** "-5.79, -35.21" ou "-5.79 -35.21". Vírgula decimal não: ela é o separador. */
const PAR = new RegExp(String.raw`^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$`);
/** Os jeitos que o Google Maps escreve o ponto num link comprido. */
const NO_LINK = [
  new RegExp(String.raw`@(${NUMERO}),(${NUMERO})`),
  new RegExp(String.raw`!3d(${NUMERO})!4d(${NUMERO})`),
  new RegExp(
    String.raw`[?&](?:q|query|ll|center|destination|daddr)=(${NUMERO})(?:,|%2C)\s*(${NUMERO})`,
    'i',
  ),
];

function par(a: string, b: string): CoordenadasLidas {
  const latitude = Number(a);
  const longitude = Number(b);
  if (!coordenadasValidas(latitude, longitude)) return { ok: false, motivo: 'fora_do_mapa' };
  return { ok: true, latitude, longitude };
}

/**
 * O que a pessoa colou no campo da localização: "lat, lng" ou um link comprido
 * do Google Maps. O link curto (`maps.app.goo.gl`) não traz o ponto — só o
 * Google sabe para onde ele aponta, e o navegador não pode perguntar —, e a
 * recusa diz isso em vez de "não entendi".
 */
export function lerCoordenadas(texto: string): CoordenadasLidas {
  const limpo = texto.trim();
  if (limpo === '') return { ok: false, motivo: 'vazio' };
  const direto = PAR.exec(limpo);
  if (direto?.[1] && direto[2]) return par(direto[1], direto[2]);
  let decodificado = limpo;
  try {
    decodificado = decodeURIComponent(limpo);
  } catch {
    // Link com `%` solto: vale como veio.
  }
  for (const padrao of NO_LINK) {
    const achado = padrao.exec(decodificado);
    if (achado?.[1] && achado[2]) return par(achado[1], achado[2]);
  }
  if (/goo\.gl|maps\.app/i.test(limpo)) return { ok: false, motivo: 'link_curto' };
  return { ok: false, motivo: 'nao_entendi' };
}

export function fraseDasCoordenadas(motivo: Exclude<CoordenadasLidas, { ok: true }>['motivo']) {
  switch (motivo) {
    case 'vazio':
      return 'Cole um link do Google Maps ou as coordenadas.';
    case 'link_curto':
      return 'Link curto do Maps não traz o ponto. Abra o link, copie o endereço comprido da barra ou as coordenadas.';
    case 'fora_do_mapa':
      return 'Essas coordenadas caem fora do mapa. Confira os números.';
    default:
      return 'Não achei o ponto. Use "-5.79, -35.21" ou um link comprido do Google Maps.';
  }
}

// ---------------------------------------------------------------------------
// O que a Meta não entrega, dito em português
// ---------------------------------------------------------------------------

/**
 * A frase de `conteudo.nao_suportado.tipo`. São os tipos que a Cloud API anuncia
 * e não entrega: o CRM sabe que algo chegou, mas não o quê.
 */
export function fraseDoNaoSuportado(tipo: string): string {
  switch (tipo) {
    case 'edit':
      return 'O contato editou uma mensagem. A Meta não manda o texto novo para números da API: só o celular dele mostra. Se importar, peça para ele escrever de novo.';
    case 'poll_creation':
      return 'O contato mandou uma enquete. Enquete não chega pela API da Meta: peça para ele escrever as opções.';
    case 'poll_update':
      return 'O contato votou numa enquete. O voto não chega pela API da Meta.';
    case 'view_once':
      return 'Foto ou vídeo de visualização única. A Meta não entrega pela API: só abre no celular. Peça para mandar de novo do jeito normal.';
    case 'event':
    case 'event_creation':
      return 'O contato mandou um evento de calendário. Ele não chega pela API: peça a data e o lugar por escrito.';
    default:
      return 'Mensagem que a Meta não entrega ao CRM: ela só abre no celular. Se precisar do conteúdo, peça para a pessoa mandar de novo como foto, vídeo ou texto.';
  }
}

/** O erro que a Meta pôs na mensagem recebida, numa frase. */
export function fraseDoErroDaMeta(erro: ErroDaMeta): string {
  const qual = erro.detalhe ?? erro.titulo;
  const codigo = erro.codigo ? ` (código ${erro.codigo})` : '';
  return qual
    ? `O WhatsApp não entregou o conteúdo desta mensagem: ${qual}${codigo}.`
    : `O WhatsApp não entregou o conteúdo desta mensagem${codigo}.`;
}

// ---------------------------------------------------------------------------
// O resumo de uma mensagem numa linha (citação, favoritas, encaminhar)
// ---------------------------------------------------------------------------

/**
 * A linha de assinatura que o banco põe no texto livre (`*Matheus:*` e quebra de
 * linha, gatilho `messages_nome_do_atendente`). No WhatsApp o asterisco vira
 * negrito; aqui a tela faz o mesmo, em vez de mostrar os asteriscos crus.
 *
 * Mora aqui desde 27/10/2026 (era de `mensagens.ts`, que continua a exportar):
 * o resumo da citação também tira a assinatura, e as duas pontas importando uma
 * da outra fariam um ciclo.
 */
const ASSINATURA = /^\*([^*\n]{1,60}):\*\n/;

export function separarAssinatura(texto: string): { nome: string | null; resto: string } {
  const achado = ASSINATURA.exec(texto);
  if (!achado?.[1]) return { nome: null, resto: texto };
  return { nome: achado[1], resto: texto.slice(achado[0].length) };
}

/**
 * O prefixo que `mensagem_corrigir` põe na correção: "*Correção:*", em negrito,
 * desde 29/10/2026. As que saíram antes trazem "_Correção:_", em itálico, e
 * continuam sendo reconhecidas.
 */
export const PREFIXO_DA_CORRECAO = /^(?:\*Corre[çc][ãa]o:\*|_Corre[çc][ãa]o:_)\s*/;

/** O texto como o contato o lê, sem a assinatura nem o "Correção:" da frente. */
export function textoSemMarcas(texto: string | null): string | null {
  if (!texto) return null;
  const { resto } = separarAssinatura(texto);
  const limpo = resto.replace(PREFIXO_DA_CORRECAO, '').trim();
  return limpo === '' ? null : limpo;
}

const TAMANHO_DO_RESUMO = 90;

function cortar(texto: string, tamanho = TAMANHO_DO_RESUMO): string {
  const uma = texto.replace(/\s+/g, ' ').trim();
  return uma.length > tamanho ? `${uma.slice(0, tamanho - 1).trimEnd()}…` : uma;
}

/**
 * Uma linha que diz o que a mensagem é: o começo do texto, ou o tipo com o que
 * dá para dizer dele ("Documento: cardapio.pdf", "Localização: Buffet Aurora").
 */
export function resumoDaMensagem(
  m: Pick<
    MensagemDoFio,
    'tipo' | 'texto' | 'tipoNaMeta' | 'midiaNome' | 'conteudo' | 'transcricao'
  >,
): string {
  const texto = textoSemMarcas(m.texto);
  switch (m.tipo) {
    case 'image':
      if (m.tipoNaMeta === 'sticker') return 'Figurinha';
      return texto ? `Foto: ${cortar(texto, 70)}` : 'Foto';
    case 'video':
      return texto ? `Vídeo: ${cortar(texto, 70)}` : 'Vídeo';
    case 'audio':
      return m.transcricao ? `Áudio: ${cortar(m.transcricao, 70)}` : 'Áudio';
    case 'document':
      return `Documento: ${m.midiaNome ?? texto ?? 'arquivo'}`;
    case 'location': {
      const onde = m.conteudo.localizacao;
      const nome = onde?.nome ?? onde?.endereco;
      return nome ? `Localização: ${cortar(nome, 70)}` : 'Localização';
    }
    case 'contacts': {
      const nomes = m.conteudo.contatos.map((c) => c.nome);
      return nomes.length ? `Contato: ${cortar(nomes.join(', '), 70)}` : 'Contato';
    }
    default:
      return texto ? cortar(texto) : 'Mensagem';
  }
}

// ---------------------------------------------------------------------------
// O que a pessoa monta na caixa: o cartão de contato e a pergunta com opções
// ---------------------------------------------------------------------------

/**
 * O número do cartão de contato em E.164. Sem DDI, é brasileiro (10 ou 11
 * dígitos com DDD); com `+` ou `55` na frente, vale como veio. `null` quando não
 * dá para ser telefone.
 */
export function telefoneDoCartao(texto: string): string | null {
  const digitos = texto.replace(/\D/g, '');
  if (texto.trim().startsWith('+')) {
    return digitos.length >= 8 && digitos.length <= 15 ? `+${digitos}` : null;
  }
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`;
  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    return `+${digitos}`;
  }
  return null;
}

/** Os limites da Meta para a pergunta com opções, os mesmos de `app.messages_forma`. */
export const LIMITES_DA_PERGUNTA = {
  pergunta: 1024,
  botoes: 3,
  botao: 20,
  itens: 10,
  tituloDoItem: 24,
  descricaoDoItem: 72,
} as const;

export type PerguntaMontada =
  | { modo: 'botoes'; pergunta: string; botoes: readonly string[] }
  | {
      modo: 'lista';
      pergunta: string;
      botao: string;
      itens: readonly { titulo: string; descricao: string }[];
    }
  | { modo: 'pedir_localizacao'; pergunta: string };

/**
 * A pergunta como o banco a recebe (`conteudo.interativo`), ou a frase do que
 * falta. As mesmas regras do gatilho, conferidas antes do clique: o gatilho
 * continua sendo quem decide, a tela só evita a ida e volta.
 */
export function montarPergunta(
  p: PerguntaMontada,
):
  { ok: true; corpo: string; conteudo: { interativo: Interativo } } | { ok: false; frase: string } {
  const pergunta = p.pergunta.trim();
  const L = LIMITES_DA_PERGUNTA;
  if (pergunta === '') return { ok: false, frase: 'Escreva a pergunta.' };
  if (pergunta.length > L.pergunta) {
    return { ok: false, frase: `A pergunta vai até ${L.pergunta} caracteres.` };
  }
  if (p.modo === 'pedir_localizacao') {
    return { ok: true, corpo: pergunta, conteudo: { interativo: { tipo: 'pedir_localizacao' } } };
  }
  if (p.modo === 'botoes') {
    const botoes = p.botoes.map((b) => b.trim()).filter((b) => b !== '');
    if (botoes.length === 0) return { ok: false, frase: 'Escreva pelo menos uma opção.' };
    if (botoes.length > L.botoes) return { ok: false, frase: `São ${L.botoes} botões, no máximo.` };
    if (botoes.some((b) => b.length > L.botao)) {
      return { ok: false, frase: `Cada botão vai até ${L.botao} letras.` };
    }
    if (new Set(botoes.map((b) => b.toLowerCase())).size !== botoes.length) {
      return { ok: false, frase: 'Dois botões com o mesmo texto confundem: troque um.' };
    }
    return { ok: true, corpo: pergunta, conteudo: { interativo: { tipo: 'botoes', botoes } } };
  }
  const botao = p.botao.trim();
  const itens = p.itens
    .map((i) => ({ titulo: i.titulo.trim(), descricao: i.descricao.trim() }))
    .filter((i) => i.titulo !== '');
  if (botao === '') return { ok: false, frase: 'Escreva o nome do botão que abre a lista.' };
  if (botao.length > L.botao) return { ok: false, frase: `O botão vai até ${L.botao} letras.` };
  if (itens.length === 0) return { ok: false, frase: 'Escreva pelo menos uma opção.' };
  if (itens.length > L.itens) return { ok: false, frase: `São ${L.itens} opções, no máximo.` };
  if (itens.some((i) => i.titulo.length > L.tituloDoItem)) {
    return { ok: false, frase: `O título de cada opção vai até ${L.tituloDoItem} letras.` };
  }
  if (itens.some((i) => i.descricao.length > L.descricaoDoItem)) {
    return { ok: false, frase: `A descrição de cada opção vai até ${L.descricaoDoItem} letras.` };
  }
  return {
    ok: true,
    corpo: pergunta,
    conteudo: {
      interativo: {
        tipo: 'lista',
        botao,
        itens: itens.map((i) => ({ titulo: i.titulo, descricao: i.descricao || null })),
      },
    },
  };
}
