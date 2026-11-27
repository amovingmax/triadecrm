import { describe, expect, it } from 'vitest';

import { VIGENTES, obterPrompt, promptVigente } from '../src/catalogo';
import { varrerMontagem } from '../src/nucleo/auditoria-pii';
import { prepararChamada } from '../src/nucleo/chamada';
import { atendenteImovaV5 as v5 } from '../src/prompts/atendente-imova/v5';
import { BASE_DO_ENSAIO_V5 } from '../src/prompts/atendente-imova/cenarios-v5';
import {
  FRASE_DO_CONVITE,
  type EntradaDoAtendenteV6,
  atendenteImovaV6 as v6,
  linhaDoEmail,
  sistemaComBaseV6,
} from '../src/prompts/atendente-imova/v6';

/**
 * `atendente-imova@v6` (17/11/2026): A V5 COM O E-MAIL PARA OFERTAS.
 *
 * Pedido do usuário: "treinar a IA para pedir o email das pessoas caso elas queiram
 * receber mais ofertas e receberem mais promoções". Prova-se aqui que a v6 é a v5 com só
 * o bloco do e-mail e a linha da saída a mais, que a entrada leva se a ficha tem e-mail
 * (nunca o endereço), e que o e-mail que o cliente escreve chega ao modelo como marcador.
 */

const CONTATO = {
  leadId: 'lead-21',
  nome: 'Ana Lima',
  empresa: null,
  telefones: ['+5584988776655'],
  emails: ['ana.lima@exemplo.com.br'],
};

const comBase = { ...v6, sistema: sistemaComBaseV6(BASE_DO_ENSAIO_V5) };

function entrada(
  email: EntradaDoAtendenteV6['cliente']['email'],
  texto: string,
): EntradaDoAtendenteV6 {
  return {
    leadId: 'lead-21',
    agora: '2026-11-17T10:24',
    agoraPorExtenso: 'terça-feira, 17 de novembro, às 10h24',
    treino: false,
    cliente: {
      nome: 'Ana Lima',
      temFicha: true,
      etapa: 'Respondeu',
      perfil: [],
      visitas: [],
      canalDeChegada: 'anuncios',
      email,
    },
    convitesDaAgenda: [],
    respostasNaUltimaHora: 1,
    mensagens: [
      { messageId: 'm1', de: 'ia', quem: null, quando: '17/11 10:20', texto: FRASE_DO_CONVITE },
      { messageId: 'm2', de: 'cliente', quem: null, quando: '17/11 10:23', texto },
    ],
  };
}

describe('atendente-imova@v6: o contrato', () => {
  it('deu lugar à v7 e continua no catálogo, com a v5', () => {
    // Desde 23/11/2026 a vigente é a v7 (a v6 com a busca no mapa); a v6 segue no
    // catálogo, intacta, e é a que o worker usa quando não há mapa.
    expect(VIGENTES['atendente-imova']).toBe(11);
    expect(promptVigente('atendente-imova')).not.toBe(v6);
    expect(obterPrompt('atendente-imova', 6)).toBe(v6);
    expect(obterPrompt('atendente-imova', 5)).toBe(v5);
    expect(v6.versao).toBe(6);
  });

  it('o modelo, o propósito, a escala e os campos são os da v5', () => {
    expect(v6.modelo).toBe(v5.modelo);
    expect(v6.proposito).toBe(v5.proposito);
    expect(v6.escala).toBe(v5.escala);
    expect(v6.maxTokens).toBe(v5.maxTokens);
    expect(v6.camposDeTexto).toEqual(v5.camposDeTexto);
    expect(v6.camposDoTriade).toEqual(v5.camposDoTriade);
  });

  it('o texto é o da v5 mais o bloco do e-mail e a linha da saída, e nada sai', () => {
    const linhasV5 = v5.sistema.split('\n');
    const linhasV6 = v6.sistema.split('\n');
    expect(linhasV5.filter((l) => !linhasV6.includes(l))).toEqual([]);
    const inicio = v6.sistema.indexOf('O E-MAIL PARA OFERTAS (acao = responder):');
    const fim = v6.sistema.indexOf('O QUE É DE GENTE (acao = passar_para_corretor):');
    expect(inicio).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);
    // Sem o bloco e sem a linha nova da saída, é a v5 de volta.
    const semOBloco = v6.sistema.slice(0, inicio) + v6.sistema.slice(fim);
    expect(
      semOBloco.replace(
        '- `ofertasPorEmail`: "aceitou", "recusou" ou null (ver O E-MAIL PARA OFERTAS).\n',
        '',
      ),
    ).toBe(v5.sistema);
  });

  it('o bloco diz quando, quando não, uma vez só, a frase e o que fazer com o e-mail', () => {
    const bloco = v6.sistema.slice(
      v6.sistema.indexOf('O E-MAIL PARA OFERTAS'),
      v6.sistema.indexOf('O QUE É DE GENTE'),
    );
    expect(bloco).toContain('Convide só quando a ficha existe');
    expect(bloco).toContain('Recusou? Não convide de novo.');
    expect(bloco).toContain('Nunca na primeira resposta da conversa');
    expect(bloco).toContain('Uma vez por conversa.');
    expect(bloco).toContain(FRASE_DO_CONVITE);
    expect(bloco).toContain('nunca nao_responder');
    expect(bloco).toContain('Não repita o endereço nem o marcador');
    expect(bloco).toContain('isto vale mais que\n  QUANDO NÃO RESPONDER');
  });

  it('o bloco de sistema com a base não tem dado pessoal', () => {
    expect(varrerMontagem(sistemaComBaseV6(BASE_DO_ENSAIO_V5))).toEqual([]);
  });
});

