'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Paperclip, Play, X } from 'lucide-react';
import { toast } from 'sonner';

import { EMPRESA } from '@/lib/empresa';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  comoMandar,
  comoMandarDocumento,
  fraseDaMidia,
  QUANTOS_DE_UMA_VEZ,
  TETO_DA_LEGENDA,
  type TipoDeMidia,
} from '@/lib/midia-de-saida';

import { fraseDoErroDaMidia, mandarMidia } from './enviar-midia-dados';

/**
 * Mandar foto e vídeo pelo WhatsApp, de dentro do CRM (16/10/2026).
 *
 * Três portas para o mesmo lugar: o clipe ao lado do microfone, colar (Ctrl+V)
 * um print na caixa de texto e arrastar o arquivo para cima dela. Todas caem na
 * mesma PRÉVIA, e nada sai sem passar por ela: foto mandada para a conversa
 * errada não se desmanda.
 *
 * Como o áudio, só existe com a janela de 24 h aberta — quem decide é quem
 * monta esta caixa (`TextoLivre`), que só aparece dentro dela.
 */

export type MidiaEscolhida = {
  id: string;
  arquivo: File;
  /** Foto, vídeo ou, desde 27/10/2026, documento. */
  tipo: TipoDeMidia | 'document';
  /** A prévia: URL do próprio arquivo, revogada quando ele sai da lista. */
  url: string;
};

/** Vai ou não vai, e como: o documento tem a regra dele (`comoMandarDocumento`). */
function comoEscolher(
  arquivo: File,
  documento: boolean,
): { ok: true; tipo: MidiaEscolhida['tipo'] } | { ok: false; motivo: string } {
  if (!documento) return comoMandar(arquivo);
  const como = comoMandarDocumento(arquivo);
  return como.ok ? { ok: true, tipo: 'document' } : como;
}

/** A lista do que foi escolhido e ainda não saiu, com as portas de entrada. */
export function useMidiaEscolhida() {
  const [itens, setItens] = useState<MidiaEscolhida[]>([]);
  // As URLs vivem também fora do estado: quem precisa delas por último é a
  // limpeza da desmontagem, e lá o estado já não responde.
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const vivas = urls.current;
    return () => {
      for (const url of vivas) URL.revokeObjectURL(url);
      vivas.clear();
    };
  }, []);

  const adicionar = useCallback((arquivos: readonly File[], comoDocumento: boolean) => {
    if (arquivos.length === 0) return;
    const recusas = new Map<string, string[]>();
    const novos: MidiaEscolhida[] = [];
    for (const arquivo of arquivos) {
      const como = comoEscolher(arquivo, comoDocumento);
      if (!como.ok) {
        recusas.set(como.motivo, [...(recusas.get(como.motivo) ?? []), arquivo.name]);
        continue;
      }
      // O documento não tem prévia: a URL do arquivo só serve à foto e ao vídeo.
      const url = como.tipo === 'document' ? '' : URL.createObjectURL(arquivo);
      if (url) urls.current.add(url);
      novos.push({ id: crypto.randomUUID(), arquivo, tipo: como.tipo, url });
    }
    for (const [motivo, nomes] of recusas) {
      toast.error(
        nomes.length === 1 ? `${nomes[0]} não vai.` : `${nomes.length} arquivos não vão.`,
        {
          description: fraseDaMidia(motivo),
        },
      );
    }
    setItens((atuais) => {
      const cabem = Math.max(0, QUANTOS_DE_UMA_VEZ - atuais.length);
      if (novos.length > cabem) {
        toast.info(fraseDaMidia('muitos_de_uma_vez'), {
          description: `Ficaram os ${QUANTOS_DE_UMA_VEZ} primeiros.`,
        });
        for (const fora of novos.slice(cabem)) {
          URL.revokeObjectURL(fora.url);
          urls.current.delete(fora.url);
        }
      }
      return [...atuais, ...novos.slice(0, cabem)];
    });
  }, []);

  const escolher = useCallback(
    (arquivos: readonly File[]) => adicionar(arquivos, false),
    [adicionar],
  );
  /** O documento (27/10/2026): pelo mesmo painel, cada arquivo uma mensagem. */
  const escolherDocumentos = useCallback(
    (arquivos: readonly File[]) => adicionar(arquivos, true),
    [adicionar],
  );

  const tirar = useCallback((id: string) => {
    setItens((atuais) => {
      const saindo = atuais.find((i) => i.id === id);
      if (saindo?.url) {
        URL.revokeObjectURL(saindo.url);
        urls.current.delete(saindo.url);
      }
      return atuais.filter((i) => i.id !== id);
    });
  }, []);

  const limpar = useCallback(() => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    setItens([]);
  }, []);

  return { itens, escolher, escolherDocumentos, tirar, limpar };
}

