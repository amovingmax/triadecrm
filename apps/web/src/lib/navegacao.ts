/**
 * Navegação principal do CRM: Meu dia, Registrar, Parceiros, Importar, Funis, Ligar, Conversas,
 * Radar, Cadências, Agenda, Metas, Relatórios e Admin. O dia indica quando cada tela chega, pelo
 * calendário do PRD §11.2.
 *
 * Duas coisas que já custaram caro e por isso estão escritas aqui:
 *
 * 1. `descricao` não é enfeite nem roadmap: ela é o índice de busca da paleta (⌘K) e, desde a
 *    passada de navegação, também o texto que aparece sob o rótulo na paleta e no menu "Mais" do
 *    celular. Uma descrição desatualizada não fica só feia: ela manda a pessoa para a tela errada
 *    em silêncio. Cinco delas descreviam o PRD §7 em vez da tela, e o efeito era esse: "assistente"
 *    abria Metas (que não tem Assistente), "SLA" abria Admin (que não edita etapa nem SLA) e
 *    "opt-out" abria Conversas quando o botão está em Ligar. Ao mexer numa tela, releia a linha
 *    dela aqui. O que a frase promete, a tela entrega HOJE; o que ainda não existe fica escrito
 *    na própria tela, não escondido nesta lista.
 *
 * 2. `papeis` não é cosmético. Sem ele o item aparece para quem a rota vai recusar, e a recusa
 *    do `requireRole` é um `redirect('/sem-permissao')`: a pessoa clica em "Relatórios", perde a
 *    tela em que estava e cai numa rota que não tem item aceso em lugar nenhum. Isso não é uma
 *    negativa, é uma ejeção. Quem tem restrição de papel no servidor tem `papeis` aqui, espelhando
 *    a mesma função do Postgres que decide de verdade.
 */