describe('atendente-imova@v6: a entrada e a saída', () => {
  it('a linha do e-mail diz os três estados, sem data', () => {
    expect(linhaDoEmail({ naFicha: false, ofertas: null })).toBe(
      'e-mail do cliente: ainda não está na ficha; ofertas por e-mail: nunca respondeu ao convite',
    );
    expect(linhaDoEmail({ naFicha: true, ofertas: 'aceitou' })).toBe(
      'e-mail do cliente: já está na ficha; ofertas por e-mail: aceitou receber',
    );
    expect(linhaDoEmail({ naFicha: false, ofertas: 'recusou' })).toBe(
      'e-mail do cliente: ainda não está na ficha; ofertas por e-mail: recusou (não convide de novo)',
    );
  });

  it('a mensagem é a da v5 com a linha do e-mail antes do perfil', () => {
    const dados = entrada({ naFicha: false, ofertas: null }, 'Pode mandar sim');
    const mensagem = v6.montarMensagem(dados);
    expect(mensagem.replace(`${linhaDoEmail(dados.cliente.email)}\n`, '')).toBe(
      v5.montarMensagem(dados),
    );
    expect(mensagem).toMatch(
      /canal de chegada: anuncios\ne-mail do cliente: .*\no que já se sabe dele:/,
    );
  });

  it('o e-mail que o cliente escreve chega ao modelo como marcador, e volta na reidratação', () => {
    const chamada = prepararChamada(
      comBase,
      entrada({ naFicha: false, ofertas: null }, 'Pode mandar sim: ana.lima@exemplo.com.br'),
      CONTATO,
    );
    expect(chamada.mensagem).not.toContain('ana.lima@exemplo.com.br');
    expect(chamada.mensagem).toMatch(/Pode mandar sim: \[\[EMAIL_\d\]\]/);
    expect(chamada.promptVersion).toBe('atendente-imova@v6');
    const saida = chamada.interpretar({
      acao: 'responder',
      mensagem: 'Perfeito, anotado! Vou te enviar as novidades por e-mail.',
      agenda: null,
      motivo: 'Aceitou o convite.',
      anotacoes: [],
      fotosEnsinadas: [],
      confianca: 0.9,
      ofertasPorEmail: 'aceitou',
    });
    expect(saida.ofertasPorEmail).toBe('aceitou');
  });

  it('um e-mail que a ficha ainda não conhece também chega ao modelo como marcador', () => {
    const semEmailNaFicha = { ...CONTATO, emails: [] };
    const chamada = prepararChamada(
      comBase,
      entrada(
        { naFicha: false, ofertas: null },
        'manda pra outro.endereco@provedor.com.br, por favor',
      ),
      semEmailNaFicha,
    );
    expect(chamada.mensagem).not.toContain('outro.endereco');
    expect(chamada.mensagem).toMatch(/manda pra \[\[EMAIL_\d\]\]/);
  });

  it('a saída recusa uma resposta ao convite inventada, e exige o campo', () => {
    const base = {
      acao: 'responder',
      mensagem: 'Certo!',
      agenda: null,
      motivo: 'x',
      anotacoes: [],
      fotosEnsinadas: [],
      confianca: 0.9,
    };
    expect(() => v6.saida.parse({ ...base, ofertasPorEmail: 'talvez' })).toThrow();
    expect(() => v6.saida.parse(base)).toThrow();
    expect(v6.saida.parse({ ...base, ofertasPorEmail: null }).ofertasPorEmail).toBeNull();
  });

  it('a entrada exige o e-mail e não aceita o endereço no lugar do sim/não', () => {
    const dados = entrada({ naFicha: true, ofertas: null }, 'oi');
    expect(() => v6.entrada.parse(dados)).not.toThrow();
    const semEmail = { ...dados, cliente: { ...dados.cliente, email: undefined } };
    expect(() => v6.entrada.parse(semEmail)).toThrow();
    const comEndereco = { ...dados, cliente: { ...dados.cliente, email: 'ana@exemplo.com' } };
    expect(() => v6.entrada.parse(comEndereco)).toThrow();
  });

  it('todos os exemplos passam pelos schemas e pela montagem', () => {
    expect(v6.exemplos.length).toBe(v5.exemplos.length + 3);
    for (const e of v6.exemplos) {
      expect(() => v6.entrada.parse(e.entrada), e.nome).not.toThrow();
      expect(() => v6.saida.parse(e.saida), e.nome).not.toThrow();
      expect(() => prepararChamada(comBase, e.entrada, CONTATO), e.nome).not.toThrow();
    }
  });

  it('os exemplos da v5 vêm com o e-mail na ficha e sem resposta ao convite', () => {
    for (const e of v6.exemplos.slice(0, v5.exemplos.length)) {
      expect(e.entrada.cliente.email, e.nome).toEqual({ naFicha: true, ofertas: null });
      expect(e.saida.ofertasPorEmail, e.nome).toBeNull();
    }
  });

  it('os exemplos novos: convida uma vez, aceita sem repetir o endereço, e o "não" fica', () => {
    const [convite, aceitou, recusou] = v6.exemplos.slice(v5.exemplos.length);
    expect(convite!.saida.mensagem).toContain(FRASE_DO_CONVITE);
    expect(convite!.saida.ofertasPorEmail).toBeNull();
    expect(aceitou!.saida.ofertasPorEmail).toBe('aceitou');
    expect(aceitou!.saida.mensagem).not.toMatch(/EMAIL|@/);
    expect(recusou!.saida.ofertasPorEmail).toBe('recusou');
    expect(recusou!.saida.mensagem).not.toContain('e-mail');
  });
});
