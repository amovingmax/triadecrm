import { describe, expect, it } from 'vitest';

import { avisarLigacaoAPagina, guardaDoAudio } from './audio-da-pagina';

type Contexto = { state: string; suspensoes: number; retomadas: number };

/** Uma página falsa, com o mínimo que o script usa. */
function pagina() {
  const midias = [{ pausas: 0, pause() { this.pausas++; } }];
  class AudioContextFalso {
    state = 'running';
    suspensoes = 0;
    retomadas = 0;
    suspend() {
      this.suspensoes++;
      this.state = 'suspended';
      return Promise.resolve();
    }
    resume() {
      this.retomadas++;
      this.state = 'running';
      return Promise.resolve();
    }
  }
  class MidiaFalsa {
    play() {
      return Promise.resolve('tocou');
    }
  }
  const janela: Record<string, unknown> = {
    AudioContext: AudioContextFalso,
    HTMLMediaElement: MidiaFalsa,
  };
  const documento = { querySelectorAll: () => midias };
  const rodar = (script: string) =>
    new Function('window', 'document', 'HTMLMediaElement', 'DOMException', 'Reflect', script)(
      janela,
      documento,
      MidiaFalsa,
      class extends Error {},
      Reflect,
    );
  const novoContexto = () => new (janela.AudioContext as new () => Contexto & { resume(): Promise<unknown> })();
  return { janela, midias, rodar, novoContexto, MidiaFalsa };
}

describe('guardaDoAudio', () => {
  it('fora de ligação, a página toca como sempre', async () => {
    const p = pagina();
    p.rodar(guardaDoAudio(false));
    const c = p.novoContexto();
    await c.resume();
    expect(c.retomadas).toBe(1);
    await expect(new p.MidiaFalsa().play()).resolves.toBe('tocou');
  });

  it('a ligação cala os contextos que existem e trava o religar', async () => {
    const p = pagina();
    p.rodar(guardaDoAudio(false));
    const c = p.novoContexto();
    p.rodar(avisarLigacaoAPagina(true));
    expect(c.state).toBe('suspended');
    expect(p.midias[0]?.pausas).toBe(1);
    await c.resume();
    expect(c.retomadas).toBe(0);
    await expect(new p.MidiaFalsa().play()).rejects.toThrow('Em ligação pelo app');
  });

  it('o contexto criado durante a ligação nasce calado', () => {
    const p = pagina();
    p.rodar(guardaDoAudio(true));
    const c = p.novoContexto();
    expect(c.state).toBe('suspended');
  });

  it('no fim da ligação o som volta no próximo pedido', async () => {
    const p = pagina();
    p.rodar(guardaDoAudio(true));
    const c = p.novoContexto();
    p.rodar(avisarLigacaoAPagina(false));
    await c.resume();
    expect(c.state).toBe('running');
    await expect(new p.MidiaFalsa().play()).resolves.toBe('tocou');
  });

  it('rodar de novo na mesma página só atualiza o estado, sem embrulhar duas vezes', async () => {
    const p = pagina();
    p.rodar(guardaDoAudio(false));
    const Embrulhado = p.janela.AudioContext;
    p.rodar(guardaDoAudio(true));
    expect(p.janela.AudioContext).toBe(Embrulhado);
    const c = p.novoContexto();
    expect(c.state).toBe('suspended');
  });

  it('a página sem o script ignora o aviso', () => {
    const p = pagina();
    expect(() => p.rodar(avisarLigacaoAPagina(true))).not.toThrow();
  });
});
