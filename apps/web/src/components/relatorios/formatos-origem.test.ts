import { describe, expect, it } from 'vitest';

import type { LinhaDoAnuncio, LinhaDoGrupo, MesDaOrigem, PainelOrigem } from './dados-vende';
import {
  achadosDaOrigem,
  divisaoDosMeses,
  leituraDoAnuncio,
  ordenarAnuncios,
  porDia,
  rotuloDoSubcanal,
  separarAnuncios,
  tempoCurto,
  vistosDaLinha,
} from './formatos-origem';

function grupo(g: LinhaDoGrupo['grupo'], chegadas: number, extra: Partial<LinhaDoGrupo> = {}): LinhaDoGrupo {
  return {
    grupo: g,
    chegadas,
    responderam: chegadas,
    rapidas: 0,
    mediana_min: null,
    interessados: 0,
    esfriando: 0,
    visitas: 0,
    subs: [],
    anuncios: [],
    ...extra,
  };
}

function anuncio(codigo: string, extra: Partial<LinhaDoAnuncio> = {}): LinhaDoAnuncio {
  return {
    codigo,
    titulo: `Imóvel ${codigo}`,
    situacao: 'no_ar',
    vistos: null,
    contatos: null,
    vistos_periodo: null,
    contatos_periodo: null,
    juntou: [],
    chegaram: 0,
    sem_conversa: 0,
    interessados: 0,
    muito: 0,
    ...extra,
  };
}

function mes(m: string, extra: Partial<MesDaOrigem> = {}): MesDaOrigem {
  return {
    mes: m,
    dias: 30,
    chegadas: 0,
    grupos: { placa: 0, meta: 0, portais: 0, redes_sociais: 0, outros: 0, nao_identificado: 0 },
    nossas: 0,
    responderam: 0,
    rapidas: 0,
    mediana_min: null,
    sem_resposta: 0,
    recebidas: 0,
    ia: 0,
    equipe: 0,
    subiram: 0,
    esfriaram: 0,
    visitas: 0,
    fechados: 0,
    ...extra,
  };
}

/** O retrato de 18/11/2026 da Imova, enxuto: o que o protótipo aprovado mostrava. */
function painel(extra: Partial<PainelOrigem> = {}): PainelOrigem {
  return {
    periodo: { de: '2026-10-20', ate: '2026-11-18' },
    desde: '2026-10-28',
    pode_marcar: true,
    kpis: {
      chegadas: 25,
      identificadas: 19,
      responderam: 22,
      rapidas: 8,
      mediana_min: 162.5,
      subiram: 8,
      esfriaram: 4,
      visitas: 0,
      visitas_canceladas: 1,
      fechados: 0,
    },
    grupos: [
      grupo('placa', 10),
      grupo('meta', 5, {
        anuncios: [{ id: '120251297618790739', titulo: 'Beats Pink Lemonade na Malca', chegadas: 5, sem_resposta: 2, da_imova: false }],
      }),
      grupo('portais', 4),
      grupo('redes_sociais', 0),
      grupo('outros', 0),
      grupo('nao_identificado', 6),
    ],
    placa: { fotos: 7, fotos_com_codigo: 0 },
    semanas: [],
    interesse: {
      hoje: { sem_resposta: 1, morno: 2, interessado: 13, muito_interessado: 0, esfriando: 3, sem_interesse: 0, sem_etiqueta: 0, total: 19 },
      subiram: 8,
      responderam: 6,
      ficaram_interessadas: 2,
      viraram_muito: 0,
      esfriaram: 4,
      juiza: { subiu: 1, igual: 9, caiu: 1 },
    },
    anuncios: [],
    numeros_desde: '2026-11-18',
    sistema: {
      primeiro: { ia: 5, ia_mediana_min: 0.6, equipe: 17, equipe_mediana_min: 1256.6, ninguem: 3 },
      descoberta: { regra: 9, ia: 9, equipe: 1, sem_pista: 6, fotos: 8, fotos_da_imova: 7, prints: 1, fotos_com_codigo: 0 },
      sem_resposta: [],
      grupo_olx: { contatos: 4, sem_conversa: 2, desde: null, telefone: 3, chat: 1, formulario: 0, whatsapp: 0, visita: 0, por_anuncio: [] },
      mensagens: { recebidas: 209, ia: 28, equipe: 120 },
    },
    meses: [],
    ...extra,
  };
}

