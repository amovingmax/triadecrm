import {
  CalendarClock,
  CircleDashed,
  ClipboardCheck,
  Flag,
  ListTodo,
  MapPin,
  MessageCircle,
  PauseCircle,
  Phone,
  type LucideIcon,
} from 'lucide-react';

import type { TipoDeItem } from './tipos';

/**
 * Um ícone por motivo de estar na fila.
 *
 * A fila era uma pilha de linhas de texto cinza: para saber se aquela linha era
 * uma reunião, uma tarefa vencida ou um negócio empacado, era preciso LER as
 * duas linhas de cada item. O ícone responde isso antes da leitura, que é o que
 * se pede de uma fila que a pessoa varre com o polegar na rua.
 *
 * Os desenhos vêm do motivo (`tipo`), não do canal: "ligar" e "mandar mensagem"
 * são o TÍTULO da tarefa, escrito por quem criou; o que o CRM sabe de verdade é
 * por que aquilo está aqui hoje.
 */
export type NomeDoIcone = TipoDeItem | 'ligar' | 'escrever' | 'visitar' | 'agendar';

export const ICONE_DO_ITEM: Record<NomeDoIcone, LucideIcon> = {
  ligar: Phone,
  escrever: MessageCircle,
  visitar: MapPin,
  agendar: CalendarClock,
  reuniao_proxima: CalendarClock,
  desfecho_pendente: ClipboardCheck,
  tarefa_atrasada: ListTodo,
  proxima_acao_atrasada: Flag,
  tarefa_hoje: ListTodo,
  proxima_acao_hoje: Flag,
  sem_proxima_acao: CircleDashed,
  negocio_parado: PauseCircle,
  tarefa_futura: ListTodo,
  tarefa_sem_data: ListTodo,
  outro: CircleDashed,
};

/**
 * O VERBO VENCE O MOTIVO.
 *
 * Numa carteira de verdade quase tudo é "tarefa", e um ícone de lista em todas as
 * linhas não diz nada. O que a pessoa precisa saber varrendo a fila é o gesto:
 * pegar o telefone, escrever, sair de casa. As tarefas do CRM nascem no
 * imperativo ("Ligar D+1", "Mandar o resumo combinado", "Confirmar a reunião de
 * amanhã"), então o primeiro verbo do título é um sinal honesto — e quando ele
 * não é nenhum dos conhecidos, vale o ícone do motivo, que nunca falta.
 *
 * A regra olha o COMEÇO do título de propósito: "Mandar o resumo combinado na
 * ligação" é uma mensagem, não uma ligação, e uma busca solta por "ligação" no
 * meio da frase erraria exatamente esse caso.
 */
const PELO_VERBO: readonly (readonly [RegExp, NomeDoIcone])[] = [
  [/^\s*(ligar|telefonar|liga[çc][ãa]o)/i, 'ligar'],
  [/^\s*(mandar|enviar|responder|retomar|escrever|avisar|cobrar)/i, 'escrever'],
  [/^\s*(visitar|passar|ir)/i, 'visitar'],
  [/^\s*(confirmar|marcar|remarcar|agendar|reuni)/i, 'agendar'],
];

/**
 * Devolve a CHAVE do ícone, não o componente: quem desenha faz a busca no mapa,
 * e assim a regra continua testável sem React (e o lint não vê um componente
 * nascendo dentro do render).
 */
export function iconeDoItem(item: { tipo: TipoDeItem; titulo: string }): NomeDoIcone {
  for (const [padrao, nome] of PELO_VERBO) {
    if (padrao.test(item.titulo)) return nome;
  }
  return item.tipo;
}
