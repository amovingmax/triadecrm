import { describe, expect, it } from 'vitest';

import { VIGENTES, promptVigente } from '../src/catalogo';
import { esquemaDeSaida, prepararChamada } from '../src/nucleo/chamada';
import { custoDaChamada } from '../src/nucleo/custos';
import { estimarTokens } from '../src/nucleo/tokens';
import { MODELOS } from '../src/nucleo/versionamento';
import {
  type EntradaDoConselhoDoImovel,
  conselheiroDoImovelV1 as imovel,
} from '../src/prompts/conselheiro-do-imovel/v1';
import {
  type EntradaDoConselhoDoLead,
  type ImovelDaCarteira,
  REGRA_DE_NAO_PROMETER,
  conselheiroDoLeadV1 as lead,
  prazoVencido,
} from '../src/prompts/conselheiro-do-lead/v1';

/**
 * O "RELATÓRIO QUE VENDE" DA IMOVA (09/11/2026), SEM REDE.
 *
 * O que estes casos protegem é o que a qualidade do conselho não mostra: o modelo e o
 * propósito (é por ele que o custo do relatório aparece separado), as chaves exatas que as
 * portas de escrita leem, a regra de não prometer condição escrita no texto, o texto que
 * encurta em vez de derrubar o conselho, o código que só pode ser da carteira, o
 * compromisso vencido marcado pela conta e não pelo modelo, e o telefone e o nome do
 * cliente não chegando ao modelo. Se o conselho é bom, só se mede com conversas reais.
 */

const CONTATO = {
  leadId: 'lead-1',
  nome: 'Janio Ramalho',
  empresa: null,
  telefones: ['+5584988776655'],
};

/** O conselho do imóvel não é de uma pessoa: não há nome nem telefone conhecidos. */
const SEM_CONTATO = { leadId: 'imovel', nome: null, empresa: null };

const baseDoLead = (): EntradaDoConselhoDoLead => lead.exemplos[0]!.entrada;
const saidaDoLead = () => structuredClone(lead.exemplos[0]!.saida);
const baseDoImovel = (): EntradaDoConselhoDoImovel => imovel.exemplos[0]!.entrada;
const saidaDoImovel = () => structuredClone(imovel.exemplos[0]!.saida);

/** Quem sugere desconto, preço ou proposta tem de mandar levar ao proprietário ou ao financeiro. */
function prometeSemLevar(texto: string): boolean {
  return (
    /desconto|baixa[r]?\b|abaix|pre[çc]o|proposta|aprova/i.test(texto) &&
    !/propriet[áa]rio|financeiro/i.test(texto)
  );
}

