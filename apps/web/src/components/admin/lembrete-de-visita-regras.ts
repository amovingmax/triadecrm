/**
 * Ajustes → WhatsApp → Lembrete da visita (11/11/2026, só na Imova).
 *
 * As regras puras da seção: ler o painel que o banco devolve
 * (`public.lembrete_de_visita_painel`), dizer em que pé está o modelo na Meta, o que
 * o interruptor faz agora, as horas que dá para escolher e por que um lembrete não
 * saiu. A tela (`painel-lembrete-de-visita.tsx`) só desenha o que sai daqui.
 */

export type SituacaoDoModelo =
  | 'nao_enviado' // inativo: ninguém pediu a aprovação
  | 'na_fila' // ativo, a sincronização ainda não mandou à Meta
  | 'esperando' // na Meta, esperando a aprovação
  | 'recusado'
  | 'aprovado'
  | 'sem_modelo';

export type PainelDoLembrete = {
  ligado: boolean;
  hora: string;
  modelo: {
    codigo: string;
    situacao: SituacaoDoModelo;
    motivoDaRecusa: string | null;
    corpo: string;
    botoes: string[];
  } | null;
  numeros: {
    enviados: number;
    confirmaram: number;
    remarcar: number;
    semResposta: number;
    naoSairam: number;
  };
  naoSairam: { cliente: string; marcadaPara: string; motivo: string | null }[];
};

function objeto(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}
function numero(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** A situação do modelo pelo que o banco guarda: ativo, situação na Meta e aprovado. */
export function situacaoDoModelo(m: {
  ativo: boolean;
  situacao: string | null;
  aprovado: boolean;
}): SituacaoDoModelo {
  if (m.aprovado) return 'aprovado';
  if (m.situacao === 'rejected') return 'recusado';
  if (m.situacao === 'pending' || m.situacao === 'approved') return 'esperando';
  return m.ativo ? 'na_fila' : 'nao_enviado';
}

/** O jsonb de `lembrete_de_visita_painel`, sem confiar na forma. */
export function lerPainel(bruto: unknown): PainelDoLembrete {
  const p = objeto(bruto);
  const m = p.modelo === null || p.modelo === undefined ? null : objeto(p.modelo);
  const n = objeto(p.ultimos_30_dias);
  return {
    ligado: p.ligado === true,
    hora: texto(p.hora) ?? '10:00',
    modelo: m
      ? {
          codigo: texto(m.codigo) ?? '',
          situacao: situacaoDoModelo({
            ativo: m.ativo === true,
            situacao: texto(m.situacao),
            aprovado: m.aprovado === true,
          }),
          motivoDaRecusa: texto(m.motivo_da_recusa),
          corpo: texto(m.corpo) ?? '',
          botoes: (Array.isArray(m.botoes) ? m.botoes : []).flatMap((b) => {
            const t = texto(objeto(b).texto);
            return t ? [t] : [];
          }),
        }
      : null,
    numeros: {
      enviados: numero(n.enviados),
      confirmaram: numero(n.confirmaram),
      remarcar: numero(n.remarcar),
      semResposta: numero(n.sem_resposta),
      naoSairam: numero(n.nao_sairam),
    },
    naoSairam: (Array.isArray(p.nao_sairam) ? p.nao_sairam : []).flatMap((bruta) => {
      const l = objeto(bruta);
      const cliente = texto(l.cliente);
      const marcadaPara = texto(l.marcada_para);
      return cliente && marcadaPara ? [{ cliente, marcadaPara, motivo: texto(l.motivo) }] : [];
    }),
  };
}

/** A frase do modelo, para a linha embaixo do título. */
export function fraseDoModelo(
  situacao: SituacaoDoModelo,
  motivoDaRecusa: string | null = null,
): string {
  switch (situacao) {
    case 'aprovado':
      return 'Modelo aprovado pela Meta.';
    case 'esperando':
      return 'O modelo está com a Meta, esperando a aprovação. Nada sai antes disso.';
    case 'na_fila':
      return 'O modelo vai para a Meta na próxima sincronização do WhatsApp (até 30 minutos).';
    case 'recusado':
      return motivoDaRecusa
        ? `A Meta recusou o modelo: ${motivoDaRecusa}`
        : 'A Meta recusou o modelo.';
    case 'nao_enviado':
      return 'O modelo ainda não foi para a Meta aprovar. Sem a aprovação, nenhum lembrete sai.';
    case 'sem_modelo':
      return 'O modelo do lembrete não está no banco.';
  }
}

/** O que o interruptor diz, ligado ou não, com o modelo como está. */
export function fraseDoInterruptor(
  ligado: boolean,
  situacao: SituacaoDoModelo,
  hora: string,
): string {
  if (!ligado) return 'Desligado: nenhum lembrete sai.';
  if (situacao !== 'aprovado') {
    return 'Ligado, mas nada sai até a Meta aprovar o modelo.';
  }
  return `Ligado: a partir das ${rotuloDaHora(hora)}, quem tem visita marcada no dia seguinte recebe o lembrete. A visita de segunda recebe no sábado (se o cliente já respondeu) ou na sexta.`;
}

/** As horas que a tela oferece. O banco aceita das 7h às 17h. */
export const HORAS_DO_LEMBRETE: readonly string[] = Array.from(
  { length: 11 },
  (_, i) => `${String(7 + i).padStart(2, '0')}:00`,
);

/** "10:00" → "10h"; "09:30" → "9h30". */
export function rotuloDaHora(hora: string): string {
  const [h = '', m = ''] = hora.split(':');
  const horas = Number(h);
  if (!Number.isFinite(horas) || h === '') return hora;
  return m === '' || m === '00' ? `${horas}h` : `${horas}h${m}`;
}

/** Por que um lembrete não saiu, na língua de quem lê os Ajustes. */
export function fraseDoMotivo(motivo: string | null): string {
  if (!motivo) return 'não saiu';
  if (motivo === 'sem_whatsapp') return 'a ficha não tem WhatsApp';
  if (motivo.endsWith('suprimido')) return 'o cliente pediu para não receber mensagens';
  if (motivo === 'conversa_bloqueada') return 'a conversa está bloqueada';
  if (motivo === 'contato_apagado' || motivo === 'organizacao_apagada')
    return 'a ficha foi apagada';
  if (motivo === 'whatsapp_nao_configurado') return 'o WhatsApp não estava conectado';
  if (motivo.startsWith('janela_')) return 'fora do horário de envio';
  if (motivo.startsWith('teto_') || motivo === 'qualidade_vermelha') {
    return 'o limite de mensagens do dia foi atingido';
  }
  if (motivo.includes('robô')) return 'o robô já tinha falado o bastante nessa conversa';
  return 'o WhatsApp recusou o envio';
}

/** Os motivos que o banco devolve ao configurar, em português. */
export function fraseDoErroAoConfigurar(motivo: string | null): string {
  switch (motivo) {
    case 'sem_permissao':
      return 'Só admin e gestor mudam o lembrete.';
    case 'hora_invalida':
      return 'Escolha uma hora entre 7h e 17h.';
    case 'modelo_inexistente':
      return 'O modelo do lembrete não está no banco.';
    case 'botao_parece_pedido_de_saida':
      return 'O modelo tem um botão que parece pedido para sair da lista.';
    default:
      return 'Não deu para salvar. Tente de novo.';
  }
}
