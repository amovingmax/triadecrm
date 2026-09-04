/**
 * Navegação principal do CRM (kit/CLAUDE.md): Meu dia, Parceiros, Funis, Ligar, Conversas, Radar,
 * Agenda, Metas, Relatórios, Admin. O dia indica quando cada tela chega, pelo calendário do
 * PRD §11.2.
 */
import {
  CalendarDays,
  ChartColumn,
  Handshake,
  type LucideIcon,
  MessageCircle,
  PhoneCall,
  Radar,
  Settings,
  SquareKanban,
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
  /** Um resumo do que a tela vai fazer (PRD §7). */
  descricao: string;
  /** Aparece na barra inferior do celular (os demais ficam no menu "Mais"). */
  principal?: boolean;
  /** Restringe o item a alguns papéis; sem valor, todos veem. */
  papeis?: readonly AppRole[];
};

export const NAVEGACAO: readonly ItemNavegacao[] = [
  {
    href: '/meu-dia',
    rotulo: 'Meu dia',
    icone: Sun,
    dia: 'D8',
    descricao:
      'Metas do dia, agenda (Meets e rota), fila de ações ordenada e conversas sem resposta, com abas Inbox / Feito / Futuro (RF-MET-03).',
    principal: true,
  },
  {
    href: '/parceiros',
    rotulo: 'Parceiros',
    icone: Handshake,
    dia: 'D1/D2',
    descricao:
      'Base de organizações e pessoas com busca global, filtros, criação rápida com dedup por telefone e importação de planilha (RF-BAS).',
    principal: true,
  },
  {
    href: '/funis',
    rotulo: 'Funis',
    icone: SquareKanban,
    dia: 'D3',
    descricao:
      'Kanban dos funis de captação e de produtores, cartão com semáforo, próxima ação obrigatória e motivos de perda (RF-FUN).',
    principal: true,
  },
  {
    href: '/ligar',
    rotulo: 'Ligar',
    icone: PhoneCall,
    dia: 'D5',
    descricao:
      'Lote de prospecção ativa por ligação: fila reservada na montagem, roteiro em árvore e tabulação em dois eixos (R13).',
  },
  {
    href: '/conversas',
    rotulo: 'Conversas',
    icone: MessageCircle,
    dia: 'D5',
    descricao:
      'Inbox de WhatsApp com responsável, fila diária de primeiros contatos em modo assistido e opt-out por regra (RF-CON).',
    principal: true,
  },
  {
    href: '/radar',
    rotulo: 'Radar',
    icone: Radar,
    dia: 'D4',
    descricao:
      'Candidatos coletados em fontes públicas, fila de revisão e pontuação por lacuna de oferta (RF-RAD).',
  },
  {
    href: '/agenda',
    rotulo: 'Agenda',
    icone: CalendarDays,
    dia: 'D7',
    descricao:
      'Reuniões em vídeo pela manhã, rota de visitas à tarde com link do Google Maps e lembretes (RF-AGE, RF-ROT).',
  },
  {
    href: '/metas',
    rotulo: 'Metas',
    icone: Target,
    dia: 'D8',
    descricao:
      'Metas diárias por pessoa (3 portas abertas), acumulado × meta e resumo das 18:00 pela Assistente (RF-MET, RF-AST).',
  },
  {
    href: '/relatorios',
    rotulo: 'Relatórios',
    icone: ChartColumn,
    dia: 'D9',
    descricao: 'Relatório de segunda-feira (texto + XLSX), funil e atividades por pessoa (RF-REL).',
  },
  {
    href: '/admin',
    rotulo: 'Admin',
    icone: Settings,
    dia: 'D1 (parcial)',
    descricao:
      'Papéis e usuários, etapas e SLAs por funil, motivos de perda, modelos de mensagem, feriados e ferramentas LGPD (RF-ADM).',
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
const PAPEIS_QUE_CRIAM: readonly AppRole[] = ['admin', 'gestor', 'sdr', 'embaixador'];

export function podeCriarParceiro(papel: AppRole): boolean {
  return PAPEIS_QUE_CRIAM.includes(papel);
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

/** Item ativo para um caminho (a própria rota ou uma sub-rota dela). */
export function estaAtivo(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
