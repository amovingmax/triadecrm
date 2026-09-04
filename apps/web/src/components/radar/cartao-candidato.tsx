'use client';

import Link from 'next/link';
import {
  AtSign,
  Building2,
  Check,
  CircleSlash,
  ExternalLink,
  Globe,
  Merge,
  Phone,
  TriangleAlert,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarData, formatarLocal, formatarTelefone } from '@/components/parceiros/formatos';

import type { AcaoDeRevisao } from './dados';

/**
 * Link de texto que ainda é alvo de polegar: 44px de altura no celular, altura de
 * linha normal a partir do `md`. Sem isso o @ do Instagram e o nome da ficha
 * duplicada ficavam com 20px — o resto do app não tem nenhum alvo abaixo de 44px
 * no celular, e o Radar também não pode ter.
 */
const ALVO_INLINE = 'inline-flex min-h-11 items-center md:min-h-0';
import {
  EXPLICACAO_DA_MARCA,
  ROTULO_DA_REGRA,
  ROTULO_SITUACAO,
  type CandidatoDaFila,
} from './tipos';

/**
 * Um candidato na fila de revisão (RF-RAD-11).
 *
 * A meta do requisito é ≤ 60 s por registro, então tudo o que a decisão precisa
 * está no cartão: de onde veio, o que se sabe do alvo, o que a higiene marcou e
 * quais fichas da base podem ser a mesma empresa. Nada de abrir outra tela para
 * decidir.
 *
 * Com o cartão em foco, A aprova, M mescla com a primeira duplicata, R recusa e N
 * marca "não contatar" — os atalhos que o RF-RAD-11 pede, presos ao cartão em foco
 * e não à página, para nunca agirem sobre um candidato que a pessoa não está lendo.
 *
 * Sem cor cromática: candidato não tem temperatura (ele ainda não é um negócio), e
 * pintar de verde ou vermelho aqui roubaria a leitura da escala térmica.
 */
