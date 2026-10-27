'use client';

import { useId, useState } from 'react';
import { PenLine } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DialogoExcluir } from '@/components/exclusao/dialogo-excluir';

import { apagarMensagem, corrigirMensagem, ErroDaConversa, restaurarMensagem } from './acoes';
import { textoSemMarcas } from './conteudo';
import { dataHoraCompleta } from './formatos';
import { GradeDeEmojis } from './grade-de-emojis';
import { recadoDoErro } from './mensagens';
import { ROTULO_DO_ROBO, ROTULO_ORIGEM, type MensagemDoFio } from './tipos';

/**
 * Os diálogos do menu da mensagem (27/10/2026): apagar, corrigir, informações
 * e o "mais" das reações. Cada um diz o que a Cloud API deixa e o que não deixa
 * — apagar não some do celular do contato; corrigir é uma mensagem nova —,
 * porque a pessoa que clica precisa saber o que o contato vai ver.
 */

function frase(erro: unknown): string {
  return erro instanceof ErroDaConversa ? erro.message : 'Tente de novo em alguns segundos.';
}

/**
 * Apagar, contando a consequência (regra de 07/10/2026, `DialogoExcluir`). Três
 * casos, três frases: na fila (cancela de verdade), já saiu (só no CRM) e
 * recebida (some para o time, o contato continua com a dele).
 */
