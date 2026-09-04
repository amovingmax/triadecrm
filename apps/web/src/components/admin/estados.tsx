'use client';

import { CircleAlert, Info, Lock, RotateCw, SearchX } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { formatarNumero } from './formatos';

/**
 * As peças repetidas da Admin: cabeçalho de seção, aviso, lista (tabela no desktop,
 * cartões no celular), espera, vazio, erro e "esta parte é só de admin".
 *
 * A lista é uma peça só, e não uma tabela por catálogo, porque a Admin tem dez listas
 * com a mesma gramática: poucas colunas, uma coluna principal, uma coluna de ação.
 * Escrever dez tabelas seria repetir dez vezes a decisão de como o celular se comporta
 * — e é justamente no celular que as tabelas quebram. Aqui a decisão é uma só: no
 * desktop, tabela com hairline entre linhas; no celular, cada linha vira um bloco com
 * rótulo e valor, sem nenhuma rolagem lateral.
 *
 * Nenhuma cor cromática entra aqui: a escala térmica é a única cromia do produto, e
 * nesta tela não há temperatura para ler. Estado é dito com palavra e com hairline.
 */

/**
 * Número mais palavra, com o número em IBM Plex Mono e a palavra na Poppins do resto
 * da interface. Envolver a frase inteira no utilitário `numerico` vestiria "ativos" e
 * "pela frente" com o traço da mono, que é fonte para alinhar dígito, não para
 * escrever texto corrido.
 */
export function Contagem({ n, rotulo }: { n: number; rotulo: string }) {
  return (
    <>
      <span className="numerico">{formatarNumero(n)}</span> {rotulo}
    </>
  );
}

export function CabecalhoDeSecao({
  titulo,
  descricao,
  contagem,
  acao,
}: {
  titulo: string;
  descricao: React.ReactNode;
  contagem?: React.ReactNode;
  acao?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h2 className="font-heading text-base font-semibold tracking-tight">
          {titulo}
          {contagem ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">{contagem}</span>
          ) : null}
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{descricao}</p>
      </div>
      {acao}
    </header>
  );
}

/**
 * Aviso em prosa. Sem cor: um retângulo tingido aqui competiria com a escala térmica,
 * e o que precisa ser lido é a frase, não a moldura.
 */
export function Aviso({
  titulo,
  children,
  tom = 'nota',
}: {
  titulo?: string;
  children: React.ReactNode;
  tom?: 'nota' | 'atencao';
}) {
  const Icone = tom === 'atencao' ? CircleAlert : Info;
  return (
    <div
      className={cn(
        'flex gap-3 rounded-lg bg-muted/60 p-3 text-sm leading-relaxed',
        tom === 'atencao' && 'ring-1 ring-foreground/15',
      )}
    >
      <Icone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        {titulo ? <p className="font-medium">{titulo}</p> : null}
        <div className="text-muted-foreground [&_strong]:text-foreground">{children}</div>
      </div>
    </div>
  );
}

export type ColunaAdmin<T> = {
  id: string;
  rotulo: string;
  /** Classe de largura da coluna no desktop (a tabela é `table-fixed`). */
  largura?: string;
  /** Coluna que dá nome à linha: vira o título do bloco no celular. */
  principal?: boolean;
  /** Some no celular (detalhe que não cabe no bloco). */
  soNoDesktop?: boolean;
  celula: (linha: T) => React.ReactNode;
};

