# Disk Dourado Artes — biblioteca de artes PNG (PWA + Firebase)

Projeto Firebase usado: **impressao-de-produto** (nenhum projeto novo é criado).

## Arquivos

**Todos os arquivos ficam juntos em uma única pasta, sem subpastas.**

| Arquivo | Função |
|---|---|
| `index.html`, `style.css`, `app.js` | Interface e lógica (login, categorias, produtos, galeria, visualização, backup) |
| `firebase-config.js` | Inicializa Auth, Firestore (com cache local) e Storage |
| `manifest.webmanifest`, `service-worker.js`, `offline.html`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | PWA instalável e funcionamento offline da interface |
| `logo.png`, `logo-original.jpg` | Logo da Disk Dourado (usada no login, no topo e nos ícones) |
| `firestore.rules`, `storage.rules` | Regras de segurança (somente administradores) |
| `cors.json` | Libera o app a baixar os PNG do Storage (necessário para compartilhar/baixar/backup) |
| `set-admin.js` | Concede o acesso de administrador (custom claim) a um usuário |
| `firebase.json`, `.firebaserc` | Configuração de deploy |

---

## Passo a passo

### 1. Configurar o Firebase Authentication
1. Console Firebase → projeto **impressao-de-produto** → **Authentication** → **Primeiros passos**.
2. Aba **Sign-in method** → habilite **E-mail/senha** (somente a primeira opção).
3. Aba **Users** → **Adicionar usuário** → informe o seu e-mail e uma senha forte. **Este é o único jeito de criar usuários** — o app não tem cadastro público.
4. Em **Configurações → Autorização de domínios**, confirme que `impressao-de-produto.web.app` está listado (vem por padrão).

