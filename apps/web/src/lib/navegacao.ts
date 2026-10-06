/**
 * Navegação principal do CRM, em TRÊS GRUPOS.
 *
 * ---------------------------------------------------------------------------
 * POR QUE TRÊS GRUPOS, E NÃO DOZE ITENS SOLTOS
 * ---------------------------------------------------------------------------
 * A queixa do Rafael foi "muitas abas e pouco direcionamento", com uma analogia
 * exata: "tenho um site só, mas essas três abas são focadas no marketplace e
 * essas duas no controle administrativo". Ele não pediu menos telas — pediu que
 * a barra lateral DIGA para que serve cada uma antes do clique.
 *
 * A resposta foi agrupar, e não apagar: itens em três grupos nomeados leem-se
 * como três coisas, e o menu para de competir consigo mesmo.
 *
 * (Isso valeu até o PIVÔ DE 06/10/2026, que apagou de verdade: Campanhas e
 * Cadências deixaram de existir no produto, e Registrar saiu do menu — a tela
 * continua, e chega-se a ela pelo botão "Registrar contato" da conversa, da
 * ligação e da ficha. No mesmo dia os papéis viraram três, e o SDR passou a ver
 * só o que é do trabalho dele: Meu dia, Conversas, Ligar, Agenda, Funis e Metas.)
 *
 * O critério do grupo é a NATUREZA DO TRABALHO, que é literalmente o que ele
 * pediu para distinguir:
 *
 *   `todo_dia`  você faz com as próprias mãos, várias vezes por dia. Sai daqui
 *               contato, ligação, mensagem e reunião — o dia acontece nestas
 *               cinco telas.
 *   `a_base`    o que já existe no CRM e em que pé está. Você vem aqui para
 *               ACHAR alguém e para organizar, não para produzir contato.
 *   `controle`  os números da semana e as regras que o CRM segue sozinho. Mexe-se
 *               uma vez por semana, ou menos.
 *
 * ---------------------------------------------------------------------------
 * O REALCE NÃO GASTA COR, E O NÚMERO É A REGRA DE OURO
 * ---------------------------------------------------------------------------
 * A única cromia do produto é a escala térmica (frio/morno/quente). Um menu
 * colorido roubaria o único significado que a cor tem aqui. Então o realce é
 * estrutural: peso e tinta em três degraus, e o grupo `controle` empurrado para
 * o rodapé por `mt-auto`, atrás da única hairline da lateral. Distância e linha
 * dizem "isto não é do seu dia" sem pedir uma legenda.
 *
 * E há uma regra que faz o menu direcionar de verdade, esta sim falsificável:
 *
 *   **um número ao lado do item significa trabalho parado esperando por você.**
 *   Quem CONFIGURA nunca mostra número.
 *
 * É por isso que Revisão e Conversas contam, e Metas, Relatórios e Ajustes não
 * contam nunca — nem quando teriam o que contar. A contagem da
 * Revisão chega pronta do servidor (`lib/filas-do-menu.ts`), no mesmo `layout`
 * que já busca a sessão: sem consulta no cliente, sem estado de carregamento
 * piscando na lateral a cada troca de tela.
 *
 * A de Conversas é a exceção, e por necessidade (01/10/2026): ela conta as
 * respostas novas PARA ESTA PESSOA, sobe quando alguém responde e cai conversa a
 * conversa, conforme a pessoa abre cada uma (02/10/2026; antes zerava ao entrar
 * na tela). Um número que só mudasse na recarga da página diria
 * "ninguém respondeu" a quem está há uma hora no funil. Quem o mantém vivo é o
 * aviso de resposta (`components/avisos`), que escuta o banco.
 *
 * ---------------------------------------------------------------------------
 * DUAS COISAS QUE JÁ CUSTARAM CARO
 * ---------------------------------------------------------------------------
 * 1. `descricao` não é enfeite nem roadmap: ela é o índice de busca da paleta
 *    (⌘K) e o texto que aparece sob o rótulo no menu "Mais" do celular. Uma
 *    descrição desatualizada não fica só feia: manda a pessoa para a tela errada
 *    em silêncio. Ao mexer numa tela, releia a linha dela aqui. O que a frase
 *    promete, a tela entrega HOJE.
 *
 * 2. `papeis` não é cosmético. Sem ele o item aparece para quem a rota vai
 *    recusar, e a recusa do `requireRole` é um `redirect('/sem-permissao')`: a
 *    pessoa clica, perde a tela em que estava e cai numa rota sem item aceso em
 *    lugar nenhum. Isso não é uma negativa, é uma ejeção.
 *
 * ---------------------------------------------------------------------------
 * O CAMPO `dia` MORREU AQUI
 * ---------------------------------------------------------------------------
 * Até 09/09/2026 cada item carregava um `dia` ('D1/D2', 'D4', 'D8'), do
 * calendário de construção do PRD §11.2. Ele nunca foi renderizado na navegação
 * — o `nav-link.tsx` recusava mostrá-lo, por escrito —, e o único consumidor era
 * a tela "Em construção", que nenhuma rota usa desde que as doze telas ficaram
 * prontas. Enquanto o campo existisse, a próxima tela entraria na lista por
 * inércia, com o dia dela, como se a barra lateral fosse o backlog.
 *
 * (Registro honesto: a auditoria de 09/09 concluiu que "o menu é o cronograma de
 * sprint virado barra lateral". A parte factual disso é o campo morto acima. A
 * parte retórica não se sustenta: a ordem nunca foi a do calendário — o primeiro
 * item é o D8, o segundo é o D4, o terceiro é o D1/D2.)
 */
