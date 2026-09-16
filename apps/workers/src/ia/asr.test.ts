import { describe, expect, it, vi } from 'vitest';

import { ASR_PADRAO, ErroDeTranscricao, confiancaDosSegmentos, transcrever } from './asr';

/**
 * O ASR é o passo que faz a IA enxergar o áudio — e é também o passo que pode
 * gastar dinheiro à toa e travar a fila. O que estes testes protegem:
 *
 *  1. **Sem chave é configuração, não rede.** O erro é determinístico: a fila não
 *     gira cinco vezes até a dead-letter por causa de uma variável que falta.
 *  2. **429 e 5xx voltam; 400 e 401 não.** Repetir uma recusa determinística paga a
 *     mesma recusa de novo.
 *  3. **Áudio mudo ou longo demais não vira transcrição.**
 *  4. **A confiança é a do Whisper**, ponderada pela duração do segmento — é ela
 *     que o prompt de limpeza usa para decidir se manda para uma pessoa.
 */

const audio = { bytes: new Uint8Array([1, 2, 3]), nome: 'audio.ogg', mime: 'audio/ogg' };

function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}

describe('confiancaDosSegmentos', () => {
  it('pondera pela duração do segmento', () => {
    // Um segmento longo e seguro pesa mais que um curto e inseguro.
    const alta = confiancaDosSegmentos([
      { avg_logprob: -0.1, start: 0, end: 10 },
      { avg_logprob: -2, start: 10, end: 10.5 },
    ]);
    expect(alta).toBeGreaterThan(0.85);
    expect(confiancaDosSegmentos([])).toBe(0.5);
  });
});

describe('transcrever', () => {
  it('devolve texto, confiança e duração no formato que o prompt espera', async () => {
    const buscar = vi.fn(async () =>
      resposta({
        text: '  Oi, é do buffet, a data é 12 de dezembro  ',
        duration: 7.4,
        segments: [{ avg_logprob: -0.2, start: 0, end: 7.4 }],
      }),
    );
    const t = await transcrever(audio, ASR_PADRAO, 'gsk_teste', buscar as unknown as typeof fetch);
    expect(t.texto).toBe('Oi, é do buffet, a data é 12 de dezembro');
    expect(t.duracaoSeg).toBe(7);
    expect(t.confianca).toBeGreaterThan(0.75);
  });

  it('sem chave, o erro é determinístico', async () => {
    const buscar = vi.fn();
    await expect(
      transcrever(audio, ASR_PADRAO, undefined, buscar as unknown as typeof fetch),
    ).rejects.toMatchObject({ transitorio: false });
    expect(buscar).not.toHaveBeenCalled();
  });

  it('429 e 5xx são transitórios; 401 não é', async () => {
    const recusa = (status: number) =>
      transcrever(
        audio,
        ASR_PADRAO,
        'gsk_teste',
        (async () => new Response('não', { status })) as unknown as typeof fetch,
      );
    await expect(recusa(429)).rejects.toMatchObject({ transitorio: true });
    await expect(recusa(503)).rejects.toMatchObject({ transitorio: true });
    await expect(recusa(401)).rejects.toMatchObject({ transitorio: false });
  });

  it('áudio mudo e áudio longo demais não passam', async () => {
    await expect(
      transcrever(
        audio,
        ASR_PADRAO,
        'gsk_teste',
        (async () => resposta({ text: '   ', duration: 3 })) as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(ErroDeTranscricao);

    await expect(
      transcrever(
        audio,
        { ...ASR_PADRAO, duracaoMaximaSeg: 60 },
        'gsk_teste',
        (async () => resposta({ text: 'oi', duration: 900 })) as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ transitorio: false });
  });

  it('provedor que este worker não implementa falha sem chamar rede', async () => {
    const buscar = vi.fn();
    await expect(
      transcrever(
        audio,
        { ...ASR_PADRAO, provedor: 'faster-whisper' },
        'gsk_teste',
        buscar as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ transitorio: false });
    expect(buscar).not.toHaveBeenCalled();
  });
});