export function CartaoCandidato({
  candidato,
  ocupado,
  podeDecidir,
  aoDecidir,
}: {
  candidato: CandidatoDaFila;
  /** Este cartão está esperando o servidor responder. */
  ocupado: boolean;
  /** Papel que decide na fila (o RLS é quem manda de verdade). */
  podeDecidir: boolean;
  aoDecidir: (acao: AcaoDeRevisao, organizacaoId?: string) => void;
}) {
  const pendente = candidato.status === 'novo';
  const decideAgora = pendente && podeDecidir && !ocupado;
  const primeiraDuplicata = candidato.duplicatas[0];

  function aoTeclar(evento: React.KeyboardEvent<HTMLElement>) {
    if (!decideAgora) return;
    // Só quando o foco está no cartão: dentro de um campo, "a" é a letra "a".
    if (evento.target !== evento.currentTarget) return;
    if (evento.metaKey || evento.ctrlKey || evento.altKey) return;

    const tecla = evento.key.toLowerCase();
    if (tecla === 'a' && !candidato.nao_contatar) {
      evento.preventDefault();
      aoDecidir('aprovar');
    } else if (tecla === 'm' && primeiraDuplicata) {
      evento.preventDefault();
      aoDecidir('mesclar', primeiraDuplicata.organization_id);
    } else if (tecla === 'r') {
      evento.preventDefault();
      aoDecidir('recusar');
    } else if (tecla === 'n') {
      evento.preventDefault();
      aoDecidir('nao_contatar');
    }
  }

  return (
    <article
      tabIndex={pendente ? 0 : -1}
      onKeyDown={aoTeclar}
      aria-label={`Candidato ${candidato.nome}`}
      className={cn(
        'flex flex-col gap-3 border-b border-hairline py-4 outline-none',
        'focus-visible:rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50',
        ocupado && 'pointer-events-none opacity-60',
      )}
    >
      {/* Nome e situação */}
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h3 className="font-heading text-[15px] leading-tight font-medium tracking-tight">
          {candidato.nome}
        </h3>

        {candidato.nao_contatar ? (
          <Badge variant="destructive" className="gap-1">
            <CircleSlash aria-hidden="true" />
            Não contatar
          </Badge>
        ) : null}

        {!pendente ? (
          <Badge variant="pilula" className="font-normal">
            {ROTULO_SITUACAO[candidato.status]}
          </Badge>
        ) : null}

        {candidato.organizacao_id ? (
          <Link
            href={`/parceiros/${candidato.organizacao_id}`}
            className={
              ALVO_INLINE + ' gap-1 text-xs underline underline-offset-4 hover:text-foreground'
            }
          >
            Abrir a ficha
            <ExternalLink className="size-3" aria-hidden="true" />
          </Link>
        ) : null}
      </header>

      {/* De onde veio e o que se sabe */}
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
        <span className="text-foreground">{candidato.categoria ?? 'Sem categoria'}</span>
        {formatarLocal(candidato.bairro, candidato.cidade) ? (
          <>
            <Ponto />
            <span>{formatarLocal(candidato.bairro, candidato.cidade)}</span>
          </>
        ) : null}
        <Ponto />
        {candidato.source_url ? (
          <a
            href={candidato.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className={ALVO_INLINE + ' gap-1 underline underline-offset-4 hover:text-foreground'}
          >
            {candidato.fonte}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : (
          <span>{candidato.fonte}</span>
        )}
        <Ponto />
        <span>
          por {candidato.coletor} em{' '}
          <span className="numerico">{formatarData(candidato.criado_em)}</span>
        </span>
      </p>

      {/* Canais de contato */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        {candidato.telefone ? (
          <Dado icone={<Phone className="size-3.5" aria-hidden="true" />} rotulo="Telefone">
            <span className="numerico">{formatarTelefone(candidato.telefone)}</span>
          </Dado>
        ) : null}
        {candidato.instagram ? (
          <Dado icone={<AtSign className="size-3.5" aria-hidden="true" />} rotulo="Instagram">
            <a
              href={`https://instagram.com/${candidato.instagram}`}
              target="_blank"
              rel="noreferrer noopener"
              className={ALVO_INLINE + ' underline underline-offset-4'}
            >
              {candidato.instagram}
            </a>
          </Dado>
        ) : null}
        {candidato.site ? (
          <Dado icone={<Globe className="size-3.5" aria-hidden="true" />} rotulo="Site">
            {candidato.site}
          </Dado>
        ) : null}
        {candidato.cnpj ? (
          <Dado icone={<Building2 className="size-3.5" aria-hidden="true" />} rotulo="CNPJ">
            <span className="numerico">{candidato.cnpj}</span>
          </Dado>
        ) : null}
        {!candidato.telefone && !candidato.instagram && !candidato.site && !candidato.cnpj ? (
          <li className="text-muted-foreground">Nenhum contato conhecido ainda.</li>
        ) : null}
      </ul>

      {candidato.observacao ? (
        <p className="max-w-prose text-sm text-muted-foreground">{candidato.observacao}</p>
      ) : null}

      {/* O que a higiene de entrada marcou (RF-RAD-16) */}
      {candidato.sinalizacoes.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {candidato.sinalizacoes.map((marca) => {
            const nota = EXPLICACAO_DA_MARCA[marca];
            return (
              <li key={marca} className="flex items-start gap-2 text-xs">
                <TriangleAlert
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{nota?.rotulo ?? marca}</span>{' '}
                  {nota?.explicacao ?? 'Confira este dado antes de decidir.'}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Duplicatas sugeridas por app.find_org_matches */}
      {candidato.duplicatas.length > 0 ? (
        <section
          aria-label="Fichas parecidas na base"
          className="rounded-lg border border-hairline bg-muted/40 p-3"
        >
          <p className="text-xs font-medium">
            {candidato.duplicatas.length === 1
              ? 'Uma ficha da base pode ser a mesma empresa'
              : `${candidato.duplicatas.length} fichas da base podem ser a mesma empresa`}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {candidato.duplicatas.map((d) => (
              <li key={d.organization_id} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <Link
                  href={`/parceiros/${d.organization_id}`}
                  className={ALVO_INLINE + ' text-sm underline underline-offset-4'}
                >
                  {d.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {ROTULO_DA_REGRA[d.reason] ?? d.reason} ·{' '}
                  <span className="numerico">{Math.round(Number(d.confidence) * 100)}%</span>
                </span>
                {decideAgora ? (
                  <Button
                    variant="outline"
                    onClick={() => aoDecidir('mesclar', d.organization_id)}
                    className="toque ml-auto h-11 md:h-8"
                  >
                    <Merge aria-hidden="true" />
                    Mesclar aqui
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* A decisão */}
      {pendente && podeDecidir ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => aoDecidir('aprovar')}
            disabled={ocupado || candidato.nao_contatar}
            className="toque h-11 md:h-8"
          >
            <Check aria-hidden="true" />
            Aprovar
          </Button>
          <Button
            variant="outline"
            onClick={() => aoDecidir('recusar')}
            disabled={ocupado}
            className="toque h-11 md:h-8"
          >
            <X aria-hidden="true" />
            Recusar
          </Button>
          <Button
            variant="ghost"
            onClick={() => aoDecidir('nao_contatar')}
            disabled={ocupado}
            className="toque h-11 text-muted-foreground md:h-8"
          >
            <CircleSlash aria-hidden="true" />
            Não contatar
          </Button>

          {candidato.nao_contatar ? (
            <p className="text-xs text-muted-foreground">
              Aprovar está bloqueado: este contato está na lista de supressão.
            </p>
          ) : null}
        </div>
      ) : null}

      {!pendente && candidato.motivo_da_revisao ? (
        <p className="text-xs text-muted-foreground">
          {candidato.revisado_por ? `${candidato.revisado_por}: ` : ''}
          {candidato.motivo_da_revisao}
        </p>
      ) : null}
    </article>
  );
}

function Dado({
  icone,
  rotulo,
  children,
}: {
  icone: React.ReactNode;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="text-muted-foreground" aria-hidden="true">
        {icone}
      </span>
      <span className="sr-only">{rotulo}: </span>
      {children}
    </li>
  );
}

/** Separador entre pedaços da linha de contexto. */
function Ponto() {
  return (
    <span aria-hidden="true" className="text-muted-foreground/60">
      ·
    </span>
  );
}
