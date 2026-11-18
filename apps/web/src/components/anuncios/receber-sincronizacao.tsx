'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Camera,
  CircleCheck,
  Layers,
  LogOut,
  Plus,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import {
  carregarAnuncios,
  carregarListaDoCanalPro,
  CHAVE_DA_LISTA_DO_CANAL_PRO,
  CHAVE_DO_CAMINHO,
  CHAVE_DO_CANAL_PRO,
  CHAVE_DOS_ANUNCIOS,
  CHAVE_DOS_MANUAIS,
  importarRelatorio,
  trazerFotosDoCanalPro,
} from './dados';
import { fraseDaFoto } from './importacao-dados';
import {
  conferir,
  type FotosParaTrazer,
  fotosQueVem,
  lerPacote,
  type PacoteDoCanalPro,
} from './sincronizar-canal-pro';
import { fraseDaRecusa, URL_DO_CANAL_PRO } from './tipos';

type Fim = {
  anuncios: number;
  trazidos: number;
  fotos: number;
  comFoto: number;
  falhas: string[];
};

/**
 * A aba que o favorito "Imova: sincronizar" abre (18/11/2026): tira a lista do
 * fragmento do endereço, confere com o que o CRM já tem e só grava no "Aplicar".
 * Gravar é a importação do relatório (`canal_pro_importar`, que também traz para
 * o CRM o que só existe no Canal Pro e não é cópia de nenhum anúncio) e, depois,
 * as fotos de cada anúncio, uma por vez, pela rota que baixa no servidor.
 */
/**
 * O último fragmento que chegou, guardado: a tela o tira do endereço logo depois
 * (para o pacote não ficar no histórico nem ser aplicado de novo ao recarregar),
 * e a leitura seguinte o acharia vazio (o React, em desenvolvimento, monta duas
 * vezes). Um fragmento novo no endereço vale por cima; depois de aplicar, a
 * memória é limpa. Mesmo jeito da tela de fotos de 09/11.
 */
let fragmentoGuardado = '';
const semInscricao = () => () => {};
const lerFragmento = () => {
  const agora = window.location.hash;
  if (agora && agora !== fragmentoGuardado) fragmentoGuardado = agora;
  return fragmentoGuardado;
};
const fragmentoNoServidor = () => null;

