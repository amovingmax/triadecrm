import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { falaDoNo } from './roteiro-texto';
import {
  NO_DE_ABERTURA,
  noSchema,
  noValeNaVariante,
  objecoesDoRoteiro,
  roteiroSchema,
  validarRoteiro,
  type ItemDoLote,
  type NoRoteiro,
  type VarianteRoteiro,
} from './tipos';

/**
 * O roteiro que vai ao ar, lido do arquivo que o publica.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE TESTE EXISTE
 * ---------------------------------------------------------------------------
 * A árvore é o único texto do produto que uma pessoa lê EM VOZ ALTA para um
 * estranho. Um erro aqui não fica numa tela: sai pela boca da Heloísa, e ela não
 * tem como voltar atrás no meio da frase.
 *
 * O gatilho `app.call_scripts_validate` já recusa árvore quebrada na inserção,
 * mas ele mora no Postgres e só fala quando a migração roda. Este teste roda no
 * `pnpm test`, contra o MESMO arquivo que o `db push` vai aplicar, com o
 * `validarRoteiro` e o `noSchema` de verdade — os mesmos que a tela usa.
 *
 * E ele cobre três coisas que o validador do banco não cobre, porque não são
 * erros de estrutura e sim de fala:
 *
 * 1. **Alcançabilidade por variante.** Um nó órfão passa em toda checagem de
 *    integridade e nunca é lido por ninguém. `fim_desligou` nasceu assim.
 * 2. **O marcador vazio.** `[nome]`, `[dia]`, `[hora]` e `[categoria]` faltam o
 *    tempo todo — 66 dos 100 parceiros da base não têm contato nomeado. A frase
 *    tem de continuar sendo português sem eles, e é `falaDoNo` que decide isso.
 * 3. **As promessas proibidas**, que são as do R08 §5.4 e do CLAUDE.md. Não dá
 *    para testar uma promessa por semântica, mas dá para testar as palavras que
 *    a casa decidiu que nunca saem.
 */

const CAMINHO =
  '../../../../../supabase/migrations/20260909180000_o_roteiro_para_de_vender_casamento.sql';

function arvorePublicada(): NoRoteiro[] {
  const sql = readFileSync(new URL(CAMINHO, import.meta.url), 'utf8');
  const bruto = /\$roteiro\$([\s\S]*?)\$roteiro\$/.exec(sql)?.[1];
  if (!bruto) throw new Error('não achei o bloco $roteiro$ na migração');
  return (JSON.parse(bruto) as unknown[]).map((n) => noSchema.parse(n));
}

const NOS = arvorePublicada();
const ROTEIRO = roteiroSchema.parse({
  id: '00000000-0000-4000-8000-000000000000',
  slug: 'captacao_v1',
  nome: 'Captação por ligação — v2',
  versao: 2,
  nos: NOS,
});

const VARIANTES: VarianteRoteiro[] = ['fornecedor', 'produtor'];

describe('roteiro publicado', () => {
  it('passa no mesmo validador que o banco e a tela usam', () => {
    expect(validarRoteiro(ROTEIRO)).toEqual([]);
  });

  it('não deixa nenhum nó fora do caminho, em nenhuma das duas variantes', () => {
    for (const variante of VARIANTES) {
      const alcancaveis = new Set<string>();
      const pilha = [
        NO_DE_ABERTURA,
        // O bloco lateral é alcançável de qualquer nó: a gaveta mostra toda
        // `objecao` da variante, sem depender de aresta.
        ...objecoesDoRoteiro(ROTEIRO, variante).map((n) => n.id),
      ];
      while (pilha.length > 0) {
        const id = pilha.pop();
        if (id === undefined || alcancaveis.has(id)) continue;
        const no = NOS.find((n) => n.id === id);
        if (!no || !noValeNaVariante(no.variante, variante)) continue;
        alcancaveis.add(id);
        for (const saida of no.saidas) pilha.push(saida.destino);
      }
      const orfaos = NOS.filter(
        (n) => noValeNaVariante(n.variante, variante) && !alcancaveis.has(n.id),
      ).map((n) => n.id);
      expect(orfaos, `nós inalcançáveis na variante ${variante}`).toEqual([]);
    }
  });
});

