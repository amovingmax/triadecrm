'use client';

import { useState } from 'react';
import { MessageCircle, Phone, Search } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

/**
 * Procura no Google o telefone de uma ficha que não tem.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO EXISTE BOTÃO "SALVAR NA FICHA"
 * ---------------------------------------------------------------------------
 * Não é esquecimento. Os Termos do Google proíbem o CRM armazenar conteúdo do
 * Places — telefone incluído —, e o anexo R03 §2.4 registra isso junto com o uso
 * que sobra: Places é gatilho de DESCOBERTA, e o dado definitivo vem do próprio
 * fornecedor. Um botão de salvar aqui seria uma porta para violar o contrato sem
 * ninguém perceber.
 *
 * O caminho é ligar. Falou com o fornecedor, o número é dele e entra na ficha
 * pelo caminho de sempre — e aí é dado da relação, não cache do Google.
 *
 * A tela diz isso com todas as letras, porque a alternativa é alguém copiar o
 * número na mão achando que está sendo esperto.
 */

type Lugar = {
  placeId: string;
  nome: string;
  endereco: string | null;
  telefone: string | null;
  site: string | null;
};

const RECADO: Record<string, string> = {
  sem_sessao: 'A sua sessão expirou. Entre de novo.',
  nao_configurado:
    'A busca no Google ainda não foi configurada no servidor. Fale com Luiz ou Matheus.',
  ficha_invisivel: 'Você não tem acesso a essa ficha.',
  ficha_ja_tem_telefone: 'Essa ficha já tem telefone.',
  nao_contatar: 'Esse contato pediu para não ser procurado.',
};

export function ProcurarTelefone({ organizationId }: { organizationId: string }) {
  const [procurando, setProcurando] = useState(false);
  const [lugares, setLugares] = useState<Lugar[] | null>(null);

  async function procurar() {
    setProcurando(true);
    try {
      const resposta = await fetch('/api/telefone/procurar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: organizationId }),
      });
      const corpo = (await resposta.json().catch(() => ({}))) as {
        ok?: boolean;
        motivo?: string;
        recado?: string;
        lugares?: Lugar[];
      };

      if (corpo.ok !== true) {
        toast.error('Não deu para procurar.', {
          description: corpo.recado ?? RECADO[corpo.motivo ?? ''] ?? 'Tente de novo.',
        });
        return;
      }

      setLugares(corpo.lugares ?? []);
      const comTelefone = (corpo.lugares ?? []).filter((l) => l.telefone).length;
      if (comTelefone === 0) {
        toast.info('O Google não tem telefone para esse negócio.', {
          description:
            'Vale tentar pelo Instagram, ou perguntar a quem indicou. Boa parte dos cerimonialistas não tem ficha no Maps.',
        });
      }
    } catch {
      toast.error('Não deu para falar com o servidor.');
    } finally {
      setProcurando(false);
    }
  }

  if (lugares === null) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-muted-foreground">Sem WhatsApp cadastrado</span>
        <Button
          variant="outline"
          size="sm"
          onClick={procurar}
          disabled={procurando}
          className="toque h-11 md:h-8"
        >
          <Search aria-hidden="true" />
          {procurando ? 'Procurando...' : 'Procurar no Google'}
        </Button>
      </div>
    );
  }

  if (lugares.length === 0) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-muted-foreground">O Google não achou esse negócio.</span>
        <Button variant="ghost" size="sm" onClick={procurar} className="toque h-11 md:h-8">
          Procurar de novo
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {lugares.map((lugar) => (
          <li key={lugar.placeId} className="flex flex-col gap-1">
            <span className="text-sm font-medium">{lugar.nome}</span>
            {lugar.endereco ? (
              <span className="text-xs text-muted-foreground">{lugar.endereco}</span>
            ) : null}

            {lugar.telefone ? (
              <span className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="numerico text-sm">{lugar.telefone}</span>
                <Button asChild variant="outline" size="sm" className="toque h-11 md:h-7">
                  <a href={`tel:${lugar.telefone.replace(/\D/g, '')}`}>
                    <Phone aria-hidden="true" />
                    Ligar
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="toque h-11 md:h-7">
                  <a
                    href={`https://wa.me/55${lugar.telefone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle aria-hidden="true" />
                    WhatsApp
                  </a>
                </Button>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Sem telefone público.</span>
            )}
          </li>
        ))}
      </ul>

      {/* A frase que impede o atalho errado. Sem ela, alguém copia o número, cola
          na ficha e o CRM passa a guardar conteúdo do Places — que é exatamente o
          que o contrato proíbe. */}
      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
        Isto veio do Google e{' '}
        <span className="text-foreground">o CRM não pode guardar este número</span>. Ligue,
        confirme com o fornecedor e salve o telefone na ficha — aí ele é dado que ele deu, e não
        cópia do Maps.
      </p>
    </div>
  );
}
