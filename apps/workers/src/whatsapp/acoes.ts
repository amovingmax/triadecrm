/**
 * AS AÇÕES QUE NÃO SÃO MENSAGEM (27/10/2026).
 *
 * Pedido do Rafael: "quero todas as funcionalidades do wpp no nosso CRM". Boa
 * parte delas é uma chamada à Graph API que não manda mensagem nenhuma:
 * marcar como lida, "digitando…", bloquear, os grupos e o perfil da empresa.
 * A tela pede em `public.wa_acoes` (só pelas funções do banco); este arquivo
 * faz, e devolve o resultado para `public.wa_acao_concluir` ou
 * `public.wa_acao_falhar`. O que cada resultado muda no banco é do banco
 * (`app.wa_acao_efeito`), não daqui.
 *
 * Roda num laço próprio, de 2 em 2 segundos, e não no laço das mensagens: o
 * laço das mensagens pode passar três minutos parado no intervalo entre
 * aberturas, e um "digitando…" que chega três minutos depois não serve para
 * nada.
 *
 * A tabela de "vale tentar de novo?" é a mesma do envio (`graph.ts`): o que a
 * Meta diz que é passageiro volta para a fila com espera; o resto falha de vez
 * com a frase dela, que a tela mostra.
 */
import type { ClienteDaGraph, Envio, FalhaDaGraph, RespostaDaGraph } from './graph';
import {
  acaoConcluida,
  acaoFalhou,
  proximasAcoes,
  type AcaoDoWhatsapp,
  type ClienteDoBanco,
} from './ponte';
import { subirOArquivo } from './saida';

import type { Logger } from '../lib/log';

const BALDE = 'mensagens';

export interface ContextoDasAcoes {
  cliente: ClienteDoBanco;
  graph: ClienteDaGraph;
  logger: Logger;
  phoneNumberId: string;
  /** O app da Meta: só a foto do perfil precisa dele (upload retomável). */
  appId?: string | undefined;
}

/** O que uma ação devolve: resultado para o banco, ou a falha com a decisão. */
type Desfecho =
  | { ok: true; resultado: Record<string, unknown> }
  | { ok: false; codigo: string; erro: string; retentar: boolean };

function falha(f: FalhaDaGraph): Desfecho {
  return { ok: false, codigo: f.codigo, erro: f.mensagem, retentar: f.retentar };
}

function deVez(codigo: string, erro: string): Desfecho {
  return { ok: false, codigo, erro, retentar: false };
}

function deu(r: RespostaDaGraph): Desfecho {
  return r.ok ? { ok: true, resultado: r.json } : falha(r);
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function listaDeTextos(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).flatMap((x) => {
    const t = texto(x);
    return t ? [t] : [];
  });
}

/**
 * O bloqueio responde 200 mesmo quando o número não entrou na lista (quem não
 * escreveu nas últimas 24 h): o motivo vem em `failed_users`.
 */
export function falhaDoBloqueio(json: Record<string, unknown>): string | null {
  const bloco = json.block_users;
  if (typeof bloco !== 'object' || bloco === null) return null;
  const falhos = (bloco as { failed_users?: unknown }).failed_users;
  if (!Array.isArray(falhos) || falhos.length === 0) return null;
  const primeiro = falhos[0] as { errors?: { message?: unknown; error_data?: { details?: unknown } }[] };
  const erro = Array.isArray(primeiro?.errors) ? primeiro.errors[0] : undefined;
  return (
    texto(erro?.error_data?.details) ??
    texto(erro?.message) ??
    'A Meta não bloqueou este número (ela só bloqueia quem escreveu nas últimas 24 h).'
  );
}

async function baixar(
  ctx: ContextoDasAcoes,
  caminho: string,
): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; erro: string }> {
  const { data, error } = await ctx.cliente.storage.from(BALDE).download(caminho);
  if (error || !data) return { ok: false, erro: error?.message ?? 'arquivo sem corpo' };
  return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type || 'image/jpeg' };
}