import {
  CalendarDays,
  ChartColumn,
  Handshake,
  ListChecks,
  type LucideIcon,
  MessageCircle,
  PhoneCall,
  Settings,
  SquareKanban,
  Sun,
  Target,
} from 'lucide-react';

import { acompanhaEquipe } from '@/lib/auth/hierarquia';
import { type AppRole } from '@/lib/auth/role';

/** A que grupo da lateral o item pertence. A ordem aqui é a ordem na tela. */
export type ChaveDeGrupo = 'todo_dia' | 'a_base' | 'controle';

/**
 * Qual fila o item conta, quando conta.
 *
 * `null` (a maioria) significa "este item NUNCA mostra número". Não é ausência de
 * dado: é a metade de baixo da regra. Um número em Ajustes ou em Metas diria
 * "tem trabalho parado aí" sobre uma tela onde nada espera por ninguém.
 */
export type ChaveDeFila = 'candidatos' | 'respostas';

export type ItemNavegacao = {
  href: string;
  rotulo: string;
  icone: LucideIcon;
  grupo: ChaveDeGrupo;
  /**
   * O que a tela entrega HOJE, em uma frase. É texto visível (paleta e menu
   * "Mais") e, ao mesmo tempo, o índice pelo qual a paleta encontra o módulo: as
   * palavras que alguém digitaria para chegar aqui precisam estar nesta frase.
   */
  descricao: string;
  /**
   * Posição na barra inferior do celular, de 1 a 5. Ausente = fica no menu "Mais".
   *
   * É um número, e não um booleano, porque a barra do celular e a lateral do
   * desktop ordenam por critérios diferentes — e fingir que é o mesmo critério foi
   * o que quase quebrou a barra quando os grupos entraram.
   *
   * A lateral ordena por NATUREZA do trabalho (os três grupos). A barra ordena por
   * FREQUÊNCIA DO POLEGAR, que é outra coisa: Parceiros é a busca do produto e
   * mora no meio da barra desde o D1; Conversas é leitura de uma vez por dia
   * enquanto a Meta não libera o número. Agrupar a lateral empurrou Conversas para
   * a terceira fatia e Parceiros para a quarta, sem que ninguém tivesse decidido
   * isso — e mudar de lugar o botão que a mão já sabe achar é o tipo de mudança
   * que a pessoa sente e não sabe nomear. A posição fica escrita aqui.
   */
  posicaoNaBarra?: 1 | 2 | 3 | 4 | 5;
  /** Restringe o item a alguns papéis; sem valor, todos veem. */
  papeis?: readonly AppRole[];
  /** A fila que este item conta na lateral. Ausente = nunca mostra número. */
  fila?: ChaveDeFila;
  /**
   * Um dos 6 itens sempre à vista na lateral (Fase 1, 21/09/2026). O resto mora
   * em "Mais", fechado: 13 itens abertos era o que fazia a tela parecer poluída.
   * A ordem dos principais é a de `ORDEM_PRINCIPAL`, não a do array.
   */
  principal?: boolean;
};

