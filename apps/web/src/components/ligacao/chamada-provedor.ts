'use client';

import { abrirChamada, ErroDaLigacao } from './chamada-rpc';
import {
  linkDoDiscador,
  PROVEDOR_ATUAL,
  type ChamadaEmCurso,
  type EventoTelefonia,
  type ProvedorTelefonia,
  type ResultadoTecnico,
} from './tipos';

/**
 * O adaptador `manual` — o único que existe hoje, e o motivo pelo qual o Matheus
 * consegue ligar HOJE (R13 §3.4 e a restrição que manda no desenho: não há discador
 * contratado, não há credencial, não há contrato).
 *
 * O que ele faz é pouco de propósito: abre a tentativa no banco (`iniciar_chamada`),
 * devolve o número para o `tel:` do aparelho e emite os MESMOS eventos que um
 * discador de verdade emitiria — só que com `origem: 'operador'`, porque quem sabe o
 * que aconteceu na linha é quem está com o fone. Não há AMD aqui, e por isso
 * `detectaAtendimento` é `false`: a tela nunca finge saber que alguém atendeu.
 *
 * O dia em que houver discador, o que muda é este arquivo: `iniciarChamada` passa a
 * mandar o comando pela API, `aoEvento` passa a receber do WebSocket (R13 §3.4: pelo
 * menos um fornecedor brasileiro não manda webhook) e `origem` passa a `'provedor'`.
 * A tela não muda de forma, porque ela só conhece `ProvedorTelefonia`.
 */
export function criarProvedorManual(): ProvedorTelefonia & {
  /** A pessoa entrou na árvore do roteiro: alguém atendeu. */
  marcarAtendida(): void;
  /** O `tel:` deste número, para o botão que abre o discador do aparelho. */
  linkDoDiscador(telefone: string): string;
} {
  const ouvintes = new Set<(e: EventoTelefonia) => void>();

  function emitir(evento: EventoTelefonia) {
    for (const ouvinte of ouvintes) ouvinte(evento);
  }

  return {
    id: PROVEDOR_ATUAL,
    detectaAtendimento: false,

    async iniciarChamada({ telefone, itemId }): Promise<ChamadaEmCurso> {
      const resposta = await abrirChamada(itemId);
      if (!resposta.ok) throw new ErroDaLigacao(resposta.frase, false);

      emitir({ tipo: 'discando', em: resposta.iniciadaEm, origem: 'operador' });
      return {
        id: resposta.chamadaId,
        itemId: resposta.itemId,
        telefone: resposta.telefone || telefone,
        iniciadaEm: resposta.iniciadaEm,
        provedor: PROVEDOR_ATUAL,
      };
    },

    async encerrar(_chamadaId: string, resultado: ResultadoTecnico): Promise<void> {
      // No modo manual não há comando de desligar: quem desliga é a pessoa. O que
      // existe é o evento, para o cronômetro parar e a tabulação saber a duração.
      emitir({ tipo: 'encerrada', em: new Date().toISOString(), origem: 'operador', resultado });
    },

    aoEvento(ouvinte) {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },

    marcarAtendida() {
      emitir({ tipo: 'atendida', em: new Date().toISOString(), origem: 'operador' });
    },

    linkDoDiscador,
  };
}
