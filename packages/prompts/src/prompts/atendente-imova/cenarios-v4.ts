import type { BaseDoAtendenteV2 } from './v2';
import { BASE_DO_ENSAIO, CENARIOS_DO_ATENDENTE_V3, type CenarioDoAtendente } from './cenarios-v3';

/**
 * Os cenários do ensaio de `atendente-imova@v4` (12/11/2026): os da v3, com o imóvel em
 * rascunho recebendo o link da visita, e um cenário novo para o "pausado", que continua
 * com o corretor. A régua (`conferirCenario`) é a mesma da v3.
 */

/** O cenário da v3 que a v4 muda: na v3, rascunho ia para o corretor. */
const NOME_DO_RASCUNHO_NA_V3 = 'imóvel em rascunho: não manda link; confirma com o corretor';

const rascunhoNaV3 = CENARIOS_DO_ATENDENTE_V3.find((c) => c.nome === NOME_DO_RASCUNHO_NA_V3);
if (rascunhoNaV3 === undefined) {
  throw new Error(`cenarios-v4: o cenário "${NOME_DO_RASCUNHO_NA_V3}" sumiu da v3.`);
}

/** A base do ensaio da v4: a da v3, mais um imóvel pausado. */
export const BASE_DO_ENSAIO_V4: BaseDoAtendenteV2 = {
  ...BASE_DO_ENSAIO,
  imoveis: [
    ...BASE_DO_ENSAIO.imoveis,
    {
      codigo: 'IM0009',
      situacao: 'pausado',
      tipo: 'apartamento',
      negocio: 'venda',
      preco_venda: 420000,
      quartos: 2,
      suites: 1,
      bairro: 'Lagoa Nova',
      cidade: 'Natal',
      estado: 'RN',
      titulo: 'Apartamento em Lagoa Nova',
    },
  ],
};

const rascunhoNaV4: CenarioDoAtendente = {
  nome: 'imóvel em rascunho: manda o link da visita (v4)',
  entrada: rascunhoNaV3.entrada,
  espera: {
    acoes: ['enviar_link_da_agenda'],
    agenda: { tipo: 'visita', imovelCodigo: 'IM0007' },
  },
  respostaBoa: {
    acao: 'enviar_link_da_agenda',
    mensagem:
      'Ótimo! Vou te mandar o link da agenda para você escolher o melhor dia e horário da visita à casa.',
    agenda: { tipo: 'visita', imovelCodigo: 'IM0007' },
    motivo: 'Quer visitar o IM0007, que está em rascunho na carteira; mandei o link da visita.',
    anotacoes: [],
    fotosEnsinadas: [],
    confianca: 0.85,
  },
};

const pausado: CenarioDoAtendente = {
  nome: 'imóvel pausado: não manda link; confirma com o corretor (v4)',
  entrada: {
    ...rascunhoNaV3.entrada,
    mensagens: rascunhoNaV3.entrada.mensagens.map((m) => ({
      ...m,
      texto: 'Quero visitar o apartamento IM0009 em Lagoa Nova.',
    })),
  },
  espera: { acoes: ['passar_para_corretor'] },
  respostaBoa: {
    acao: 'passar_para_corretor',
    mensagem:
      'Boa tarde, [[NOME_1]]! Vou confirmar a disponibilidade desse apartamento com um corretor, que já continua com você por aqui para a visita.',
    agenda: null,
    motivo: 'Quer visitar o IM0009, que está pausado; passei para o corretor.',
    anotacoes: [],
    fotosEnsinadas: [],
    confianca: 0.85,
  },
};

export const CENARIOS_DO_ATENDENTE_V4: readonly CenarioDoAtendente[] = [
  ...CENARIOS_DO_ATENDENTE_V3.map((c) => (c.nome === NOME_DO_RASCUNHO_NA_V3 ? rascunhoNaV4 : c)),
  pausado,
];
