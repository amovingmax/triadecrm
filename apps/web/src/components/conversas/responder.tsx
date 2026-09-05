'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { FileCheck2, PenLine, Phone, SendHorizontal } from 'lucide-react';
import { LIMITES_PADRAO } from '@komune/prompts';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { ErroDaConversa, responder } from './acoes';
import { CHAVE_CONVERSAS, chaveDaLinha, carregarModelosAprovados } from './dados';
import { podeEscreverLivre } from './mensagens';
import type { EstadoDaJanela, FioDaConversa } from './tipos';

/**
 * A caixa de resposta — e, principalmente, o que ela NÃO deixa fazer.
 *
 * ===========================================================================
 * A JANELA MANDA NA CAIXA
 * ===========================================================================
 * Dentro da janela de 24 h: texto livre, e é de graça. Fora dela: só modelo
 * aprovado pela Meta, porque é regra da plataforma e tentar texto livre não dá
 * erro nosso, dá erro deles. Então a caixa MUDA de forma conforme o relógio
 * acima dela — não é um aviso ao lado de um campo que continua aceitando tudo.
 *
 * Deixar a pessoa digitar e só depois recusar seria pior do que não deixar: ela
 * escreveu, pensou, e o trabalho foi para o lixo na hora de enviar. O gatilho
 * `messages_guard` recusaria de qualquer jeito (`sem_janela_e_sem_template`); a
 * tela existe para ninguém chegar até lá.
 *
 * ===========================================================================
 * E HOJE, NADA SAI
 * ===========================================================================
 * O que sai daqui entra em `messages` como `queued` e fica lá até o worker de
 * envio rodar com o número da Meta. É verdade útil: a fila é o registro do que a
 * gente QUER mandar, e o gatilho reconfere supressão e teto na hora da entrega,
 * não na hora do clique — quem pedir para sair nesse meio-tempo não recebe. Mas
 * é preciso dizer, e o botão diz.
 */
export function CaixaDeResposta({
  fio,
  janela,
  organizacaoId,
  recolhida = false,
  className,
}: {
  fio: FioDaConversa | null;
  janela: EstadoDaJanela;
  organizacaoId: string;
  /**
   * Há um rascunho esperando aprovação logo acima.
   *
   * Aí a caixa nasce fechada, num botão de uma linha. Não é economia de pixel:
   * com rascunho na tela, a decisão é aprovar, editar ou descartar — e em 390 px
   * a caixa aberta empurrava justamente o "o que a IA entendeu" para fora da
   * vista, que é a parte que faz a aprovação não ser às cegas. Quem prefere
   * escrever à mão continua a um toque.
   */
  recolhida?: boolean;
  className?: string;
}) {
  const [aberta, setAberta] = useState(false);

  if (!fio) return <SemFio organizacaoId={organizacaoId} className={className} />;

  if (recolhida && !aberta) {
    return (
      <Button
        variant="outline"
        className={cn('toque h-11 w-full md:h-9 md:w-auto', className)}
        onClick={() => setAberta(true)}
      >
        <PenLine aria-hidden="true" />
        Prefiro escrever eu mesma
      </Button>
    );
  }

  return podeEscreverLivre(janela) ? (
    <TextoLivre fio={fio} organizacaoId={organizacaoId} className={className} />
  ) : (
    <SoModelo organizacaoId={organizacaoId} className={className} />
  );
}

/** Não existe fio: ninguém nunca trocou mensagem com este parceiro. */
function SemFio({ organizacaoId, className }: { organizacaoId: string; className?: string }) {
  return (
    <div className={cn('space-y-2 rounded-xl border border-dashed border-hairline p-3', className)}>
      <p className="text-sm font-medium">Não há conversa de WhatsApp com este parceiro</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Pelo R13, o primeiro contato é por LIGAÇÃO — o WhatsApp entra depois, para confirmar a
        reunião e mandar o link. Um fio novo só nasce quando o parceiro escreve para o número da
        KOMUNE, ou quando a Heloísa manda a primeira mensagem pelo celular e o Coexistence
        avisa o CRM. As duas coisas dependem do número aprovado na Meta.
      </p>
      <Button asChild variant="outline" className="toque h-11 md:h-9">
        <Link href={`/registrar?org=${organizacaoId}`}>
          <Phone aria-hidden="true" />
          Registrar contato por telefone
        </Link>
      </Button>
    </div>
  );
}