describe('as frases sobrevivem ao marcador vazio', () => {
  // O pior caso real: organização sem contato nomeado e sem categoria, e nada
  // combinado ainda — que é como começa toda ligação da base de hoje.
  const ITEM_PELADO = {
    id: 'i',
    loteId: 'l',
    organizationId: 'o',
    nome: 'Bodega da Terra',
    kind: 'fornecedor',
    categoria: null,
    bairro: null,
    cidade: null,
    telefone: '+5584999999999',
    contatoId: null,
    contatoNome: null,
    origemSlug: 'planilha',
    origemUrl: null,
    dealId: null,
    etapaId: null,
    etapa: null,
    temperatura: 'frio',
    status: 'em_andamento',
    posicao: 1,
    tentativas: 0,
    agendadoPara: null,
    ultimaTentativaEm: null,
    observacao: null,
  } as unknown as ItemDoLote;

  it.each(NOS.map((n) => [n.id, n.texto] as const))(
    '%s não deixa preposição nem travessão órfãos',
    (_id, texto) => {
      const fala = falaDoNo(texto, ITEM_PELADO, 'Heloísa Nogueira', null);
      // Preposição seguida de pontuação é marcador que sumiu e levou o
      // complemento junto: "estou começando por." ou "eu ligo por volta das."
      expect(fala).not.toMatch(/\b(de|da|do|em|na|no|por|pra|com|às|as|até)\s*[.!?,]/iu);
      // `preencherTexto` come espaço antes de pontuação; travessão solto, não.
      expect(fala).not.toMatch(/[—–]\s*[.!?,]/u);
      expect(fala).not.toMatch(/\s{2,}/u);
      expect(fala.trim()).toBe(fala);
    },
  );

  it('não presume o gênero de quem liga nem de quem atende', () => {
    for (const no of NOS) {
      const alvo = `${no.texto} ${no.saidas.map((s) => s.rotulo).join(' ')}`;
      // "Obrigado" concorda com quem FALA, e quem mais liga é a Heloísa.
      expect(alvo, no.id).not.toMatch(/\bobrigad[oa]\b/iu);
      // "com ele", "o nome dele", "espere ele confirmar": a decisora do mercado
      // de eventos de Natal costuma ser mulher.
      expect(alvo, no.id).not.toMatch(/\b(com|pra|para|passar pra)\s+ele\b/iu);
      expect(alvo, no.id).not.toMatch(/\bdele\b/iu);
      expect(alvo, no.id).not.toMatch(/\beu mesm[oa]\b/iu);
    }
  });

  it('nunca cola artigo em [empresa]', () => {
    // "do [empresa]" quebra em pelo menos 30 dos 67 nomes reais da base:
    // "do Agência Rocas", "o Bodega da Terra", "aí no Vivier Recepções".
    for (const no of NOS) {
      expect(no.texto, no.id).not.toMatch(/\b(o|a|os|as|do|da|no|na|dos|das)\s+\[empresa\]/iu);
    }
  });
});

