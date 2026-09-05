'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Brain,
  Check,
  CircleAlert,
  Pencil,
  ShieldAlert,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import { LIMITES_PADRAO } from '@komune/prompts';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { aprovarRascunho, descartarRascunho, ErroDaConversa, MENSAGENS_DE_RECUSA } from './acoes';
import { CHAVE_CONVERSAS, chaveDaLinha } from './dados';
import { dataHoraCompleta } from './formatos';
import {
  CONFIANCA_BAIXA,
  fichaDaIntencao,
  ROTULO_BLOQUEIO,
  ROTULO_INTENCAO,
  ROTULO_RESPONDE,
  validadorApitou,
} from './mensagens';
import {
  ROTULO_TIPO_RASCUNHO,
  type FioDaConversa,
  type RascunhoDaIa,
  type VereditoDoValidador,
} from './tipos';

/**
 * A fila de aprovação do ADR-05, na forma de um cartão.
 *
 * ===========================================================================
 * O QUE A PESSOA PRECISA VER ANTES DE APROVAR
 * ===========================================================================
 * "A IA classifica e redige, a PESSOA aprova" só é verdade se a pessoa tiver o
 * que precisa para decidir. Um botão "Aprovar" embaixo de um texto bonito não é
 * aprovação: é assinar em branco, e produz exatamente o resultado que o ADR-05
 * existe para evitar — a Heloísa clicando em tudo às 18h porque o texto sempre
 * parece razoável.
 *
 * Então o cartão mostra três coisas ANTES do texto, nesta ordem:
 *
 *   1. **O que a IA entendeu** (`conversations.ai_intent`): uma das 25 intenções
 *      do R08, com a confiança e o que o playbook manda fazer com ela. É a parte
 *      que erra primeiro: um rascunho impecável para a intenção errada é o pior
 *      caso, porque nada no texto denuncia.
 *   2. **O que o validador disse** (`message_drafts.validator`): o veredito
 *      determinístico do RF-CON-24, com o trecho exato que ele barrou. Rascunho
 *      bloqueado continua aparecendo aqui — bloqueado não é apagado, é a prova de
 *      que o guardrail agiu, e às vezes uma pessoa precisa ver o que a IA quase
 *      mandou.
 *   3. **O que ele diz estar usando da base** (`proposed_claims`): a lista de
 *      fatos aprovados que sustentam o texto.
 *
 * ===========================================================================
 * O QUE APROVAR FAZ HOJE
 * ===========================================================================
 * Põe o rascunho em `aprovado`, assinado com quem clicou. Não manda nada: quem
 * fala com a Meta é o worker, e ele ainda não tem número nem token. O cartão diz
 * isso no rodapé, porque "Aprovar" sem essa frase é uma promessa de envio.
 */
