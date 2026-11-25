import { describe, expect, it } from 'vitest';

import { VIGENTES, promptVigente } from '../src/catalogo';
import { esquemaDeSaida, prepararChamada } from '../src/nucleo/chamada';
import { MODELOS } from '../src/nucleo/versionamento';
import {
  type EntradaDaRetomadaV2,
  motivoParaNaoMandarV2,
  retomarConversaV2 as prompt,
} from '../src/prompts/retomar-conversa/v2';

/**
 * A RETOMADA COM AS DECISÕES DO DONO (Imova, 25/11/2026), SEM REDE.
 *
 * O que estes casos protegem: uma retomada só, com o gancho do imóvel tirado do anúncio,
 * terminando sem pergunta; sem emoji, sem código, sem "corretor", sem as frases de
 * dedução, até 300 caracteres; sem imóvel no ar, não retoma. A qualidade do texto se
 * mede no ensaio contra o modelo e nas primeiras retomadas de verdade.
 */

const CONTATO = {
  leadId: 'lead-1',
  nome: 'Ana Souza',
  empresa: null,
  telefones: ['+5584988776655'],
};

function entrada(extra: Partial<EntradaDaRetomadaV2> = {}): EntradaDaRetomadaV2 {
  return {
    leadId: 'lead-1',
    agora: '2026-11-26 10:10',
    agoraPorExtenso: 'quinta-feira, 26 de novembro, às 10h10',
    horasSemResposta: 21,
    cliente: { nome: 'Ana Souza' },
    imovel: {
      codigo: 'TE0004_IMOVA',
      descricao: 'terreno em Praia de Tabatinga',
      anuncio: 'Terreno frente para o mar. Escriturado e pronto para venda. Área total: 810 m².',
      disponivel: true,
    },
    mensagens: [
      {
        messageId: 'm1',
        de: 'cliente',
        quem: null,
        quando: '25/11 13:05',
        texto: 'Esse terreno ainda está disponível?',
      },
      {
        messageId: 'm2',
        de: 'ia',
        quem: null,
        quando: '25/11 13:06',
        texto: 'Está sim! É frente ao mar, com 810 m².',
      },
    ],
    ...extra,
  };
}

describe('retomar-conversa@v2: o contrato', () => {
  it('é a vigente, no Haiku 5.5, conta como texto da IA que atende e lê a conversa', () => {
    expect(VIGENTES['retomar-conversa']).toBe(2);
    expect(promptVigente('retomar-conversa')).toBe(prompt);
    expect(prompt.versao).toBe(2);
    expect(prompt.modelo).toBe(MODELOS.haiku55);
    expect(prompt.proposito).toBe('draft_reply');
    expect(prompt.escala).toBe('conversa');
    expect(prompt.camposDeTexto).toEqual(['mensagens', 'cliente']);
  });

  it('a saída é a mesma da v1: retomar ou não, a mensagem, o motivo e a confiança', () => {
    const esquema = esquemaDeSaida(prompt) as { properties: Record<string, unknown> };
    expect(Object.keys(esquema.properties).sort()).toEqual([
      'confianca',
      'mensagem',
      'motivo',
      'retomar',
    ]);
  });

  it('todo exemplo passa pelos dois schemas e pela auditoria da montagem', () => {
    for (const exemplo of prompt.exemplos) {
      expect(() => prompt.entrada.parse(exemplo.entrada)).not.toThrow();
      expect(() => prompt.saida.parse(exemplo.saida)).not.toThrow();
      expect(() => prepararChamada(prompt, exemplo.entrada, CONTATO)).not.toThrow();
    }
  });

  it('nos exemplos, quem retoma passa pela rede da v2; quem não retoma não manda texto', () => {
    const retoma = prompt.exemplos.filter((e) => e.saida.retomar);
    const naoRetoma = prompt.exemplos.filter((e) => !e.saida.retomar);
    expect(retoma.length).toBeGreaterThanOrEqual(1);
    expect(naoRetoma.length).toBeGreaterThanOrEqual(3);
    for (const e of naoRetoma) expect(e.saida.mensagem).toBe('');
    for (const e of retoma) {
      const imovel = e.entrada.imovel;
      const contexto = [
        ...e.entrada.mensagens.map((m) => m.texto),
        imovel?.descricao,
        imovel?.anuncio,
      ];
      expect(motivoParaNaoMandarV2(e.saida.mensagem, contexto)).toBeNull();
      expect(e.saida.mensagem.length).toBeLessThanOrEqual(300);
      expect(e.saida.mensagem).not.toContain('?');
    }
  });

  it('os exemplos que não retomam cobrem: sem imóvel, assunto encerrado e pergunta pendente', () => {
    const nomes = prompt.exemplos.filter((e) => !e.saida.retomar).map((e) => e.nome);
    expect(nomes.some((n) => /não sabe de qual imóvel/.test(n))).toBe(true);
    expect(nomes.some((n) => /fechou/.test(n))).toBe(true);
    expect(nomes.some((n) => /pergunta dele/.test(n))).toBe(true);
  });
});