export type Midia = ReturnType<typeof useMidiaEscolhida>;

/** O clipe: abre o seletor de arquivos do sistema. */
export function BotaoDaMidia({
  aoEscolher,
  rotulo,
  className,
}: {
  aoEscolher: (arquivos: File[]) => void;
  /** O nome à vista no celular, onde o botão vira pílula na fileira de ferramentas. */
  rotulo?: string;
  className?: string;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={entrada}
        type="file"
        multiple
        // `.heic`/`.heif` por extensão: no Chrome do computador a foto do iPhone
        // chega sem tipo, e só a extensão a deixa aparecer no seletor.
        accept="image/*,.heic,.heif,video/mp4,video/3gpp,video/quicktime"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          aoEscolher(Array.from(e.target.files ?? []));
          // Zerado para a mesma foto poder ser escolhida de novo depois de tirada.
          e.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('toque size-11 md:size-9', className)}
        onClick={() => entrada.current?.click()}
        title="Mandar foto ou vídeo"
      >
        <Paperclip aria-hidden="true" />
        {rotulo ? (
          <span aria-hidden="true" className="md:hidden">
            {rotulo}
          </span>
        ) : null}
        <span className="sr-only">Mandar foto ou vídeo</span>
      </Button>
    </>
  );
}

/**
 * A prévia: as miniaturas, a legenda e o enviar. Cada arquivo vira uma
 * mensagem, na ordem da lista; a legenda vai na primeira, como no WhatsApp.
 * Se um falha, para ali: o que já saiu sai da lista, o resto fica para tentar
 * de novo, e o aviso diz por quê.
 */
