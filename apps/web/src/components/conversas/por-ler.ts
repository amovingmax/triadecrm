'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { maisRecente } from '@/components/avisos/regra';

import { marcarComoLida } from './acoes';
import { CHAVE_CONVERSAS } from './dados';
import { CHAVE_FORA_DA_BASE } from './fora-da-base-dados';
import type { MensagemCrua } from './mensagens';

/**
 * Quando o "por ler" (`conversations.unread_count`) volta a zero.
 *
 * ===========================================================================
 * LER NÃO É ATENDER (05/10/2026)
 * ===========================================================================
 * Até aqui o número zerava quando alguém ABRIA a conversa. Janio: "se eu clicar
 * na conversa somente para ler o que foi falado, a notificação e a identidade
 * visual já somem, o que não é o ideal. O correto seria sair somente quando
 * alguém mandasse um 'Bom dia' ou alguma mensagem". Quem abre para conferir e
 * fecha deixava a conversa com cara de resolvida, e o cliente esperando.
 *
 * Agora o número zera quando há resposta do time depois da última mensagem
 * recebida — a mesma régua da marca "Nova" (`semResposta`, em `avisos/regra.ts`)
 * e do dono da conversa (`app.messages_quem_responde_atende`): saída do CRM
 * escrita ou gravada por gente, ou rascunho da IA aprovado por gente. Modelo,
 * resposta automática e envio que falhou não contam.
 *
 * Quem zera é a tela que tem a conversa aberta, ao ver a resposta chegar — em
 * geral a de quem acabou de responder. Nada aqui toca o envio: a escrita é a
 * mesma de antes (`marcarComoLida`), só em outro momento.
 */

/** A mensagem é resposta de alguém do time? */
export function ehRespostaDoTime(m: MensagemCrua): boolean {
  return (
    m.direction === 'out' &&
    m.origin === 'crm' &&
    (m.author_kind === 'human' || m.author_kind === 'bot_ai') &&
    m.type !== 'template' &&
    m.status !== 'failed'
  );
}

/**
 * A última mensagem recebida já tem resposta do time? `false` quando nada foi
 * recebido: não há o que responder, e o "por ler" nem existe.
 */
export function respondidaDepoisDaEntrada(mensagens: readonly MensagemCrua[]): boolean {
  let entrada: string | null = null;
  let resposta: string | null = null;
  for (const m of mensagens) {
    if (m.direction === 'in') {
      if (entrada === null || maisRecente(m.created_at, entrada) > 0) entrada = m.created_at;
    } else if (ehRespostaDoTime(m)) {
      if (resposta === null || maisRecente(m.created_at, resposta) > 0) resposta = m.created_at;
    }
  }
  if (entrada === null || resposta === null) return false;
  return maisRecente(resposta, entrada) >= 0;
}

/**
 * Zera o "por ler" da conversa aberta quando a resposta aparece nela. Uma vez
 * por resposta: o `ref` guarda a última entrada já tratada, e o efeito não
 * dispara de novo a cada repintura.
 *
 * `mensagens` são as da conversa `fioId` (quem chama filtra), ou `undefined`
 * enquanto a leitura não voltou.
 */
export function useZerarPorLerAoResponder(
  fioId: string | null,
  naoLidas: number,
  mensagens: readonly MensagemCrua[] | undefined,
): void {
  const clientes = useQueryClient();
  const jaZerado = useRef<string | null>(null);
  const respondida = mensagens ? respondidaDepoisDaEntrada(mensagens) : false;
  const marco = fioId && mensagens ? `${fioId}:${mensagens.length}` : null;

  useEffect(() => {
    if (!fioId || !marco || naoLidas === 0 || !respondida) return;
    if (jaZerado.current === marco) return;
    jaZerado.current = marco;
    void marcarComoLida(fioId)
      .then(() =>
        Promise.all([
          clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS }),
          clientes.invalidateQueries({ queryKey: CHAVE_FORA_DA_BASE }),
        ]),
      )
      // Falhar aqui não atrapalha ninguém: o contador continua como estava e a
      // próxima resposta tenta de novo. Barulho por isso seria ruído.
      .catch(() => undefined);
  }, [fioId, marco, naoLidas, respondida, clientes]);
}