import {
  CalendarDays,
  ChartColumn,
  Handshake,
  Upload,
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

export type ItemNavegacao = {
  href: string;
  rotulo: string;
  icone: LucideIcon;
  /** Dia do calendário do PRD §11.2 em que a tela chega. */
  dia: string;
  /**
   * O que a tela entrega HOJE, em uma frase. É texto visível (paleta e menu "Mais") e, ao
   * mesmo tempo, o índice pelo qual a paleta encontra o módulo: as palavras que alguém
   * digitaria para chegar aqui precisam estar nesta frase.
   */
  descricao: string;
  /** Aparece na barra inferior do celular (os demais ficam no menu "Mais"). */
  principal?: boolean;
  /** Restringe o item a alguns papéis; sem valor, todos veem. */
  papeis?: readonly AppRole[];
};

/**
 * Espelho de `app.can_write()`: admin, gestor, sdr e embaixador.
 *
 * É o mesmo conjunto em quatro lugares porque no banco é uma função só. Quem não passa
 * por ela não grava atividade, não cria organização e não revisa candidato do Radar: a
 * `public.registrar_contato` devolve `motivo: 'sem_permissao'`, e a política de select de
 * `supplier_candidates` nem mostra a fila. Oferecer esses módulos a `leitura` ou
 * `financeiro` é prometer uma tela cujo único desfecho é a recusa lá no fim.
 *
 * Quem decide continua sendo o Postgres; isto só evita oferecer o que vai falhar.
 */
const PAPEIS_QUE_ESCREVEM: readonly AppRole[] = ['admin', 'gestor', 'sdr', 'embaixador'];

/**
 * Espelho de `app.sees_all()`: admin, gestor, sdr, leitura e financeiro.
 *
 * O embaixador fica de fora por desenho (RF-ADM-01: ele vê a própria carteira, não o funil
 * inteiro), e é exatamente a lista que `/relatorios` passa ao `requireRole`.
 */
const PAPEIS_QUE_VEEM_TUDO: readonly AppRole[] = [
  'admin',
  'gestor',
  'sdr',
  'leitura',
  'financeiro',
];

export const NAVEGACAO: readonly ItemNavegacao[] = [
  {
    href: '/meu-dia',
    rotulo: 'Meu dia',
    icone: Sun,
    dia: 'D8',
    descricao:
      'A fila do dia em cinco blocos: Agora, Ainda hoje, Sem próxima ação, Parados na etapa e Depois de hoje, mais o resumo do dia e o quanto falta da meta.',
    principal: true,
  },
  {
    // O quinto item de campo da barra inferior, e o único em que se PRODUZ dado. Ficava
    // fora da navegação: seis módulos linkavam para cá, mas quem quisesse registrar um
    // contato por vontade própria só achava a porta no estado vazio do Meu dia, que
    // aparece justamente quando não há o que registrar. Sem item na lista, `estaAtivo`
    // também não tinha em que casar, e a tela abria com a navegação inteira apagada.
    href: '/registrar',
    rotulo: 'Registrar',
    icone: SquarePen,
    dia: 'D4',
    descricao:
      'Três toques (parceiro, canal e desfecho) para o contato virar dado: temperatura, próxima ação e meta. Funciona sem rede, com 5 s para desfazer.',
    principal: true,
    papeis: PAPEIS_QUE_ESCREVEM,
  },
  {
    href: '/parceiros',
    rotulo: 'Parceiros',
    icone: Handshake,
    dia: 'D1/D2',
    descricao:
      'Base de organizações e pessoas com busca global, filtros, criação rápida com dedup por telefone e importação de planilha.',
    principal: true,
  },
  {
    href: '/importar',
    rotulo: 'Importar',
    icone: Upload,
    dia: 'D2',
    descricao:
      'Importar planilha (XLSX ou CSV) para dentro da base pela esteira de ingestão: mapa de colunas, prévia com duplicatas nomeadas e lote com desfazer de 48 h.',
    papeis: PAPEIS_QUE_ESCREVEM,
  },
  {
    href: '/funis',
    rotulo: 'Funis',
    icone: SquareKanban,
    dia: 'D3',
    descricao:
      'Kanban dos funis de captação e de produtores, cartão com semáforo, próxima ação obrigatória e motivos de perda.',
    principal: true,
  },
  {
    href: '/ligar',
    rotulo: 'Ligar',
    icone: PhoneCall,
    dia: 'D5',
    descricao:
      'Prospecção ativa por ligação: lote com fila reservada na montagem, roteiro em árvore, tabulação em dois eixos e opt-out quando o parceiro pede para parar.',
  },
  {
    href: '/conversas',
    rotulo: 'Conversas',
    icone: MessageCircle,
    dia: 'D5',
    descricao:
      'O histórico de cada parceiro, a fila de aprovação dos rascunhos da IA e o relógio da janela de 24 h do WhatsApp.',
    principal: true,
  },
  {
    href: '/radar',
    rotulo: 'Radar',
    icone: Radar,
    dia: 'D4',
    descricao:
      'Fila de revisão dos candidatos de fontes públicas, cadastro manual, catálogo de fontes com robots.txt e termos avaliados, e o estado do coletor.',
    papeis: PAPEIS_QUE_ESCREVEM,
  },
  {
    href: '/cadencias',
    rotulo: 'Cadências',
    icone: Route,
    dia: 'D7',
    descricao:
      'Réguas de toque em ordem (canal, atraso, condição), quantas organizações param em cada passo e o resumo do dia das 07:30 e 18:00.',
  },
  {
    href: '/agenda',
    rotulo: 'Agenda',
    icone: CalendarDays,
    dia: 'D7',
    descricao:
      'Reuniões em vídeo pela manhã, rota de visitas à tarde com link do Google Maps e lembretes.',
  },
  {
    href: '/metas',
    rotulo: 'Metas',
    icone: Target,
    dia: 'D8',
    descricao:
      'Meta e realizado por pessoa e por período, o quanto falta e a que ritmo, com as métricas que ainda não são medíveis marcadas como tal.',
  },
  {
    href: '/relatorios',
    rotulo: 'Relatórios',
    icone: ChartColumn,
    dia: 'D9',
    descricao: 'Relatório de segunda-feira (texto + XLSX), funil e atividades por pessoa.',
    papeis: PAPEIS_QUE_VEEM_TUDO,
  },
  {
    href: '/admin',
    rotulo: 'Admin',
    icone: Settings,
    dia: 'D1 (parcial)',
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

/** Papéis que criam parceiro. A autorização de verdade é o RLS; isto só evita oferecer o que vai falhar. */
export function podeCriarParceiro(papel: AppRole): boolean {
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
 * Item ativo para um caminho (a própria rota ou uma sub-rota dela).
 *
 * Compara só o caminho, nunca a query string: `/registrar?org=<id>` e `/parceiros?novo=1`
 * são a mesma tela do item, e `usePathname()` já entrega o caminho sem a busca. O
 * `${href}/` no prefixo é o que separa `/parceiros/8f2` (sub-rota, acende) de
 * `/parceiros-antigos` (outra rota, não acende).
 */
export function estaAtivo(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
