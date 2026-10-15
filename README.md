# Disk Dourado Artes — biblioteca de artes PNG (PWA + Firebase)

Projeto Firebase usado: **impressao-de-produto**. Sem Firebase Storage e sem plano pago:
tudo fica no **Cloud Firestore** (plano gratuito Spark).

**Todos os arquivos ficam juntos em uma única pasta, sem subpastas.**

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html`, `style.css`, `app.js` | Interface e lógica |
| `firebase-config.js` | Inicializa Auth e Firestore |
| `manifest.webmanifest`, `service-worker.js`, `offline.html`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | PWA instalável e interface offline |
| `logo.png`, `logo-original.jpg` | Sua logo (recorte circular usado no app e nos ícones; original completo) |
| `firestore.rules` | Regras de segurança do Firestore |
| `set-admin.js` | Só para quem quiser voltar a exigir login de administrador |
| `firebase.json`, `.firebaserc` | Configuração de deploy (Firebase CLI) |

## Como as imagens são guardadas (sem Storage)

- A **miniatura** (WebP/PNG pequeno) vai dentro do documento da arte, para a grade carregar rápido.
- O **PNG original** é dividido em partes de ~570 KB e salvo em `artworks/{id}/chunks/…` (o Firestore aceita no máximo 1 MiB por documento).
- Para compartilhar, baixar, imprimir ou fazer backup, o app junta as partes e entrega o **PNG original idêntico**, com transparência e resolução preservadas.
- Limite por arquivo: **10 MB**. Cada arte de 3 MB usa ~6 gravações e, para abrir, ~6 leituras.
- Cota gratuita do Firestore (confira os valores atuais no console): cerca de 1 GiB armazenado, 50 mil leituras e 20 mil gravações por dia.

---

## Passo a passo

### 1. Ativar o login Anônimo (é o que dispensa a tela de login)
1. Console Firebase → **Authentication** → **Sign-in method** → habilite **Anônimo**.
2. **Authentication → Configurações → Domínios autorizados** → adicione o domínio onde o app está publicado (ex.: `seuusuario.github.io`, só o domínio).

> **Segurança:** sem tela de login, qualquer pessoa que descubra o endereço do app pode ver, alterar e excluir artes. Não divulgue o link.

### 2. Criar o banco Cloud Firestore
Console → **Firestore Database** → **Criar banco de dados** → modo **produção** → região `southamerica-east1` (São Paulo).

### 3. Publicar as regras
Console → **Firestore Database → Regras** → apague tudo, cole o conteúdo de `firestore.rules` → **Publicar**.
(As regras novas incluem a subcoleção `chunks`; sem elas o envio de artes é recusado.)

### 4. Publicar o site
- **GitHub Pages:** envie todos os arquivos para o repositório (incluindo `.firebaserc` é opcional) e ative o Pages.
- **Firebase Hosting:** `firebase deploy --only hosting`.

A cada nova versão, aumente `VERSION` em `service-worker.js`; o app mostra “Nova versão disponível — Atualizar”.

### 5. Instalar no Android
Abra o endereço no **Chrome** → menu ⋮ → **Instalar aplicativo**.

### 6. Categorias e produtos
Na primeira abertura, as 8 categorias sugeridas são criadas. Em **Início → Gerenciar** você cria, edita, reordena e exclui categorias (só sem produtos). Use **+ Produto** para cadastrar produtos. Nenhum produto fictício é criado.

### 7. Enviar PNG, compartilhar e imprimir
- Abra o produto → **+ ADICIONAR ARTE PNG** (vários arquivos; o seletor mostra todas as fotos do celular). PNG de verdade é guardado **sem alteração**. JPG/WebP são convertidos para PNG no próprio aparelho (se passar de 10 MB, a resolução é reduzida em etapas até caber). O app valida o conteúdo, não a extensão.
- Abra a arte → **Compartilhar PNG**: abre a folha de compartilhamento do Android; escolha Bluetooth ou o app da impressora. Se Bluetooth não aparecer ali, o app não consegue forçar: use **Baixar PNG original** e envie pela Galeria/Arquivos.
- **Imprimir / Bluetooth** abre a tela de compartilhar do Android com o PNG; escolha Bluetooth ou o app da sua impressora. O envio por Bluetooth depende do aparelho e da impressora aceitarem imagem.

### 8. Backup e restauração
Menu **Backup**: exporta `.zip` (dados + PNG originais) ou `.json` (só dados). Ao restaurar, itens que já existem são ignorados. **Artes só são restauradas a partir do .zip com imagens.**

### Voltar a exigir login (opcional)
1. Authentication → Users: crie seu usuário (e-mail/senha).
2. Gere a chave de conta de serviço, salve como `serviceAccountKey.json` ao lado de `set-admin.js`; rode `npm install firebase-admin` e `node set-admin.js seu@email.com`; apague a chave depois.
3. Em `app.js`, troque `REQUIRE_LOGIN = false` por `true`.
4. Em `firestore.rules`, na função `isAdmin()`, use `return request.auth != null && request.auth.token.admin == true;` e publique de novo.

---

## Modelo de dados
- `categories`: name, description, icon, sortOrder, createdAt, updatedAt
- `products`: name, description, categoryId, coverArtId, createdAt, updatedAt
- `artworks`: name, productId, categoryId, thumb, chunkCount, contentType, sizeBytes, width, height, isFavorite, createdAt, updatedAt
- `artworks/{id}/chunks/{0000…}`: i, data (base64 de uma parte do PNG)
- `meta/settings`: marca que as categorias iniciais já foram criadas

## Limitações
- Offline: a interface e os dados já carregados abrem sem internet; o PNG original só fica offline com **Salvar offline**. Não há envio offline.
- Muitas artes grandes consomem a cota gratuita; se o Firestore avisar que a cota acabou, o app mostra a mensagem e volta no dia seguinte.
- A busca roda no aparelho sobre os dados carregados.

## Checklist de testes
| Teste | Status |
|---|---|
| Sintaxe dos `.js` (`node --check`) e JSON válidos | Executado |
| Divisão do PNG em partes e remontagem idêntica (simulação em Node, 2,3 MB) | Executado |
| Abrir sem login, criar/editar categorias e produtos | Funcionou no seu aparelho |
| Envio de PNG, exibir, compartilhar, baixar, imprimir, excluir | A executar por você |
| Pesquisa, favoritos, ordenação | A executar por você |
| Backup e restauração | A executar por você |
| Interface offline / instalação do PWA | A executar por você |
