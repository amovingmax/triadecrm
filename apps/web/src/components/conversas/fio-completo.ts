import { resumoDaMensagem } from './conteudo';
import type { Citada, MensagemDoFio, Reacao, Reacoes } from './tipos';

/**
 * O que só o fio INTEIRO sabe de cada mensagem (27/10/2026).
 *
 * Três contas, as três por cima das mensagens já montadas e em ordem:
 *
 *   1. **A reação não é balão.** Desde o WhatsApp completo ela aponta para a
 *      mensagem reagida (`reage_a`, ou o `wamid` dela quando o webhook chegou
 *      antes do vínculo). Vira o selo embaixo do alvo e sai do fio. Vale a
 *      ÚLTIMA de cada lado — uma do time, uma do contato, como no WhatsApp,
 *      onde cada pessoa tem uma reação por mensagem —, e a reação sem emoji é
 *      a pessoa tirando a dela. A nossa que não saiu (`failed`) não conta: o
 *      contato nunca a viu. A reação antiga, sem alvo, continua balão, do
 *      jeito que sempre foi; a que aponta para mensagem fora do que foi
 *      carregado também, para não sumir calada.
 *   2. **A resposta citada sabe quem cita.** Procura pelo id e, sem ele, pelo
 *      `wamid`; não achando, diz que a mensagem citada não está aqui.
 *   3. **A original sabe da correção** (`corrige_a`), para o balão dizer
 *      "corrigida" e levar até ela.
 */

type Achados = {
  porId: ReadonlyMap<string, MensagemDoFio>;
  porWamid: ReadonlyMap<string, MensagemDoFio>;
};

function indexar(mensagens: readonly MensagemDoFio[]): Achados {
  const porId = new Map<string, MensagemDoFio>();
  const porWamid = new Map<string, MensagemDoFio>();
  for (const m of mensagens) {
    porId.set(m.id, m);
    if (m.waId) porWamid.set(m.waId, m);
  }
  return { porId, porWamid };
}

function procurar(
  achados: Achados,
  id: string | null,
  wamid: string | null,
): MensagemDoFio | undefined {
  return (
    (id ? achados.porId.get(id) : undefined) ?? (wamid ? achados.porWamid.get(wamid) : undefined)
  );
}

/** O alvo de uma reação, ou `undefined` quando ela não é selo (é balão). */
export function alvoDaReacao(m: MensagemDoFio, achados: Achados): MensagemDoFio | undefined {
  if (m.tipo !== 'reaction') return undefined;
  if (!m.reageA && !m.reageAWamid) return undefined;
  const alvo = procurar(achados, m.reageA, m.reageAWamid);
  return alvo && alvo.tipo !== 'reaction' ? alvo : undefined;
}

/**
 * A última reação de cada lado, por mensagem reagida. O fio chega em ordem de
 * tempo, então "a última" é a que vem por último.
 */
export function agregarReacoes(mensagens: readonly MensagemDoFio[]): {
  porAlvo: Map<string, Reacoes>;
  selos: Set<string>;
} {
  const achados = indexar(mensagens);
  const porAlvo = new Map<string, Reacoes>();
  const selos = new Set<string>();
  for (const m of mensagens) {
    const alvo = alvoDaReacao(m, achados);
    if (!alvo) continue;
    selos.add(m.id);
    // A nossa que não saiu nunca chegou ao contato: não muda o que ele vê.
    if (!m.entrada && m.status === 'failed') continue;
    const atual = porAlvo.get(alvo.id) ?? { nossa: null, deles: null };
    const reacao: Reacao | null = m.texto
      ? { emoji: m.texto, naFila: m.status === 'queued', quem: m.entrada ? null : m.autor }
      : null;
    porAlvo.set(alvo.id, m.entrada ? { ...atual, deles: reacao } : { ...atual, nossa: reacao });
  }
  return { porAlvo, selos };
}

/** O trecho da mensagem citada, ou `null` quando esta não cita nada. */
export function resolverCitacao(m: MensagemDoFio, achados: Achados): Citada | null {
  if (!m.respondeA && !m.respondeAWamid) return null;
  const citada = procurar(achados, m.respondeA, m.respondeAWamid);
  if (!citada) {
    return {
      id: null,
      entrada: !m.entrada,
      autor: null,
      resumo: 'Mensagem que não está no CRM',
    };
  }
  return {
    id: citada.id,
    entrada: citada.entrada,
    autor: citada.autor,
    resumo:
      citada.apagadaEm || citada.apagadaPeloContatoEm
        ? 'Mensagem apagada'
        : resumoDaMensagem(citada),
  };
}

export function completarFio(mensagens: readonly MensagemDoFio[]): MensagemDoFio[] {
  if (mensagens.length === 0) return [];
  const achados = indexar(mensagens);
  const { porAlvo, selos } = agregarReacoes(mensagens);

  const correcoes = new Map<string, string>();
  for (const m of mensagens) {
    if (m.corrigeA && !m.cancelada) correcoes.set(m.corrigeA, m.id);
  }

  return mensagens
    .filter((m) => !selos.has(m.id))
    .map((m) => {
      const reacoes = porAlvo.get(m.id);
      const citada = resolverCitacao(m, achados);
      const corrigidaPor = correcoes.get(m.id) ?? null;
      if (!reacoes && !citada && !corrigidaPor) return m;
      return { ...m, reacoes: reacoes ?? m.reacoes, citada, corrigidaPor };
    });
}