describe('o que a casa decidiu que nunca se diz', () => {
  const TODO_O_TEXTO = NOS.map((n) => `${n.texto} ${n.nota ?? ''}`).join('\n');
  const SO_AS_FALAS = NOS.map((n) => n.texto).join('\n');

  it('não promete exclusividade, posição na vitrine nem volume de pedido', () => {
    // R08 §5.4 e CLAUDE.md. A v1 prometia duas destas em `obj_quem_ja_usa`:
    // "um por segmento" e "quem entra agora aparece primeiro".
    expect(SO_AS_FALAS).not.toMatch(/exclusiv/iu);
    expect(SO_AS_FALAS).not.toMatch(/um por segmento/iu);
    expect(SO_AS_FALAS).not.toMatch(/aparece primeiro/iu);
    expect(SO_AS_FALAS).not.toMatch(/\bgrátis\b/iu);
    expect(SO_AS_FALAS).not.toMatch(/\bpromoção\b/iu);
    expect(SO_AS_FALAS).not.toMatch(/\bgarantid[oa]\b/iu);
  });

  it('não vende recurso que a FAQ não cobre', () => {
    // A FAQ cobre busca por categoria/tipo/data/preço, vitrine com avaliação, e o
    // pedido chegando com data e número de pessoas. A v1 vendia outros quatro.
    expect(SO_AS_FALAS).not.toMatch(/orçamento pra tod|orçamento para tod/iu);
    expect(SO_AS_FALAS).not.toMatch(/quem já entregou bem/iu);
    expect(SO_AS_FALAS).not.toMatch(/quem está disponível/iu);
    expect(SO_AS_FALAS).not.toMatch(/contrato no mesmo painel/iu);
  });

  it('diz o preço em vez de adiá-lo', () => {
    // A decisão do Rafael, registrada: "esquece a promoção; vai dizer o custo que
    // a gente cobra: 8%". A v1 mandava a pergunta para o financeiro.
    expect(SO_AS_FALAS).toMatch(/\b8%/u);
    expect(SO_AS_FALAS).toMatch(/sem mensalidade|não tem mensalidade|paga mensalidade/iu);
    // E o cerimonialista RECEBE: 3% Komune + 5% para ele, no contrato.
    expect(SO_AS_FALAS).toMatch(/5%/u);
    expect(SO_AS_FALAS).toMatch(/3%/u);
  });

  it('não abre a ligação por casamento, que é ocasião e não categoria', () => {
    const abertura = NOS.find((n) => n.id === NO_DE_ABERTURA);
    const ganchos = NOS.filter((n) => n.id.startsWith('gancho_'));
    for (const no of [abertura, ...ganchos]) {
      expect(no, 'gancho ausente').toBeDefined();
      if (!no) continue;
      const primeiraFrase = no.texto.split(/(?<=[.?!])\s/)[0] ?? no.texto;
      expect(primeiraFrase, no.id).not.toMatch(/casamento|noiv/iu);
    }
    // Quando casamento aparece, aparece dentro de uma lista de ocasiões.
    for (const no of NOS) {
      if (!/casamento/iu.test(no.texto)) continue;
      expect(no.texto, `${no.id}: casamento sozinho`).toMatch(
        /festa|formatura|empresa|aniversário|corporativo/iu,
      );
    }
  });

  it('diz "aqui de Natal", nunca "evento de Natal"', () => {
    // Ao telefone, "evento de Natal" é a festa de dezembro.
    expect(TODO_O_TEXTO).not.toMatch(/evento de Natal\b/u);
    expect(TODO_O_TEXTO).not.toMatch(/fornecedor(es)? de Natal\b/u);
  });

  it('não chama junho e julho de meses fracos, que aqui é São João e férias', () => {
    // A baixa que a própria casa documentou é janeiro e fevereiro (R08 §2.0).
    expect(SO_AS_FALAS).not.toMatch(/junho e julho/iu);
    expect(SO_AS_FALAS).not.toMatch(/mês fraco|meses fracos/iu);
  });

  it('oferece opt-out no ponto em que a recusa acontece', () => {
    // Na v1 o opt-out existia em três nós laterais e NÃO existia nas propostas,
    // que é onde a pessoa de fato diz não.
    for (const id of ['forn_proposta', 'prod_proposta']) {
      const no = NOS.find((n) => n.id === id);
      expect(no, id).toBeDefined();
      expect(no?.saidas.some((s) => s.destino === 'fim_optout'), id).toBe(true);
    }
  });

  it('não promete apagar o contato de quem pede para parar', () => {
    // O número entra na `suppression_list` e FICA lá: é isso que impede a próxima
    // ligação. Prometer "apago o seu contato" é prometer o contrário do que o
    // sistema faz — e foi o que a v1 dizia em `obj_origem`.
    //
    // A negativa É a redação certa ("Não apago o contato: marco como bloqueado"),
    // então o teste procura a PROMESSA, não a palavra: qualquer forma de apagar
    // que não venha precedida de negação.
    const prometeApagar = (texto: string) =>
      /(?<!\b(não|nao|nunca)\s)\b(apago|apagar|excluo|excluir|deleto|deletar)\b/iu.test(texto);

    for (const id of ['fim_optout', 'obj_origem', 'obj_hostil']) {
      const no = NOS.find((n) => n.id === id);
      expect(no, id).toBeDefined();
      expect(prometeApagar(no?.texto ?? ''), `${id} promete apagar o contato`).toBe(false);
    }
    // E a instrução operacional não pode se perder: sem marcar a supressão, o
    // desfecho sozinho é Perdido com 90 dias de espera — ou seja, quem mandou
    // parar volta a ser ligado em 90 dias, e a frase do nó vira mentira.
    expect(NOS.find((n) => n.id === 'fim_optout')?.nota ?? '').toMatch(/supress/iu);
  });
});

describe('a gaveta de objeções', () => {
  it.each(VARIANTES)('mostra a %s um bloco sem contradição de preço', (variante) => {
    const objecoes = objecoesDoRoteiro(ROTEIRO, variante);
    expect(objecoes.length).toBeGreaterThan(8);
    if (variante === 'produtor') {
      // O defeito que este roteiro existe para corrigir: na v1 as nove objeções
      // eram todas `ambas`, e o cerimonialista que perguntava "quanto custa?"
      // ouvia que ia PAGAR comissão. Ele recebe 5%.
      const falas = objecoes.map((n) => n.texto).join('\n');
      expect(falas).toMatch(/você não paga|Pra você, nada|não paga nada/iu);
      expect(falas).toMatch(/5%/u);
    }
  });

  it('não repete a mesma objeção duas vezes no mesmo bloco', () => {
    for (const variante of VARIANTES) {
      const ids = objecoesDoRoteiro(ROTEIRO, variante).map((n) => n.id);
      expect(new Set(ids).size, variante).toBe(ids.length);
    }
  });
});
