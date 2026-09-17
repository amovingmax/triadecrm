'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mic, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { CHAVE_CONVERSAS, chaveDaLinha } from './dados';

/**
 * Gravar e mandar áudio pelo WhatsApp, de dentro do CRM.
 *
 * ===========================================================================
 * TRÊS DECISÕES, E AS TRÊS SÃO DE PRODUTO
 * ===========================================================================
 * 1. **Só dentro da janela de 24 h.** Áudio não é modelo aprovado: fora da
 *    janela a Meta recusa, ponto. O botão some em vez de existir e falhar —
 *    oferecer o que não pode sair é ensinar a pessoa a não confiar na tela.
 * 2. **Ouvir antes de mandar.** A gravação para, vira um player, e só então há
 *    "Enviar". Voz não se revisa depois: uma vez entregue, foi. O caminho
 *    "gravou e já foi" seria mais curto e custaria mais caro.
 * 3. **O tempo aparece enquanto grava.** Áudio de quatro minutos é o que ninguém
 *    ouve — nem o parceiro, nem quem precisa reler a conversa depois.
 */

/** Dois minutos. Acima disso é reunião, e reunião se marca (RF-CON-24). */
const TETO_SEGUNDOS = 120;

type Estado = 'parado' | 'gravando' | 'revisando';

export function GravarAudio({ fioId, className }: { fioId: string; className?: string }) {
  const clientes = useQueryClient();
  const [estado, setEstado] = useState<Estado>('parado');
  const [segundos, setSegundos] = useState(0);
  const [gravado, setGravado] = useState<{ arquivo: Blob; url: string } | null>(null);

  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const relogio = useRef<number | null>(null);

  // A URL do blob vive fora do estado porque quem precisa dela por último é a
  // limpeza da desmontagem, e lá o estado já não responde.
  const urlDoBlob = useRef<string | null>(null);

  // A trilha do microfone fica aberta enquanto grava: fechá-la é o que apaga a
  // bolinha vermelha do navegador. Sem isto, a aba fica "ouvindo" para sempre.
  const encerrarTrilha = () => {
    gravador.current?.stream.getTracks().forEach((t) => t.stop());
    gravador.current = null;
    if (relogio.current !== null) {
      window.clearInterval(relogio.current);
      relogio.current = null;
    }
  };

  // Fechar a trilha ao sair da tela é o que apaga a bolinha vermelha do
  // navegador — e é também o que limpa tudo quando a conversa muda, porque quem
  // usa este componente passa `key={fio.id}`: trocar de conversa o remonta do
  // zero. Zerar o estado aqui dentro, num efeito, seria a mesma coisa com um
  // render a mais e um caminho a mais para errar.
  useEffect(
    () => () => {
      encerrarTrilha();
      esquecerOBlob();
    },
    [],
  );

  const enviar = useMutation({
    mutationFn: async (arquivo: Blob) => {
      const corpo = new FormData();
      corpo.append('conversation_id', fioId);
      corpo.append('arquivo', arquivo, 'audio');
      const resposta = await fetch('/api/audio', { method: 'POST', body: corpo });
      const dados = (await resposta.json().catch(() => ({}))) as { ok?: boolean; motivo?: string };
      if (!resposta.ok || !dados.ok) throw new Error(dados.motivo ?? 'falhou');
      return dados;
    },
    onSuccess: () => {
      descartar();
      toast.success('Áudio na fila do WhatsApp.', {
        description: 'Sai pelo número da KOMUNE em instantes.',
      });
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      void clientes.invalidateQueries({ queryKey: chaveDaLinha(fioId) });
    },
    onError: (erro: Error) => {
      toast.error('O áudio não entrou na fila.', { description: fraseDoErro(erro.message) });
    },
  });

  async function comecar() {
    try {
      const trilha = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(trilha, { mimeType: tipoQueONavegadorGrava() });
      pedacos.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) pedacos.current.push(e.data);
      };
      recorder.onstop = () => {
        const arquivo = new Blob(pedacos.current, { type: recorder.mimeType });
        const url = URL.createObjectURL(arquivo);
        urlDoBlob.current = url;
        setGravado({ arquivo, url });
        setEstado('revisando');
        encerrarTrilha();
      };
      gravador.current = recorder;
      recorder.start();
      setSegundos(0);
      setEstado('gravando');
      relogio.current = window.setInterval(() => {
        setSegundos((s) => {
          if (s + 1 >= TETO_SEGUNDOS) recorder.stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      toast.error('O microfone não abriu.', {
        description: 'O navegador precisa da sua permissão para gravar — confira o cadeado da barra de endereço.',
      });
    }
  }

  function parar() {
    gravador.current?.stop();
  }

  function esquecerOBlob() {
    if (urlDoBlob.current !== null) {
      URL.revokeObjectURL(urlDoBlob.current);
      urlDoBlob.current = null;
    }
  }

  function descartar() {
    esquecerOBlob();
    setGravado(null);
    setEstado('parado');
    setSegundos(0);
  }

  if (estado === 'revisando' && gravado) {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', className)}>
        <audio controls src={gravado.url} className="h-11 min-w-0 flex-1" aria-label="Ouça antes de enviar" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="toque size-11 md:size-9"
          onClick={descartar}
          disabled={enviar.isPending}
        >
          <Trash2 aria-hidden="true" />
          <span className="sr-only">Descartar o áudio</span>
        </Button>
        <Button
          type="button"
          className="toque h-11 md:h-9"
          disabled={enviar.isPending}
          onClick={() => enviar.mutate(gravado.arquivo)}
        >
          {enviar.isPending ? 'Enviando...' : 'Enviar áudio'}
        </Button>
      </div>
    );
  }

  if (estado === 'gravando') {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Button type="button" variant="outline" className="toque h-11 md:h-9" onClick={parar}>
          <Square aria-hidden="true" />
          Parar
        </Button>
        <span className="text-xs text-muted-foreground">
          Gravando <span className="numerico">{relogioDe(segundos)}</span> de{' '}
          <span className="numerico">{relogioDe(TETO_SEGUNDOS)}</span>
        </span>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('toque size-11 md:size-9', className)}
      onClick={() => void comecar()}
      title="Gravar um áudio"
    >
      <Mic aria-hidden="true" />
      <span className="sr-only">Gravar um áudio</span>
    </Button>
  );
}

/**
 * O que este navegador sabe gravar.
 *
 * O Chrome grava `webm` (que o worker converte para ogg) e o Safari grava `mp4`
 * (que a Meta já aceita). Perguntar em vez de fixar é o que faz o botão existir
 * nos dois — e `''` deixa o navegador escolher, que é melhor que impor um tipo
 * que ele recusaria.
 */
function tipoQueONavegadorGrava(): string {
  const candidatos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const tipo of candidatos) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(tipo)) return tipo;
  }
  return '';
}

function relogioDe(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fraseDoErro(motivo: string): string {
  switch (motivo) {
    case 'audio_grande_demais':
      return 'O áudio passou do teto de 16 MB da Meta.';
    case 'tipo_nao_aceito':
      return 'Este navegador gravou num formato que a Meta não aceita.';
    case 'conversa_invisivel':
      return 'Esta conversa não está mais no seu alcance.';
    case 'mensagem_recusada':
      return 'O banco recusou a mensagem — confira se você ainda atende esta conversa.';
    case 'sem_sessao':
      return 'Sua sessão expirou. Entre de novo.';
    default:
      return 'Tente de novo em alguns segundos.';
  }
}
