'use client';

import { type ReactNode } from 'react';
import { toast } from 'sonner';

import { type Navegador } from '@/components/avisos/instalar-app';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * O passo a passo de instalar, quando o navegador não oferece a pergunta dele
 * (`instalar-app.ts`). Os nomes em negrito são os do navegador em português, para
 * a pessoa achar o que lê aqui no menu dele.
 *
 * Fecha sempre com a permissão do aviso: no Mac, a que foi dada ao navegador não
 * vale para o app, e quem recusa a pergunta do sistema fica com o app instalado
 * mudo — o contrário do que levou a pessoa a instalar.
 */
const PASSOS: Record<Exclude<Navegador, 'outro'>, { titulo: string; passos: ReactNode[] }> = {
  chrome: {
    titulo: 'Instalar o Tríade pelo Chrome',
    passos: [
      <>
        Na barra de endereço, à direita, clique no ícone de instalar: um monitor com uma seta para
        baixo.
      </>,
      <>
        Não achou o ícone? Abra o menu <strong>⋮</strong> do Chrome, vá em{' '}
        <strong>Transmitir, salvar e compartilhar</strong> e clique em <strong>Instalar</strong>.
      </>,
      <>
        Confirme em <strong>Instalar</strong>. O Tríade abre numa janela própria.
      </>,
    ],
  },
  edge: {
    titulo: 'Instalar o Tríade pelo Edge',
    passos: [
      <>
        Na barra de endereço, à direita, clique no ícone <strong>Aplicativo disponível</strong>.
      </>,
      <>
        Não achou o ícone? Abra o menu <strong>⋯</strong> do Edge, vá em{' '}
        <strong>Aplicativos</strong> e clique em{' '}
        <strong>Instalar este site como um aplicativo</strong>.
      </>,
      <>
        Confirme em <strong>Instalar</strong>. O Tríade abre numa janela própria.
      </>,
    ],
  },
  safari: {
    titulo: 'Instalar o Tríade pelo Safari',
    passos: [
      <>
        Com o CRM aberto nesta aba, abra o menu <strong>Arquivo</strong>, no alto da tela.
      </>,
      <>
        Clique em <strong>Adicionar ao Dock</strong> e confirme em <strong>Adicionar</strong>.
      </>,
      <>O Tríade passa a abrir pelo ícone no Dock, numa janela própria.</>,
    ],
  },
};

export function PassosParaInstalar({
  navegador,
  aberto,
  aoMudar,
}: {
  navegador: Navegador;
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
}) {
  async function copiarEndereco() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      toast.success('Endereço copiado.', { description: 'Cole na barra do Chrome.' });
    } catch {
      toast.error('O navegador não deixou copiar.');
    }
  }

  if (navegador === 'outro') {
    return (
      <Dialog open={aberto} onOpenChange={aoMudar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Este navegador não instala o Tríade</DialogTitle>
            <DialogDescription>
              Abra o CRM no Google Chrome, no Edge ou no Safari do Mac e use este mesmo item do
              menu: lá o Tríade vira um app com janela e ícone próprios.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => aoMudar(false)}>
              Fechar
            </Button>
            <Button type="button" onClick={() => void copiarEndereco()}>
              Copiar o endereço
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const { titulo, passos } = PASSOS[navegador];
  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            Instalado, o Tríade abre numa janela só dele, com ícone no Dock ou na barra de tarefas,
            e o aviso de mensagem chega com o nome do Tríade.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-snug marker:text-muted-foreground">
          {passos.map((passo, i) => (
            <li key={i}>{passo}</li>
          ))}
          <li>
            Quando o Tríade instalado perguntar se pode mandar notificações, clique em{' '}
            <strong>Permitir</strong>: no Mac, a permissão dada ao navegador não vale para o app. Se
            ele não perguntar, ligue os avisos pelo menu com o seu nome.
          </li>
        </ol>

        {navegador === 'safari' ? (
          <p className="text-xs leading-snug text-muted-foreground">
            O Adicionar ao Dock precisa do macOS Sonoma ou mais novo. Se ele não aparecer, use o
            Google Chrome.
          </p>
        ) : (
          <p className="text-xs leading-snug text-muted-foreground">
            Se a barra de endereço mostrar “Abrir em…” no lugar do ícone, o Tríade já está instalado
            neste computador: é só clicar ali.
          </p>
        )}

        <DialogFooter>
          <Button type="button" onClick={() => aoMudar(false)}>
            Entendi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