/** Uma ação. Nunca lança por causa da Meta: lança só se o banco cair. */
export async function fazerAcao(ctx: ContextoDasAcoes, a: AcaoDoWhatsapp): Promise<Desfecho> {
  const g = ctx.graph;
  const grupo = a.group_id;
  const precisaDoGrupo = a.tipo.startsWith('grupo_') && a.tipo !== 'grupo_criar';
  if (precisaDoGrupo && grupo === null) {
    return deVez('grupo_sem_id', 'O grupo ainda não existe na Meta.');
  }

  switch (a.tipo) {
    case 'ler':
    case 'digitando': {
      const wamid = texto(a.dados.wamid);
      if (wamid === null) return deVez('sem_wamid', 'Sem mensagem recebida para marcar.');
      return deu(await g.marcarLida(wamid, a.tipo === 'digitando'));
    }

    case 'bloquear':
    case 'desbloquear': {
      const para = texto(a.dados.para) ?? a.para;
      if (para === null) return deVez('sem_numero', 'A conversa está sem número.');
      const r = await g.bloquear([para], a.tipo === 'bloquear');
      if (!r.ok) return falha(r);
      const motivo = falhaDoBloqueio(r.json);
      return motivo === null ? { ok: true, resultado: r.json } : deVez('bloqueio_recusado', motivo);
    }

    case 'grupo_criar': {
      const aprovacao = texto(a.dados.aprovacao) ?? 'approval_required';
      const descricao = texto(a.dados.descricao);
      const r = await g.publicar(`${ctx.phoneNumberId}/groups`, {
        messaging_product: 'whatsapp',
        subject: texto(a.dados.assunto) ?? 'Grupo',
        ...(descricao ? { description: descricao } : {}),
        join_approval_mode: aprovacao,
      });
      if (!r.ok) return falha(r);
      // O id do grupo e o link de convite chegam pelo webhook
      // `group_lifecycle_update`, casado pelo `request_id`.
      return {
        ok: true,
        resultado: {
          request_id: texto(r.json.request_id) ?? texto(r.json.id),
          id: texto(r.json.group_id),
        },
      };
    }

    case 'grupo_atualizar': {
      const foto = texto(a.dados.foto_path);
      if (foto !== null) {
        const arquivo = await baixar(ctx, foto);
        if (!arquivo.ok) return { ok: false, codigo: 'foto_nao_lida', erro: arquivo.erro, retentar: true };
        const r = await g.publicarArquivo(
          `${grupo}`,
          { messaging_product: 'whatsapp' },
          { bytes: arquivo.bytes, mime: 'image/jpeg', nome: 'grupo.jpg' },
        );
        if (!r.ok) return falha(r);
      }
      const assunto = texto(a.dados.assunto);
      const temDescricao = typeof a.dados.descricao === 'string';
      if (assunto !== null || temDescricao) {
        const r = await g.publicar(`${grupo}`, {
          messaging_product: 'whatsapp',
          ...(assunto !== null ? { subject: assunto } : {}),
          ...(temDescricao ? { description: a.dados.descricao } : {}),
        });
        if (!r.ok) return falha(r);
      }
      return { ok: true, resultado: {} };
    }

    case 'grupo_apagar':
      return deu(await g.remover(`${grupo}`));

    case 'grupo_convite':
      return deu(await g.ler(`${grupo}/invite_link`));

    case 'grupo_novo_convite':
      return deu(await g.publicar(`${grupo}/invite_link`, { messaging_product: 'whatsapp' }));

    case 'grupo_pedidos':
      return deu(await g.ler(`${grupo}/join_requests`));

    case 'grupo_aprovar':
    case 'grupo_recusar': {
      const pedidos = listaDeTextos(a.dados.pedidos);
      if (pedidos.length === 0) return deVez('nenhum_pedido', 'Nenhum pedido para decidir.');
      const corpo = { messaging_product: 'whatsapp', join_requests: pedidos };
      return deu(
        a.tipo === 'grupo_aprovar'
          ? await g.publicar(`${grupo}/join_requests`, corpo)
          : await g.remover(`${grupo}/join_requests`, corpo),
      );
    }

    case 'grupo_remover': {
      const pessoas = listaDeTextos(a.dados.wa_ids);
      if (pessoas.length === 0) return deVez('ninguem', 'Ninguém para tirar do grupo.');
      return deu(
        await g.remover(`${grupo}/participants`, {
          messaging_product: 'whatsapp',
          participants: pessoas.map((user) => ({ user })),
        }),
      );
    }

    case 'grupo_sincronizar':
      return deu(
        await g.ler(`${grupo}`, {
          fields:
            'subject,description,join_approval_mode,suspended,creation_timestamp,participants,total_participant_count',
        }),
      );

    case 'grupo_fixar': {
      const wamid = texto(a.dados.wamid);
      if (wamid === null) return deVez('sem_wamid', 'A mensagem não tem id na Meta.');
      const dias = typeof a.dados.dias === 'number' ? a.dados.dias : null;
      return deu(
        await g.publicar(`${ctx.phoneNumberId}/messages`, {
          messaging_product: 'whatsapp',
          recipient_type: 'group',
          to: grupo,
          type: 'pin',
          pin:
            dias === null
              ? { type: 'unpin', message_id: wamid }
              : { type: 'pin', message_id: wamid, expiration_days: dias },
        }),
      );
    }

    case 'grupo_enviar':
      return enviarNoGrupo(ctx, a, grupo as string);

    case 'perfil_ler':
      return lerPerfil(ctx);

    case 'perfil_salvar':
      return salvarPerfil(ctx, a);

    default:
      return deVez('acao_desconhecida', `O worker não sabe fazer "${a.tipo}".`);
  }
}

