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
 * A resposta é agrupar, e não apagar. Doze itens em três grupos nomeados leem-se
 * como três coisas, não como doze; e nenhuma tela precisa morrer para o menu
 * parar de competir consigo mesmo. Cadências, por exemplo, some da vista de quem
 * trabalha o dia inteiro sem deixar de existir para quem configura a régua.
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
 * É por isso que Radar e Conversas contam, e Cadências, Metas, Relatórios e
 * Ajustes não contam nunca — nem quando teriam o que contar. A contagem chega
 * pronta do servidor (`lib/filas-do-menu.ts`), no mesmo `layout` que já busca a
 * sessão: sem consulta no cliente, sem estado de carregamento piscando na
 * lateral a cada troca de tela.
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
  type LucideIcon,
  MessageCircle,
  PhoneCall,
  Radar,
  Route,
  Settings,
  SquareKanban,
  SquarePen,
  Sun,
  Target,
} from 'lucide-react';

import { type AppRole } from '@/lib/auth/role';

/** A que grupo da lateral o item pertence. A ordem aqui é a ordem na tela. */
export type ChaveDeGrupo = 'todo_dia' | 'a_base' | 'controle';

/**
 * Qual fila o item conta, quando conta.
 *
 * `null` (a maioria) significa "este item NUNCA mostra número". Não é ausência de
 * dado: é a metade de baixo da regra. Um número em Ajustes ou em Cadências diria
 * "tem trabalho parado aí" sobre uma tela onde nada espera por ninguém.
 */
export type ChaveDeFila = 'candidatos' | 'rascunhos';

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
};

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
 * Espelho de `app.can_write()`: admin, gestor, sdr e embaixador.
 *
 * É o mesmo conjunto em vários lugares porque no banco é uma função só. Quem não
 * passa por ela não grava atividade, não cria organização e não revisa candidato
 * do Radar: a `public.registrar_contato` devolve `motivo: 'sem_permissao'`, e a
 * política de select de `supplier_candidates` nem mostra a fila. Oferecer esses
 * módulos a `leitura` ou `financeiro` é prometer uma tela cujo único desfecho é a
 * recusa lá no fim.
 *
 * Quem decide continua sendo o Postgres; isto só evita oferecer o que vai falhar.
 */
const PAPEIS_QUE_ESCREVEM: readonly AppRole[] = ['admin', 'gestor', 'sdr', 'embaixador'];

/**
 * Espelho de `app.sees_all()`: admin, gestor, sdr, leitura e financeiro.
 *
 * O embaixador fica de fora por desenho (RF-ADM-01: ele vê a própria carteira,
 * não o funil inteiro), e é exatamente a lista que `/relatorios` passa ao
 * `requireRole`.
 */
const PAPEIS_QUE_VEEM_TUDO: readonly AppRole[] = [
  'admin',
  'gestor',
  'sdr',
  'leitura',
  'financeiro',
];