export function ListaAdmin<T>({
  colunas,
  linhas,
  chave,
  acoes,
  larguraDasAcoes = 'w-44',
  rotuloDaLista,
}: {
  colunas: ColunaAdmin<T>[];
  linhas: T[];
  chave: (linha: T) => string | number;
  /** Botões da linha. Recebe a linha e devolve os controles, ou nada. */
  acoes?: (linha: T) => React.ReactNode;
  /** Largura da coluna de ação. Duas ações na mesma linha pedem mais que o padrão. */
  larguraDasAcoes?: string;
  rotuloDaLista: string;
}) {
  const principal = colunas.find((c) => c.principal) ?? colunas[0];
  const secundarias = colunas.filter((c) => c !== principal);

  return (
    <>
      {/* Desktop: tabela densa, separada por hairline (nunca borda cheia). */}
      <div className="hidden overflow-x-auto md:block">
        <table className="corpo-tabela w-full table-fixed text-sm">
          <caption className="sr-only">{rotuloDaLista}</caption>
          <thead>
            <tr className="border-b border-hairline">
              {colunas.map((coluna) => (
                <th
                  key={coluna.id}
                  scope="col"
                  className={cn(
                    'py-2 pr-3 text-left align-bottom text-xs font-medium text-muted-foreground',
                    coluna.largura,
                  )}
                >
                  {coluna.rotulo}
                </th>
              ))}
              {acoes ? (
                <th
                  scope="col"
                  className={cn('py-2 text-right text-xs font-medium', larguraDasAcoes)}
                >
                  <span className="sr-only">Ações</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={chave(linha)} className="border-b border-hairline last:border-0">
                {colunas.map((coluna) => (
                  <td key={coluna.id} className="py-2.5 pr-3 align-top">
                    {coluna.celula(linha)}
                  </td>
                ))}
                {acoes ? (
                  <td className="py-2.5 text-right align-top">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {acoes(linha)}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Celular: um bloco por linha, sem tabela e sem rolagem lateral. */}
      <ul className="md:hidden" aria-label={rotuloDaLista}>
        {linhas.map((linha) => (
          <li key={chave(linha)} className="border-b border-hairline py-3 last:border-0">
            <div className="font-medium">{principal ? principal.celula(linha) : null}</div>
            <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              {secundarias
                .filter((coluna) => !coluna.soNoDesktop)
                .map((coluna) => (
                  <div key={coluna.id} className="contents">
                    <dt className="text-xs text-muted-foreground">{coluna.rotulo}</dt>
                    <dd className="min-w-0">{coluna.celula(linha)}</dd>
                  </div>
                ))}
            </dl>
            {acoes ? <div className="mt-3 flex flex-wrap gap-2">{acoes(linha)}</div> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Espera no formato final: as mesmas linhas, com o mesmo respiro. */
export function EsqueletoLista({ linhas = 8, colunas = 4 }: { linhas?: number; colunas?: number }) {
  const larguras = ['w-40', 'w-24', 'w-32', 'w-20', 'w-36', 'w-28'];
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando.</span>
      <div className="hidden md:block">
        <div className="flex gap-3 border-b border-hairline py-2">
          {Array.from({ length: colunas }, (_, i) => (
            <Skeleton key={i} className={`h-3 ${larguras[i % larguras.length]}`} />
          ))}
        </div>
        {Array.from({ length: linhas }, (_, linha) => (
          <div key={linha} className="flex gap-3 border-b border-hairline py-3">
            {Array.from({ length: colunas }, (_, i) => (
              <Skeleton key={i} className={`h-4 ${larguras[(linha + i) % larguras.length]}`} />
            ))}
          </div>
        ))}
      </div>
      <div className="md:hidden">
        {Array.from({ length: Math.min(linhas, 5) }, (_, linha) => (
          <div key={linha} className="space-y-2 border-b border-hairline py-3">
            <Skeleton className={`h-4 ${larguras[linha % larguras.length]}`} />
            <Skeleton className="h-3 w-52" />
            <Skeleton className="h-3 w-36" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Moldura({
  icone,
  titulo,
  texto,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  texto: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icone}
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">{titulo}</p>
        <div className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
          {texto}
        </div>
      </div>
      {children}
    </div>
  );
}

export function Vazio({
  titulo,
  texto,
  children,
}: {
  titulo: string;
  texto: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Moldura
      icone={<SearchX className="size-5" aria-hidden="true" />}
      titulo={titulo}
      texto={texto}
    >
      {children}
    </Moldura>
  );
}

export function ErroDoPainel({ causa, aoTentar }: { causa: string; aoTentar: () => void }) {
  return (
    <Moldura
      icone={<RotateCw className="size-5" aria-hidden="true" />}
      titulo="Não deu para carregar"
      texto={`${causa} Se continuar, avise no grupo do time.`}
    >
      <Button variant="outline" onClick={aoTentar} className="toque h-11 md:h-9">
        <RotateCw aria-hidden="true" />
        Tentar de novo
      </Button>
    </Moldura>
  );
}

/**
 * A parte existe, funciona, e o seu papel não alcança. Não é erro: é o desenho de
 * acesso do produto (RF-ADM-01) aparecendo. O texto diz de quem é a parte e a quem
 * pedir, em vez de mostrar a mensagem crua da política do Postgres.
 */
export function PainelRestrito({ registro }: { registro: string }) {
  return (
    <Moldura
      icone={<Lock className="size-5" aria-hidden="true" />}
      titulo="Só para admin"
      texto={
        <>
          {registro} é visível apenas para quem tem o papel <strong>Admin</strong>. Se você precisa
          dessa informação, peça a Rafael, Luiz ou Matheus.
        </>
      }
    />
  );
}
