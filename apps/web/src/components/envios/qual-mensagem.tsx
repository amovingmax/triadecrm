'use client';

import { useState } from 'react';
import { BadgeCheck, Clock, Info, PenLine, Undo2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { TextoEmPedacos } from './celular';
import { FolhaDoModelo } from './criar-modelo';
import { ehCampoDaFicha, pedacosDaMensagem, rotuloDaVariavel } from './formatos';
import type { Modelo, RegraDaVariavel } from './tipos';

/** O cumprimento é uma opção só; o resto é o id do modelo aprovado. */
export type EscolhaDaMensagem = 'cumprimento' | number;

export type ModeloEmAnalise = {
  id: number;
  name: string;
  meta_status: string | null;
  body: string | null;
};

/**
 * "2. Qual mensagem" (protótipo B, 12/11/2026): um cartão por mensagem que a
 * Meta já aprovou, com o texto à vista e os campos que mudam por pessoa como
 * etiqueta ("[Nome]"). As que esperam a Meta aparecem apagadas. O texto livre
 * saiu desta tela: fora da janela de 24 h ele não chega, e quem está dentro
 * dela responde-se pela conversa.
 *
 * Um campo de texto fixo (que não vem da ficha, como o nome de um evento)
 * aparece logo abaixo do cartão escolhido: é o único que só a pessoa sabe.
 */
export function QualMensagem({
  escolha,
  aoEscolher,
  cumprimento,
  carregandoCumprimento,
  modelos,
  carregandoModelos,
  emAnalise,
  fixas,
  regras,
  aoMudarFixo,
  aoPuxarDaFicha,
  criaModelo,
  aviso,
}: {
  escolha: EscolhaDaMensagem;
  aoEscolher: (e: EscolhaDaMensagem) => void;
  cumprimento: Modelo | null;
  carregandoCumprimento: boolean;
  modelos: readonly Modelo[];
  carregandoModelos: boolean;
  emAnalise: readonly ModeloEmAnalise[];
  /** As variáveis de texto fixo da mensagem escolhida. */
  fixas: readonly string[];
  regras: Record<string, RegraDaVariavel>;
  aoMudarFixo: (variavel: string, texto: string) => void;
  /** Volta um campo da ficha que virou texto fixo a puxar da ficha. */
  aoPuxarDaFicha: (variavel: string) => void;
  /** Admin e gestor escrevem mensagem nova; o SDR dispara com as que existem. */
  criaModelo: boolean;
  /** O que a tela mudou sozinha ao escolher (quem assina, por exemplo). */
  aviso: string | null;
}) {
  const [escrevendo, setEscrevendo] = useState(false);

  const camposFixos =
    fixas.length > 0 ? (
      <div className="ml-7 space-y-2 rounded-xl bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">
          {fixas.length === 1
            ? 'Este pedaço você escreve, e vai'
            : 'Estes pedaços você escreve, e vão'}{' '}
          igual para todos:
        </p>
        {fixas.map((v) => {
          const regra = regras[v];
          const daFicha = ehCampoDaFicha(v);
          return (
            <div
              key={v}
              className={cn(
                'grid gap-1.5 sm:items-center',
                daFicha
                  ? 'sm:grid-cols-[9rem_minmax(0,1fr)_auto]'
                  : 'sm:grid-cols-[9rem_minmax(0,1fr)]',
              )}
            >
              <label htmlFor={`fixo-${v}`} className="text-sm font-medium">
                [{rotuloDaVariavel(v)}]
              </label>
              <Input
                id={`fixo-${v}`}
                value={regra && 'fixo' in regra ? regra.fixo : ''}
                maxLength={200}
                onChange={(e) => aoMudarFixo(v, e.target.value)}
                placeholder="O texto, igual para todos"
                className="h-11 bg-background md:h-9"
              />
              {daFicha ? (
                // O caminho de volta: este campo existe na ficha de cada pessoa.
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="toque h-11 justify-self-start text-primary md:h-8"
                  onClick={() => aoPuxarDaFicha(v)}
                >
                  <Undo2 aria-hidden="true" />
                  Puxar da ficha de cada um
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    ) : null;

  return (
    <section
      aria-labelledby="bloco-mensagem"
      className="sombra-base min-w-0 space-y-4 rounded-xl bg-card p-4 md:p-6"
    >
      <h2
        id="bloco-mensagem"
        className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.01em]"
      >
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[13px] font-semibold text-background"
        >
          2
        </span>
        Qual mensagem
      </h2>
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Para quem não falou com vocês nas últimas 24 horas, o WhatsApp só deixa mandar mensagem já
        aprovada pela Meta.
      </p>

      <fieldset className="space-y-2">
        <legend className="sr-only">Escolha a mensagem</legend>

        {cumprimento ? (
          <>
            <Cartao
              valor="cumprimento"
              escolhido={escolha === 'cumprimento'}
              aoEscolher={() => aoEscolher('cumprimento')}
              nome="Cumprimento"
              corpo={cumprimento.body}
              extra="Vira “Bom dia!”, “Boa tarde!” ou “Boa noite!” sozinho, pela hora em que cada mensagem sai."
            />
            {escolha === 'cumprimento' ? camposFixos : null}
          </>
        ) : carregandoCumprimento ? null : (
          <EmAnalise nome="Cumprimento" corpo={null} recusado={false} />
        )}

        {modelos.map((m) => (
          <div key={m.id} className="space-y-2">
            <Cartao
              valor={String(m.id)}
              escolhido={escolha === m.id}
              aoEscolher={() => aoEscolher(m.id)}
              nome={m.name}
              corpo={m.body}
              extra={
                m.botoes.length > 0
                  ? `Com botões: ${m.botoes.map((b) => b.texto).join(' · ')}`
                  : null
              }
            />
            {escolha === m.id ? camposFixos : null}
          </div>
        ))}

        {carregandoModelos ? (
          <p className="px-1 text-sm text-muted-foreground">Carregando as mensagens…</p>
        ) : null}

        {emAnalise.map((m) => (
          <EmAnalise
            key={m.id}
            nome={m.name}
            corpo={m.body}
            recusado={m.meta_status === 'rejected'}
          />
        ))}
      </fieldset>

      {aviso ? (
        <p role="status" className="text-sm font-medium text-menta-texto">
          {aviso}
        </p>
      ) : null}

      {criaModelo ? (
        <Button
          variant="ghost"
          className="toque -ml-2 h-11 px-2 text-primary md:h-9"
          onClick={() => setEscrevendo(true)}
        >
          <PenLine aria-hidden="true" />
          Escrever uma mensagem nova
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Precisa de uma mensagem nova? Peça a um admin ou gestor: ela passa pela aprovação da Meta
          antes de poder ser usada.
        </p>
      )}
      {escrevendo ? <FolhaDoModelo aoFechar={() => setEscrevendo(false)} /> : null}
    </section>
  );
}

function SeloAprovada() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-menta-fundo px-2 py-0.5 text-[11px] font-medium text-menta-texto">
      <BadgeCheck className="size-3.5" aria-hidden="true" />
      Aprovada pela Meta
    </span>
  );
}

function Cartao({
  valor,
  escolhido,
  aoEscolher,
  nome,
  corpo,
  extra,
}: {
  valor: string;
  escolhido: boolean;
  aoEscolher: () => void;
  nome: string;
  corpo: string;
  extra: string | null;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 transition-colors',
        'has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50',
        escolhido
          ? 'border-foreground ring-1 ring-foreground'
          : 'border-hairline hover:border-input',
      )}
    >
      <input
        type="radio"
        name="mensagem-do-disparo"
        value={valor}
        checked={escolhido}
        onChange={aoEscolher}
        className="mt-0.5 size-4 shrink-0 accent-foreground"
      />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{nome}</span>
          <SeloAprovada />
        </span>
        <span
          className={cn(
            'block text-sm leading-relaxed text-muted-foreground',
            !escolhido && 'line-clamp-3',
          )}
        >
          <TextoEmPedacos pedacos={pedacosDaMensagem(corpo)} onde="cartao" />
        </span>
        {extra ? <span className="block text-xs text-muted-foreground">{extra}</span> : null}
      </span>
    </label>
  );
}

function EmAnalise({
  nome,
  corpo,
  recusado,
}: {
  nome: string;
  corpo: string | null;
  recusado: boolean;
}) {
  return (
    <div
      aria-disabled="true"
      className="flex items-start gap-3 rounded-xl border border-dashed border-input p-4 text-muted-foreground"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 rounded-full border-[1.5px] border-dashed border-current"
      />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{nome}</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
            <Clock className="size-3.5" aria-hidden="true" />
            {recusado ? 'Recusada pela Meta' : 'Em análise na Meta'}
          </span>
        </span>
        {corpo ? (
          <span className="block line-clamp-2 text-sm leading-relaxed">
            <TextoEmPedacos pedacos={pedacosDaMensagem(corpo)} onde="cartao" />
          </span>
        ) : null}
        <span className="block text-xs">
          {recusado
            ? 'A Meta não aprovou esta mensagem. Escreva outra com outras palavras.'
            : 'Ainda não dá para usar. Quando a Meta aprovar, aparece aqui para escolher.'}
        </span>
      </span>
    </div>
  );
}
