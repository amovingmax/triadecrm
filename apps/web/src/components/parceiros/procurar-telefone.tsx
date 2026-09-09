'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { normalizePhoneBr } from '@komune/schema';
import { MessageCircle, Phone, Search } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { formatarTelefone } from './formatos';

/**
 * A ficha que não tem telefone: procurar um no Google, e gravar o que o fornecedor
 * confirmar.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO GANHOU UM CAMPO DE SALVAR
 * ---------------------------------------------------------------------------
 * A versão anterior explicava, com razão, por que NÃO existe um botão que copia o
 * resultado do Google para a ficha: os Termos do Places proíbem o CRM armazenar o
 * conteúdo que ele devolve (só o `place_id`), e o anexo R03 §2.4 prescreve o uso
 * que sobra — Places é gatilho de DESCOBERTA, e o dado definitivo vem do próprio
 * fornecedor. Esse argumento continua valendo inteiro, e é por isso que aqui não
 * existe "copiar para a ficha", nem preenchimento automático: o campo abaixo nasce
 * VAZIO mesmo com um número na tela logo acima. Prefiller seria o botão proibido
 * com outro nome.
 *
 * O que estava errado era a outra metade da frase. A tela mandava "salve o telefone
 * na ficha pelo caminho de sempre" — e o caminho de sempre não existia. A ficha do
 * parceiro não tem edição em lugar nenhum do produto; a única porta que aceita um
 * telefone é o cadastro rápido, que CRIA UM PARCEIRO NOVO. Seguir a instrução ao pé
 * da letra produzia exatamente a duplicata que o resto do sistema gasta índice único
 * parcial, dedup por trigrama e fila de revisão para evitar. Uma instrução verdadeira
 * era o mínimo; o campo é o que a torna possível.
 *
 * A gravação não inventa regra nenhuma: escreve em `public.organizations_view`, cuja
 * trigger `INSTEAD OF` já decide quem pode editar (gestor, admin ou o responsável),
 * `app.organizations_normalize` já normaliza e recusa número inválido, o índice
 * `organizations_phone_uq` já barra o número que é de outra ficha, e o gatilho de
 * auditoria já registra a mudança. A tela só traduz a recusa para uma frase que diz
 * o que fazer.
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

  return (
    <div className="flex flex-col items-start gap-3">
      {lugares === null ? (
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
      ) : lugares.length === 0 ? (
        <div className="flex flex-col items-start gap-1.5">
          <span className="text-muted-foreground">O Google não achou esse negócio.</span>
          <Button variant="ghost" size="sm" onClick={procurar} className="toque h-11 md:h-8">
            Procurar de novo
          </Button>
        </div>
      ) : (
        <Resultados lugares={lugares} />
      )}

      {/* O campo fica em todos os três estados, e não só depois de uma busca: uma ficha
          sem telefone pode ganhar o número por uma indicação no grupo, por um cartão
          recebido na rua ou por uma ligação que a pessoa já fez — nenhum desses passa
          pelo Places, e nenhum deles tinha porta antes. */}
      <SalvarTelefone organizationId={organizationId} />
    </div>
  );
}

/** O que o Places devolveu: para a tela e para a ligação, nunca para o banco. */
function Resultados({ lugares }: { lugares: Lugar[] }) {
  return (
    <div className="flex w-full flex-col gap-3">
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

      {/* A frase que impede o atalho errado. Sem ela, alguém copia o número achando que
          está sendo esperto e o CRM passa a guardar conteúdo do Places, que é o que o
          contrato proíbe. Ela agora aponta para uma porta que existe — antes mandava
          "salvar na ficha" num produto onde a ficha não tinha edição, e o único jeito
          de obedecer era cadastrar o parceiro de novo. */}
      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
        Isto veio do Google e{' '}
        <span className="text-foreground">o CRM não pode guardar este número</span>. Ligue,
        confirme com o fornecedor e digite abaixo o número que ele confirmar — aí ele é dado
        que ele deu, e não cópia do Maps.
      </p>
    </div>
  );
}

/** A ficha apontada pelo índice único: quem já tem o número que se tentou salvar. */
type FichaDona = { id: string; nome: string };

