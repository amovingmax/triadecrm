'use client';

import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { carregarQuadro, moverNegocio } from './acoes/consultas';
import { fraseDaFalha, mensagemDaRecusa } from './acoes/erros';
import {
  CARTOES_POR_ETAPA,
  chaveDoQuadro,
  type CamposEtapa,
  type CartaoQuadro,
  type FiltrosQuadro,
  type MotivoRecusaMover,
  type ProximaAcao,
  type Quadro,
  type ResultadoMover,
} from './tipos';

/**
 * O estado do quadro kanban no navegador (RF-FUN-01/02/03).
 *
 * A camada de rede é a do vizinho (`./acoes/consultas`): aqui só mora o que o
 * TanStack Query precisa saber — a chave de cache, a atualização otimista e a
 * reversão quando o banco recusa. Três decisões que valem como especificação:
 *
 * 1. **Mover é otimista, e a reversão é o caso comum, não a exceção.** O `move_deal`
 *    recusa por regra de negócio (falta próxima ação, falta campo da etapa, motivo de
 *    perda fora da lista) com a mesma frequência com que aceita. Por isso a mutação
 *    guarda o quadro inteiro antes de mexer, e `onError` devolve exatamente aquele
 *    objeto: nada de "tentar desfazer o que eu fiz", que erra quando duas pessoas
 *    mexem no mesmo cartão.
 *
 * 2. **Recusa vira aviso na tela, nunca linha de console.** A Heloísa está na rua com
 *    o cartão voltando para a coluna de origem; se ninguém disser por quê, ela arrasta
 *    de novo. O `aviso` fica pendurado no hook e some quando ela move outro cartão,
 *    fecha o aviso ou o movimento dá certo.
 *
 * 3. **Sucesso não recarrega o quadro.** O `move_deal` devolve o cartão já recalculado
 *    (etapa, temperatura, semáforo, dias na etapa): reconciliar com esse objeto é uma
 *    ida à rede a menos e não perde as páginas extras que a coluna já carregou. Só
 *    `etapa_mudou` (alguém moveu antes) força recarregar, porque aí o quadro na tela
 *    é que está errado.
 */

// ---------------------------------------------------------------------------
// O quadro
// ---------------------------------------------------------------------------

/**
 * Uma página do quadro.
 *
 * `etapaId` preenchido é o modo do celular: a RPC devolve todas as etapas com a
 * contagem e os cartões só da etapa aberta (é o `p_stage_id` do contrato). No
 * desktop ele é nulo e cada coluna vem com os primeiros `CARTOES_POR_ETAPA`.
 */
