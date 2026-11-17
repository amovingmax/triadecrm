'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  KeyRound,
  Pause,
  Play,
  Plus,
  RotateCw,
  Send,
  Trash2,
  Webhook,
} from 'lucide-react';
import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROTULO_PAPEL, type AppRole } from '@/lib/auth/role';
import { cn } from '@/lib/utils';

import { DialogoConfirmar } from './confirmar';
import {
  Aviso,
  CabecalhoDeSecao,
  Contagem,
  ErroDoPainel,
  EsqueletoLista,
  ListaAdmin,
  Vazio,
  type ColunaAdmin,
} from './estados';
import { formatarDataHora, formatarNumero, mensagemDoErro } from './formatos';
import {
  ativarWebhook,
  carregarEntregas,
  carregarIntegracoes,
  CHAVE_DAS_INTEGRACOES,
  criarChave,
  criarWebhook,
  excluirWebhook,
  revogarChave,
  testarWebhook,
} from './integracoes-dados';
import {
  enderecoDaApi,
  problemaDaUrl,
  resumoDosEscopos,
  rotuloDaEntrega,
  situacaoDaChave,
  situacaoDoWebhook,
  type Chave,
  type Escopo,
  type Evento,
  type PessoaDaGestao,
  type SituacaoDaChave,
  type Webhook as WebhookDaLista,
} from './integracoes-regras';

/**
 * Ajustes → Integrações (17/11/2026, nas duas empresas): a API do CRM.
 *
 * Duas listas: as chaves da API (quem integra chama o CRM) e os avisos para fora
 * (o CRM chama quem integra). A chave e o segredo do webhook aparecem UMA vez, na
 * janela que se abre ao criar; depois disso nem o banco tem como mostrá-los.
 *
 * O manual de quem integra é docs/operacao/api-externa.md; a tela mostra o
 * endereço desta empresa e o essencial.
 */
