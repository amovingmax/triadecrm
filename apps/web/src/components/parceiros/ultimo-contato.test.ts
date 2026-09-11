import { describe, expect, it } from 'vitest';

import { filtrosDaUrl, urlDosFiltros, FILTROS_VAZIOS, type LinhaParceiro } from './tipos';
import { resumoDoContato } from './ultimo-contato';

/**
 * A célula "Último contato" da lista de Parceiros. O que ela precisa acertar é o
 * que o time decide olhando para ela: ligar de novo, mandar mensagem, procurar
 * outro número, ou não ligar porque outra pessoa já ligou hoje.
 */

const AGORA = new Date('2026-09-11T15:00:00-03:00');

function linha(parcial: Partial<LinhaParceiro>): LinhaParceiro {
  return {
    id: 'o1',
    name: 'Buffet Teste',
    kind: 'fornecedor',
    primary_category: null,
    city: null,
    neighborhood: null,
    phone: null,
    instagram_handle: null,
    temperature: 'frio',
    owner: null,
    stage: null,
    next_action_at: null,
    last_activity_at: null,
    days_since_contact: null,
    needs_attention: false,
    last_outcome_slug: null,
    last_outcome_name: null,
    last_outcome_counts_as: null,
    last_outcome_temperature: null,
    last_contact_channel: null,
    last_contact_at: null,
    last_contact_by: null,
    contact_attempts: 0,
    total_count: 1,
    ...parcial,
  };
}

describe('resumoDoContato', () => {
  it('diz com todas as letras quando ninguém falou com o parceiro', () => {
    const r = resumoDoContato(linha({}), AGORA);
    expect(r.contatado).toBe(false);
    expect(r.tag).toBe('Ainda não contatado');
  });

  it('usa a palavra do catálogo como tag, sem traduzir', () => {
    // É a mesma palavra que a pessoa tocou no Registrar, e é por ela que o time procura.
    const r = resumoDoContato(
      linha({
        last_outcome_slug: 'vis_decisor_interessado',
        last_outcome_name: 'Decisor interessado',
        last_outcome_counts_as: 'aberta',
        last_outcome_temperature: 'quente',
        last_contact_channel: 'presencial',
        last_contact_at: '2026-09-09T10:00:00-03:00',
        last_contact_by: 'Ana Heloiza Souza',
        contact_attempts: 2,
      }),
      AGORA,
    );
    expect(r.tag).toBe('Decisor interessado');
    expect(r.temperatura).toBe('quente');
    expect(r.quando).toBe('há 2 d');
    expect(r.tentativas).toBe('2ª tentativa');
    expect(r.quem).toBe('Ana');
  });

  it('tira o canal do prefixo do desfecho, porque visita e reunião gravam o mesmo canal', () => {
    // As duas gravam `channel = 'presencial'` na atividade. Pelo canal, a reunião
    // apareceria como "Visita".
    const reuniao = resumoDoContato(
      linha({
        last_outcome_slug: 'reu_interessado',
        last_outcome_name: 'Realizada, interessado',
        last_contact_channel: 'presencial',
      }),
      AGORA,
    );
    expect(reuniao.canal?.rotulo).toBe('Reunião');

    const visita = resumoDoContato(
      linha({
        last_outcome_slug: 'vis_nao_estava',
        last_outcome_name: 'Não estava / fechado',
        last_contact_channel: 'presencial',
      }),
      AGORA,
    );
    expect(visita.canal?.rotulo).toBe('Visita');
  });

  it('não pinta de temperatura o desfecho que não aplica temperatura', () => {
    // A cor é da escala térmica e só dela. "Não atendeu" não esquenta nem esfria.
    const r = resumoDoContato(
      linha({
        last_outcome_slug: 'lig_nao_atendeu',
        last_outcome_name: 'Não atendeu',
        last_outcome_counts_as: 'batida',
        last_outcome_temperature: null,
      }),
      AGORA,
    );
    expect(r.temperatura).toBeNull();
    expect(r.porta).toBe('batida');
  });

  it('marca número inválido pela porta, para ele saltar sem ganhar cor', () => {
    const r = resumoDoContato(
      linha({
        last_outcome_slug: 'wa_numero_invalido',
        last_outcome_name: 'Número inválido',
        last_outcome_counts_as: 'nenhuma',
      }),
      AGORA,
    );
    expect(r.porta).toBe('nenhuma');
    expect(r.temperatura).toBeNull();
  });

  it('diz hoje e ontem em vez de "há 0 d" e "há 1 d"', () => {
    const base = { last_outcome_slug: 'lig_nao_atendeu', last_outcome_name: 'Não atendeu' };
    expect(resumoDoContato(linha({ ...base, last_contact_at: '2026-09-11T09:00:00-03:00' }), AGORA).quando).toBe('hoje');
    expect(resumoDoContato(linha({ ...base, last_contact_at: '2026-09-10T09:00:00-03:00' }), AGORA).quando).toBe('ontem');
  });

  it('põe a frase inteira na descrição, para o title e o leitor de tela', () => {
    const r = resumoDoContato(
      linha({
        last_outcome_slug: 'lig_nao_atendeu',
        last_outcome_name: 'Não atendeu',
        last_contact_at: '2026-09-08T09:00:00-03:00',
        last_contact_by: 'Matheus Rondon',
        contact_attempts: 4,
      }),
      AGORA,
    );
    expect(r.descricao).toBe(
      'Último contato: Não atendeu, por ligação, há 3 d, 4ª tentativa, por Matheus.',
    );
  });
});

describe('o filtro de contato na URL', () => {
  it('vai e volta pela URL, para o recorte sobreviver a um link compartilhado', () => {
    const f = { ...FILTROS_VAZIOS, contato: 'sem_conversa' as const };
    expect(urlDosFiltros(f)).toBe('?contato=sem_conversa');
    expect(filtrosDaUrl({ contato: 'sem_conversa' }).contato).toBe('sem_conversa');
  });

  it('ignora valor desconhecido em vez de quebrar a tela', () => {
    // Link velho ou digitado à mão: a lista inteira é resposta melhor que erro.
    expect(filtrosDaUrl({ contato: 'qualquercoisa' }).contato).toBeNull();
  });
});
