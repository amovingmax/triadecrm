import {
  AtSign,
  CircleQuestionMark,
  Ellipsis,
  Megaphone,
  ScanSearch,
  Signpost,
  type LucideIcon,
} from 'lucide-react';

import {
  CANAIS_DE_CHEGADA,
  ROTULO_DO_CANAL,
  ROTULO_DO_SUBCANAL,
  SUBCANAIS_POR_CANAL,
  subcanalValido,
  TIMEZONE,
  type CanalDeChegada,
  type DecididoPor,
  type Json,
  type SubcanalDeChegada,
} from '@komune/schema';

/**
 * O canal de chegada do lead, a parte pura (06/11/2026; só da Imova).
 *
 * Por qual meio a pessoa ficou sabendo da Imova e chamou no WhatsApp: Placa,
 * Anúncios, Redes sociais, Outros ou Não identificado. QUEM DECIDE É O BANCO
 * (`public.chegadas`: regra certa primeiro, IA no resto, e a correção de gente
 * vence sempre). Aqui não há regra de canal nenhuma, só a de mostrar: o rótulo,
 * o ícone, a cor, a frase do porquê, o que aparece na lista e o que aparece no
 * topo da conversa.
 *
 * Decisão do Rafael (06/11/2026): a etiqueta mostra SÓ o canal. O subcanal
 * ("Foto da placa", "ZAP Imóveis") e a prova aparecem ao tocar e no relatório.
 */

// ---------------------------------------------------------------------------
// A forma do que vem do banco
// ---------------------------------------------------------------------------

export type TipoDeEvidencia = 'anuncio_meta' | 'portal' | 'texto' | 'foto';
export type PecaDaFoto =
  'placa' | 'banner' | 'print_de_anuncio' | 'print_de_rede_social' | 'imovel' | 'outra';
export type MarcaDaFoto = 'imova' | 'outra_imobiliaria' | 'sem_marca' | 'ilegivel';

/** Um trecho que prova o canal: o texto da mensagem, o anúncio da Meta ou a foto. */
export type Evidencia = { mensagemId: string | null; tipo: TipoDeEvidencia; trecho: string };

/** A foto que a IA leu, DESCRITA. A imagem nunca sai do balde da conversa. */
export type FotoDaChegada = {
  mensagemId: string | null;
  peca: PecaDaFoto;
  marca: MarcaDaFoto;
  descricao: string | null;
  codigo: string | null;
};

/** O palpite da IA que ficou abaixo do limiar: guardado, nunca aplicado. */
export type PalpiteDaIa = { canal: CanalDeChegada; confianca: number | null };

export type ChegadaDaConversa = {
  id: string;
  conversaId: string;
  organizacaoId: string | null;
  inicioEm: string;
  situacao: 'lendo' | 'fechada';
  /** O que vale: a correção de gente, ou a automática. `null` enquanto lê sem decisão. */
  canal: CanalDeChegada | null;
  subcanal: SubcanalDeChegada | null;
  confianca: number | null;
  decididoPor: DecididoPor | null;
  /** A frase pronta do banco para o que vale. */
  motivo: string | null;
  regra: string | null;
  evidencias: Evidencia[];
  foto: FotoDaChegada | null;
  /** O que a regra ou a IA disseram, para "Voltar para a automática" dizer o quê. */
  automatica: {
    canal: CanalDeChegada | null;
    subcanal: SubcanalDeChegada | null;
    motivo: string | null;
    decididoPor: DecididoPor | null;
  };
  /** A correção de quem atende, quando há. */
  marcada: {
    canal: CanalDeChegada;
    subcanal: SubcanalDeChegada | null;
    em: string | null;
    porNome: string | null;
  } | null;
  palpite: PalpiteDaIa | null;
  fechadaEm: string | null;
};

/** As colunas que a tela lê de `canal_por_conversa` e `chegadas_na_lista`. */
export const COLUNAS_DA_CHEGADA =
  'id, conversation_id, organization_id, inicio_em, situacao, canal, subcanal, confianca, decidido_por, motivo, regra_slug, evidencias, foto, canal_automatico, subcanal_automatico, motivo_automatico, decidido_automatico_por, canal_marcado, subcanal_marcado, marcado_em, marcado_por_nome, sugestao_da_ia, fechada_em' as const;