export function ReceberSincronizacao() {
  const cliente = useQueryClient();
  const fragmento = useSyncExternalStore(semInscricao, lerFragmento, fragmentoNoServidor);
  const pacote: PacoteDoCanalPro | null | 'lendo' = useMemo(
    () => (fragmento === null ? 'lendo' : lerPacote(fragmento)),
    [fragmento],
  );
  const [sem, setSem] = useState<Set<string>>(new Set());
  const [gravando, setGravando] = useState<string | null>(null);
  const [fim, setFim] = useState<Fim | null>(null);

  // Lido o pacote, ele sai do endereço (fica na memória da aba até aplicar).
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  const doCrm = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'lista', false],
    queryFn: () => carregarAnuncios(false),
  });
  const excluidos = useQuery({
    queryKey: [...CHAVE_DOS_ANUNCIOS, 'lista', true],
    queryFn: () => carregarAnuncios(true),
  });
  const lista = useQuery({
    queryKey: CHAVE_DA_LISTA_DO_CANAL_PRO,
    queryFn: carregarListaDoCanalPro,
  });

  const conferencia = useMemo(() => {
    if (!pacote || pacote === 'lendo' || !doCrm.data || !excluidos.data || !lista.data) return null;
    return conferir(pacote, [...doCrm.data, ...excluidos.data], lista.data);
  }, [pacote, doCrm.data, excluidos.data, lista.data]);

  // Depois de aplicar, o resultado vale por cima de tudo: o fragmento já saiu da
  // memória, e as listas recarregam por baixo.
  if (fim) return <ResultadoDaSincronizacao fim={fim} />;

  if (
    pacote === 'lendo' ||
    (pacote && (doCrm.isPending || excluidos.isPending || lista.isPending))
  ) {
    return <Skeleton className="h-96 w-full max-w-3xl rounded-xl" />;
  }
  if (!pacote) {
    return (
      <Moldura>
        <div className="sombra-base flex flex-col items-start gap-3 rounded-xl bg-card p-5 text-sm">
          <p className="font-medium">Nenhuma lista do Canal Pro chegou por aqui.</p>
          <p className="text-muted-foreground">
            Esta página recebe o que o favorito “Imova: sincronizar” manda. Abra o Canal Pro em Meus
            anúncios e clique no favorito. Se ainda não guardou o favorito, ele está em Anúncios →
            Sincronizar Canal Pro.
          </p>
          <Button asChild variant="outline" className="toque h-11 md:h-9">
            <a href={URL_DO_CANAL_PRO} target="_blank" rel="noopener noreferrer">
              Abrir o Canal Pro
            </a>
          </Button>
        </div>
      </Moldura>
    );
  }
  if (doCrm.isError || excluidos.isError || lista.isError || !conferencia) {
    return (
      <Moldura>
        <p className="text-sm text-muted-foreground">
          Os anúncios do CRM não carregaram. Recarregue a página do Canal Pro e clique de novo no
          favorito.
        </p>
      </Moldura>
    );
  }

  const c = conferencia;
  const faltouPagina = c.total !== null && pacote.anuncios.length < c.total;
  const fotosMarcadas = c.fotos.filter((f) => !sem.has(f.codigo));
  const quantasFotos = fotosQueVem({ fotos: fotosMarcadas });

  async function aplicar() {
    setGravando('Gravando a lista do Canal Pro...');
    const r = await importarRelatorio(c.linhas);
    if (!r.ok) {
      setGravando(null);
      toast.error('A lista não foi gravada.', { description: fraseDaRecusa(r.motivo) });
      return;
    }
    // Os novos só têm cartão depois de gravar: acha cada um pelo código.
    let ids = new Map<string, string>();
    if (fotosMarcadas.some((f) => f.anuncioId === null)) {
      const agora = await carregarAnuncios(false).catch(() => []);
      ids = new Map(agora.map((a) => [a.codigo, a.id]));
    }
    const falhas: string[] = [];
    let fotos = 0;
    let comFoto = 0;
    for (const [i, f] of fotosMarcadas.entries()) {
      const id = f.anuncioId ?? ids.get(f.codigo) ?? null;
      if (!id) continue;
      setGravando(`Levando as fotos: ${f.codigo} (${i + 1} de ${fotosMarcadas.length})...`);
      const t = await trazerFotosDoCanalPro(id, f.urls, f.modo);
      if (!t.ok) {
        falhas.push(`${f.codigo}: ${fraseDaFoto(t.motivo)}`);
        continue;
      }
      if (t.vieram > 0) {
        fotos += t.vieram;
        comFoto += 1;
      }
      if (t.falharam > 0) {
        falhas.push(
          `${f.codigo}: ${t.falharam} ${t.falharam === 1 ? 'foto não veio' : 'fotos não vieram'}`,
        );
      }
    }
    for (const chave of [
      CHAVE_DOS_ANUNCIOS,
      CHAVE_DA_LISTA_DO_CANAL_PRO,
      CHAVE_DOS_MANUAIS,
      CHAVE_DO_CANAL_PRO,
      CHAVE_DO_CAMINHO,
    ]) {
      void cliente.invalidateQueries({ queryKey: chave });
    }
    setGravando(null);
    fragmentoGuardado = '';
    setFim({ anuncios: r.anuncios, trazidos: r.trazidos, fotos, comFoto, falhas });
  }

  return (
    <Moldura>
      <p className="text-sm text-muted-foreground">
        O Canal Pro mandou <span className="numerico font-medium text-foreground">{c.vieram}</span>{' '}
        {c.vieram === 1 ? 'anúncio' : 'anúncios'}. Antes de gravar, o CRM comparou com o que já tem.
        Nada mudou ainda.
      </p>
      {faltouPagina ? (
        <p className="flex items-start gap-2 rounded-xl bg-morno-fundo p-3 text-sm text-morno-texto">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />O Canal Pro diz que
          tem {c.total} anúncios, e vieram {pacote.anuncios.length}. Recarregue a página do Canal
          Pro e clique de novo no favorito: gravar uma lista pela metade marcaria os outros como
          fora do Canal Pro.
        </p>
      ) : null}

      <Grupo
        icone={<Plus className="size-4" aria-hidden="true" />}
        titulo="Entram como novos"
        numero={c.novos.length}
        vazio="Todo anúncio do Canal Pro já tem cartão no CRM."
      >
        {c.novos.map((n) => (
          <Linha
            key={n.codigo}
            titulo={n.codigo}
            texto={[n.situacao, n.titulo].filter(Boolean).join(' · ')}
          />
        ))}
      </Grupo>

      <Grupo
        icone={<Camera className="size-4" aria-hidden="true" />}
        titulo="Ganham fotos"
        numero={
          c.fotos.length
            ? `${quantasFotos} fotos · ${fotosMarcadas.length} de ${c.fotos.length} anúncios`
            : 0
        }
        vazio="Nenhum anúncio tem menos fotos no CRM que no Canal Pro."
      >
        {c.fotos.map((f) => (
          <LinhaDeFoto
            key={f.codigo}
            f={f}
            marcada={!sem.has(f.codigo)}
            aoMarcar={(sim) =>
              setSem((s) => {
                const n = new Set(s);
                if (sim) n.delete(f.codigo);
                else n.add(f.codigo);
                return n;
              })
            }
          />
        ))}
      </Grupo>

      <Grupo
        icone={<RefreshCw className="size-4" aria-hidden="true" />}
        titulo="Já no CRM: só atualizam situação e números"
        numero={c.casam.length}
        vazio="Nenhum anúncio do Canal Pro casou pelo código."
      >
        <p className="px-4 py-2.5 text-sm text-muted-foreground">
          Casam pelo código. Situação, visualizações e contatos no Canal Pro ficam em dia; título,
          preço e descrição do CRM não mudam.
        </p>
      </Grupo>

      <Grupo
        icone={<Layers className="size-4" aria-hidden="true" />}
        titulo="Mesmo imóvel com outro código: não entram"
        numero={c.copias.length}
        vazio="Nenhuma cópia antiga."
      >
        {c.copias.map((x) => (
          <Linha
            key={x.codigo}
            titulo={x.codigo}
            texto={`${x.situacao ?? 'Sem situação'} no Canal Pro · fica junto de ${x.codigoNoCrm}`}
          />
        ))}
      </Grupo>

      {c.sairam.length ? (
        <Grupo
          icone={<LogOut className="size-4" aria-hidden="true" />}
          titulo="Não estão mais no Canal Pro"
          numero={c.sairam.length}
          vazio=""
        >
          <p className="px-4 py-2.5 text-sm text-muted-foreground">
            {c.sairam.join(', ')}. Estavam na última lista e não vieram agora: saem da lista do
            Canal Pro. Os anúncios do CRM continuam.
          </p>
        </Grupo>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="toque h-11 md:h-9"
          disabled={gravando !== null || faltouPagina || c.vieram === 0}
          onClick={() => void aplicar()}
        >
          <CircleCheck aria-hidden="true" />
          Aplicar
        </Button>
        <Button asChild variant="outline" className="toque h-11 md:h-9">
          <Link href="/anuncios">Cancelar</Link>
        </Button>
        {gravando ? <p className="text-sm text-muted-foreground">{gravando}</p> : null}
      </div>
    </Moldura>
  );
}

/** O que a sincronização fez, depois do "Aplicar". */
function ResultadoDaSincronizacao({ fim }: { fim: Fim }) {
  return (
    <Moldura>
      <section className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-5 text-sm">
        <p className="flex items-center gap-2 text-base font-medium text-cliente-texto">
          <CircleCheck className="size-5" aria-hidden="true" />
          Sincronizado
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Lista do Canal Pro gravada: <span className="numerico">{fim.anuncios}</span> anúncios,
            com situação, visualizações e contatos em dia.
          </li>
          <li>
            {fim.trazidos
              ? `${fim.trazidos} ${fim.trazidos === 1 ? 'anúncio novo entrou' : 'anúncios novos entraram'} no CRM como rascunho.`
              : 'Nenhum anúncio novo: tudo já tinha cartão no CRM.'}
          </li>
          <li>
            {fim.fotos
              ? `${fim.fotos} ${fim.fotos === 1 ? 'foto levada' : 'fotos levadas'} para ${fim.comFoto} ${fim.comFoto === 1 ? 'anúncio' : 'anúncios'}.`
              : 'Nenhuma foto nova.'}
          </li>
          <li>Nenhum repetido entrou: as cópias antigas ficaram dentro do cartão certo.</li>
        </ul>
        {fim.falhas.length ? (
          <div className="flex items-start gap-2 rounded-lg bg-morno-fundo p-3 text-morno-texto">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">O que não veio</p>
              <ul className="list-disc pl-4">
                {fim.falhas.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="mt-1">Clicar de novo no favorito tenta só o que falta.</p>
            </div>
          </div>
        ) : null}
        <Button asChild className="toque h-11 w-fit md:h-9">
          <Link href="/anuncios">
            <ArrowLeft aria-hidden="true" />
            Voltar para Anúncios
          </Link>
        </Button>
      </section>
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <div>
        <Link
          href="/anuncios"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Anúncios
        </Link>
        <h1 className="font-heading text-[28px] leading-tight font-normal tracking-[-0.02em]">
          Sincronizar com o Canal Pro
        </h1>
      </div>
      {children}
    </div>
  );
}

function Grupo({
  icone,
  titulo,
  numero,
  vazio,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  numero: number | string;
  vazio: string;
  children: React.ReactNode;
}) {
  const nada = numero === 0;
  return (
    <section className="sombra-base overflow-hidden rounded-xl bg-card">
      <div className="flex items-center gap-2.5 bg-muted/60 px-4 py-3">
        <span className="grid size-7 place-items-center rounded-full bg-card text-muted-foreground">
          {icone}
        </span>
        <h2 className="flex-1 text-sm font-medium">{titulo}</h2>
        <span className="text-sm font-semibold numerico">{numero}</span>
      </div>
      {nada ? (
        <p className="px-4 py-2.5 text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <div className="flex flex-col divide-y divide-hairline">{children}</div>
      )}
    </section>
  );
}

function Linha({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="flex flex-col px-4 py-2.5 text-sm">
      <span className="font-medium numerico">{titulo}</span>
      {texto ? <span className="text-[13px] text-muted-foreground">{texto}</span> : null}
    </div>
  );
}

function LinhaDeFoto({
  f,
  marcada,
  aoMarcar,
}: {
  f: FotosParaTrazer;
  marcada: boolean;
  aoMarcar: (sim: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm">
      <input
        type="checkbox"
        checked={marcada}
        onChange={(e) => aoMarcar(e.target.checked)}
        className="size-4 accent-[var(--primary)]"
      />
      <span className="min-w-0 flex-1">
        <span className="font-medium numerico">{f.codigo}</span>
        <span className="block text-[13px] text-muted-foreground">
          {f.anuncioId === null
            ? `anúncio novo: entram as ${f.vem}`
            : f.tem === 0
              ? `nenhuma no CRM: entram as ${f.vem}`
              : `o CRM tem ${f.tem}, o Canal Pro tem ${f.vem}: ficam as ${f.vem} de lá`}
        </span>
      </span>
      <span className="font-semibold numerico">+{f.modo === 'trocar' ? f.vem - f.tem : f.vem}</span>
    </label>
  );
}
