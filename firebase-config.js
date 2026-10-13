// Configuração do projeto Firebase "impressao-de-produto".
// Estes valores identificam o projeto e são públicos por natureza em apps web;
// a proteção real está nas regras do Firestore/Storage (veja README.md).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAYBVwu1_YryRGkC06A0Uazx_y4uozfgYs",
  authDomain: "impressao-de-produto.firebaseapp.com",
  projectId: "impressao-de-produto",
  storageBucket: "impressao-de-produto.firebasestorage.app",
  messagingSenderId: "171908986256",
  appId: "1:171908986256:web:b50aa486873c6097942f15",
  measurementId: "G-0LJ2VJ1B9J",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Cache local do Firestore (IndexedDB): metadados continuam legíveis offline.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const storage = getStorage(app);
// Analytics não é necessário para a biblioteca e foi deixado de fora de propósito.
