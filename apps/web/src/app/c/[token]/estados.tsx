import { Entrada, Palco } from './palco';

/**
 * As telas em que não há nada a reivindicar, e a tela de quem acabou de decidir.
 *
 * Regra que vale para todas: NADA aqui revela dado nenhum. Um link errado, ou um
 * link já usado, não pode dizer de quem ele era — nem "o perfil da Buffet Aurora
 * já foi reivindicado". A página só conta o que o próprio dono do link já sabe, e
 * quem não tem link válido não sabe nada.
 *
 * Cada uma diz o que aconteceu, o que muda daqui em diante e qual é o próximo
 * passo possível — que é sempre o mesmo, e é o único que existe sem login:
 * responder no WhatsApp por onde o link chegou.
 */

type Aviso = { titulo: string; texto: string };

/** O texto do link inválido é o padrão: motivo desconhecido não inventa explicação. */
const PADRAO: Aviso = {
  titulo: 'Este link não vale mais',
  texto:
    'Ou o endereço veio incompleto, ou ele já foi usado, ou um link mais novo tomou o lugar dele. Nada foi publicado e nada mudou por causa disso.',
};

const MOTIVOS: Record<string, Aviso> = {
  token_invalido: PADRAO,
  token_expirado: {
    titulo: 'Este link passou da validade',
    texto:
      'Cada link vale 7 dias, de propósito: link eterno é link que vaza. O rascunho continua privado e ninguém o viu.',
  },
  rascunho_encerrado: {
    titulo: 'Este rascunho foi encerrado',
    texto:
      'Alguém pediu para removê-lo, ou o prazo de 30 dias correu e os dados foram apagados. Está tudo certo: era para ser assim.',
  },
};

/** Link que não abre nada. Um motivo desconhecido cai no texto do link inválido. */
export function LinkSemPerfil({ motivo }: { motivo: string }) {
  const m = MOTIVOS[motivo] ?? PADRAO;

  return (
    <Palco>
      <div className="flex flex-1 flex-col justify-center gap-5">
        <Entrada indice={0}>
          <span className="pilula inline-flex items-center py-1.5 pr-3.5 pl-3.5 text-xs text-foreground">
            Komune
          </span>
        </Entrada>

        <Entrada indice={1}>
          <h1 className="titulo-gradiente text-3xl leading-[1.1] font-medium sm:text-4xl">
            {m.titulo}
          </h1>
        </Entrada>

        <Entrada indice={2}>
          <p className="max-w-[46ch] text-base text-grafite-600 dark:text-grafite-400">{m.texto}</p>
        </Entrada>

        <Entrada indice={3}>
          <p className="max-w-[46ch] text-sm text-grafite-500 dark:text-grafite-450">
            Se você esperava ver o seu negócio aqui, responda no mesmo WhatsApp por onde o link
            chegou e a gente manda outro. Se não fazia ideia do que é isto, pode ignorar: nenhum
            perfil seu foi criado ou publicado.
          </p>
        </Entrada>
      </div>
    </Palco>
  );
}

/** Aceitou: o que foi registrado, e o que acontece agora. */
export function PerfilReivindicado({ quem, nome }: { quem: string; nome: string }) {
  return (
    <Palco>
      <div className="flex flex-1 flex-col justify-center gap-5">
        <Entrada indice={0}>
          <span className="pilula inline-flex items-center py-1.5 pr-3.5 pl-3.5 text-xs text-foreground">
            Autorização registrada
          </span>
        </Entrada>

        <Entrada indice={1}>
          <h1 className="titulo-gradiente text-3xl leading-[1.1] font-medium sm:text-4xl">
            {saudacao(quem)}
          </h1>
        </Entrada>

        <Entrada indice={2}>
          <p className="max-w-[46ch] text-base text-grafite-600 dark:text-grafite-400">
            O perfil de <span className="font-medium text-foreground">{nome}</span> é seu. A partir
            de agora quem manda nele é você: o que aparece, o que sai e quando ele vai ao ar.
          </p>
        </Entrada>

        <Entrada indice={3}>
          <div className="rounded-xl border border-hairline bg-card p-5">
            <p className="text-sm font-medium">O que acontece agora</p>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-sm text-grafite-600 dark:text-grafite-400">
              <li>A Komune manda, no mesmo WhatsApp, o acesso para você completar o cadastro.</li>
              <li>
                O perfil continua fora do ar até você conferir os dados, colocar as suas fotos e
                mandar publicar. Nada vai ao ar sem você.
              </li>
              <li>
                Mudou de ideia? É só pedir por lá: o perfil sai e os dados são apagados em até 48
                horas.
              </li>
            </ul>
          </div>
        </Entrada>

        <Entrada indice={4}>
          <p className="max-w-[46ch] text-sm text-grafite-500 dark:text-grafite-450">
            Pode fechar esta página. O seu aceite ficou registrado com data, hora e a versão do
            termo que você leu.
          </p>
        </Entrada>
      </div>
    </Palco>
  );
}

/** Recusou: sem negociação, sem "tem certeza?" depois do fato. */
export function PerfilRecusado() {
  return (
    <Palco>
      <div className="flex flex-1 flex-col justify-center gap-5">
        <Entrada indice={0}>
          <span className="pilula inline-flex items-center py-1.5 pr-3.5 pl-3.5 text-xs text-foreground">
            Pedido registrado
          </span>
        </Entrada>

        <Entrada indice={1}>
          <h1 className="titulo-gradiente text-3xl leading-[1.1] font-medium sm:text-4xl">
            Combinado. Nada será criado
          </h1>
        </Entrada>

        <Entrada indice={2}>
          <p className="max-w-[46ch] text-base text-grafite-600 dark:text-grafite-400">
            O rascunho será apagado em até 48 horas e este contato entra na nossa lista de quem não
            quer ser procurado. Nenhuma outra mensagem sai daqui, por nenhum canal.
          </p>
        </Entrada>

        <Entrada indice={3}>
          <p className="max-w-[46ch] text-sm text-grafite-500 dark:text-grafite-450">
            Desculpe pelo incômodo. Se em algum momento você mudar de ideia, é só chamar no mesmo
            WhatsApp.
          </p>
        </Entrada>
      </div>
    </Palco>
  );
}

/**
 * "Maria Aparecida da Silva" → "Pronto, Maria".
 *
 * Um nome de uma letra só, ou um campo que veio com iniciais, não vira saudação
 * torta: nesse caso a frase fecha em "Pronto" e ponto.
 */
function saudacao(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? '';
  return primeiro.length > 1 ? `Pronto, ${primeiro}` : 'Pronto';
}
