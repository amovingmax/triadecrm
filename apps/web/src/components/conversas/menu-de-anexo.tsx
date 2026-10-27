'use client';

import { useRef, useState } from 'react';
import {
  FileText,
  ImageIcon,
  List,
  MapPin,
  MapPinned,
  MousePointerClick,
  Paperclip,
  Sticker,
  UserRound,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ACEITA_DOCUMENTOS } from '@/lib/midia-de-saida';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { EnviarContato } from './enviar-contato';
import { EnviarFigurinha } from './enviar-figurinha';
import { EnviarLocalizacao } from './enviar-localizacao';
import type { Midia } from './enviar-midia';
import { EnviarPergunta, type ModoDaPergunta } from './enviar-pergunta';
import type { DestinoDoAnexo } from './janela-do-anexo';

/**
 * O clipe (27/10/2026): tudo o que o WhatsApp manda além de texto e áudio.
 *
 * Foto, vídeo e documento caem na prévia de sempre (`PainelDaMidia`), em cima
 * da caixa; o resto abre um formulário curto. Só existe com a janela de 24 h
 * aberta, como a caixa inteira: fora dela só sai modelo aprovado.
 */
type Formulario = 'figurinha' | 'localizacao' | 'contato' | ModoDaPergunta | null;

export function MenuDeAnexo({
  midia,
  destino,
  rotulo,
  className,
}: {
  midia: Midia;
  destino: DestinoDoAnexo;
  /** O nome à vista no celular, onde o botão vira pílula na fileira de ferramentas. */
  rotulo?: string;
  className?: string;
}) {
  const fotos = useRef<HTMLInputElement>(null);
  const documentos = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState<Formulario>(null);
  const fechar = () => setAberto(null);

  return (
    <>
      <input
        ref={fotos}
        type="file"
        multiple
        // `.heic`/`.heif` por extensão: no Chrome do computador a foto do iPhone
        // chega sem tipo, e só a extensão a deixa aparecer no seletor.
        accept="image/*,.heic,.heif,video/mp4,video/3gpp,video/quicktime"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          midia.escolher(Array.from(e.target.files ?? []));
          // Zerado para a mesma foto poder ser escolhida de novo depois de tirada.
          e.target.value = '';
        }}
      />
      <input
        ref={documentos}
        type="file"
        multiple
        accept={ACEITA_DOCUMENTOS}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          midia.escolherDocumentos(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn('toque size-11 md:size-9', className)}
            title="Anexar"
          >
            <Paperclip aria-hidden="true" />
            {rotulo ? (
              <span aria-hidden="true" className="md:hidden">
                {rotulo}
              </span>
            ) : null}
            <span className="sr-only">Anexar: foto, documento, localização, contato…</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-60">
          <DropdownMenuItem className="h-10 md:h-8" onSelect={() => fotos.current?.click()}>
            <ImageIcon aria-hidden="true" />
            Foto ou vídeo
          </DropdownMenuItem>
          <DropdownMenuItem className="h-10 md:h-8" onSelect={() => documentos.current?.click()}>
            <FileText aria-hidden="true" />
            Documento
          </DropdownMenuItem>
          <DropdownMenuItem className="h-10 md:h-8" onSelect={() => setAberto('figurinha')}>
            <Sticker aria-hidden="true" />
            Figurinha
          </DropdownMenuItem>
          <DropdownMenuItem className="h-10 md:h-8" onSelect={() => setAberto('localizacao')}>
            <MapPin aria-hidden="true" />
            Localização
          </DropdownMenuItem>
          <DropdownMenuItem className="h-10 md:h-8" onSelect={() => setAberto('contato')}>
            <UserRound aria-hidden="true" />
            Contato
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="h-10 md:h-8" onSelect={() => setAberto('botoes')}>
            <MousePointerClick aria-hidden="true" />
            Pergunta com botões
          </DropdownMenuItem>
          <DropdownMenuItem className="h-10 md:h-8" onSelect={() => setAberto('lista')}>
            <List aria-hidden="true" />
            Lista de opções
          </DropdownMenuItem>
          <DropdownMenuItem className="h-10 md:h-8" onSelect={() => setAberto('pedir_localizacao')}>
            <MapPinned aria-hidden="true" />
            Pedir localização
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EnviarFigurinha aberto={aberto === 'figurinha'} aoFechar={fechar} destino={destino} />
      <EnviarLocalizacao aberto={aberto === 'localizacao'} aoFechar={fechar} destino={destino} />
      <EnviarContato aberto={aberto === 'contato'} aoFechar={fechar} destino={destino} />
      {aberto === 'botoes' || aberto === 'lista' || aberto === 'pedir_localizacao' ? (
        <EnviarPergunta modo={aberto} aberto aoFechar={fechar} destino={destino} />
      ) : null}
    </>
  );
}