export function PainelDaMidia({
  fioId,
  midia,
  aoEnviar,
  respondeA = null,
  aoCitar,
}: {
  fioId: string;
  midia: Midia;
  /** Depois de cada envio: quem monta a caixa refaz as leituras da tela. */
  aoEnviar: () => void;
  /** A mensagem citada vai com o PRIMEIRO arquivo, como a legenda. */
  respondeA?: string | null;
  /** Saiu a primeira: a citação foi junto, e a barra dela fecha. */
  aoCitar?: () => void;
}) {
  const [legenda, setLegenda] = useState('');
  const [enviando, setEnviando] = useState<number | null>(null);
  const total = midia.itens.length;
  const legendaLonga = legenda.length > TETO_DA_LEGENDA;

  async function enviarTudo() {
    const fila = [...midia.itens];
    let saiu = 0;
    for (const [indice, item] of fila.entries()) {
      setEnviando(indice + 1);
      try {
        await mandarMidia({
          fioId,
          tipo: item.tipo,
          arquivo: item.arquivo,
          legenda: indice === 0 ? legenda : '',
          respondeA: indice === 0 ? respondeA : null,
        });
        if (indice === 0) aoCitar?.();
      } catch (erro) {
        toast.error(
          saiu === 0
            ? 'Não entrou na fila.'
            : `${saiu} de ${fila.length} entraram na fila; o resto parou.`,
          { description: `${item.arquivo.name}: ${fraseDoErroDaMidia(erro)}` },
        );
        // A legenda já foi com o primeiro que saiu; não repete no próximo.
        if (saiu > 0) setLegenda('');
        setEnviando(null);
        aoEnviar();
        return;
      }
      saiu += 1;
      midia.tirar(item.id);
      aoEnviar();
    }
    setEnviando(null);
    setLegenda('');
    const fotos = fila.filter((i) => i.tipo === 'image').length;
    const videos = fila.filter((i) => i.tipo === 'video').length;
    const documentos = fila.length - fotos - videos;
    toast.success(
      [
        fotos > 0 ? (fotos === 1 ? '1 foto' : `${fotos} fotos`) : null,
        videos > 0 ? (videos === 1 ? '1 vídeo' : `${videos} vídeos`) : null,
        documentos > 0 ? (documentos === 1 ? '1 documento' : `${documentos} documentos`) : null,
      ]
        .filter(Boolean)
        .join(' e ') + ' na fila do WhatsApp.',
      { description: `Sai pelo número da ${EMPRESA.nomeDoNumero} em instantes.` },
    );
  }

  return (
    <div
      role="region"
      aria-label="Arquivos a enviar"
      className="space-y-2 rounded-2xl border border-input bg-card/60 p-2"
    >
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {midia.itens.map((item) => (
          <li
            key={item.id}
            className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted"
          >
            {item.tipo === 'document' ? (
              <span className="flex size-full flex-col items-center justify-center gap-1 px-1.5 text-center">
                <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
                <span className="line-clamp-2 text-[10px] leading-tight break-all">
                  {item.arquivo.name}
                </span>
              </span>
            ) : item.tipo === 'image' ? (
              // A prévia é o arquivo local (blob:): o otimizador de imagem do
              // Next não tem o que otimizar aqui.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.url} alt={item.arquivo.name} className="size-full object-cover" />
            ) : (
              <>
                <video
                  src={item.url}
                  muted
                  playsInline
                  preload="metadata"
                  className="size-full object-cover"
                />
                <Play
                  className="absolute inset-0 m-auto size-6 text-white drop-shadow"
                  aria-hidden="true"
                />
              </>
            )}
            <button
              type="button"
              onClick={() => midia.tirar(item.id)}
              disabled={enviando !== null}
              className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white outline-none hover:bg-black/80 focus-visible:ring-3 focus-visible:ring-ring/50"
              title="Tirar da lista"
            >
              <X className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Tirar {item.arquivo.name}</span>
            </button>
          </li>
        ))}
      </ul>

      <label htmlFor="legenda-da-midia" className="sr-only">
        Legenda
      </label>
      <input
        id="legenda-da-midia"
        value={legenda}
        onChange={(e) => setLegenda(e.target.value)}
        onKeyDown={(e) => {
          // Enter aqui manda a mídia, e não o formulário do texto em volta.
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (enviando === null && !legendaLonga) void enviarTudo();
        }}
        disabled={enviando !== null}
        placeholder={total > 1 ? 'Legenda (vai na primeira)' : 'Legenda (opcional)'}
        className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-base md:text-[15px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={cn(
            'text-[11px] text-muted-foreground',
            legendaLonga && 'text-destructive-texto',
          )}
        >
          {legendaLonga
            ? fraseDaMidia('legenda_longa')
            : legenda.trim()
              ? 'A legenda sai com seu primeiro nome em negrito na frente.'
              : 'Cada arquivo vira uma mensagem.'}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="toque h-9"
            onClick={() => {
              setLegenda('');
              midia.limpar();
            }}
            disabled={enviando !== null}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            className="toque h-9"
            onClick={() => void enviarTudo()}
            disabled={enviando !== null || legendaLonga}
          >
            {enviando !== null
              ? `Enviando ${enviando} de ${total + (enviando - 1)}...`
              : total === 1
                ? 'Enviar'
                : `Enviar ${total}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