export type ChegadaCrua = {
  id: string | null;
  conversation_id: string | null;
  organization_id: string | null;
  inicio_em: string | null;
  situacao: string | null;
  canal: string | null;
  subcanal: string | null;
  confianca: number | string | null;
  decidido_por: string | null;
  motivo: string | null;
  regra_slug: string | null;
  evidencias: Json | null;
  foto: Json | null;
  canal_automatico: string | null;
  subcanal_automatico: string | null;
  motivo_automatico: string | null;
  decidido_automatico_por: string | null;
  canal_marcado: string | null;
  subcanal_marcado: string | null;
  marcado_em: string | null;
  marcado_por_nome: string | null;
  sugestao_da_ia: Json | null;
  fechada_em: string | null;
};

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

export function ehCanalDeChegada(v: unknown): v is CanalDeChegada {
  return typeof v === 'string' && (CANAIS_DE_CHEGADA as readonly string[]).includes(v);
}

function ehDecididoPor(v: unknown): v is DecididoPor {
  return v === 'regra' || v === 'ia' || v === 'gente';
}

/** O subcanal só vale se for do canal: par trocado vira `null`, e não rótulo errado. */
function subcanalDo(canal: CanalDeChegada | null, sub: string | null): SubcanalDeChegada | null {
  return canal && sub && subcanalValido(canal, sub) ? (sub as SubcanalDeChegada) : null;
}

function objeto(v: Json | null | undefined): Record<string, Json | undefined> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function texto(v: Json | undefined, teto = 200): string | null {
  if (typeof v !== 'string') return null;
  const limpo = v.replace(/\s+/g, ' ').trim();
  if (!limpo) return null;
  return limpo.length > teto ? `${limpo.slice(0, teto - 1).trimEnd()}…` : limpo;
}