function SalvarTelefone({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const campo = useId();
  const dica = `${campo}-dica`;
  const [aberto, setAberto] = useState(false);
  const [digitado, setDigitado] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [dona, setDona] = useState<FichaDona | null>(null);

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setDona(null);

    // O mesmo normalizador que o Postgres roda (`app.normalize_phone_br`, espelhado em
    // packages/schema com teste de paridade): recusar aqui poupa uma ida ao servidor e
    // manda o número no formato exato que o índice único vai comparar.
    const e164 = normalizePhoneBr(digitado);
    if (!e164) {
      setErro('WhatsApp inválido: use DDD + número (ex.: (84) 99999-1234).');
      return;
    }

    setSalvando(true);
    const supabase = createClient();
    // `organizations_view`, e não `organizations`: sdr e embaixador não têm política de
    // escrita na tabela base, e é a trigger INSTEAD OF da view que checa o papel e a
    // carteira. O `select` de volta existe para distinguir "gravou" de "nenhuma linha
    // bateu com o filtro" — sem ele, uma ficha que saiu da visibilidade da pessoa no
    // meio do caminho responderia sucesso sem ter gravado nada.
    const { data, error } = await supabase
      .from('organizations_view')
      .update({ phone_e164: e164 })
      .eq('id', organizationId)
      .select('id');
    setSalvando(false);

    if (!error && (data?.length ?? 0) > 0) {
      toast.success('Telefone salvo na ficha.', { description: formatarTelefone(e164) });
      setAberto(false);
      setDigitado('');
      // A ficha é renderizada no servidor: sem o refresh, o número gravado só
      // apareceria na próxima navegação.
      router.refresh();
      return;
    }

    if (!error) {
      setErro('Esta ficha não está mais no seu acesso. Recarregue a página.');
      return;
    }

    switch (error.code) {
      // organizations_phone_uq. Cadastrar de novo é o erro que este produto mais
      // trabalha para evitar, então a recusa precisa levar à ficha certa.
      case '23505': {
        const encontrada = await fichaComOTelefone(e164, organizationId);
        if (encontrada) {
          setDona(encontrada);
        } else {
          setErro(
            'Esse número já é de outro parceiro, e a ficha dele está fora do seu acesso. ' +
              'Peça ao gestor para transferir ou para juntar as duas.',
          );
        }
        return;
      }
      // `app.organizations_normalize` recusando o número (errcode 23514).
      case '23514':
        setErro('WhatsApp inválido: use DDD + número (ex.: (84) 99999-1234).');
        return;
      // A trigger da view recusando por papel ou por carteira.
      case '42501':
        setErro(
          'Só o responsável pela ficha, o gestor ou o admin salva telefone aqui. ' +
            'Peça ao gestor para passar a ficha para você.',
        );
        return;
      default:
        setErro(`Não deu para salvar (${error.message}). Confira a conexão e tente de novo.`);
    }
  }

  if (!aberto) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setAberto(true)}
        className="toque h-11 px-2 md:h-8"
      >
        Tenho o número: salvar na ficha
      </Button>
    );
  }

  return (
    <form
      onSubmit={(e) => void salvar(e)}
      className="flex w-full max-w-sm flex-col gap-1.5"
      noValidate
    >
      <Label htmlFor={campo}>WhatsApp confirmado com o parceiro</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={campo}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          enterKeyHint="done"
          autoFocus
          placeholder="(84) 99999-1234"
          value={digitado}
          onChange={(e) => setDigitado(e.target.value)}
          aria-invalid={Boolean(erro || dona)}
          aria-describedby={erro || dona ? undefined : dica}
          className="numerico h-11 w-48 md:h-9"
        />
        <Button type="submit" size="sm" disabled={salvando} className="toque h-11 md:h-9">
          {salvando ? 'Salvando...' : 'Salvar'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setAberto(false);
            setErro(null);
            setDona(null);
          }}
          className="toque h-11 md:h-9"
        >
          Cancelar
        </Button>
      </div>

      {dona ? (
        <div
          role="alert"
          className="mt-1 rounded-xl border border-border bg-muted/40 p-3 text-sm"
        >
          <p className="font-medium">Esse número já é de {dona.nome}</p>
          <p className="mt-0.5 text-muted-foreground">
            O CRM não guarda o mesmo WhatsApp em duas fichas. Confira se não é o mesmo parceiro
            cadastrado duas vezes.
          </p>
          <Link
            href={`/parceiros/${dona.id}`}
            className="mt-2 inline-flex h-9 items-center rounded-lg px-2 font-medium underline underline-offset-4"
          >
            Abrir a ficha de {dona.nome}
          </Link>
        </div>
      ) : erro ? (
        <p role="alert" className="text-sm text-destructive-texto">
          {erro}
        </p>
      ) : (
        <p id={dica} className="text-xs text-muted-foreground">
          Com DDD, do jeito que o parceiro passou.
        </p>
      )}
    </form>
  );
}

/**
 * De quem é o número que o índice único recusou.
 *
 * `search_organizations` é a mesma busca da lista: casa o telefone por igualdade para
 * todo mundo (o "contém" é que fica reservado a quem lê o telefone de base) e aplica
 * `app.org_is_visible`. Quando não devolve nada, a ficha existe mas está fora do
 * acesso desta pessoa — e é isso que a mensagem de recusa passa a dizer, em vez de um
 * "número duplicado" que não leva a lugar nenhum.
 */
async function fichaComOTelefone(e164: string, exceto: string): Promise<FichaDona | null> {
  const supabase = createClient();
  const { data } = await supabase.rpc('search_organizations', { q: e164, p_limit: 5 });
  const linhas = (data ?? []) as unknown as { id: string; name: string }[];
  const achada = linhas.find((l) => l.id !== exceto);
  return achada ? { id: achada.id, nome: achada.name } : null;
}