export const NAVEGACAO: readonly ItemNavegacao[] = [
  // -------------------------------------------------------------------------
  // Todo dia
  // -------------------------------------------------------------------------
  {
    href: '/meu-dia',
    rotulo: 'Meu dia',
    icone: Sun,
    grupo: 'todo_dia',
    descricao:
      'A fila do dia em cinco blocos: Agora, Ainda hoje, Sem próxima ação, Parados na etapa e Depois de hoje, mais o resumo do dia e o quanto falta da meta.',
    posicaoNaBarra: 1,
  },
  {
    // O único item em que se PRODUZ dado. Ficava fora da navegação até 09/09:
    // seis módulos linkavam para cá, mas quem quisesse registrar um contato por
    // vontade própria só achava a porta no estado vazio do Meu dia, que aparece
    // justamente quando não há o que registrar.
    href: '/registrar',
    rotulo: 'Registrar',
    icone: SquarePen,
    grupo: 'todo_dia',
    descricao:
      'Três toques (parceiro, canal e desfecho) para o contato virar dado: temperatura, próxima ação e meta. Funciona sem rede, com 5 s para desfazer.',
    posicaoNaBarra: 2,
    papeis: PAPEIS_QUE_ESCREVEM,
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
    papeis: PAPEIS_QUE_ESCREVEM,
  },
  {
    href: '/conversas',
    rotulo: 'Conversas',
    icone: MessageCircle,
    grupo: 'todo_dia',
    descricao:
      'O histórico de cada parceiro, a fila de aprovação dos rascunhos da IA e o relógio da janela de 24 h do WhatsApp.',
    posicaoNaBarra: 5,
    // Rascunho pendente é trabalho parado de verdade: ele expira, e a mensagem
    // que expira é uma conversa que a pessoa não teve.
    fila: 'rascunhos',
  },
  {
    href: '/agenda',
    rotulo: 'Agenda',
    icone: CalendarDays,
    grupo: 'todo_dia',
    descricao:
      'Reuniões em vídeo pela manhã, rota de visitas à tarde com link do Google Maps e lembretes.',
  },

  // -------------------------------------------------------------------------
  // A base
  // -------------------------------------------------------------------------
  {
    href: '/parceiros',
    rotulo: 'Parceiros',
    icone: Handshake,
    grupo: 'a_base',
    // "Importar planilha" entrou na frase porque a rota `/importar` saiu do menu
    // e virou botão no cabeçalho desta tela. A palavra continua achável na
    // paleta, e agora leva a quem tem o botão.
    descricao:
      'Base de organizações e pessoas com busca global, filtros, criação rápida com dedup por telefone e o botão de importar planilha.',
    posicaoNaBarra: 3,
  },
  {
    href: '/funis',
    rotulo: 'Funis',
    icone: SquareKanban,
    grupo: 'a_base',
    descricao:
      'Kanban dos funis de captação e de produtores, cartão com semáforo, próxima ação obrigatória e motivos de perda.',
    posicaoNaBarra: 4,
  },
  {
    href: '/radar',
    rotulo: 'Radar',
    icone: Radar,
    grupo: 'a_base',
    descricao:
      'Fila de revisão dos candidatos de fontes públicas, cadastro manual, catálogo de fontes com robots.txt e termos avaliados, e o estado do coletor.',
    papeis: PAPEIS_QUE_ESCREVEM,
    // A fila de revisão é o exemplo mais puro da regra: candidato coletado e não
    // revisado é trabalho que já foi feito por um robô e está parado esperando
    // uma pessoa. Sem o número, ninguém abre o Radar por vontade própria.
    fila: 'candidatos',
  },

  // -------------------------------------------------------------------------
  // Controle
  // -------------------------------------------------------------------------
  {
    href: '/cadencias',
    rotulo: 'Cadências',
    icone: Route,
    grupo: 'controle',
    descricao:
      'Réguas de toque em ordem (canal, atraso, condição), quantas organizações param em cada passo e o resumo do dia das 07:30 e 18:00.',
  },
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
    rotulo: 'Relatórios',
    icone: ChartColumn,
    grupo: 'controle',
    descricao: 'Relatório de segunda-feira (texto + XLSX), funil e atividades por pessoa.',
    papeis: PAPEIS_QUE_VEEM_TUDO,
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
    papeis: ['admin', 'gestor'],
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

/** Papéis que criam parceiro. A autorização de verdade é o RLS; isto só evita oferecer o que vai falhar. */
export function podeCriarParceiro(papel: AppRole): boolean {
  return PAPEIS_QUE_ESCREVEM.includes(papel);
}

/** Papéis que importam planilha. Mesmo conjunto de quem cria, pela mesma razão. */
export function podeImportarPlanilha(papel: AppRole): boolean {
  return PAPEIS_QUE_ESCREVEM.includes(papel);
}

/**
 * Espelho de `app.reads_base_pii()`: papéis que leem o telefone inteiro na base.
 *
 * Não confunda com `podeCriarParceiro`: os conjuntos são diferentes de propósito
 * (sdr e embaixador criam e não leem PII; leitura e financeiro leem PII e não criam).
 * Serve só para explicar o resultado da busca; quem decide é o Postgres.
 */
const PAPEIS_QUE_LEEM_TELEFONE: readonly AppRole[] = ['admin', 'gestor', 'leitura', 'financeiro'];

export function leTelefoneCompleto(papel: AppRole): boolean {
  return PAPEIS_QUE_LEEM_TELEFONE.includes(papel);
}

/** Itens visíveis para um papel. */
export function navegacaoPara(papel: AppRole): ItemNavegacao[] {
  return NAVEGACAO.filter((item) => !item.papeis || item.papeis.includes(papel));
}

/**
 * Os itens de um papel, já repartidos nos três grupos e na ordem da tela.
 *
 * Grupo que ficaria vazio para um papel não é devolvido: um cabeçalho "A base"
 * sozinho, sem item embaixo, é pior do que a ausência do grupo. Hoje isso não
 * acontece com nenhum dos seis papéis, mas o embaixador chega perto (perde
 * Relatórios e Ajustes, e sobra com Cadências e Metas em "Controle").
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