function numero(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

const TIPOS_DE_EVIDENCIA: readonly TipoDeEvidencia[] = ['anuncio_meta', 'portal', 'texto', 'foto'];
const PECAS: readonly PecaDaFoto[] = [
  'placa',
  'banner',
  'print_de_anuncio',
  'print_de_rede_social',
  'imovel',
  'outra',
];
const MARCAS: readonly MarcaDaFoto[] = ['imova', 'outra_imobiliaria', 'sem_marca', 'ilegivel'];

/** No máximo quatro provas: é o teto da IA, e a regra grava uma ou duas. */
const TETO_DE_EVIDENCIAS = 4;

export function lerEvidencias(json: Json | null): Evidencia[] {
  if (!Array.isArray(json)) return [];
  const lista: Evidencia[] = [];
  for (const item of json) {
    const e = objeto(item ?? null);
    if (!e) continue;
    const tipo = e['tipo'];
    const trecho = texto(e['trecho'], 160);
    if (typeof tipo !== 'string' || !TIPOS_DE_EVIDENCIA.includes(tipo as TipoDeEvidencia)) continue;
    if (!trecho) continue;
    const id = e['message_id'];
    lista.push({
      mensagemId: typeof id === 'string' ? id : null,
      tipo: tipo as TipoDeEvidencia,
      trecho,
    });
    if (lista.length === TETO_DE_EVIDENCIAS) break;
  }
  return lista;
}

export function lerFoto(json: Json | null): FotoDaChegada | null {
  const f = objeto(json);
  if (!f) return null;
  const peca = f['peca'];
  const marca = f['marca'];
  const codigo = f['codigo_do_imovel'];
  const id = f['message_id'];
  return {
    mensagemId: typeof id === 'string' ? id : null,
    peca:
      typeof peca === 'string' && PECAS.includes(peca as PecaDaFoto)
        ? (peca as PecaDaFoto)
        : 'outra',
    marca:
      typeof marca === 'string' && MARCAS.includes(marca as MarcaDaFoto)
        ? (marca as MarcaDaFoto)
        : 'ilegivel',
    descricao: texto(f['descricao'], 160),
    codigo:
      typeof codigo === 'string' && /^[A-Z0-9_-]{2,30}$/i.test(codigo.trim())
        ? codigo.trim().toUpperCase()
        : null,
  };
}

function lerPalpite(json: Json | null): PalpiteDaIa | null {
  const p = objeto(json);
  const canal = p?.['canal'];
  if (!p || !ehCanalDeChegada(canal) || canal === 'nao_identificado') return null;
  const c = numero(p['confianca']);
  return { canal, confianca: c !== null && c >= 0 && c <= 1 ? c : null };
}

/** Uma linha do banco na forma da tela. Linha sem id, conversa ou início fica de fora. */
export function montarChegada(c: ChegadaCrua): ChegadaDaConversa | null {
  if (!c.id || !c.conversation_id || !c.inicio_em) return null;
  const canal = ehCanalDeChegada(c.canal) ? c.canal : null;
  const automatico = ehCanalDeChegada(c.canal_automatico) ? c.canal_automatico : null;
  const marcado = ehCanalDeChegada(c.canal_marcado) ? c.canal_marcado : null;
  const confianca = numero(c.confianca);
  return {
    id: c.id,
    conversaId: c.conversation_id,
    organizacaoId: c.organization_id,
    inicioEm: c.inicio_em,
    situacao: c.situacao === 'fechada' ? 'fechada' : 'lendo',
    canal,
    subcanal: subcanalDo(canal, c.subcanal),
    confianca: confianca !== null && confianca >= 0 && confianca <= 1 ? confianca : null,
    decididoPor: ehDecididoPor(c.decidido_por) ? c.decidido_por : null,
    motivo: texto(c.motivo ?? undefined),
    regra: c.regra_slug,
    evidencias: lerEvidencias(c.evidencias),
    foto: lerFoto(c.foto),
    automatica: {
      canal: automatico,
      subcanal: subcanalDo(automatico, c.subcanal_automatico),
      motivo: texto(c.motivo_automatico ?? undefined),
      decididoPor: ehDecididoPor(c.decidido_automatico_por) ? c.decidido_automatico_por : null,
    },
    marcada: marcado
      ? {
          canal: marcado,
          subcanal: subcanalDo(marcado, c.subcanal_marcado),
          em: c.marcado_em,
          porNome: c.marcado_por_nome,
        }
      : null,
    palpite: lerPalpite(c.sugestao_da_ia),
    fechadaEm: c.fechada_em,
  };
}

/**
 * As linhas num mapa por conversa. A view já traz só a chegada mais recente de
 * cada uma; se vierem duas, fica a mais nova (a volta depois de 30 dias).
 */
export function montarCanais(linhas: readonly ChegadaCrua[]): Map<string, ChegadaDaConversa> {
  const mapa = new Map<string, ChegadaDaConversa>();
  for (const l of linhas) {
    const c = montarChegada(l);
    if (!c) continue;
    const antes = mapa.get(c.conversaId);
    if (!antes || Date.parse(c.inicioEm) > Date.parse(antes.inicioEm)) mapa.set(c.conversaId, c);
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Aparência
// ---------------------------------------------------------------------------

/**
 * O ícone e a cor de cada canal.
 *
 * A COR É DISCRETA, e fora da escala térmica: aço, âmbar, brasa e verde são
 * temperatura neste produto, e o canal não diz o quanto a pessoa quer — diz por
 * onde ela veio. Por isso pedra (a placa na rua), violeta, magenta e petróleo, a
 * 14% no fundo e misturados ao texto do tema, como a `Etiqueta`. Não identificado
 * fica no cinza. A palavra vai sempre escrita: cor sozinha não sobrevive a
 * daltonismo nem ao sol.
 */
export type AparenciaDoCanal = { rotulo: string; icone: LucideIcon; cor: string };

export const APARENCIA_DO_CANAL: Readonly<Record<CanalDeChegada, AparenciaDoCanal>> = {
  placa: { rotulo: ROTULO_DO_CANAL.placa, icone: Signpost, cor: '#7c6a58' },
  anuncios: { rotulo: ROTULO_DO_CANAL.anuncios, icone: Megaphone, cor: '#7a56c4' },
  redes_sociais: { rotulo: ROTULO_DO_CANAL.redes_sociais, icone: AtSign, cor: '#b8457f' },
  outros: { rotulo: ROTULO_DO_CANAL.outros, icone: Ellipsis, cor: '#13807b' },
  nao_identificado: {
    rotulo: ROTULO_DO_CANAL.nao_identificado,
    icone: CircleQuestionMark,
    cor: 'var(--muted-foreground)',
  },
};

/** Enquanto o banco ainda lê as primeiras mensagens. */
export const IDENTIFICANDO = { rotulo: 'identificando…', icone: ScanSearch } as const;

/** O fundo e o texto do chip, na mesma mistura da `Etiqueta`. */
export function coresDoCanal(canal: CanalDeChegada): { backgroundColor: string; color: string } {
  const cor = APARENCIA_DO_CANAL[canal].cor;
  return {
    backgroundColor: `color-mix(in oklab, ${cor} 14%, transparent)`,
    color: `color-mix(in oklab, ${cor} 50%, var(--foreground))`,
  };
}

/** O rótulo do subcanal, ou `null` quando ele não diz nada além do canal. */
export function rotuloDoSubcanal(
  canal: CanalDeChegada,
  subcanal: SubcanalDeChegada | null,
): string | null {
  if (!subcanal || subcanal === 'desconhecido') return null;
  const sub = ROTULO_DO_SUBCANAL[subcanal];
  return sub === ROTULO_DO_CANAL[canal] ? null : sub;
}

/** "Placa · Foto da placa". O subcanal some quando só repete o canal. */
export function linhaDoCanal(canal: CanalDeChegada, subcanal: SubcanalDeChegada | null): string {
  const sub = rotuloDoSubcanal(canal, subcanal);
  return sub ? `${ROTULO_DO_CANAL[canal]} · ${sub}` : ROTULO_DO_CANAL[canal];
}

// ---------------------------------------------------------------------------
// Onde aparece
// ---------------------------------------------------------------------------

/**
 * O canal que a LISTA mostra. Nada para "Não identificado" e nada enquanto lê
 * sem decisão: a linha da lista é estreita, e um chip que diz "não sei" em toda
 * linha seria ruído.
 */
export function canalNaLista(c: ChegadaDaConversa | undefined): CanalDeChegada | null {
  if (!c?.canal || c.canal === 'nao_identificado') return null;
  return c.canal;
}

/**
 * O que o TOPO da conversa e os dados do contato mostram. Lá cabe dizer "não
 * identificado" (discreto) e "identificando…": é onde alguém vai corrigir.
 * Conversa sem chegada (aberta por nós: modelo, bom-dia, prospecção) não mostra
 * nada, porque a pessoa não nos procurou.
 */
export type CanalNoTopo =
  | { tipo: 'sem_chegada' }
  | { tipo: 'identificando' }
  | { tipo: 'canal'; canal: CanalDeChegada; discreto: boolean };

export function canalNoTopo(c: ChegadaDaConversa | undefined): CanalNoTopo {
  if (!c) return { tipo: 'sem_chegada' };
  if (!c.canal) return { tipo: 'identificando' };
  return { tipo: 'canal', canal: c.canal, discreto: c.canal === 'nao_identificado' };
}

/** O filtro "Canal de chegada" da lista: sem chegada, a conversa não entra em canal nenhum. */
export function cabeNoCanal(
  c: ChegadaDaConversa | undefined,
  filtro: CanalDeChegada | null,
): boolean {
  return filtro === null || c?.canal === filtro;
}

// ---------------------------------------------------------------------------
// O porquê
// ---------------------------------------------------------------------------

const DIA_E_MES = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: TIMEZONE,
});

const DATA_COMPLETA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: TIMEZONE,
});

