'use client';

import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, BotOff, Check, Pencil, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';

import { EMPRESA } from '@/lib/empresa';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  CHAVE_DA_IA,
  ErroDaIa,
  avaliarResposta,
  carregarEstado,
  carregarRespostasDaConversa,
  chaveDasRespostas,
  chaveDoEstado,
  ligarIa,
  pararIa,
  type EstadoDaIaNaConversa,
  type RespostaDaIa,
} from './dados';

/**
 * A IA que atende o cliente, dentro da conversa (Imova, 06/11/2026).
 *
 * Pedido do usuário: "caso a IA esteja falando errado o nosso colaborador consegue
 * parar ela e redirecionar para outro colaborador". Então: um selo que diz que a IA
 * está atendendo (ou parada), o botão "Parar a IA" junto do "Transferir", e o
 * "Boa / Corrigir" embaixo de cada resposta dela. Parar não manda nada ao cliente:
 * só a IA deixa de responder ali. Quem escreve na conversa também a para sozinho
 * (gente assumiu).
 *
 * Só existe com o módulo ligado; na KOMUNE nada disto aparece.
 */
export const IA_QUE_ATENDE: boolean = EMPRESA.modulos.iaQueAtende;

function mensagemDoErro(e: unknown): string {
  if (e instanceof ErroDaIa) return e.message;
  return 'O servidor não respondeu. Tente de novo.';
}

function useEstadoDaIa(fioId: string) {
  return useQuery({
    queryKey: chaveDoEstado(fioId),
    queryFn: () => carregarEstado(fioId),
    enabled: IA_QUE_ATENDE,
    staleTime: 15_000,
  });
}

/** O selo do cabeçalho: "IA atendendo", "IA em treino", "IA em teste" ou "IA parada". */
export function SeloDaIa({ fioId, naFolha = false }: { fioId: string; naFolha?: boolean }) {
  const { data } = useEstadoDaIa(fioId);
  if (!IA_QUE_ATENDE || !data || !data.ligada) return null;
  if (!data.atende && data.estado !== 'parada') return null;
  const parada = !data.atende;
  const rotulo = parada ? 'IA parada' : rotuloDeQuemAtende(data);
  const Icone = parada ? BotOff : Bot;
  return (
    <Badge
      variant="pilula"
      title={
        parada
          ? `A IA não responde nesta conversa${data.motivo ? ` (${data.motivo})` : ''}.`
          : data.teste
            ? 'Conversa de teste: a IA conversa como com um cliente e não aprende nada aqui. Para parar, use "Parar a IA".'
            : 'A IA responde esta conversa sozinha. Para parar, use "Parar a IA".'
      }
      className={naFolha ? 'h-9 gap-1.5 px-3 text-sm font-normal' : 'h-5 gap-1 px-2 text-[11px] font-normal'}
    >
      <Icone className="size-3" aria-hidden="true" />
      {rotulo}
    </Badge>
  );
}

/**
 * "Parar a IA" (com o motivo, opcional) ou "Ligar a IA aqui". Depois de parar, quem
 * vai continuar é escolhido no "Transferir", que fica ao lado.
 */