const ENDERECO = enderecoDaApi(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');

export function PainelIntegracoes({ eu }: { eu: string }) {
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: CHAVE_DAS_INTEGRACOES,
    queryFn: carregarIntegracoes,
    staleTime: 30_000,
  });
  const [criandoChave, setCriandoChave] = useState(false);
  const [criandoWebhook, setCriandoWebhook] = useState(false);
  const [revogando, setRevogando] = useState<Chave | null>(null);
  const [apagando, setApagando] = useState<WebhookDaLista | null>(null);
  const [vendoEntregas, setVendoEntregas] = useState<WebhookDaLista | null>(null);

  const recarregar = () => void cliente.invalidateQueries({ queryKey: CHAVE_DAS_INTEGRACOES });

  const revogar = useMutation({
    mutationFn: (chave: Chave) => revogarChave(chave.id),
    onSuccess: (_r, chave) => {
      toast.success(`A chave “${chave.nome}” foi revogada.`, {
        description: 'A próxima chamada com ela recebe 401.',
      });
      setRevogando(null);
      recarregar();
    },
    onError: (erro) => toast.error('Não deu para revogar.', { description: mensagemDoErro(erro) }),
  });

  const ativar = useMutation({
    mutationFn: ({ w, ativo }: { w: WebhookDaLista; ativo: boolean }) => ativarWebhook(w.id, ativo),
    onSuccess: (_r, { ativo }) => {
      toast.success(ativo ? 'Webhook reativado.' : 'Webhook pausado.', {
        description: ativo ? 'O que ficou pendente nos últimos 3 dias sai agora.' : undefined,
      });
      recarregar();
    },
    onError: (erro) =>
      toast.error('Não deu para mudar o webhook.', { description: mensagemDoErro(erro) }),
  });

  const testar = useMutation({
    mutationFn: (w: WebhookDaLista) => testarWebhook(w.id),
    onSuccess: () => {
      toast.success('Aviso de teste na fila.', {
        description: 'Sai em até 15 segundos. Veja o resultado em “Entregas”.',
      });
      recarregar();
    },
    onError: (erro) => toast.error('Não deu para testar.', { description: mensagemDoErro(erro) }),
  });

  const apagar = useMutation({
    mutationFn: (w: WebhookDaLista) => excluirWebhook(w.id),
    onSuccess: () => {
      toast.success('Webhook apagado.');
      setApagando(null);
      recarregar();
    },
    onError: (erro) => toast.error('Não deu para apagar.', { description: mensagemDoErro(erro) }),
  });

  if (consulta.isPending) return <EsqueletoLista linhas={4} colunas={4} />;
  if (consulta.isError) {
    return (
      <ErroDoPainel
        causa="Não deu para ler as integrações."
        aoTentar={() => void consulta.refetch()}
      />
    );
  }

  const { chaves, webhooks, escopos, eventos, pessoas } = consulta.data;
  const ativas = chaves.filter((c) => !c.revogada_em).length;

  const colunasDasChaves: ColunaAdmin<Chave>[] = [
    {
      id: 'nome',
      rotulo: 'Chave',
      principal: true,
      largura: 'w-[24%]',
      celula: (c) => (
        <span className="flex min-w-0 flex-col">
          <span
            className={cn(
              'truncate font-medium',
              c.revogada_em && 'text-muted-foreground line-through',
            )}
          >
            {c.nome}
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">{c.prefixo}…</span>
        </span>
      ),
    },
    {
      id: 'escopos',
      rotulo: 'Pode',
      largura: 'w-[26%]',
      celula: (c) => <span className="text-sm">{resumoDosEscopos(c.escopos, escopos)}</span>,
    },
    {
      id: 'em_nome_de',
      rotulo: 'Em nome de',
      largura: 'w-[16%]',
      soNoDesktop: true,
      celula: (c) => <span>{c.em_nome_de?.nome ?? '—'}</span>,
    },
    {
      id: 'uso',
      rotulo: 'Uso',
      largura: 'w-[18%]',
      celula: (c) => (
        <span className="flex flex-col gap-0.5 text-sm">
          <span>{c.usada_em ? `Última: ${formatarDataHora(c.usada_em)}` : 'Nunca usada'}</span>
          {c.chamadas_24h > 0 ? (
            <span className="text-xs text-muted-foreground">
              {formatarNumero(c.chamadas_24h)} em 24 h
              {c.erros_24h > 0 ? ` · ${formatarNumero(c.erros_24h)} com erro` : ''}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'situacao',
      rotulo: 'Situação',
      celula: (c) => <Situacao {...situacaoDaChave(c)} />,
    },
  ];

  const colunasDosWebhooks: ColunaAdmin<WebhookDaLista>[] = [
    {
      id: 'url',
      rotulo: 'Para onde',
      principal: true,
      largura: 'w-[30%]',
      celula: (w) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-[13px]" title={w.url}>
            {w.url.replace(/^https:\/\//, '')}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {w.descricao ??
              (w.origem === 'api' ? `Criado pela chave “${w.chave?.nome ?? '?'}”` : '')}
          </span>
        </span>
      ),
    },
    {
      id: 'eventos',
      rotulo: 'Eventos',
      largura: 'w-[24%]',
      celula: (w) => (
        <span className="flex flex-wrap gap-1">
          {w.eventos.map((e) => (
            <code key={e} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
              {e}
            </code>
          ))}
        </span>
      ),
    },
    {
      id: 'entregas',
      rotulo: 'Últimos 7 dias',
      largura: 'w-[16%]',
      soNoDesktop: true,
      celula: (w) => (
        <span className="flex flex-col gap-0.5 text-sm">
          <span>{formatarNumero(w.entregues_7d)} entregues</span>
          {w.falharam_7d > 0 || w.pendentes > 0 ? (
            <span className="text-xs text-muted-foreground">
              {[
                w.falharam_7d > 0 ? `${formatarNumero(w.falharam_7d)} falharam` : null,
                w.pendentes > 0 ? `${formatarNumero(w.pendentes)} na fila` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'situacao',
      rotulo: 'Situação',
      celula: (w) => <Situacao {...situacaoDoWebhook(w)} />,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" aria-label="Chaves da API">
        <CabecalhoDeSecao
          titulo="Chaves da API"
          descricao="Cada sistema que conversa com o CRM (site, ERP, automação) usa a própria chave. Ela age em nome de uma pessoa da gestão e só pode o que foi marcado. Revogar é na hora."
          contagem={<Contagem n={ativas} rotulo={ativas === 1 ? 'ativa' : 'ativas'} />}
          acao={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="toque h-11 md:h-9"
                onClick={() => void consulta.refetch()}
                disabled={consulta.isFetching}
                aria-label="Atualizar"
              >
                <RotateCw
                  className={cn(consulta.isFetching && 'animate-spin')}
                  aria-hidden="true"
                />
              </Button>
              <Button size="sm" className="toque h-11 md:h-9" onClick={() => setCriandoChave(true)}>
                <Plus aria-hidden="true" />
                Nova chave
              </Button>
            </div>
          }
        />

        <div className="flex flex-col gap-1.5 rounded-lg bg-muted/40 p-3 text-sm">
          <span className="text-xs text-muted-foreground">Endereço da API desta empresa</span>
          {/* No celular o endereço inteiro não cabe ao lado do botão: quebra a linha. */}
          <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 font-mono text-[13px] break-all">{ENDERECO}/v1</code>
            <Copiar texto={`${ENDERECO}/v1`} rotulo="Copiar o endereço" />
          </div>
        </div>

        {chaves.length === 0 ? (
          <Vazio
            titulo="Nenhuma chave ainda"
            texto="Crie uma chave para cada sistema que vai falar com o CRM. Ela aparece uma vez só, na hora."
          />
        ) : (
          <ListaAdmin
            colunas={colunasDasChaves}
            linhas={chaves}
            chave={(c) => c.id}
            rotuloDaLista="Chaves da API"
            larguraDasAcoes="w-28"
            acoes={(c) =>
              c.revogada_em ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  className="toque h-11 md:h-8"
                  onClick={() => setRevogando(c)}
                >
                  Revogar
                </Button>
              )
            }
          />
        )}
      </section>

      <section className="flex flex-col gap-4" aria-label="Avisos para fora">
        <CabecalhoDeSecao
          titulo="Avisos para fora (webhooks)"
          descricao="O CRM manda um POST assinado para o endereço escolhido quando o evento acontece. Falhou: tenta de novo por até 3 dias."
          contagem={
            webhooks.length > 0 ? (
              <Contagem
                n={webhooks.length}
                rotulo={webhooks.length === 1 ? 'webhook' : 'webhooks'}
              />
            ) : undefined
          }
          acao={
            <Button size="sm" className="toque h-11 md:h-9" onClick={() => setCriandoWebhook(true)}>
              <Plus aria-hidden="true" />
              Novo webhook
            </Button>
          }
        />
        {webhooks.length === 0 ? (
          <Vazio
            titulo="Nenhum webhook"
            texto="Sem webhook, quem integra pergunta ao CRM de tempos em tempos. Com ele, fica sabendo na hora quando chega lead, mensagem ou muda a etapa."
          />
        ) : (
          <ListaAdmin
            colunas={colunasDosWebhooks}
            linhas={webhooks}
            chave={(w) => w.id}
            rotuloDaLista="Webhooks"
            larguraDasAcoes="w-56"
            acoes={(w) => (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="toque h-11 md:h-8"
                  onClick={() => setVendoEntregas(w)}
                >
                  Entregas
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="toque h-11 md:h-8"
                  onClick={() => testar.mutate(w)}
                  disabled={testar.isPending}
                  aria-label={`Testar ${w.url}`}
                  title="Mandar um aviso de teste"
                >
                  <Send aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="toque h-11 md:h-8"
                  onClick={() => ativar.mutate({ w, ativo: !w.ativo })}
                  disabled={ativar.isPending}
                  aria-label={w.ativo ? `Pausar ${w.url}` : `Reativar ${w.url}`}
                  title={w.ativo ? 'Pausar' : 'Reativar'}
                >
                  {w.ativo ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="toque h-11 md:h-8"
                  onClick={() => setApagando(w)}
                  aria-label={`Apagar ${w.url}`}
                  title="Apagar"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </>
            )}
          />
        )}
      </section>

      <Aviso titulo="Como quem integra usa a chave">
        <p>
          Em todo pedido, o cabeçalho <strong>Authorization: Bearer</strong> seguido da chave. Para
          testar: <code className="text-[12px]">GET {ENDERECO}/v1</code> responde com o nome da
          empresa e em nome de quem a chave age.
        </p>
        <p className="mt-2">
          A chave fica <strong>só no servidor</strong> do sistema que integra: nunca em página de
          site, aplicativo, planilha compartilhada ou mensagem. Desconfiou que vazou, revogue aqui e
          crie outra. O manual completo (rotas, erros, webhooks e a conferência da assinatura) está
          em <strong>docs/operacao/api-externa.md</strong>.
        </p>
      </Aviso>

      <DialogoNovaChave
        aberto={criandoChave}
        aoFechar={() => {
          setCriandoChave(false);
          recarregar();
        }}
        escopos={escopos}
        pessoas={pessoas}
        eu={eu}
      />
      <DialogoNovoWebhook
        aberto={criandoWebhook}
        aoFechar={() => {
          setCriandoWebhook(false);
          recarregar();
        }}
        eventos={eventos}
      />
      <DialogoEntregas webhook={vendoEntregas} aoFechar={() => setVendoEntregas(null)} />
      <DialogoConfirmar
        aberto={revogando !== null}
        aoFechar={() => setRevogando(null)}
        titulo={`Revogar a chave “${revogando?.nome ?? ''}”?`}
        descricao={
          <>
            <p>
              O sistema que usa esta chave para de falar com o CRM na próxima chamada (recebe 401).
              Não dá para desfazer: para voltar, crie uma chave nova e troque no sistema.
            </p>
            {revogando?.usada_em ? (
              <p>Ela foi usada pela última vez em {formatarDataHora(revogando.usada_em)}.</p>
            ) : null}
          </>
        }
        rotuloConfirmar="Revogar"
        perigo
        ocupado={revogar.isPending}
        aoConfirmar={() => revogando && revogar.mutate(revogando)}
      />
      <DialogoConfirmar
        aberto={apagando !== null}
        aoFechar={() => setApagando(null)}
        titulo="Apagar este webhook?"
        descricao={
          <p>
            <strong className="font-mono">{apagando?.url}</strong> deixa de receber avisos, e o que
            estava na fila para ele some. Para só suspender por um tempo, use pausar.
          </p>
        }
        rotuloConfirmar="Apagar"
        perigo
        ocupado={apagar.isPending}
        aoConfirmar={() => apagando && apagar.mutate(apagando)}
      />
    </div>
  );
}

function Situacao({ texto, tom }: SituacaoDaChave) {
  return (
    <span
      className={cn(
        'text-sm',
        tom === 'apagado' && 'text-muted-foreground',
        tom === 'problema' && 'font-medium text-destructive-texto',
      )}
    >
      {texto}
    </span>
  );
}

function Copiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="toque h-11 shrink-0 md:h-8"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          toast.error('O navegador não deixou copiar. Selecione o texto e copie à mão.');
        }
      }}
    >
      {copiado ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copiado ? 'Copiado' : rotulo}
    </Button>
  );
}

/** O que só aparece uma vez: a chave ou o segredo, com o botão de copiar. */
function SoUmaVez({
  titulo,
  valor,
  explicacao,
}: {
  titulo: string;
  valor: string;
  explicacao: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg bg-muted/60 p-3">
        <p className="mb-1.5 text-xs text-muted-foreground">{titulo}</p>
        <code className="block font-mono text-[13px] break-all select-all">{valor}</code>
      </div>
      <Copiar texto={valor} rotulo="Copiar" />
      <Aviso tom="atencao" titulo="Guarde agora: ela não aparece de novo">
        {explicacao}
      </Aviso>
    </div>
  );
}

function Caixa({
  marcado,
  aoMudar,
  titulo,
  descricao,
}: {
  marcado: boolean;
  aoMudar: (v: boolean) => void;
  titulo: React.ReactNode;
  descricao: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md py-1.5 text-sm md:min-h-0">
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-primary"
        checked={marcado}
        onChange={(e) => aoMudar(e.target.checked)}
      />
      <span className="flex flex-col">
        <span className="font-medium">{titulo}</span>
        <span className="text-xs text-muted-foreground">{descricao}</span>
      </span>
    </label>
  );
}

function DialogoNovaChave({
  aberto,
  aoFechar,
  escopos,
  pessoas,
  eu,
}: {
  aberto: boolean;
  aoFechar: () => void;
  escopos: Escopo[];
  pessoas: PessoaDaGestao[];
  eu: string;
}) {
  const [nome, setNome] = useState('');
  const [emNomeDe, setEmNomeDe] = useState(eu);
  const [marcados, setMarcados] = useState<string[]>(['fichas:ler', 'fichas:escrever']);
  const [criada, setCriada] = useState<{ chave: string; nome: string } | null>(null);

  const criar = useMutation({
    mutationFn: () => criarChave(nome.trim(), marcados, emNomeDe),
    onSuccess: (r) => setCriada({ chave: r.chave, nome: nome.trim() }),
    onError: (erro) =>
      toast.error('Não deu para criar a chave.', { description: mensagemDoErro(erro) }),
  });

  const fechar = () => {
    setNome('');
    setMarcados(['fichas:ler', 'fichas:escrever']);
    setEmNomeDe(eu);
    setCriada(null);
    criar.reset();
    aoFechar();
  };

  const pessoaValida = pessoas.some((p) => p.id === emNomeDe);
  const podeCriar =
    nome.trim().length >= 2 && marcados.length > 0 && pessoaValida && !criar.isPending;

  return (
    <Dialog open={aberto} onOpenChange={(estado) => (estado ? null : fechar())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden="true" />
            {criada ? `Chave “${criada.nome}” criada` : 'Nova chave da API'}
          </DialogTitle>
          <DialogDescription>
            {criada
              ? 'Copie a chave e guarde no servidor do sistema que vai integrar.'
              : 'Uma chave por sistema: assim dá para revogar um sem parar os outros.'}
          </DialogDescription>
        </DialogHeader>

        {criada ? (
          <SoUmaVez
            titulo="A chave"
            valor={criada.chave}
            explicacao={
              <>
                O CRM guarda só uma impressão digital dela e não consegue mostrá-la de novo. Perdeu:
                revogue e crie outra.
              </>
            }
          />
        ) : (
          <form
            id="form-nova-chave"
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (podeCriar) criar.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="chave-nome" className="text-xs">
                Nome (o sistema que vai usar)
              </Label>
              <Input
                id="chave-nome"
                placeholder="Site, formulário de contato"
                maxLength={80}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="h-11 md:h-9"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chave-em-nome-de" className="text-xs">
                Age em nome de
              </Label>
              <Select value={pessoaValida ? emNomeDe : undefined} onValueChange={setEmNomeDe}>
                <SelectTrigger id="chave-em-nome-de" className="toque h-11 w-full md:h-9">
                  <SelectValue placeholder="Escolha um admin ou gestor" />
                </SelectTrigger>
                <SelectContent>
                  {pessoas.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome} ({ROTULO_PAPEL[p.papel as AppRole] ?? p.papel})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                O que a chave faz aparece no CRM como feito por essa pessoa (a nota, a mudança de
                etapa, a mensagem assinada com o primeiro nome dela). Se ela sair da gestão, a chave
                para.
              </p>
            </div>
            <fieldset className="space-y-1">
              <legend className="mb-1 text-xs font-medium">Pode</legend>
              {escopos.map((e) => (
                <Caixa
                  key={e.id}
                  marcado={marcados.includes(e.id)}
                  aoMudar={(v) =>
                    setMarcados((atual) => (v ? [...atual, e.id] : atual.filter((x) => x !== e.id)))
                  }
                  titulo={e.nome}
                  descricao={e.descricao}
                />
              ))}
            </fieldset>
          </form>
        )}

        <DialogFooter className="gap-2">
          {criada ? (
            <Button onClick={fechar} className="toque h-11 md:h-9">
              Já guardei
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={fechar} className="toque h-11 md:h-9">
                Cancelar
              </Button>
              <Button
                type="submit"
                form="form-nova-chave"
                disabled={!podeCriar}
                className="toque h-11 md:h-9"
              >
                {criar.isPending ? 'Criando...' : 'Criar chave'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoNovoWebhook({
  aberto,
  aoFechar,
  eventos,
}: {
  aberto: boolean;
  aoFechar: () => void;
  eventos: Evento[];
}) {
  const [url, setUrl] = useState('');
  const [descricao, setDescricao] = useState('');
  const [marcados, setMarcados] = useState<string[]>([]);
  const [tocouUrl, setTocouUrl] = useState(false);
  const [segredo, setSegredo] = useState<string | null>(null);

  const criar = useMutation({
    mutationFn: () => criarWebhook(url, marcados, descricao),
    onSuccess: (r) => setSegredo(r.segredo),
    onError: (erro) =>
      toast.error('Não deu para criar o webhook.', { description: mensagemDoErro(erro) }),
  });

  const fechar = () => {
    setUrl('');
    setDescricao('');
    setMarcados([]);
    setTocouUrl(false);
    setSegredo(null);
    criar.reset();
    aoFechar();
  };

  const problema = problemaDaUrl(url);
  const podeCriar = problema === null && marcados.length > 0 && !criar.isPending;

  return (
    <Dialog open={aberto} onOpenChange={(estado) => (estado ? null : fechar())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Webhook className="size-4" aria-hidden="true" />
            {segredo ? 'Webhook criado' : 'Novo webhook'}
          </DialogTitle>
          <DialogDescription>
            {segredo
              ? 'Copie o segredo: o sistema que recebe usa ele para conferir que o aviso veio do CRM.'
              : 'O endereço que vai receber um POST a cada evento marcado.'}
          </DialogDescription>
        </DialogHeader>

        {segredo ? (
          <SoUmaVez
            titulo="O segredo da assinatura"
            valor={segredo}
            explicacao={
              <>
                Cada aviso chega com o cabeçalho <strong>X-Triade-Assinatura</strong>, um
                HMAC-SHA256 do corpo com este segredo. O código para conferir está no manual da API.
                Perdeu o segredo: apague o webhook e crie outro.
              </>
            }
          />
        ) : (
          <form
            id="form-novo-webhook"
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setTocouUrl(true);
              if (podeCriar) criar.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="webhook-url" className="text-xs">
                Endereço
              </Label>
              <Input
                id="webhook-url"
                type="url"
                inputMode="url"
                placeholder="https://meu-sistema.com.br/crm/avisos"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => setTocouUrl(true)}
                className="h-11 font-mono text-[13px] md:h-9"
                autoComplete="off"
                aria-invalid={tocouUrl && problema !== null}
                aria-describedby="webhook-url-problema"
              />
              {tocouUrl && problema ? (
                <p id="webhook-url-problema" className="text-xs text-destructive-texto">
                  {problema}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="webhook-descricao" className="text-xs">
                Descrição (opcional)
              </Label>
              <Input
                id="webhook-descricao"
                placeholder="ERP financeiro"
                maxLength={200}
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                className="h-11 md:h-9"
              />
            </div>
            <fieldset className="space-y-1">
              <legend className="mb-1 text-xs font-medium">Avisar quando</legend>
              {eventos.map((e) => (
                <Caixa
                  key={e.id}
                  marcado={marcados.includes(e.id)}
                  aoMudar={(v) =>
                    setMarcados((atual) => (v ? [...atual, e.id] : atual.filter((x) => x !== e.id)))
                  }
                  titulo={<code className="text-[12px]">{e.id}</code>}
                  descricao={e.descricao}
                />
              ))}
            </fieldset>
          </form>
        )}

        <DialogFooter className="gap-2">
          {segredo ? (
            <Button onClick={fechar} className="toque h-11 md:h-9">
              Já guardei
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={fechar} className="toque h-11 md:h-9">
                Cancelar
              </Button>
              <Button
                type="submit"
                form="form-novo-webhook"
                disabled={!podeCriar}
                className="toque h-11 md:h-9"
              >
                {criar.isPending ? 'Criando...' : 'Criar webhook'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoEntregas({
  webhook,
  aoFechar,
}: {
  webhook: WebhookDaLista | null;
  aoFechar: () => void;
}) {
  const consulta = useQuery({
    queryKey: [...CHAVE_DAS_INTEGRACOES, 'entregas', webhook?.id],
    queryFn: () => carregarEntregas(webhook!.id),
    enabled: webhook !== null,
    refetchInterval: 10_000,
  });

  return (
    <Dialog open={webhook !== null} onOpenChange={(estado) => (estado ? null : aoFechar())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Entregas recentes</DialogTitle>
          <DialogDescription className="font-mono text-[12px] break-all">
            {webhook?.url}
          </DialogDescription>
        </DialogHeader>
        {consulta.isPending ? (
          <EsqueletoLista linhas={4} colunas={3} />
        ) : consulta.isError ? (
          <ErroDoPainel
            causa="Não deu para ler as entregas."
            aoTentar={() => void consulta.refetch()}
          />
        ) : consulta.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma entrega ainda. Use o botão de teste para mandar a primeira.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline text-sm">
            {consulta.data.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <code className="text-[12px]">{e.evento}</code>
                  <span className="text-xs text-muted-foreground">
                    {formatarDataHora(e.criado_em)}
                  </span>
                </span>
                <span
                  className={cn(
                    e.situacao === 'falhou' && 'font-medium text-destructive-texto',
                    e.situacao === 'pendente' && e.tentativas > 0 && 'text-destructive-texto',
                  )}
                >
                  {rotuloDaEntrega(e)}
                  {e.situacao === 'pendente' && e.tentativas > 0
                    ? ` · próxima às ${formatarDataHora(e.proxima_em)}`
                    : ''}
                </span>
                {e.ultimo_erro && e.situacao !== 'entregue' ? (
                  <span className="text-xs break-words text-muted-foreground">{e.ultimo_erro}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