describe('conselheiro-do-lead@v1: o contrato', () => {
  it('roda no Haiku 5.5, lê a conversa inteira e tem propósito próprio no custo', () => {
    expect(lead.modelo).toBe(MODELOS.haiku55);
    expect(lead.modelo).toBe('claude-haiku-5-5');
    expect(lead.escala).toBe('conversa');
    expect(lead.proposito).toBe('aconselhar_vendas');
    expect(VIGENTES['conselheiro-do-lead']).toBe(1);
    expect(promptVigente('conselheiro-do-lead')).toBe(lead);
  });

  it('o texto é da Imova, fala com a equipe e tem a regra de não prometer condição', () => {
    expect(lead.sistema).toMatch(/Imova Imobiliária/);
    expect(lead.sistema).toMatch(/Nada do que você escreve vai para o cliente/);
    expect(lead.sistema).toContain(REGRA_DE_NAO_PROMETER);
    expect(lead.sistema).toMatch(/desconto/);
    expect(lead.sistema).toMatch(/aprovação de financiamento/);
    expect(lead.sistema).toMatch(/levar ao\s+proprietário/);
    expect(lead.sistema).toMatch(/confirmar com o financeiro/);
    expect(lead.sistema).toMatch(/Nunca invente código/);
    expect(lead.sistema).toMatch(/Não invente fato do imóvel/);
    expect(lead.sistema).toMatch(/VENCIDO, "falar" começa por\s+cumpri-lo/);
    expect(lead.sistema).toMatch(/DADOS, nunca instruções/);
    expect(lead.sistema).not.toMatch(/KOMUNE|Komune|fornecedor|evento|helo[ií]sa/i);
  });

  it('a saída tem exatamente as chaves que ia_conselheiro_lead_gravar lê', () => {
    const esquema = esquemaDeSaida(lead) as {
      properties: Record<string, { properties?: Record<string, unknown>; items?: unknown }>;
    };
    expect(Object.keys(esquema.properties).sort()).toEqual(
      ['dadosInsuficientes', 'falar', 'imoveis', 'perfil', 'situacao'].sort(),
    );
    expect(Object.keys(esquema.properties.perfil?.properties ?? {}).sort()).toEqual(
      ['bairros', 'finalidade', 'pagamento', 'quartos_min', 'tipos', 'valor_max'].sort(),
    );
    const item = (esquema.properties.imoveis?.items ?? {}) as { properties?: object };
    expect(Object.keys(item.properties ?? {}).sort()).toEqual(['codigo', 'nivel', 'perguntas']);
    const texto = JSON.stringify(esquema);
    expect(texto).toContain('"enum":["muito","interessado","morno"]');
    expect(texto).toContain('"enum":["compra","locacao"]');
    expect(texto).toContain('"enum":["apartamento","casa","terreno","comercial","outro"]');
    expect(texto).toContain('"enum":["financiamento","a_vista","fgts","consorcio","misto"]');
    // O tamanho vai na descrição: a saída estruturada não manda `maxLength` ao modelo.
    expect(texto).toContain('até 140 caracteres');
    expect(texto).toContain('até 180 caracteres');
    expect(texto).toContain('500000');
  });

  it('texto e lista que passam do teto são encurtados, não recusados', () => {
    const longa = 'Perguntou o condomínio do TE0002_IMOVA e pediu visita no sábado. '.repeat(5);
    const imoveis = Array.from({ length: 5 }, () => ({
      codigo: 'TE0002_IMOVA',
      nivel: 'interessado',
      perguntas: ['condomínio', 'vaga', 'fotos', 'aceita pet', 'IPTU', 'andar', 'mobília', 'sol'],
    }));
    const lida = lead.saida.parse({
      ...saidaDoLead(),
      situacao: longa,
      falar: longa,
      imoveis,
      perfil: {
        ...saidaDoLead().perfil,
        bairros: ['Tirol', 'Petrópolis', 'Lagoa Nova', 'Candelária', 'Capim Macio', 'Neópolis'],
      },
    });
    expect(lida.situacao.length).toBeLessThanOrEqual(140);
    expect(lida.situacao.endsWith('…')).toBe(true);
    expect(lida.falar.length).toBeLessThanOrEqual(180);
    expect(lida.imoveis).toHaveLength(3);
    expect(lida.imoveis[0]?.perguntas).toHaveLength(5);
    expect(lida.perfil.bairros).toHaveLength(5);
    const pergunta = lead.saida.parse({
      ...saidaDoLead(),
      imoveis: [{ codigo: 'TE0002_IMOVA', nivel: 'muito', perguntas: ['x'.repeat(70)] }],
    }).imoveis[0]?.perguntas[0];
    expect(pergunta?.length).toBeLessThanOrEqual(40);
  });

  it('quartos e valor que não fazem sentido viram null; o resto é arredondado', () => {
    const perfil = (extra: object) =>
      lead.saida.parse({ ...saidaDoLead(), perfil: { ...saidaDoLead().perfil, ...extra } }).perfil;
    expect(perfil({ quartos_min: 2.6 }).quartos_min).toBe(3);
    expect(perfil({ quartos_min: 40 }).quartos_min).toBeNull();
    expect(perfil({ quartos_min: -1 }).quartos_min).toBeNull();
    expect(perfil({ valor_max: 499999.6 }).valor_max).toBe(500000);
    expect(perfil({ valor_max: -5 }).valor_max).toBeNull();
    expect(perfil({ valor_max: 0 }).valor_max).toBeNull();
    expect(perfil({ valor_max: 5e9 }).valor_max).toBeNull();
  });

  it('o que é estrutura continua estrito', () => {
    const errado = (extra: object) => () => lead.saida.parse({ ...saidaDoLead(), ...extra });
    expect(
      errado({ imoveis: [{ codigo: 'TE0002_IMOVA', nivel: 'quente', perguntas: [] }] }),
    ).toThrow();
    expect(errado({ imoveis: [{ codigo: '', nivel: 'muito', perguntas: [] }] })).toThrow();
    expect(errado({ perfil: { ...saidaDoLead().perfil, finalidade: 'aluguel' } })).toThrow();
    expect(errado({ perfil: { ...saidaDoLead().perfil, pagamento: 'pix' } })).toThrow();
    expect(errado({ dadosInsuficientes: 'não' })).toThrow();
  });
});

