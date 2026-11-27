/**
 * As vantagens: os moldes do catálogo (núcleo §2) com os números do motor, e as
 * regras de toda frase. Porte fiel de `montarVantagens` e `checarFrase` de
 * `js/55-argumentos.js` (protótipo, 19/11/2026): mesmos textos-base, mesmos
 * números obrigatórios, mesmos bloqueios, mesmo "Não diga". O teste de ouro
 * compara o dossiê inteiro, imóvel por imóvel.
 */
import { ARG_CADERNO, ARG_LUGAR } from './caderno';
import {
  apos,
  brlCurto,
  dataBR,
  dec,
  fmt,
  fmt1,
  MESES_L,
  mesDe,
  pct,
  semAc,
  semFicha,
  somaDias,
  somaMeses,
  temNum,
} from './estatistica';
import {
  baseG,
  okC,
  type Candidato,
  type FatoDeRegiao,
  type SaidaDoMotor,
  type ValorTotal,
} from './motor';
import { REGRAS_DO_DONO, type RegrasDasVantagens } from './regras-do-dono';
import type { BaseDoMotor, Bloqueio, Dossie, ImovelDoDossie, Validade, Vantagem } from './tipos';

export const VERSAO_DOSSIE = 'argumentos-imovel@3';
/** A versão do motor que vai para `mercado_argumentos_propor` (e para o banco). */
export const VERSAO_DO_MOTOR = 'motor-vantagens-ts@1 (porte de js/55-argumentos.js v3, 19/11/2026)';
/** A ordem do protótipo: os 12 das notas e a loja indisponível. */
export const ORDEM_DO_PROTOTIPO = [
  'TE0006',
  'CA0001',
  'PT0001',
  'TE0001',
  'TE0005',
  'TE0004',
  'CA0003',
  'CA0002',
  'TE0002',
  'TE0003',
  'AP0001',
  'SA0012',
  'LO0001',
];
const RODADA_DO_PROTOTIPO = {
  id: '2026-11-18-prototipo-v3',
  gerado_em: '2026-11-18',
  motor: 'js/55-argumentos.js (porta do motor v3 da bancada, nucleo.mjs)',
};

export const ORDEM_SEGMENTO: Record<string, string[]> = {
  lote_praia_segunda_casa: [
    'documentacao',
    'entorno',
    'fato',
    'tamanho',
    'regiao',
    'raridade',
    'serie',
    'preco',
  ],
  terreno_incorporacao: ['tamanho', 'regiao', 'atributo', 'preco', 'documentacao', 'serie'],
  terreno_residencial_urbano: ['documentacao', 'regiao', 'atributo', 'preco', 'tamanho', 'serie'],
  terreno_comercial: ['fato', 'atributo', 'tamanho', 'regiao', 'raridade', 'preco'],
  casa_popular: ['preco', 'tamanho', 'raridade', 'atributo', 'documentacao', 'regiao', 'serie'],
  apartamento_entrada: ['preco', 'regiao', 'serie'],
  comercial_aluguel_repasse: ['regiao'],
};
const FORCA_N: Record<string, number> = { A: 0, B: 1, C: 2 };
const ONDE_TXT: Record<string, string> = {
  localidade: 'Na localidade',
  regiao: 'Na região',
  anel1: 'Até 3 km',
  anel2: 'Até 6 km',
  macro: 'Na macrorregião',
};
const ORDEM_REGIAO = [
  'C3.nivel_apto',
  'C2.populacao',
  'C2.populacao_municipio',
  'C2.construcao',
  'C1.veraneio',
  'C2.estrangeiros',
  'C2.renda',
  'S1.valorizacao_bairro',
];
export const PREFIXO = 'Não há como garantir valorização.';
export const TITULO_CURTO: Record<string, string> = {
  'T1.area': 'Tamanho do terreno',
  'T1.area_terreno': 'Terreno da casa',
  'R1.vagas': 'Vagas',
  'R1.quartos': 'Quartos',
  'R1.suites': 'Suítes',
  'R1.esquina': 'Esquina',
  'R1.frente_mar': 'Frente-mar',
  'A1.vagas': 'Vagas explicam o preço',
  'D1.escritura': 'Escritura',
  'D1.parque': 'Parque Mata da Pipa',
  'D1.esquina': 'Esquina de duas avenidas',
  'C2.populacao': 'População cresceu',
  'C2.populacao_municipio': 'População do município',
  'C2.construcao': 'Construção no bairro',
  'C2.renda': 'Renda do bairro',
  'C3.nivel_apto': 'm² de apartamento do bairro',
  'C1.veraneio': 'Casas de veraneio',
  'C2.estrangeiros': 'Moradores estrangeiros',
  'S1.natal': 'Índice de Natal',
  'P1.m2': 'Preço do m²',
  'P3.valor_total': 'Valor total',
};
export const MOMENTOS = [
  'apresentacao',
  'interesse',
  'preco',
  'comparacao',
  'antes_convite',
  'retomada',
];
export const OBJECOES = [
  'caro',
  'mais_barato',
  'vou_pensar',
  'regiao',
  'investimento',
  'tamanho',
  'outro_tamanho',
  'documentacao',
  'por_que_esse',
];
export const OBJETIVOS = [
  'morar',
  'quer_construir',
  'uso_comercial',
  'quer_casa_de_praia',
  'vem_de_fora',
  'o_que_tem_em_volta',
  'vagas',
  'esquina',
  'quintal',
];

export const baseNome = (gr: string | null | undefined, plural: boolean): string =>
  (
    ({
      terreno: plural ? 'terrenos' : 'terreno',
      apartamento: plural ? 'apartamentos' : 'apartamento',
      casa: plural ? 'casas' : 'casa',
    }) as Record<string, string>
  )[baseG(gr) as string] || (plural ? 'imóveis' : 'imóvel');
const okRegua = (x: Candidato): boolean =>
  okC(x.classe) || (temNum(x.S) && x.n! >= 20 && x.S >= 0.65);

/* ============ as regras de toda frase (gerar-notas.py, PROIBIDO; produto §5.7) ============ */
export const PROIBIDO: Record<string, RegExp> = {
  futuro:
    /\b(vai|v[aã]o|deve[m]?|tende[m]? a)\b[^.]{0,40}\b(valoriz\w*|subir|render|lucr\w*)|potencial de valoriza|rentabilidade|investimento seguro|acima da infla/i,
  valor:
    /valor de mercado|pre[cç]o justo|abaixo do (valor de )?mercado|avaliad[oa] em|pre[cç]o prov[aá]vel|mais barat[oa] d[aoe] |\bvale (R\$|\d|cerca|mais|menos)|pesa no valor/i,
  urgencia:
    /[uú]ltim[oa]s (unidades|lotes|dias)|\brestam\b|corra|antes que acabe|muita gente|muitos interessados|alta procura|imperd[ií]vel/i,
  superlativo:
    /[uú]nic[oa] (na|no|da|do)\b|o maior d|o melhor|o mais (valorizado|procurado|barato)|\braro\b|dif[ií]cil de achar|nenhum outro|ningu[eé]m tem|todos os outros|mais [aá]rea do que se costuma/i,
  certeza: /\b(pelo menos|no m[ií]nimo|mais de) \d+([.,]\d+)? ?%/i,
  concorrencia: /chaves na m[aã]o|\bzap\b|viva ?real|\bolx\b|deztop|\blopes\b|https?:\/\//i,
  tempo: /\b\d{1,2}\/\d{1,2}\b(?!\/)|[uú]ltimas semanas|(n)?este m[eê]s|atualmente|hoje em dia/i,
  quase: /\bquase \d/i,
  codigo: /\b[A-Z]{2}\d{4}\b/,
  corretor: /corretor/i,
  interno: /diferencia(l|is)|motor|for[cç]a [ABC]|bloquead|mediana|amostra|percentil/i,
  garagem: /garagem/i,
  lugar_falso: /no centro de Extremoz|[aá]rea da BONOR|na vila de Pipa/i,
};

export function checarFrase(v: Vantagem): string[] {
  const t = v.texto_base;
  const e: string[] = [];
  if (t.length > 200) e.push(`${t.length} caracteres (> 200)`);
  if (v.texto_curto && v.texto_curto.length > 120) e.push('texto curto acima de 120');
  for (const [nome, rx] of Object.entries(PROIBIDO))
    if (rx.test(t)) e.push(`padrão proibido "${nome}"`);
  for (const n of v.numeros_obrigatorios || [])
    if (!t.includes(n)) e.push(`número ${n} fora da frase`);
  if (['tamanho', 'raridade', 'preco'].includes(v.familia) && !t.includes('acompanhamos'))
    e.push('frase de anúncio sem "que acompanhamos"');
  const c = v.texto_curto;
  if (c && c !== t) {
    for (const [nome, rx] of Object.entries(PROIBIDO))
      if (rx.test(c)) e.push(`texto curto com o padrão proibido "${nome}"`);
    if (
      ['tamanho', 'raridade', 'preco'].includes(v.familia) &&
      !(c.includes('acompanhamos') && /à venda|anunciad/.test(c))
    )
      e.push('texto curto de anúncio sem "à venda" e "que acompanhamos"');
  }
  if (t.startsWith(PREFIXO)) e.push('o prefixo de investimento vai só em prefixo_obrigatorio');
  if (v.ponte) {
    if (v.ponte.length > 60) e.push('ponte acima de 60 caracteres');
    for (const [nome, rx] of Object.entries(PROIBIDO))
      if (rx.test(v.ponte)) e.push(`ponte com o padrão proibido "${nome}"`);
    if (/\b(mais|menos|poucos|maior|menor)\b/i.test(v.ponte)) e.push('ponte com comparação');
  }
  if (v.id === 'C2.renda' && v.gatilhos.includes('regiao'))
    e.push('renda não pode ter o rótulo "região"');
  if (
    v.familia === 'tamanho' &&
    v.status === 'usar' &&
    v.gatilhos.some((x) => x === 'caro' || x === 'mais_barato') &&
    ((v.rigor?.maiores_e_mais_baratos as unknown[] | undefined) || []).length
  )
    e.push('T19: há parecido maior e mais barato');
  return e;
}

