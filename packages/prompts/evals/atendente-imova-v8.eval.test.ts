import { describe, expect, it } from 'vitest';

import { VIGENTES, obterPrompt, promptVigente } from '../src/catalogo';
import { varrerMontagem } from '../src/nucleo/auditoria-pii';
import { esquemaDeSaida, prepararChamada } from '../src/nucleo/chamada';
import { BASE_DO_ENSAIO_V5 } from '../src/prompts/atendente-imova/cenarios-v5';
import { atendenteImovaV7 as v7 } from '../src/prompts/atendente-imova/v7';
import {
  BLOCO_DA_FOTO,
  LEGENDA_PADRAO_DA_FOTO,
  TETO_DA_LEGENDA,
  TROCAS_DO_CORRETOR,
  atendenteImovaV8 as v8,
  sistemaComBaseV8,
} from '../src/prompts/atendente-imova/v8';

/**
 * `atendente-imova@v8` (24/11/2026): A V7 COM A FOTO PARA CONFIRMAR O IMÓVEL.
 *
 * Pedido do usuário: "na primeira mensagem enviar uma mensagem mais humanizada e logo na
 * mensagem seguinte enviar uma imagem do terreno [...] e perguntar ao cliente se é esse
 * terreno/imóvel. O cliente confirmando o imóvel/terreno a IA segue com o atendimento."
 * Prova-se aqui que a v8 é a v7 com o campo da foto, a linha da saída e um bloco a mais;
 * que o bloco carrega o modelo de mensagem (sem preço e sem metragem, como manda a nota
 * 13 do caderno); e que a montagem passa na auditoria. O envio se prova no worker
 * (`atendente.test.ts`) e no banco (pgTAP 203).
 */

const CONTATO = {
  leadId: 'lead-24',
  nome: 'Janio Ramalho',
  empresa: null,
  telefones: ['+5584988776655'],
};

