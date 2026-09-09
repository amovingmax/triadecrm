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
import { formatarDataHora, mensagemDoErro } from './formatos';

/**
 * Exportar tudo o que o CRM guarda sobre um parceiro (RF-ADM-04).
 *
 * É a resposta a um pedido de titular: "o que vocês têm sobre mim, e de onde tiraram?".
 * Quem monta a resposta é o banco, pela RPC `public.exportar_lgpd(p_organization_id,
 * p_motivo)` — esta tela só escolhe o parceiro, pega o motivo, chama e salva o JSON que
 * voltou, sem tocar em uma vírgula dele.
 *
 * Antes o arquivo era remontado aqui no navegador, com meia dúzia de consultas soltas, e
 * isso dava três defeitos que só apareceriam numa fiscalização — tarde demais:
 *
 * 1. A consulta de contatos trazia telefone e e-mail de todo mundo mesmo com a caixa
 *    "Incluir o telefone" desmarcada. A caixa mascarava o telefone da ficha e deixava o
 *    das pessoas passar.
 * 2. O arquivo ainda AFIRMAVA por escrito que o telefone não tinha entrado. Uma frase
 *    falsa no lugar exato onde alguém conferiria.
 * 3. Exportação sem telefone não deixava rastro nenhum: nem `pii_access_log`, nem nada.
 *    O CRM não tinha o que mostrar sobre o próprio uso da base, e a tela ainda mandava
 *    anotar à mão "fora do sistema" — controle que não existe é controle que não vale.
 *
 * A RPC conserta os três de uma vez: devolve o dossiê com a proveniência campo a campo
 * (a URL exata de onde cada dado veio, quando e por qual ferramenta), grava a exportação
 * em `pii_access_log` com o motivo digitado aqui e abre um `access_request` em
 * `consent_events`. O pedido do titular fica provado dos dois lados.
 *
 * O que se perdeu de propósito, e por quê:
 *
 *   * A caixa "Incluir o telefone" não existe mais. Ela só fazia sentido quando havia
 *     dois caminhos, um auditado e outro não; agora só há o auditado, e o dossiê é a
 *     resposta ao PRÓPRIO titular — esconder dele o telefone dele não protege ninguém.
 *   * Negócios (`deals`) e tarefas (`tasks`) não vêm no dossiê, porque `app.lgpd_dossie`
 *     não os monta. NÃO são remontados aqui: guardar PII num arquivo sem rastro é pior
 *     que exportar menos. Se o time decidir que o titular também tem direito a essa
 *     parte, a correção é acrescentar os dois blocos em `app.lgpd_dossie`, em migração
 *     nova — não neste arquivo, que continuaria exportando por fora do registro.
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

/**
 * Recusas que `public.exportar_lgpd` e `app.lgpd_dossie` nomeiam, em português.
 *
 * A tela não repete a checagem antes de chamar: quem decide quem exporta e se o motivo
 * serve é o banco (ADR-03). Um `if` daqui que barrasse antes só criaria uma segunda
 * regra para divergir da primeira — e seria a regra sem valor legal.
 */
const MOTIVO_DA_EXPORTACAO: Record<string, string> = {
  sem_permissao:
    'O seu acesso não exporta dados de titular. Isso é de gestor, de admin ou de quem responde pelos pedidos de privacidade — peça a quem tem o papel.',
  exportacao_exige_motivo:
    'Escreva o motivo antes de gerar o arquivo. Ele fica guardado junto com a exportação, e é o que explica depois por que estes dados saíram.',
  organizacao_inexistente:
    'Este parceiro não está mais na base. Procure de novo pelo nome; se ele foi anonimizado, não há dossiê a emitir.',
};

