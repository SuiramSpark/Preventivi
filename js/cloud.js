import {
  STORES,
  DEFAULT_SETTINGS,
  getAllRecords,
  getRecord,
  putRecord,
  deleteRecord,
  setCloudHook,
} from "./db.js";

const FIREBASE_VERSION = "10.13.2";
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

const REQUIRED_FIELDS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

const COLLECTION_STORES = [STORES.quotes, STORES.templates, STORES.companies];
const SETTINGS_DOC_ID = "app";

export function isCloudConfigComplete(cfg = {}) {
  return REQUIRED_FIELDS.every((f) => `${cfg[f] ?? ""}`.trim());
}

export function cloudConfigKey(cfg = {}) {
  return REQUIRED_FIELDS.map((f) => `${cfg[f] ?? ""}`.trim()).join("|");
}

let sdkPromise = null;
function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = Promise.all([
    import(/* @vite-ignore */ `${CDN}/firebase-app.js`),
    import(/* @vite-ignore */ `${CDN}/firebase-firestore.js`),
    import(/* @vite-ignore */ `${CDN}/firebase-auth.js`),
  ]).then(([app, firestore, auth]) => ({ ...app, ...firestore, ...auth }));
  return sdkPromise;
}

let sdk = null;
let session = null;
let state = { phase: "idle", error: null, uid: null };
const listeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  for (const l of listeners) {
    try { l(state); } catch (e) { console.error(e); }
  }
}

export function getCloudState() { return state; }

export function onCloudStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function userPath(store) { return `users/${session.uid}/${store}`; }
function settingsDocRef() { return sdk.doc(session.db, `users/${session.uid}/meta/settings`); }
function collectionRef(store) { return sdk.collection(session.db, userPath(store)); }
function docRef(store, id) { return sdk.doc(session.db, `${userPath(store)}/${id}`); }

function stripSettings(s) {
  const { firebase, ...rest } = s || {};
  return rest;
}

function tsOf(record) {
  if (!record?.updatedAt) return 0;
  const ms = new Date(record.updatedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function emitChange(detail) {
  try {
    window.dispatchEvent(new CustomEvent("cloud:data-changed", { detail }));
  } catch (e) { /* no-op */ }
}

async function mergeAll() {
  const localSettings = await getRecord(STORES.settings, SETTINGS_DOC_ID);
  const settingsSnap = await sdk.getDoc(settingsDocRef());

  if (settingsSnap.exists() && localSettings) {
    const remote = settingsSnap.data();
    if (tsOf(remote) > tsOf(localSettings)) {
      await putRecord(
        STORES.settings,
        { ...remote, firebase: localSettings.firebase, id: SETTINGS_DOC_ID },
        { skipCloud: true }
      );
      emitChange({ store: STORES.settings, type: "upsert", record: remote });
    } else if (tsOf(localSettings) > tsOf(remote) || !remote.updatedAt) {
      await sdk.setDoc(settingsDocRef(), {
        ...stripSettings(localSettings),
        updatedAt: localSettings.updatedAt || new Date().toISOString(),
      });
    }
  } else if (settingsSnap.exists()) {
    const remote = settingsSnap.data();
    await putRecord(
      STORES.settings,
      { ...remote, firebase: { ...DEFAULT_SETTINGS.firebase }, id: SETTINGS_DOC_ID },
      { skipCloud: true }
    );
    emitChange({ store: STORES.settings, type: "upsert", record: remote });
  } else if (localSettings) {
    await sdk.setDoc(settingsDocRef(), {
      ...stripSettings(localSettings),
      updatedAt: localSettings.updatedAt || new Date().toISOString(),
    });
  }

  for (const store of COLLECTION_STORES) {
    const [remoteSnap, locals] = await Promise.all([
      sdk.getDocs(collectionRef(store)),
      getAllRecords(store),
    ]);
    const remoteById = new Map();
    remoteSnap.forEach((d) => remoteById.set(d.id, d.data()));
    const localById = new Map(locals.map((r) => [r.id, r]));
    const allIds = new Set([...remoteById.keys(), ...localById.keys()]);

    for (const id of allIds) {
      const remote = remoteById.get(id);
      const local = localById.get(id);
      if (remote && local) {
        const rt = tsOf(remote);
        const lt = tsOf(local);
        if (rt > lt) {
          await putRecord(store, remote, { skipCloud: true });
          emitChange({ store, type: "upsert", record: remote });
        } else if (lt > rt) {
          await sdk.setDoc(docRef(store, id), local);
        }
      } else if (remote) {
        await putRecord(store, remote, { skipCloud: true });
        emitChange({ store, type: "upsert", record: remote });
      } else if (local) {
        await sdk.setDoc(docRef(store, id), local);
      }
    }
  }
}

function startRealtime() {
  for (const store of COLLECTION_STORES) {
    const unsub = sdk.onSnapshot(
      collectionRef(store),
      (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type === "removed") {
            deleteRecord(store, change.doc.id, { skipCloud: true })
              .then(() => emitChange({ store, type: "removed", id: change.doc.id }))
              .catch((e) => console.warn(`Local apply remove failed (${store}):`, e));
          } else {
            const data = change.doc.data();
            putRecord(store, data, { skipCloud: true })
              .then(() => emitChange({ store, type: "upsert", record: data }))
              .catch((e) => console.warn(`Local apply upsert failed (${store}):`, e));
          }
        });
      },
      (err) => console.error(`Realtime error (${store}):`, err)
    );
    session.unsubs.push(unsub);
  }

  const sUnsub = sdk.onSnapshot(
    settingsDocRef(),
    async (snap) => {
      if (!snap.exists()) return;
      const remote = snap.data();
      const local = await getRecord(STORES.settings, SETTINGS_DOC_ID);
      const merged = {
        ...remote,
        firebase: local?.firebase || { ...DEFAULT_SETTINGS.firebase },
        id: SETTINGS_DOC_ID,
      };
      await putRecord(STORES.settings, merged, { skipCloud: true });
      emitChange({ store: STORES.settings, type: "upsert", record: merged });
    },
    (err) => console.error("Realtime error (settings):", err)
  );
  session.unsubs.push(sUnsub);
}

