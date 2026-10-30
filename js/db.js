// On-device storage (IndexedDB): saved scans + settings. Nothing leaves your phone except calls to Gemini.
const DB_NAME = 'listing-studio';
const VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      for (const s of ['scans', 'kv']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function store(name, mode = 'readonly') { return (await open()).transaction(name, mode).objectStore(name); }

export const put = async (n, o) => req((await store(n, 'readwrite')).put(o));
export const get = async (n, id) => req((await store(n)).get(id));
export const del = async (n, id) => req((await store(n, 'readwrite')).delete(id));
export const all = async (n) => req((await store(n)).getAll());
export const clear = async (n) => req((await store(n, 'readwrite')).clear());
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const DEFAULT_STYLES = [
  { id: 'tiles', name: 'Dark concrete tiles', scene: 'large dark grey distressed concrete-look porcelain floor tiles in an offset pattern with thin dark grout lines, mottled charcoal and stone-grey texture with subtle rust and copper flecks, slight satin sheen' },
];

export async function getSettings() {
  const s = (await get('kv', 'settings')) || {};
  return { id: 'settings', apiKey: '', model: 'gemini-flash-latest', language: 'English', useSearch: true, styles: DEFAULT_STYLES, ...s };
}
export const saveSettings = (s) => put('kv', { ...s, id: 'settings' });
