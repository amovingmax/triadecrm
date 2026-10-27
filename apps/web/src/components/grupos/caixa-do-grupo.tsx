'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AudioLines, FileText, Film, ImageIcon, Paperclip, SendHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { comoMandarNoGrupo, fraseDoArquivo, type TipoNoGrupo } from '@/lib/midia-dos-grupos';
import { Button } from '@/components/ui/button';

import { CHAVE_DOS_GRUPOS, chaveDasAcoes, chaveDoFio, pedir } from './dados';
import { ErroDoArquivo, prepararArquivo, subirArquivoDoGrupo } from './midia';
import { resumoDaMensagem } from './regras';
import { TETO_DO_TEXTO, type MensagemDoGrupoCrua } from './tipos';

/** O que o seletor de arquivo oferece: o que o grupo aceita. */
const ACEITA =
  'image/*,video/mp4,video/3gpp,audio/*,.opus,.amr,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx';

/** Até onde a caixa cresce sozinha antes de rolar. */
const ALTURA_MAXIMA = 200;

const ICONE: Record<TipoNoGrupo, React.ReactNode> = {
  image: <ImageIcon className="size-4" aria-hidden="true" />,
  video: <Film className="size-4" aria-hidden="true" />,
  audio: <AudioLines className="size-4" aria-hidden="true" />,
  document: <FileText className="size-4" aria-hidden="true" />,
};

/**
 * A caixa de escrever do grupo: texto, um arquivo (foto, vídeo, áudio ou
 * documento) e, quando a pessoa escolheu "Responder", a mensagem citada em cima.
 *
 * Só aparece com o grupo ativo e a janela aberta: fora dela a Meta não deixa
 * mandar mensagem livre, e quem decide isso é a tela de cima (`FioDoGrupo`).
 * O texto do arquivo vai como legenda; áudio não tem legenda no WhatsApp, então
 * com áudio o texto fica na caixa para ir depois.
 */
