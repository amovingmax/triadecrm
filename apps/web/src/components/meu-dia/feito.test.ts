import { describe, expect, it } from 'vitest';

import { resultadoDoDesfecho, type TomDoResultado } from '@/components/agenda/tipos';
import type { DesfechoCatalogo } from '@/components/registro/tipos';

import {
  agruparFeitoHoje,
  canalDoDesfecho,
  CATEGORIAS,
  comoFoi,
  contarPessoas,
  type ComoFoi,
  type RegistroDoDia,
} from './feito';

/**
 * O catálogo da seed (`supabase/seed.sql`, bloco de `interaction_outcomes`) nas cinco
 * colunas que a regra lê, com a categoria esperada ao lado. Um desfecho novo na seed
 * que não entrar aqui não quebra a tela — cai em "mediano" —, mas deve entrar.
 */
const CATALOGO: [
  slug: string,
  nome: string,
  superficie: string,
  etapa: string | null,
  temperatura: string | null,
  esperado: ComoFoi,
][] = [
  ['wa_sem_resposta', 'Enviado, sem resposta', 'whatsapp', null, null, 'mediano'],
  ['wa_respondeu', 'Respondeu', 'whatsapp', 'respondeu', 'morno', 'em_contato'],
  ['wa_nao_e_a_pessoa', 'Não é a pessoa', 'whatsapp', null, null, 'mediano'],
  ['wa_agora_nao', 'Agora não', 'whatsapp', 'nutricao', 'frio', 'negativo'],
  ['wa_nao_firme', 'Não, definitivo', 'whatsapp', 'perdido', null, 'negativo'],
  ['wa_numero_invalido', 'Número inválido', 'whatsapp', null, null, 'mediano'],
  ['wa_optout', 'Pediu para parar', 'whatsapp', 'optout', 'frio', 'negativo'],
  ['lig_nao_atendeu', 'Não atendeu', 'ligacao', null, null, 'mediano'],
  ['lig_caixa_postal', 'Caixa postal', 'ligacao', null, null, 'mediano'],
  ['lig_numero_errado', 'Número errado', 'ligacao', null, null, 'mediano'],
  ['lig_atendeu_retorna', 'Atendeu, retorna depois', 'ligacao', null, 'morno', 'em_contato'],
  ['lig_interessado', 'Interessado', 'ligacao', 'respondeu', 'quente', 'positivo'],
  ['lig_agora_nao', 'Agora não', 'ligacao', 'nutricao', 'frio', 'negativo'],
  ['lig_sem_interesse', 'Sem interesse', 'ligacao', 'perdido', null, 'negativo'],
  ['lig_reuniao_marcada', 'Reunião marcada', 'ligacao', 'reuniao_marcada', 'quente', 'positivo'],
  ['vis_nao_estava', 'Não estava / fechado', 'visita', null, null, 'negativo'],
  ['vis_funcionario', 'Falei com funcionário', 'visita', null, null, 'mediano'],
  ['vis_decisor_interessado', 'Decisor interessado', 'visita', 'respondeu', 'quente', 'positivo'],
  ['vis_decisor_agora_nao', 'Decisor, agora não', 'visita', 'nutricao', 'frio', 'negativo'],
  ['vis_decisor_recusou', 'Decisor recusou', 'visita', 'perdido', null, 'negativo'],
  [
    'vis_cadastro_iniciado',
    'Cadastro iniciado na hora',
    'visita',
    'cadastro_em_andamento',
    'quente',
    'positivo',
  ],
  ['vis_sem_perfil', 'Sem perfil (fora do ICP)', 'visita', 'perdido', null, 'negativo'],
  [
    'reu_interessado',
    'Realizada, interessado',
    'reuniao',
    'apresentacao_realizada',
    'quente',
    'positivo',
  ],
  [
    'reu_autorizou',
    'Realizada, autorizou',
    'reuniao',
    'cadastro_em_andamento',
    'quente',
    'positivo',
  ],
  [
    'reu_objecao',
    'Realizada, com objeção',
    'reuniao',
    'apresentacao_realizada',
    'quente',
    'mediano',
  ],
  ['reu_nao', 'Realizada, não', 'reuniao', 'perdido', null, 'negativo'],
  ['reu_no_show', 'No-show', 'reuniao', null, null, 'negativo'],
  ['reu_reagendada', 'Reagendada', 'reuniao', 'reuniao_marcada', 'quente', 'em_contato'],
  ['dm_sem_resposta', 'DM enviada, sem resposta', 'instagram_dm', null, null, 'mediano'],
  ['dm_respondeu', 'Respondeu na DM', 'instagram_dm', 'respondeu', 'morno', 'em_contato'],
  [
    'dm_pediu_whatsapp',
    'Pediu contato no WhatsApp',
    'instagram_dm',
    'respondeu',
    'morno',
    'em_contato',
  ],
  ['dm_nao_e_a_pessoa', 'Não é a pessoa', 'instagram_dm', null, null, 'mediano'],
  ['dm_perfil_inativo', 'Perfil inativo, não fornece', 'instagram_dm', 'perdido', null, 'negativo'],
  ['dm_optout', 'Pediu para parar', 'instagram_dm', 'optout', 'frio', 'negativo'],
];

