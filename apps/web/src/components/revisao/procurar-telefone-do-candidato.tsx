'use client';

import { useState } from 'react';
import { Phone, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Procurar no Google o telefone de um candidato da fila.
 *
 * ===========================================================================
 * POR QUE ISTO ESTÁ NA FILA, E NÃO SÓ NA FICHA DO PARCEIRO
 * ===========================================================================
 * A fila tinha 277 candidatos e UM telefone — e não há caminho de raspagem
 * legal para conseguir o resto (o robots.txt de cada fonte foi lido em
 * 17/09/2026; a conclusão está na rota `/api/telefone/candidato`). O que resta é
 * o que o R03 §2.4 prescreveu: o Places como gatilho de DESCOBERTA.
 *
 * Isso já existia na ficha do parceiro — só que a ficha só nasce DEPOIS de
 * alguém aprovar o candidato. Quem está revisando a fila, decidindo se vale a
 * pena, precisa da informação ANTES: "existe telefone público para este nome?"
 * é parte da decisão, não consequência dela.
 *
 * ===========================================================================
 * O QUE ELE MOSTRA, E O QUE ELE NUNCA FAZ
 * ===========================================================================
 * Mostra o que o Google devolveu e para por aí. Não copia para lugar nenhum, não
 * preenche campo, não guarda. Os Termos do Places proíbem armazenar o conteúdo
 * (só o `place_id`), e um "salvar" aqui seria o botão proibido com outro nome.
 * O número vira dado do CRM quando o fornecedor confirmar — pela boca dele.
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
  sem_candidato: 'Faltou dizer qual candidato.',
  candidato_invisivel: 'Este candidato não está mais no seu alcance.',
  consulta_falhou: 'Não deu para ler o candidato agora.',
  nao_contatar: 'Este candidato pediu para não ser contatado.',
  ja_tem_telefone: 'Este candidato já tem telefone.',
  nao_configurado: 'A busca no Google ainda não foi configurada no servidor. Fale com Luiz ou Matheus.',
};

export function ProcurarTelefoneDoCandidato({
  candidatoId,
  className,
}: {
  candidatoId: string;
  className?: string;
}) {
  const [procurando, setProcurando] = useState(false);
  const [lugares, setLugares] = useState<Lugar[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function procurar() {
    setProcurando(true);
    setErro(null);
    try {
      const resposta = await fetch('/api/telefone/candidato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidato_id: candidatoId }),
      });
      const corpo = (await resposta.json().catch(() => ({}))) as {
        ok?: boolean;
        motivo?: string;
        recado?: string;
        lugares?: Lugar[];
      };
      if (!resposta.ok || !corpo.ok) {
        setErro(corpo.recado ?? RECADO[corpo.motivo ?? ''] ?? 'A busca não funcionou agora.');
        return;
      }
      setLugares(corpo.lugares ?? []);
    } catch {
      setErro('A busca não funcionou agora. Tente de novo.');
    } finally {
      setProcurando(false);
    }
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {lugares === null ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="toque h-11 md:h-7"
          disabled={procurando}
          onClick={() => void procurar()}
        >
          <Search aria-hidden="true" />
          {procurando ? 'Procurando...' : 'Procurar telefone'}
        </Button>
      ) : lugares.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          O Google não achou este nome em Natal. Pode ser um negócio sem endereço fixo — ou o nome
          na fonte estar diferente do nome de porta.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {lugares.slice(0, 3).map((l) => (
            <li
              key={l.placeId}
              className="rounded-lg border border-hairline bg-card/60 px-2.5 py-1.5 text-[11px] leading-relaxed"
            >
              <span className="font-medium">{l.nome}</span>
              {l.endereco ? <span className="text-muted-foreground"> · {l.endereco}</span> : null}
              {l.telefone ? (
                <span className="mt-0.5 flex items-center gap-1 font-medium">
                  <Phone className="size-3" aria-hidden="true" />
                  <span className="numerico">{l.telefone}</span>
                </span>
              ) : (
                <span className="mt-0.5 block text-muted-foreground">sem telefone público</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {erro ? <p className="text-[11px] leading-relaxed text-muted-foreground">{erro}</p> : null}

      {lugares !== null && lugares.length > 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Veio do Google e fica só aqui: confirme com o fornecedor e digite o número ao aprovar. O
          CRM não guarda o que o Google devolve.
        </p>
      ) : null}
    </div>
  );
}
