'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Layers,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Settings2,
  UserRound,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ChipsDeSecao } from '@/components/ui/abas';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import {
  casaComABusca,
  estadoDoCartao,
  itensDeAtencao,
  juntarDoCanalPro,
  naoPublicadoPronto,
} from './aba-dos-anuncios';
import { LinhaDoCanalPro } from './anuncios-no-canal-pro';
import { CartaoDoAnuncio } from './cartao-do-anuncio';
import {
  carregarAnuncios,
  carregarCaminhoDoLead,
  carregarCanalPro,
  carregarListaDoCanalPro,
  carregarManuais,
  CHAVE_DA_LISTA_DO_CANAL_PRO,
  CHAVE_DO_CAMINHO,
  CHAVE_DO_CANAL_PRO,
  CHAVE_DOS_ANUNCIOS,
  CHAVE_DOS_MANUAIS,
} from './dados';
import { FichaDoAnuncio } from './ficha-do-anuncio';
import { FolhaSincronizar } from './folha-sincronizar';
import { ImportarCanalPro } from './importar-canal-pro';
import { resumoDosTipos } from './leads/leads-rotulos';
import { NovoAnuncioConferido } from './novo-anuncio-conferido';
import { PainelCanalPro } from './painel-canal-pro';
import { diasDeCalendario, haQuanto } from './passos-do-caminho';
import { PrecisaDeVoce } from './precisa-de-voce';
import { estadoNoPortal, situacaoForaDoCrm, type EstadoNoPortal } from './regras-do-cartao';
import { ativoNoCanalPro } from './relatorio-canal-pro';
import { SecoesDosAnuncios } from './secoes';
import { TrocaDaArbo } from './troca-da-arbo';

/** As abas com as palavras do Canal Pro (05/11/2026). */
type Recorte = 'todos' | 'publicados' | 'nao_publicados' | 'rascunhos' | 'excluidos';
const ESTADO_DO_RECORTE: Partial<Record<Recorte, EstadoNoPortal>> = {
  publicados: 'publicado',
  nao_publicados: 'nao_publicado',
  rascunhos: 'rascunho',
};
/** Os filtros que vêm de um botão (da troca ou do "Precisa de você"). */
type Filtro = 'arbo' | 'prontos';
const ROTULO_DO_FILTRO: Record<Filtro, string> = {
  arbo: 'Só os publicados pela Arbo',
  prontos: 'Só os não publicados prontos para ir ao ar',
};

/** Mais que isso sem a lista do Canal Pro, o número fica em alerta. */
const DIAS_DA_LISTA = 7;

/**
 * A aba Anúncios (04/11/2026; redesenhada em 18/11/2026), só na Imova.
 *
 * O pedido de 18/11: "tem muita informação repetida entrando no CRM ... a ideia é
 * deixar a aba de anúncios cada vez menos repetitiva, mais objetiva, mais clara e
 * mais funcional". Aprovado pelo protótipo no mesmo dia. De cima para baixo:
 *
 *   1. Três números: as vagas do plano, os leads dos portais e a última lista do
 *      Canal Pro (com o "Sincronizar"). Cada número aparece uma vez só na tela.
 *   2. A troca da Arbo pelo CRM, só com o passo atual (`troca-da-arbo.tsx`).
 *   3. "Precisa de você": uma linha por pendência, com a ação.
 *   4. A busca, as abas com as palavras do Canal Pro e a lista: UM CARTÃO POR
 *      IMÓVEL, com o que o Canal Pro diz dele e as cópias antigas juntadas
 *      (`aba-dos-anuncios.ts`). O clique abre a ficha por cima.
 *
 * Saíram do cabeçalho "Atualizar do sistema atual" e "Atualizar do Canal Pro":
 * viraram "Sincronizar Canal Pro", e os dois jeitos de antes moram dentro dele.
 * A lista "No Canal Pro, sem anúncio no CRM" ficou só para o que não tem cartão
 * nem é cópia de um.
 */
