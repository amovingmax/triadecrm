-- =====================================================================
-- O balde passa a aceitar o que o NAVEGADOR grava, não só o que a Meta manda
--
-- O balde `mensagens` nasceu (migração `20260905000201`) para guardar o que
-- CHEGA: a URL da mídia da Meta expira em cinco minutos, então o worker baixa e
-- guarda. A lista de tipos aceitos foi escrita com esse único remetente em
-- mente — e é a lista da Cloud API.
--
-- Agora o balde tem um segundo remetente: quem atende, gravando pela tela. E o
-- `MediaRecorder` do Chrome grava `audio/webm`, que a Cloud API não aceita e que
-- por isso nunca esteve nesta lista. O Storage recusava o upload, e a tela dizia
-- só "o áudio não entrou na fila".
--
-- `webm` entra no balde e NÃO entra na Meta: quem troca a embalagem para ogg é o
-- worker, com `ffmpeg -c:a copy`, no instante do envio. O balde guarda o
-- original; a conversão é para o caminho de saída. São duas listas diferentes de
-- propósito, porque são duas perguntas diferentes: "o que podemos guardar" e "o
-- que a Meta aceita receber".
--
-- `video/webm` entra junto porque alguns navegadores rotulam assim a gravação
-- só de áudio — é o mesmo contêiner, com o mesmo Opus dentro, e o worker já
-- trata os dois igual.
-- =====================================================================

update storage.buckets
   set allowed_mime_types = array['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/aac',
                                  'audio/webm', 'video/webm',
                                  'image/jpeg', 'image/png', 'image/webp',
                                  'video/mp4', 'video/3gpp',
                                  'application/pdf']
 where id = 'mensagens';
