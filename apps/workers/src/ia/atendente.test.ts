import { describe, expect, it } from 'vitest';

import { limparTexto, montarEntrada, soOPrimeiroNome, textoDasAlternativas } from './atendente';

describe('a IA que atende (Imova, 06/11/2026)', () => {
  it('chama o cliente só pelo primeiro nome', () => {
    expect(soOPrimeiroNome('Boa tarde, Janio Ramalho! Tudo bem?', 'Janio  Ramalho')).toBe('Boa tarde, Janio! Tudo bem?');
    expect(soOPrimeiroNome('Oi, Ana!', 'Ana')).toBe('Oi, Ana!');
    expect(soOPrimeiroNome('Oi!', null)).toBe('Oi!');
  });

  it('marcador que sobrou sai sem deixar vírgula solta', () => {
    expect(limparTexto('Oi, [[NOME_2]]! Temos sim.')).toBe('Oi! Temos sim.');
    expect(limparTexto('  Tudo   certo  .  ')).toBe('Tudo certo.');
  });

  it('as alternativas do horário tomado saem por extenso, no máximo três', () => {
    expect(
      textoDasAlternativas([
        { quando_por_extenso: 'segunda-feira, 9 de novembro, às 09h30' },
        { quando_por_extenso: 'segunda-feira, 9 de novembro, às 10h20' },
        { quando_por_extenso: 'terça-feira, 10 de novembro, às 14h30' },
        { quando_por_extenso: 'quarta-feira, 11 de novembro, às 09h30' },
      ]),
    ).toBe(
      'Esse horário acabou de ser ocupado. Posso marcar segunda-feira, 9 de novembro, às 09h30; segunda-feira, 9 de novembro, às 10h20 ou terça-feira, 10 de novembro, às 14h30. Qual fica melhor para você?',
    );
    expect(textoDasAlternativas([])).toBeNull();
  });

  it('a entrada troca uuid por rótulo e instante por opção', () => {
    const { entrada, horarios } = montarEntrada(
      {
        existe: true,
        treino: true,
        agora: '2026-11-06 14:34',
        agora_por_extenso: 'sexta-feira, 6 de novembro, às 14h34',
        cliente: {
          nome: 'Janio Ramalho',
          tem_ficha: true,
          etapa: null,
          perfil: [{ campo: 'bairros', valor: 'Ponta Negra' }, { campo: 'quartos', valor: null }],
          visitas: [],
          canal_de_chegada: 'placa',
        },
        horarios_de_visita: [{ inicio: '2026-11-09T12:30:00+00:00', quando_por_extenso: 'segunda-feira, 9 de novembro, às 09h30' }],
        respostas_na_ultima_hora: 2,
        mensagens: [
          { id: '00000000-0000-4000-8000-000000000001', de: 'cliente', quem: null, quando: '06/11 14:33', texto: 'Oi' },
          { id: '00000000-0000-4000-8000-000000000002', de: 'equipe', quem: 'Ana', quando: '06/11 14:34', texto: null },
        ],
      },
      'lead-abc123',
    );
    expect(entrada.mensagens.map((m) => m.messageId)).toEqual(['m1', 'm2']);
    expect(entrada.mensagens[1]?.texto).toBe('');
    expect(entrada.cliente.perfil).toEqual([{ campo: 'bairros', valor: 'Ponta Negra' }]);
    expect(entrada.cliente.canalDeChegada).toBe('placa');
    expect(entrada.horariosDeVisita).toEqual([{ opcao: 'h1', quando: 'segunda-feira, 9 de novembro, às 09h30' }]);
    expect(horarios.get('h1')?.inicio).toBe('2026-11-09T12:30:00+00:00');
    expect(JSON.stringify(entrada)).not.toContain('00000000-0000');
  });
});