function diaEMes(iso: string): string {
  return DIA_E_MES.format(new Date(iso));
}

export function dataCompleta(iso: string): string {
  return DATA_COMPLETA.format(new Date(iso));
}

/** 0,82 vira "82%". */
export function porcentagem(confianca: number | null): string | null {
  return confianca === null ? null : `${Math.round(confianca * 100)}%`;
}

function primeiroNome(nome: string | null): string | null {
  const limpo = nome?.trim();
  return limpo ? (limpo.split(/\s+/)[0] ?? null) : null;
}

const PECA_NA_FRASE: Record<PecaDaFoto, string> = {
  placa: 'uma foto de placa',
  banner: 'uma foto de banner',
  print_de_anuncio: 'um print de anúncio',
  print_de_rede_social: 'um print de rede social',
  imovel: 'uma foto do imóvel',
  outra: 'uma foto',
};

/** A marca só é dita onde ela importa: na placa e no banner, e quando é a Imova. */
function marcaNaFrase(f: FotoDaChegada): string {
  const ehPeca = f.peca === 'placa' || f.peca === 'banner';
  switch (f.marca) {
    case 'imova':
      return ' da Imova';
    case 'outra_imobiliaria':
      return ' de outra imobiliária';
    case 'sem_marca':
      return ehPeca ? ' sem marca' : '';
    case 'ilegivel':
      return ehPeca ? ' com a marca ilegível' : '';
  }
}

