/**
 * worker-ai — a IA do Tríade (ADR-05, ADR-09, ADR-10; anexos R08 e R13).
 *
 * O laço é o mesmo do coletor, e de propósito: lê uma fila, trata a mensagem,
 * bate ponto, repete. Toda a inteligência de guardrail está uma camada abaixo —
 * em `packages/prompts`, que é o único caminho até a API —, e toda a
 * contabilidade está no Postgres, que recalcula o custo a partir dos tokens
 * (ADR-03). Este arquivo não monta prompt, não decide preço e não envia nada.
 *
 * Uma fila só (`ai_jobs`), ao contrário das três do coletor: os quatro trabalhos
 * têm a mesma ordem de grandeza de tempo (uma chamada ao modelo) e nenhum deles
 * segura o outro. O que os separa é o `purpose` dentro da mensagem, e é o
 * `purpose` que também separa o custo em `ai_runs`.
 *
 * ## O que ele NUNCA faz
 *
 * Não envia mensagem de WhatsApp. O rascunho que a IA escreve entra em
 * `message_drafts` como `pendente` e espera uma pessoa aprovar (ADR-05,
 * RF-CON-22). Quem garante isso não é este código: é o gatilho
 * `app.message_drafts_guard`, que exige `auth.uid()` — e um worker com chave de
 * serviço não tem `auth.uid()`. A automação não aprova a si mesma nem em teoria.
 *
 * Encerramento: SIGINT e SIGTERM param depois da mensagem atual, nunca no meio.
 * Mensagem interrompida volta sozinha quando o `visibility timeout` expira, mas
 * terminar o que já começou é mais barato que reprocessar — e reprocessar uma
 * chamada ao modelo é gastar de novo.
 */
import { clienteAnthropic } from '../ia/cliente';
import { eDeterministico, tratarTrabalho } from '../ia/tarefas';
import {
  FILAS_DA_IA,
  chaveDaMensagem,
  concluirDaIa,
  criarClienteDaIa,
  falharDaIa,
  lerFilaDaIa,
} from '../ia/fila';
import { criarPulso } from '../lib/pulso';

import type { ContextoDaIa } from '../ia/execucao';
import type { WorkerContext } from '../lib/context';

/** Descanso entre voltas quando a fila está vazia. */
const DESCANSO_MS = 5_000;

/**
 * Quantas mensagens por leitura. Três, e não dez: cada uma é uma chamada paga a
 * um modelo, e o `visibility timeout` de `ai_jobs` é de 5 minutos — puxar um
 * lote grande e demorar nele é devolver o fim do lote para a fila.
 */
const POR_LEITURA = 3;

function dormir(ms: number): Promise<void> {
  return new Promise((resolva) => {
    setTimeout(resolva, ms);
  });
}

export async function runAi(ctx: WorkerContext<'ai'>): Promise<number> {
  const { env, logger, opcoes } = ctx;
  const umaVez = opcoes['uma-vez'] === true;

  const cliente = criarClienteDaIa(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  // O cliente real e o dublê entram pelo mesmo lugar: `ANTHROPIC_BASE_URL`
  // apontada para o dublê local faz este mesmo binário, com este mesmo SDK,
  // rodar o caminho inteiro sem credencial nenhuma.
  const modelo = clienteAnthropic({
    chave: env.ANTHROPIC_API_KEY,
    baseUrl: env.ANTHROPIC_BASE_URL,
  });
  const contexto: ContextoDaIa = { cliente, modelo, logger };

  const pulso = criarPulso({ cliente, logger, worker: 'ai' });
  const contagens = { tratados: 0, vazios: 0, bloqueados: 0, falhas: 0, custoUsd: 0 };

  await pulso.bater('ok', FILAS_DA_IA.trabalhos, {
    modo: umaVez ? 'uma-vez' : 'contínuo',
    base_do_modelo: env.ANTHROPIC_BASE_URL ?? 'api oficial',
  });
  pulso.iniciar();

  let parando = false;
  const pedirParada = (sinal: string): void => {
    if (parando) return;
    parando = true;
    logger.info('parada pedida: o worker encerra depois da mensagem atual', { sinal });
  };
  process.on('SIGINT', () => pedirParada('SIGINT'));
  process.on('SIGTERM', () => pedirParada('SIGTERM'));

  try {
    for (;;) {
      if (parando) break;

      const mensagens = await lerFilaDaIa(cliente, POR_LEITURA);

      for (const mensagem of mensagens) {
        const chave = chaveDaMensagem(mensagem);
        try {
          const resultado = await tratarTrabalho(contexto, mensagem.mensagem);
          await concluirDaIa(cliente, mensagem.msg_id, chave);
          if (resultado.feito) {
            contagens.tratados += 1;
            contagens.custoUsd += resultado.custoUsd ?? 0;
          } else {
            contagens.vazios += 1;
            logger.info('trabalho sem o que fazer', {
              proposito: resultado.proposito,
              motivo: resultado.motivo,
              msg_id: mensagem.msg_id,
            });
          }
        } catch (erro) {
          const texto = erro instanceof Error ? erro.message : String(erro);
          // Determinístico não gira: repetir gastaria a mesma recusa cinco
          // vezes, e no caso da IA gastar de novo é gastar dinheiro de novo.
          // O registro já está em `ai_runs` (e, no bloqueio, numa tarefa).
          if (eDeterministico(erro)) {
            contagens.bloqueados += 1;
            await concluirDaIa(cliente, mensagem.msg_id, chave);
            logger.warn('trabalho concluído sem resultado: erro determinístico', {
              msg_id: mensagem.msg_id,
              chave,
              erro: texto,
            });
            continue;
          }
          contagens.falhas += 1;
          const resultado = await falharDaIa(cliente, mensagem.msg_id, chave, texto);
          logger.error('trabalho falhou', {
            msg_id: mensagem.msg_id,
            chave,
            tentativa: resultado.tentativa,
            acao: resultado.acao,
            erro: texto,
          });
        }
      }

      pulso.somar(mensagens.length, 0);
      await pulso.bater(contagens.falhas > 0 ? 'degradado' : 'ok', FILAS_DA_IA.trabalhos, {
        ...contagens,
        custo_usd: Math.round(contagens.custoUsd * 1e5) / 1e5,
        modo: umaVez ? 'uma-vez' : 'contínuo',
      });

      if (mensagens.length > 0) continue;
      if (umaVez) break;
      await dormir(DESCANSO_MS);
    }

    logger.info('worker-ai encerrado', {
      ...contagens,
      custo_usd: Math.round(contagens.custoUsd * 1e5) / 1e5,
    });
    await pulso.bater('parado', FILAS_DA_IA.trabalhos, {
      ...contagens,
      encerrado_em: new Date().toISOString(),
    });
    return contagens.falhas > 0 ? 1 : 0;
  } finally {
    pulso.parar();
  }
}
