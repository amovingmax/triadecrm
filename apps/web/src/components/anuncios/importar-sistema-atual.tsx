'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CircleCheck,
  CircleX,
  FileCode,
  Import,
  Link2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { dadosParaImportar, type AnuncioDoArquivo } from './arquivo-vrsync';
import { CHAVE_DO_CANAL_PRO, CHAVE_DOS_ANUNCIOS } from './dados';
import {
  codigosNoCrm,
  fraseDaFoto,
  fraseDaImportacao,
  importarAnuncio,
  lerDoComputador,
  lerDoEnderecoGuardado,
  lerPeloEndereco,
  registrarLeitura,
  trazerFotos,
  type Leitura,
} from './importacao-dados';

/** O que aconteceu com cada anúncio trazido. */
type Resultado =
  | { codigo: string; ok: false; motivo: string }
  | {
      codigo: string;
      ok: true;
      novo: boolean;
      fotos:
        | { tipo: 'nenhuma' }
        | { tipo: 'mantidas'; quantas: number }
        | { tipo: 'falhou'; motivo: string }
        | { tipo: 'trazidas'; vieram: number; total: number; falhas: [string, number][] };
      pendencias: string[] | null;
    };

/** O arquivo inteiro, depois de trazido. */
type Resumo = {
  noArquivo: number;
  /** Excluídos no CRM: não voltam pela atualização. */
  excluidos: string[];
  /** Estavam no arquivo da última vez e não estão mais; null = não deu para conferir. */
  sairam: number | null;
  avisos: string[];
};

type Como =
  { tipo: 'guardado' } | { tipo: 'endereco'; url: string } | { tipo: 'arquivo'; arquivo: File };

/**
 * "Atualizar do sistema atual" (06/11/2026), só na Imova: um clique traz para o
 * CRM a lista inteira de anúncios do sistema que publica hoje no Canal Pro.
 *
 * Na primeira vez, a gestão cola o endereço do arquivo VRSync desse sistema
 * (Canal Pro > Configurações da conta > Integração de anúncios), e o CRM o guarda.
 * Das próximas, o botão lê o endereço guardado sem perguntar e traz tudo: cria
 * o que é novo (com o MESMO código, como rascunho), atualiza o que já tem o
 * código, baixa as fotos de quem ainda não tem e marca quem saiu do arquivo
 * (`registrarLeitura`). O excluído no CRM não volta. Antes (05/11) a folha pedia
 * o endereço toda vez e mostrava uma lista para marcar.
 *
 * Nada muda no Canal Pro: ele continua lendo o sistema atual até alguém trocar o
 * endereço lá.
 */
