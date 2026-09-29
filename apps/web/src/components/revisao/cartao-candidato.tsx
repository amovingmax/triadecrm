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
  Sparkles,
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
 * no celular, e a Revisão também não pode ter.
 */
const ALVO_INLINE = 'inline-flex min-h-11 items-center md:min-h-0';
import { ProcurarTelefoneDoCandidato } from './procurar-telefone-do-candidato';
import {
  diasAteSumir,
  EXPLICACAO_DA_FAIXA,
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
  marcado,
  aoMarcar,
  aoDecidir,
}: {
  candidato: CandidatoDaFila;
  /** Este cartão está esperando o servidor responder. */
  ocupado: boolean;
  /** Papel que decide na fila (o RLS é quem manda de verdade). */
  podeDecidir: boolean;
  /**
   * Está marcado para o lote. `null` = este cartão não entra em lote nenhum.
   *
   * Quem não entra: nome já decidido, quem pediu para não ser procurado (o
   * banco recusa, e oferecer a caixinha é prometer o que não acontece) e quem
   * tem ficha parecida na base — ali a decisão é QUAL FICHA VENCE, e isso não
   * se agrupa.
   */
  marcado: boolean | null;
  aoMarcar: (marcado: boolean) => void;
  aoDecidir: (acao: AcaoDeRevisao, organizacaoId?: string) => void;
}) {
  const pendente = candidato.status === 'novo';
  // Só candidato em "novo" expira: a retenção do PRD §10.6 não toca em aprovado,
  // mesclado nem recusado.
  const restam = pendente ? diasAteSumir(candidato.criado_em, new Date()) : null;
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

  // ===========================================================================
  // O CARTÃO LIMPO (29/09/2026)
  // ===========================================================================
  // Rafael, com a fila aberta: "melhore a tela de revisão também, ta feia e
  // poluida (...) evite muita informação junta, quero algo clean e organizado".
  //
  // O que poluía, medido no print dele:
  //   * uma linha de contexto com QUATRO fatos — categoria, bairro, "Planilha
  //     (importação)" e "por Fulano em 25/09/2026". Os dois últimos dizem de onde
  //     o nome veio, e isso não ajuda a decidir se ele vira parceiro;
  //   * no nome sem contato, o MESMO aviso duas vezes: "Sem telefone, @, site ou
  //     CNPJ. Virar parceiro cria a ficha..." e, logo abaixo, a marca da higiene
  //     "Sem canal de contato. Não há telefone... Virar parceiro cria a ficha...";
  //   * três botões largos em toda linha, e a lista como uma pilha comprida
  //     separada por filete.
  //
  // Agora cada nome é um CARTÃO com duas colunas: à esquerda quem é (o nome, uma
  // linha de o-que-e-onde, uma linha de contato), à direita a decisão. De onde
  // veio e quem importou foram para o `title` do nome — continuam a um passar de
  // mouse, que é onde dado de proveniência mora. O aviso de "sem contato" aparece
  // UMA vez, na linha de contato, que é onde a ausência é notada.
  const semContato =
    !candidato.telefone && !candidato.instagram && !candidato.site && !candidato.cnpj;
  // A marca "sem_contato" da higiene diz o mesmo que a linha de contato vazia:
  // mostrar as duas era repetir a frase inteira dois centímetros abaixo.
  const marcas = candidato.sinalizacoes.filter((m) => !(semContato && m === 'sem_contato'));
  const proveniencia = `${candidato.fonte} · por ${candidato.coletor} em ${formatarData(candidato.criado_em)}`;
  const local = formatarLocal(candidato.bairro, candidato.cidade);

  return (
    <article
      tabIndex={pendente ? 0 : -1}
      onKeyDown={aoTeclar}
      aria-label={`Candidato ${candidato.nome}`}
      className={cn(
        'sombra-base flex flex-col gap-3 rounded-xl bg-card p-4 outline-none sm:p-5',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
        ocupado && 'pointer-events-none opacity-60',
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        {/* ------------------------------------------------ quem é */}
        <div className="flex min-w-0 flex-1 gap-3">
          {marcado === null ? null : (
            <input
              type="checkbox"
              checked={marcado}
              onChange={(e) => aoMarcar(e.target.checked)}
              aria-label={`Marcar ${candidato.nome} para aprovar em lote`}
              className="mt-1 size-4 shrink-0 accent-foreground"
            />
          )}

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3
                className="min-w-0 font-heading text-base leading-snug font-semibold tracking-[-0.01em]"
                title={proveniencia}
              >
                {candidato.nome}
              </h3>
              {/* A faixa como LETRA e número, sem moldura: é desempate, não
                  manchete. O porquê continua no `title`. */}
              {pendente && candidato.faixa ? (
                <span
                  className="numerico shrink-0 text-xs text-muted-foreground"
                  title={EXPLICACAO_DA_FAIXA[candidato.faixa]}
                >
                  <span className="font-semibold text-foreground">{candidato.faixa}</span>
                  {candidato.pontuacao === null ? null : <> {candidato.pontuacao}</>}
                </span>
              ) : null}
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
            </div>

            {/* O QUE É E ONDE — uma linha só. */}
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
              {candidato.categoria ? (
                <span className="text-foreground">{candidato.categoria}</span>
              ) : (
                // Sem categoria, o que ajuda é o RÓTULO DA FONTE: sem ele a pessoa
                // adivinha entre 19 opções. É o único caso em que ele aparece.
                <span>
                  <span className="font-medium text-destructive-texto">Sem categoria</span>
                  {candidato.categoria_na_fonte ? (
                    <> · a fonte chamou de “{candidato.categoria_na_fonte}”</>
                  ) : null}
                </span>
              )}
              {local ? (
                <>
                  <Ponto />
                  <span>{local}</span>
                </>
              ) : null}
              {candidato.source_url ? (
                <a
                  href={candidato.source_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={`Abrir em ${candidato.fonte}`}
                  aria-label={`Abrir em ${candidato.fonte}`}
                  className={ALVO_INLINE + ' text-muted-foreground hover:text-foreground'}
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              ) : null}
              {/* A retenção (PRD §10.6) só aparece nos últimos 30 dias: se
                  aparecesse sempre, seria moldura. */}
              {restam !== null && restam <= 30 ? (
                <>
                  <Ponto />
                  <span className="text-destructive-texto">
                    {restam === 0 ? 'Sai da fila hoje' : `Sai da fila em ${restam} dias`}
                  </span>
                </>
              ) : null}
            </p>

            {/* CONTATO — ou a ausência dele, dita UMA vez. */}
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
              {semContato ? (
                <li className="flex items-center gap-1.5 text-destructive-texto">
                  <TriangleAlert className="size-3.5" aria-hidden="true" />
                  Sem canal de contato
                </li>
              ) : null}
              {/* A IA vira uma PASTILHA, não uma frase: é opinião, e o porquê
                  continua no `title` para quem quiser conferir. */}
              {candidato.ia_veredito ? (
                <li
                  title={candidato.ia_porque ?? undefined}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                >
                  <Sparkles className="size-3" aria-hidden="true" />
                  {candidato.ia_veredito === 'sim'
                    ? 'IA: é fornecedor'
                    : candidato.ia_veredito === 'nao'
                      ? 'IA: não é fornecedor'
                      : 'IA: não soube dizer'}
                </li>
              ) : null}
            </ul>

            {pendente && podeDecidir && !candidato.telefone && !candidato.nao_contatar ? (
              <div className="pt-1">
                <ProcurarTelefoneDoCandidato candidatoId={candidato.id} />
              </div>
            ) : null}

            {candidato.observacao ? (
              <p className="max-w-prose text-sm text-muted-foreground">{candidato.observacao}</p>
            ) : null}

            {marcas.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {marcas.map((marca) => {
                  const nota = EXPLICACAO_DA_MARCA[marca];
                  return (
                    <li key={marca} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        <span className="font-medium text-foreground">{nota?.rotulo ?? marca}</span>{' '}
                        {nota?.explicacao ?? 'Confira este dado antes de decidir.'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>

        {/* ------------------------------------------------ a decisão */}
        {pendente && podeDecidir ? (
          <div className="flex shrink-0 items-center gap-2 lg:pl-4">
            {/* VIRAR PARCEIRO É MENTA: é o "sim" desta tela, e a única ação que
                faz a base crescer. As outras duas viram discos com nome no
                `title` e no rótulo acessível — três botões largos por linha eram
                metade da poluição. */}
            <Button
              variant="menta"
              onClick={() => aoDecidir('aprovar')}
              disabled={ocupado || candidato.nao_contatar}
              className="toque h-11 px-4 md:h-9"
            >
              <Check aria-hidden="true" />
              Virar parceiro
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => aoDecidir('recusar')}
              disabled={ocupado}
              title="Descartar este nome"
              aria-label="Descartar este nome"
              className="toque size-11 md:size-9"
            >
              <X aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => aoDecidir('nao_contatar')}
              disabled={ocupado}
              title="Nunca procurar: a empresa pediu para não ser contatada"
              aria-label="Nunca procurar"
              className="toque size-11 text-muted-foreground md:size-9"
            >
              <CircleSlash aria-hidden="true" />
            </Button>
          </div>
        ) : candidato.organizacao_id ? (
          <Link
            href={`/parceiros/${candidato.organizacao_id}`}
            className={ALVO_INLINE + ' shrink-0 gap-1 text-sm underline underline-offset-4'}
          >
            Abrir a ficha
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      {candidato.nao_contatar && pendente ? (
        <p className="text-xs text-muted-foreground">
          Esta empresa pediu para não ser procurada. Não dá para virar parceiro.
        </p>
      ) : null}

      {/* Fichas parecidas: aqui a decisão é QUAL FICHA VENCE, e ela ganha a
          superfície de linha, dentro do cartão. */}
      {candidato.duplicatas.length > 0 ? (
        <section aria-label="Fichas parecidas na base" className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs font-medium">
            {candidato.duplicatas.length === 1
              ? 'Pode ser um parceiro que você já tem'
              : `Podem ser ${candidato.duplicatas.length} parceiros que você já tem`}
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
                    Juntar com este
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
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