export function DialogoApagar({
  mensagem,
  aberto,
  aoFechar,
  aoMudar,
}: {
  mensagem: MensagemDoFio;
  aberto: boolean;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const naFila = !mensagem.entrada && mensagem.status === 'queued';

  async function apagar() {
    setOcupado(true);
    try {
      const { cancelada } = await apagarMensagem(mensagem.id);
      aoFechar();
      aoMudar();
      if (cancelada) {
        toast.success('Envio cancelado: o contato não recebeu.');
      } else {
        toast.success('Apagada só no CRM — o contato ainda vê.', {
          action: {
            label: 'Desfazer',
            onClick: () =>
              void restaurarMensagem(mensagem.id)
                .then(aoMudar)
                .catch((e: unknown) => toast.error('Não voltou.', { description: frase(e) })),
          },
        });
      }
    } catch (erro) {
      toast.error('Não apagou.', { description: frase(erro) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <DialogoExcluir
      aberto={aberto}
      aoFechar={aoFechar}
      ocupado={ocupado}
      titulo={naFila ? 'Cancelar o envio' : 'Apagar só no CRM'}
      rotuloConfirmar={naFila ? 'Cancelar o envio' : 'Apagar no CRM'}
      aoConfirmar={() => void apagar()}
      descricao={
        naFila ? (
          <p>Ainda está na fila: o envio é cancelado e o contato não recebe nada.</p>
        ) : mensagem.entrada ? (
          <p>
            Some da conversa para o time. O contato continua com ela no celular dele. Fica
            registrado quem apagou, e dá para desfazer.
          </p>
        ) : mensagem.status === 'failed' ? (
          <p>Esta mensagem não saiu: o contato não recebeu. Ela some só da conversa no CRM.</p>
        ) : (
          <p>
            O WhatsApp não deixa apagar para todos por aqui: a mensagem some do CRM, mas{' '}
            <strong>o contato continua vendo</strong>. Fica registrado quem apagou, e dá para
            desfazer.
          </p>
        )
      }
    />
  );
}

/**
 * Corrigir: a Cloud API não edita. Sai uma mensagem nova, "Correção: …",
 * respondendo à errada. Se a errada ainda está na fila, ela é cancelada e a
 * certa vai no lugar.
 */
export function DialogoCorrigir({
  mensagem,
  aberto,
  aoFechar,
  aoMudar,
}: {
  mensagem: MensagemDoFio;
  aberto: boolean;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        {aberto ? <Correcao mensagem={mensagem} aoFechar={aoFechar} aoMudar={aoMudar} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Correcao({
  mensagem,
  aoFechar,
  aoMudar,
}: {
  mensagem: MensagemDoFio;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const id = useId();
  const original = textoSemMarcas(mensagem.texto) ?? '';
  const [texto, setTexto] = useState(original);
  const [ocupado, setOcupado] = useState(false);
  const naFila = mensagem.status === 'queued';
  const limpo = texto.trim();

  async function mandar() {
    setOcupado(true);
    try {
      const { substituiu } = await corrigirMensagem(mensagem.id, limpo);
      aoFechar();
      aoMudar();
      toast.success(
        substituiu
          ? 'A errada saiu da fila; a certa vai no lugar.'
          : 'Correção na fila do WhatsApp.',
      );
    } catch (erro) {
      toast.error('A correção não entrou na fila.', { description: frase(erro) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Corrigir a mensagem</DialogTitle>
        <DialogDescription>
          {naFila
            ? 'Ainda está na fila: a errada é cancelada e sai esta no lugar.'
            : 'O WhatsApp não deixa editar por aqui. Sai uma mensagem nova, "Correção: …", respondendo a esta.'}
        </DialogDescription>
      </DialogHeader>
      <label htmlFor={id} className="sr-only">
        O texto certo
      </label>
      <textarea
        id={id}
        rows={4}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
      />
      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={aoFechar}
          disabled={ocupado}
          className="toque h-11 md:h-9"
        >
          Voltar
        </Button>
        <Button
          type="button"
          onClick={() => void mandar()}
          disabled={ocupado || limpo === '' || limpo === original.trim()}
          className="toque h-11 md:h-9"
        >
          <PenLine aria-hidden="true" />
          {ocupado ? 'Mandando...' : naFila ? 'Trocar a mensagem' : 'Mandar a correção'}
        </Button>
      </DialogFooter>
    </>
  );
}

/** O "mais" das reações: a grade inteira, num toque. */
export function DialogoMaisEmojis({
  aberto,
  aoFechar,
  aoEscolher,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoEscolher: (emoji: string) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reagir</DialogTitle>
          <DialogDescription className="sr-only">Escolha o emoji da reação.</DialogDescription>
        </DialogHeader>
        <GradeDeEmojis
          aoEscolher={(emoji) => {
            aoFechar();
            aoEscolher(emoji);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Informações: quem mandou, quem aprovou, e o caminho até o contato. */
export function DialogoInformacoes({
  mensagem,
  nomeDoParceiro,
  aberto,
  aoFechar,
}: {
  mensagem: MensagemDoFio;
  nomeDoParceiro: string | null;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const m = mensagem;
  const quem = m.entrada
    ? nomeDoParceiro?.trim() || 'O contato'
    : m.autorTipo === 'human'
      ? (m.autor ?? 'Alguém do time')
      : ROTULO_DO_ROBO[m.autorTipo];
  const linhas: [string, string | null][] = m.entrada
    ? [
        ['Mandou', quem],
        ['Chegou', m.criadaEm],
        ['O contato apagou', m.apagadaPeloContatoEm],
        ['O contato editou', m.editadaPeloContatoEm],
      ]
    : [
        ['Mandou', quem],
        ['Aprovou', m.aprovadoPor],
        ['Por', ROTULO_ORIGEM[m.origem]],
        ['Entrou na fila', m.criadaEm],
        ['Saiu', m.enviadaEm],
        ['Entregue', m.entregueEm],
        ['Lida', m.lidaEm],
        ['Ouvida', m.ouvidaEm],
        [m.cancelada ? 'Cancelada' : 'Não saiu', m.falhouEm],
      ];
  if (m.apagadaEm) linhas.push(['Apagada no CRM', m.apagadaEm]);
  const ehData = (rotulo: string) => !['Mandou', 'Aprovou', 'Por'].includes(rotulo);
  const motivo =
    !m.entrada && m.status === 'failed' ? recadoDoErro(m.erroCodigo, m.erroDetalhe) : null;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Informações da mensagem</DialogTitle>
          <DialogDescription className="sr-only">Quem mandou e quando.</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col text-sm">
          {linhas
            .filter((l): l is [string, string] => Boolean(l[1]))
            .map(([rotulo, valor]) => (
              <div
                key={rotulo}
                className="flex items-baseline justify-between gap-4 border-t border-hairline py-2 first:border-t-0"
              >
                <dt className="text-muted-foreground">{rotulo}</dt>
                <dd className="text-right">
                  {ehData(rotulo) ? (
                    <span className="numerico">{dataHoraCompleta(valor)}</span>
                  ) : (
                    valor
                  )}
                  {rotulo === 'Apagada no CRM' && m.apagadaPor ? ` · ${m.apagadaPor}` : null}
                </dd>
              </div>
            ))}
        </dl>
        {motivo ? <p className="text-xs leading-relaxed text-muted-foreground">{motivo}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
