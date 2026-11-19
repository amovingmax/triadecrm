/**
 * Obras públicas e licenças, de fontes oficiais e abertas, gravadas em
 * `mercado_obras`. Porte de `coletar/obras.mjs`.
 *
 *  - Diário Oficial do Município do Natal (`dom-natal`): a busca pública do
 *    próprio site diz em que edições aparece cada palavra; só as edições novas
 *    são baixadas (1 a cada 3 s) e lidas. Nunca se guarda nome de pessoa
 *    física (LGPD): só o tipo do ato, a fase, o bairro, a rua e a data.
 *  - Obrasgov.br (`obrasgov`, API aberta do Governo Federal): obras com dinheiro
 *    federal nas cinco cidades. O servidor é lento (cerca de 1 minuto por
 *    página), então a leitura vai em ciclos: cada rodada lê até 20 minutos e
 *    continua de onde parou na seguinte (cursor no estado da coleta).
 *
 * Fase pelo documento (veracidade §10.3): prevista, contratada, em andamento,
 * concluída. Ao cliente só vão "em andamento" e "concluída" (o banco decide a
 * validade: `app.mercado_obra_valida_ate`).
 */
import { Impressao } from '../lote';
import { textoDoPdf } from '../pdf';
import { semAcento, slug } from '../texto';
import type { Coletor, ContextoDoColetor, LinhaObra, ResultadoDoColetor } from '../tipos';
import { sha256 } from '../web';

// ---------------------------------------------------------------------------
// Bairros oficiais de Natal e leitura dos atos
// ---------------------------------------------------------------------------

