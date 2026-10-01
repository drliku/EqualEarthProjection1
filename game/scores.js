// Leaderboard storage for "Size it up", shared by the game and leaderboard pages.
//
// On the published claude.ai page, scores go to the artifact's shared database, so
// everyone with the link sees the same board. Anywhere the database isn't available
// (the files opened from disk, a signed-out visitor), scores fall back to this
// browser's localStorage. localStorage access is wrapped in try/catch because it
// can be blocked (private windows, strict settings).

const SCORES_COLLECTION = "scores";
const SCORES_KEY = "brainmaze.sizeItUp.scores";
const NAME_KEY = "brainmaze.sizeItUp.lastName";
const MAX_SCORES = 100; // the board shows the best 100
const ROUNDS_PER_GAME = 10;

// Highest total first; on a tie, whoever got there first.
const compareScores = (x, y) => y.score - x.score || x.date.localeCompare(y.date);

const isValidEntry = e => e && typeof e.name === "string" && Number.isFinite(e.score)
  && Number.isFinite(e.average) && typeof e.date === "string" && typeof e.id === "string";

// ---------- Which store to use ----------

// Resolves { mode: "global", db, isOwner } or { mode: "local" }. Asked once per page.
let backendPromise = null;
function getBackend() {
  backendPromise ??= (async () => {
    try {
      if (!window.claude || typeof window.claude.use !== "function") return { mode: "local" };
      const [db, user] = await Promise.all([claude.use("db"), claude.use("user")]);
      if (!db) return { mode: "local" };
      return { mode: "global", db, isOwner: user ? await user.isOwner() : false };
    } catch {
      return { mode: "local" };
    }
  })();
  return backendPromise;
}

// ---------- This browser's copy ----------

function loadLocalScores() {
  try {
    const list = JSON.parse(localStorage.getItem(SCORES_KEY) || "[]");
    return Array.isArray(list) ? list.filter(isValidEntry).sort(compareScores) : [];
  } catch {
    return [];
  }
}

function saveLocalScore(entry) {
  const list = [...loadLocalScores(), entry].sort(compareScores).slice(0, MAX_SCORES);
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(list));
  } catch {
    return false;
  }
  return list.some(e => e.id === entry.id);
}

function rememberName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* optional convenience */ }
}

function lastPlayerName() {
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
}

// ---------- Public API ----------

// Calls onChange(scores, mode) now and whenever the board changes (live on the
// global board). onError(code) fires if the global board stops updating.
async function watchScores(onChange, onError) {
  const backend = await getBackend();
  if (backend.mode === "local") {
    onChange(loadLocalScores(), "local");
    return () => {};
  }
  return backend.db.collection(SCORES_COLLECTION)
    .orderBy("score", "desc")
    .limit(MAX_SCORES)
    .onSnapshot(
      snap => onChange(
        snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(isValidEntry).sort(compareScores),
        "global"
      ),
      e => onError?.(e.code)
    );
}

// Saves a finished game. Resolves { entry, mode } where mode is "global" or "local",
// plus `fallback: true` when the global board refused the write and the score was
// kept in this browser instead. Resolves null if it couldn't be saved anywhere.
async function saveScore(name, score, average) {
  const cleanName = name.trim().slice(0, 20) || "Anonymous";
  rememberName(cleanName);
  const body = { name: cleanName, score, average, date: new Date().toISOString() };

  const backend = await getBackend();
  if (backend.mode === "global") {
    try {
      const ref = await backend.db.collection(SCORES_COLLECTION).add(body);
      return { entry: { ...body, id: ref.id }, mode: "global" };
    } catch (e) {
      // invalid_argument here means this viewer can read the board but not write to it.
      const entry = { ...body, id: localId() };
      return saveLocalScore(entry) ? { entry, mode: "local", fallback: true } : null;
    }
  }
  const entry = { ...body, id: localId() };
  return saveLocalScore(entry) ? { entry, mode: "local" } : null;
}

// Whether this viewer may clear the board: anyone for their own browser's board,
// only the artifact's owner for the global one.
async function canClearScores() {
  const backend = await getBackend();
  return backend.mode === "local" || backend.isOwner;
}

async function clearScores() {
  const backend = await getBackend();
  if (backend.mode === "local") {
    try { localStorage.removeItem(SCORES_KEY); } catch { /* nothing to clear */ }
    return;
  }
  const snap = await backend.db.collection(SCORES_COLLECTION).limit(1000).get();
  for (const doc of snap.docs) {
    await backend.db.collection(SCORES_COLLECTION).doc(doc.id).delete();
  }
}

function localId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
