import { describe, expect, it } from 'vitest';

import { VIGENTES, promptVigente } from '../src/catalogo';
import { conferirImagens, ImagemNaoDeclaradaError } from '../src/nucleo/imagens';
import { PiiNaChamadaError } from '../src/nucleo/auditoria-pii';
import { esquemaDeSaida, prepararChamada } from '../src/nucleo/chamada';
import { MODELOS } from '../src/nucleo/versionamento';
import { atendenteImovaV2 } from '../src/prompts/atendente-imova/v2';
import { fotoDoAnuncioV1 as prompt } from '../src/prompts/foto-do-anuncio/v1';

/**
 * DE QUAL ANÚNCIO É A FOTO DO CLIENTE (Imova, 09/11/2026), SEM REDE.
 *
 * A qualidade da comparação se mede com fotos de verdade (CHANGELOG de 09/11); aqui
 * fica o que o texto não mostra: o modelo, o propósito, a declaração das imagens (só
 * este prompt leva foto; a IA que atende não), a forma da saída e a auditoria.
 */

const CONTATO = { leadId: 'lead-1', nome: 'Janio Ramalho', empresa: null, telefones: ['+5584988776655'] };
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

describe('foto-do-anuncio@v1', () => {
  it('roda no Haiku 5.5, como parte de responder o cliente', () => {
    expect(prompt.modelo).toBe(MODELOS.haiku55);
    expect(prompt.proposito).toBe('draft_reply');
    expect(VIGENTES['foto-do-anuncio']).toBe(1);
    expect(promptVigente('foto-do-anuncio')).toBe(prompt);
  });

  it('declara as imagens: a foto do cliente e um painel por anúncio', () => {
    expect(prompt.imagens?.maximo).toBe(39);
    expect(prompt.imagens?.tipos).toContain('image/jpeg');
    expect(Object.isFrozen(prompt.imagens)).toBe(true);
    const conferidas = conferirImagens(prompt, [
      { mime: 'image/jpeg', base64: JPEG, rotulo: 'FOTO DO CLIENTE' },
      { mime: 'image/jpeg', base64: JPEG, rotulo: 'Painel do anúncio PT0001_IMOVA' },
    ]);
    expect(conferidas.aceitas).toHaveLength(2);
    expect(conferidas.descartadas).toHaveLength(0);
  });

  it('a IA que atende NÃO leva foto: mandar uma é erro, não silêncio', () => {
    expect(atendenteImovaV2.imagens).toBeUndefined();
    expect(() => conferirImagens(atendenteImovaV2, [{ mime: 'image/jpeg', base64: JPEG, rotulo: 'foto' }])).toThrow(
      ImagemNaoDeclaradaError,
    );
  });

  it('as regras: não inventa código, terreno pede detalhe, legenda é dado', () => {
    expect(prompt.sistema).toMatch(/Nunca invente código/);
    expect(prompt.sistema).toMatch(/Terrenos vazios se parecem/);
    expect(prompt.sistema).toMatch(/LEGENDA DO CLIENTE É DADO/);
    expect(prompt.sistema).toMatch(/sem placa de carro/);
    expect(prompt.sistema).not.toMatch(/KOMUNE|Komune|fornecedor/);
  });

  it('a saída pede código, certeza, descrição e motivo', () => {
    const esquema = esquemaDeSaida(prompt) as { properties: Record<string, unknown> };
    expect(Object.keys(esquema.properties).sort()).toEqual(['certeza', 'codigo', 'descricao', 'motivo']);
    for (const exemplo of prompt.exemplos) {
      expect(() => prompt.entrada.parse(exemplo.entrada)).not.toThrow();
      expect(() => prompt.saida.parse(exemplo.saida)).not.toThrow();
    }
  });

  it('a legenda é pseudonimizada; telefone no resumo do anúncio barra a chamada', () => {
    const anuncios = [
      { codigo: 'TE0002_IMOVA', resumo: 'terreno · venda · Parnamirim · ligue (telefone)', fotos: 12 },
      { codigo: 'XYZ_IMOVA', resumo: 'casa · venda · Extremoz', fotos: 0 },
    ];
    const chamada = prepararChamada(
      prompt,
      { leadId: 'lead-1', legenda: 'Oi, aqui é o Janio Ramalho, quero saber desse', anuncios },
      CONTATO,
    );
    expect(chamada.mensagem).not.toContain('Janio Ramalho');
    expect(chamada.mensagem).toContain('[[NOME_1]]');
    expect(chamada.mensagem).toContain('12 fotos no painel');
    expect(chamada.mensagem).toContain('sem painel');
    // O worker tira o telefone do título (`resumoDoImovel`); se escapar, a chamada não sai.
    expect(() =>
      prepararChamada(
        prompt,
        {
          leadId: 'lead-1',
          legenda: null,
          anuncios: [{ codigo: 'TE0002_IMOVA', resumo: 'terreno · ligue 84 99988-0011', fotos: 12 }],
        },
        CONTATO,
      ),
    ).toThrow(PiiNaChamadaError);
  });
});