export function CaixaDoGrupo({
  grupoId,
  respondendoA,
  nomeDaCitada,
  aoCancelarResposta,
}: {
  grupoId: string;
  respondendoA: MensagemDoGrupoCrua | null;
  nomeDaCitada: string | null;
  aoCancelarResposta: () => void;
}) {
  const clientes = useQueryClient();
  const [texto, setTexto] = useState('');
  const [arquivo, setArquivo] = useState<{ file: File; tipo: TipoNoGrupo } | null>(null);
  const caixa = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAXIMA)}px`;
  }, [texto]);

  // Escolher "Responder" põe o cursor na caixa, como no WhatsApp.
  useEffect(() => {
    if (respondendoA) caixa.current?.focus();
  }, [respondendoA]);

  const limpo = texto.trim();
  const comLegenda = arquivo !== null && arquivo.tipo !== 'audio';
  const longo = texto.length > TETO_DO_TEXTO;

  const enviar = useMutation({
    mutationFn: async () => {
      if (arquivo) {
        const pronto = await prepararArquivo(arquivo.file);
        const caminho = await subirArquivoDoGrupo(grupoId, pronto);
        await pedir('grupo_enviar', {
          p_grupo_id: grupoId,
          p_tipo: pronto.tipo,
          p_texto: comLegenda && limpo ? limpo : null,
          p_media_path: caminho,
          p_media_mime: pronto.mime,
          p_media_nome: pronto.tipo === 'document' ? pronto.nome : null,
          p_responde_a: respondendoA?.id ?? null,
        });
        return { foiTexto: comLegenda };
      }
      await pedir('grupo_enviar', {
        p_grupo_id: grupoId,
        p_tipo: 'text',
        p_texto: limpo,
        p_responde_a: respondendoA?.id ?? null,
      });
      return { foiTexto: true };
    },
    onSuccess: ({ foiTexto }) => {
      setArquivo(null);
      if (foiTexto) setTexto('');
      aoCancelarResposta();
      void clientes.invalidateQueries({ queryKey: chaveDoFio(grupoId) });
      void clientes.invalidateQueries({ queryKey: chaveDasAcoes(grupoId) });
      void clientes.invalidateQueries({ queryKey: CHAVE_DOS_GRUPOS });
    },
    onError: (e: Error) =>
      toast.error('Não saiu.', {
        // `ErroDoGrupo` já traz a frase do motivo; o do arquivo traz o código.
        description: e instanceof ErroDoArquivo ? fraseDoArquivo(e.motivo) : e.message,
      }),
  });

  const pode = !enviar.isPending && !longo && (arquivo !== null || limpo.length > 0);

  const escolher = (lista: FileList | null) => {
    const file = lista?.[0];
    if (!file) return;
    const como = comoMandarNoGrupo(file);
    if (!como.ok) {
      toast.error('Este arquivo não vai.', { description: fraseDoArquivo(como.motivo) });
      return;
    }
    setArquivo({ file, tipo: como.tipo });
  };

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (pode) enviar.mutate();
      }}
    >
      {respondendoA ? (
        <div className="flex items-start gap-2 rounded-xl border-l-4 border-primary/60 bg-muted/60 px-3 py-2">
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-xs font-medium">
              {nomeDaCitada ? `Respondendo a ${nomeDaCitada}` : 'Respondendo'}
            </p>
            <p className="truncate text-muted-foreground">{resumoDaMensagem(respondendoA)}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={aoCancelarResposta}
            className="toque size-9 shrink-0 md:size-7"
          >
            <X aria-hidden="true" />
            <span className="sr-only">Não responder citando</span>
          </Button>
        </div>
      ) : null}

      {arquivo ? (
        <div className="flex items-center gap-2 rounded-xl border border-hairline bg-card px-3 py-2">
          {ICONE[arquivo.tipo]}
          <span className="min-w-0 flex-1 truncate text-sm">{arquivo.file.name}</span>
          {arquivo.tipo === 'audio' ? (
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              áudio vai sem legenda
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={enviar.isPending}
            onClick={() => setArquivo(null)}
            className="toque size-9 shrink-0 md:size-7"
          >
            <X aria-hidden="true" />
            <span className="sr-only">Tirar o arquivo</span>
          </Button>
        </div>
      ) : null}

      <div className="flex items-end gap-2 rounded-[22px] border border-input bg-card/60 py-1 pr-1 pl-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40">
        <input
          ref={seletor}
          type="file"
          accept={ACEITA}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            escolher(e.target.files);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => seletor.current?.click()}
          disabled={enviar.isPending}
          className="toque size-10 shrink-0 rounded-full md:size-9"
        >
          <Paperclip aria-hidden="true" />
          <span className="sr-only">Anexar foto, vídeo, áudio ou documento</span>
        </Button>
        <label htmlFor={`texto-do-grupo-${grupoId}`} className="sr-only">
          Escrever no grupo
        </label>
        <textarea
          id={`texto-do-grupo-${grupoId}`}
          ref={caixa}
          value={texto}
          rows={1}
          onChange={(e) => setTexto(e.target.value)}
          onPaste={(e) => {
            const colado = e.clipboardData?.files;
            if (!colado || colado.length === 0) return;
            e.preventDefault();
            escolher(colado);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            // No celular o Enter do teclado é quebra de linha.
            if (window.matchMedia?.('(pointer: coarse)').matches) return;
            e.preventDefault();
            if (pode) enviar.mutate();
          }}
          placeholder={arquivo && comLegenda ? 'Legenda (se quiser)' : 'Mensagem'}
          className="min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-base leading-relaxed outline-none placeholder:text-muted-foreground md:text-[15px]"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!pode}
          className="toque size-10 shrink-0 rounded-full max-md:bg-menta max-md:text-menta-tinta md:size-9"
        >
          <SendHorizontal aria-hidden="true" />
          <span className="sr-only">Mandar no grupo</span>
        </Button>
      </div>

      {texto.length > 0 || enviar.isPending ? (
        <p
          className={cn(
            'px-2 text-[11px] text-muted-foreground',
            longo && 'text-destructive-texto',
          )}
        >
          {enviar.isPending
            ? arquivo
              ? 'Subindo o arquivo…'
              : 'Mandando…'
            : longo
              ? `Passou de ${TETO_DO_TEXTO} letras, o teto do WhatsApp.`
              : 'Sai com seu primeiro nome em negrito na frente.'}
        </p>
      ) : null}
    </form>
  );
}