/** A ordem dos itens sempre à vista: do que se abre toda hora ao que se abre no fim do dia. */
export const ORDEM_PRINCIPAL = [
  '/meu-dia',
  '/conversas',
  '/ligar',
  '/funis',
  '/parceiros',
  '/relatorios',
] as const;

export type GrupoDeNavegacao = {
  chave: ChaveDeGrupo;
  /** Cabeçalho na lateral. Curto: cabe em 208px menos o respiro. */
  titulo: string;
  /**
   * A frase que explica o grupo, para quem nunca viu o CRM.
   *
   * Não cabe na lateral do desktop (um cabeçalho de 11px numa coluna de 208px é
   * uma linha, não um parágrafo) e por isso aparece na folha "Mais" do celular,
   * que é onde alguém de fato para para ler o que é cada coisa.
   */
  explicacao: string;
};

export const GRUPOS: readonly GrupoDeNavegacao[] = [
  {
    chave: 'todo_dia',
    titulo: 'Todo dia',
    explicacao:
      'O que você faz com as próprias mãos, várias vezes por dia. Se você só abrir estas telas, o dia acontece.',
  },
  {
    chave: 'a_base',
    titulo: 'A base',
    explicacao:
      'Quem já está no CRM e em que pé está cada negócio. Você vem aqui para achar alguém e para organizar, não para produzir contato.',
  },
  {
    chave: 'controle',
    titulo: 'Controle',
    explicacao:
      'Os números da semana e as regras que o CRM segue sozinho depois de configuradas. Mexe-se uma vez por semana, ou menos.',
  },
];

/**
 * Os três papéis de gente que existem desde o pivô de 06/10/2026: admin, gestor
 * e SDR. Embaixador, leitura e financeiro saíram (ninguém os tinha em produção);
 * continuam no enum do banco, e quem ainda chegar com um deles não vê menu.
 *
 * Quem decide continua sendo o Postgres; isto só evita oferecer o que vai falhar.
 */
const PAPEIS_DO_CRM: readonly AppRole[] = ['admin', 'gestor', 'sdr'];

/**
 * Admin e gestor: quem cuida da BASE — a lista de parceiros, a fila de Revisão,
 * a importação, os relatórios e os ajustes.
 *
 * O SDR ficou de fora de tudo isso no pivô: o trabalho dele é ligar e conversar
 * com quem já é dele. Ele continua abrindo a FICHA de um parceiro (`/parceiros/[id]`)
 * a partir da conversa, do funil ou do Meu dia; o que saiu foi a lista.
 */
const PAPEIS_QUE_GERENCIAM: readonly AppRole[] = ['admin', 'gestor'];

