'use client';

/**
 * O áudio da ligação pelo WhatsApp: WebRTC direto entre o navegador e a Meta.
 *
 * A Meta não aceita candidatos aos poucos (não há endpoint para isso): o SDP vai uma
 * vez só, inteiro, com a coleta de candidatos terminada. Ela é ICE-lite com endereço
 * público, então a própria Meta diz que STUN/TURN não são obrigatórios. Rede que bloqueie
 * UDP é a exceção conhecida, e está no guia (`docs/operacao/ligacao-whatsapp.md`).
 *
 * MICROFONE MUDO ATÉ O ACEITE. Na ligação recebida a conexão sobe antes de atender, e a
 * Meta manda o áudio correr só depois do 200 do `accept`: antes disso o cliente perderia
 * as primeiras palavras, ou ouviria o que não devia.
 */

const COLETA_MAXIMA_MS = 2500;

export type ConexaoDeVoz = {
  /** O áudio da pessoa passa a correr. */
  liberarMicrofone(): void;
  silenciar(mudo: boolean): void;
  /** Espera a conexão subir. Devolve `false` se não subiu no prazo. */
  esperarConectar(prazoMs: number): Promise<boolean>;
  aplicarResposta(sdp: string): Promise<void>;
  fechar(): void;
};

export async function abrirMicrofone(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('sem mediaDevices'), { name: 'NotFoundError' });
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

/** Espera os candidatos: o SDP só vale depois disso. Rede lenta não trava a ligação. */
function coletarCandidatos(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const fim = () => {
      clearTimeout(tempo);
      pc.removeEventListener('icegatheringstatechange', aoMudar);
      resolve();
    };
    const aoMudar = () => {
      if (pc.iceGatheringState === 'complete') fim();
    };
    const tempo = setTimeout(fim, COLETA_MAXIMA_MS);
    pc.addEventListener('icegatheringstatechange', aoMudar);
  });
}

function montar(
  fluxo: MediaStream,
  microfoneLiberado: boolean,
  aoCair: () => void,
): { pc: RTCPeerConnection; conexao: ConexaoDeVoz } {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const trilhas = fluxo.getAudioTracks();
  for (const t of trilhas) {
    t.enabled = microfoneLiberado;
    pc.addTrack(t, fluxo);
  }

  // O elemento precisa existir enquanto a ligação durar, senão o navegador o recolhe.
  const saida = new Audio();
  saida.autoplay = true;
  pc.ontrack = (e) => {
    saida.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    void saida.play().catch(() => undefined);
  };

  let fechada = false;
  let mudo = false;
  let liberado = microfoneLiberado;
  pc.onconnectionstatechange = () => {
    if (!fechada && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) aoCair();
  };

  const conexao: ConexaoDeVoz = {
    liberarMicrofone() {
      liberado = true;
      for (const t of trilhas) t.enabled = !mudo;
    },
    silenciar(novo) {
      mudo = novo;
      for (const t of trilhas) t.enabled = liberado && !mudo;
    },
    esperarConectar(prazoMs) {
      if (pc.connectionState === 'connected') return Promise.resolve(true);
      return new Promise((resolve) => {
        const fim = (ok: boolean) => {
          clearTimeout(tempo);
          pc.removeEventListener('connectionstatechange', aoMudar);
          resolve(ok);
        };
        const aoMudar = () => {
          if (pc.connectionState === 'connected') fim(true);
          else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fim(false);
        };
        const tempo = setTimeout(() => fim(false), prazoMs);
        pc.addEventListener('connectionstatechange', aoMudar);
      });
    },
    async aplicarResposta(sdp) {
      await pc.setRemoteDescription({ type: 'answer', sdp });
    },
    fechar() {
      if (fechada) return;
      fechada = true;
      pc.close();
      for (const t of fluxo.getTracks()) t.stop();
      saida.srcObject = null;
    },
  };
  return { pc, conexao };
}

/** O cliente ligou: a oferta veio da Meta, e o navegador devolve a resposta. */
export async function responderOferta(
  oferta: string,
  fluxo: MediaStream,
  aoCair: () => void,
): Promise<{ conexao: ConexaoDeVoz; sdp: string }> {
  const { pc, conexao } = montar(fluxo, false, aoCair);
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: oferta });
    await pc.setLocalDescription(await pc.createAnswer());
    await coletarCandidatos(pc);
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error('sem SDP local');
    return { conexao, sdp };
  } catch (e) {
    conexao.fechar();
    throw e;
  }
}

/** A empresa liga: a oferta sai do navegador, e a resposta volta pelo webhook. */
export async function criarOferta(
  fluxo: MediaStream,
  aoCair: () => void,
): Promise<{ conexao: ConexaoDeVoz; sdp: string }> {
  const { pc, conexao } = montar(fluxo, true, aoCair);
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await coletarCandidatos(pc);
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error('sem SDP local');
    return { conexao, sdp };
  } catch (e) {
    conexao.fechar();
    throw e;
  }
}
