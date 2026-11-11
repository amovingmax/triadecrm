'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Building2, FileSpreadsheet, Plus, RotateCw, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ChipsDeSecao } from '@/components/ui/abas';
import { Skeleton } from '@/components/ui/skeleton';

import { LinhaDoCanalPro } from './anuncios-no-canal-pro';
import { CaminhoDoLead } from './caminho-do-lead';
import { CartaoDoAnuncio } from './cartao-do-anuncio';
import {
  carregarAnuncios,
  carregarCanalPro,
  carregarManuais,
  CHAVE_DO_CANAL_PRO,
  CHAVE_DOS_ANUNCIOS,
  CHAVE_DOS_MANUAIS,
} from './dados';
import { ImportarCanalPro } from './importar-canal-pro';
import { ImportarSistemaAtual } from './importar-sistema-atual';
import { formatarQuando } from './no-portal';
import { PainelCanalPro } from './painel-canal-pro';
import { estadoNoPortal, situacaoForaDoCrm, type EstadoNoPortal } from './regras-do-cartao';
import { ativoNoCanalPro } from './relatorio-canal-pro';
import { SecoesDosAnuncios } from './secoes';
import { rotuloDoDestaque, type Situacao, type SituacaoDoCanalPro } from './tipos';

/**
 * As abas com as palavras do Canal Pro (05/11/2026): cada anúncio cai na aba da
 * situação dele no portal (`estadoNoPortal`); os do relatório sem anúncio no CRM,
 * pela situação de lá. Inativo fica em "Não publicados", marcado como inativo.
 */
type Recorte = 'todos' | 'publicados' | 'nao_publicados' | 'rascunhos' | 'excluidos';
const ESTADO_DO_RECORTE: Partial<Record<Recorte, EstadoNoPortal>> = {
  publicados: 'publicado',
  nao_publicados: 'nao_publicado',
  rascunhos: 'rascunho',
};

/**
 * A lista de Anúncios (04/11/2026), só na Imova.
 *
 * Uma linha por anúncio, do mexido mais recente para o mais antigo, com o que
 * decide o próximo passo: o que falta para ir ao ar (rascunho), ou se o Grupo
 * OLX já leu a última mudança (no ar). O arquivo é lido a cada 12 horas, e a
 * tela diz isso em vez de prometer "publicado" na hora do clique.
 *
 * "No ar" mostra TUDO o que está no Canal Pro (decisão da noite de 04/11): os
 * anúncios do CRM e, embaixo, os que estão lá por fora do CRM, do relatório que
 * ele exporta (`importar-canal-pro.tsx`). Os do CRM saem do ar por aqui; os de
 * lá saem por onde entraram — o sistema que publica hoje ("Via Integração") ou
 * o próprio Canal Pro ("Via CanalPro") —, e a linha guia
 * (`anuncios-no-canal-pro.tsx`).
 *
 * O plano do Canal Pro fica contado no alto (vagas e destaques em uso, CRM e
 * manuais juntos), com a mesma conta que o banco usa para recusar a publicação
 * (migração 20261104180000).
 *
 * Os LEADS (05/11/2026) moram na seção ao lado (`/anuncios/leads`): o seletor no
 * alto leva a ela, e cada anúncio mostra quantos leads recebeu, com o atalho
 * para a lista só dos dele.
 *
 * Desde 05/11/2026 cada anúncio é um cartão no desenho do Canal Pro
 * (`cartao-do-anuncio.tsx`): o endereço como título, a nota de qualidade, a
 * situação com as palavras de lá e as ações no menu ⋮.
 */