export const NAVEGACAO: readonly ItemNavegacao[] = [
  // -------------------------------------------------------------------------
  // Todo dia
  // -------------------------------------------------------------------------
  {
    href: '/meu-dia',
    principal: true,
    rotulo: 'Meu dia',
    icone: Sun,
    grupo: 'todo_dia',
    descricao:
      'O dia em três abas: Para fazer (quem respondeu, urgente, até o fim do dia, sem próxima ação, parados), Feito hoje separado por como foi, e Próximos dias; mais o resumo do dia e o quanto falta da meta.',
    posicaoNaBarra: 1,
  },
  {
    href: '/ligar',
    rotulo: 'Ligar',
    icone: PhoneCall,
    grupo: 'todo_dia',
    descricao:
      'Prospecção ativa por ligação: lote com fila reservada na montagem, roteiro em árvore, tabulação em dois eixos e opt-out quando o parceiro pede para parar.',
    // `papeis` NOVO, e conserta uma ejeção que existia desde o D5: o item
    // aparecia para leitura e financeiro, a rota não tinha guarda de servidor
    // nenhuma, e a pessoa montava um lote inteiro para descobrir no fim que a
    // `registrar_contato` devolve `sem_permissao`. `PAPEIS_QUE_LIGAM`, em
    // `components/ligacao/chamada-contexto.ts`, já era este conjunto.
    papeis: PAPEIS_DO_CRM,
    // Desde o pivô de 06/10/2026 ligar é metade do trabalho do SDR: o item fica
    // sempre à vista e herda, no celular, a fatia que era do Registrar.
    principal: true,
    posicaoNaBarra: 2,
  },
  {
    href: '/conversas',
    principal: true,
    rotulo: 'Conversas',
    icone: MessageCircle,
    grupo: 'todo_dia',
    descricao:
      'O histórico de cada parceiro, a fila de aprovação dos rascunhos da IA e o relógio da janela de 24 h do WhatsApp.',
    posicaoNaBarra: 5,
    // Resposta nova para esta pessoa: alguém escreveu e espera por ela. Até
    // 01/10/2026 o número aqui era o de rascunhos da IA pendentes; eles continuam
    // na aba "Aprovar", dentro da tela. Somar os dois misturaria "chegou
    // resposta" com "tem rascunho", e o número não cairia ao abrir a conversa.
    fila: 'respostas',
  },
  {
    href: '/agenda',
    rotulo: 'Agenda',
    icone: CalendarDays,
    grupo: 'todo_dia',
    descricao:
      'Reuniões em vídeo pela manhã, rota de visitas à tarde com link do Google Maps e lembretes.',
  },

  {
    href: '/revisao',
    rotulo: 'Revisão',
    icone: ListChecks,
    grupo: 'todo_dia',
    descricao:
      'A fila de quem ainda não é parceiro, de qualquer origem: cada nome com pontuação, o que a IA achou dele e as duplicatas já apontadas. Aprovar cria a ficha e o negócio no funil.',
    // Só admin e gestor aprovam e põem gente na base (pivô de 06/10/2026).
    papeis: PAPEIS_QUE_GERENCIAM,
    // A fila de revisão é o exemplo mais puro da regra: candidato que entrou e
    // não foi revisado é trabalho parado esperando uma pessoa decidir.
    fila: 'candidatos',
  },

  // -------------------------------------------------------------------------
  // A base
  // -------------------------------------------------------------------------
  {
    href: '/parceiros',
    principal: true,
    rotulo: 'Parceiros',
    icone: Handshake,
    grupo: 'a_base',
    // "Importar planilha" entrou na frase porque a rota `/importar` saiu do menu
    // e virou botão no cabeçalho desta tela. A palavra continua achável na
    // paleta, e agora leva a quem tem o botão — e continua aqui depois de o
    // botão virar "Trazer uma lista", porque é a palavra que a pessoa digita.
    descricao:
      'Base de organizações e pessoas com busca global, filtros, criação rápida com dedup por telefone e o botão de trazer uma lista para a base (importar planilha ou CSV).',
    posicaoNaBarra: 3,
    // A LISTA é de quem cuida da base. O SDR chega à ficha pela conversa.
    papeis: PAPEIS_QUE_GERENCIAM,
  },
  {
    href: '/funis',
    principal: true,
    rotulo: 'Funis',
    icone: SquareKanban,
    grupo: 'a_base',
    descricao:
      'Kanban dos funis de captação e de produtores, cartão com semáforo, próxima ação obrigatória e motivos de perda.',
    posicaoNaBarra: 4,
  },
  // -------------------------------------------------------------------------
  // Controle
  // -------------------------------------------------------------------------
  {
    href: '/metas',
    rotulo: 'Metas',
    icone: Target,
    grupo: 'controle',
    descricao:
      'Meta e realizado por pessoa e por período, o quanto falta e a que ritmo, com as métricas que ainda não são medíveis marcadas como tal.',
  },
  {
    href: '/relatorios',
    principal: true,
    rotulo: 'Relatórios',
    icone: ChartColumn,
    grupo: 'controle',
    descricao: 'Relatório de segunda-feira (texto + XLSX), funil e atividades por pessoa.',
    papeis: PAPEIS_QUE_GERENCIAM,
  },
  {
    // Era "Admin". "Ajustes" diz o que a tela faz; "Admin" dizia quem entra —
    // e quem entra já é decidido por `papeis`, não pelo rótulo.
    href: '/admin',
    rotulo: 'Ajustes',
    icone: Settings,
    grupo: 'controle',
    descricao:
      'Pessoas e papéis, os catálogos do CRM (categorias, feriados, motivos de perda, desfechos, modelos de mensagem) e as ferramentas de LGPD.',
    papeis: PAPEIS_QUE_GERENCIAM,
  },
];

