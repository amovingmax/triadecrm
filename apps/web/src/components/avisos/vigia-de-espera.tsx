'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { EMPRESA } from '@/lib/empresa';
import { createClient } from '@/lib/supabase/client';

import { mostrarAviso } from './aviso-do-navegador';
import {
  anunciadasDepois,
  botaoDaEspera,
  chaveDaEspera,
  esperasNovas,
  lerAnunciadas,
  lerEspera,
  linhaDaEspera,
  marcaDaEspera,
  textoDoAvisoDeEspera,
  tituloDaEspera,
  type Anunciadas,
  type EsperaParaAvisar,
} from './aviso-de-espera';
import { estaSilenciado, somEstaLigado } from './preferencias';
import { useAvisos, type AlvoDaConversa } from './provedor-avisos';
import { destinoDoAviso } from './regra';
import { outraAbaJaTocou, somDestravado, tocarSom } from './som';

/**
 * O aviso de espera em degraus, no computador (11/11/2026), só na Imova.
 *
 * Pedido do usuário: "Alerta em degraus: 15 min sem resposta avisa quem atende;
 * 1 h avisa a gestão." O cliente esperava em média 73 min pela primeira resposta
 * no expediente, e o único alerta ("Resposta atrasada") só saía com 24 h. Só o
 * dono tem o app de celular: a equipe usa o CRM no computador, e é aqui que ela
 * precisa ser cobrada.
 *
 * O que faz, em qualquer tela do CRM:
 * - a cada 30 segundos, e ao voltar para a aba, pergunta ao banco quem a regra
 *   manda avisar (`public.esperas_para_avisar`, migração 20261111200000): as
 *   conversas que passaram de 15 min de expediente sem resposta (antes da primeira
 *   resposta do time, para todos que atendem; depois, numa conversa com ficha, para
 *   o responsável: a regra do aviso de mensagem), e de 1 h, para admin e gestor. É
 *   a mesma regra do aviso no celular, então os dois concordam, inclusive em quem
 *   silenciou a conversa e no degrau desligado em "Avisos no celular";
 * - para cada espera nova: o cartão (com "Responder", que abre a conversa pelo
 *   mesmo caminho do clique no aviso de mensagem), o toque e, com o CRM fora de
 *   vista, a notificação do sistema.
 *
 * As mesmas regras do aviso de mensagem e do de lead: "Silenciar avisos" no menu
 * da conta cala tudo, o som segue a chave do menu e sai de uma aba só, e a
 * primeira leitura num navegador não anuncia o que já esperava. O que já foi
 * anunciado fica no aparelho, por pessoa, conversa, degrau e começo da espera:
 * outra aba não anuncia de novo, e quem abre o CRM depois do degrau ainda é
 * avisado da espera que continua. Não escreve nada no banco.
 */

const RITMO_MS = 30_000;
const CHAVE_DO_REGISTRO = 'komune.avisos.esperas-anunciadas.v1';
/** Cartões soltos de uma vez; o resto vira um cartão só, "mais N". */
const CARTOES_SOLTOS = 3;
const DURACAO_DO_CARTAO_MS = 30_000;

/**
 * As esperas que a regra manda avisar a quem está logado. `null` = a leitura
 * falhou: a vigia tenta de novo na próxima volta, sem mexer no registro.
 */
async function lerEsperasParaAvisar(): Promise<EsperaParaAvisar[] | null> {
  const { data, error } = await createClient().rpc('esperas_para_avisar');
  if (error) return null;
  const linhas: unknown[] = Array.isArray(data) ? data : [];
  return linhas.flatMap((linha) => {
    const espera = lerEspera(linha);
    return espera ? [espera] : [];
  });
}

function lerRegistro(usuarioId: string): Anunciadas | null {
  try {
    return lerAnunciadas(window.localStorage.getItem(`${CHAVE_DO_REGISTRO}:${usuarioId}`));
  } catch {
    return null;
  }
}

function gravarRegistro(usuarioId: string, anunciadas: Anunciadas): void {
  try {
    window.localStorage.setItem(`${CHAVE_DO_REGISTRO}:${usuarioId}`, JSON.stringify(anunciadas));
  } catch {
    // Sem armazenamento, o registro fica só na memória desta aba.
  }
}

function alvoDa(espera: EsperaParaAvisar): AlvoDaConversa {
  return { conversaId: espera.conversaId, organizacaoId: espera.organizacaoId };
}