function registerWriteHook() {
  setCloudHook({
    onPut: async (store, value) => {
      if (!session || state.phase !== "connected") return;
      if (store === STORES.settings) {
        await sdk.setDoc(settingsDocRef(), {
          ...stripSettings(value),
          updatedAt: value?.updatedAt || new Date().toISOString(),
        });
        return;
      }
      if (!value?.id) return;
      await sdk.setDoc(docRef(store, value.id), value);
    },
    onDelete: async (store, id) => {
      if (!session || state.phase !== "connected") return;
      if (store === STORES.settings) return;
      await sdk.deleteDoc(docRef(store, id));
    },
  });
}

export async function connectCloud(config) {
  if (!isCloudConfigComplete(config)) {
    throw new Error("Configurazione Firebase incompleta.");
  }
  if (state.phase === "connecting" || state.phase === "connected") {
    return state;
  }
  setState({ phase: "connecting", error: null });
  try {
    sdk = await loadSdk();
    const appCfg = {
      apiKey: config.apiKey.trim(),
      authDomain: config.authDomain.trim(),
      projectId: config.projectId.trim(),
      storageBucket: config.storageBucket.trim(),
      messagingSenderId: config.messagingSenderId.trim(),
      appId: config.appId.trim(),
      ...(config.measurementId?.trim() ? { measurementId: config.measurementId.trim() } : {}),
    };
    const appInstance = sdk.initializeApp(appCfg, `preventivi-cloud-${Date.now()}`);
    const auth = sdk.getAuth(appInstance);
    const cred = await sdk.signInAnonymously(auth);
    const uid = cred.user.uid;
    const db = sdk.getFirestore(appInstance);
    session = { app: appInstance, db, auth, uid, unsubs: [], configKey: cloudConfigKey(config) };
    await mergeAll();
    startRealtime();
    registerWriteHook();
    setState({ phase: "connected", uid, error: null });
    return state;
  } catch (err) {
    console.error("Cloud connect failed:", err);
    await safeTeardown();
    setState({ phase: "error", error: err?.message || String(err), uid: null });
    throw err;
  }
}

async function safeTeardown() {
  setCloudHook(null);
  if (session) {
    for (const u of session.unsubs) {
      try { u(); } catch (e) { /* no-op */ }
    }
    try { if (sdk?.signOut) await sdk.signOut(session.auth); } catch (e) { /* no-op */ }
    try { if (sdk?.deleteApp) await sdk.deleteApp(session.app); } catch (e) { /* no-op */ }
    session = null;
  }
}

export async function disconnectCloud() {
  await safeTeardown();
  setState({ phase: "idle", uid: null, error: null });
}

export function getConnectedConfigKey() {
  return state.phase === "connected" && session ? session.configKey : null;
}
