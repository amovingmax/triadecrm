'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { Aviso, CabecalhoDeSecao, Vazio } from './estados';
import { mensagemDoErro } from './formatos';

/**
 * Exportar tudo o que o CRM guarda sobre um parceiro (RF-ADM-04).
 *
 * É a resposta a um pedido de titular: "o que vocês têm sobre mim?". O arquivo sai em
 * JSON, com a ficha, as pessoas de contato, os negócios, as atividades, as tarefas e
 * os eventos de consentimento — a mesma coisa que a pessoa veria se abrisse o CRM.
 *
 * Duas honestidades que a tela diz em voz alta, em vez de esconder:
 *
 * 1. O telefone só entra no arquivo se for pedido, e quando é pedido ele passa pela
 *    RPC `reveal_phone`, que grava quem exportou, quando e de quem em `pii_access_log`.
 *    Não existe atalho aqui para ler número sem deixar registro (RF-BAS-14).
 * 2. A exportação em si ainda não vira uma linha de `export_csv` no registro de
 *    acesso: isso depende da Edge Function `export-lgpd` prevista no PRD, que não
 *    existe neste MVP. O arquivo é montado no navegador com o que a sua sessão já
 *    pode ler. Quem exporta com telefone deixa rastro; quem exporta sem telefone,
 *    hoje, não deixa.
 */

type ParceiroEncontrado = {
  id: string;
  nome: string;
  bairro: string | null;
  cidade: string | null;
};

async function procurarParceiros(termo: string): Promise<ParceiroEncontrado[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('organizations_view')
    .select('id, name, neighborhood, city_name')
    .ilike('name', `%${termo}%`)
    .order('name')
    .limit(8);

  if (error) throw new Error(error.message);
  const linhas = (data ?? []) as unknown as {
    id: string;
    name: string;
    neighborhood: string | null;
    city_name: string | null;
  }[];
  return linhas.map((o) => ({
    id: o.id,
    nome: o.name,
    bairro: o.neighborhood,
    cidade: o.city_name,
  }));
}

type Registro = Record<string, unknown>;