export function ControleDaIa({
  fioId,
  className,
  variante = 'bloco',
}: {
  fioId: string;
  className?: string;
  /**
   * `bloco` na folha e na coluna de dados ("Parar a IA" / "Ligar a IA aqui");
   * `pilula` no cabeçalho, ao lado de "Concluir": diz o estado ("IA atendendo" /
   * "IA parada") e o toque faz o contrário. Em cabeçalho estreito fica só o ícone.
   */
  variante?: 'bloco' | 'pilula';
}) {
  const clientes = useQueryClient();
  const { data } = useEstadoDaIa(fioId);
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const idDoMotivo = useId();

  const atualizar = () => void clientes.invalidateQueries({ queryKey: CHAVE_DA_IA });

  const parar = useMutation({
    mutationFn: () => pararIa(fioId, motivo.trim() === '' ? null : motivo.trim()),
    onSuccess: () => {
      atualizar();
      setAberto(false);
      setMotivo('');
      toast.success('A IA parou nesta conversa.', {
        description: 'Ela não responde mais aqui. Para passar a outra pessoa, use "Transferir".',
      });
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  const ligar = useMutation({
    mutationFn: () => ligarIa(fioId),
    onSuccess: (atende) => {
      atualizar();
      if (atende) toast.success('A IA voltou a atender esta conversa.');
      else
        toast.message('A IA foi ligada aqui, mas ainda não responde.', {
          description: 'Ela está desligada na tela "IA que atende", ou esta conversa não está no modo dela.',
        });
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  if (!IA_QUE_ATENDE || !data || !data.ligada) return null;
  if (!data.atende && !podeLigarAqui(data)) return null;
  const pilula = variante === 'pilula';
  const classeDaPilula =
    'toque h-10 shrink-0 rounded-full border-wpp-linha-forte bg-transparent px-3.5 text-[13.5px] font-medium';
  const rotulo = (texto: string) =>
    pilula ? (
      <>
        <span className="hidden @3xl:inline">{texto}</span>
        <span className="sr-only @3xl:hidden">{texto}</span>
      </>
    ) : (
      texto
    );

  if (!data.atende) {
    return (
      <Button
        type="button"
        variant="outline"
        size={pilula ? 'sm' : 'default'}
        className={cn(pilula && classeDaPilula, className)}
        disabled={ligar.isPending}
        onClick={() => ligar.mutate()}
        title="A IA está parada nesta conversa. Tocar faz ela voltar a responder sozinha."
      >
        <BotOff aria-hidden="true" />
        {rotulo(pilula ? 'IA parada' : 'Ligar a IA aqui')}
      </Button>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={pilula ? 'sm' : 'default'}
        className={cn(pilula && classeDaPilula, className)}
        onClick={() => setAberto(true)}
        title="A IA está respondendo esta conversa sozinha. Tocar para parar; nada é enviado ao cliente."
      >
        {pilula ? <Bot aria-hidden="true" /> : <BotOff aria-hidden="true" />}
        {rotulo(pilula ? rotuloDeQuemAtende(data) : 'Parar a IA')}
      </Button>
      <Dialog open={aberto} onOpenChange={(v) => !parar.isPending && setAberto(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Parar a IA nesta conversa</DialogTitle>
            <DialogDescription>
              Ela deixa de responder aqui na hora. Nada é enviado ao cliente. Depois, use
              &ldquo;Transferir&rdquo; para escolher quem continua.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor={idDoMotivo} className="text-sm font-medium">
            Por que parou? <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <textarea
            id={idDoMotivo}
            rows={3}
            maxLength={300}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: estava falando errado do valor do aluguel"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
          />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setAberto(false)} disabled={parar.isPending}>
              Voltar
            </Button>
            <Button type="button" onClick={() => parar.mutate()} disabled={parar.isPending}>
              <BotOff aria-hidden="true" />
              Parar a IA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Dá para ligar a IA de volta aqui: no treino, só na conversa do treino e nas de teste. */
function podeLigarAqui(e: EstadoDaIaNaConversa): boolean {
  return e.modo === 'clientes' || e.treino || e.teste;
}

/** Na conversa do treino ela aprende; na de teste, só conversa (10/11/2026). */
function rotuloDeQuemAtende(e: EstadoDaIaNaConversa): string {
  if (e.treino) return 'IA em treino';
  if (e.teste) return 'IA em teste';
  return 'IA atendendo';
}

/**
 * "Boa" ou "Corrigir" embaixo de cada resposta da IA. A correção vira linha do
 * caderno (no banco, `public.ia_resposta_avaliar`), e a IA passa a seguir.
 */
export function AvaliacaoDaIa({ fioId, mensagemId }: { fioId: string; mensagemId: string }) {
  const clientes = useQueryClient();
  const { data } = useQuery({
    queryKey: chaveDasRespostas(fioId),
    queryFn: () => carregarRespostasDaConversa(fioId),
    enabled: IA_QUE_ATENDE,
    staleTime: 15_000,
  });
  const [corrigindo, setCorrigindo] = useState(false);
  const resposta = data?.get(mensagemId);

  const boa = useMutation({
    mutationFn: (r: RespostaDaIa) => avaliarResposta(r.id, 'boa', null),
    onSuccess: () => void clientes.invalidateQueries({ queryKey: CHAVE_DA_IA }),
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  if (!IA_QUE_ATENDE || !resposta) return null;

  if (resposta.avaliacao === 'boa') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-wpp-sis px-2 py-0.5 text-[10.5px] text-wpp-sis-texto shadow-wpp">
        <Check className="size-3" aria-hidden="true" />
        boa resposta
      </span>
    );
  }
  if (resposta.avaliacao === 'corrigir') {
    return (
      <span
        className="max-w-prose rounded-lg bg-wpp-sis px-2 py-1 text-[11px] text-wpp-sis-texto shadow-wpp"
        title="A correção foi para o caderno da IA."
      >
        <Pencil className="mr-1 inline size-3" aria-hidden="true" />
        corrigida: {resposta.correcao}
      </span>
    );
  }

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          className="toque inline-flex items-center gap-1 rounded-full bg-wpp-sis px-2 py-0.5 text-[10.5px] text-wpp-sis-texto shadow-wpp hover:underline disabled:opacity-60"
          disabled={boa.isPending}
          onClick={() => boa.mutate(resposta)}
          title="A resposta da IA estava certa."
        >
          <ThumbsUp className="size-3" aria-hidden="true" />
          Boa
        </button>
        <button
          type="button"
          className="toque inline-flex items-center gap-1 rounded-full bg-wpp-sis px-2 py-0.5 text-[10.5px] text-wpp-sis-texto shadow-wpp hover:underline"
          onClick={() => setCorrigindo(true)}
          title="Ensinar à IA o que ela devia ter respondido."
        >
          <Pencil className="size-3" aria-hidden="true" />
          Corrigir
        </button>
      </span>
      <DialogoDeCorrecao resposta={corrigindo ? resposta : null} aoFechar={() => setCorrigindo(false)} />
    </>
  );
}

/** O que a IA devia ter respondido. Também usado na tela "IA que atende". */
export function DialogoDeCorrecao({
  resposta,
  aoFechar,
}: {
  resposta: RespostaDaIa | null;
  aoFechar: () => void;
}) {
  const clientes = useQueryClient();
  const [texto, setTexto] = useState('');
  const id = useId();
  const corrigir = useMutation({
    mutationFn: (r: RespostaDaIa) => avaliarResposta(r.id, 'corrigir', texto.trim()),
    onSuccess: () => {
      void clientes.invalidateQueries({ queryKey: CHAVE_DA_IA });
      setTexto('');
      aoFechar();
      toast.success('Correção anotada no caderno da IA.', {
        description: 'Ela passa a seguir a partir da próxima resposta.',
      });
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  return (
    <Dialog open={resposta !== null} onOpenChange={(v) => !v && !corrigir.isPending && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Corrigir a resposta da IA</DialogTitle>
          <DialogDescription>
            A mensagem que já saiu não muda. A correção vai para o caderno, e a IA passa a responder
            assim nas próximas vezes.
          </DialogDescription>
        </DialogHeader>
        {resposta ? (
          <blockquote className="max-h-32 overflow-y-auto rounded-lg border-l-2 border-hairline bg-muted/40 px-3 py-2 text-sm whitespace-pre-line text-muted-foreground">
            {resposta.corpo.replace(/^\*[^*\n]{1,60}:\*\n/, '')}
          </blockquote>
        ) : null}
        <label htmlFor={id} className="text-sm font-medium">
          O que ela devia ter respondido
        </label>
        <textarea
          id={id}
          rows={4}
          maxLength={1500}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: o condomínio desse apartamento é R$ 650, e o IPTU já está incluso."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
        />
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={aoFechar} disabled={corrigir.isPending}>
            Voltar
          </Button>
          <Button
            type="button"
            onClick={() => resposta && corrigir.mutate(resposta)}
            disabled={corrigir.isPending || texto.trim().length < 3}
            className={cn(corrigir.isPending && 'opacity-80')}
          >
            Anotar a correção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