describe('retomar-conversa@v2: as decisões do dono estão no texto', () => {
  it('uma mensagem com o gancho do imóvel, do anúncio, e SEM PERGUNTA', () => {
    expect(prompt.sistema).toMatch(/UM ponto forte do imóvel, o gancho/);
    expect(prompt.sistema).toMatch(/tirado do ANÚNCIO ou da conversa/);
    expect(prompt.sistema).toMatch(/SEM PERGUNTA/);
    expect(prompt.sistema).toMatch(/Qualquer dúvida, é só me\s+chamar\./);
  });

  it('as regras do caderno: sem emoji, sem código, sem "corretor", sem dedução, 300 caracteres', () => {
    expect(prompt.sistema).toMatch(/Sem emoji/);
    expect(prompt.sistema).toMatch(/Nunca escreva "corretor"/);
    expect(prompt.sistema).toMatch(/Escrever o código do anúncio/);
    expect(prompt.sistema).toMatch(/Pelo lugar, deve ser/);
    expect(prompt.sistema).toMatch(/até 300 caracteres/);
    expect(prompt.sistema).toMatch(/sem\s+gíria/);
  });

  it('não retoma sem imóvel, com imóvel fora do ar, nem com pergunta pendente do cliente', () => {
    expect(prompt.sistema).toMatch(/IMÓVEL vazio\): sem imóvel não há gancho/);
    expect(prompt.sistema).toMatch(/"disponível: não"/);
    expect(prompt.sistema).toMatch(/pergunta DELE que ficou sem resposta/);
  });

  it('a mesma pessoa da atendente', () => {
    expect(prompt.sistema).toMatch(/ferramenta de\s+acessibilidade/);
    expect(prompt.sistema).toMatch(/Não se apresente/);
    expect(prompt.sistema).toMatch(/masculino/);
    expect(prompt.sistema).toMatch(/assinatura "Imova"/);
  });
});

describe('retomar-conversa@v2: a montagem', () => {
  it('manda o imóvel e o anúncio, mas nunca o código', () => {
    const texto = prompt.montarMensagem(entrada());
    expect(texto).toMatch(/IMÓVEL: terreno em Praia de Tabatinga \(disponível: sim\)/);
    expect(texto).toMatch(
      /ANÚNCIO \(sem preço; de onde sai o gancho\):\nTerreno frente para o mar/,
    );
    expect(texto).not.toMatch(/TE0004/);
  });

  it('sem imóvel, diz que não sabe e que não há anúncio', () => {
    const texto = prompt.montarMensagem(entrada({ imovel: null }));
    expect(texto).toMatch(/o CRM não sabe de qual imóvel falavam/);
    expect(texto).toMatch(/ANÚNCIO: \(sem texto\)/);
  });

  it('o telefone e o nome que o cliente escreveu não chegam ao modelo', () => {
    const chamada = prepararChamada(
      prompt,
      entrada({
        mensagens: [
          {
            messageId: 'm1',
            de: 'cliente',
            quem: null,
            quando: '25/11 12:05',
            texto: 'Sou a Ana Souza, me liga no 84 98877-6655',
          },
          {
            messageId: 'm2',
            de: 'ia',
            quem: null,
            quando: '25/11 12:06',
            texto: 'Daqui não sai ligação, mas posso te ajudar por aqui.',
          },
        ],
      }),
      CONTATO,
    );
    expect(JSON.stringify(chamada)).not.toMatch(/98877/);
    expect(JSON.stringify(chamada)).not.toMatch(/Ana Souza/);
  });
});

describe('retomar-conversa@v2: a rede de segurança', () => {
  it('deixa passar a retomada com o gancho e sem pergunta', () => {
    expect(
      motivoParaNaoMandarV2(
        'Oi, [[NOME_1]]! O terreno em Tabatinga que você viu continua disponível, e a escritura já está pronta. Qualquer dúvida, é só me chamar.',
      ),
    ).toBeNull();
    expect(
      motivoParaNaoMandarV2(
        'Oi! O terreno em Tabatinga continua disponível, com 810 m² de frente para o mar. Fico à disposição.',
        ['Área total: 810 m²'],
      ),
    ).toBeNull();
  });

  it('segura o que as decisões do dono acrescentaram', () => {
    expect(motivoParaNaoMandarV2('Oi! O TE0004 continua disponível.')).toBe('cita_codigo');
    expect(motivoParaNaoMandarV2('Oi! O TE0004_IMOVA continua disponível.')).toBe('cita_codigo');
    expect(motivoParaNaoMandarV2('Oi! Ainda tem interesse no terreno?')).toBe('pergunta');
    expect(motivoParaNaoMandarV2('Oi! O terreno continua disponível 😊')).toBe('emoji');
    expect(motivoParaNaoMandarV2('Oi! Posso chamar um corretor para você.')).toBe('disse_corretor');
    expect(motivoParaNaoMandarV2('Oi! Pelo que você descreve, o terreno serve.')).toBe(
      'frase_de_deducao',
    );
    expect(motivoParaNaoMandarV2('a'.repeat(301))).toBe('mensagem_longa_demais');
  });

  it('e continua segurando tudo o que a v1 segurava', () => {
    expect(motivoParaNaoMandarV2('')).toBe('mensagem_vazia');
    expect(motivoParaNaoMandarV2('Oi, Ana! Você sumiu! Fico no aguardo.')).toBe('cobranca');
    expect(motivoParaNaoMandarV2('Última chance: tem outros interessados!')).toBe('urgencia');
    expect(motivoParaNaoMandarV2('Consigo um desconto para você.')).toBe('promessa_comercial');
    expect(motivoParaNaoMandarV2('Ele sai por R$ 520 mil.')).toBe('cita_valor');
    expect(motivoParaNaoMandarV2('Oi! Aqui é o Rafael, da Imova.')).toBe('se_passou_por_pessoa');
    expect(motivoParaNaoMandarV2('Oi! O terreno tem 900 m².', ['Área total: 810 m²'])).toBe(
      'numero_fora_da_conversa',
    );
  });
});