/** Janela aberta: texto livre, que é o que a Meta permite e não cobra. */
function TextoLivre({
  fio,
  organizacaoId,
  className,
}: {
  fio: FioDaConversa;
  organizacaoId: string;
  className?: string;
}) {
  const clientes = useQueryClient();
  const [texto, setTexto] = useState('');

  const enviar = useMutation({
    mutationFn: () => responder({ fioId: fio.id, texto: texto.trim() }),
    onSuccess: () => {
      setTexto('');
      toast.success('Mensagem na fila.', {
        description: 'Ela sai quando o worker de envio rodar com o número liberado pela Meta.',
      });
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      void clientes.invalidateQueries({ queryKey: chaveDaLinha(organizacaoId) });
    },
    onError: (erro) => {
      toast.error('A mensagem não entrou na fila.', {
        description:
          erro instanceof ErroDaConversa ? erro.message : 'Tente de novo em alguns segundos.',
      });
    },
  });

  const limpo = texto.trim();
  const longo = texto.length > LIMITES_PADRAO.maxCaracteres;

  return (
    <form
      className={cn('space-y-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (limpo && !enviar.isPending) enviar.mutate();
      }}
    >
      <label htmlFor="resposta" className="sr-only">
        Escrever para o parceiro
      </label>
      <textarea
        id="resposta"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={2}
        placeholder="Escreva para o parceiro"
        className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          className="toque h-11 md:h-9"
          disabled={limpo.length === 0 || enviar.isPending}
        >
          <SendHorizontal aria-hidden="true" />
          Pôr na fila
        </Button>
        <span
          className={cn('text-[11px] text-muted-foreground', longo && 'text-destructive-texto')}
        >
          <span className="numerico">{texto.length}</span> de{' '}
          <span className="numerico">{LIMITES_PADRAO.maxCaracteres}</span> caracteres
        </span>
        <span className="w-full text-[11px] leading-relaxed text-muted-foreground">
          Some texto na FILA, não no WhatsApp: falta o número aprovado na Meta. Para falar
          agora, use o celular da Heloísa — o eco do Coexistence traz a mensagem para cá.
        </span>
      </div>
    </form>
  );
}

/**
 * Janela fechada: só modelo aprovado.
 *
 * A lista de modelos vem do banco e é filtrada por `meta_status = 'approved'` —
 * não por "está no CRM". São coisas diferentes: temos 39 modelos escritos e
 * nenhum aprovado, e mostrar os 39 num seletor faria a pessoa escolher um que a
 * Meta recusaria na entrega.
 */
function SoModelo({ organizacaoId, className }: { organizacaoId: string; className?: string }) {
  const modelos = useQuery({
    queryKey: ['conversas', 'modelos-aprovados'],
    queryFn: carregarModelosAprovados,
    staleTime: 5 * 60_000,
  });

  const aprovados = modelos.data ?? [];

  return (
    <div className={cn('space-y-2 rounded-xl border border-dashed border-hairline p-3', className)}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <FileCheck2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Fora da janela, só modelo aprovado
      </p>

      {modelos.isPending ? (
        <p className="text-xs text-muted-foreground">Vendo quais modelos a Meta já aprovou...</p>
      ) : aprovados.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          A Meta não aprovou nenhum dos nossos modelos ainda, então não há o que mandar por aqui
          agora. Isso não é defeito do CRM: a aprovação de
          modelo é do Meta Business e depende da verificação do CNPJ (RF-CON-02). O que funciona
          hoje é ligar.
        </p>
      ) : (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {aprovados.map((m) => (
            <li key={m.id}>{m.nome}</li>
          ))}
        </ul>
      )}

      <Button asChild variant="outline" className="toque h-11 md:h-9">
        <Link href={`/registrar?org=${organizacaoId}`}>
          <Phone aria-hidden="true" />
          Registrar contato por telefone
        </Link>
      </Button>
    </div>
  );
}