/** A mensagem do grupo: o mesmo envio do 1:1, com `recipient_type: group`. */
async function enviarNoGrupo(ctx: ContextoDasAcoes, a: AcaoDoWhatsapp, grupo: string): Promise<Desfecho> {
  const m = a.mensagem;
  if (m === null) return deVez('mensagem_inexistente', 'A mensagem do grupo sumiu.');
  if (m.ainda_vale !== true) return deVez('cancelada', 'Apagada antes de sair.');

  const tipo = texto(m.type) ?? 'text';
  const corpo = texto(m.body);
  const responde = texto(m.responde_a_wamid);
  const destino = { para: grupo, grupo: true, ...(responde ? { responde } : {}) };

  let envio: Envio;
  if (tipo === 'text') {
    if (corpo === null) return deVez('mensagem_sem_corpo', 'A mensagem está sem texto.');
    envio = { ...destino, tipo: 'texto', corpo };
  } else {
    const qual =
      tipo === 'image' ? 'imagem' : tipo === 'video' ? 'video' : tipo === 'audio' ? 'audio' : 'documento';
    const subida = await subirOArquivo(
      { cliente: ctx.cliente, graph: ctx.graph },
      { media_path: texto(m.media_path), media_mime: texto(m.media_mime), media_nome: texto(m.media_nome) },
      qual,
    );
    if (!subida.ok) {
      return { ok: false, codigo: subida.codigo, erro: subida.motivo, retentar: subida.retentar };
    }
    envio =
      qual === 'audio'
        ? { ...destino, tipo: 'audio', mediaId: subida.mediaId }
        : qual === 'documento'
          ? {
              ...destino,
              tipo: 'documento',
              mediaId: subida.mediaId,
              nome: texto(m.media_nome) ?? 'documento',
              ...(corpo ? { legenda: corpo } : {}),
            }
          : { ...destino, tipo: qual, mediaId: subida.mediaId, ...(corpo ? { legenda: corpo } : {}) };
  }

  const r = await ctx.graph.enviar(envio);
  if (!r.ok) return falha(r);
  return { ok: true, resultado: { wamid: r.wamid } };
}

const CAMPOS_DO_PERFIL = 'about,address,description,email,profile_picture_url,websites,vertical';

async function lerPerfil(ctx: ContextoDasAcoes): Promise<Desfecho> {
  const r = await ctx.graph.ler(`${ctx.phoneNumberId}/whatsapp_business_profile`, {
    fields: CAMPOS_DO_PERFIL,
  });
  if (!r.ok) return falha(r);
  const dados = Array.isArray(r.json.data) ? r.json.data[0] : null;
  return {
    ok: true,
    resultado: { perfil: typeof dados === 'object' && dados !== null ? dados : {} },
  };
}

