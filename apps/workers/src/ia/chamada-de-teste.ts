/**
 * `workers ai --chamada-de-teste`: uma chamada real, e o preço dela na tela.
 *
 * ===========================================================================
 * POR QUE ISTO EXISTE
 * ===========================================================================
 * O GATE 1 do CRM Inteligente pede "custo real de uma chamada de teste". Estimativa
 * de tokens é conta de guardanapo: o que decide orçamento é o que a API cobra, com o
 * nosso prompt, no nosso formato de saída, com o cache ligado. Este comando faz essa
 * chamada uma vez, com uma conversa de EXEMPLO (a do próprio prompt, que não é de
 * ninguém), e imprime tokens de entrada, de saída, de cache e o custo em dólar.
 *
 * Ele passa pelo mesmo caminho de sempre — `prepararChamada`, pseudonimização,
 * auditoria de PII, validação da saída e linha em `ai_runs` — porque medir por um
 * atalho seria medir outra coisa. A única diferença é a origem dos dados: o exemplo
 * do prompt, e não uma conversa do banco.
 *
 * Rodar duas vezes seguidas é o teste do CACHE: a segunda chamada deve mostrar
 * leitura de cache e custar menos, e é isso que sustenta a projeção mensal.
 *
 * ===========================================================================
 * O CANAL DE CHEGADA (06/11/2026)
 * ===========================================================================
 * `--chamada-de-teste=canal-de-chegada --foto=/caminho/da/placa.jpg` faz a mesma
 * medição com `canal-de-chegada@v1`: a conversa é o primeiro exemplo do prompt ("Boa
 * tarde!", a foto, "Quanto está essa casa?") e a foto é o arquivo que a pessoa passar —
 * uma placa de teste fotografada para isso, nunca foto de cliente. Sem `--foto` o
 * comando recusa: medir o canal sem imagem mediria outra coisa. É a "1 chamada real com
 * foto de teste" da Fase 2 do desenho, antes de ligar a fila.
 */
import { readFile } from 'node:fs/promises';

import {
  canalDeChegadaV1,
  conferirImagens,
  fichaDaConversaV1,
  type EntradaDaFicha,
} from '@komune/prompts';

import { executar, type ContextoDaIa } from './execucao';

export const PROMPTS_DA_CHAMADA_DE_TESTE = ['ficha-da-conversa', 'canal-de-chegada'] as const;
export type PromptDaChamadaDeTeste = (typeof PROMPTS_DA_CHAMADA_DE_TESTE)[number];

export interface OpcoesDaChamadaDeTeste {
  /** Qual prompt medir. Sem nada, a ficha da conversa — o que o comando sempre mediu. */
  readonly prompt?: PromptDaChamadaDeTeste;
  /** Só para o canal de chegada: o arquivo da foto de teste (JPEG, PNG, WebP ou GIF). */
  readonly foto?: string;
}

export interface ResultadoDaChamadaDeTeste {
  readonly aiRunId: number;
  readonly custoUsd: number;
  readonly promptVersion: string;
  readonly modelo: string;
  /** Uma linha legível do que o modelo devolveu. */
  readonly resposta: string;
}

/**
 * A conversa de exemplo. Sai do próprio prompt (`exemplos[0]`), que é fixture e
 * não dado de parceiro: o comando não lê conversa real, para poder ser rodado em
 * produção sem tocar em ninguém.
 */
export function conversaDeExemplo(): EntradaDaFicha {
  const exemplo = fichaDaConversaV1.exemplos[0];
  if (exemplo === undefined) {
    throw new Error('ficha-da-conversa@v1 sem exemplo: não há o que medir');
  }
  return exemplo.entrada;
}

export function ePromptDaChamadaDeTeste(valor: unknown): valor is PromptDaChamadaDeTeste {
  return (
    typeof valor === 'string' && (PROMPTS_DA_CHAMADA_DE_TESTE as readonly string[]).includes(valor)
  );
}

export async function chamadaDeTeste(
  contexto: ContextoDaIa,
  opcoes: OpcoesDaChamadaDeTeste = {},
): Promise<ResultadoDaChamadaDeTeste> {
  if (opcoes.prompt === 'canal-de-chegada') return await canalDeTeste(contexto, opcoes.foto);

  const entrada = conversaDeExemplo();

  const executada = await executar(
    contexto,
    fichaDaConversaV1,
    entrada,
    // Sem contato e sem ficha: a medição não pertence a nenhuma organização, e por
    // isso não entra no custo de ninguém — só no total do mês.
    { leadId: entrada.leadId, nome: null, empresa: null },
    {},
  );

  return {
    aiRunId: executada.aiRunId,
    custoUsd: executada.custoUsd,
    promptVersion: executada.promptVersion,
    modelo: fichaDaConversaV1.modelo,
    resposta: `score ${executada.saida.scoreIntencao}: ${executada.saida.resumo}`,
  };
}

/** O canal de chegada com UMA foto de teste: o exemplo do prompt, a foto do arquivo. */
async function canalDeTeste(
  contexto: ContextoDaIa,
  caminho: string | undefined,
): Promise<ResultadoDaChamadaDeTeste> {
  if (caminho === undefined || caminho.trim() === '') {
    throw new Error(
      'a chamada de teste do canal de chegada precisa de uma foto: --foto=/caminho/da/placa.jpg',
    );
  }
  const exemplo = canalDeChegadaV1.exemplos[0];
  if (exemplo === undefined) throw new Error('canal-de-chegada@v1 sem exemplo: não há o que medir');
  const comFoto = exemplo.entrada.mensagens.find((m) => m.fotoId !== null);
  if (comFoto?.fotoId == null) throw new Error('o exemplo do canal de chegada não tem foto');

  const bytes = await readFile(caminho);
  // O tipo de verdade sai dos bytes, na porteira; o `mime` aqui é só o palpite. A
  // porteira roda antes para a medição não sair SEM a foto sem ninguém perceber.
  const imagem = {
    mime: 'image/jpeg',
    base64: bytes.toString('base64'),
    rotulo: `Foto ${comFoto.fotoId}, enviada na mensagem ${comFoto.messageId}`,
  };
  const conferidas = conferirImagens(canalDeChegadaV1, [imagem]);
  const recusada = conferidas.descartadas[0];
  if (recusada !== undefined) {
    throw new Error(`a foto ${caminho} não passa na porteira das imagens: ${recusada.motivo}`);
  }

  const executada = await executar(
    contexto,
    canalDeChegadaV1,
    exemplo.entrada,
    { leadId: exemplo.entrada.leadId, nome: null },
    {},
    { imagens: [imagem] },
  );

  const lida = executada.saida;
  const foto =
    lida.foto === null
      ? 'sem foto descrita'
      : `foto ${lida.foto.peca}/${lida.foto.marca}, código ${lida.foto.codigoDoImovel ?? '—'}: ${lida.foto.descricao}`;
  return {
    aiRunId: executada.aiRunId,
    custoUsd: executada.custoUsd,
    promptVersion: executada.promptVersion,
    modelo: canalDeChegadaV1.modelo,
    resposta: `${lida.canal}/${lida.subcanal} (${lida.confianca}) — ${lida.motivo} [${foto}]`,
  };
}