/**
 * Rota que abre o cadastro rápido de parceiro (RF-BAS-15).
 *
 * Contrato entre a casca e a tela de parceiros: a paleta de comandos e o botão de
 * ação só navegam; quem lê `?novo=1` e abre a folha é a tela `/parceiros`. Assim o
 * atalho funciona de qualquer módulo e o endereço pode ser compartilhado.
 */
export const HREF_NOVO_PARCEIRO = '/parceiros?novo=1';

/**
 * Rota da importação de planilha.
 *
 * A tela continua existindo, com o mesmo endereço; o que saiu foi o ITEM DE MENU.
 * Importar uma planilha é coisa que se faz uma vez por mês, e um item permanente
 * na lateral cobrava atenção diária por isso. Em compensação, ela ganhou a porta
 * que nunca teve: até 09/09/2026 `/parceiros` não tinha UM link para `/importar`
 * — os três únicos links vivos do produto estavam em painéis de Relatórios, o
 * que é o oposto de onde alguém procuraria.
 */
export const HREF_IMPORTAR = '/importar';

/**
 * Quem põe gente na base pelo cadastro rápido, pela Revisão e pela importação:
 * admin e gestor (pivô de 06/10/2026). O SDR não adiciona lead; a porta que ele
 * tem é outra e mora na conversa — "Virar parceiro", em `conversas/fora-da-base.tsx`.
 */
export function podeCriarParceiro(papel: AppRole): boolean {
  return PAPEIS_QUE_GERENCIAM.includes(papel);
}

/** Papéis que importam planilha. Mesmo conjunto de quem cria, pela mesma razão. */
export function podeImportarPlanilha(papel: AppRole): boolean {
  return PAPEIS_QUE_GERENCIAM.includes(papel);
}

/** Papéis que marcam compromisso na agenda. Espelho de `app.can_write()`, que a RPC confere. */
export function podeMarcarCompromisso(papel: AppRole): boolean {
  return PAPEIS_DO_CRM.includes(papel);
}

/**
 * Quem escolhe de quem é a agenda que está vendo. A RLS de `tasks` e `reunioes` deixa
 * mais papéis verem tudo, mas a visão da equipe é decisão de produto para quem
 * acompanha alguém pela hierarquia (`lib/auth/hierarquia.ts`): admin e gestor.
 */
export function veAgendaDaEquipe(papel: AppRole): boolean {
  return acompanhaEquipe(papel);
}

/**
 * Espelho de `app.reads_base_pii()`: papéis que leem o telefone inteiro na base.
 * O SDR vê o número mascarado e revela pelo botão, que fica registrado.
 * Serve só para explicar o resultado da busca; quem decide é o Postgres.
 */
export function leTelefoneCompleto(papel: AppRole): boolean {
  return PAPEIS_QUE_GERENCIAM.includes(papel);
}