export function CartaoDeAprovacao({
  rascunho,
  fio,
  organizacaoId,
  className,
}: {
  rascunho: RascunhoDaIa;
  /** O fio traz a intenção classificada e o resumo do que a IA entendeu. */
  fio: FioDaConversa | null;
  organizacaoId: string;
  className?: string;
}) {
  const clientes = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(rascunho.proposto);
  const [descartando, setDescartando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const recarregar = () => {
    void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
    void clientes.invalidateQueries({ queryKey: chaveDaLinha(organizacaoId) });
  };

  const aprovar = useMutation({
    mutationFn: () => aprovarRascunho(rascunho.id, texto.trim()),
    onSuccess: (resultado) => {
      if (!resultado.ok) {
        toast.error('O rascunho não foi aprovado.', {
          description:
            MENSAGENS_DE_RECUSA[resultado.motivo] ??
            'Ele mudou de estado enquanto você lia. Recarregue a conversa.',
        });
        recarregar();
        return;
      }
      toast.success('Rascunho aprovado.', {
        description: resultado.foi_editado
          ? 'Com a sua edição. A mensagem fica na fila até a Meta liberar o número.'
          : 'Do jeito que a IA escreveu. A mensagem fica na fila até a Meta liberar o número.',
      });
      recarregar();
    },
    onError: (erro) => {
      toast.error('Não deu para aprovar.', {
        description:
          erro instanceof ErroDaConversa ? erro.message : 'Tente de novo em alguns segundos.',
      });
    },
  });

  const descartar = useMutation({
    mutationFn: () => descartarRascunho(rascunho.id, motivo.trim()),
    onSuccess: (ok) => {
      if (ok) {
        toast.success('Rascunho descartado.', { description: 'O motivo ficou registrado.' });
        setDescartando(false);
        setMotivo('');
        recarregar();
      } else {
        toast.error('O rascunho já não estava mais na fila.');
        recarregar();
      }
    },
    onError: (erro) => {
      toast.error('Não deu para descartar.', {
        description:
          erro instanceof ErroDaConversa ? erro.message : 'Tente de novo em alguns segundos.',
      });
    },
  });

  const trabalhando = aprovar.isPending || descartar.isPending;
  const foiEditado = texto.trim() !== rascunho.proposto.trim();
  const vazio = texto.trim().length === 0;
  const longo = texto.length > LIMITES_PADRAO.maxCaracteres;

  return (
    <section
      aria-label="Rascunho da IA esperando aprovação"
      className={cn('space-y-3 rounded-xl border border-hairline bg-card/60 p-3 md:p-4', className)}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 className="font-heading text-sm font-semibold">A IA escreveu isto para você</h3>
        <Badge variant="pilula" className="h-5 px-2 text-[11px] font-normal">
          {ROTULO_TIPO_RASCUNHO[rascunho.tipo]}
        </Badge>
        {rascunho.promptVersao ? (
          <span className="text-[11px] text-muted-foreground">{rascunho.promptVersao}</span>
        ) : null}
        <span
          className="ml-auto text-[11px] text-muted-foreground"
          title={`Some sozinho em ${dataHoraCompleta(rascunho.expiraEm)}`}
        >
          some em {dataHoraCompleta(rascunho.expiraEm)}
        </span>
      </header>

      <OQueAIaEntendeu fio={fio} />
      <AvisoDoValidador veredito={rascunho.validador} />

      {editando ? (
        <div className="space-y-1.5">
          <label htmlFor={`texto-${rascunho.id}`} className="sr-only">
            Texto que vai ser enviado
          </label>
          <textarea
            id={`texto-${rascunho.id}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={5}
            className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
          />
          <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span className={cn(longo && 'text-destructive-texto')}>
              <span className="numerico">{texto.length}</span> de{' '}
              <span className="numerico">{LIMITES_PADRAO.maxCaracteres}</span> caracteres
            </span>
            {longo ? <span>o RF-CON-24 pede no máximo isso por turno</span> : null}
            {foiEditado ? (
              <button
                type="button"
                onClick={() => setTexto(rascunho.proposto)}
                className="inline-flex items-center gap-1 underline underline-offset-2"
              >
                <Undo2 className="size-3" aria-hidden="true" />
                voltar ao que a IA escreveu
              </button>
            ) : null}
          </p>
        </div>
      ) : (
        <blockquote className="rounded-lg border border-hairline bg-background/50 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-line">
          {texto}
        </blockquote>
      )}

      {foiEditado && !editando ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Pencil className="size-3" aria-hidden="true" />
          Você editou. O que a IA propôs fica guardado do jeito que estava.
        </p>
      ) : null}

      <Afirmacoes ids={rascunho.afirmacoes} />

      {descartando ? (
        <div className="space-y-2 rounded-lg border border-dashed border-hairline p-2.5">
          <p className="text-xs text-muted-foreground">
            Por que este rascunho não presta? Sem o motivo, o prompt nunca fica sabendo que
            errou.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS_PRONTOS.map((pronto) => (
              <button
                key={pronto}
                type="button"
                onClick={() => setMotivo(pronto)}
                className="rounded-full border border-hairline px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {pronto}
              </button>
            ))}
          </div>
          <label htmlFor={`motivo-${rascunho.id}`} className="sr-only">
            Motivo do descarte
          </label>
          <textarea
            id={`motivo-${rascunho.id}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Escreva o motivo"
            className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="toque h-11 md:h-9"
              disabled={motivo.trim().length === 0 || trabalhando}
              onClick={() => descartar.mutate()}
            >
              <Trash2 aria-hidden="true" />
              Descartar mesmo
            </Button>
            <Button
              variant="ghost"
              className="toque h-11 md:h-9"
              onClick={() => setDescartando(false)}
              disabled={trabalhando}
            >
              Voltar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            className="toque h-11 flex-1 md:h-9 md:flex-none"
            disabled={vazio || trabalhando}
            onClick={() => aprovar.mutate()}
          >
            <Check aria-hidden="true" />
            {foiEditado ? 'Aprovar com a minha edição' : 'Aprovar'}
          </Button>
          <Button
            variant="outline"
            className="toque h-11 md:h-9"
            onClick={() => setEditando((v) => !v)}
            disabled={trabalhando}
          >
            <Pencil aria-hidden="true" />
            {editando ? 'Parar de editar' : 'Editar'}
          </Button>
          <Button
            variant="ghost"
            className="toque h-11 md:h-9"
            onClick={() => setDescartando(true)}
            disabled={trabalhando}
          >
            <Trash2 aria-hidden="true" />
            Descartar
          </Button>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Aprovar assina o texto com o seu nome e põe a mensagem na fila. Ela sai quando o worker
        de envio rodar com o número liberado pela Meta — quem entrega é ele, nunca esta tela.
      </p>
    </section>
  );
}

/** Os motivos que se repetem, para não ter de digitar na rua. */
const MOTIVOS_PRONTOS = [
  'errou o tom',
  'entendeu a intenção errada',
  'prometeu o que não pode',
  'melhor ligar',
  'não é a hora',
];

/**
 * O que a IA entendeu da última mensagem recebida.
 *
 * A confiança aparece sempre, e vira aviso abaixo de 0,7 — o limiar do R08 §5.3,
 * onde o playbook manda escalar para humano. Intenção que este código não conhece
 * também é aviso: melhor dizer "não reconheci" do que mostrar um rótulo cru.
 */
function OQueAIaEntendeu({ fio }: { fio: FioDaConversa | null }) {
  const ficha = fichaDaIntencao(fio?.intencao ?? null);
  const confianca = fio?.confianca ?? null;
  const incerta = confianca !== null && confianca < CONFIANCA_BAIXA;

  if (!fio?.intencao && !fio?.resumo) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-dashed border-hairline px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
        <Brain className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Nada classificado neste fio ainda. Sem a intenção, o rascunho é um texto sem contexto:
          leia a conversa acima antes de aprovar.
        </span>
      </p>
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-hairline bg-background/40 px-2.5 py-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Brain className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">A IA entendeu que o parceiro</span>
        <span className="font-medium">
          {ficha ? ROTULO_INTENCAO[ficha.intencao] : `usou um rótulo desconhecido (${fio.intencao})`}
        </span>
        {confianca !== null ? (
          <span className={cn('text-muted-foreground', incerta && 'text-foreground')}>
            confiança <span className="numerico">{confianca.toFixed(2).replace('.', ',')}</span>
          </span>
        ) : null}
      </p>

      {ficha ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          O playbook manda: {ficha.acao}. Quem responde é {ROTULO_RESPONDE[ficha.responde]}.
        </p>
      ) : null}

      {incerta ? (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed">
          <CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>
            Confiança abaixo de <span className="numerico">0,70</span>: o R08 manda uma pessoa
            olhar. Confira se a intenção bate com o que está escrito acima.
          </span>
        </p>
      ) : null}

      {fio.resumo ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{fio.resumo}</p>
      ) : null}
    </div>
  );
}

/**
 * O veredito do validador determinístico (RF-CON-24).
 *
 * Aparece quando ele apita, e some quando aprovou — um "validador: ok" em todo
 * cartão vira decoração que ninguém lê, e aí o dia em que ele apitar de verdade
 * ninguém percebe também.
 *
 * `sem_registro` é aviso, não silêncio: o validador não ter rodado é outra coisa,
 * e mais grave, do que ele ter passado.
 */
function AvisoDoValidador({ veredito }: { veredito: VereditoDoValidador }) {
  if (!validadorApitou(veredito)) return null;

  return (
    <div className="space-y-1.5 rounded-lg border border-hairline bg-muted/50 px-2.5 py-2">
      <p className="flex items-center gap-2 text-xs font-medium">
        <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
        {veredito.situacao === 'bloqueado'
          ? 'O validador de promessas barrou este texto'
          : veredito.situacao === 'substituido'
            ? 'O validador trocou o texto pela frase de escape'
            : 'Este rascunho não tem veredito do validador'}
      </p>

      {veredito.situacao === 'sem_registro' ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Não há registro de o validador ter rodado sobre este texto. Isso não é o mesmo que
          ele ter passado: leia palavra por palavra antes de aprovar, principalmente número,
          prazo e condição comercial.
        </p>
      ) : null}

      <ul className="space-y-1">
        {veredito.motivos.map((motivo, i) => (
          <li key={i} className="text-[11px] leading-relaxed">
            <span className="font-medium">
              {ROTULO_BLOQUEIO[motivo.codigo as keyof typeof ROTULO_BLOQUEIO] ?? motivo.codigo}
            </span>
            {motivo.trecho ? (
              <>
                {' '}
                em <q className="italic">{motivo.trecho}</q>
              </>
            ) : null}
            {motivo.explicacao ? (
              <span className="text-muted-foreground"> — {motivo.explicacao}</span>
            ) : null}
          </li>
        ))}
      </ul>

      {veredito.queda ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {veredito.queda === 'humano'
            ? 'Promessa comercial é assunto de gente: o certo aqui é reescrever ou ligar, não aprovar como está.'
            : 'É forma, não conteúdo: o texto fixo do segmento resolve sem ocupar você.'}
        </p>
      ) : null}
    </div>
  );
}

/** Os fatos da base que o rascunho diz estar usando (RF-CON-24, R08 §7). */
function Afirmacoes({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span>Diz estar usando da base:</span>
      {ids.map((id) => (
        <Badge key={id} variant="pilula" className="h-4 px-1.5 text-[10px] font-normal">
          {id}
        </Badge>
      ))}
    </p>
  );
}
