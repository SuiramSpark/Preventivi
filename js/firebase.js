const REQUIRED_FIELDS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId"
];

export function getFirebaseStatus(firebaseConfig = {}) {
  const missingFields = REQUIRED_FIELDS.filter((field) => !`${firebaseConfig[field] ?? ""}`.trim());

  return {
    isReady: missingFields.length === 0,
    missingFields
  };
}

export function buildFirebaseSnippet(firebaseConfig = {}) {
  const config = {
    apiKey: firebaseConfig.apiKey || "INSERISCI_API_KEY",
    authDomain: firebaseConfig.authDomain || "INSERISCI_AUTH_DOMAIN",
    projectId: firebaseConfig.projectId || "INSERISCI_PROJECT_ID",
    storageBucket: firebaseConfig.storageBucket || "INSERISCI_STORAGE_BUCKET",
    messagingSenderId: firebaseConfig.messagingSenderId || "INSERISCI_MESSAGING_SENDER_ID",
    appId: firebaseConfig.appId || "INSERISCI_APP_ID",
    measurementId: firebaseConfig.measurementId || ""
  };

  return `import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = ${JSON.stringify(config, null, 2)};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Collezioni suggerite:
// quotes
// templates
// settings`;
}

export function buildFirebaseStatusText(firebaseConfig = {}) {
  const status = getFirebaseStatus(firebaseConfig);

  if (status.isReady) {
    return "Configurazione completa. Il layer cloud puo essere collegato a Firestore e Storage senza cambiare l'interfaccia.";
  }

  return `Configurazione incompleta. Mancano: ${status.missingFields.join(", ")}.`;
}