/**
 * O número de um item do menu, venha de onde vier.
 *
 * `filas` é o que o servidor contou (`lib/filas-do-menu.ts`); `respostasNovas` é
 * o que o aviso de resposta mantém vivo no navegador. Item sem `fila` não mostra
 * número nunca, nem quando haveria o que contar.
 */
export function contagemDoItem(
  item: ItemNavegacao,
  filas: Partial<Record<ChaveDeFila, number | null>>,
  respostasNovas: number | null,
): number | null {
  if (!item.fila) return null;
  if (item.fila === 'respostas') return respostasNovas;
  return filas[item.fila] ?? null;
}

/** Itens visíveis para um papel. Papel que não existe mais não vê menu nenhum. */
export function navegacaoPara(papel: AppRole): ItemNavegacao[] {
  if (!PAPEIS_DO_CRM.includes(papel)) return [];
  return NAVEGACAO.filter((item) => !item.papeis || item.papeis.includes(papel));
}

/**
 * Os itens de um papel, já repartidos nos três grupos e na ordem da tela.
 *
 * Grupo que ficaria vazio para um papel não é devolvido: um cabeçalho "A base"
 * sozinho, sem item embaixo, é pior do que a ausência do grupo. O SDR chega
 * perto: perde Parceiros (sobra Funis em "A base") e fica só com Metas em
 * "Controle".
 */
export function navegacaoAgrupada(
  papel: AppRole,
): { grupo: GrupoDeNavegacao; itens: ItemNavegacao[] }[] {
  const visiveis = navegacaoPara(papel);
  return GRUPOS.map((grupo) => ({
    grupo,
    itens: visiveis.filter((item) => item.grupo === grupo.chave),
  })).filter((bloco) => bloco.itens.length > 0);
}

/**
 * A lateral em duas partes: os principais, sempre à vista, e o resto em "Mais".
 * Um papel que não vê algum principal (Relatórios, por exemplo) só fica com
 * menos itens à vista — o "Mais" não ganha nada em troca.
 */
export function navegacaoDaLateral(papel: AppRole): {
  principais: ItemNavegacao[];
  mais: ItemNavegacao[];
} {
  const visiveis = navegacaoPara(papel);
  const ordem = ORDEM_PRINCIPAL as readonly string[];
  return {
    principais: visiveis
      .filter((i) => i.principal)
      .sort((a, b) => ordem.indexOf(a.href) - ordem.indexOf(b.href)),
    mais: visiveis.filter((i) => !i.principal),
  };
}

/**
 * A barra inferior do celular: as fatias, na ordem do polegar, e o resto.
 *
 * A ordem vem de `posicaoNaBarra`, não da ordem do array — que é a ordem da
 * LATERAL, agrupada por natureza do trabalho. São dois critérios, e este é o
 * único lugar do código em que isso fica visível.
 */
export function barraDoCelular(papel: AppRole): {
  fatias: ItemNavegacao[];
  emMais: ItemNavegacao[];
} {
  const visiveis = navegacaoPara(papel);
  return {
    fatias: visiveis
      .filter((item) => item.posicaoNaBarra !== undefined)
      .sort((a, b) => (a.posicaoNaBarra ?? 9) - (b.posicaoNaBarra ?? 9)),
    emMais: visiveis.filter((item) => item.posicaoNaBarra === undefined),
  };
}

/**
 * Item ativo para um caminho (a própria rota ou uma sub-rota dela).
 *
 * Compara só o caminho, nunca a query string: `/registrar?org=<id>` e `/parceiros?novo=1`
 * são a mesma tela do item, e `usePathname()` já entrega o caminho sem a busca. O
 * `${href}/` no prefixo é o que separa `/parceiros/8f2` (sub-rota, acende) de
 * `/parceiros-antigos` (outra rota, não acende).
 *
 * `/importar` é o caso que sobrou sem item: a rota existe e ninguém acende por
 * ela. É de propósito — a lateral fica toda apagada por uma tela que se abre a
 * partir de Parceiros e volta para lá. Se um dia isso incomodar, o conserto é
 * fazer `/parceiros` acender em `/importar`, não devolver o item ao menu.
 */
export function estaAtivo(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
