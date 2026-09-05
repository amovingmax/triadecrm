'use client';

import Link from 'next/link';
import { CircleHelp, ListTodo, Mic, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ChipTemperatura } from '@/components/temperatura';

import { atrasoEmTexto, hora } from './formatos';
import { Secao } from './resumo-manha';
import { contagemDeAtividade, metricasFeitas, type ResumoDoDia } from './tipos';

/**
 * A mensagem das 18:00: primeiro o que foi feito, depois o que ficou (R07 §8.2).
 *
 * A ordem é regra, não gosto: o R07 §4.2 diz "celebrar antes de cobrar", e inverter
 * isso transforma o fim do dia de duas pessoas em cobrança de call center.
 *
 * O caso mais delicado é o dia sem nenhum registro. O anexo é explícito: antes de
 * contar zero, perguntar se houve atividade que não entrou. O banco já responde essa
 * pergunta (`sem_registro`), então a tela não precisa deduzir de um `length === 0` —
 * e a diferença entre "não fez" e "não registrou" fica onde tem de ficar.
 */
export function BlocoDaNoite({ resumo, nome }: { resumo: ResumoDoDia; nome: string }) {
  const feitas = metricasFeitas(resumo.metas);
  const pendentes = resumo.fila;

  return (
    <div className="flex flex-col gap-6">
      {resumo.sem_registro ? <SemRegistro nome={nome} /> : <Feito resumo={resumo} nome={nome} />}

      {feitas.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 font-heading text-sm font-medium">
            <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
            Contadores do dia
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {feitas.map((metrica) => (
              <li
                key={metrica.metrica}
                className="flex flex-col gap-1 rounded-lg border border-hairline bg-card px-3 py-2.5"
              >
                <p className="truncate text-xs text-muted-foreground">{metrica.rotulo}</p>
                <p className="flex items-baseline gap-1.5">
                  <span className="numerico text-2xl leading-none font-medium">
                    {metrica.realizado ?? 0}
                  </span>
                  {metrica.meta !== null ? (
                    <span className="text-xs text-muted-foreground">
                      de <span className="numerico">{metrica.meta}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">sem meta</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Secao
        titulo="Ficou pendente"
        icone={<ListTodo className="size-4" aria-hidden="true" />}
        vazio="Nada ficou para trás: a fila de hoje está limpa."
        quantos={pendentes.length}
      >
        <ol className="flex flex-col">
          {pendentes.slice(0, 10).map((item, i) => (
            <li
              key={`${item.task_id ?? item.deal_id ?? item.organization_id ?? 'item'}-${i}`}
              className="flex items-start gap-3 border-b border-hairline py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {item.organizacao ?? item.titulo ?? 'Sem nome'}
                  {item.temperatura ? (
                    <ChipTemperatura temperatura={item.temperatura} className="ml-2 align-middle" />
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{item.motivo}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {atrasoEmTexto(item.atraso_horas) ?? hora(item.quando)}
              </span>
            </li>
          ))}
        </ol>
        <p className="pt-2 text-xs text-muted-foreground">
          {pendentes.length > 10 ? (
            <>
              E mais <span className="numerico">{pendentes.length - 10}</span>.{' '}
            </>
          ) : null}
          Reprogramar tudo para amanhã às <span className="numerico">08:00</span> com uma resposta
          ainda não existe: por enquanto, o adiamento é item a item, no{' '}
          <Link href="/meu-dia" className="underline underline-offset-4 hover:text-foreground">
            Meu dia
          </Link>
          .
        </p>
      </Secao>
    </div>
  );
}

/** O que foi feito, em frase — não em painel. São duas pessoas. */
function Feito({ resumo, nome }: { resumo: ResumoDoDia; nome: string }) {
  const partes = resumo.feito.por_tipo.map(
    (t) => `${t.quantos} ${contagemDeAtividade(t.tipo, t.quantos)}`,
  );

  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 font-heading text-sm font-medium">
        <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
        Feito hoje
      </h2>
      <p className="text-sm">
        {nome ? `${nome}, você registrou ` : 'Registrado hoje: '}
        <span className="numerico font-medium">{resumo.feito.registros}</span>
        {resumo.feito.registros === 1 ? ' contato' : ' contatos'}
        {partes.length > 0 ? ` (${partes.join(', ')})` : ''}.
        {resumo.feito.portas_abertas > 0 ? (
          <>
            {' '}
            <span className="numerico">{resumo.feito.portas_abertas}</span>
            {resumo.feito.portas_abertas === 1
              ? ' virou conversa de verdade'
              : ' viraram conversa de verdade'}
            .
          </>
        ) : resumo.feito.portas_batidas > 0 ? (
          <>
            {' '}
            <span className="numerico">{resumo.feito.portas_batidas}</span>
            {resumo.feito.portas_batidas === 1 ? ' porta batida' : ' portas batidas'} sem ninguém
            do outro lado — acontece.
          </>
        ) : null}
      </p>
      <p className="text-sm text-muted-foreground">
        {resumo.feito.tarefas_concluidas > 0 ? (
          <>
            <span className="numerico">{resumo.feito.tarefas_concluidas}</span>
            {resumo.feito.tarefas_concluidas === 1 ? ' tarefa fechada' : ' tarefas fechadas'}
            {resumo.feito.movimentos > 0 ? ' · ' : '. '}
          </>
        ) : null}
        {resumo.feito.movimentos > 0 ? (
          <>
            <span className="numerico">{resumo.feito.movimentos}</span>
            {resumo.feito.movimentos === 1
              ? ' cartão movido no funil. '
              : ' cartões movidos no funil. '}
          </>
        ) : null}
        Ontem foram <span className="numerico">{resumo.ontem.registros}</span>
        {resumo.ontem.registros === 1 ? ' registro' : ' registros'} e{' '}
        <span className="numerico">{resumo.ontem.portas_abertas}</span>
        {resumo.ontem.portas_abertas === 1 ? ' porta aberta' : ' portas abertas'}.
      </p>
      {resumo.feito.sem_desfecho > 0 ? (
        <p className="text-sm text-muted-foreground">
          <span className="numerico">{resumo.feito.sem_desfecho}</span>
          {resumo.feito.sem_desfecho === 1
            ? ' registro está sem resultado'
            : ' registros estão sem resultado'}
          : falta dizer o que aconteceu para o funil andar.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Dia sem nenhum registro.
 *
 * O R07 §8.2 tem uma variante inteira só para isto, e a razão é boa: contar zero para
 * quem passou o dia na rua sem abrir o CRM é errado e é ofensivo. A pergunta vem
 * antes do número.
 */
function SemRegistro({ nome }: { nome: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-hairline bg-card px-4 py-3.5">
      <h2 className="flex items-center gap-2 font-heading text-sm font-medium">
        <CircleHelp className="size-4 text-muted-foreground" aria-hidden="true" />
        Nenhum registro hoje
      </h2>
      <p className="text-sm text-muted-foreground">
        {nome ? `${nome}, não ` : 'Não '}apareceu nenhum contato seu hoje. Teve atividade que não
        entrou no sistema? Registrar leva vinte segundos e o dia deixa de contar zero.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild className="toque h-11 md:h-9">
          <Link href="/registrar">
            <Mic aria-hidden="true" />
            Registrar um contato
          </Link>
        </Button>
      </div>
    </section>
  );
}
