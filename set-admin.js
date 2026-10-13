// Concede (ou remove) o custom claim "admin" a um usuário do Firebase Authentication.
// Roda NO SEU COMPUTADOR (ou no Cloud Shell), nunca no navegador do app.
//
// Uso:
//   npm install firebase-admin
//   node set-admin.js seu@email.com            -> concede admin
//   node set-admin.js seu@email.com --remove   -> remove admin
//
// Credencial: baixe uma chave de conta de serviço em
//   Console Firebase → Configurações do projeto → Contas de serviço → Gerar nova chave privada
// salve como serviceAccountKey.json NESTA pasta. NUNCA publique nem compartilhe esse arquivo
// (ele já está excluído do deploy em firebase.json). No Cloud Shell, dispensa a chave.

const admin = require("firebase-admin");
const fs = require("fs");

const email = process.argv[2];
const remove = process.argv.includes("--remove");
if (!email) {
  console.error("Informe o e-mail: node set-admin.js seu@email.com");
  process.exit(1);
}

const keyFile = "./serviceAccountKey.json";
admin.initializeApp(
  fs.existsSync(keyFile)
    ? { credential: admin.credential.cert(require(keyFile)), projectId: "impressao-de-produto" }
    : { projectId: "impressao-de-produto" } // credenciais padrão (Cloud Shell / gcloud)
);

(async () => {
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, remove ? {} : { admin: true });
  console.log(`${remove ? "Admin removido de" : "Admin concedido a"} ${email} (uid ${user.uid}).`);
  console.log("Saia do app e entre de novo para o novo token valer.");
})().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});