/** "uma foto de placa da Imova, código SA0012". */
export function fraseDaFoto(f: FotoDaChegada): string {
  return `${PECA_NA_FRASE[f.peca]}${marcaNaFrase(f)}${f.codigo ? `, código ${f.codigo}` : ''}`;
}

/** "Foto de placa da Imova, código SA0012": a mesma frase, começando a linha. */
export function rotuloDaFoto(f: FotoDaChegada): string {
  const frase = fraseDaFoto(f).replace(/^(uma|um) /, '');
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}

/**
 * A frase do porquê, numa linha: "Clicou no anúncio …", "A IA viu uma foto de
 * placa da Imova, código SA0012 · 82%", "Corrigido por Ana em 06/11".
 *
 * A frase do que vale é do banco (`motivo`); a tela só completa o que falta: o
 * nome de quem corrigiu, a confiança da IA e o texto de quando não há frase.
 */
export function porqueDoCanal(c: ChegadaDaConversa): string {
  if (c.decididoPor === 'gente' && c.marcada) {
    const quem = primeiroNome(c.marcada.porNome) ?? 'alguém do time';
    return c.marcada.em
      ? `Corrigido por ${quem} em ${diaEMes(c.marcada.em)}`
      : `Corrigido por ${quem}`;
  }
  if (!c.canal) return 'Lendo as primeiras mensagens para saber por onde chegou.';

  const base =
    c.motivo ??
    (c.decididoPor === 'ia' && c.foto
      ? `A IA viu ${fraseDaFoto(c.foto)}`
      : c.decididoPor === 'ia'
        ? 'A IA leu as primeiras mensagens'
        : c.decididoPor === 'regra'
          ? 'Uma regra reconheceu o sinal nas primeiras mensagens'
          : 'Sem sinal de por onde chegou');

  const pct = c.decididoPor === 'ia' ? porcentagem(c.confianca) : null;
  // A frase do banco pode já trazer a confiança; não repetir.
  return pct && !/\d\s?%/.test(base) ? `${base} · ${pct}` : base;
}

/**
 * Depois de uma correção, o que a automática dizia: é o que "Voltar para a
 * automática" vai trazer de volta. `null` sem correção, ou sem automática ainda.
 */
export function automaticaEra(c: ChegadaDaConversa): string | null {
  if (!c.marcada || !c.automatica.canal) return null;
  return linhaDoCanal(c.automatica.canal, c.automatica.subcanal);
}

export const ROTULO_DA_EVIDENCIA: Readonly<Record<TipoDeEvidencia, string>> = {
  anuncio_meta: 'Anúncio da Meta',
  portal: 'Portal',
  texto: 'Mensagem',
  foto: 'Foto',
};

// ---------------------------------------------------------------------------
// Corrigir
// ---------------------------------------------------------------------------

