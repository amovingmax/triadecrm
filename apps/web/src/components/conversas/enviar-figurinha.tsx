'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';

import { SOBREVIVE_A_NAVEGACAO } from '@/components/consultas/provedor-consultas';
import { EMPRESA } from '@/lib/empresa';
import { comoMandarFigurinha, fraseDaMidia } from '@/lib/midia-de-saida';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

import { urlDaMidia } from './acoes';
import { fraseDoErroDaMidia, mandarMidia } from './enviar-midia-dados';
import { JanelaDoAnexo, useEnvioDoAnexo, type DestinoDoAnexo } from './janela-do-anexo';

/**
 * A figurinha (27/10/2026). O WhatsApp não tem "biblioteca" de figurinhas pela
 * API: a coleção do time é a que os contatos já mandaram — em qualquer conversa,
 * a mais nova primeiro — e reaproveitar uma é mandar de novo o mesmo arquivo
 * que já está no balde. E dá para subir uma nova, em .webp.
 */
export function EnviarFigurinha({
  aberto,
  aoFechar,
  destino,
}: {
  aberto: boolean;
  aoFechar: () => void;
  destino: DestinoDoAnexo;
}) {
  return (
    <JanelaDoAnexo aberto={aberto} aoFechar={aoFechar} titulo="Mandar figurinha">
      <Escolha destino={destino} aoFechar={aoFechar} />
    </JanelaDoAnexo>
  );
}

/** Quantas figurinhas a grade mostra. */
const TETO_DA_GRADE = 48;

type FigurinhaGuardada = { mensagemId: string; caminho: string };

async function carregarFigurinhas(): Promise<FigurinhaGuardada[]> {
  const { data, error } = await createClient()
    .from('messages')
    .select('id, media_path')
    .eq('tipo_na_meta', 'sticker')
    .not('media_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(TETO_DA_GRADE * 3);
  if (error) return [];
  // A mesma figurinha mandada dez vezes é uma só na grade.
  const vistas = new Set<string>();
  const unicas: FigurinhaGuardada[] = [];
  for (const m of data ?? []) {
    if (!m.media_path || vistas.has(m.media_path)) continue;
    vistas.add(m.media_path);
    unicas.push({ mensagemId: m.id, caminho: m.media_path });
    if (unicas.length >= TETO_DA_GRADE) break;
  }
  return unicas;
}

function Escolha({ destino, aoFechar }: { destino: DestinoDoAnexo; aoFechar: () => void }) {
  const figurinhas = useQuery({
    queryKey: ['conversas', 'figurinhas'],
    queryFn: carregarFigurinhas,
    staleTime: 5 * 60_000,
  });
  const depois = () => {
    destino.aoEnviar();
    aoFechar();
  };
  const { enviar, indo } = useEnvioDoAnexo({ ...destino, aoEnviar: depois });
  const entrada = useRef<HTMLInputElement>(null);
  const [subindo, setSubindo] = useState(false);

  async function subir(arquivo: File) {
    const como = comoMandarFigurinha(arquivo);
    if (!como.ok) {
      toast.error('Esta figurinha não vai.', { description: fraseDaMidia(como.motivo) });
      return;
    }
    setSubindo(true);
    try {
      await mandarMidia({
        fioId: destino.fioId,
        tipo: 'sticker',
        arquivo,
        legenda: '',
        respondeA: destino.respondeA,
      });
      toast.success('Figurinha na fila do WhatsApp.', {
        description: `Sai pelo número da ${EMPRESA.nomeDoNumero} em instantes.`,
      });
      depois();
    } catch (erro) {
      toast.error('A figurinha não entrou na fila.', { description: fraseDoErroDaMidia(erro) });
    } finally {
      setSubindo(false);
    }
  }

  const ocupado = indo || subindo;
  const lista = figurinhas.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      {figurinhas.isPending ? (
        <p className="text-sm text-muted-foreground">Procurando as figurinhas...</p>
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma figurinha guardada ainda. As que os contatos mandarem aparecem aqui.
        </p>
      ) : (
        <ul className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto" aria-label="Figurinhas">
          {lista.map((f) => (
            <li key={f.caminho}>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void enviar({ tipo: 'image', figurinha: { caminho: f.caminho } })}
                className="flex aspect-square w-full items-center justify-center rounded-xl outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                aria-label="Mandar esta figurinha"
              >
                <Miniatura figurinha={f} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={entrada}
        type="file"
        accept="image/webp,.webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = '';
          if (arquivo) void subir(arquivo);
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={ocupado}
        onClick={() => entrada.current?.click()}
        className="toque h-11 md:h-9"
      >
        <Upload aria-hidden="true" />
        {subindo ? 'Subindo...' : 'Subir uma figurinha (.webp)'}
      </Button>
    </div>
  );
}

/**
 * A figurinha na grade, pela mesma URL assinada do balão (mesma chave de
 * consulta: a que já está na tela não é pedida de novo).
 */
function Miniatura({ figurinha }: { figurinha: FigurinhaGuardada }) {
  const url = useQuery({
    queryKey: ['conversas', 'midia', figurinha.mensagemId, figurinha.caminho, 0],
    queryFn: () => urlDaMidia(figurinha.mensagemId),
    staleTime: 4 * 60_000,
    gcTime: 4 * 60_000,
    retry: false,
    meta: SOBREVIVE_A_NAVEGACAO,
  });
  if (!url.data) return <span className="size-14 animate-pulse rounded-lg bg-muted" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária do Storage.
    <img src={url.data} alt="" loading="lazy" className="size-16 object-contain" />
  );
}