### 2. Tornar o seu usuário administrador (custom claim)
As regras só aceitam quem tem `admin = true` no token. Isso é definido no servidor:
1. Console Firebase → ⚙ **Configurações do projeto** → **Contas de serviço** → **Gerar nova chave privada**. Salve como `serviceAccountKey.json` na pasta do projeto. **Nunca compartilhe nem publique esse arquivo.**
2. No computador com [Node.js](https://nodejs.org) instalado, dentro da pasta do projeto:
   ```
   npm install firebase-admin
   node set-admin.js seu@email.com
   ```
3. Apague o `serviceAccountKey.json` depois de usar (ou guarde-o em local seguro).
4. Saia do app e entre de novo (o claim só vale em tokens novos).

> Sem Node? Abra o **Cloud Shell** (ícone `>_` no Google Cloud Console do mesmo projeto), envie `set-admin.js` e rode os mesmos comandos — lá não precisa de chave.

### 3. Habilitar o Cloud Firestore
Console → **Firestore Database** → **Criar banco de dados** → modo **produção** → escolha a região (ex.: `southamerica-east1`, São Paulo). A região não pode ser alterada depois.

### 4. Habilitar o Firebase Storage
Console → **Storage** → **Primeiros passos** → modo produção → mesma região. (O Storage pode exigir o plano Blaze; há cota gratuita mensal, mas confira os preços atuais no console.)

### 5. Aplicar as regras de segurança
**Pelo console:** copie o conteúdo de `firestore.rules` em *Firestore → Regras → Publicar*, e `storage.rules` em *Storage → Regras → Publicar*.

**Pela CLI** (recomendado):
```
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,storage
```
O que as regras garantem: nada é lido ou gravado sem login **e** sem `admin = true`; o Storage só aceita PNG até 25 MB; não existe `allow ... if true`.

### 6. Liberar o download dos PNG (CORS) — obrigatório uma vez
Sem isso, **Compartilhar, Baixar, Salvar offline e Backup com imagens falham** (a exibição das imagens funciona, mas a leitura do arquivo para compartilhar exige CORS).
No Cloud Shell do projeto, envie o `cors.json` e rode:
```
gcloud storage buckets update gs://impressao-de-produto.firebasestorage.app --cors-file=cors.json
```
(alternativa: `gsutil cors set cors.json gs://impressao-de-produto.firebasestorage.app`). Se usar outro domínio, edite `origin` em `cors.json`.

### 7. Publicar o projeto
```
firebase deploy --only hosting
```
O app fica em `https://impressao-de-produto.web.app`. A cada nova publicação, aumente `VERSION` em `service-worker.js`; o app mostra a faixa **“Nova versão disponível — Atualizar”**.
(Para testar localmente: `npx serve .` ou `firebase serve`; o service worker exige HTTPS ou `localhost`.)

### 8. Instalar o PWA no Android
Abra o endereço no **Chrome** → menu ⋮ → **Instalar aplicativo** (ou *Adicionar à tela inicial*). Abra pelo ícone “Dourado Artes”.

### 9. Cadastrar categorias e produtos
Ao entrar pela primeira vez, as 8 categorias sugeridas são criadas no Firestore (uma única vez). Em **Início → Gerenciar** você cria, edita, reordena (▲▼) e exclui categorias (só é possível excluir categorias sem produtos). Em **+ Produto** informe nome, categoria e descrição opcional. Nenhum produto fictício é criado.

### 10. Enviar PNG, compartilhar e imprimir
- Abra o produto → **+ ADICIONAR ARTE PNG** (aceita vários arquivos; só PNG real, até 20 MB; valida assinatura e decodificação do arquivo, não a extensão). O original é salvo sem conversão; uma miniatura leve é criada só para a grade.
- Abra a arte → **Compartilhar PNG**: o Android abre a folha de compartilhamento nativa; escolha **Bluetooth** ou o app da impressora. *Se Bluetooth não aparecer ali, o app não tem como forçá-lo* — use **Baixar PNG original** e envie pela Galeria/Arquivos.
- **Imprimir** abre o diálogo de impressão do Chrome; impressoras Bluetooth só aparecem se o Android tiver um serviço de impressão compatível instalado.
- O app deixa a arquitetura pronta para uma integração Android nativa futura (impressão direta por protocolo), mas não simula isso.

### Backup e restauração
Menu inferior **Backup**: exporta `.zip` (metadados + PNG originais) ou `.json` (só metadados). Ao restaurar, itens que já existem (mesmo ID, ou categoria/produto com mesmo nome) são ignorados; mostra um resumo antes de aplicar.
- **Armazenamento permanente (Firebase):** sua cópia principal.
- **Backup dos arquivos (.zip):** cópia fora do Firebase, contra exclusão acidental.
- **Backup local de metadados (.json):** só o índice, sem imagens.
- **Salvar offline** (por arte): cópia só no aparelho, para abrir sem internet.

---

## Modelo de dados

- `categories`: name, description, icon, sortOrder, createdAt, updatedAt
- `products`: name, description, categoryId, coverStoragePath, createdAt, updatedAt
- `artworks`: name, productId, categoryId, storagePath, thumbPath, contentType, sizeBytes, width, height, isFavorite, createdAt, updatedAt
- `meta/settings`: marca que as categorias iniciais já foram criadas
- Storage: `categories/{categoryId}/products/{productId}/artworks/{artworkId}.png` (+ `_thumb.png`)

## Limitações (ditas com clareza)
- Offline: a interface e os metadados já carregados abrem sem internet; imagens só ficam offline se você usar **Salvar offline**. Não há sincronização offline completa nem upload offline.
- A busca é feita no aparelho, sobre os metadados já carregados (rápida, sem leituras extras); busca por trecho no meio de palavras é suportada, mas não há correção ortográfica.
- Analytics não foi incluído (não é necessário).
- Mover um produto de categoria atualiza `categoryId` das artes, mas o caminho no Storage permanece o original (continua válido).

## Checklist de testes
Marquei como **executado** apenas o que foi realmente rodado. O restante precisa do seu Firebase e do seu Android.

| Teste | Status |
|---|---|
| Sintaxe do `app.js`/`service-worker.js`/`firebase-config.js` (`node --check`) | Executado |
| `manifest.webmanifest`, `firebase.json`, `cors.json` são JSON válido | Executado |
| Login/logout, cadastro/edição de categorias e produtos | A executar por você |
| Upload de PNG, persistência após recarregar, exclusão de arquivos | A executar por você |
| Pesquisa, favoritos, ordenação | A executar por você |
| Download do PNG original e compartilhamento no Android | A executar por você (exige CORS aplicado) |
| Interface offline / instalação do PWA | A executar por você |
| Regras de acesso (usuário sem claim deve receber “sem permissão”) | A executar por você |