/** Os subcanais que valem a pena escolher: Não identificado tem um só. */
export function subcanaisParaEscolher(canal: CanalDeChegada): readonly SubcanalDeChegada[] {
  const lista = SUBCANAIS_POR_CANAL[canal] as readonly SubcanalDeChegada[];
  return lista.length > 1 ? lista : [];
}

export type RespostaDoMarcar = { ok?: boolean; motivo?: string };

/** A recusa de `public.chegada_marcar`, em português. `null` quando gravou. */
export function erroDoMarcar(resposta: unknown): string | null {
  const r = (resposta ?? {}) as RespostaDoMarcar;
  if (r.ok === true) return null;
  switch (r.motivo) {
    case 'desligada':
      return 'A identificação do canal de chegada está desligada.';
    case 'sem_permissao':
      return 'O seu acesso não deixa corrigir o canal desta conversa.';
    case 'nao_achada':
      return 'Essa chegada não existe mais. Atualize a tela.';
    case 'canal_invalido':
      return 'Esse canal não existe.';
    case 'subcanal_invalido':
      return 'Esse detalhe não combina com o canal escolhido.';
    default:
      return 'Não deu para gravar.';
  }
}

// ---------------------------------------------------------------------------
// Na ficha
// ---------------------------------------------------------------------------

const PELO_CANAL: Record<Exclude<CanalDeChegada, 'nao_identificado'>, string> = {
  placa: 'pela placa',
  anuncios: 'por anúncio',
  redes_sociais: 'pelas redes sociais',
  outros: 'por outro meio',
};

/** Em Outros, o meio que o cliente contou diz mais que "outro meio". */
const PELO_SUBCANAL_DE_OUTROS: Partial<Record<SubcanalDeChegada, string>> = {
  indicacao: 'por indicação',
  site: 'pelo site',
  google: 'pelo Google',
};

function peloCanal(canal: Exclude<CanalDeChegada, 'nao_identificado'>, subcanal: SubcanalDeChegada | null): string {
  if (canal === 'outros' && subcanal) return PELO_SUBCANAL_DE_OUTROS[subcanal] ?? PELO_CANAL.outros;
  return PELO_CANAL[canal];
}

export type ChegadaNaFicha = {
  id: string;
  frase: string;
  canal: CanalDeChegada | null;
  /** O subcanal e o porquê, para a linha de apoio. */
  detalhe: string | null;
};

/**
 * As chegadas da ficha, da primeira à última: "Chegou pela placa em 06/11/2026",
 * "Voltou por anúncio em 03/02/2027". Volta é a mesma pessoa escrevendo depois de
 * 30 dias de silêncio (o banco decide quando é chegada nova).
 */
export function chegadasNaFicha(lista: readonly ChegadaDaConversa[]): ChegadaNaFicha[] {
  return [...lista]
    .sort((a, b) => Date.parse(a.inicioEm) - Date.parse(b.inicioEm))
    .map((c, i) => {
      const verbo = i === 0 ? 'Chegou' : 'Voltou';
      const data = dataCompleta(c.inicioEm);
      const frase = !c.canal
        ? `${verbo} em ${data} · identificando o canal…`
        : c.canal === 'nao_identificado'
          ? `${verbo} em ${data} · canal não identificado`
          : `${verbo} ${peloCanal(c.canal, c.subcanal)} em ${data}`;
      const sub = c.canal ? rotuloDoSubcanal(c.canal, c.subcanal) : null;
      const porque = c.canal ? porqueDoCanal(c) : null;
      const detalhe = [sub, porque].filter(Boolean).join(' · ') || null;
      return { id: c.id, frase, canal: c.canal, detalhe };
    });
}

/**
 * A etiqueta do topo da ficha (09/11/2026): o canal da chegada mais recente que tem
 * canal. "Não identificado" e "identificando…" não viram etiqueta (como na lista): o
 * bloco "Como chegou" diz isso por extenso.
 */
export function canalDaFicha(lista: readonly ChegadaDaConversa[]): ChegadaDaConversa | null {
  return (
    [...lista]
      .filter((c) => c.canal !== null && c.canal !== 'nao_identificado')
      .sort((a, b) => Date.parse(b.inicioEm) - Date.parse(a.inicioEm))[0] ?? null
  );
}