async function salvarPerfil(ctx: ContextoDasAcoes, a: AcaoDoWhatsapp): Promise<Desfecho> {
  const corpo: Record<string, unknown> = { messaging_product: 'whatsapp' };
  for (const campo of ['about', 'address', 'description', 'email', 'vertical'] as const) {
    if (typeof a.dados[campo] === 'string') corpo[campo] = a.dados[campo];
  }
  if (Array.isArray(a.dados.websites)) corpo.websites = listaDeTextos(a.dados.websites);

  const foto = texto(a.dados.foto_path);
  if (foto !== null) {
    if (!ctx.appId) {
      return deVez(
        'sem_app_id',
        'Trocar a foto do perfil precisa do META_APP_ID no worker-wa; o resto pode ser salvo sem a foto.',
      );
    }
    const arquivo = await baixar(ctx, foto);
    if (!arquivo.ok) return { ok: false, codigo: 'foto_nao_lida', erro: arquivo.erro, retentar: true };
    const subida = await ctx.graph.subirParaOPerfil(ctx.appId, {
      bytes: arquivo.bytes,
      mime: arquivo.mime === 'image/png' ? 'image/png' : 'image/jpeg',
      nome: 'perfil.jpg',
    });
    if (!subida.ok) return falha(subida);
    corpo.profile_picture_handle = subida.handle;
  }

  const r = await ctx.graph.publicar(`${ctx.phoneNumberId}/whatsapp_business_profile`, corpo);
  if (!r.ok) return falha(r);
  // O que vale é o que a Meta guardou: lê de novo.
  return lerPerfil(ctx);
}

/** Uma passada na fila de ações. Devolve quantas foram tratadas. */
export async function fazerAcoes(ctx: ContextoDasAcoes, quantidade = 20): Promise<number> {
  const acoes = await proximasAcoes(ctx.cliente, quantidade);
  for (const a of acoes) {
    let desfecho: Desfecho;
    try {
      desfecho = await fazerAcao(ctx, a);
    } catch (erro) {
      desfecho = {
        ok: false,
        codigo: 'erro_no_worker',
        erro: erro instanceof Error ? erro.message : String(erro),
        retentar: true,
      };
    }
    if (desfecho.ok) {
      await acaoConcluida(ctx.cliente, a.id, desfecho.resultado);
      ctx.logger.info('ação do WhatsApp feita', { id: a.id, tipo: a.tipo });
      continue;
    }
    const destino = await acaoFalhou(ctx.cliente, {
      id: a.id,
      codigo: desfecho.codigo,
      erro: desfecho.erro,
      retentar: desfecho.retentar,
    });
    // "Digitando…" e "lida" que falham não merecem mais que um aviso baixo.
    const nivel = a.tipo === 'digitando' || a.tipo === 'ler' ? 'info' : 'warn';
    ctx.logger[nivel]('ação do WhatsApp não deu certo', {
      id: a.id,
      tipo: a.tipo,
      codigo: desfecho.codigo,
      destino,
    });
  }
  return acoes.length;
}

/**
 * O laço das ações, separado do laço das mensagens. Cada volta pega o que
 * houver; fila vazia descansa `intervaloMs`. Erro do banco vira log e espera:
 * o laço das mensagens continua igual.
 */
export function criarLacoDasAcoes(
  ctx: ContextoDasAcoes,
  opcoes: { dormir: (ms: number) => Promise<void>; intervaloMs?: number },
): { iniciar(): void; encerrar(): Promise<void> } {
  const intervalo = opcoes.intervaloMs ?? 2_000;
  let parar = false;
  let rodando: Promise<void> | null = null;
  return {
    iniciar() {
      rodando = (async () => {
        while (!parar) {
          try {
            if ((await fazerAcoes(ctx)) > 0) continue;
          } catch (erro) {
            ctx.logger.warn('a fila de ações não respondeu', {
              erro: erro instanceof Error ? erro.message : String(erro),
            });
          }
          if (parar) break;
          await opcoes.dormir(intervalo);
        }
      })();
    },
    async encerrar() {
      parar = true;
      await rodando;
    },
  };
}