export function TelaAnuncios({ podePublicar }: { podePublicar: boolean }) {
  const [recorte, setRecorte] = useState<Recorte>('todos');
  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [busca, setBusca] = useState('');
  const [fichaDe, setFichaDe] = useState<string | null>(null);
  const [painelAberto, setPainelAberto] = useState(false);
  const [planilhaAberta, setPlanilhaAberta] = useState(false);
  const [sincronizarAberto, setSincronizarAberto] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);
  const excluidos = recorte === 'excluidos';

  const consulta = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'lista', excluidos],
    queryFn: () => carregarAnuncios(excluidos),
  });
  // Os do CRM, sempre: os números, o "Precisa de você" e a troca contam com eles.
  const doCrm = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'lista', false],
    queryFn: () => carregarAnuncios(false),
    enabled: excluidos,
  });
  // Os excluídos, sempre: o código deles não volta pela sincronização, então a
  // linha do Canal Pro com esse código não é "sem cartão" (revisão de 18/11/2026).
  const excluidosSempre = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'lista', true],
    queryFn: () => carregarAnuncios(true),
    enabled: !excluidos,
  });
  const listaDoCanalPro = useQuery({
    queryKey: CHAVE_DA_LISTA_DO_CANAL_PRO,
    queryFn: carregarListaDoCanalPro,
  });
  const manuais = useQuery({ queryKey: CHAVE_DOS_MANUAIS, queryFn: carregarManuais });
  const canalPro = useQuery({ queryKey: CHAVE_DO_CANAL_PRO, queryFn: carregarCanalPro });

  const todos = useMemo(() => consulta.data ?? [], [consulta.data]);
  const ativos = useMemo(
    () => (excluidos ? (doCrm.data ?? []) : todos),
    [excluidos, doCrm.data, todos],
  );
  const listaDeExcluidos = useMemo(
    () => (excluidos ? todos : (excluidosSempre.data ?? [])),
    [excluidos, todos, excluidosSempre.data],
  );
  const { porAnuncio, soltas } = useMemo(
    () => juntarDoCanalPro([...ativos, ...listaDeExcluidos], listaDoCanalPro.data ?? []),
    [ativos, listaDeExcluidos, listaDoCanalPro.data],
  );
  const plano = canalPro.data?.plano ?? null;
  const vagasLivres =
    plano?.anuncios != null ? Math.max(0, plano.anuncios - plano.anunciosEmUso) : null;
  const itens = useMemo(
    () =>
      podePublicar ? itensDeAtencao({ anuncios: ativos, porAnuncio, soltas, vagasLivres }) : [],
    [podePublicar, ativos, porAnuncio, soltas, vagasLivres],
  );
  // No portal por fora do CRM e não no ar no CRM: a troca os tiraria do ar.
  const aAssumir = useMemo(
    () =>
      ativos.filter(
        (a) => a.situacao !== 'no_ar' && !a.excluido_em && situacaoForaDoCrm(a) === 'ativo',
      ),
    [ativos],
  );
  const porEstado = useMemo(() => {
    const c: Record<EstadoNoPortal, number> = { publicado: 0, nao_publicado: 0, rascunho: 0 };
    for (const a of ativos) c[estadoNoPortal(a)] += 1;
    return c;
  }, [ativos]);

  const estadoDaAba = ESTADO_DO_RECORTE[recorte];
  const linhas = todos.filter(
    (a) =>
      (excluidos || recorte === 'todos' || estadoNoPortal(a) === estadoDaAba) &&
      (filtro !== 'arbo' || estadoDoCartao(a).tom === 'arbo') &&
      (filtro !== 'prontos' || naoPublicadoPronto(a)) &&
      casaComABusca(a, porAnuncio.get(a.id)?.copias ?? [], busca),
  );
  const soltasNaLista = (manuais.data ?? []).filter(
    (m) =>
      soltas.some((s) => s.id === m.id) &&
      !excluidos &&
      filtro === null &&
      (recorte === 'todos' ||
        (recorte === 'publicados' && ativoNoCanalPro(m.situacao)) ||
        (recorte === 'nao_publicados' && !ativoNoCanalPro(m.situacao))) &&
      casaComABusca(
        { codigo: m.codigo, titulo: m.titulo ?? '', bairro: m.bairro, cidade: m.cidade },
        [],
        busca,
      ),
  );
  const ficha = fichaDe
    ? ([...ativos, ...todos, ...listaDeExcluidos].find((a) => a.id === fichaDe) ?? null)
    : null;

  function irParaALista() {
    requestAnimationFrame(() =>
      document
        .getElementById('lista-de-anuncios')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }

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
              Os imóveis da Imova no ZAP, Viva Real e OLX. Um cartão por imóvel, com o que vem da
              Arbo e do Canal Pro junto.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {podePublicar ? (
              <Button
                variant="outline"
                className="toque h-11 md:h-9"
                onClick={() => setSincronizarAberto(true)}
              >
                <RefreshCw aria-hidden="true" />
                Sincronizar Canal Pro
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="toque size-11 p-0 md:size-9"
              aria-label="Ajustes do Canal Pro"
              title="Ajustes do Canal Pro"
              onClick={() => setPainelAberto(true)}
            >
              <Settings2 aria-hidden="true" />
            </Button>
            <Button className="toque h-11 md:h-9" onClick={() => setNovoAberto(true)}>
              <Plus aria-hidden="true" />
              Novo anúncio
            </Button>
          </div>
        </div>
      </header>

      <Numeros
        carregando={canalPro.isPending}
        plano={plano}
        importadoEm={canalPro.data?.importadoEm ?? null}
        leadsDosAnuncios={ativos.reduce((s, a) => s + a.leads, 0)}
        podePublicar={podePublicar}
        aoSincronizar={() => setSincronizarAberto(true)}
      />

      {podePublicar ? (
        <TrocaDaArbo
          chave={canalPro.data?.chave ?? null}
          noPortalSoPeloSistemaAtual={aAssumir.length}
          aoVerNaLista={() => {
            setRecorte('todos');
            setFiltro('arbo');
            setBusca('');
            irParaALista();
          }}
        />
      ) : null}

      {podePublicar && !consulta.isPending && !listaDoCanalPro.isPending ? (
        <PrecisaDeVoce
          itens={itens}
          aoSincronizar={() => setSincronizarAberto(true)}
          aoAbrir={setFichaDe}
          aoFiltrarProntos={() => {
            setRecorte('todos');
            setFiltro('prontos');
            setBusca('');
            irParaALista();
          }}
        />
      ) : null}

      <section
        id="lista-de-anuncios"
        aria-label="Lista de anúncios"
        className="flex scroll-mt-20 flex-col gap-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex h-11 min-w-0 flex-1 basis-60 items-center gap-2 rounded-full border border-input bg-card px-4 md:h-9 md:max-w-sm">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Código, título ou bairro"
              aria-label="Buscar anúncio"
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <ChipsDeSecao<Recorte>
            rotulo="Que anúncios mostrar"
            ativo={recorte}
            aoTrocar={(r) => {
              setRecorte(r);
              setFiltro(null);
            }}
            itens={[
              { id: 'todos', rotulo: 'Todos' },
              { id: 'publicados', rotulo: 'Publicados', contagem: porEstado.publicado },
              { id: 'nao_publicados', rotulo: 'Não publicados', contagem: porEstado.nao_publicado },
              { id: 'rascunhos', rotulo: 'Rascunhos', contagem: porEstado.rascunho },
              { id: 'excluidos', rotulo: 'Excluídos' },
            ]}
          />
        </div>
        {filtro ? (
          <p className="flex items-center gap-2 text-sm">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary/12 pr-1 pl-3 font-medium text-primary">
              {ROTULO_DO_FILTRO[filtro]}
              <button
                type="button"
                onClick={() => setFiltro(null)}
                aria-label="Tirar o filtro"
                className="toque grid size-7 place-items-center rounded-full outline-none hover:bg-primary/15 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </span>
          </p>
        ) : null}

        {consulta.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <span className="sr-only">Carregando os anúncios.</span>
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-[380px] w-full rounded-xl md:h-[180px]" />
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
        ) : linhas.length === 0 && soltasNaLista.length === 0 ? (
          excluidos ? (
            <Vazio
              titulo="Nenhum anúncio excluído."
              texto="O anúncio excluído sai do arquivo do Canal Pro e fica aqui para restaurar."
            />
          ) : busca.trim() || filtro ? (
            <Vazio
              titulo={
                busca.trim() ? `Nada encontrado para “${busca.trim()}”.` : 'Nada neste filtro.'
              }
              texto="Troque a busca ou tire o filtro."
            />
          ) : (
            <Vazio
              titulo={recorte === 'todos' ? 'Nenhum anúncio ainda.' : 'Nenhum anúncio nesta aba.'}
              texto="Crie um anúncio pelo CRM ou sincronize com o Canal Pro."
            >
              <Button className="toque h-11 w-fit md:h-9" onClick={() => setNovoAberto(true)}>
                <Plus aria-hidden="true" />
                Novo anúncio
              </Button>
            </Vazio>
          )
        ) : (
          <>
            {linhas.length ? (
              <ul className="flex flex-col gap-3">
                {linhas.map((a) => (
                  <CartaoDoAnuncio
                    key={a.id}
                    anuncio={a}
                    doCanalPro={porAnuncio.get(a.id)}
                    podePublicar={podePublicar}
                    plano={plano}
                    aoAbrir={() => setFichaDe(a.id)}
                    aoSincronizar={() => setSincronizarAberto(true)}
                  />
                ))}
              </ul>
            ) : null}
            {soltasNaLista.length ? (
              <section className="flex flex-col gap-2">
                <h2 className="flex items-center gap-1.5 text-base font-medium">
                  <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
                  No Canal Pro, sem cartão no CRM
                </h2>
                <p className="text-sm text-muted-foreground">
                  Não são cópia de nenhum anúncio do CRM. A sincronização os traz com as fotos; aqui
                  dá para trazer um por um.
                </p>
                <ul className="sombra-base flex flex-col divide-y divide-hairline overflow-hidden rounded-xl bg-card">
                  {soltasNaLista.map((m) => (
                    <LinhaDoCanalPro
                      key={m.id}
                      anuncio={m}
                      trazido={ativos.find((a) => a.id === m.anuncio_id) ?? null}
                      pareceCom={null}
                      podePublicar={podePublicar}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </section>

      <FichaDoAnuncio
        anuncio={ficha}
        doCanalPro={ficha ? porAnuncio.get(ficha.id) : undefined}
        podePublicar={podePublicar}
        aoMudar={(aberto) => {
          if (!aberto) setFichaDe(null);
        }}
        aoSincronizar={() => {
          setFichaDe(null);
          setSincronizarAberto(true);
        }}
      />
      <PainelCanalPro
        aberto={painelAberto}
        aoMudar={setPainelAberto}
        podeAjustar={podePublicar}
        aAssumir={aAssumir}
        soNoCanalProNoAr={soltas.filter((s) => ativoNoCanalPro(s.situacao)).length}
      />
      <NovoAnuncioConferido
        aberto={novoAberto}
        aoMudar={setNovoAberto}
        anuncios={[...ativos, ...listaDeExcluidos]}
        aoAbrir={setFichaDe}
      />
      {podePublicar ? (
        <>
          <FolhaSincronizar
            aberto={sincronizarAberto}
            aoMudar={setSincronizarAberto}
            sincronizadoEm={canalPro.data?.importadoEm ?? null}
            temEnderecoDoSistemaAtual={canalPro.data?.sistemaAtual.temEndereco ?? false}
            aoAbrirPlanilha={() => setPlanilhaAberta(true)}
          />
          <ImportarCanalPro aberto={planilhaAberta} aoMudar={setPlanilhaAberta} />
        </>
      ) : null}
    </div>
  );
}

/**
 * Os três números do alto. Cada um aparece uma vez só na tela: as vagas não se
 * repetem na troca, a lista do Canal Pro não se repete no "Precisa de você".
 */
function Numeros({
  carregando,
  plano,
  importadoEm,
  leadsDosAnuncios,
  podePublicar,
  aoSincronizar,
}: {
  carregando: boolean;
  plano: {
    anuncios: number | null;
    destaques: number | null;
    anunciosEmUso: number;
    destaquesEmUso: number;
  } | null;
  importadoEm: string | null;
  leadsDosAnuncios: number;
  podePublicar: boolean;
  aoSincronizar: () => void;
}) {
  const caminho = useQuery({
    queryKey: CHAVE_DO_CAMINHO,
    queryFn: carregarCaminhoDoLead,
    enabled: podePublicar,
  });
  if (carregando) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
    );
  }
  const agora = new Date();
  const dias = importadoEm ? diasDeCalendario(importadoEm, agora) : null;
  const velha = dias === null || dias > DIAS_DA_LISTA;
  const leads = caminho.data?.leads;
  const total = leads?.total ?? leadsDosAnuncios;
  const ultimo = leads?.ultimo ?? null;
  const cheio = plano?.anuncios != null && plano.anunciosEmUso >= plano.anuncios;

  return (
    <section aria-label="Situação" className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="sombra-base flex flex-col gap-1.5 rounded-xl bg-card px-4 py-3.5">
        <p className="text-[13px] text-muted-foreground">Vagas do plano no portal</p>
        {plano?.anuncios != null ? (
          <>
            <p
              className={cn(
                'font-heading text-2xl leading-tight font-semibold',
                cheio && 'text-destructive-texto',
              )}
            >
              <span className="numerico">{plano.anunciosEmUso}</span>{' '}
              <span className="text-sm font-medium text-muted-foreground">de {plano.anuncios}</span>
            </p>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary"
                style={{
                  width: `${Math.min(100, (plano.anunciosEmUso / Math.max(1, plano.anuncios)) * 100)}%`,
                }}
              />
            </span>
            {plano.destaques != null ? (
              <p className="text-[13px] text-muted-foreground numerico">
                {plano.destaquesEmUso} de {plano.destaques} destaques
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">O plano não está no CRM (Ajustes).</p>
        )}
      </div>

      <Link
        href="/anuncios/leads"
        className="sombra-base flex flex-col gap-1.5 rounded-xl bg-card px-4 py-3.5 outline-none hover:ring-1 hover:ring-border focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <UserRound className="size-3.5" aria-hidden="true" />
          Leads dos portais
        </p>
        <p className="font-heading text-2xl leading-tight font-semibold numerico">{total}</p>
        <p className="text-[13px] text-muted-foreground">
          {ultimo
            ? `Último ${haQuanto(ultimo.em, agora)}${ultimo.anuncio ? ` · ${ultimo.anuncio}` : ''} · ${resumoDosTipos(ultimo.tipos).toLowerCase()}`
            : 'Nenhum lead dos portais ainda.'}
        </p>
        <span className="mt-auto inline-flex items-center gap-1 text-[13px] font-medium text-primary">
          Ver os leads <ArrowRight className="size-3.5" aria-hidden="true" />
        </span>
      </Link>

      <div className="sombra-base flex flex-col gap-1.5 rounded-xl bg-card px-4 py-3.5">
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Última lista do Canal Pro
        </p>
        <p
          className={cn(
            'font-heading text-2xl leading-tight font-semibold',
            velha && 'text-morno-texto',
          )}
        >
          {dias === null ? 'nunca' : dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`}
        </p>
        <p className="text-[13px] text-muted-foreground">
          Situação, visualizações, contatos e fotos de tudo o que está lá.
        </p>
        {podePublicar ? (
          <button
            type="button"
            onClick={aoSincronizar}
            className="mt-auto inline-flex w-fit items-center gap-1 rounded-sm text-[13px] font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {velha ? 'Sincronizar agora' : 'Sincronizar'}{' '}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </section>
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