export function ImportarSistemaAtual({ temEndereco }: { temEndereco: boolean }) {
  const cliente = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [endereco, setEndereco] = useState('');
  const [pedindoEndereco, setPedindoEndereco] = useState(false);
  const [lendo, setLendo] = useState<Como['tipo'] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [trazendo, setTrazendo] = useState<{ feitos: number; total: number; agora: string } | null>(
    null,
  );
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);

  function limpar() {
    setEndereco('');
    setPedindoEndereco(false);
    setLendo(null);
    setErro(null);
    setTrazendo(null);
    setResultados(null);
    setResumo(null);
    if (entrada.current) entrada.current.value = '';
  }

  /** O botão da tela: com o endereço guardado, já começa; sem ele, pede. */
  function abrir() {
    limpar();
    setAberto(true);
    if (temEndereco) void atualizar({ tipo: 'guardado' });
    else setPedindoEndereco(true);
  }

  async function atualizar(como: Como) {
    setErro(null);
    setResultados(null);
    setResumo(null);
    setLendo(como.tipo);
    let leitura: Leitura;
    try {
      leitura =
        como.tipo === 'guardado'
          ? await lerDoEnderecoGuardado()
          : como.tipo === 'endereco'
            ? await lerPeloEndereco(como.url, true)
            : await lerDoComputador(como.arquivo);
    } catch {
      leitura = { ok: false, motivo: 'falhou' };
    }
    setLendo(null);
    if (!leitura.ok) {
      const frase =
        leitura.motivo === 'xml_invalido' && leitura.linha
          ? `${fraseDaImportacao(leitura.motivo)} (linha ${leitura.linha})`
          : fraseDaImportacao(leitura.motivo);
      setErro(
        como.tipo === 'guardado' && leitura.motivo !== 'sem_endereco'
          ? `O endereço guardado não abriu. ${frase}`
          : frase,
      );
      setPedindoEndereco(true);
      return;
    }
    if (como.tipo === 'endereco' && leitura.guardado) {
      void cliente.invalidateQueries({ queryKey: CHAVE_DO_CANAL_PRO });
    }
    setPedindoEndereco(false);
    await trazerTudo(leitura);
  }

  async function trazerTudo(leitura: Extract<Leitura, { ok: true }>) {
    const codigos = leitura.anuncios.map((a) => a.codigo);
    // Quem está no arquivo agora e quem saiu dele: vale pelo arquivo, antes de trazer.
    const registro = await registrarLeitura(codigos).catch(() => null);
    const noCrm = await codigosNoCrm(codigos).catch(() => null);
    const excluidos = codigos.filter((c) => noCrm?.get(c)?.excluido);
    const lista = leitura.anuncios.filter((a) => !noCrm?.get(a.codigo)?.excluido);
    setResumo({
      noArquivo: leitura.anuncios.length,
      excluidos,
      sairam: registro?.ok ? registro.sairam : null,
      avisos: leitura.avisos,
    });

    const feitos: Resultado[] = [];
    setResultados([]);
    try {
      for (const [i, a] of lista.entries()) {
        setTrazendo({ feitos: i, total: lista.length, agora: `${a.codigo}: os dados` });
        feitos.push(
          await trazerUm(a, (agora) => setTrazendo({ feitos: i, total: lista.length, agora })),
        );
        setResultados([...feitos]);
      }
      setTrazendo({ feitos: lista.length, total: lista.length, agora: 'conferindo o que falta' });
      // As pendências de agora, já com as fotos: o que falta para cada um ir ao ar.
      const depois = await codigosNoCrm(feitos.filter((f) => f.ok).map((f) => f.codigo)).catch(
        () => null,
      );
      setResultados(
        feitos.map((f) =>
          f.ok && depois ? { ...f, pendencias: depois.get(f.codigo)?.pendencias ?? null } : f,
        ),
      );
    } catch {
      // Um erro fora do previsto: o que já veio fica na lista; o resto não foi tentado.
      setResultados([...feitos]);
      toast.error(
        'A atualização parou no meio. Clique em "Atualizar de novo" para trazer o resto.',
      );
    } finally {
      setTrazendo(null);
      void cliente.invalidateQueries({ queryKey: CHAVE_DOS_ANUNCIOS });
      void cliente.invalidateQueries({ queryKey: CHAVE_DO_CANAL_PRO });
    }

    if (feitos.length < lista.length) return;
    const novos = feitos.filter((f) => f.ok && f.novo).length;
    const atualizados = feitos.filter((f) => f.ok && !f.novo).length;
    const falharam = feitos.length - novos - atualizados;
    const partes = [
      novos ? `${novos} ${novos === 1 ? 'novo' : 'novos'}` : null,
      atualizados ? `${atualizados} ${atualizados === 1 ? 'atualizado' : 'atualizados'}` : null,
      registro?.ok && registro.sairam
        ? `${registro.sairam} ${registro.sairam === 1 ? 'saiu' : 'saíram'} do sistema atual`
        : null,
    ].filter(Boolean);
    if (falharam === 0) {
      toast.success('Anúncios do sistema atual atualizados.', {
        description: partes.join(' · ') || undefined,
      });
    } else {
      toast.warning(`${falharam} ${falharam === 1 ? 'anúncio não veio' : 'anúncios não vieram'}.`, {
        description: 'Veja na folha o motivo de cada um.',
      });
    }
  }

  function mudarAberto(estado: boolean) {
    if (!estado && (trazendo || lendo)) {
      toast.info('Espere terminar: fechar agora deixaria anúncios pela metade.');
      return;
    }
    if (!estado) limpar();
    setAberto(estado);
  }

  const ocupado = lendo !== null || trazendo !== null;

  return (
    <>
      <Button variant="outline" className="toque h-11 md:h-9" onClick={abrir}>
        <Import aria-hidden="true" />
        Atualizar do sistema atual
      </Button>
      <Sheet open={aberto} onOpenChange={mudarAberto}>
        <SheetContent
          side="right"
          className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        >
          <SheetHeader>
            <SheetTitle>Atualizar do sistema atual</SheetTitle>
            <SheetDescription>
              Traz para o CRM todos os anúncios que o sistema atual publica no Canal Pro, com o
              mesmo código e as fotos. Os que estão no ar aparecem em Publicados; os que saíram do
              arquivo, em Não publicados. Nada muda no Canal Pro.
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6">
            {lendo === 'guardado' ? (
              <p className="text-sm text-muted-foreground" role="status">
                Lendo o arquivo do sistema atual...
              </p>
            ) : null}

            {erro ? (
              <div role="alert" className="rounded-lg border border-hairline p-3 text-sm">
                <p className="font-medium">O arquivo não foi lido.</p>
                <p className="text-muted-foreground">{erro}</p>
              </div>
            ) : null}

            {pedindoEndereco ? (
              <PedirEndereco
                endereco={endereco}
                aoMudarEndereco={setEndereco}
                lendo={lendo}
                temEndereco={temEndereco}
                aoLerEndereco={(e) => {
                  e.preventDefault();
                  if (endereco.trim()) void atualizar({ tipo: 'endereco', url: endereco.trim() });
                }}
                entrada={entrada}
                aoEscolher={(l) => {
                  const f = l?.[0];
                  if (f) void atualizar({ tipo: 'arquivo', arquivo: f });
                }}
              />
            ) : null}

            {resultados !== null && resumo ? (
              <Andamento resultados={resultados} resumo={resumo} trazendo={trazendo} />
            ) : null}

            {resultados !== null && !ocupado ? (
              <div className="flex flex-wrap gap-2">
                {temEndereco ? (
                  <Button
                    type="button"
                    className="toque h-11 md:h-9"
                    onClick={() => void atualizar({ tipo: 'guardado' })}
                  >
                    <RefreshCw aria-hidden="true" />
                    Atualizar de novo
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="toque h-11 md:h-9"
                  onClick={() => {
                    setResultados(null);
                    setResumo(null);
                    setPedindoEndereco(true);
                  }}
                >
                  Trocar o endereço
                </Button>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Um anúncio: os dados por `anuncio_importar`, depois as fotos, se ele ainda não tem. */
async function trazerUm(a: AnuncioDoArquivo, aoAndar: (agora: string) => void): Promise<Resultado> {
  const r = await importarAnuncio(dadosParaImportar(a));
  if (!r.ok) return { codigo: a.codigo, ok: false, motivo: r.motivo };
  const pronto = (fotos: Extract<Resultado, { ok: true }>['fotos']): Resultado => ({
    codigo: a.codigo,
    ok: true,
    novo: r.novo,
    fotos,
    pendencias: null,
  });
  if (a.fotos.length === 0) return pronto({ tipo: 'nenhuma' });
  if (r.fotos > 0) return pronto({ tipo: 'mantidas', quantas: r.fotos });

  aoAndar(`${a.codigo}: ${a.fotos.length} ${a.fotos.length === 1 ? 'foto' : 'fotos'}`);
  const f = await trazerFotos(r.id, a.fotos);
  if (!f.ok) return pronto({ tipo: 'falhou', motivo: f.motivo });
  if ('pulado' in f) return pronto({ tipo: 'mantidas', quantas: f.fotos });
  const falhas = new Map<string, number>();
  for (const x of f.fotos.filter((x) => !x.ok)) {
    const frase = fraseDaFoto(x.motivo);
    falhas.set(frase, (falhas.get(frase) ?? 0) + 1);
  }
  return pronto({
    tipo: 'trazidas',
    vieram: f.fotos.filter((x) => x.ok).length,
    total: f.fotos.length,
    falhas: [...falhas],
  });
}

function PedirEndereco({
  endereco,
  aoMudarEndereco,
  lendo,
  temEndereco,
  aoLerEndereco,
  entrada,
  aoEscolher,
}: {
  endereco: string;
  aoMudarEndereco: (v: string) => void;
  lendo: Como['tipo'] | null;
  temEndereco: boolean;
  aoLerEndereco: (e: React.FormEvent) => void;
  entrada: React.RefObject<HTMLInputElement | null>;
  aoEscolher: (l: FileList | null) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">
        {temEndereco ? 'Trocar o endereço do arquivo' : 'O endereço do arquivo'}
      </h3>
      <p className="text-sm text-muted-foreground">
        No Canal Pro, em Configurações da conta &gt; Integração de anúncios, está o endereço do
        arquivo que o sistema atual publica. Cole aqui uma vez: o CRM guarda e, das próximas vezes,
        o botão atualiza sem perguntar.
      </p>
      <form onSubmit={aoLerEndereco} className="flex flex-col gap-1.5">
        <Label htmlFor="endereco-do-sistema-atual">Endereço do arquivo</Label>
        <div className="flex gap-2">
          <Input
            id="endereco-do-sistema-atual"
            inputMode="url"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://..."
            className="h-11 font-mono text-xs md:h-9"
            value={endereco}
            disabled={lendo !== null}
            onChange={(e) => aoMudarEndereco(e.target.value)}
          />
          <Button
            type="submit"
            className="toque h-11 shrink-0 md:h-9"
            disabled={lendo !== null || !endereco.trim()}
          >
            <Link2 aria-hidden="true" />
            {lendo === 'endereco' ? 'Lendo...' : 'Guardar e atualizar'}
          </Button>
        </div>
      </form>
      <p className="text-sm text-muted-foreground">
        Se o endereço não abrir (há sistema que só o libera para o robô do Grupo OLX), baixe o
        arquivo pelo sistema atual e escolha-o aqui. Pelo arquivo, nada fica guardado.
      </p>
      <div>
        <input
          ref={entrada}
          type="file"
          accept=".xml,text/xml,application/xml"
          className="sr-only"
          onChange={(e) => aoEscolher(e.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          className="toque h-11 md:h-9"
          disabled={lendo !== null}
          onClick={() => entrada.current?.click()}
        >
          <FileCode aria-hidden="true" />
          {lendo === 'arquivo' ? 'Lendo...' : 'Escolher o arquivo .xml'}
        </Button>
      </div>
    </section>
  );
}

function Andamento({
  resultados,
  resumo,
  trazendo,
}: {
  resultados: Resultado[];
  resumo: Resumo;
  trazendo: { feitos: number; total: number; agora: string } | null;
}) {
  const pct =
    trazendo && trazendo.total > 0 ? Math.round((trazendo.feitos / trazendo.total) * 100) : 100;
  const novos = resultados.filter((r) => r.ok && r.novo).length;
  const atualizados = resultados.filter((r) => r.ok && !r.novo).length;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{trazendo ? 'Atualizando...' : 'Pronto'}</h3>
      <p className="text-sm">
        <span className="numerico">{resumo.noArquivo}</span>{' '}
        {resumo.noArquivo === 1 ? 'anúncio no arquivo' : 'anúncios no arquivo'}
        {trazendo
          ? '.'
          : `: ${novos} ${novos === 1 ? 'novo' : 'novos'}, ${atualizados} ${atualizados === 1 ? 'atualizado' : 'atualizados'}.`}
      </p>
      {resumo.sairam ? (
        <p className="text-sm text-muted-foreground">
          <span className="numerico">{resumo.sairam}</span>{' '}
          {resumo.sairam === 1
            ? 'anúncio estava no arquivo da última vez e saiu: ele passa para Não publicados.'
            : 'anúncios estavam no arquivo da última vez e saíram: eles passam para Não publicados.'}
        </p>
      ) : null}
      {resumo.excluidos.length ? (
        <p className="text-sm text-muted-foreground">
          Excluídos no CRM, não voltaram: {resumo.excluidos.join(', ')}. Para trazer de novo,
          restaure em Excluídos.
        </p>
      ) : null}
      {resumo.avisos.length ? (
        <ul className="flex flex-col gap-1 rounded-lg border border-hairline p-3 text-xs">
          {resumo.avisos.map((aviso) => (
            <li key={aviso} className="flex gap-1.5">
              <TriangleAlert
                aria-hidden="true"
                className="mt-px size-3.5 shrink-0 text-morno-texto"
              />
              <span>{aviso}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {trazendo ? (
        <div className="flex flex-col gap-1.5">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Anúncios atualizados"
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-menta transition-[width] duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="numerico">{trazendo.feitos}</span> de{' '}
            <span className="numerico">{trazendo.total}</span> · {trazendo.agora}. Deixe esta folha
            aberta até terminar.
          </p>
        </div>
      ) : null}

      {resultados.length ? (
        <ul className="flex flex-col divide-y divide-hairline rounded-lg border border-hairline text-sm">
          {resultados.map((r) => (
            <li key={r.codigo} className="flex gap-2 px-3 py-2">
              {r.ok ? (
                <CircleCheck
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-menta-texto"
                />
              ) : (
                <CircleX
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-destructive-texto"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="numerico font-medium">{r.codigo}</span>{' '}
                <span className="text-muted-foreground">
                  {r.ok ? (r.novo ? '· novo' : '· atualizado') : '· não veio'}
                </span>
                {r.ok ? (
                  <>
                    <span className="block text-xs text-muted-foreground">
                      {fraseDasFotos(r.fotos)}
                    </span>
                    {r.pendencias?.length ? (
                      <span className="block text-xs text-muted-foreground">
                        Falta para ir ao ar pelo CRM: {r.pendencias.join(', ')}.
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="block text-xs text-destructive-texto">
                    {fraseDaImportacao(r.motivo)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function fraseDasFotos(fotos: Extract<Resultado, { ok: true }>['fotos']): string {
  switch (fotos.tipo) {
    case 'nenhuma':
      return 'O arquivo não tem fotos deste anúncio.';
    case 'mantidas':
      return `Já tinha ${fotos.quantas} ${fotos.quantas === 1 ? 'foto' : 'fotos'} no CRM: ficaram como estavam.`;
    case 'falhou':
      return `As fotos não vieram: ${fraseDaImportacao(fotos.motivo)}`;
    case 'trazidas': {
      const base = `${fotos.vieram} de ${fotos.total} ${fotos.total === 1 ? 'foto trazida' : 'fotos trazidas'}`;
      if (!fotos.falhas.length) return `${base}.`;
      return `${base}. Não ${fotos.total - fotos.vieram === 1 ? 'veio' : 'vieram'}: ${fotos.falhas.map(([frase, n]) => `${frase} (${n})`).join('; ')}.`;
    }
  }
}