function desfecho(linha: (typeof CATALOGO)[number]): DesfechoCatalogo {
  const [slug, name, superficie, etapa, temperatura] = linha;
  return {
    id: 1,
    slug,
    name,
    surfaces: [superficie],
    position: 1,
    cooldown_days: 0,
    can_reactivate: true,
    next_action_kind: null,
    next_action_label: null,
    next_action_offset_days: null,
    target_stage_slug: etapa,
    sets_temperature: temperatura,
    requires_lost_reason: false,
    counts_as: 'aberta',
  } as unknown as DesfechoCatalogo;
}

const porSlug = (slug: string) => desfecho(CATALOGO.find((linha) => linha[0] === slug)!);

describe('como foi, desfecho a desfecho', () => {
  it.each(CATALOGO)('%s é %s…', (...linha) => {
    expect(comoFoi(desfecho(linha)).categoria).toBe(linha[5]);
  });

  it('só a autorização ganha troféu', () => {
    const comTrofeu = CATALOGO.filter((linha) => comoFoi(desfecho(linha)).trofeu).map(
      (linha) => linha[0],
    );
    expect(comTrofeu).toEqual(['reu_autorizou']);
  });

  it('concorda com as cores do cartão da Agenda em toda reunião e visita', () => {
    const categoriaDoTom: Record<TomDoResultado, ComoFoi> = {
      sucesso: 'positivo',
      ausente: 'negativo',
      perda: 'negativo',
      adiado: 'negativo',
      // Âmbar nas duas telas: "Reagendado" no cartão, "Em contato" no Feito hoje.
      reagendado: 'em_contato',
      neutro: 'mediano',
    };
    const daAgenda = CATALOGO.filter((linha) => linha[2] === 'reuniao' || linha[2] === 'visita');
    expect(daAgenda).toHaveLength(13);
    for (const linha of daAgenda) {
      const tipo = linha[2] === 'visita' ? 'visita' : 'reuniao';
      const { tom, trofeu } = resultadoDoDesfecho(desfecho(linha), tipo);
      expect({ slug: linha[0], categoria: categoriaDoTom[tom], trofeu }).toEqual({
        slug: linha[0],
        ...comoFoi(desfecho(linha)),
      });
    }
  });

  it('diz o canal pela superfície do desfecho', () => {
    expect(canalDoDesfecho(porSlug('reu_interessado'))).toBe('Reunião');
    expect(canalDoDesfecho(porSlug('lig_nao_atendeu'))).toBe('Ligação');
    expect(canalDoDesfecho(porSlug('dm_respondeu'))).toBe('Instagram');
  });
});

