'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { CHAVE_DOS_ANUNCIOS } from '../dados';
import {
  chamarComIA,
  custoDoChamado,
  enderecoDoChamado,
  fraseDoMotivoDoChamado,
  lerPreviaDoChamado,
  problemaDoImovel,
  problemaDoNome,
  textoDoChamado,
  TETO_DO_IMOVEL,
  TETO_DO_NOME,
  type PreviaDoChamado,
} from './chamar-com-a-ia';
import { CHAVE_DOS_LEADS } from './leads-dados';
import type { LeadDoPortal } from './leads-rotulos';

/**
 * O botão "Chamar com a IA" da ficha do lead (27/11/2026). Abre o diálogo com a
 * mensagem exata, o nome e o trecho do imóvel para conferir, e o custo. Só manda
 * com o clique em "Mandar mensagem"; quem decide se pode é o banco.
 */
export function BotaoChamarComIA({
  lead,
  disabled,
}: {
  lead: Pick<LeadDoPortal, 'id'>;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button
        type="button"
        className="toque h-11 md:h-9"
        disabled={disabled}
        onClick={() => setAberto(true)}
      >
        <Sparkles aria-hidden="true" />
        Chamar com a IA
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          {aberto ? <ConteudoDoChamado leadId={lead.id} aoFechar={() => setAberto(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConteudoDoChamado({ leadId, aoFechar }: { leadId: string; aoFechar: () => void }) {
  const previa = useQuery({
    queryKey: [...CHAVE_DOS_LEADS, 'chamar', leadId],
    queryFn: () => lerPreviaDoChamado(leadId),
    staleTime: 0,
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Chamar com a IA</DialogTitle>
        <DialogDescription>
          Vai pelo WhatsApp da Imova a mensagem abaixo. Se a pessoa responder, a IA continua a
          conversa.
        </DialogDescription>
      </DialogHeader>
      {previa.isPending ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Preparando a mensagem...</p>
      ) : previa.data?.ok ? (
        <Formulario key={leadId} leadId={leadId} previa={previa.data.previa} aoFechar={aoFechar} />
      ) : (
        <>
          <p className="text-sm text-destructive-texto">
            {fraseDoMotivoDoChamado(previa.data?.ok === false ? previa.data.motivo : null)}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="toque h-11 md:h-9"
              onClick={aoFechar}
            >
              Voltar
            </Button>
          </DialogFooter>
        </>
      )}
    </>
  );
}

function Formulario({
  leadId,
  previa,
  aoFechar,
}: {
  leadId: string;
  previa: PreviaDoChamado;
  aoFechar: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const cliente = useQueryClient();
  const [nome, setNome] = useState(previa.nome);
  const [imovel, setImovel] = useState(previa.imovelVisto);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const problemaNome = problemaDoNome(nome);
  const problemaImovel = problemaDoImovel(imovel);
  const pode = previa.pode && !problemaNome && !problemaImovel && !ocupado;

  async function mandar() {
    setOcupado(true);
    setErro(null);
    const r = await chamarComIA(leadId, nome, imovel);
    setOcupado(false);
    void cliente.invalidateQueries({ queryKey: CHAVE_DOS_ANUNCIOS });
    if (!r.ok) {
      setErro(fraseDoMotivoDoChamado(r.motivo, r.quando));
      return;
    }
    aoFechar();
    const endereco = enderecoDoChamado(r.conversationId, r.organizationId);
    toast.success('Mensagem enviada. Quando a pessoa responder, a IA continua a conversa.', {
      action: { label: 'Abrir conversa', onClick: () => router.push(endereco) },
    });
  }

  return (
    <>
      {!previa.pode ? (
        <p className="rounded-lg bg-morno-fundo px-3 py-2 text-sm text-morno-texto">
          {fraseDoMotivoDoChamado(previa.motivo)}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-nome`} className="text-sm font-medium">
          Nome
        </label>
        <Input
          id={`${id}-nome`}
          value={nome}
          maxLength={TETO_DO_NOME + 10}
          onChange={(e) => setNome(e.target.value)}
          aria-invalid={problemaNome !== null}
          aria-describedby={problemaNome ? `${id}-nome-erro` : undefined}
          className="h-11 text-base md:h-9 md:text-sm"
        />
        {problemaNome ? (
          <p id={`${id}-nome-erro`} className="text-xs text-destructive-texto">
            {problemaNome}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-imovel`} className="text-sm font-medium">
          O imóvel, como aparece na frase
        </label>
        <textarea
          id={`${id}-imovel`}
          rows={2}
          maxLength={TETO_DO_IMOVEL + 20}
          value={imovel}
          onChange={(e) => setImovel(e.target.value)}
          aria-invalid={problemaImovel !== null}
          aria-describedby={`${id}-imovel-dica`}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base md:text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <p id={`${id}-imovel-dica`} className="text-xs text-muted-foreground">
          {problemaImovel ?? 'Comece com “no” ou “na”: “no terreno de 3.000 m² em Capim Macio”.'}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Como chega no WhatsApp</p>
        <p className="rounded-lg rounded-tl-none bg-muted px-3 py-2 text-sm leading-relaxed">
          {textoDoChamado(nome, imovel)}
        </p>
        <p className="text-xs text-muted-foreground">
          Custo: {custoDoChamado(previa.categoria)}. Sem resposta, nada mais é enviado.
        </p>
      </div>

      {erro ? (
        <p role="alert" className="text-sm text-destructive-texto">
          {erro}
        </p>
      ) : null}

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          className="toque h-11 md:h-9"
          onClick={aoFechar}
          disabled={ocupado}
        >
          Voltar
        </Button>
        <Button
          type="button"
          className="toque h-11 md:h-9"
          onClick={() => void mandar()}
          disabled={!pode}
        >
          <Sparkles aria-hidden="true" />
          {ocupado ? 'Mandando...' : 'Mandar mensagem'}
        </Button>
      </DialogFooter>
    </>
  );
}