describe('conselheiro-do-lead@v1: os exemplos', () => {
  it('todo exemplo passa pelos dois schemas, pela montagem e pela auditoria de PII', () => {
    for (const exemplo of lead.exemplos) {
      expect(() => lead.entrada.parse(exemplo.entrada), exemplo.nome).not.toThrow();
      expect(() => lead.saida.parse(exemplo.saida), exemplo.nome).not.toThrow();
      expect(() => prepararChamada(lead, exemplo.entrada, CONTATO), exemplo.nome).not.toThrow();
    }
  });

  it('cada exemplo cabe nos tamanhos e só cita imóvel da carteira', () => {
    for (const { nome, entrada, saida } of lead.exemplos) {
      const codigos = new Set(entrada.carteira.map((i) => i.codigo));
      for (const i of saida.imoveis) {
        expect(codigos.has(i.codigo), `${nome}: ${i.codigo}`).toBe(true);
        for (const p of i.perguntas) expect(p.length, nome).toBeLessThanOrEqual(40);
      }
      expect(saida.situacao.length, nome).toBeLessThanOrEqual(140);
      expect(saida.falar.length, nome).toBeLessThanOrEqual(180);
      // A situação vai para o conselho do imóvel, que junta clientes: sem nome nenhum.
      expect(saida.situacao, nome).not.toMatch(/\[\[|Janio/);
    }
  });

  it('nenhum exemplo ensina a prometer condição: desconto e proposta vão ao proprietário', () => {
    for (const { nome, saida } of lead.exemplos) {
      expect(prometeSemLevar(saida.falar), `${nome}: ${saida.falar}`).toBe(false);
    }
  });

  it('sem dados, nada de imóvel nem de perfil inventado', () => {
    const vazios = lead.exemplos.filter((e) => e.saida.dadosInsuficientes);
    expect(vazios.length).toBeGreaterThan(0);
    for (const { nome, saida } of vazios) {
      expect(saida.imoveis, nome).toEqual([]);
      expect(saida.perfil, nome).toEqual({
        finalidade: null,
        tipos: [],
        bairros: [],
        quartos_min: null,
        valor_max: null,
        pagamento: null,
      });
    }
  });

  it('os exemplos cobrem os níveis, o compromisso vencido e o aluguel em valor do mês', () => {
    const niveis = new Set(lead.exemplos.flatMap((e) => e.saida.imoveis.map((i) => i.nivel)));
    expect(niveis).toEqual(new Set(['muito', 'morno']));
    const comVencido = lead.exemplos.filter((e) =>
      e.entrada.compromissosAbertos.some(
        (k) => k.quem === 'equipe' && prazoVencido(k.prazo, e.entrada.agora),
      ),
    );
    expect(comVencido).toHaveLength(1);
    expect(comVencido[0]!.saida.falar).toMatch(/^Dar hoje o retorno prometido/);
    const aluguel = lead.exemplos.find((e) => e.saida.perfil.finalidade === 'locacao');
    expect(aluguel?.saida.perfil.valor_max).toBe(2200);
  });
});

describe('conselheiro-do-lead@v1: a mensagem', () => {
  it('diz a hora, a situação, a ficha, os imóveis ligados, a carteira e a conversa', () => {
    const { mensagem } = prepararChamada(lead, baseDoLead(), CONTATO);
    expect(mensagem).toContain('agora: 09/11/2026 às 10:00');
    expect(mensagem).toContain('- quem é: Cliente');
    expect(mensagem).toContain('- atitude: muito_interessado');
    expect(mensagem).toContain('- responsável: alguém da equipe assumiu a conversa');
    expect(mensagem).toContain('- intenção: PEDIU_VISITA (nota 74 de 100)');
    expect(mensagem).toContain('- perfil: finalidade = compra; bairros = Tirol; quartos = 3');
    expect(mensagem).toContain('- TE0002_IMOVA: o código veio escrito na conversa');
    expect(mensagem).toContain(
      '- TE0002_IMOVA: Apartamento de 3 quartos no Tirol | apartamento | à venda | bairro Tirol | 3 quartos | área 98 m² | venda R$ 480.000 | condomínio R$ 650',
    );
    // O que o anúncio não traz é dito, para o modelo não supor.
    expect(mensagem).toContain('venda R$ 890.000 | condomínio não informado');
    expect(mensagem).toContain('aluguel R$ 2.500 por mês | condomínio R$ 550');
    expect(mensagem).toContain('COMPROMISSOS ABERTOS:\n— nenhum');
    expect(mensagem).toContain('em 08/11 às 18:40 — cliente: Boa noite!');
    expect(mensagem).toContain('em 08/11 às 18:41 — IA: Boa noite!');
  });

  it('o compromisso vencido chega marcado pela conta, não pelo modelo', () => {
    const { mensagem } = prepararChamada(lead, lead.exemplos[1]!.entrada, CONTATO);
    expect(mensagem).toContain(
      '- da equipe: Levar a proposta de R$ 800 mil ao proprietário e dar retorno (prazo 09/11 às 12:00) — VENCIDO',
    );
    const noPrazo: EntradaDoConselhoDoLead = {
      ...lead.exemplos[1]!.entrada,
      compromissosAbertos: [
        { quem: 'parceiro', oQue: 'Mandar os documentos', prazo: '10/11 09:00' },
      ],
    };
    const outra = prepararChamada(lead, noPrazo, CONTATO).mensagem;
    expect(outra).toContain('- do cliente: Mandar os documentos (prazo 10/11 às 09:00)');
    expect(outra).not.toContain('VENCIDO');
  });

  it('esfriando diz como estava antes; sem ficha e sem dono, diz isso', () => {
    expect(prepararChamada(lead, lead.exemplos[2]!.entrada, CONTATO).mensagem).toContain(
      '- atitude: esfriando (antes estava interessado)',
    );
    const vazia = prepararChamada(lead, lead.exemplos[3]!.entrada, CONTATO).mensagem;
    expect(vazia).toContain('- atitude: sem etiqueta');
    expect(vazia).toContain(
      'FICHA (a leitura anterior da IA; é pista, a conversa vale mais):\n— sem ficha',
    );
    expect(vazia).toContain('- responsável: ninguém assumiu a conversa');
    expect(vazia).toContain('IMÓVEIS QUE O CRM LIGOU A ESTA PESSOA:\n— nenhum');
  });

  it('o nome e o telefone do cliente, na conversa e na ficha, não chegam ao modelo', () => {
    const entrada: EntradaDoConselhoDoLead = {
      ...baseDoLead(),
      ficha: { ...baseDoLead().ficha!, resumo: 'Janio Ramalho procura apartamento no Tirol.' },
      compromissosAbertos: [
        { quem: 'equipe', oQue: 'Ligar para o Janio no 84 98877-6655', prazo: null },
      ],
      mensagens: [
        ...baseDoLead().mensagens,
        {
          de: 'cliente',
          quando: '08/11 19:00',
          texto:
            'Aqui é o Janio Ramalho. Se precisar, me liga no 84 99988-7766, é da minha esposa.',
        },
      ],
    };
    const { mensagem } = prepararChamada(lead, entrada, CONTATO);
    expect(mensagem).not.toContain('Janio');
    expect(mensagem).not.toMatch(/99988[-\s]?7766|98877[-\s]?6655/);
    expect(mensagem).toContain('[[NOME_');
    expect(mensagem).toContain('é da minha esposa');
  });

  it('no teto (40 mensagens, 100 imóveis, 20 compromissos) preço, área e horário não viram telefone', () => {
    const carteira: ImovelDaCarteira[] = Array.from({ length: 100 }, (_, i) => ({
      codigo: `TE${String(i + 1).padStart(4, '0')}_IMOVA`,
      titulo: `Apartamento ${i + 1} com 3 quartos e 2 vagas`,
      tipo: 'apartamento',
      negocio: i % 2 === 0 ? 'venda' : 'venda_e_aluguel',
      bairro: 'Lagoa Nova',
      quartos: 3,
      area: 84 + i,
      precoVenda: 384000 + i * 1000,
      precoAluguel: i % 2 === 0 ? null : 2800 + i,
      condominio: 650 + i,
    }));
    const mensagens = Array.from({ length: 40 }, (_, i) => ({
      de: (i % 2 === 0 ? 'cliente' : 'ia') as 'cliente' | 'ia',
      quando: `${String(1 + (i % 9)).padStart(2, '0')}/11 ${String(8 + (i % 12)).padStart(2, '0')}:${String(10 + i).padStart(2, '0')}`,
      texto:
        i % 3 === 0
          ? 'Tem 3 quartos e 2 vagas, até 600 mil, 98 m² 450000'
          : 'O condomínio é R$ 650 e o IPTU R$ 1.200 por ano, 120 m² 2026',
    }));
    const compromissosAbertos = Array.from({ length: 20 }, (_, i) => ({
      quem: 'equipe' as const,
      oQue: `Mandar as ${i + 2} fotos do TE${String(i + 1).padStart(4, '0')}_IMOVA`,
      prazo: `${String(1 + (i % 9)).padStart(2, '0')}/11 ${String(8 + (i % 10)).padStart(2, '0')}:30`,
    }));
    expect(() =>
      prepararChamada(lead, { ...baseDoLead(), carteira, mensagens, compromissosAbertos }, CONTATO),
    ).not.toThrow();
  });
});

describe('prazoVencido', () => {
  it('compara com agora no mesmo dia, antes e depois', () => {
    expect(prazoVencido('09/11 12:00', '2026-11-09 15:00')).toBe(true);
    expect(prazoVencido('09/11 18:00', '2026-11-09 15:00')).toBe(false);
    expect(prazoVencido('09/11 15:00', '2026-11-09 15:00')).toBe(false);
    expect(prazoVencido('08/11 23:59', '2026-11-09 00:01')).toBe(true);
  });

  it('acha o ano certo na virada', () => {
    // "30/12" lido em 2 de janeiro é o dezembro de antes; "02/01" lido em 30/12, o de depois.
    expect(prazoVencido('30/12 18:00', '2027-01-02 09:00')).toBe(true);
    expect(prazoVencido('02/01 09:00', '2026-12-30 18:00')).toBe(false);
  });

  it('sem prazo ou com data ilegível, não é vencido', () => {
    expect(prazoVencido(null, '2026-11-09 15:00')).toBe(false);
    expect(prazoVencido('amanhã', '2026-11-09 15:00')).toBe(false);
    expect(prazoVencido('09/11 12:00', '09/11/2026 15:00')).toBe(false);
  });
});

describe('conselheiro-do-imovel@v1', () => {
  it('roda no Haiku 5.5, com o mesmo propósito do conselho do cliente', () => {
    expect(imovel.modelo).toBe('claude-haiku-5-5');
    expect(imovel.escala).toBe('conversa');
    expect(imovel.proposito).toBe('aconselhar_vendas');
    expect(imovel.proposito).toBe(lead.proposito);
    expect(VIGENTES['conselheiro-do-imovel']).toBe(1);
    expect(promptVigente('conselheiro-do-imovel')).toBe(imovel);
  });

  it('o texto tem a regra de não prometer e manda o preço ao proprietário, com número', () => {
    expect(imovel.sistema).toMatch(/Imova Imobiliária/);
    expect(imovel.sistema).toContain(REGRA_DE_NAO_PROMETER);
    expect(imovel.sistema).toMatch(/Converse com o proprietário sobre o preço/);
    expect(imovel.sistema).toMatch(/com o número que\s+justifica/);
    expect(imovel.sistema).toMatch(/Use só os números que vieram/);
    expect(imovel.sistema).toMatch(/Não invente fato do imóvel/);
    expect(imovel.sistema).toMatch(/destravam visita e proposta/);
    expect(imovel.sistema).not.toMatch(/KOMUNE|Komune|fornecedor|evento|helo[ií]sa/i);
  });

  it('a saída tem exatamente as chaves que ia_conselheiro_imovel_gravar lê', () => {
    const esquema = esquemaDeSaida(imovel) as {
      properties: Record<string, { items?: { properties?: object } }>;
    };
    expect(Object.keys(esquema.properties).sort()).toEqual(['dadosInsuficientes', 'sugestoes']);
    expect(Object.keys(esquema.properties.sugestoes?.items?.properties ?? {}).sort()).toEqual([
      'acao',
      'porque',
      'tipo',
    ]);
    const texto = JSON.stringify(esquema);
    expect(texto).toContain('"enum":["falar","fazer"]');
    expect(texto).toContain('até 90 caracteres');
    expect(texto).toContain('até 160 caracteres');
  });

  it('texto e lista que passam do teto são encurtados; tipo errado é recusado', () => {
    const sugestao = {
      tipo: 'fazer',
      acao: 'Pegue o valor do condomínio com o proprietário e ponha no anúncio, com o IPTU junto',
      porque: 'É a pergunta nº 1 (4 de 5 leads) e o anúncio não informa. '.repeat(4),
    };
    const lida = imovel.saida.parse({
      sugestoes: Array.from({ length: 5 }, () => sugestao),
      dadosInsuficientes: false,
    });
    expect(lida.sugestoes).toHaveLength(3);
    expect(lida.sugestoes[0]!.acao.length).toBeLessThanOrEqual(90);
    expect(lida.sugestoes[0]!.porque.length).toBeLessThanOrEqual(160);
    expect(lida.sugestoes[0]!.porque.endsWith('…')).toBe(true);
    expect(() =>
      imovel.saida.parse({ ...saidaDoImovel(), sugestoes: [{ ...sugestao, tipo: 'mudar' }] }),
    ).toThrow();
  });

  it('todo exemplo passa pelos schemas e pela auditoria; com dados, três sugestões com número', () => {
    for (const { nome, entrada, saida } of imovel.exemplos) {
      expect(() => imovel.entrada.parse(entrada), nome).not.toThrow();
      expect(() => imovel.saida.parse(saida), nome).not.toThrow();
      expect(() => prepararChamada(imovel, entrada, SEM_CONTATO), nome).not.toThrow();
      if (saida.dadosInsuficientes) {
        expect(saida.sugestoes, nome).toEqual([]);
        continue;
      }
      expect(saida.sugestoes, nome).toHaveLength(3);
      expect(new Set(saida.sugestoes.map((s) => s.acao)).size, nome).toBe(3);
      for (const s of saida.sugestoes) {
        expect(s.acao.length, nome).toBeLessThanOrEqual(90);
        expect(s.porque.length, nome).toBeLessThanOrEqual(160);
        // O porquê traz o número que justifica a ação.
        expect(s.porque, `${nome}: ${s.porque}`).toMatch(/\d/);
        expect(prometeSemLevar(s.acao), `${nome}: ${s.acao}`).toBe(false);
      }
    }
    expect(imovel.exemplos.some((e) => e.saida.dadosInsuficientes)).toBe(true);
    expect(
      imovel.exemplos.some((e) =>
        e.saida.sugestoes.some((s) => s.acao === 'Converse com o proprietário sobre o preço'),
      ),
    ).toBe(true);
  });

  it('a mensagem diz o imóvel, os números, as repetições e cada cliente, sem nome', () => {
    const { mensagem } = prepararChamada(imovel, baseDoImovel(), SEM_CONTATO);
    expect(mensagem).toContain('agora: 09/11/2026 às 07:00');
    expect(mensagem).toContain('- código: TE0002_IMOVA');
    expect(mensagem).toContain(
      '- apartamento | à venda | bairro Tirol | 3 quartos | área 98 m² | venda R$ 480.000 | condomínio não informado | IPTU não informado',
    );
    expect(mensagem).toContain('- no ar há: 46 dias');
    expect(mensagem).toContain('- visualizações no portal: 1.840');
    expect(mensagem).toContain('- clientes interessados: 5');
    expect(mensagem).toContain('- condomínio: 4 leads');
    expect(mensagem).toContain('- aceita FGTS: 1 lead');
    expect(mensagem).toContain('- preco: 3 leads');
    expect(mensagem).toContain(
      '- nível muito | Visitou no sábado e quer voltar com a esposa. | perguntou: condomínio, vaga de garagem | objeções: preco | teto R$ 450.000 | pagamento: financiamento',
    );
    const semPortal = prepararChamada(imovel, imovel.exemplos[2]!.entrada, SEM_CONTATO).mensagem;
    expect(semPortal).toContain('- visualizações no portal: não informado');
    expect(semPortal).toContain('PERGUNTAS QUE MAIS SE REPETEM:\n— nenhuma');
  });

  it('telefone na descrição do anúncio é trocado, e a chamada sai', () => {
    const entrada: EntradaDoConselhoDoImovel = {
      ...baseDoImovel(),
      imovel: {
        ...baseDoImovel().imovel,
        descricao: 'Agende sua visita pelo (84) 99405-8888 ou no plantão.',
      },
    };
    const { mensagem } = prepararChamada(imovel, entrada, SEM_CONTATO);
    expect(mensagem).not.toMatch(/99405[-\s]?8888/);
    expect(mensagem).toContain('[[TELEFONE_1]]');
  });

  it('no teto (20 clientes, 10 perguntas e 10 objeções) os números não viram telefone', () => {
    const leads = Array.from({ length: 20 }, (_, i) => ({
      nivel: (['muito', 'interessado', 'morno'] as const)[i % 3]!,
      situacao: `Perguntou o condomínio de R$ ${650 + i} e o IPTU de R$ 1.${200 + i} por ano`,
      perguntas: ['condomínio', 'IPTU', `vaga ${i + 1}`],
      objecoes: ['preco'],
      valorMax: 420000 + i * 1000,
      pagamento: 'financiamento',
    }));
    const perguntasTop = Array.from({ length: 10 }, (_, i) => ({
      tema: `tema ${i + 1}`,
      leads: 20 - i,
    }));
    const objecoesTop = Array.from({ length: 10 }, (_, i) => ({
      objecao: `objeção ${i + 1}`,
      leads: 10 - i,
    }));
    expect(() =>
      prepararChamada(imovel, { ...baseDoImovel(), leads, perguntasTop, objecoesTop }, SEM_CONTATO),
    ).not.toThrow();
  });
});

/**
 * O custo de verdade, que a tabela de `custos.eval.test.ts` não mostra: ela mede o
 * primeiro exemplo, e na fatura entram ainda a conversa longa, a carteira inteira, o
 * esquema da saída (que vai no pedido) e o raciocínio do Haiku 5.5 (esforço baixo).
 * Premissas do pior caso de todo dia: 40 mensagens, 30 imóveis na carteira, 1.000
 * tokens de raciocínio; 20 clientes por imóvel e 800 de raciocínio. Volume do usuário:
 * ~60 clientes e ~15 imóveis por dia, 30 dias (o cliente da Imova escreve todo dia).
 */
describe('conselheiro: o custo do mês', () => {
  const DIAS = 30;

  function pedido(prompt: typeof lead | typeof imovel, mensagem: string): number {
    return (
      prompt.tokensDeSistema +
      estimarTokens(mensagem) +
      estimarTokens(JSON.stringify(esquemaDeSaida(prompt)))
    );
  }

  it('o cliente no pior caso fica abaixo de US$ 0,0015 por chamada e de US$ 3 no mês', () => {
    const carteira: ImovelDaCarteira[] = Array.from({ length: 30 }, (_, i) => ({
      ...baseDoLead().carteira[i % 3]!,
      codigo: `TE${String(i + 1).padStart(4, '0')}_IMOVA`,
    }));
    const mensagens = Array.from({ length: 40 }, (_, i) => ({
      de: (i % 2 === 0 ? 'cliente' : 'ia') as 'cliente' | 'ia',
      quando: '08/11 18:40',
      texto:
        'Boa noite! O apartamento do Tirol ainda está disponível? Qual é o condomínio e o IPTU? Aceita financiamento pela Caixa?',
    }));
    const { mensagem } = prepararChamada(lead, { ...baseDoLead(), carteira, mensagens }, CONTATO);
    const entrada = pedido(lead, mensagem);
    const saida = estimarTokens(JSON.stringify(saidaDoLead())) + 1000;
    const porChamada = custoDaChamada(lead.modelo, { entrada, saida });
    expect(entrada).toBeLessThan(7000);
    expect(porChamada).toBeLessThan(0.0015);
    expect(porChamada * 60 * DIAS).toBeLessThan(3);
  });

  it('o imóvel no pior caso fica abaixo de US$ 0,001 por chamada e de US$ 0,50 no mês', () => {
    const leads = Array.from({ length: 20 }, (_, i) => ({ ...baseDoImovel().leads[i % 5]! }));
    const { mensagem } = prepararChamada(imovel, { ...baseDoImovel(), leads }, SEM_CONTATO);
    const entrada = pedido(imovel, mensagem);
    const saida = estimarTokens(JSON.stringify(saidaDoImovel())) + 800;
    const porChamada = custoDaChamada(imovel.modelo, { entrada, saida });
    expect(porChamada).toBeLessThan(0.001);
    expect(porChamada * 15 * DIAS).toBeLessThan(0.5);
  });
});