describe('agruparFeitoHoje', () => {
  function registro(
    atividadeId: string,
    quando: string,
    organizacaoId: string | null,
    slug: string,
  ): RegistroDoDia {
    return {
      atividadeId,
      quando: `2026-09-28T${quando}:00-03:00`,
      organizacaoId,
      organizacao: organizacaoId ? `Parceiro ${organizacaoId}` : null,
      bairro: null,
      categoriaDoParceiro: null,
      desfecho: porSlug(slug),
    };
  }

  it('uma linha por parceiro, com o último resultado do dia', () => {
    // O Grupo Eden da base local: reagendado às 14:16, interessado às 14:45.
    const categorias = agruparFeitoHoje([
      registro('a1', '14:16', 'eden', 'reu_reagendada'),
      registro('a2', '14:45', 'eden', 'reu_interessado'),
    ]);
    const positivos = categorias.find((c) => c.id === 'positivo')!;
    expect(positivos.pessoas).toHaveLength(1);
    expect(positivos.pessoas[0]).toMatchObject({
      resultado: 'Realizada, interessado',
      anterioresHoje: 1,
    });
    expect(categorias.find((c) => c.id === 'mediano')!.pessoas).toEqual([]);
    expect(contarPessoas(categorias)).toBe(1);
  });

  it('devolve as quatro categorias na ordem de celebrar antes de cobrar', () => {
    const categorias = agruparFeitoHoje([registro('a1', '09:00', 'x', 'reu_nao')]);
    expect(categorias.map((c) => c.id)).toEqual(CATEGORIAS.map((c) => c.id));
    expect(categorias.map((c) => c.id)).toEqual(['positivo', 'em_contato', 'mediano', 'negativo']);
  });

  it('dentro da categoria, o mais recente primeiro', () => {
    const categorias = agruparFeitoHoje([
      registro('a1', '09:00', 'x', 'reu_autorizou'),
      registro('a2', '11:00', 'y', 'reu_interessado'),
    ]);
    const positivos = categorias.find((c) => c.id === 'positivo')!.pessoas;
    expect(positivos.map((p) => p.organizacaoId)).toEqual(['y', 'x']);
    expect(positivos.map((p) => p.trofeu)).toEqual([false, true]);
  });

  it('atividade sem parceiro não se junta com nenhuma outra', () => {
    const categorias = agruparFeitoHoje([
      registro('a1', '09:00', null, 'lig_nao_atendeu'),
      registro('a2', '10:00', null, 'lig_nao_atendeu'),
    ]);
    const medianos = categorias.find((c) => c.id === 'mediano')!.pessoas;
    expect(medianos).toHaveLength(2);
    expect(medianos[0]?.organizacao).toBe('Parceiro sem cadastro');
  });
});

describe('parceiro fora da carteira', () => {
  it('não vira "sem cadastro" nem link: diz que está fora da carteira', () => {
    const categorias = agruparFeitoHoje([
      {
        atividadeId: 'a1',
        quando: '2026-09-28T10:00:00-03:00',
        organizacaoId: 'org-de-outro',
        organizacao: null,
        bairro: null,
        categoriaDoParceiro: null,
        desfecho: porSlug('vis_funcionario'),
      },
      {
        atividadeId: 'a2',
        quando: '2026-09-28T11:00:00-03:00',
        organizacaoId: 'org-minha',
        organizacao: 'Buffet Alvorada',
        bairro: null,
        categoriaDoParceiro: null,
        desfecho: porSlug('vis_funcionario'),
      },
    ]);
    const medianos = categorias.find((c) => c.id === 'mediano')!.pessoas;
    expect(medianos.map((p) => [p.organizacao, p.naCarteira])).toEqual([
      ['Buffet Alvorada', true],
      ['Parceiro fora da sua carteira', false],
    ]);
  });
});