export interface OpcoesDasVantagens {
  /** Os imóveis (ref do caderno), na ordem do dossiê. */
  ordem?: string[];
  /** Até quando vale a vantagem tirada de anúncios (o banco ainda corta em 14 dias). */
  valido_anuncios?: string;
  rodada?: Record<string, unknown>;
  /** As regras do dono (27/11/2026); o teste de ouro passa as do protótipo. */
  regras?: RegrasDasVantagens;
}

export function montarVantagens(
  B: BaseDoMotor,
  M: SaidaDoMotor,
  opcoes: OpcoesDasVantagens = {},
): Dossie {
  const ORDEM_IMOVEIS = opcoes.ordem ?? ORDEM_DO_PROTOTIPO;
  const LIMIAR = (opcoes.regras ?? REGRAS_DO_DONO).limiarPreco;
  const R = M.out;
  const X = R.extras;
  const coleta = B.coleta;
  const mes = mesDe(coleta);
  const ano = coleta.slice(0, 4);
  const mesAno = `${mes} de ${ano}`;
  /* núcleo §1.9: antes de 17/12, quando o anúncio só do levantamento manual deixa de entrar em frase */
  const validoAnuncios = opcoes.valido_anuncios ?? '2026-12-15';
  const VAL_ANUNCIOS: Validade = {
    valido_ate: validoAnuncios,
    vence_com: 'data',
    motivo: 'anúncios só do levantamento manual saem das frases em 17/12/2026',
  };
  const VAL_CENSO: Validade = { valido_ate: somaMeses(coleta, 12), vence_com: 'data' };
  const PROVA_ANUNCIOS = {
    fonte: `Anúncios públicos de venda reunidos pela Imova em ${dataBR(coleta)}, preço pedido`,
    data_dado: coleta,
  };
  const contagemCliente = (desc: string): string =>
    `É uma contagem que a Imova fez em ${mesAno} com anúncios públicos de venda: ${desc}.`;
  const bairroDe = (reg: string): string =>
    (
      ({
        'natal-capim-macio': 'Capim Macio',
        'natal-ponta-negra': 'Ponta Negra',
        'natal-lagoa-nova': 'Lagoa Nova',
        'natal-potengi': 'Potengi',
      }) as Record<string, string>
    )[reg] || String(B.reg.find((r) => r.id === reg)?.nome || reg).split(',')[0]!;
  const comArtigo = (b: string): boolean => /^(potengi|tirol|centro|alecrim)$/i.test(semAc(b));
  const deB = (b: string): string => (comArtigo(b) ? 'do ' : 'de ') + b;
  const emB = (b: string): string => (comArtigo(b) ? 'no ' : 'em ') + b;
  const bloq = (
    o_que: string,
    motivo: string,
    tipo = 'regra',
    extra: Record<string, unknown> = {},
  ): Bloqueio => ({
    o_que,
    tipo,
    motivo,
    ...extra,
  });
  const imoveis: ImovelDoDossie[] = [];
  /* a métrica de cada vantagem de região nas outras regiões (perfis do Censo e alvarás de Natal) */
  const PERF = B.perfis;
  const REGS_P = Object.keys(PERF);
  const alvara = Object.fromEntries(
    Object.entries(B.construcao || {}).map(([k, x]) => [
      semAc(k),
      ['2021', '2022', '2023'].reduce((t, y) => t + (x[`alvara_${y}`]?.unidades || 0), 0),
    ]),
  );
  const bairroNatal = (reg: string): string | null =>
    /^natal-/.test(reg) ? semAc(bairroDe(reg)) : null;
  const aptoDe = (reg: string): number | null => {
    const b = bairroDe(reg);
    const l = (B.corrida?.cidade || []).filter((x) => x.tipo === 'apartamento' && x.amostra >= 30);
    const c = REGS_P.includes(reg) ? String(B.reg.find((x) => x.id === reg)?.cidade || '') : '';
    return (
      l.find((x) => semAc(x.bairro) === semAc(b) && semAc(x.cidade) === semAc(c))?.m2_mediana ??
      null
    );
  };
  const litoralReg = (reg: string): boolean => /pipa|tabatinga|pirangi|cotovelo/.test(reg);
  const areaDiferente = (reg: string): boolean =>
    /bonor/.test(reg) || /BONOR/.test(PERF[reg]?.moradores?.nivel || '');
  const perfilMunicipio = (reg: string): boolean =>
    /^munic/i.test(PERF[reg]?.moradores?.nivel || '');
  type Par = [number, number | null] | null;
  const METRICA: Record<string, (reg: string) => Par> = {
    'C2.renda': (reg) => {
      if (litoralReg(reg) || areaDiferente(reg) || perfilMunicipio(reg)) return null;
      const m = PERF[reg]?.moradores;
      return temNum(m?.renda_media_responsavel)
        ? [
            m.renda_media_responsavel,
            temNum(m.renda_mediana_responsavel) ? m.renda_mediana_responsavel : null,
          ]
        : null;
    },
    'C2.populacao': (reg) => {
      if (areaDiferente(reg)) return null;
      const m = PERF[reg]?.moradores;
      return temNum(m?.crescimento_2010_2022_pct) ? [m.crescimento_2010_2022_pct, null] : null;
    },
    'C2.construcao': (reg) => {
      const b = bairroNatal(reg);
      return b && temNum(alvara[b]) ? [alvara[b], null] : null;
    },
    'C3.nivel_apto': (reg) => {
      const v = aptoDe(reg);
      return temNum(v) ? [v, null] : null;
    },
  };
  const acima = (a: Par, b: Par): boolean =>
    !!a && !!b && a[0] > b[0] && (a[1] == null || b[1] == null || a[1] >= b[1]);
  function superaDe(
    v: Vantagem,
    reg: string,
  ): { topo: boolean; regioes: string[]; bairros: string[] } {
    const f = METRICA[v.id];
    if (!f) return { topo: false, regioes: [], bairros: [] };
    const nos = f(reg);
    if (!nos) return { topo: false, regioes: [], bairros: [] };
    const outras = REGS_P.filter((x) => x !== reg);
    const regioes = outras.filter((x) => acima(nos, f(x)));
    const bairros =
      v.id === 'C2.construcao'
        ? Object.keys(B.construcao || {}).filter(
            (k) => semAc(k) !== bairroNatal(reg) && nos[0] > (alvara[semAc(k)] as number),
          )
        : [];
    return { topo: regioes.length === outras.length, regioes, bairros };
  }

  for (const ref of ORDEM_IMOVEIS) {
    const cad = ARG_CADERNO[ref];
    const fich = B.fichas.find((f) => f.codigo === ref);
    const r = R.imoveis.find((x) => x.ref === ref);
    const cand = (id: string): Candidato | undefined => r?.candidatos.find((x) => x.id === id);
    const pr = (B.procura?.por_imovel || []).find((x) => x.codigo_carteira === ref);
    const im: ImovelDoDossie = {
      ref,
      titulo_para_ia: cad?.titulo_para_ia || fich?.titulo,
      regiao: r?.regiao || fich?.regiao || null,
      disponivel: fich?.disponivel !== false && !!r,
      segmento: cad?.segmento || null,
      procura_conversas: pr ? [pr.conversas_min, pr.conversas_max] : null,
      ponto_apresentacao: semFicha(cad?.ponto_apresentacao) || null,
      ...(cad?.ponto_usa ? { ponto_usa: { ...cad.ponto_usa } } : {}),
      retomada: [],
      retomada_v2: [],
      nao_diga: [...(cad?.nao_diga || [])],
      bloqueadas: [],
      avisos_equipe: [...(cad?.avisos_equipe || [])],
      avisos_imovel: [...(cad?.avisos_imovel || [])],
      vantagens: [],
      propostas: [],
    };
    if (cad?.travas_objecao) im.travas_objecao = JSON.parse(JSON.stringify(cad.travas_objecao));
    if (!im.disponivel || !r) {
      im.bloqueadas.push(
        bloq('Tudo', `${cad?.ficha || 'FICHA 7'}: não está mais disponível.`, 'indisponivel'),
      );
      imoveis.push(im);
      continue;
    }
    if (r.preco.conferir?.some((s) => /possível o mesmo/.test(s))) im.possivel_mesmo_imovel = true;
    /* uma regra só para o possível duplicado: em "achei mais barato" a IA passa a conversa, sem argumento */
    if (im.possivel_mesmo_imovel && !im.travas_objecao?.mais_barato)
      im.travas_objecao = {
        ...(im.travas_objecao || {}),
        mais_barato: {
          regra: 'possível o mesmo imóvel',
          o_que_fazer:
            'Pode ser o mesmo imóvel anunciado por outro preço: diga que vai verificar e passe, sem argumento.',
        },
      };
    const gat = (id: string, padrao: string[]): string[] => [
      ...((cad?.gatilhos || {})[id] || padrao),
    ];
    const comercial = !!cad?.comercial;
    const V = im.vantagens;
    const imDaBase = B.ims.find((x) => x.codigo === r.codigo);

    /* preço (P1): vantagem só quando o nosso ganha; senão, o bloqueio com o número */
    const ve = (r.preco.veredito || {}) as Record<string, unknown>;
    const esc = r.preco.aneis?.find((a) => a.anel === r.preco.anel);
    if (r.preco.vantagem && r.preco.vantagem.status === 'usar') {
      const v = r.preco.vantagem;
      V.push({
        id: 'P1.m2',
        regra: 'P1',
        familia: 'preco',
        nivel: 'preco',
        eixo: r.preco.anel ? 'mesmo_tipo_regioes_vizinhas' : 'mesma_regiao_mesmo_tipo',
        forca: v.forca,
        status: 'usar',
        texto_base: `Dos ${v.n} ${baseNome(r.grupo, true)} de tamanho parecido à venda que acompanhamos em ${mes}, ${v.kBom} pedem mais pelo m².`,
        gatilhos: ['caro', 'mais_barato', 'comparacao'],
        so_com_preco_dito: true,
        explica_preco: true,
        numeros_obrigatorios: [String(v.n), String(v.kBom)],
        comparacao: {
          nosso: r.m2,
          referencia: v.med,
          medida: 'mediana_m2',
          n: v.n,
          conjunto: esc?.nome,
        },
        prova: {
          ...PROVA_ANUNCIOS,
          regra: `P1: ${v.kBom} de ${v.n} pedem mais; teste do sinal p = ${v.pSinal.toPrecision(2)}`,
        },
        prova_cliente: contagemCliente(`${v.n} ${baseNome(r.grupo, true)} de tamanho parecido`),
        validade: VAL_ANUNCIOS,
      });
    } else if (r.preco.vantagem && r.preco.vantagem.status === 'conferir') {
      im.bloqueadas.push(
        bloq(
          'P1 preço do m²',
          `R$ ${fmt(Math.round(r.m2!))}/m² contra mediana de R$ ${fmt(Math.round(esc!.med_cru!))} dos ${esc!.n} parecidos (${esc!.kBom} pedem mais; ${pct(esc!.dif_cru)} cru, ${pct(esc!.dif_hom)} homogeneizado), mas ${r.preco.conferir!.join('; ')}.`,
          'conferir',
          { numero: pct(esc!.dif_cru), id: 'P1.m2', forca_se: r.preco.vantagem.forca },
        ),
      );
    } else if (ve.rotulo === 'sem comparação') {
      im.bloqueadas.push(bloq('Preço (P1)', `Sem comparação: ${String(ve.motivo)}.`, 'regra'));
    } else if (r.preco.bloqueio) {
      const desf = temNum(ve.dif_cru) && ve.dif_cru > 0;
      im.bloqueadas.push(
        bloq(
          'P1 preço do m²',
          `R$ ${fmt(Math.round(r.m2!))}/m² contra mediana de R$ ${fmt(Math.round(esc!.med_cru!))} dos ${esc!.n} parecidos (${esc!.nome}): ${pct(esc!.dif_cru)} cru, ${pct(esc!.dif_hom)} homogeneizado; ${esc!.kBom} de ${esc!.n} pedem mais. Veredito interno: ${String(ve.rotulo)}. Não passa: ${r.preco.bloqueio.join('; ')}.`,
          'regra',
          {
            numero: pct(esc!.dif_cru),
            desfavoravel: desf,
            dif: esc!.dif_cru,
            ...(desf
              ? {
                  fato: `O m² pedido fica ${Math.abs(Math.round(esc!.dif_cru! * 100))}% acima do meio dos ${esc!.n} parecidos.`,
                }
              : {}),
          },
        ),
      );
      const pm = (r.preco.conferir || []).filter((s) => /possível o mesmo/.test(s));
      if (pm.length)
        im.bloqueadas.push(
          bloq('P1 (conferir)', `${pm.join('; ').replace(/^possível/, 'Possível')}.`, 'conferir'),
        );
    }

    /* tamanho do terreno (T1) */
    const t1 = cand('T1.area');
    if (t1) {
      const conj = t1.conjuntos!;
      const ti = t1.escolhido! >= 0 ? conj[t1.escolhido!]! : null;
      const listaMmb = (l: string[]): string =>
        l
          .map((s) =>
            s.replace(
              /(\d+) m² por R\$ (\d+)/,
              (_, a: string, p: string) => `${fmt(+a)} m² por ${brlCurto(+p)}`,
            ),
          )
          .join('; ');
      if (t1.status === 'usar' && ti) {
        const nome = ti.nome!.texto + (/, fora /.test(ti.nome!.texto) ? ',' : '');
        const so = t1.forca === 'A' && ti.iguais_ou_maiores! <= Math.round(ti.n! * 0.15);
        const area = fmt(r.area);
        const texto = so
          ? `Dos ${ti.n} terrenos fora de condomínio à venda ${nome} que acompanhamos em ${mes}, só ${ti.iguais_ou_maiores} chegavam a ${area} m².`
          : `Dos ${ti.n} terrenos fora de condomínio à venda ${nome} que acompanhamos em ${mes}, ${ti.menores} tinham menos de ${area} m².`;
        /* curto: o mesmo universo da frase ("à venda" e "que acompanhamos") */
        const curto = so
          ? `E só ${ti.iguais_ou_maiores} dos ${ti.n} terrenos à venda na região que acompanhamos chegavam a ${area} m².`
          : `E ${ti.menores} dos ${ti.n} terrenos à venda na região que acompanhamos tinham menos de ${area} m².`;
        const t19ok = !ti.maiores_e_mais_baratos!.length;
        const gts = [
          'interesse',
          'tamanho',
          'por_que_esse',
          'comparacao',
          ...(t19ok ? ['caro', 'mais_barato'] : []),
          ...(t1.comercial_grande ? ['antes_convite'] : []),
          'retomada',
        ];
        const anelNome = (
          {
            localidade: 'a localidade',
            regiao: 'a região',
            anel1: 'região e vizinhas até 3 km',
            anel2: 'região e vizinhas até 6 km',
            macro: 'a macrorregião',
          } as Record<string, string>
        )[ti.onde_tipo!];
        const antes = conj.slice(0, t1.escolhido).filter((x) => x.falhas?.length);
        V.push({
          id: 'T1.area',
          regra: 'T1',
          familia: 'tamanho',
          nivel: 'imovel',
          eixo: (
            {
              localidade: 'mesma_regiao_mesmo_tipo',
              regiao: 'mesma_regiao_mesmo_tipo',
              anel1: 'mesmo_tipo_regioes_vizinhas',
              anel2: 'mesmo_tipo_regioes_vizinhas',
              macro: 'mesmo_tipo_macrorregiao',
            } as Record<string, string>
          )[ti.onde_tipo!]!,
          forca: t1.forca!,
          status: 'usar',
          texto_base: texto,
          texto_curto: curto,
          ponte: /lote/i.test(cad?.ponto_apresentacao || '')
            ? `São ${area} m².`
            : `São ${area} m² num terreno só.`,
          gatilhos: gts,
          so_com_preco_dito: false,
          explica_preco: false,
          numeros_obrigatorios: so
            ? [String(ti.n), String(ti.iguais_ou_maiores), area]
            : [String(ti.n), String(ti.menores), area],
          comparacao: {
            nosso: r.area,
            referencia: ti.med,
            medida: 'mediana_area',
            n: ti.n,
            conjunto: `terrenos avulsos à venda ${ti.nome!.texto} (${anelNome}), sem condomínio e sem repetidos`,
          },
          rigor: {
            menores: ti.menores,
            S: +ti.S!.toFixed(3),
            wilson95: ti.wilson95!.map((x) => +x!.toFixed(3)),
            p_sinal: +ti.p!.toPrecision(3),
            bh_passa: ti.bh !== false,
            manuais: ti.manuais,
            sem_manuais: ti.sem_manuais,
            porte: ti.porte,
            falhas: ti.falhas,
            maiores_e_mais_baratos: ti.maiores_e_mais_baratos,
            absurdos: ti.absurdos,
            nome_do_lugar: ti.nome?.regra,
          },
          prova: {
            ...PROVA_ANUNCIOS,
            regra: `característica: n ≥ 20, régua ${ti.classe}, sem os manuais ${ti.sem_manuais!.classe}${ti.porte ? `, dentro do porte (${fmt(ti.porte.limiar)} m² ou mais) ${ti.porte.classe}` : ''} → força ${t1.forca}${antes.length ? `; ${antes.map((x) => `${x.onde_tipo === 'regiao' ? 'o bairro sozinho' : x.onde_tipo} falha (${x.falhas!.join('; ')})`).join('; ')}` : ''}`,
          },
          prova_cliente: contagemCliente(`${ti.n} terrenos fora de condomínio ${ti.nome!.texto}`),
          validade: VAL_ANUNCIOS,
          ...(cad?.aviso_vantagem?.['T1.area']
            ? { aviso_obrigatorio: cad.aviso_vantagem['T1.area'] }
            : {}),
        });
        for (const x of antes)
          im.bloqueadas.push(
            bloq(
              `T1 tamanho ${x.onde_tipo === 'regiao' ? 'só no bairro' : `só ${x.nome?.texto || x.onde_tipo}`}`,
              `${x.n} terrenos ${x.nome?.texto || ''}: ${x.falhas!.join('; ')}. O motor passou para ${anelNome}.`,
              'regra',
              { sensibilidade: true },
            ),
          );
        if (!t19ok)
          im.bloqueadas.push(
            bloq(
              'T1 tamanho em "caro" e "achei mais barato" (T19)',
              `${ti.maiores_e_mais_baratos!.length} ${ti.maiores_e_mais_baratos!.length === 1 ? 'terreno à venda na região, maior ou igual, pede' : 'terrenos à venda na região, maiores ou iguais, pedem'} menos no total: ${listaMmb(ti.maiores_e_mais_baratos!)}.`,
              'regra',
            ),
          );
      } else {
        const reg0 = conj.find((x) => x.onde_tipo === 'regiao') || conj[0];
        const indicio = !!reg0 && okRegua(reg0);
        const partes = conj
          .filter((x) => x.n)
          .map(
            (x) =>
              `${ONDE_TXT[x.onde_tipo!] || x.onde_tipo} (${x.n}): ${x.falhas?.length ? x.falhas.join('; ') : `${x.menores} de ${x.n} menores`}`,
          );
        const maior = conj.filter((x) => x.n! >= 10 && temNum(x.menores)).at(-1);
        const ondeF = (x: Candidato): string =>
          x.nome?.texto && x.nome.texto !== 'na região' && x.nome.texto.length <= 28
            ? x.nome.texto
            : (
                {
                  localidade: 'na localidade',
                  regiao: 'na região',
                  anel1: 'na região e vizinhas (até 3 km)',
                  anel2: 'na região e vizinhas (até 6 km)',
                  macro: 'na macrorregião',
                } as Record<string, string>
              )[x.onde_tipo!] || 'na região';
        const fatoT = maior
          ? `Tamanho comum: ${maior.menores} de ${maior.n} terrenos à venda ${ondeF(maior)} são menores.`
          : 'Poucos terrenos à venda na região para comparar o tamanho.';
        im.bloqueadas.push(
          bloq(
            `T1 tamanho${indicio ? ' (só na tela, como indício)' : ''}`,
            `${partes.join(' · ')}${t1.trava_uso ? `. E ${t1.trava_uso}` : ''}.`,
            'regra',
            {
              indicio,
              sensibilidade: true,
              desfavoravel: !indicio,
              ...(!indicio ? { fato: fatoT } : {}),
            },
          ),
        );
      }
    }
    /* características da casa e do apartamento (R1 número) */
    for (const f of ['vagas', 'quartos', 'suites']) {
      const c = cand(`R1.${f}`);
      if (!c) continue;
      const okv = c.forca && f === 'vagas';
      if (okv) {
        const vals = Object.keys(c.dist!)
          .map(Number)
          .sort((a, b) => a - b);
        const max = Math.max(...vals);
        const todas = c.menores === c.n;
        const lista = vals.length === 2 ? `${vals[0]} ou ${vals[1]}` : vals.join(', ');
        const tipo = baseNome(r.grupo, true);
        const faixa = c.faixa ? ` de ${c.faixa}` : '';
        const texto = todas
          ? `Das ${c.n} ${tipo}${faixa} à venda ${c.onde} que acompanhamos em ${mes} e informam as vagas, todas tinham ${lista}.`
          : `Das ${c.n} ${tipo}${faixa} à venda ${c.onde} que acompanhamos em ${mes} e informam as vagas, ${c.menores} tinham menos de ${c.nosso}.`;
        V.push({
          id: 'R1.vagas',
          regra: 'R1',
          familia: 'raridade',
          nivel: 'imovel',
          eixo: 'mesma_regiao_mesmo_tipo',
          forca: c.forca!,
          status: 'usar',
          texto_base: texto,
          texto_curto: todas
            ? `E das ${c.n} ${tipo} parecidas à venda que acompanhamos, todas tinham até ${max} vagas.`
            : `E ${c.menores} das ${c.n} ${tipo} parecidas à venda que acompanhamos tinham menos de ${c.nosso} vagas.`,
          ponte: `São ${c.nosso} vagas.`,
          gatilhos: ['vagas', 'retomada'],
          so_com_preco_dito: false,
          explica_preco: false,
          numeros_obrigatorios: todas
            ? [String(c.n), ...vals.map(String)]
            : [String(c.n), String(c.menores), String(c.nosso)],
          comparacao: {
            nosso: c.nosso,
            referencia: c.med,
            medida: 'mediana_vagas',
            n: c.n,
            conjunto: `${tipo} de ${c.faixa || 'todos os tamanhos'} ${c.onde} que informam vagas (${c.informam} de ${c.de}), sem repetidos`,
          },
          rigor: {
            menores: c.menores,
            S: +c.S!.toFixed(3),
            wilson95: c.wilson95!.map((x) => +x!.toFixed(3)),
            p_sinal: +c.p!.toPrecision(3),
            bh_passa: c.bh !== false,
            manuais: c.manuais,
            dist: c.dist,
            sem_manuais: c.sem_manuais,
            nome_do_lugar: c.nome?.regra,
            adjetivo: "nenhum ('raro' pede n ≥ 30 e campo estruturado)",
          },
          prova: {
            ...PROVA_ANUNCIOS,
            regra: `característica: ${c.informam} de ${c.de} informam (${Math.round(c.share_informam! * 100)}%), S = ${fmt(+c.S!.toFixed(2))}, força ${c.forca}${c.manuais ? `; ${c.manuais} manuais` : '; sem anúncios manuais'}`,
          },
          prova_cliente: contagemCliente(
            `${c.n} ${tipo}${faixa} ${c.onde!.replace(/^(em|no|na) /, 'em ')} que informam as vagas`,
          ),
          validade: VAL_ANUNCIOS,
        });
      } else {
        const motivo = c.falhas?.length ? c.falhas.join('; ') : String(c.classe);
        const [sg, pl] = (
          {
            vagas: ['vaga', 'vagas'],
            quartos: ['quarto', 'quartos'],
            suites: ['suíte', 'suítes'],
          } as Record<string, [string, string]>
        )[f]!;
        const fem = baseG(r.grupo) === 'casa';
        const tipoP = `${baseNome(r.grupo, true)} ${fem ? 'parecidas' : 'parecidos'}`;
        const k0 = c.menores ?? 0;
        const fatoR =
          c.n! < 10
            ? `Só ${c.n} ${tipoP} ${c.n === 1 ? 'informa' : 'informam'} ${pl}, amostra pequena para comparar.`
            : `Com ${c.nosso} ${c.nosso === 1 ? sg : pl}, ${k0 === 0 ? `${fem ? 'nenhuma' : 'nenhum'} ${fem ? 'das' : 'dos'} ${c.n} ${tipoP} tem menos` : `só ${k0} de ${c.n} ${tipoP} ${k0 === 1 ? 'tem' : 'têm'} menos`}.`;
        im.bloqueadas.push(
          bloq(
            `R1 ${pl}`,
            `${c.nosso} ${c.nosso === 1 ? sg : pl}: ${c.menores ?? 0} de ${c.n} ${baseNome(r.grupo, true)} ${baseG(r.grupo) === 'casa' ? 'parecidas' : 'parecidos'} têm menos (${motivo}).`,
            'regra',
            { desfavoravel: temNum(c.S) && c.S < 0.5, fato: fatoR },
          ),
        );
      }
    }
    /* terreno da casa (T1 área total) */
    const tt = cand('T1.area_terreno');
    if (tt) {
      if (tt.forca) {
        const lim = Math.floor(tt.limiar_empate!);
        const tipo = baseNome(r.grupo, true);
        V.push({
          id: 'T1.area_terreno',
          regra: 'T1',
          familia: 'tamanho',
          nivel: 'imovel',
          eixo: 'mesma_regiao_mesmo_tipo',
          forca: tt.forca === 'A' && !temNum(r.area) ? 'B' : tt.forca,
          status: 'usar',
          texto_base: `O terreno tem ${fmt(tt.nosso)} m²: das ${tt.n} ${tipo}${tt.faixa ? ` de ${tt.faixa}` : ''} à venda ${tt.onde} que informam esse dado, ${tt.menores} tinham menos de ${fmt(lim)} m².`,
          gatilhos: ['interesse', 'tamanho', 'quintal', 'retomada'],
          so_com_preco_dito: false,
          explica_preco: false,
          numeros_obrigatorios: [fmt(tt.nosso), String(tt.n), String(tt.menores)],
          comparacao: {
            nosso: tt.nosso,
            referencia: tt.med,
            medida: 'mediana_area_total',
            n: tt.n,
          },
          prova: {
            ...PROVA_ANUNCIOS,
            regra:
              'característica: área total válida (≥ 1,2 × a construída), 60% informam, empate de 15%',
          },
          prova_cliente: contagemCliente(`${tt.n} ${tipo} que informam a área do terreno`),
          validade: VAL_ANUNCIOS,
        });
      } else {
        const indicio = temNum(tt.S) && tt.n! >= 10 && tt.S >= 0.65;
        im.bloqueadas.push(
          bloq(
            `T1 área ${temNum(r.area) ? 'do terreno' : 'total'} de ${fmt(tt.nosso)} m²${indicio ? ' (só na tela, como indício)' : ''}`,
            `${tt.falhas!.join('; ')}; com empate de 15% (menos de ${fmt(tt.limiar_empate)} m²), ${tt.menores ?? 0} de ${tt.n ?? 0}${tt.proprio_tirado?.length ? `. Saiu como possível o próprio imóvel: ${tt.proprio_tirado.map((s) => s.split(':')[0]).join('; ')}` : ''}${tt.maiores_e_mais_baratos?.length ? `. Maior e mais barato: ${tt.maiores_e_mais_baratos.join('; ')}` : ''}.`,
            'regra',
            { indicio, sensibilidade: true },
          ),
        );
      }
    }
    /* contagens de atributo da ficha (R1 esquina, frente-mar) */
    for (const f of ['esquina', 'frente_mar']) {
      const c = cand(`R1.${f}`);
      if (!c) continue;
      const nomeF = f === 'esquina' ? 'de esquina' : 'de frente para o mar';
      if (okC(c.classe)) {
        V.push({
          id: `R1.${f}`,
          regra: 'R1',
          familia: 'raridade',
          nivel: 'imovel',
          eixo: 'mesma_regiao_mesmo_tipo',
          forca: c.classe!,
          status: 'usar',
          texto_base: `Dos ${c.n} terrenos à venda ${c.onde} que acompanhamos em ${mes}, só ${c.k} se anuncia${c.k === 1 ? '' : 'm'} ${nomeF}.`,
          gatilhos: [f === 'esquina' ? 'esquina' : 'por_que_esse', 'comparacao'],
          so_com_preco_dito: false,
          explica_preco: false,
          numeros_obrigatorios: [String(c.n), String(c.k)],
          comparacao: { nosso: true, referencia: c.share, medida: 'contagem', n: c.n },
          prova: { ...PROVA_ANUNCIOS, regra: 'contagem de atributo do título: teto B' },
          prova_cliente: contagemCliente(`${c.n} terrenos ${c.onde}`),
          validade: VAL_ANUNCIOS,
        });
      } else
        im.bloqueadas.push(
          bloq(
            `R1 contagem ${f === 'esquina' ? 'de esquina' : 'de frente-mar'}`,
            `${c.k} de ${c.n} terrenos ${c.onde} se anunciam ${nomeF}, mas ${c.classe}.`,
            'regra',
          ),
        );
    }
    /* atributo que soma valor (A1) */
    for (const c of r.candidatos.filter((x) => /^A1\./.test(x.id || ''))) {
      const at = c.id!.slice(3);
      if (okC(c.classe)) {
        const comNum = Math.min(c.lo!, c.boot_regiao_lo ?? c.lo!) >= 0.1;
        const vagasIm = imDaBase?.vagas;
        const nomeAt =
          at === 'vagas'
            ? `as ${vagasIm} vagas`
            : (
                {
                  frente_mar: 'a frente para o mar',
                  esquina: 'a esquina',
                  condominio_fechado: 'o condomínio fechado',
                  quartos: 'os quartos',
                } as Record<string, string>
              )[at] || at;
        const texto =
          at === 'vagas'
            ? `Um ponto a considerar são ${nomeAt}: nos anúncios de ${baseNome(r.grupo, true)} que analisamos, mais vagas costumam vir com preço pedido maior por m².`
            : `Um ponto a considerar é ${nomeAt}: nos anúncios de ${baseNome(r.grupo, true)} que analisamos, ${nomeAt.replace(/^(a|o|os|as) /, '')} costuma vir com preço pedido maior por m².`;
        /* vagas em casa: a prova e o número da tela são os da regressão só de casas de rua (núcleo §3.3) */
        const sub = at === 'vagas' && baseG(r.grupo) === 'casa' ? X.a1_vagas_casas : null;
        const pc1 = (x: number): string => `${x >= 0 ? '+' : '−'}${fmt1(Math.abs(x) * 100)}%`;
        V.push({
          id: c.id!,
          regra: 'A1',
          familia: 'atributo',
          nivel: 'imovel',
          eixo: 'mesma_regiao_mesmo_tipo',
          forca: c.classe!,
          status: 'usar',
          texto_base: texto,
          texto_curto: texto.replace(/^Um ponto a considerar (são|é) /, 'E '),
          gatilhos: ['caro'],
          so_com_preco_dito: true,
          explica_preco: true,
          numeros_obrigatorios: at === 'vagas' ? [String(vagasIm)] : [],
          comparacao: {
            nosso: (imDaBase ? (imDaBase as Record<string, unknown>)[at] : undefined) ?? true,
            referencia: null,
            medida: 'efeito_modelo',
            n: sub ? sub.n : c.n_com,
            conjunto: sub
              ? 'casas de rua à venda que informam as vagas (regressão só de casas)'
              : 'anúncios do modelo de preço que informam o campo',
          },
          rigor: {
            efeito: +(sub ? sub.efeito : c.efeito!).toFixed(3),
            ic95: sub
              ? [+sub.lo.toFixed(3), +sub.hi.toFixed(3)]
              : [+c.lo!.toFixed(3), +c.hi!.toFixed(3)],
            ...(sub
              ? {
                  regressao: sub.modelo,
                  modelo_conjunto: {
                    efeito: +c.efeito!.toFixed(3),
                    ic95: [+c.lo!.toFixed(3), +c.hi!.toFixed(3)],
                    n_com: c.n_com,
                  },
                }
              : {}),
            bootstrap_regiao_lo: c.boot_regiao_lo,
            coerencia: `homogeneizado, o nosso fica ${pct(c.dif_hom)} dos parecidos`,
            numero_dito: comNum
              ? 'pode citar'
              : `nenhum: a ponta mais cautelosa (${fmt1((c.boot_regiao_lo ?? c.lo!) * 100)}%) fica abaixo de 10%`,
          },
          prova: {
            fonte: `Modelo de preço da Imova com os anúncios de ${sub ? 'casas de ' : ''}${dataBR(coleta)}`,
            data_dado: coleta,
            regra: sub
              ? `A1: 4 testes, coerente (homogeneizado, ${pct(c.dif_hom)}); só casas de rua: ${pc1(sub.efeito)} no m² por vaga (IC ${pc1(sub.lo)} a ${pc1(sub.hi)}, ${fmt(sub.n)} casas); o modelo conjunto de casas e apartamentos dá ${pct(c.efeito)} (${fmt(c.n_com)} anúncios informam o campo); a frase ${comNum ? 'pode citar a porcentagem' : 'não cita porcentagem'}`
              : `A1: 4 testes, ${fmt(c.n_com)} anúncios que informam o campo, coerente (homogeneizado, ${pct(c.dif_hom)}); efeito do modelo ${pct(c.efeito)} (margem ${pct(c.lo)} a ${pct(c.hi)}); a frase ${comNum ? 'pode citar a porcentagem' : 'não cita porcentagem'}`,
          },
          prova_cliente: `É uma análise que a Imova fez em ${mesAno} com os anúncios públicos de ${baseNome(r.grupo, true)}: ${at === 'vagas' ? 'mais vagas, em média, vêm com preço pedido maior por m²' : 'o atributo, em média, vem com preço pedido maior por m²'}.`,
          validade: { valido_ate: validoAnuncios, vence_com: 'data' },
        });
      } else
        im.bloqueadas.push(
          bloq(
            `A1 ${at.replace('_', ' ')}`,
            `Efeito do modelo ${pct(c.efeito)} (${pct(c.lo)} a ${pct(c.hi)}): ${c.bloqueio!.join('; ')}.`,
            'regra',
          ),
        );
    }
    /* fatos da ficha (D1): nunca comparados */
    for (const fx of cad?.fatos || []) {
      if (fx.campo && fich?.atributos?.[fx.campo] !== true) {
        im.bloqueadas.push(
          bloq(fx.id, `A ficha não confirma ${fx.campo.replace('_', ' ')}.`, 'regra'),
        );
        continue;
      }
      V.push({
        id: fx.id,
        regra: 'D1',
        familia: fx.familia,
        nivel: 'imovel',
        eixo: 'fato_da_ficha',
        forca: 'B',
        status: 'usar',
        texto_base: fx.texto,
        ...(fx.texto_curto ? { texto_curto: fx.texto_curto } : {}),
        gatilhos: [...fx.gatilhos],
        so_com_preco_dito: false,
        explica_preco: false,
        numeros_obrigatorios: [...(fx.numeros || [])],
        prova: { ...fx.prova },
        prova_cliente: fx.prova_cliente,
        validade: { valido_ate: null, vence_com: fx.vence_com || 'ficha' },
        ...(fx.aviso_obrigatorio ? { aviso_obrigatorio: fx.aviso_obrigatorio } : {}),
        _retomada: !!fx.retomada,
      });
    }
    /* a região contra as outras (C1, C2, C3) */
    const bairro = bairroDe(r.regiao);
    const lugar = ARG_LUGAR[r.regiao] || {};
    const fzU = (B.fipe_natal || []).find((s) => s.id === 'fipezap-natal-var12')?.ultimos?.at(-1);
    const mesFipe = fzU ? `${MESES_L[+fzU[0].slice(5, 7) - 1]} de ${fzU[0].slice(0, 4)}` : '';
    const nSetores = (String(B.perfis[r.regiao]?.moradores?.nivel || '').match(/(\d+) setores/) ||
      [])[1];
    const fatos: FatoDeRegiao[] = [...r.regiao_fatos];
    /* estrangeiros: perfil, só quando o perfil traz o dado do município */
    const est = B.perfis[r.regiao]?.moradores?.estrangeiros_residentes_municipio;
    if (est && temNum(est.pct_populacao) && temNum(est.natal_pct_para_comparar))
      fatos.push({
        id: 'C2.estrangeiros',
        nosso: est.pct_populacao,
        ref: est.natal_pct_para_comparar,
        forca: est.pct_populacao >= 10 * est.natal_pct_para_comparar ? 'C' : null,
        mun: B.perfis[r.regiao]?.moradores?.municipio?.nome || '',
      });
    fatos.sort(
      (a, b) => (ORDEM_REGIAO.indexOf(a.id) + 1 || 99) - (ORDEM_REGIAO.indexOf(b.id) + 1 || 99),
    );
    for (const f of fatos) {
      const fora = (cad?.fora || {})[f.id];
      /* "proposta": passa na regra e espera o "pode" do dono (fica fora da IA); "regra": fica só o bloqueio */
      let destino = V;
      if (fora && f.forca) {
        im.bloqueadas.push(bloq(TITULO_CURTO[f.id] || f.id, fora[1], fora[0]));
        if (fora[0] !== 'proposta') continue;
        destino = im.propostas;
      }
      const nosso = f.nosso as number;
      if (f.id === 'C2.renda') {
        if (f.forca) {
          const dobro = f.razao_media! >= 2;
          const texto = dobro
            ? `Pelo Censo 2022, quem chefia a casa em ${bairro} ganha em média R$ ${fmt(Math.floor(nosso))}, mais que o dobro da média de ${f.mun}.`
            : `Pelo Censo 2022, quem chefia a casa em ${bairro} ganha em média R$ ${fmt(Math.floor(nosso))}, acima da média de ${f.mun}, de R$ ${fmt(Math.ceil(f.ref!))}.`;
          destino.push({
            id: 'C2.renda',
            regra: 'C2',
            familia: 'regiao',
            nivel: 'regiao',
            eixo: 'regiao_vs_outras',
            forca: f.forca,
            status: 'usar',
            texto_base: texto,
            gatilhos: gat(
              'C2.renda',
              comercial ? ['uso_comercial', 'comparacao_bairro'] : ['comparacao_bairro'],
            ),
            so_com_preco_dito: false,
            explica_preco: false,
            numeros_obrigatorios: dobro
              ? [fmt(Math.floor(nosso))]
              : [fmt(Math.floor(nosso)), fmt(Math.ceil(f.ref!))],
            comparacao: {
              nosso,
              referencia: f.ref,
              medida: 'renda_media_responsavel',
              n: null,
              conjunto: 'bairro × município',
            },
            prova: {
              fonte: 'IBGE, Censo 2022',
              data_dado: '2022-08-01',
              regra: `média ${fmt(+f.razao_media!.toFixed(2))}× e mediana ${f.razao_mediana != null ? `${fmt(+f.razao_mediana.toFixed(2))}×` : 'sem dado'} a do município (≥ 1,2× nas duas: B; teto B para renda)`,
            },
            prova_cliente: 'É do Censo 2022 do IBGE, pelos dados do bairro.',
            validade: VAL_CENSO,
          });
        } else {
          const b0 = f.bloqueio!;
          im.bloqueadas.push(
            bloq(
              'C2 renda',
              `${b0[0]!.toUpperCase() + b0.slice(1)}: R$ ${fmt(nosso)} contra R$ ${fmt(f.ref)} de ${f.mun} (${dec(f.razao_media)}×).`,
              'regra',
              {
                desfavoravel: f.razao_media! < 1,
                ...(f.razao_media! < 1
                  ? {
                      fato: `Renda média de R$ ${fmt(Math.round(nosso))} ${emB(bairro)}, abaixo da de ${f.mun} (R$ ${fmt(Math.round(f.ref!))}).`,
                    }
                  : {}),
              },
            ),
          );
        }
      } else if (f.id === 'C2.populacao') {
        if (f.forca) {
          const dobrou = nosso >= 100;
          const muni = f.nivel_area === 'municipio';
          const onde = muni ? f.mun : bairro;
          const texto = `Pelo Censo do IBGE, a população de ${onde} ${dobrou ? 'mais que dobrou' : `cresceu ${Math.trunc(nosso)}%`} entre 2010 e 2022${!muni && temNum(f.ref) && f.ref < 0 ? `, enquanto a de ${f.mun} diminuiu` : ''}.`;
          destino.push({
            id: 'C2.populacao',
            regra: 'C2',
            familia: 'regiao',
            nivel: 'regiao',
            eixo: 'regiao_vs_outras',
            forca: f.forca,
            status: 'usar',
            texto_base: texto,
            gatilhos: gat('C2.populacao', ['regiao', 'investimento']),
            so_com_preco_dito: false,
            explica_preco: false,
            numeros_obrigatorios: dobrou
              ? ['2010', '2022']
              : [`${Math.trunc(nosso)}%`, '2010', '2022'],
            comparacao: muni
              ? {
                  nosso,
                  referencia: f.med_outros,
                  medida: 'crescimento',
                  n: f.n_outros,
                  conjunto: `outros ${f.n_outros} municípios da base`,
                }
              : {
                  nosso,
                  referencia: f.ref,
                  medida: 'crescimento_pp',
                  n: null,
                  conjunto: `bairro oficial × município de ${f.mun}`,
                },
            prova: muni
              ? {
                  fonte: 'IBGE, Censo 2022 (município)',
                  data_dado: '2022-08-01',
                  regra: `${fmt1(nosso - f.med_outros!)} pontos sobre a mediana dos outros ${f.n_outros} municípios (teto B: 4 a 6 para comparar)`,
                }
              : {
                  fonte: 'IBGE, Censo 2022 (agregados por bairro)',
                  data_dado: '2022-08-01',
                  regra: `bairro oficial; 10 pontos ou mais acima do município (B), 20 ou mais (A): ${fmt1(nosso - f.ref!)} pontos`,
                },
            prova_cliente: muni
              ? `É do Censo 2022 do IBGE, pelos dados do município de ${f.mun}.`
              : 'É do Censo 2022 do IBGE, pelos dados do bairro.',
            validade: VAL_CENSO,
          });
        } else {
          const verbo = (x: number): string =>
            x < 0 ? `caiu ${fmt1(-x)}%` : `cresceu ${fmt1(x)}%`;
          const fatoP =
            f.bloqueio === 'desfavorável'
              ? `A população ${deB(bairro)} ${verbo(nosso)} de 2010 a 2022, e a de ${f.mun} ${verbo(f.ref!)}.`
              : null;
          im.bloqueadas.push(
            bloq(
              'C2 população',
              `${fmt1(nosso)}% entre 2010 e 2022 contra ${temNum(f.ref) ? `${fmt1(f.ref)}% de ${f.mun}` : `a mediana dos outros municípios (${fmt1(f.med_outros)}%)`}: ${f.bloqueio}.`,
              'regra',
              { desfavoravel: f.bloqueio === 'desfavorável', ...(fatoP ? { fato: fatoP } : {}) },
            ),
          );
        }
      } else if (f.id === 'C2.populacao_municipio') {
        if (nosso >= f.med_outros!) {
          const C = f.forca === 'C';
          destino.push({
            id: 'C2.populacao_municipio',
            regra: 'C2',
            familia: 'regiao',
            nivel: 'regiao',
            eixo: 'regiao_vs_outras',
            forca: f.forca!,
            status: 'usar',
            texto_base: `${C ? 'Como fato, pelo' : 'Pelo'} Censo do IBGE, a população de ${apos(lugar.municipio || f.mun!)} cresceu ${fmt1(nosso)}% entre 2010 e 2022.`,
            gatilhos: gat('C2.populacao_municipio', ['investimento']),
            so_com_preco_dito: false,
            explica_preco: false,
            numeros_obrigatorios: [`${fmt1(nosso)}%`, '2010', '2022'],
            comparacao: {
              nosso,
              referencia: f.med_outros,
              medida: 'crescimento',
              n: f.n_outros,
              conjunto: `outros ${f.n_outros} municípios da base`,
            },
            prova: {
              fonte: 'IBGE, Censo 2022 (município)',
              data_dado: '2022-08-01',
              regra: `${fmt1(nosso - f.med_outros!)} pontos sobre a mediana dos outros municípios: ${C ? 'abaixo de 20, é fato de contexto (C), só se perguntarem' : '20 ou mais (B)'}`,
            },
            prova_cliente: `É do Censo 2022 do IBGE, pelos dados do município de ${f.mun}.`,
            validade: VAL_CENSO,
          });
        } else
          im.bloqueadas.push(
            bloq(
              'C2 população do município',
              `${f.mun} ${pct(nosso / 100)}, abaixo da mediana dos outros municípios (${fmt1(f.med_outros)}%).`,
              'regra',
              {
                desfavoravel: true,
                fato: `A população de ${f.mun} cresceu ${fmt1(nosso)}% de 2010 a 2022, abaixo dos outros municípios (${fmt1(f.med_outros)}%).`,
              },
            ),
          );
      } else if (f.id === 'C1.veraneio') {
        const metade = nosso >= 45 && nosso < 55;
        const qt = metade
          ? 'cerca de metade dos domicílios é'
          : `${Math.trunc(nosso)}% dos domicílios são`;
        destino.push({
          id: 'C1.veraneio',
          regra: 'C1',
          familia: 'regiao',
          nivel: 'regiao',
          eixo: 'perfil',
          forca: 'C',
          status: 'usar',
          texto_base: `Pelos dados do Censo 2022 dos setores ${lugar.setores || 'do lugar'}, ${qt} de uso ocasional, como ${lugar.ocasional || 'casa de praia'}.`,
          texto_curto: `E, pelo Censo 2022, ${metade ? `cerca de metade dos domicílios ${lugar.setores || 'do lugar'} é` : `${Math.trunc(nosso)}% dos domicílios ${lugar.setores || 'do lugar'} são`} de uso ocasional.`,
          gatilhos: gat('C1.veraneio', ['quer_casa_de_praia']),
          so_com_preco_dito: false,
          explica_preco: false,
          numeros_obrigatorios: metade ? ['2022'] : [`${Math.trunc(nosso)}%`, '2022'],
          comparacao: {
            nosso,
            referencia: f.ref,
            medida: 'pct_uso_ocasional',
            n: null,
            conjunto: `setores ${lugar.setores || ''} × ${f.mun}`.trim(),
          },
          prova: {
            fonte:
              `IBGE, Censo 2022, soma ${nSetores ? `de ${nSetores}` : 'dos'} setores censitários ${lugar.setores || ''}`.trim(),
            data_dado: '2022-08-01',
            regra: `perfil: ${fmt(+(nosso / f.ref!).toFixed(2))}× o município (≥ 1,3×)`,
          },
          prova_cliente:
            `É do Censo 2022 do IBGE, somando os setores censitários ${lugar.setores || ''}.`.replace(
              ' .',
              '.',
            ),
          validade: VAL_CENSO,
        });
      } else if (f.id === 'C2.construcao') {
        if (f.forca) {
          const texto = f.posicao_exata
            ? `Segundo a Prefeitura de Natal, ${f.bairro} foi o ${f.pos === 1 ? '' : `${f.pos}º `}bairro da cidade com mais unidades aprovadas em alvarás de construção entre 2021 e 2023.`
            : `Segundo a Prefeitura de Natal, ${f.bairro} esteve entre os ${f.entre_os} bairros da cidade com mais unidades aprovadas em alvarás de construção entre 2021 e 2023.`;
          /* curto (a 2ª vantagem da mensagem): os mesmos números, sem a fonte */
          const curtoC = f.posicao_exata
            ? `E ${f.bairro} foi o ${f.pos === 1 ? '' : `${f.pos}º `}bairro de Natal com mais unidades aprovadas em alvarás de construção de 2021 a 2023.`
            : `E ${f.bairro} esteve entre os ${f.entre_os} bairros de Natal com mais unidades aprovadas em alvarás de 2021 a 2023.`;
          const jan = f.janelas!;
          destino.push({
            id: 'C2.construcao',
            regra: 'C2',
            familia: 'regiao',
            nivel: 'regiao',
            eixo: 'regiao_vs_outras',
            forca: f.forca,
            status: 'usar',
            texto_base: texto,
            texto_curto: curtoC,
            gatilhos: gat(
              'C2.construcao',
              comercial
                ? ['regiao', 'uso_comercial', 'comparacao_bairro']
                : ['regiao', 'investimento'],
            ),
            so_com_preco_dito: false,
            explica_preco: false,
            numeros_obrigatorios: f.posicao_exata
              ? [...(f.pos! > 1 ? [String(f.pos)] : []), '2021', '2023']
              : [String(f.entre_os), '2021', '2023'],
            comparacao: {
              nosso: f.unidades,
              referencia: null,
              medida: 'posicao',
              n: f.de,
              conjunto: `${f.de} bairros de Natal, unidades em alvarás 2021-2023`,
            },
            rigor: {
              posicao: f.pos,
              de: f.de,
              mesma_posicao_em: `${f.mesma_posicao_em} de 6 janelas`,
              folga_ate_o_seguinte: +(f.folga_ate_o_seguinte ?? 0).toFixed(3),
              posicoes: jan.map((j) => `${j.janela}: ${j.pos}º`),
              bairros_com_ano_faltando: f.bairros_com_ano_faltando,
            },
            prova: {
              fonte: 'Prefeitura de Natal, GeoMapas (alvarás 2017-2023)',
              data_dado: '2023-12-31',
              regra: f.posicao_exata
                ? `posição exata: folga de ${Math.round(f.folga_ate_o_seguinte! * 100)}% até o seguinte (> 10%) e ${f.pos}º em ${f.mesma_posicao_em} de 6 janelas`
                : `posição exata só com folga > 10% e a mesma posição em 4 de 6 janelas; aqui a folga até o seguinte é ${fmt1(f.folga_ate_o_seguinte! * 100)}% e a posição vai do ${Math.min(...jan.map((j) => j.pos))}º ao ${Math.max(...jan.map((j) => j.pos))}º: "entre os ${f.entre_os}" vale em todas as janelas (teto B)`,
            },
            prova_cliente:
              'São os alvarás de construção publicados pela Prefeitura de Natal, de 2021 a 2023.',
            validade: VAL_CENSO,
          });
        } else {
          const desf = !f.forca && f.pos! > f.de! / 2;
          im.bloqueadas.push(
            bloq(
              'C2 construção',
              `${f.pos}º de ${f.de} bairros de Natal em unidades aprovadas (2021-2023): não fica entre os primeiros em todas as janelas.`,
              'regra',
              {
                desfavoravel: desf,
                ...(desf
                  ? {
                      fato: `De 2021 a 2023, ${comArtigo(f.bairro!) ? 'o ' : ''}${f.bairro} ficou em ${f.pos}º de ${f.de} bairros de Natal em alvarás de construção.`,
                    }
                  : {}),
              },
            ),
          );
        }
      } else if (f.id === 'C3.nivel_apto') {
        if (f.forca && f.pos === 1) {
          const coletaCorrida = String(B.corrida?.coletado_em || coleta);
          destino.push({
            id: 'C3.nivel_apto',
            regra: 'C3',
            familia: 'regiao',
            nivel: 'regiao',
            eixo: 'regiao_vs_outras',
            forca: 'B',
            status: 'usar',
            texto_base: `Para quem pensa em construir: segundo A Corrida dos Bairros de ${mesDe(coletaCorrida)}, ${f.bairro} tem o m² de apartamento anunciado mais alto entre os bairros do município de Natal.`,
            texto_curto: `E ${f.bairro} tem o m² de apartamento anunciado mais alto entre os bairros do município de Natal.`,
            gatilhos: gat('C3.nivel_apto', ['quer_construir']),
            so_com_preco_dito: false,
            explica_preco: false,
            numeros_obrigatorios: [],
            comparacao: {
              nosso: f.m2,
              referencia: f.segundo_m2,
              medida: 'posicao',
              n: f.de,
              conjunto: `bairros de Natal com 30 anúncios de apartamento ou mais na Corrida dos Bairros; o 2º é ${String(f.segundo || '').replace(/ R\$.*/, '')}`,
            },
            prova: {
              fonte: `A Corrida dos Bairros, edição de ${mesAno} (CC BY 4.0), ${f.amostra} anúncios em ${f.bairro}; confirmado pela posição no informe FipeZAP${mesFipe ? ` de ${mesFipe}` : ''}`,
              data_dado: `${coletaCorrida.slice(0, 8)}01`,
              regra: `1º entre os bairros do município de Natal (R$ ${fmt(f.m2)}, ${f.amostra} anúncios); acima, na página de Natal, só bairros de outros municípios (${f.acima_fora_do_municipio!.length}); 1º e 2º não se separam em cada fonte (z ≈ 0,8): teto B`,
            },
            prova_cliente: `É da Corrida dos Bairros, que reúne os preços pedidos de apartamentos anunciados por bairro, na edição de ${mes}.`,
            validade: {
              valido_ate: somaDias(somaMeses(`${coleta.slice(0, 8)}01`, 1), 14),
              vence_com: 'informe_seguinte',
              motivo: 'posição pode virar no informe seguinte; refazer todo mês',
            },
          });
        } else
          im.bloqueadas.push(
            bloq(
              'C3 m² de apartamento',
              `${f.pos}º de ${f.de} bairros de Natal na Corrida dos Bairros: só o 1º vira frase.`,
              'regra',
            ),
          );
      } else if (f.id === 'C2.estrangeiros') {
        const nos = fmt1(Math.floor(nosso * 10) / 10);
        const ref2 = fmt1(Math.ceil(f.ref! * 10) / 10);
        if (f.forca)
          destino.push({
            id: 'C2.estrangeiros',
            regra: 'C2',
            familia: 'regiao',
            nivel: 'regiao',
            eixo: 'perfil',
            forca: 'C',
            status: 'usar',
            texto_base: `Pelo Censo 2022, ${nos}% dos moradores de ${apos(lugar.municipio || bairro)} são estrangeiros, contra ${ref2}% em Natal.`,
            gatilhos: gat('C2.estrangeiros', ['vem_de_fora']),
            so_com_preco_dito: false,
            explica_preco: false,
            numeros_obrigatorios: [`${nos}%`, `${ref2}%`],
            comparacao: {
              nosso,
              referencia: f.ref,
              medida: 'pct_estrangeiros',
              n: null,
              conjunto: 'município × Natal',
            },
            prova: {
              fonte: 'IBGE, Censo 2022 (SIDRA 10157)',
              data_dado: '2022-08-01',
              regra: 'perfil: 10× Natal ou mais',
            },
            prova_cliente: `É do Censo 2022 do IBGE, pelos dados do município de ${f.mun}.`,
            validade: VAL_CENSO,
          });
        else
          im.bloqueadas.push(
            bloq(
              'C2 estrangeiros',
              `${nos}% contra ${ref2}% em Natal: abaixo de 10 vezes.`,
              'regra',
            ),
          );
      } else if (f.id === 'S1.valorizacao_bairro') {
        const desf = f.var12! < f.natal!;
        im.bloqueadas.push(
          bloq(
            'S1 índice do bairro',
            `FipeZAP de ${f.bairro} +${dec(f.var12, 1)}% em 12 meses contra +${dec(f.natal, 2)}% de Natal: ${f.bloqueio}.`,
            'regra',
            {
              desfavoravel: desf,
              ...(desf
                ? {
                    fato: `O índice FipeZAP de ${f.bairro} subiu ${dec(f.var12, 1)}% em 12 meses, menos que o de Natal (${dec(f.natal, 1)}%).`,
                  }
                : {}),
            },
          ),
        );
      }
    }
    /* série de Natal (S1): fato do passado, só em investimento e só em apartamento (o índice mede apartamentos) */
    const fz = (B.fipe_natal || []).find((s) => s.id === 'fipezap-natal-var12');
    const ult = fz?.ultimos?.at(-1);
    if (ult && /^natal-/.test(r.regiao)) {
      const [ym, v] = ult;
      const mesRef = `${MESES_L[+ym.slice(5, 7) - 1]} de ${ym.slice(0, 4)}`;
      const fimDoMes = `${ym}-${String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()).padStart(2, '0')}`;
      if (baseG(r.grupo) === 'apartamento' && v > 0) {
        V.push({
          id: 'S1.natal',
          regra: 'S1',
          familia: 'serie',
          nivel: 'regiao',
          eixo: 'regiao_vs_outras',
          forca: 'C',
          status: 'usar',
          texto_base: `Como fato do passado, pelo índice FipeZAP de Natal, o preço pedido dos apartamentos na cidade subiu ${fmt1(v)}% nos 12 meses até ${mesRef}.`,
          texto_curto: `E, como fato do passado, o índice FipeZAP de Natal subiu ${fmt1(v)}% nos 12 meses até ${mesRef}.`,
          gatilhos: gat('S1.natal', ['investimento']),
          so_com_preco_dito: false,
          explica_preco: false,
          numeros_obrigatorios: [`${fmt1(v)}%`, '12'],
          comparacao: {
            nosso: v,
            referencia: null,
            medida: 'var12_pct',
            n: null,
            conjunto: 'índice FipeZAP de Natal (apartamentos)',
          },
          prova: {
            fonte: `Índice FipeZAP, planilha pública da Fipe, ${mesRef}`,
            data_dado: fimDoMes,
            regra:
              'fato histórico da cidade, janela fixa de 12 meses; o índice do bairro não é citado',
          },
          prova_cliente: `É o índice FipeZAP, que acompanha os preços pedidos de apartamentos anunciados em Natal, no dado de ${mesRef}.`,
          validade: { valido_ate: somaDias(fimDoMes, 45), vence_com: 'data' },
        });
      } else if (!comercial && /^(terreno|casa)$/.test(baseG(r.grupo) || ''))
        im.bloqueadas.push(
          bloq(
            'S1 FipeZAP de Natal em investimento',
            `O índice mede apartamentos (+${dec(v, 2)}% em 12 meses até ${mesRef}) e não responde se ${baseG(r.grupo) === 'terreno' ? 'um terreno' : 'uma casa'} é bom investimento; em investimento, só o prefixo e um fato do anúncio.`,
            'regra',
          ),
        );
    }
    /* valor total (P3), igual com igual: só com a área construída */
    const p3 = X[`${ref}_P3`] as ValorTotal | undefined;
    if (p3 && p3.n) {
      const nossoPreco = imDaBase?.preco;
      const passa =
        !!r.preco &&
        p3.n >= 10 &&
        temNum(nossoPreco) &&
        nossoPreco <= LIMIAR * p3.med! &&
        p3.pSinal <= 0.05 &&
        p3.pior <= 0.4;
      const onde = p3.nome?.texto || 'na região';
      const tipo = baseNome(r.grupo, true);
      const conferir = r.preco.conferir || [];
      if (passa && !cad?.motor?.p3_bloqueado) {
        const medK = fmt(Math.floor(p3.med! / 1000));
        V.push({
          id: 'P3.valor_total',
          regra: 'P3',
          familia: 'preco',
          nivel: 'preco',
          eixo: 'mesma_regiao_mesmo_tipo',
          forca: 'B',
          status: conferir.length ? 'conferir' : 'usar',
          texto_base: `Dos ${p3.n} ${tipo} de ${p3.quartos} quartos à venda ${onde} que acompanhamos em ${mes}, a metade pedia R$ ${medK} mil ou mais.`,
          texto_curto: `E a metade dos ${p3.n} ${tipo} de ${p3.quartos} quartos à venda ${onde} que acompanhamos pedia R$ ${medK} mil ou mais.`,
          gatilhos: ['caro', 'mais_barato', 'comparacao'],
          so_com_preco_dito: true,
          explica_preco: false,
          numeros_obrigatorios: [String(p3.n), String(p3.quartos), medK],
          comparacao: {
            nosso: nossoPreco,
            referencia: Math.round(p3.med!),
            medida: 'mediana_preco',
            n: p3.n,
            conjunto: `${tipo} de ${p3.quartos} quartos ${onde}, sem repetidos`,
          },
          rigor: {
            pedem_mais: p3.pedem_mais,
            p_sinal: +p3.pSinal.toPrecision(2),
            teto: 'B (posição; padrão do prédio não casado)',
          },
          prova: {
            fonte: `Anúncios públicos de venda reunidos pela Imova em ${dataBR(coleta)}`,
            data_dado: coleta,
            regra: `P3 com posição; ${conferir.length ? 'só depois de a equipe conferir área, preço, estado e escrever o motivo do valor' : 'igual com igual'}`,
          },
          prova_cliente: contagemCliente(
            `${p3.n} ${tipo} de ${p3.quartos} quartos ${onde.replace(/^(no|na) /, 'em ')}`,
          ),
          validade: { valido_ate: validoAnuncios, vence_com: 'data' },
          ...(cad?.aviso_vantagem?.['P3.valor_total']
            ? { aviso_obrigatorio: cad.aviso_vantagem['P3.valor_total'] }
            : {}),
        });
      } else if (cad?.motor?.p3_bloqueado)
        im.bloqueadas.push(
          bloq(
            `P3 valor total entre as de ${p3.quartos} quartos`,
            `${p3.pedem_mais} de ${p3.n} ${tipo} de ${p3.quartos} quartos ${onde} pedem mais (mediana ${brlCurto(p3.med)}; p = ${dec(p3.pSinal, 3)}), mas ${cad.motor.p3_bloqueado}.`,
            'conferir',
            { id: 'P3.valor_total', forca_se: passa ? 'B' : null },
          ),
        );
    }
    /* procura: "o mais procurado" (G1) só com o teste */
    if (R.procura && R.procura.lider?.codigo === ref && R.procura.p_lider_vs_2o > 0.1)
      im.bloqueadas.push(
        bloq(
          'G1 o mais procurado da carteira',
          `${R.procura.lider.min} a ${R.procura.lider.max} conversas contra ${R.procura.segundo.min} a ${R.procura.segundo.max} do 2º: teste binomial p = ${dec(R.procura.p_lider_vs_2o)} (precisa de p ≤ 0,10 e o dobro do 2º).`,
          'regra',
        ),
      );
    /* regras do caderno que travam por fora do motor */
    for (const [o, m] of cad?.bloqueadas || [])
      im.bloqueadas.push(bloq(o, m, 'regra', { caderno: true }));

    /* frase fora das regras não aparece: vai para os bloqueios (produto §5.7) */
    for (const v of [...V]) {
      const f = checarFrase(v);
      if (f.length) {
        V.splice(V.indexOf(v), 1);
        im.bloqueadas.push(
          bloq(`${v.id} (frase)`, `frase fora das regras: ${f.join('; ')}`, 'regra'),
        );
      }
    }
    /* ordem final gravada: usar antes, força, depois o segmento (núcleo §1.7) */
    const ordem = ORDEM_SEGMENTO[im.segmento || ''] || [];
    V.sort(
      (a, b) =>
        (a.status === 'usar' ? 0 : 1) - (b.status === 'usar' ? 0 : 1) ||
        FORCA_N[a.forca]! - FORCA_N[b.forca]! ||
        ordem.indexOf(a.familia) - ordem.indexOf(b.familia),
    );
    for (const v of [...V, ...im.propostas])
      if (!v.texto_curto) v.texto_curto = v.texto_base.length <= 120 ? v.texto_base : null;
    /* a lista da retomada: na fase 1, só no dossiê (retomada_v2); fica fora o item cujo único sinal é um objetivo */
    const soObjetivo = (v: Vantagem): boolean =>
      v.gatilhos.filter((g) => g !== 'retomada').every((g) => OBJETIVOS.includes(g));
    im.retomada_v2 = V.filter(
      (v) =>
        v.status === 'usar' &&
        v.nivel === 'imovel' &&
        !v.explica_preco &&
        !v.so_com_preco_dito &&
        (v._retomada || v.gatilhos.includes('retomada')) &&
        !soObjetivo(v),
    ).map((v) => v.id);
    for (const v of V) {
      if (v._retomada || v.gatilhos.includes('retomada')) v.retomada_v2 = true;
      v.gatilhos = v.gatilhos.filter((g) => g !== 'retomada');
      delete v._retomada;
    }
    /* a região contra a do outro imóvel ("outro bairro") */
    for (const v of [...V, ...im.propostas])
      if (v.nivel === 'regiao') v.supera = superaDe(v, r.regiao);
    imoveis.push(im);
  }
  const rodada = opcoes.rodada ?? RODADA_DO_PROTOTIPO;
  return {
    versao: VERSAO_DOSSIE,
    rodada: {
      ...rodada,
      coleta_anuncios: coleta,
      base: `dados de ${dataBR(coleta)} sem ZAP, Viva Real nem OLX: ${fmt(R.anuncios_pagina)} anúncios de venda na página, ${fmt(R.anuncios)} usados nas contas (${R.suspeitos} suspeitos e ${R.fora_da_cidade_n} de outra cidade pelo título fora)`,
    },
    imoveis,
  };
}