const BAIRROS_NATAL = [
  'Alecrim',
  'Areia Preta',
  'Barro Vermelho',
  'Bom Pastor',
  'Candelária',
  'Capim Macio',
  'Cidade Alta',
  'Cidade da Esperança',
  'Cidade Nova',
  'Dix-Sept Rosado',
  'Felipe Camarão',
  'Guarapes',
  'Igapó',
  'Lagoa Azul',
  'Lagoa Nova',
  'Lagoa Seca',
  'Mãe Luíza',
  'Neópolis',
  'Nordeste',
  'Nossa Senhora da Apresentação',
  'Nossa Senhora de Nazaré',
  'Nova Descoberta',
  'Pajuçara',
  'Petrópolis',
  'Pitimbu',
  'Planalto',
  'Ponta Negra',
  'Potengi',
  'Praia do Meio',
  'Quintas',
  'Redinha',
  'Ribeira',
  'Rocas',
  'Salinas',
  'Santos Reis',
  'Tirol',
  'Cidade Jardim',
  'Cidade Satélite',
  'Conjunto Satélite',
  'Via Costeira',
  'Vila de Ponta Negra',
];
const NOME_DO_BAIRRO = new Map(BAIRROS_NATAL.map((b) => [semAcento(b).replace(/-/g, ' '), b]));
const RE_BAIRRO_NATAL = new RegExp(
  `\\b(${BAIRROS_NATAL.map((b) => semAcento(b).replace(/-/g, '[- ]'))
    .sort((a, b) => b.length - a.length)
    .join('|')})\\b`,
  'g',
);
const RE_RUA =
  /\b((?:rua|avenida|av\.|travessa|alameda|rodovia|estrada|praca|praça)\s+[a-z0-9à-ú.'\- ]{3,60}?)(?=,|;|\.|\s+n[ºo°.]|\s+bairro|\s+no\s+bairro|\s+em\s+|\s+-\s|$)/i;
const nomeDoBairro = (x: string): string => NOME_DO_BAIRRO.get(x.replace(/-/g, ' ')) ?? x;

const FASES: Array<[LinhaObra['fase'], RegExp]> = [
  ['concluida', /termo de recebimento (definitivo|provisorio)|inaugura|habite-?se|carta de habite/],
  [
    'em_andamento',
    /ordem de servico|alvara de (construcao|obra|demolicao|reforma)|licenca de instalacao|licenca (de )?obra|inicio (da|das) obras?/,
  ],
  ['contratada', /extrato (do|de) contrato|homologacao|adjudicacao|termo aditivo|contrato n/],
  [
    'prevista',
    /aviso de licitacao|edital|concorrencia|tomada de precos|pregao|chamamento|projeto de lei|plano (diretor|de)/,
  ],
];
const RE_OBRA =
  /(obra|paviment|drenag|constru|reforma|requalifica|urbaniza|alvara|habite|licenca de instalacao|recapeamento|esgot|saneamento|praca|loteamento|engenharia|orla|iluminacao publica|implantacao)/;
const RE_PESSOAL =
  /\b(interessad[oa]s?|requerente|propriet[aá]ri[oa]s?|contratad[oa] pessoa f[ií]sica|respons[aá]vel t[eé]cnic[oa]|engenheir[oa]|arquitet[oa]|cpf|rg|crea|cau)\b[^.;\n]*/gi;
const RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

/** Tira do trecho o que identifica pessoa (LGPD). */
export const tirarDadoPessoal = (t: string): string =>
  t
    .replace(RE_PESSOAL, '[dado pessoal removido]')
    .replace(RE_CPF, '[dado pessoal removido]')
    .replace(/\s+/g, ' ')
    .trim();

const eTitulo = (l: string): boolean => {
  const x = l.trim();
  if (x.length < 8 || x.length > 140 || x.includes(':')) return false;
  const letras = x.replace(/[^A-Za-zÀ-ú]/g, '');
  return letras.length >= 6 && letras.replace(/[^A-ZÀ-Ý]/g, '').length / letras.length >= 0.8;
};

export interface AtoDoDiario {
  titulo: string;
  fase: LinhaObra['fase'];
  tipo: LinhaObra['tipo'];
  bairros: string[];
  abrangencia: 'bairro' | 'cidade';
  rua: string | null;
  objeto: string | null;
  trechoSha256: string;
}

/** Divide a edição em atos (cada um começa num título em maiúsculas) e fica com os de obra que têm fase clara. */
export function atosDoTexto(texto: string): AtoDoDiario[] {
  const blocos: Array<{ titulo: string; corpo: string }> = [];
  let atual: { titulo: string; corpo: string } | null = null;
  for (const l of texto.split(/\n/)) {
    if (eTitulo(l)) {
      if (atual && atual.corpo.length > 40) blocos.push(atual);
      atual = { titulo: l.trim(), corpo: '' };
    } else if (atual && atual.corpo.length < 6000) atual.corpo += ` ${l}`;
  }
  if (atual && atual.corpo.length > 40) blocos.push(atual);
  const atos: AtoDoDiario[] = [];
  const vistos = new Set<string>();
  for (const b of blocos) {
    const tt = semAcento(b.titulo);
    const corpo = b.corpo.replace(/\s+/g, ' ').trim();
    const cs = semAcento(corpo);
    if (!RE_OBRA.test(`${tt} ${cs.slice(0, 1500)}`.replace(/mao de obra/g, ''))) continue;
    const inicio = cs.slice(0, 400);
    const fase =
      FASES.find(([, re]) => re.test(tt))?.[0] ??
      (/(alvara|habite-?se|licenca de instalacao)/.test(inicio)
        ? FASES.find(([, re]) => re.test(inicio))?.[0]
        : undefined);
    if (!fase) continue;
    const objeto =
      corpo.match(/objeto\s*:?\s*(.{20,320}?)(?:\.\s|;|\bvalor\b|\bprazo\b|vig[eê]ncia|$)/i)?.[1] ??
      null;
    const alvo = semAcento(objeto ?? cs.slice(0, 1500)).replace(/mao de obra/g, '');
    if (!RE_OBRA.test(alvo)) continue;
    const titAlvo = `${tt} ${alvo}`;
    const tipo: LinhaObra['tipo'] = /habite-?se/.test(titAlvo)
      ? 'habite_se'
      : /alvara/.test(titAlvo)
        ? 'alvara'
        : /licenca de instalacao|licenca (de )?obra/.test(titAlvo)
          ? 'licenca'
          : /loteamento/.test(titAlvo)
            ? 'loteamento'
            : 'obra_publica';
    const doObjeto = objeto
      ? [...semAcento(objeto).matchAll(RE_BAIRRO_NATAL)].map((x) => x[1] ?? '')
      : [];
    const explicitos = [
      ...cs
        .slice(0, 3000)
        .matchAll(
          new RegExp(`bairros?\\s+(?:de\\s+|do\\s+|da\\s+)?${RE_BAIRRO_NATAL.source}`, 'g'),
        ),
    ].map((x) => x[1] ?? '');
    let bairros = [...new Set([...doObjeto, ...explicitos].filter(Boolean))];
    if (bairros.length === 0)
      bairros = [
        ...new Set(
          [...cs.slice(0, 800).matchAll(RE_BAIRRO_NATAL)].map((x) => x[1] ?? '').filter(Boolean),
        ),
      ];
    const abrangencia = bairros.length > 4 ? 'cidade' : 'bairro';
    const rua = (objeto ?? corpo.slice(0, 2500)).match(RE_RUA)?.[1]?.trim() ?? null;
    const chave = `${tt}|${objeto ?? cs.slice(0, 200)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    atos.push({
      titulo: tirarDadoPessoal(b.titulo).slice(0, 140),
      fase,
      tipo,
      bairros: bairros.map(nomeDoBairro),
      abrangencia,
      rua: rua ? tirarDadoPessoal(rua).slice(0, 300) : null,
      objeto: objeto ? tirarDadoPessoal(objeto) : null,
      trechoSha256: sha256(b.titulo + corpo),
    });
  }
  return atos;
}

const PALAVRAS_DOM = [
  'ordem de serviço',
  'alvará de construção',
  'habite-se',
  'licença de instalação',
  'pavimentação',
  'drenagem',
  'requalificação',
  'termo de recebimento',
];
const dataBR = (s: string): string | null => {
  const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const MAX_EDICOES_LEMBRADAS = 600;

/** Um ato → linhas de `mercado_obras` (uma por bairro do estudo; sem bairro, uma da cidade). */
export function linhasDoAto(
  a: AtoDoDiario,
  e: { id: string; data: string; rotulo: string; link: string },
  regiaoDe: (bairro: string) => string | null,
): LinhaObra[] {
  const base = {
    url: e.link,
    documento: `Diário Oficial do Município do Natal, ${e.rotulo}`.slice(0, 300),
    tipo: a.tipo,
    fase: a.fase,
    orgao: null,
    objeto: (a.objeto ?? a.titulo).slice(0, 1000),
    local_texto: a.rua,
    cidade: 'Natal',
    publicado_em: e.data,
  };
  const id = `${e.id}:${a.trechoSha256.slice(0, 16)}`;
  if (a.abrangencia === 'cidade' || a.bairros.length === 0)
    return [{ ...base, id_externo: id, bairro: null, regiao_id: null }];
  return a.bairros.map((b) => ({
    ...base,
    id_externo: `${id}:${slug(b)}`.slice(0, 200),
    bairro: b,
    regiao_id: regiaoDe(b),
  }));
}

export const coletorDomNatal: Coletor = {
  chave: 'obras/dom-natal',
  maxPedidosPadrao: 150,
  caminhoDeTeste: '/dom',
  async coletar(ctx: ContextoDoColetor): Promise<ResultadoDoColetor> {
    const origem = 'https://natal.rn.gov.br';
    const impressao = new Impressao();
    const erros: string[] = [];
    const lidasAntes = Array.isArray(ctx.estadoAnterior.edicoes_lidas)
      ? (ctx.estadoAnterior.edicoes_lidas as unknown[]).map(String)
      : [];
    const jaLidas = new Set(lidasAntes);
    const desde = new Date(Date.parse(`${ctx.dia}T12:00:00Z`) - 90 * 864e5)
      .toISOString()
      .slice(0, 10);
    const edicoes = new Map<string, { id: string; data: string; rotulo: string }>();
    for (const p of PALAVRAS_DOM) {
      const r = await ctx.navegador.json<{ data?: unknown[][] }>(
        `${origem}/api/dom/${encodeURIComponent(p)}`,
        { tempo: 60_000 },
      );
      if (!r) {
        erros.push(`busca "${p}": ${ctx.navegador.parada ?? 'sem resposta'}`);
        continue;
      }
      for (const linha of r.dado.data ?? []) {
        const html = String(linha?.[0] ?? '');
        const id = html.match(/arquivo\/(\d+)/)?.[1];
        const data = dataBR(html);
        if (!id || !data || data < desde) continue;
        edicoes.set(id, {
          id,
          data,
          rotulo: html
            .replace(/<[^>]+>/g, '')
            .trim()
            .slice(0, 200),
        });
      }
    }
    const novas = [...edicoes.values()]
      .filter((e) => !jaLidas.has(e.id))
      .sort((a, b) => a.data.localeCompare(b.data));
    const lidasAgora: string[] = [];
    let atosN = 0;
    let n = 0;
    for (const e of novas) {
      const link = `${origem}/dom/arquivo/${e.id}`;
      const r = await ctx.navegador.pagina(link, {
        binario: true,
        aceitar: 'application/pdf,*/*;q=0.5',
        tempo: 120_000,
      });
      if (!r) break;
      if (!r.bytes) {
        erros.push(`edição ${e.id}: HTTP ${r.status}`);
        continue;
      }
      if (r.bytes.subarray(0, 5).toString() !== '%PDF-') {
        erros.push(`edição ${e.id}: não é PDF`);
        continue;
      }
      impressao.somar(r.sha256 ?? '');
      const atos = atosDoTexto(textoDoPdf(r.bytes));
      atosN += atos.length;
      const linhas = atos.flatMap((a) =>
        linhasDoAto(
          a,
          { ...e, link },
          (b) => ctx.regioes.regiaoDe({ cidade: 'Natal', bairro: b })?.regiao ?? null,
        ),
      );
      if (linhas.length > 0) n += await ctx.gravador.obras(linhas);
      lidasAgora.push(e.id);
    }
    const edicoesLidas = [...lidasAgora, ...lidasAntes].slice(0, MAX_EDICOES_LEMBRADAS);
    return {
      completa: erros.length === 0 && ctx.navegador.parada === null,
      hashBruto: impressao.fechar(),
      estado: { edicoes_lidas: edicoesLidas },
      detalhes: {
        edicoes_encontradas: edicoes.size,
        edicoes_lidas: lidasAgora.length,
        atos: atosN,
        gravados: n,
        pedidos: ctx.navegador.pedidos,
        parada: ctx.navegador.parada,
      },
      erros,
    };
  },
};

// ---------------------------------------------------------------------------
// Obrasgov.br
// ---------------------------------------------------------------------------

const OBRASGOV = 'https://api.obrasgov.gestao.gov.br/obrasgov/api/projeto-investimento';
const CIDADES_OBRAS = ['Natal', 'Parnamirim', 'Extremoz', 'Tibau do Sul', 'Nísia Floresta'];
const SO_PROJETO =
  /^(contratacao de empresa para )?(elaboracao|desenvolvimento) d[eo]s? (projetos?|estudos?)|^projetos? (para|de|basico|executivo|arquitetonico)|^estudos? (de|para)/;
const PRAZO_DO_CICLO_MS = 20 * 60_000;

export interface ObraFederal {
  idUnico?: string;
  nome?: string;
  descricao?: string;
  endereco?: string;
  situacao?: string;
  dataSituacao?: string;
  dataInicialEfetiva?: string;
  dataFinalPrevista?: string;
  executores?: Array<{ nome?: string }>;
  tomadores?: Array<{ nome?: string }>;
  fontesDeRecurso?: Array<{ valorInvestimentoPrevisto?: number }>;
}

export function cidadeDaObra(o: ObraFederal): string | null {
  const txt = semAcento(
    [...(o.executores ?? []), ...(o.tomadores ?? [])].map((x) => x.nome ?? '').join(' | '),
  );
  for (const c of CIDADES_OBRAS)
    if (new RegExp(`municipio de ${semAcento(c)}\\b`).test(txt)) return c;
  const resto = semAcento(`${o.nome ?? ''} ${o.descricao ?? ''} ${o.endereco ?? ''}`);
  for (const c of CIDADES_OBRAS) {
    if (
      new RegExp(`\\b${semAcento(c)}(\\s*[/-]\\s*rn|\\b)`).test(resto) &&
      !(c === 'Natal' && /sao goncalo|natalense/.test(resto))
    )
      return c;
  }
  return null;
}

/** As obras de uma página → linhas de `mercado_obras` (sem as canceladas; projeto e estudo ficam "previstas", só para a equipe). */
export function linhasDoObrasgov(
  obras: readonly ObraFederal[],
  regiaoDe: (cidade: string, bairro: string) => string | null,
  hoje: string,
): LinhaObra[] {
  const out: LinhaObra[] = [];
  const porChave = new Map<string, number>();
  for (const o of obras) {
    if (!o.idUnico) continue;
    const cidade = cidadeDaObra(o);
    if (!cidade) continue;
    const sit = semAcento(o.situacao);
    if (/cancel|inativ/.test(sit)) continue;
    const soProjeto = SO_PROJETO.test(semAcento(o.nome));
    const fase: LinhaObra['fase'] = soProjeto
      ? 'prevista'
      : /conclu/.test(sit)
        ? 'concluida'
        : /execu/.test(sit)
          ? 'em_andamento'
          : /paralis/.test(sit)
            ? 'contratada'
            : 'prevista';
    const txt = semAcento(`${o.nome ?? ''} ${o.descricao ?? ''} ${o.endereco ?? ''}`);
    const bairros =
      cidade === 'Natal'
        ? [...new Set([...txt.matchAll(RE_BAIRRO_NATAL)].map((x) => nomeDoBairro(x[1] ?? '')))]
        : [];
    const bairro = bairros.length === 1 ? (bairros[0] ?? null) : null;
    const valor =
      (o.fontesDeRecurso ?? []).reduce((s, f) => s + (f.valorInvestimentoPrevisto ?? 0), 0) || null;
    const linha: LinhaObra = {
      id_externo: o.idUnico.slice(0, 200),
      url: `${OBRASGOV}?idUnico=${encodeURIComponent(o.idUnico)}`,
      documento: `Obrasgov.br, situação: ${o.situacao ?? '?'}`.slice(0, 300),
      tipo: 'obra_publica',
      fase,
      orgao: 'Governo Federal (Obrasgov.br)',
      objeto: tirarDadoPessoal(String(o.nome ?? o.descricao ?? 'obra'))
        .slice(0, 1000)
        .padEnd(3, '.'),
      local_texto: o.endereco ? tirarDadoPessoal(o.endereco).slice(0, 300) : null,
      bairro,
      cidade,
      regiao_id: bairro ? regiaoDe(cidade, bairro) : null,
      valor,
      publicado_em: (o.dataSituacao ?? '').slice(0, 10) || hoje,
    };
    // #9 da verificação: a mesma obra em duas fichas (mesmo endereço, mesma data de situação e mesmo fim previsto):
    // fica uma só, a que tem início efetivo.
    const chave = `${semAcento(o.endereco)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()}|${o.dataSituacao ?? ''}|${o.dataFinalPrevista ?? ''}`;
    const ja = o.endereco ? porChave.get(chave) : undefined;
    if (ja !== undefined) {
      if (o.dataInicialEfetiva) out[ja] = linha;
      continue;
    }
    if (o.endereco) porChave.set(chave, out.length);
    out.push(linha);
  }
  return out;
}

export const coletorObrasgov: Coletor = {
  chave: 'obras/obrasgov',
  maxPedidosPadrao: 60,
  caminhoDeTeste: '/obrasgov/api/projeto-investimento',
  async coletar(ctx: ContextoDoColetor): Promise<ResultadoDoColetor> {
    const impressao = new Impressao();
    const erros: string[] = [];
    const agora = ctx.agora ?? Date.now;
    const prazo = Math.min(ctx.prazo, agora() + PRAZO_DO_CICLO_MS);
    type Ciclo = {
      inicio: string;
      proxima_pagina: number;
      fechado: boolean;
      fechado_em?: string;
      falhas: Record<string, number>;
      paginas_puladas: number[];
    };
    const antes = (ctx.estadoAnterior.ciclo ?? null) as Ciclo | null;
    // O ciclo inteiro é semanal (auditoria: "1 consulta por segundo; semanal"). A fila chama a cada rodada para
    // CONTINUAR um ciclo aberto; um ciclo fechado há menos de 6 dias não recomeça.
    if (
      antes?.fechado &&
      antes.fechado_em &&
      Date.parse(`${ctx.dia}T12:00:00Z`) - Date.parse(`${antes.fechado_em}T12:00:00Z`) < 6 * 864e5
    ) {
      return {
        completa: true,
        hashBruto: null,
        estado: { ciclo: antes },
        detalhes: {
          aviso: `ciclo fechado em ${antes.fechado_em}: o próximo começa 6 dias depois`,
          pedidos: ctx.navegador.pedidos,
        },
        erros: [],
      };
    }
    const ciclo: Ciclo =
      antes && !antes.fechado
        ? {
            ...antes,
            falhas: { ...(antes.falhas ?? {}) },
            paginas_puladas: [...(antes.paginas_puladas ?? [])],
          }
        : { inicio: ctx.dia, proxima_pagina: 0, fechado: false, falhas: {}, paginas_puladas: [] };
    let n = 0;
    let lidas = 0;
    while (!ciclo.fechado && agora() < prazo && ciclo.proxima_pagina < 300) {
      const pag = ciclo.proxima_pagina;
      const r = await ctx.navegador.json<{ content?: ObraFederal[] }>(
        `${OBRASGOV}?uf=RN&pagina=${pag}&tamanhoDaPagina=50`,
        { tempo: 180_000, tentativas: 1 },
      );
      if (!r) {
        if (ctx.navegador.parada) break;
        // Erro do servidor costuma ser passageiro: a página volta na rodada seguinte; com 3 falhas, é pulada e anotada.
        const k = String(pag);
        ciclo.falhas[k] = (ciclo.falhas[k] ?? 0) + 1;
        if ((ciclo.falhas[k] ?? 0) >= 3) {
          ciclo.paginas_puladas.push(pag);
          ciclo.proxima_pagina = pag + 1;
        }
        erros.push(`página ${pag}: sem resposta`);
        break;
      }
      const conteudo = r.dado.content ?? [];
      impressao.somar(r.resposta.sha256 ?? '');
      lidas += 1;
      const linhas = linhasDoObrasgov(
        conteudo,
        (cidade, bairro) => ctx.regioes.regiaoDe({ cidade, bairro })?.regiao ?? null,
        ctx.dia,
      );
      if (linhas.length > 0) n += await ctx.gravador.obras(linhas);
      ciclo.proxima_pagina = pag + 1;
      if (conteudo.length < 50) {
        ciclo.fechado = true;
        ciclo.fechado_em = ctx.dia;
      }
    }
    return {
      completa: ciclo.fechado && erros.length === 0,
      hashBruto: impressao.fechar(),
      // Ciclo fechado: a próxima rodada começa um ciclo novo (o banco decide quando, pela frequência semanal).
      estado: { ciclo },
      detalhes: {
        paginas_lidas: lidas,
        proxima_pagina: ciclo.proxima_pagina,
        ciclo_fechado: ciclo.fechado,
        gravados: n,
        pedidos: ctx.navegador.pedidos,
        parada: ctx.navegador.parada,
      },
      erros,
    };
  },
};
