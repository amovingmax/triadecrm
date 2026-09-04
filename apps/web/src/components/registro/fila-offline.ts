'use client';

import {
  registroContatoSchema,
  CHAVE_FILA_REGISTRO,
  ESPERA_DESFAZER_MS,
  MAX_TENTATIVAS_FILA,
} from './tipos';
import type { RegistroContato, RegistroNaFila } from './tipos';
import { ErroDeRegistro, fraseDaRecusa, gravarRegistro } from './gravar';

/**
 * Fila dos registros que ainda não subiram. É o caderninho da Heloísa.
 *
 * A regra da casa é uma só: **o pedido é escrito no aparelho ANTES de qualquer ida à
 * rede** — no toque do desfecho, junto com o commit, antes mesmo da janela de 5
 * segundos do desfazer. Guardar só depois de a rede falhar deixava um buraco de 5
 * segundos por registro: aba fechada, celular sem bateria ou app derrubado ali dentro
 * e o trabalho sumia sem aviso. Persistindo antes, o pior caso vira "sobe no próximo
 * carregamento da tela".
 *
 * `enviarApos` é a janela do desfazer dentro da fila: o dreno automático não toca em
 * item cujo prazo ainda não venceu, para não furar o "Desfazer" quando a rede volta
 * no meio da contagem. Depois de um tombo, esse prazo já passou e o item sobe sozinho.
 *
 * Reenviar não duplica: a `clientKey` tem índice único parcial em
 * `activities ((metadata->>'client_key'))` (migração `20260904001100`), e a RPC
 * devolve a atividade que já existe em vez de gravar outra.
 *
 * Nada sai da fila em silêncio. Sai por três motivos, e só: gravou, a pessoa desfez,
 * ou a pessoa mandou descartar. Erro que não vale a pena repetir sozinho (sessão
 * vencida, recusa do servidor, tentativas esgotadas) marca `esgotado` e o item FICA
 * visível na tela, com o motivo e um botão de tentar de novo.
 *
 * Todo acesso ao `localStorage` é protegido: aba privada, cota cheia ou armazenamento
 * bloqueado levantam exceção, e derrubar a tela por causa disso seria pior.
 */

