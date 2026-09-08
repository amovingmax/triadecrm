'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Video } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { criarEventoNoGoogle, RECADO_DA_ROTA } from './google-dados';
import { type Compromisso } from './tipos';

/**
 * Põe o compromisso no Google Agenda — ou abre a sala, quando já está lá.
 *
 * ---------------------------------------------------------------------------
 * DOIS BOTÕES DIFERENTES NO MESMO LUGAR, E ISSO É DE PROPÓSITO
 * ---------------------------------------------------------------------------
 * Antes de existir evento, a ação é CRIAR e o rótulo diz o que vai acontecer
 * ("Pôr na agenda"). Depois que existe, a ação é ENTRAR, e o que a pessoa quer
 * às 14h de uma terça é o link do Meet — não um segundo evento. Um botão só,
 * que muda de comportamento sem mudar de nome, seria o jeito de alguém criar
 * duas reuniões para o mesmo fornecedor.
 *
 * Numa visita não há sala: o botão vira "Ver no Google", que abre o evento.
 *
 * ---------------------------------------------------------------------------
 * O QUE ELE FAZ QUANDO DÁ ERRADO
 * ---------------------------------------------------------------------------
 * Cada recusa tem dono. "Reconecte a sua agenda" é ação de quem clicou; "peça ao
 * Luiz para habilitar a API do Google" é de outra pessoa; "o evento foi criado
 * mas o CRM não registrou" pede conferir no Google ANTES de tentar de novo. Um
 * "não deu certo, tente de novo" genérico faria a pessoa repetir o clique nos
 * três casos, e no terceiro isso cria um evento duplicado.
 */
export function BotaoDoGoogle({ compromisso }: { compromisso: Compromisso }) {
  const clienteDeConsultas = useQueryClient();
  const [ocupado, setOcupado] = useState(false);

  const jaEstaLa = compromisso.google !== null;
  const meet = compromisso.google?.meetUrl ?? null;
  const link = compromisso.google?.linkHtml ?? null;

  if (jaEstaLa) {
    const destino = meet ?? link;
    if (!destino) return null;
    return (
      <Button asChild variant="outline" size="lg" className="toque h-11 md:h-9">
        <a href={destino} target="_blank" rel="noopener noreferrer">
          {meet ? <Video aria-hidden="true" /> : <CalendarPlus aria-hidden="true" />}
          {meet ? 'Entrar no Meet' : 'Ver no Google'}
        </a>
      </Button>
    );
  }

  async function porNaAgenda() {
    setOcupado(true);
    try {
      const r = await criarEventoNoGoogle(compromisso.taskId);

      if (!r.ok) {
        toast.error('Não deu para pôr na agenda.', {
          description: r.recado ?? RECADO_DA_ROTA[r.motivo] ?? 'Tente de novo.',
        });
        // O CRM ficou sem o espelho, mas o Google pode ter criado o evento.
        // Recarregar é o que faz a tela contar a verdade na próxima leitura.
        if (r.motivo === 'evento_criado_sem_registro' || r.motivo === 'ja_tem_evento') {
          void clienteDeConsultas.invalidateQueries({ queryKey: ['agenda'] });
        }
        return;
      }

      toast.success('Compromisso no seu Google Agenda.', {
        description: r.convidado
          ? `Convite enviado para ${r.convidado}. Lembretes de 24 h e 1 h ligados.`
          : 'Sem e-mail na ficha do parceiro, o convite não foi enviado — mande o link por WhatsApp ou na ligação.',
      });
      void clienteDeConsultas.invalidateQueries({ queryKey: ['agenda'] });
    } catch (erro) {
      toast.error('Não deu para falar com o servidor.', {
        description: erro instanceof Error ? erro.message : 'Tente de novo.',
      });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="lg"
      onClick={porNaAgenda}
      disabled={ocupado}
      className="toque h-11 md:h-9"
    >
      <CalendarPlus aria-hidden="true" />
      {ocupado ? 'Criando...' : 'Pôr na agenda'}
    </Button>
  );
}
