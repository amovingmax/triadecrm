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

import { ASR_PADRAO, type ConfiguracaoDoAsr } from '../ia/asr';
import { chamadaDeTeste } from '../ia/chamada-de-teste';
import type { ContextoDaIa } from '../ia/execucao';

/** O balde privado das mídias recebidas (migração 20260905000201). */
const BALDE_DE_MIDIAS = 'mensagens';

/**
 * O provedor de transcrição sai de `app_settings.ia.crm_inteligente.transcricao`,
 * não do código: trocar Groq por faster-whisper no dia em que a máquina dedicada
 * existir é um `update`, não um deploy.
 */
async function lerConfigDaTranscricao(
  cliente: ReturnType<typeof criarClienteDaIa>,
): Promise<ConfiguracaoDoAsr> {
  const { data } = await cliente
    .from('app_settings')
    .select('value')
    .eq('key', 'ia.crm_inteligente')
    .maybeSingle();
  const valor = (data?.value ?? {}) as Record<string, unknown>;
  const t = (valor.transcricao ?? {}) as Record<string, unknown>;
  return {
    provedor: typeof t.provedor === 'string' ? t.provedor : ASR_PADRAO.provedor,
    modelo: typeof t.modelo === 'string' ? t.modelo : ASR_PADRAO.modelo,
    duracaoMaximaSeg:
      typeof t.duracao_maxima_seg === 'number' ? t.duracao_maxima_seg : ASR_PADRAO.duracaoMaximaSeg,
  };
}
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
  const medir = opcoes['chamada-de-teste'] === true;

  const cliente = criarClienteDaIa(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  // O cliente real e o dublê entram pelo mesmo lugar: `ANTHROPIC_BASE_URL`
  // apontada para o dublê local faz este mesmo binário, com este mesmo SDK,
  // rodar o caminho inteiro sem credencial nenhuma.
  const modelo = clienteAnthropic({
    chave: env.ANTHROPIC_API_KEY,
    baseUrl: env.ANTHROPIC_BASE_URL,
  });
  // Quem ouve o áudio não é o Claude (a API dele não transcreve). O transcritor é
  // opcional: sem `GROQ_API_KEY` o worker sobe e trabalha todo o resto, e só a
  // tarefa de áudio recusa — com nome, no log (CRM Inteligente, Fase 1).
  const transcricao = await lerConfigDaTranscricao(cliente);
  if (env.GROQ_API_KEY === undefined) {
    logger.warn('sem GROQ_API_KEY: áudio recebido não vira transcrição', {
      provedor: transcricao.provedor,
    });
  }
  const contexto: ContextoDaIa = {
    cliente,
    modelo,
    logger,
    transcritor: {
      balde: BALDE_DE_MIDIAS,
      config: transcricao,
      chave: env.GROQ_API_KEY,
    },
  };

  // A medição do GATE 1: uma chamada real, o preço na tela, e sai. Não entra no
  // laço da fila e não toca conversa de ninguém — o dado é o exemplo do prompt.
  if (medir) {
    const t0 = Date.now();
    const r = await chamadaDeTeste(contexto);
    logger.info('chamada de teste concluída', {
      ai_run_id: r.aiRunId,
      prompt: r.promptVersion,
      modelo: r.modelo,
      custo_usd: r.custoUsd,
      latencia_ms: Date.now() - t0,
    });
    process.stdout.write(
      [
        `✓ Chamada real ao modelo: ${r.promptVersion} (${r.modelo})`,
        `  custo desta chamada: US$ ${r.custoUsd.toFixed(6)}`,
        `  ai_runs.id: ${r.aiRunId} — tokens e cache estão na linha`,
        `  o modelo devolveu score ${r.scoreIntencao}: ${r.resumo}`,
        '',
        '  Rode de novo para ver a leitura de cache: a segunda chamada do mesmo',
        '  prompt custa menos, e é dela que sai a projeção do mês.',
        '',
      ].join('\n'),
    );
    return 0;
  }

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