describe('atendente-imova@v8', () => {
  it('é a vigente; a v7 continua no catálogo', () => {
    expect(VIGENTES['atendente-imova']).toBe(8);
    expect(promptVigente('atendente-imova')).toBe(v8);
    expect(obterPrompt('atendente-imova', 7)).toBe(v7);
    expect(v7.sistema).not.toMatch(/fotoParaConfirmar/);
  });

  it('é a v7 com a linha da saída e o bloco da foto, e nada mais', () => {
    expect(v8.versao).toBe(8);
    expect(v8.sistema.endsWith(`\n\n${BLOCO_DA_FOTO}`)).toBe(true);
    const semOBloco = v8.sistema.slice(0, v8.sistema.length - BLOCO_DA_FOTO.length - 2);
    let v7SemCorretor = v7.sistema;
    for (const [de, para] of TROCAS_DO_CORRETOR) v7SemCorretor = v7SemCorretor.split(de).join(para);
    expect(semOBloco.replace(/\n- `fotoParaConfirmar`:[^\n]*/, '')).toBe(v7SemCorretor);
    expect(v8.entrada).toBe(v7.entrada);
    expect(v8.ferramentas).toEqual(v7.ferramentas);
    expect(v8.montarMensagem).toBe(v7.montarMensagem);
    expect([v8.modelo, v8.proposito, v8.escala, v8.maxTokens]).toEqual([
      v7.modelo,
      v7.proposito,
      v7.escala,
      v7.maxTokens,
    ]);
    expect(v8.tokensDeSistema).toBeGreaterThan(v7.tokensDeSistema);
  });

  it('o bloco ensina as duas mensagens: a frase sem preço, sem metragem e sem pergunta, e a foto com a pergunta', () => {
    expect(BLOCO_DA_FOTO).toMatch(/^A FOTO PARA CONFIRMAR O IMÓVEL \(acao = responder\):/);
    expect(BLOCO_DA_FOTO).toMatch(
      /Sem preço \(mesmo que ele tenha perguntado[^)]*\), sem\s+documentação, sem metragem/,
    );
    expect(BLOCO_DA_FOTO).toMatch(/É o nosso terreno bem perto da Gustavo Neves/);
    // Sem dúvida na confirmação (pedido de 24/11: "Ela não deve mostrar dúvidas").
    expect(BLOCO_DA_FOTO).toMatch(/Sem mostrar dúvida: nunca "acho"/);
    expect(BLOCO_DA_FOTO).not.toMatch(/Acho que já sei/);
    expect(BLOCO_DA_FOTO).not.toMatch(/\d+ ?m²/);
    expect(BLOCO_DA_FOTO).not.toMatch(/R\$/);
    expect(BLOCO_DA_FOTO).toContain(LEGENDA_PADRAO_DA_FOTO);
    expect(BLOCO_DA_FOTO).toMatch(/mais de um imóvel possível/);
    expect(BLOCO_DA_FOTO).toMatch(/Nunca escreva que vai mandar a foto/);
    expect(v8.sistema).toMatch(/- `fotoParaConfirmar`: \{ imovelCodigo, legenda \} ou null/);
  });

  it('"corretor" só sobra no nome da ação, no pedido do cliente e na proibição da frase da visita', () => {
    const sobras = [...v8.sistema.matchAll(/[^\n]*corretor[^\n]*/gi)].map((m) => m[0]);
    for (const linha of sobras) {
      expect(linha, linha).toMatch(
        /passar_para_corretor|pede corretor|não\s*$|vai passar para um corretor nem/,
      );
    }
    expect(v8.sistema).not.toMatch(
      /confirmar com o corretor|passe para o corretor|já vai passar para um corretor/,
    );
  });

  it('a saída aceita a foto ou null, e recusa legenda longa ou código vazio', () => {
    const base = v8.exemplos[0]?.saida;
    if (base === undefined) throw new Error('a v8 tem exemplos');
    expect(v8.saida.safeParse({ ...base, fotoParaConfirmar: null }).success).toBe(true);
    expect(
      v8.saida.safeParse({
        ...base,
        fotoParaConfirmar: { imovelCodigo: 'TE0006', legenda: LEGENDA_PADRAO_DA_FOTO },
      }).success,
    ).toBe(true);
    expect(
      v8.saida.safeParse({
        ...base,
        fotoParaConfirmar: { imovelCodigo: 'TE0006', legenda: 'a'.repeat(TETO_DA_LEGENDA + 1) },
      }).success,
    ).toBe(false);
    expect(
      v8.saida.safeParse({ ...base, fotoParaConfirmar: { imovelCodigo: '', legenda: 'É este?' } })
        .success,
    ).toBe(false);
    const { fotoParaConfirmar: _sem, ...semOCampo } = { ...base, fotoParaConfirmar: null };
    expect(v8.saida.safeParse(semOCampo).success).toBe(false);
    const esquema = JSON.stringify(esquemaDeSaida(v8));
    expect(esquema).toContain('fotoParaConfirmar');
    expect(JSON.stringify(esquemaDeSaida(v7))).not.toContain('fotoParaConfirmar');
  });

  it('os exemplos validam, e o da foto confirma sem preço', () => {
    for (const e of v8.exemplos) expect(v8.saida.safeParse(e.saida).success, e.nome).toBe(true);
    const comFoto = v8.exemplos.filter((e) => e.saida.fotoParaConfirmar !== null);
    expect(comFoto).toHaveLength(1);
    const exemplo = comFoto[0];
    if (exemplo === undefined) throw new Error('falta o exemplo da foto');
    expect(exemplo.saida.mensagem).not.toMatch(/R\$|m²|\?|\bacho\b|deve ser|parece/i);
    expect(exemplo.saida.fotoParaConfirmar?.legenda).toBe(LEGENDA_PADRAO_DA_FOTO);
  });

  it('a montagem com a base passa na auditoria', () => {
    expect(varrerMontagem(sistemaComBaseV8(BASE_DO_ENSAIO_V5))).toEqual([]);
    for (const e of v8.exemplos) {
      const chamada = prepararChamada(
        { ...v8, sistema: sistemaComBaseV8(BASE_DO_ENSAIO_V5) },
        e.entrada,
        CONTATO,
      );
      expect(chamada.sistema).toContain('A FOTO PARA CONFIRMAR O IMÓVEL');
    }
  });
});