async function montarExportacao(
  parceiro: ParceiroEncontrado,
  comTelefone: boolean,
  quemExportou: string,
): Promise<Registro> {
  const supabase = createClient();

  const [ficha, vinculos, negocios, atividades, tarefas, consentimentos] = await Promise.all([
    supabase.from('organizations_view').select('*').eq('id', parceiro.id).maybeSingle(),
    supabase
      .from('organization_contacts')
      .select('contact_id, role, is_primary')
      .eq('organization_id', parceiro.id),
    supabase
      .from('deals')
      .select(
        'id, pipeline_id, stage_id, status, tier, score, temperature, next_action, next_action_at, ' +
          'entered_stage_at, last_activity_at, lost_reason_id, won_at, lost_at, created_at',
      )
      .eq('organization_id', parceiro.id),
    supabase
      .from('activities')
      .select('id, type, channel, occurred_at, duration_min, body, outcome_id, author_kind')
      .eq('organization_id', parceiro.id)
      .order('occurred_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('id, title, kind, status, due_at, completed_at, created_at')
      .eq('organization_id', parceiro.id),
    supabase
      .from('consent_events')
      .select('id, kind, channel, evidence_text, occurred_at, created_at')
      .eq('organization_id', parceiro.id),
  ]);

  if (ficha.error) throw new Error(ficha.error.message);

  const linhaFicha = (ficha.data ?? {}) as unknown as Registro;
  const idsContatos = ((vinculos.data ?? []) as unknown as { contact_id: string }[]).map(
    (v) => v.contact_id,
  );

  let contatos: Registro[] = [];
  if (idsContatos.length > 0) {
    const { data } = await supabase
      .from('contacts_view')
      .select('id, full_name, role_title, is_decision_maker, phone_e164, phone_is_masked, email')
      .in('id', idsContatos);
    contatos = (data ?? []) as unknown as Registro[];
  }

  // O telefone do parceiro só entra pelo caminho auditado, e só quando pedido.
  let telefone: string | null = null;
  if (comTelefone) {
    const { data, error } = await supabase.rpc('reveal_phone', {
      p_organization_id: parceiro.id,
    });
    if (error) throw new Error(error.message);
    telefone = (data as string | null) ?? null;
  }

  return {
    gerado_em: new Date().toISOString(),
    gerado_por: quemExportou,
    aviso:
      'Exportação de dados do titular gerada pelo Tríade (CRM de captação da Komune). ' +
      'Contém o que o CRM guarda sobre este parceiro na data acima. ' +
      (comTelefone
        ? 'O telefone foi revelado pelo caminho auditado e a revelação ficou registrada.'
        : 'O telefone NÃO foi incluído nesta exportação.'),
    parceiro: comTelefone
      ? { ...linhaFicha, phone_e164: telefone }
      : { ...linhaFicha, phone_e164: null },
    contatos,
    negocios: (negocios.data ?? []) as unknown as Registro[],
    atividades: (atividades.data ?? []) as unknown as Registro[],
    tarefas: (tarefas.data ?? []) as unknown as Registro[],
    consentimentos: (consentimentos.data ?? []) as unknown as Registro[],
  };
}

function baixar(nomeDoArquivo: string, conteudo: string) {
  const blob = new Blob([conteudo], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const ancora = document.createElement('a');
  ancora.href = url;
  ancora.download = nomeDoArquivo;
  document.body.appendChild(ancora);
  ancora.click();
  ancora.remove();
  URL.revokeObjectURL(url);
}

function apelido(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function ExportarParceiro({ quemExportou }: { quemExportou: string }) {
  const [termo, setTermo] = useState('');
  const [escolhido, setEscolhido] = useState<ParceiroEncontrado | null>(null);
  const [comTelefone, setComTelefone] = useState(false);
  const [exportando, setExportando] = useState(false);

  const busca = useQuery({
    queryKey: ['admin', 'busca-parceiro', termo.trim()],
    queryFn: () => procurarParceiros(termo.trim()),
    enabled: termo.trim().length >= 2,
  });

  async function exportar() {
    if (!escolhido) return;
    setExportando(true);
    try {
      const dados = await montarExportacao(escolhido, comTelefone, quemExportou);
      const hoje = new Date().toISOString().slice(0, 10);
      baixar(`triade-${apelido(escolhido.nome)}-${hoje}.json`, JSON.stringify(dados, null, 2));
      toast.success('Arquivo gerado.', {
        description: comTelefone
          ? 'O telefone entrou no arquivo e a revelação ficou registrada no seu nome.'
          : 'O telefone ficou de fora do arquivo.',
      });
    } catch (erro) {
      toast.error('Não deu para gerar o arquivo.', { description: mensagemDoErro(erro) });
    } finally {
      setExportando(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <CabecalhoDeSecao
        titulo="Exportar os dados de um parceiro"
        descricao="Para responder a um pedido de titular: tudo o que o CRM guarda sobre um parceiro, num arquivo JSON."
      />

      <Aviso titulo="O que este botão faz hoje, e o que ainda não faz">
        <p>
          O arquivo é montado no seu navegador com o que a sua sessão já pode ler: ficha, pessoas de
          contato, negócios, atividades, tarefas e eventos de consentimento. O telefone só entra se
          você pedir, e quando pede ele passa pela mesma revelação registrada da ficha do parceiro.
        </p>
        <p className="mt-1">
          Ainda <strong>não</strong> é a exportação oficial do PRD: a Edge Function{' '}
          <span className="numerico">export-lgpd</span>, que assina o arquivo e grava a exportação
          no registro de acesso, é da v1 (RF-ADM-04). Até lá, a exportação sem telefone não deixa
          rastro no sistema. Anote no processo do pedido quem exportou e quando.
        </p>
      </Aviso>

      <div className="max-w-md space-y-1.5">
        <Label htmlFor="busca-parceiro" className="text-xs">
          Procurar o parceiro pelo nome
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="busca-parceiro"
            value={termo}
            placeholder="Buffet, DJ, espaço..."
            onChange={(evento) => {
              setTermo(evento.target.value);
              setEscolhido(null);
            }}
            className="h-11 pl-8 md:h-9"
          />
        </div>
      </div>

      {termo.trim().length >= 2 && !escolhido ? (
        busca.isPending ? (
          <p className="text-sm text-muted-foreground">Procurando...</p>
        ) : busca.isError ? (
          <p className="text-sm text-muted-foreground">{mensagemDoErro(busca.error)}</p>
        ) : busca.data.length === 0 ? (
          <Vazio
            titulo="Nenhum parceiro com esse nome"
            texto="A busca aqui é pelo nome cadastrado. Se o pedido veio por telefone, ache o parceiro na tela Parceiros e volte com o nome."
          />
        ) : (
          <ul className="max-w-md">
            {busca.data.map((parceiro) => (
              <li key={parceiro.id} className="border-b border-hairline last:border-0">
                <button
                  type="button"
                  onClick={() => setEscolhido(parceiro)}
                  className={cn(
                    'toque flex min-h-11 w-full flex-col items-start justify-center py-2 text-left',
                    'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  )}
                >
                  <span className="font-medium">{parceiro.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {[parceiro.bairro, parceiro.cidade].filter(Boolean).join(', ') ||
                      'Sem bairro registrado'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {escolhido ? (
        <div className="flex max-w-md flex-col gap-3 rounded-lg bg-muted/40 p-3">
          <div>
            <p className="font-medium">{escolhido.nome}</p>
            <p className="text-xs text-muted-foreground">
              {[escolhido.bairro, escolhido.cidade].filter(Boolean).join(', ') ||
                'Sem bairro registrado'}
            </p>
          </div>

          <label className="flex min-h-11 items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={comTelefone}
              onChange={(evento) => setComTelefone(evento.target.checked)}
              className="mt-1 size-4 accent-foreground"
            />
            <span>
              Incluir o telefone no arquivo.
              <span className="block text-xs text-muted-foreground">
                A revelação fica registrada com o seu nome e a data.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void exportar()}
              disabled={exportando}
              className="toque h-11 md:h-9"
            >
              <Download aria-hidden="true" />
              {exportando ? 'Gerando...' : 'Gerar o arquivo'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEscolhido(null);
                setComTelefone(false);
              }}
              className="toque h-11 md:h-9"
            >
              Escolher outro
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