export function TelaAnuncios({ podePublicar }: { podePublicar: boolean }) {
  const [recorte, setRecorte] = useState<Recorte>('todos');
  const [painelAberto, setPainelAberto] = useState(false);
  const [importarAberto, setImportarAberto] = useState(false);
  const excluidos = recorte === 'excluidos';

  const consulta = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'lista', excluidos],
    queryFn: () => carregarAnuncios(excluidos),
  });
  // Os do CRM, sempre, para ligar cada manual ao anúncio que veio dele.
  const doCrm = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'lista', false],
    queryFn: () => carregarAnuncios(false),
    enabled: excluidos,
  });
  const manuais = useQuery({ queryKey: CHAVE_DOS_MANUAIS, queryFn: carregarManuais });
  const canalPro = useQuery({ queryKey: CHAVE_DO_CANAL_PRO, queryFn: carregarCanalPro });

  const todos = useMemo(() => consulta.data ?? [], [consulta.data]);
  const ativos = useMemo(
    () => (excluidos ? (doCrm.data ?? []) : todos),
    [excluidos, doCrm.data, todos],
  );
  const listaManual = useMemo(() => manuais.data ?? [], [manuais.data]);
  // Com o mesmo código (ou ligado pelo "Trazer para o CRM"), o anúncio do CRM no
  // ar e a linha do relatório são um anúncio só no Canal Pro: conta uma vez,
  // como `app.canal_pro_ocupadas` (migração 20261105110000).
  // Só o que está ATIVO no Canal Pro está no ar lá (o relatório de verdade traz
  // os inativos também).
  const manuaisSemParNoAr = useMemo(() => {
    const noAr = ativos.filter((a) => a.situacao === 'no_ar');
    return listaManual.filter(
      (m) =>
        ativoNoCanalPro(m.situacao) &&
        !noAr.some((a) => a.codigo === m.codigo || a.id === m.anuncio_id),
    ).length;
  }, [ativos, listaManual]);
  // No portal por fora do CRM (sistema atual ou relatório) e não no ar NO CRM: o
  // arquivo do CRM não os leva, e o Canal Pro os tiraria do ar se passasse a
  // ler o arquivo do CRM agora. Os ajustes avisam antes de colar (06/11/2026).
  const aAssumir = useMemo(
    () =>
      ativos.filter(
        (a) => a.situacao !== 'no_ar' && !a.excluido_em && situacaoForaDoCrm(a) === 'ativo',
      ),
    [ativos],
  );
  // Na seção "No Canal Pro hoje" ficam só os que não têm cartão no CRM: a linha
  // com o mesmo código de um anúncio do CRM já aparece no cartão dele ("No Canal
  // Pro: Ativo"). Os ativos primeiro.
  const listaDoCanalPro = useMemo(
    () =>
      listaManual
        .filter((m) => !ativos.some((a) => a.codigo === m.codigo))
        .sort((x, y) => Number(ativoNoCanalPro(y.situacao)) - Number(ativoNoCanalPro(x.situacao))),
    [ativos, listaManual],
  );
  const inativosNoCanalPro = listaDoCanalPro.filter((m) => !ativoNoCanalPro(m.situacao)).length;
  const contagem = useMemo(() => {
    const c: Record<Situacao, number> = { rascunho: 0, no_ar: 0, pausado: 0 };
    for (const a of ativos) c[a.situacao] += 1;
    return c;
  }, [ativos]);
  const destaquesNoAr = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of ativos) {
      if (a.situacao === 'no_ar' && a.destaque !== 'padrao') {
        const r = rotuloDoDestaque(a.destaque);
        m.set(r, (m.get(r) ?? 0) + 1);
      }
    }
    return [...m.entries()];
  }, [ativos]);

  const porEstado = useMemo(() => {
    const c: Record<EstadoNoPortal, number> = { publicado: 0, nao_publicado: 0, rascunho: 0 };
    for (const a of ativos) c[estadoNoPortal(a)] += 1;
    return c;
  }, [ativos]);
  const ativosSoNoCanalPro = listaDoCanalPro.length - inativosNoCanalPro;
  const estadoDaAba = ESTADO_DO_RECORTE[recorte];
  const linhas =
    excluidos || recorte === 'todos'
      ? todos
      : todos.filter((a) => estadoNoPortal(a) === estadoDaAba);
  const mostraManuais =
    recorte === 'todos' || recorte === 'publicados' || recorte === 'nao_publicados';
  const listaDaAba =
    recorte === 'publicados'
      ? listaDoCanalPro.filter((m) => ativoNoCanalPro(m.situacao))
      : recorte === 'nao_publicados'
        ? listaDoCanalPro.filter((m) => !ativoNoCanalPro(m.situacao))
        : listaDoCanalPro;
  const ultimaLeitura = canalPro.data?.ultimaLeitura ?? null;
  const plano = canalPro.data?.plano ?? null;

  const vazio = linhas.length === 0 && (!mostraManuais || listaDaAba.length === 0);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <header className="flex flex-col gap-4">
        <SecoesDosAnuncios ativa="anuncios" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">
              Anúncios
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Os imóveis que sobem para o ZAP, o Viva Real e a OLX pelo Canal Pro. O Grupo OLX lê o
              arquivo do CRM a cada 12 horas: o que muda aqui aparece no portal depois da próxima
              leitura.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {podePublicar ? (
              <ImportarSistemaAtual
                temEndereco={canalPro.data?.sistemaAtual.temEndereco ?? false}
              />
            ) : null}
            {podePublicar ? (
              <Button
                variant="outline"
                className="toque h-11 md:h-9"
                onClick={() => setImportarAberto(true)}
              >
                <FileSpreadsheet aria-hidden="true" />
                Atualizar do Canal Pro
              </Button>
            ) : null}
            {/* O contato, o plano e o endereço do arquivo do CRM: ajustes que se
                fazem uma vez, fora do caminho de atualizar a lista (06/11/2026). */}
            <Button
              variant="outline"
              className="toque size-11 p-0 md:size-9"
              aria-label="Ajustes do Canal Pro"
              title="Ajustes do Canal Pro"
              onClick={() => setPainelAberto(true)}
            >
              <Settings2 aria-hidden="true" />
            </Button>
            <Button asChild className="toque h-11 md:h-9">
              <Link href="/anuncios/novo">
                <Plus aria-hidden="true" />
                Novo anúncio
              </Link>
            </Button>
          </div>
        </div>

        {/* O que falta para o primeiro lead dos portais (11/11/2026): só para quem
            publica, cola a URL e exclui os repetidos. */}
        {podePublicar ? (
          <CaminhoDoLead
            chave={canalPro.data?.chave ?? null}
            noPortalSoPeloSistemaAtual={aAssumir.length}
            aoImportar={() => setImportarAberto(true)}
          />
        ) : null}

        <ResumoDaIntegracao
          carregando={canalPro.isPending}
          ultimaLeitura={ultimaLeitura}
          semContato={canalPro.data ? !canalPro.data.email : false}
          noAr={contagem.no_ar}
          noCanalPro={manuaisSemParNoAr}
          destaques={destaquesNoAr}
          plano={canalPro.data?.plano ?? null}
          importadoEm={canalPro.data?.importadoEm ?? null}
          sistemaAtualLidoEm={canalPro.data?.sistemaAtual.lidoEm ?? null}
          podeImportar={podePublicar}
          aoAbrir={() => setPainelAberto(true)}
          aoImportar={() => setImportarAberto(true)}
        />

        <ChipsDeSecao<Recorte>
          rotulo="Que anúncios mostrar"
          ativo={recorte}
          aoTrocar={setRecorte}
          itens={[
            { id: 'todos', rotulo: 'Todos' },
            {
              id: 'publicados',
              rotulo: 'Publicados',
              contagem: porEstado.publicado + ativosSoNoCanalPro,
            },
            {
              id: 'nao_publicados',
              rotulo: 'Não publicados',
              contagem: porEstado.nao_publicado + inativosNoCanalPro,
            },
            { id: 'rascunhos', rotulo: 'Rascunhos', contagem: porEstado.rascunho },
            { id: 'excluidos', rotulo: 'Excluídos' },
          ]}
        />
      </header>

      {consulta.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Carregando os anúncios.</span>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[420px] w-full rounded-xl md:h-[232px]" />
          ))}
        </div>
      ) : consulta.isError ? (
        <Vazio titulo="A lista não carregou." texto="Não deu para falar com o servidor.">
          <Button
            variant="outline"
            onClick={() => void consulta.refetch()}
            className="toque h-11 md:h-9"
          >
            <RotateCw aria-hidden="true" />
            Tentar de novo
          </Button>
        </Vazio>
      ) : vazio ? (
        excluidos ? (
          <Vazio
            titulo="Nenhum anúncio excluído."
            texto="O anúncio excluído sai do arquivo do Canal Pro e vem para cá."
          />
        ) : recorte === 'todos' || recorte === 'publicados' ? (
          <Vazio
            titulo={
              recorte === 'publicados' ? 'Nenhum anúncio publicado.' : 'Nenhum anúncio ainda.'
            }
            texto="Crie um anúncio pelo CRM ou traga a lista do que já está no Canal Pro."
          >
            <div className="flex flex-wrap gap-2">
              <Button asChild className="toque h-11 md:h-9">
                <Link href="/anuncios/novo">
                  <Plus aria-hidden="true" />
                  Novo anúncio
                </Link>
              </Button>
              {podePublicar ? (
                <Button
                  variant="outline"
                  className="toque h-11 md:h-9"
                  onClick={() => setImportarAberto(true)}
                >
                  <FileSpreadsheet aria-hidden="true" />
                  Trazer a lista do Canal Pro
                </Button>
              ) : null}
            </div>
          </Vazio>
        ) : (
          <Vazio
            titulo={`Nenhum anúncio em "${rotuloDoRecorte(recorte)}".`}
            texto="Troque o filtro acima para ver os outros."
          />
        )
      ) : (
        <>
          {linhas.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {linhas.map((a) => (
                <CartaoDoAnuncio key={a.id} anuncio={a} podePublicar={podePublicar} plano={plano} />
              ))}
            </ul>
          ) : null}

          {mostraManuais && listaDaAba.length > 0 ? (
            <section className="flex flex-col gap-2">
              <div>
                <h2 className="text-base font-medium">
                  {recorte === 'nao_publicados'
                    ? 'Inativos no Canal Pro, sem anúncio no CRM'
                    : recorte === 'publicados'
                      ? 'Ativos no Canal Pro, sem anúncio no CRM'
                      : 'No Canal Pro, sem anúncio no CRM'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Vêm de anúncios antigos, do sistema que publica hoje (Via Integração) ou foram
                  cadastrados no Canal Pro. Do relatório importado{' '}
                  {canalPro.data?.importadoEm ? formatarQuando(canalPro.data.importadoEm) : ''}. O
                  repetido de um anúncio do CRM tem o botão Excluir duplicado; os outros dizem como
                  sair do ar.
                </p>
              </div>
              <ul className="sombra-base flex flex-col divide-y divide-hairline overflow-hidden rounded-xl bg-card">
                {listaDaAba.map((m) => (
                  <LinhaDoCanalPro
                    key={m.id}
                    anuncio={m}
                    trazido={ativos.find((a) => a.id === m.anuncio_id) ?? null}
                    pareceCom={ativos.find((a) => a.id === m.parece_com) ?? null}
                    podePublicar={podePublicar}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <PainelCanalPro
        aberto={painelAberto}
        aoMudar={setPainelAberto}
        podeAjustar={podePublicar}
        aAssumir={aAssumir}
        soNoCanalProNoAr={ativosSoNoCanalPro}
      />
      {podePublicar ? (
        <ImportarCanalPro aberto={importarAberto} aoMudar={setImportarAberto} />
      ) : null}
    </div>
  );
}

function rotuloDoRecorte(r: Recorte): string {
  if (r === 'todos') return 'Todos';
  if (r === 'excluidos') return 'Excluídos';
  if (r === 'publicados') return 'Publicados';
  if (r === 'nao_publicados') return 'Não publicados';
  return 'Rascunhos';
}

function ResumoDaIntegracao({
  carregando,
  ultimaLeitura,
  semContato,
  noAr,
  noCanalPro,
  destaques,
  plano,
  importadoEm,
  sistemaAtualLidoEm,
  podeImportar,
  aoAbrir,
  aoImportar,
}: {
  carregando: boolean;
  ultimaLeitura: { em: string; anuncios: number } | null;
  semContato: boolean;
  noAr: number;
  noCanalPro: number;
  destaques: [string, number][];
  plano: SituacaoDoCanalPro['plano'] | null;
  importadoEm: string | null;
  sistemaAtualLidoEm: string | null;
  podeImportar: boolean;
  aoAbrir: () => void;
  aoImportar: () => void;
}) {
  if (carregando) return <Skeleton className="h-11 w-full max-w-2xl rounded-xl" />;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
          {semContato ? (
            <button
              type="button"
              onClick={aoAbrir}
              className="text-left underline underline-offset-4"
            >
              Falta ligar a integração com o Canal Pro.
            </button>
          ) : ultimaLeitura ? (
            <span>
              Última leitura do Grupo OLX {formatarQuando(ultimaLeitura.em)}, com{' '}
              <span className="numerico">{ultimaLeitura.anuncios}</span>{' '}
              {ultimaLeitura.anuncios === 1 ? 'anúncio' : 'anúncios'}.
            </span>
          ) : (
            <button
              type="button"
              onClick={aoAbrir}
              className="text-left underline underline-offset-4"
            >
              O Grupo OLX ainda não leu o arquivo. Veja como ligar.
            </button>
          )}
        </span>
        {plano?.anuncios != null ? (
          <span className={plano.anunciosEmUso >= plano.anuncios ? 'font-medium' : undefined}>
            {plano.anunciosEmUso >= plano.anuncios ? 'Plano cheio: ' : 'Plano: '}
            <span className="numerico">{plano.anunciosEmUso}</span> de{' '}
            <span className="numerico">{plano.anuncios}</span> vagas
            {plano.destaques != null ? (
              <>
                {' · '}
                <span className="numerico">{plano.destaquesEmUso}</span> de{' '}
                <span className="numerico">{plano.destaques}</span> destaques
              </>
            ) : null}
          </span>
        ) : null}
        <span className="text-muted-foreground">
          <span className="numerico">{noAr}</span> no ar pelo CRM
          {destaques.map(([rotulo, n]) => (
            <span key={rotulo}>
              {' · '}
              <span className="numerico">{n}</span> {rotulo.toLowerCase()}
            </span>
          ))}
          {noCanalPro ? (
            <>
              {' · '}
              <span className="numerico">{noCanalPro}</span> no Canal Pro por fora do CRM
            </>
          ) : null}
        </span>
      </div>
      <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
        <FileSpreadsheet className="size-4" aria-hidden="true" />
        {importadoEm
          ? `Lista do Canal Pro importada ${formatarQuando(importadoEm)}.`
          : 'Os anúncios que já estão no Canal Pro ainda não aparecem aqui.'}
        {podeImportar ? (
          <button
            type="button"
            onClick={aoImportar}
            className="text-foreground underline underline-offset-4"
          >
            {importadoEm ? 'Atualizar de novo' : 'Trazer a lista do Canal Pro'}
          </button>
        ) : null}
        {sistemaAtualLidoEm ? (
          <span>· Sistema atual lido {formatarQuando(sistemaAtualLidoEm)}.</span>
        ) : null}
      </span>
    </div>
  );
}

function Vazio({
  titulo,
  texto,
  children,
}: {
  titulo: string;
  texto: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sombra-base flex flex-col items-start gap-3 rounded-xl bg-card p-5">
      <div>
        <p className="font-medium">{titulo}</p>
        <p className="text-sm text-muted-foreground">{texto}</p>
      </div>
      {children}
    </div>
  );
}