export function VigiaDeEspera({
  usuarioId,
  ligado,
}: {
  usuarioId: string;
  /** Imova (módulo `esperaEmDegraus`), e papel que atende (admin, gestor e SDR). */
  ligado: boolean;
}) {
  const roteador = useRouter();
  const { abrirConversa } = useAvisos();

  const roteadorAgora = useRef(roteador);
  const abrirConversaAgora = useRef(abrirConversa);
  useEffect(() => {
    roteadorAgora.current = roteador;
    abrirConversaAgora.current = abrirConversa;
  }, [roteador, abrirConversa]);
  /** O registro desta aba, para quando o aparelho não guarda nada. */
  const naMemoria = useRef<Anunciadas | null>(null);
  const lendo = useRef(false);

  /**
   * Uma conversa abre pelo caminho do clique no aviso de mensagem (o provedor de
   * avisos: a tela de Conversas aberta troca a conversa sem navegar); várias levam
   * à lista.
   */
  const abrir = useCallback((alvos: readonly AlvoDaConversa[]) => {
    const unico = alvos.length === 1 ? alvos[0] : undefined;
    if (unico) abrirConversaAgora.current(unico);
    else roteadorAgora.current.push(destinoDoAviso(alvos));
  }, []);

  const avisar = useCallback(
    (novas: readonly EsperaParaAvisar[]) => {
      if (estaSilenciado(usuarioId)) return;

      const soltas = novas.slice(0, CARTOES_SOLTOS);
      for (const espera of soltas) {
        toast(tituloDaEspera(espera), {
          id: `espera:${chaveDaEspera(espera)}`,
          description: linhaDaEspera(espera),
          duration: DURACAO_DO_CARTAO_MS,
          action: { label: botaoDaEspera(espera), onClick: () => abrir([alvoDa(espera)]) },
        });
      }
      const resto = novas.length - soltas.length;
      if (resto > 0) {
        toast(
          `Mais ${resto} ${resto === 1 ? 'cliente esperando' : 'clientes esperando'} resposta`,
          {
            id: `esperas:${novas.map(chaveDaEspera).join(',')}`,
            duration: DURACAO_DO_CARTAO_MS,
            action: {
              label: 'Ver conversas',
              onClick: () => roteadorAgora.current.push('/conversas'),
            },
          },
        );
      }

      // O toque sai de uma aba só (ver `som.ts`).
      const marca = marcaDaEspera(novas);
      const comSom = somEstaLigado(usuarioId);
      const somResolvido =
        comSom && somDestravado() && (outraAbaJaTocou(usuarioId, marca) || tocarSom());

      if (document.hidden || !document.hasFocus()) {
        const texto = textoDoAvisoDeEspera(novas, EMPRESA.nomeNoAviso);
        const alvos = novas.map(alvoDa);
        const [unica] = novas;
        void mostrarAviso({
          titulo: texto.titulo,
          corpo: texto.corpo,
          marca,
          botao: novas.length === 1 && unica ? botaoDaEspera(unica) : 'Abrir Conversas',
          // O clique no aviso do service worker volta pela aba como o da
          // mensagem nova, com o mesmo alvo: quem abre é o provedor de avisos.
          alvos,
          destino: destinoDoAviso(alvos),
          silenciosa: !comSom || somResolvido,
          aoClicar: () => abrir(alvos),
        });
      }
    },
    [usuarioId, abrir],
  );

  const conferir = useCallback(async () => {
    if (!ligado || lendo.current) return;
    lendo.current = true;
    try {
      const lidas = await lerEsperasParaAvisar();
      if (lidas === null) return;

      // Lido depois da ida ao banco: outra aba pode ter anunciado enquanto esta lia.
      const registro = lerRegistro(usuarioId) ?? naMemoria.current;
      const proximo = anunciadasDepois(registro ?? {}, lidas, Date.now());
      naMemoria.current = proximo;
      gravarRegistro(usuarioId, proximo);

      // Primeira vez neste navegador: o que já esperava não é novidade.
      if (registro === null) return;
      const novas = esperasNovas(lidas, registro);
      if (novas.length > 0) avisar(novas);
    } finally {
      lendo.current = false;
    }
  }, [ligado, usuarioId, avisar]);

  useEffect(() => {
    if (!ligado) return;
    void conferir();
    const relogio = window.setInterval(() => void conferir(), RITMO_MS);
    const aoVoltar = () => {
      if (!document.hidden) void conferir();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    return () => {
      window.clearInterval(relogio);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
    };
  }, [ligado, conferir]);

  return null;
}
