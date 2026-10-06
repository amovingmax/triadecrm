'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { marcarComoLida } from './acoes';
import { CHAVE_CONVERSAS } from './dados';

/**
 * QUANDO UMA CONVERSA CONTA COMO LIDA (06/10/2026).
 *
 * ===========================================================================
 * LER E ATENDER SÃO DUAS PERGUNTAS, E CADA UMA TEM O SEU SINAL
 * ===========================================================================
 * Em 05/10 o "por ler" passou a sair só com a resposta do time, junto com a
 * marca "Nova" e o número do menu (Janio: "ler não é atender"). No dia
 * seguinte, o pedido contrário: "eu to visualizando as mensagens do povo, mas n
 * ta contabilizando que ta sendo visualizada". Perguntado entre as duas regras,
 * a resposta foi "sai ao abrir".
 *
 * As duas cabem, porque são sinais diferentes:
 *   - **"por ler"** (`conversations.unread_count`) responde "alguém já viu?".
 *     Sai ao abrir — é esta peça.
 *   - **a marca "Nova" e o número ao lado de Conversas** respondem "alguém já
 *     respondeu?". Continuam saindo só com a resposta (`semResposta`, em
 *     `avisos/regra.ts`). Quem abre para conferir e fecha tira o "por ler", e a
 *     conversa segue marcada até alguém atender.
 *
 * Responder também zera o "por ler", mas quem faz isso é o banco (gatilho
 * `messages_quem_responde_leu`), para valer por qualquer caminho.
 *
 * ===========================================================================
 * AS TRÊS CONDIÇÕES
 * ===========================================================================
 * - **A pessoa ESCOLHEU a conversa.** O desktop abre a primeira da lista sem
 *   ninguém pedir, e quem tem mensagem por ler vem primeiro. Zerar ali faria
 *   cada pessoa que entra na tela apagar, para o time inteiro, o sinal da
 *   conversa do topo — o contador é da conversa, não de quem olha. Clicar,
 *   rolar ou digitar dentro dela vale como escolha (`tela-conversas.tsx`).
 * - **A janela está na frente dela.** Aba escondida ou outro programa em foco
 *   não é leitura: a mensagem que chega enquanto a pessoa está no e-mail
 *   continua por ler até ela voltar. É a regra do WhatsApp Web.
 * - **Há o que marcar.**
 *
 * E vale enquanto a conversa estiver aberta, não só na abertura: a mensagem que
 * chega com a conversa na frente da pessoa é marcada na hora.
 */
export function deveMarcarComoLida({
  escolhida,
  naTela,
  fioId,
  naoLidas,
}: {
  escolhida: boolean;
  naTela: boolean;
  fioId: string | null;
  naoLidas: number;
}): boolean {
  return escolhida && naTela && fioId !== null && naoLidas > 0;
}

const SINAIS_DE_FOCO = ['focus', 'blur', 'visibilitychange'] as const;

function assinarFoco(avisar: () => void): () => void {
  for (const sinal of SINAIS_DE_FOCO) {
    // `visibilitychange` é do documento e borbulha até a janela; `focus` e
    // `blur` são dela. Um alvo só para os três.
    window.addEventListener(sinal, avisar, true);
  }
  return () => {
    for (const sinal of SINAIS_DE_FOCO) window.removeEventListener(sinal, avisar, true);
  };
}

function janelaNaFrente(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

/** A janela do CRM está visível E é onde a pessoa está digitando ou clicando. */
export function useJanelaNaFrente(): boolean {
  // No servidor ninguém está olhando: `false` adia a marcação para o navegador.
  return useSyncExternalStore(assinarFoco, janelaNaFrente, () => false);
}

/**
 * Zera o "por ler" do fio aberto, e continua zerando enquanto ele estiver aberto.
 *
 * `naoLidas` e `ultimaEntradaEm` vêm da LISTA (`CHAVE_CONVERSAS`), que é a
 * mesma leitura que pinta o número ao lado do nome — e é ela que se busca de
 * novo depois de marcar. Assim o efeito e o número na tela nunca discordam.
 *
 * `ultimaEntradaEm` está nas dependências sem aparecer no corpo, e é de
 * propósito: se uma mensagem chega no instante em que a anterior está sendo
 * marcada, o contador volta ao MESMO número (1 → 0 → 1) e só a hora da última
 * entrada conta que há uma mensagem nova para marcar.
 *
 * Falhar aqui não atrapalha ninguém: o contador continua como estava e a
 * pessoa lê a conversa do mesmo jeito. Barulho por isso seria ruído.
 */
export function useLeituraDoFio({
  fioId,
  naoLidas,
  ultimaEntradaEm,
  escolhida,
}: {
  fioId: string | null;
  naoLidas: number;
  ultimaEntradaEm: string | null;
  /** Ver `deveMarcarComoLida`: a abertura automática do desktop não conta. */
  escolhida: boolean;
}): void {
  const clientes = useQueryClient();
  const naTela = useJanelaNaFrente();

  useEffect(() => {
    if (fioId === null || !deveMarcarComoLida({ escolhida, naTela, fioId, naoLidas })) return;
    void marcarComoLida(fioId)
      .then((marcou) => {
        if (marcou) void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      })
      .catch(() => undefined);
  }, [escolhida, naTela, fioId, naoLidas, ultimaEntradaEm, clientes]);
}