export function useQuadro(filtros: FiltrosQuadro, funilId: number | null) {
  return useQuery({
    queryKey: chaveDoQuadro(filtros),
    enabled: funilId !== null,
    queryFn: () =>
      carregarQuadro({
        p_pipeline_id: funilId ?? 0,
        p_only_mine: filtros.apenasMeus,
        p_owner_id: null,
        p_q: filtros.q.trim() || null,
        p_stage_id: filtros.etapaId,
        p_limit_per_stage: CARTOES_POR_ETAPA,
        p_offset: 0,
      }),
    // Trocar de funil ou digitar na busca mantém o quadro anterior na tela, apagado,
    // em vez de piscar em branco: a pessoa continua vendo onde estava.
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Aviso: o que a Heloísa lê quando o banco recusa
// ---------------------------------------------------------------------------

export type AvisoDoQuadro = {
  /** Frase principal, já em pt-BR. */
  titulo: string;
  /** Complemento: o que falta, ou o que fazer agora. */
  detalhe: string | null;
  /** `recusa` = regra de negócio (a pessoa corrige); `falha` = técnico (rede, sessão). */
  tom: 'recusa' | 'falha';
  /** Motivo nomeado quando veio do `move_deal`; ajuda quem monta a tela a abrir o formulário certo. */
  motivo: MotivoRecusaMover | null;
};

/** Recusa esperada do `move_deal`, embrulhada para viajar pelo `onError` da mutação. */
export class RecusaDeMover extends Error {
  readonly recusa: Extract<ResultadoMover, { ok: false }>;

  constructor(recusa: Extract<ResultadoMover, { ok: false }>) {
    super(mensagemDaRecusa(recusa.reason));
    this.name = 'RecusaDeMover';
    this.recusa = recusa;
  }
}

/** Lista de campos que faltam, em uma frase ("Faltam: Formato, Data e hora."). */
function detalheDaRecusa(recusa: Extract<ResultadoMover, { ok: false }>): string | null {
  if (recusa.reason === 'campos_obrigatorios' && recusa.missing?.length) {
    return `Falta preencher: ${recusa.missing.map((c) => c.label).join(', ')}.`;
  }
  if (recusa.reason === 'proxima_acao_obrigatoria') {
    return 'Abra o cartão, diga o que vem depois e mova de novo.';
  }
  if (recusa.reason === 'etapa_mudou') {
    return 'O quadro está sendo recarregado com a posição de agora.';
  }
  return null;
}

export function avisoDoErro(erro: unknown): AvisoDoQuadro {
  if (erro instanceof RecusaDeMover) {
    return {
      titulo: mensagemDaRecusa(erro.recusa.reason),
      detalhe: detalheDaRecusa(erro.recusa),
      tom: 'recusa',
      motivo: erro.recusa.reason,
    };
  }
  return { titulo: fraseDaFalha(erro), detalhe: null, tom: 'falha', motivo: null };
}

// ---------------------------------------------------------------------------
// Cirurgia no cache: mover, reconciliar e emendar página
// ---------------------------------------------------------------------------

/** Tira o cartão da etapa de origem e o põe no topo da etapa de destino. */
function moverNoQuadro(
  quadro: Quadro,
  cartao: CartaoQuadro,
  deEtapaId: number,
  paraEtapaId: number,
): Quadro {
  return {
    ...quadro,
    stages: quadro.stages.map((etapa) => {
      if (etapa.id === deEtapaId) {
        const cards = etapa.cards.filter((c) => c.deal_id !== cartao.deal_id);
        return { ...etapa, cards, total: Math.max(0, etapa.total - 1) };
      }
      if (etapa.id === paraEtapaId) {
        // No modo de uma etapa só (celular) a coluna de destino não tem cartões
        // carregados: soltar um cartão ali só muda a contagem, e é o certo — a lista
        // que está na tela é a da etapa aberta.
        const cards = etapa.cards.some((c) => c.deal_id === cartao.deal_id)
          ? etapa.cards
          : [cartao, ...etapa.cards];
        return { ...etapa, cards, total: etapa.total + 1 };
      }
      return etapa;
    }),
  };
}

/** Troca o cartão pela versão que o banco devolveu (temperatura e semáforo já recalculados). */
function reconciliarCartao(quadro: Quadro, cartao: CartaoQuadro, etapaId: number): Quadro {
  return {
    ...quadro,
    stages: quadro.stages.map((etapa) => {
      if (etapa.id !== etapaId) return etapa;
      const jaEsta = etapa.cards.some((c) => c.deal_id === cartao.deal_id);
      return {
        ...etapa,
        cards: jaEsta
          ? etapa.cards.map((c) => (c.deal_id === cartao.deal_id ? cartao : c))
          : etapa.cards,
      };
    }),
  };
}

/** Emenda a página nova no fim da coluna, sem repetir cartão que já estava lá. */
function emendarPagina(quadro: Quadro, pagina: Quadro, etapaId: number): Quadro {
  const nova = pagina.stages.find((e) => e.id === etapaId);
  if (!nova) return quadro;

  return {
    ...quadro,
    stages: quadro.stages.map((etapa) => {
      if (etapa.id !== etapaId) return etapa;
      const vistos = new Set(etapa.cards.map((c) => c.deal_id));
      return {
        ...etapa,
        total: nova.total,
        cards: [...etapa.cards, ...nova.cards.filter((c) => !vistos.has(c.deal_id))],
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Mover o cartão
// ---------------------------------------------------------------------------

/** O que a tela manda para mover um cartão. Os extras vêm do formulário da etapa. */
export type PedidoDeMovimento = {
  cartao: CartaoQuadro;
  deEtapaId: number;
  paraEtapaId: number;
  /** Vai para `deal_stage_history.reason` (RF-FUN-08). */
  motivo?: string | null;
  /** Campos obrigatórios da etapa (RF-FUN-04). */
  campos?: CamposEtapa | null;
  /** Próxima ação (RF-FUN-03). */
  proximaAcao?: ProximaAcao | null;
};

/**
 * A mutação de mover, com atualização otimista e reversão.
 *
 * Devolve também o `aviso` (o que deu errado, em pt-BR) e o `deal_id` que está em
 * voo, para a coluna deixar o cartão apagado enquanto o banco não responde.
 */
export function useMoverCartao(filtros: FiltrosQuadro) {
  const cliente = useQueryClient();
  const chave = useMemo(() => chaveDoQuadro(filtros), [filtros]);
  const [aviso, setAviso] = useState<AvisoDoQuadro | null>(null);
  const [ultimoClaim, setUltimoClaim] = useState<string | null>(null);

  const mutacao = useMutation({
    mutationFn: async (pedido: PedidoDeMovimento) => {
      const resultado = await moverNegocio({
        p_deal_id: pedido.cartao.deal_id,
        p_to_stage_id: pedido.paraEtapaId,
        p_expected_stage_id: pedido.deEtapaId,
        p_reason: pedido.motivo ?? null,
        p_fields: pedido.campos ?? {},
        p_next_action: pedido.proximaAcao ?? null,
      });
      // Recusa esperada vira exceção AQUI, e só aqui: é o que faz o TanStack Query
      // chamar `onError` e reverter o cartão para a coluna de origem.
      if (!resultado.ok) throw new RecusaDeMover(resultado);
      return resultado;
    },

    onMutate: async (pedido) => {
      setAviso(null);
      setUltimoClaim(null);
      await cliente.cancelQueries({ queryKey: chave });
      const anterior = cliente.getQueryData<Quadro>(chave);
      if (anterior) {
        cliente.setQueryData<Quadro>(
          chave,
          moverNoQuadro(anterior, pedido.cartao, pedido.deEtapaId, pedido.paraEtapaId),
        );
      }
      return { anterior };
    },

    onError: (erro, _pedido, contexto) => {
      // Reversão: volta o quadro exatamente como estava antes do arraste.
      if (contexto?.anterior) cliente.setQueryData<Quadro>(chave, contexto.anterior);
      const aviso = avisoDoErro(erro);
      setAviso(aviso);
      // Dois lugares de propósito: o `toast` aparece onde a pessoa está olhando (ela
      // acabou de soltar o cartão, talvez no fim de uma coluna rolada), e o aviso da
      // barra fica até ela fechar. Nenhum dos dois é o console.
      toast.error(aviso.titulo, { description: aviso.detalhe ?? undefined });
      // Alguém moveu o cartão antes: o quadro na tela é que está velho.
      if (erro instanceof RecusaDeMover && erro.recusa.reason === 'etapa_mudou') {
        void cliente.invalidateQueries({ queryKey: chave });
      }
    },

    onSuccess: (resultado) => {
      cliente.setQueryData<Quadro>(chave, (quadro) =>
        quadro ? reconciliarCartao(quadro, resultado.card, resultado.to_stage_id) : quadro,
      );
      // "Negócio sem dono é do bolo comum e quem move o assume" (migração 000900).
      // Isso muda a carteira da pessoa: ela precisa saber que aconteceu.
      if (resultado.claimed) {
        setUltimoClaim(resultado.card.organization_name);
        toast.success(`${resultado.card.organization_name} agora é da sua carteira.`, {
          description: 'O negócio estava sem responsável e passou para você ao ser movido.',
        });
      }
    },
  });

  return {
    mover: mutacao.mutate,
    movendo: mutacao.isPending,
    /** `deal_id` do cartão que está em voo, para apagá-lo enquanto espera. */
    cartaoEmVoo: mutacao.isPending ? (mutacao.variables?.cartao.deal_id ?? null) : null,
    aviso,
    limparAviso: useCallback(() => setAviso(null), []),
    /** Nome do parceiro que acabou de virar carteira de quem moveu; `null` fora disso. */
    assumido: ultimoClaim,
    limparAssumido: useCallback(() => setUltimoClaim(null), []),
  };
}

// ---------------------------------------------------------------------------
// Carregar mais cartões de uma coluna
// ---------------------------------------------------------------------------

/**
 * "Carregar mais" de uma coluna.
 *
 * A RPC já sabe paginar dentro de uma etapa (`p_stage_id` + `p_offset`), então a
 * página nova custa uma consulta pequena e é emendada no cache do quadro. Não
 * invalidamos nada: recarregar o quadro inteiro perderia as páginas das outras
 * colunas e devolveria a pessoa ao topo.
 */
export function useCarregarMais(filtros: FiltrosQuadro, funilId: number | null) {
  const cliente = useQueryClient();
  const chave = useMemo(() => chaveDoQuadro(filtros), [filtros]);
  const [aviso, setAviso] = useState<AvisoDoQuadro | null>(null);

  const mutacao = useMutation({
    mutationFn: ({ etapaId, carregados }: { etapaId: number; carregados: number }) =>
      carregarQuadro({
        p_pipeline_id: funilId ?? 0,
        p_only_mine: filtros.apenasMeus,
        p_owner_id: null,
        p_q: filtros.q.trim() || null,
        p_stage_id: etapaId,
        p_limit_per_stage: CARTOES_POR_ETAPA,
        p_offset: carregados,
      }),
    onSuccess: (pagina, { etapaId }) => {
      setAviso(null);
      cliente.setQueryData<Quadro>(chave, (quadro) =>
        quadro ? emendarPagina(quadro, pagina, etapaId) : quadro,
      );
    },
    onError: (erro) => setAviso(avisoDoErro(erro)),
  });

  return {
    limparAviso: useCallback(() => setAviso(null), []),
    carregarMais: mutacao.mutate,
    /** Id da etapa que está buscando a próxima página, para o botão dizer "Carregando". */
    etapaCarregando: mutacao.isPending ? (mutacao.variables?.etapaId ?? null) : null,
    aviso,
  };
}

// ---------------------------------------------------------------------------
// Leituras derivadas do quadro
// ---------------------------------------------------------------------------

/** Quantos negócios o funil inteiro tem depois dos filtros (soma das colunas). */
export function totalDoQuadro(quadro: Quadro | undefined): number {
  return (quadro?.stages ?? []).reduce((soma, etapa) => soma + etapa.total, 0);
}