function frase(motivo: string): string {
  return (
    MOTIVO_DA_EXPORTACAO[motivo] ??
    'O servidor recusou a exportação e não disse por quê. Nada foi gerado. Avise no grupo do time.'
  );
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor !== '' ? valor : null;
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
  const [motivo, setMotivo] = useState('');
  const [recusa, setRecusa] = useState<string | null>(null);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  const busca = useQuery({
    queryKey: ['admin', 'busca-parceiro', termo.trim()],
    queryFn: () => procurarParceiros(termo.trim()),
    enabled: termo.trim().length >= 2,
  });

  function limparEscolha() {
    setEscolhido(null);
    setMotivo('');
    setRecusa(null);
    setGeradoEm(null);
  }

  async function exportar() {
    if (!escolhido) return;
    setExportando(true);
    setRecusa(null);
    try {
      const supabase = createClient();
      // O motivo vai como foi digitado: quem apara espaço e decide se serve é a RPC.
      const { data, error } = await supabase.rpc('exportar_lgpd', {
        p_organization_id: escolhido.id,
        p_motivo: motivo,
      });
      if (error) throw new Error(error.message);

      const dossie = objeto(data);
      if (dossie.ok !== true) {
        const explicacao = frase(texto(dossie.motivo) ?? 'desconhecido');
        setRecusa(explicacao);
        setGeradoEm(null);
        toast.error('O arquivo não foi gerado.', { description: explicacao });
        return;
      }

      // O que vai para o disco é exatamente o que o banco devolveu. Envelope nenhum:
      // este arquivo é a prova do que foi respondido ao titular, e prova que a tela
      // reescreveu é prova pela metade.
      const hoje = new Date().toISOString().slice(0, 10);
      baixar(
        `dossie-lgpd-${apelido(escolhido.nome)}-${hoje}.json`,
        JSON.stringify(dossie, null, 2),
      );
      setGeradoEm(texto(dossie.gerado_em));
      toast.success('Arquivo gerado, e a exportação ficou registrada.', {
        description: `Consta no registro de acesso em nome de ${quemExportou}, com o motivo que você escreveu.`,
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

      <Aviso titulo="O que entra no arquivo, e o que fica registrado">
        <p>
          Quem monta o arquivo é o banco, não o seu navegador: a ficha com telefone e e-mail, a
          origem de cada campo (de qual link veio, quando e por quem foi coletado), as pessoas de
          contato, as autorizações, as conversas, o pré-cadastro, com quem os dados são
          compartilhados e por quanto tempo ficam guardados.
        </p>
        <p className="mt-1">
          Toda exportação fica <strong>registrada</strong> com o seu nome, a data e o motivo que
          você escrever, e abre um pedido de acesso no histórico do parceiro. Aqui não há caminho
          para levar dado embora sem deixar rastro — e não é preciso anotar nada por fora.
        </p>
        <p className="mt-1">
          Negócios e tarefas ficam de fora: o dossiê que o banco monta hoje não os inclui, e esta
          tela não remonta dado por conta própria. Se a resposta ao titular precisar deles, a
          mudança é no banco.
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
              limparEscolha();
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

          <div className="space-y-1.5">
            <Label htmlFor="motivo-da-exportacao" className="text-xs">
              Motivo da exportação
            </Label>
            <Input
              id="motivo-da-exportacao"
              value={motivo}
              placeholder="Pedido do titular por e-mail"
              onChange={(evento) => {
                setMotivo(evento.target.value);
                setRecusa(null);
              }}
              className="h-11 md:h-9"
            />
            <p className="text-xs text-muted-foreground">
              Escreva por que os dados estão saindo, em uma linha. Isso fica guardado junto com a
              exportação e no histórico do parceiro — é o que responde, meses depois, quem exportou
              e a pedido de quem.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void exportar()}
              disabled={exportando}
              className="toque h-11 md:h-9"
            >
              <Download aria-hidden="true" />
              {exportando ? 'Gerando...' : 'Gerar o arquivo'}
            </Button>
            <Button variant="outline" onClick={limparEscolha} className="toque h-11 md:h-9">
              Escolher outro
            </Button>
          </div>

          {recusa ? (
            <p className="text-sm" role="alert">
              {recusa}
            </p>
          ) : null}

          {geradoEm ? (
            <p className="text-sm text-muted-foreground">
              Arquivo gerado em {formatarDataHora(geradoEm)} e registrado no seu nome. Guarde-o no
              processo do pedido; o CRM já guardou a prova de que ele saiu.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
