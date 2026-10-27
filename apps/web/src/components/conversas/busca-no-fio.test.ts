import { describe, expect, it } from 'vitest';

import { achadosNoFio, partesDestacadas } from './busca-no-fio';
import { montarMensagens, type MensagemCrua } from './mensagens';

function linha(id: string, parcial: Partial<MensagemCrua> = {}): MensagemCrua {
  return {
    id,
    conversation_id: 'f1',
    organization_id: 'o1',
    direction: 'in',
    type: 'text',
    status: 'received',
    body: null,
    media_path: null,
    media_mime: null,
    transcript: null,
    template_id: null,
    draft_id: null,
    author_kind: 'system',
    sent_by: null,
    approved_by: null,
    is_first_contact: false,
    business_initiated: false,
    optout_confirmation: false,
    origin: 'crm',
    error_code: null,
    error_detail: null,
    created_at: `2026-10-27T10:00:0${id.length}.000Z`,
    sent_at: null,
    delivered_at: null,
    read_at: null,
    failed_at: null,
    ...parcial,
  };
}

describe('achadosNoFio', () => {
  const fio = montarMensagens(
    [
      linha('a', { body: 'O João confirmou o buffet' }),
      linha('bb', { body: '*Ana:*\nAna aqui, tudo certo?' }),
      linha('ccc', { type: 'audio', transcript: 'joao vai ligar', body: null }),
      linha('dddd', { type: 'document', media_nome: 'Cardápio João.pdf' }),
      linha('eeeee', { body: 'joão de novo', apagada_em: '2026-10-27T11:00:00Z' }),
    ],
    new Map(),
  );

  it('sem acento e sem maiúscula, no texto, na transcrição e no nome do arquivo', () => {
    expect(achadosNoFio(fio, 'joao')).toEqual(['a', 'ccc', 'dddd']);
  });

  it('não procura na assinatura nem na mensagem apagada no CRM', () => {
    expect(achadosNoFio(fio, 'ana:')).toEqual([]);
  });

  it('menos de 2 letras não procura', () => {
    expect(achadosNoFio(fio, 'j')).toEqual([]);
  });
});

describe('partesDestacadas', () => {
  it('marca o trecho original, com acento', () => {
    expect(partesDestacadas('Fala com o João amanhã', 'joao')).toEqual([
      { texto: 'Fala com o ', destaque: false },
      { texto: 'João', destaque: true },
      { texto: ' amanhã', destaque: false },
    ]);
  });

  it('marca todas as vezes', () => {
    expect(partesDestacadas('sim, sim', 'SIM').filter((p) => p.destaque)).toHaveLength(2);
  });

  it('sem termo, o texto inteiro', () => {
    expect(partesDestacadas('oi', '')).toEqual([{ texto: 'oi', destaque: false }]);
  });
});