/** `window` não existe no build do servidor; `localStorage` pode estar bloqueado. */
function deposito(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function ler(): RegistroNaFila[] {
  try {
    const bruto = deposito()?.getItem(CHAVE_FILA_REGISTRO);
    if (!bruto) return [];
    const lista: unknown = JSON.parse(bruto);
    if (!Array.isArray(lista)) return [];
    return lista.flatMap((item) => {
      const linha = item as Partial<RegistroNaFila>;
      const pedido = registroContatoSchema.safeParse(linha.pedido);
      if (!pedido.success || typeof linha.clientKey !== 'string') return [];
      const criadoEm = linha.criadoEm ?? new Date().toISOString();
      return [
        {
          clientKey: linha.clientKey,
          criadoEm,
          tentativas: linha.tentativas ?? 0,
          ultimoErro: linha.ultimoErro ?? null,
          parceiro: linha.parceiro ?? 'Parceiro',
          desfecho: linha.desfecho ?? 'Contato',
          // Item gravado por uma versão anterior da tela não tem prazo: já venceu.
          enviarApos: linha.enviarApos ?? criadoEm,
          esgotado: linha.esgotado ?? false,
          pedido: pedido.data,
        } satisfies RegistroNaFila,
      ];
    });
  } catch {
    return [];
  }
}

function escrever(fila: readonly RegistroNaFila[]): boolean {
  const onde = deposito();
  if (!onde) return false;
  try {
    onde.setItem(CHAVE_FILA_REGISTRO, JSON.stringify(fila));
    return true;
  } catch {
    return false;
  }
}

export function lerFila(): RegistroNaFila[] {
  return ler();
}

/**
 * Escreve a intenção de gravar. Chamado NO COMMIT, antes de tudo.
 *
 * Devolve `false` quando o aparelho não deixou guardar (aba privada, cota cheia): a
 * tela precisa saber, porque nesse caso o registro depende só desta sessão.
 */
export function guardarPendente(
  pedido: RegistroContato,
  dados: { parceiro: string; desfecho: string; esperaMs?: number },
): boolean {
  const agora = Date.now();
  const fila = ler().filter((item) => item.clientKey !== pedido.clientKey);
  fila.push({
    clientKey: pedido.clientKey,
    criadoEm: new Date(agora).toISOString(),
    tentativas: 0,
    ultimoErro: null,
    parceiro: dados.parceiro,
    desfecho: dados.desfecho,
    enviarApos: new Date(agora + (dados.esperaMs ?? ESPERA_DESFAZER_MS)).toISOString(),
    esgotado: false,
    pedido,
  });
  return escrever(fila);
}

/**
 * Troca o pedido guardado pelo pedido de agora, sem mexer no prazo do desfazer.
 *
 * As três correções do recibo (com quem falou, anotação, remarcar) acontecem DENTRO da
 * janela de 5 segundos e mudam o que vai ser enviado. Sem isto, um tombo depois da
 * correção subiria a versão de antes dela.
 */
export function atualizarPedidoGuardado(pedido: RegistroContato): void {
  escrever(ler().map((item) => (item.clientKey === pedido.clientKey ? { ...item, pedido } : item)));
}

/** Tira da fila: gravou, ela desfez ou ela mandou descartar. */
export function removerDaFila(clientKey: string): void {
  escrever(ler().filter((item) => item.clientKey !== clientKey));
}

/** Anota o que aconteceu numa tentativa que falhou, mantendo o item guardado. */
export function anotarFalha(clientKey: string, erro: string, esgotado: boolean): void {
  escrever(
    ler().map((item) =>
      item.clientKey === clientKey
        ? { ...item, tentativas: item.tentativas + 1, ultimoErro: erro, esgotado }
        : item,
    ),
  );
}

/** Volta a tentar tudo o que tinha parado. É o botão "Tentar de novo" da tela. */
export function reativarEsgotados(): void {
  const agora = new Date().toISOString();
  escrever(
    ler().map((item) =>
      item.esgotado ? { ...item, tentativas: 0, esgotado: false, enviarApos: agora } : item,
    ),
  );
}

export type ResumoDoDreno = {
  enviados: number;
  /** Ainda vão sozinhos (rede fora, prazo do desfazer correndo). */
  esperando: number;
  /** Pararam de tentar e estão na tela, com motivo. */
  parados: number;
};

/**
 * Tenta subir o que está guardado.
 *
 * Um item sai da fila quando GRAVA, e só. Recusa prevista (`registrado:false`) e erro
 * que não vale repetir marcam `esgotado` e ficam guardados: quem estava olhando a tela
 * já viu a frase, mas quem drenou em segundo plano não viu nada, e um registro que
 * desaparece sem deixar rastro é exatamente o defeito que esta fila existe para não ter.
 *
 * Um dreno de cada vez: `online`, o relógio, o "voltar para a frente" e o botão podem
 * disparar quase juntos, e dois drenos em paralelo mandariam o mesmo pedido duas vezes.
 * O índice único da `client_key` já impede a linha duplicada no banco, mas gastar duas
 * viagens de rede num celular com sinal ruim é justamente o que não se quer.
 *
 * `enviar` é injetável só para os testes; em produção é a RPC de verdade.
 */
let drenoEmCurso: Promise<ResumoDoDreno> | null = null;

export function drenarFila(enviar: typeof gravarRegistro = gravarRegistro): Promise<ResumoDoDreno> {
  drenoEmCurso ??= drenar(enviar).finally(() => {
    drenoEmCurso = null;
  });
  return drenoEmCurso;
}

async function drenar(enviar: typeof gravarRegistro): Promise<ResumoDoDreno> {
  const fila = ler();
  if (fila.length === 0) return { enviados: 0, esperando: 0, parados: 0 };

  const agora = Date.now();
  let enviados = 0;

  for (const item of fila) {
    if (item.esgotado || Date.parse(item.enviarApos) > agora) continue;
    try {
      const resultado = await enviar(item.pedido);
      if (resultado.registrado) {
        enviados += 1;
        removerDaFila(item.clientKey);
      } else {
        anotarFalha(item.clientKey, fraseDaRecusa(resultado), true);
      }
    } catch (erro) {
      const repetivel = erro instanceof ErroDeRegistro ? erro.podeTentarDeNovo : true;
      const frase = erro instanceof Error ? erro.message : 'Falha desconhecida.';
      anotarFalha(item.clientKey, frase, !repetivel || item.tentativas + 1 >= MAX_TENTATIVAS_FILA);
    }
  }

  const restante = ler();
  return {
    enviados,
    esperando: restante.filter((i) => !i.esgotado).length,
    parados: restante.filter((i) => i.esgotado).length,
  };
}