describe('os achados do topo', () => {
  it('com os números de 18/11: a placa sem código, o anúncio de fora e a IA mais rápida', () => {
    const achados = achadosDaOrigem(painel());
    expect(achados.map((a) => a.chave)).toEqual(['origem', 'confira', 'atendimento']);
    expect(achados[0]!.titulo).toBe('A placa traz mais gente que qualquer anúncio, mas não diz de qual imóvel é');
    expect(achados[0]!.texto).toContain('10 das 25 chegadas vieram de placa, 7 com foto');
    expect(achados[1]!.texto).toBe('5 chegadas vieram do anúncio “Beats Pink Lemonade na Malca”. 2 ficaram sem resposta.');
    expect(achados[1]!.tom).toBe('alerta');
    expect(achados[2]!.titulo).toBe('Quando a IA responde primeiro, o cliente espera menos de 1 min. Quando é a equipe, 20 h 57.');
    expect(achados[2]!.acao).toEqual({ rotulo: 'Abrir as 3 sem resposta', alvo: 'sistema' });
  });

  it('sem chegada no período, nenhum achado', () => {
    expect(achadosDaOrigem(painel({ kpis: { ...painel().kpis, chegadas: 0 } }))).toEqual([]);
  });

  it('com a foto trazendo o código, o achado da placa vira o do caminho que mais trouxe gente', () => {
    const achados = achadosDaOrigem(painel({ placa: { fotos: 7, fotos_com_codigo: 3 } }));
    expect(achados[0]!.titulo).toBe('Placa foi o caminho que mais trouxe gente');
    expect(achados[0]!.texto).toBe('10 das 25 chegadas (40%).');
  });

  it('sem anúncio de fora, o que conferir é a origem que ninguém descobriu', () => {
    const base = painel();
    const grupos = base.grupos.map((g) => (g.grupo === 'meta' ? { ...g, anuncios: [] } : g));
    const achados = achadosDaOrigem({ ...base, grupos });
    expect(achados[1]!.titulo).toBe('6 chegadas sem origem descoberta');
  });
});

describe('anúncio a anúncio', () => {
  it('os vistos do período valem quando a foto diária cobre; senão, o acumulado', () => {
    expect(vistosDaLinha(anuncio('A', { vistos: 897, vistos_periodo: null }))).toEqual({ valor: 897, doPeriodo: false });
    expect(vistosDaLinha(anuncio('A', { vistos: 897, vistos_periodo: 40 }))).toEqual({ valor: 40, doPeriodo: true });
  });

  it('o quadro tem os no ar e os só do CRM com gente; os fora do ar vão para baixo', () => {
    const { noAr, fora } = separarAnuncios([
      anuncio('NO_AR'),
      anuncio('SO_CRM_COM_GENTE', { situacao: 'so_no_crm', interessados: 2 }),
      anuncio('SO_CRM_VAZIO', { situacao: 'so_no_crm' }),
      anuncio('FORA', { situacao: 'fora_do_ar', vistos: 1074 }),
    ]);
    expect(noAr.map((a) => a.codigo)).toEqual(['NO_AR', 'SO_CRM_COM_GENTE']);
    expect(fora.map((a) => a.codigo)).toEqual(['FORA']);
  });

  it('por interesse, o muito interessado vem antes do número de interessados', () => {
    const lista = [
      anuncio('PT0001', { interessados: 2, vistos: 897 }),
      anuncio('SA0012', { interessados: 1, muito: 1 }),
      anuncio('TE0002', { vistos: 133 }),
    ];
    expect(ordenarAnuncios(lista, 'interesse').map((a) => a.codigo)).toEqual(['SA0012', 'PT0001', 'TE0002']);
    expect(ordenarAnuncios(lista, 'vistos').map((a) => a.codigo)).toEqual(['PT0001', 'TE0002', 'SA0012']);
  });

  it('a leitura diz o notável, os anúncios antigos somados e o contato sem conversa', () => {
    const contexto = { maisInteresse: 'SA0012', maisVisto: 'PT0001' };
    expect(
      leituraDoAnuncio(
        anuncio('SA0012', { interessados: 3, muito: 2, juntou: ['Brisa Mall - Sala 05'], sem_conversa: 1 }),
        contexto,
      ),
    ).toBe('O que mais interessa: 2 muito interessados. Soma o anúncio antigo (Brisa Mall - Sala 05).');
    expect(leituraDoAnuncio(anuncio('PT0001', { vistos: 897, chegaram: 2 }), contexto)).toBe('O mais visto no ar.');
    expect(leituraDoAnuncio(anuncio('TE0002', { vistos: 133 }), contexto)).toBe('133 vistos e ninguém no CRM.');
    expect(leituraDoAnuncio(anuncio('TE0001', { sem_conversa: 1 }), contexto)).toBe(
      '1 contato do portal ainda sem conversa.',
    );
  });
});

describe('números e meses', () => {
  it('o tempo de resposta fica em horas até dois dias', () => {
    expect(tempoCurto(0.6)).toBe('menos de 1 min');
    expect(tempoCurto(4.7)).toBe('5 min');
    expect(tempoCurto(162.5)).toBe('2 h 43');
    expect(tempoCurto(2172.5)).toBe('36 h 13');
    expect(tempoCurto(60 * 24 * 3.5)).toBe('3,5 dias');
    expect(tempoCurto(null)).toBe('—');
  });

  it('por dia, com uma casa e sem dividir por zero', () => {
    expect(porDia(23, 18)).toBe('1,3');
    expect(porDia(2, 4)).toBe('0,5');
    expect(porDia(3, 0)).toBe('—');
  });

  it('os dois últimos meses, do mais novo para o mais velho', () => {
    const meses = [mes('2026-10', { chegadas: 2 }), mes('2026-11', { chegadas: 23 })];
    expect(divisaoDosMeses(meses, (m) => m.chegadas)).toBe('nov. 23 · out. 2');
    expect(divisaoDosMeses([meses[0]!], (m) => m.chegadas)).toBeNull();
  });

  it('o detalhe do caminho como a equipe fala', () => {
    expect(rotuloDoSubcanal('foto_da_placa')).toBe('Mandou foto da placa');
    expect(rotuloDoSubcanal('portal_vivareal')).toBe('Viva Real');
    expect(rotuloDoSubcanal('algo_novo')).toBe('algo_novo');
  });
});
