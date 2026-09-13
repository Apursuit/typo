/* ============================================================
   typo — local persistence
   Everything stays on the device. localStorage can throw in
   private modes, so every access is guarded and degrades to
   an in-memory stub rather than breaking the page.
   ============================================================ */

window.Store = (function () {

  var KEY = {
    runs: "typo.runs.v2",
    best: "typo.best.v2",
    settings: "typo.settings.v1"
  };

  var LEGACY = {
    runs: "typo.runs.v1",
    best: "typo.best.v1"
  };

  var MAX_RUNS = 100;
  var memory = {};

  function read(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      return key in memory ? memory[key] : fallback;
    }
  }

  function write(key, value) {
    memory[key] = value;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* quota or blocked storage: memory copy still serves this session */
    }
  }

  function getSettings() {
    var saved = read(KEY.settings, {});
    return {
      theme: saved.theme === "dark" ? "dark" : "light",
      sound: saved.sound === true,
      taught: saved.taught === true
    };
  }

  function saveSettings(patch) {
    var next = getSettings();
    if (patch.theme === "light" || patch.theme === "dark") next.theme = patch.theme;
    if (typeof patch.sound === "boolean") next.sound = patch.sound;
    if (typeof patch.taught === "boolean") next.taught = patch.taught;
    write(KEY.settings, next);
    return next;
  }

  function bestKey(mode, param) {
    return mode + ":" + param;
  }

  function getBests() {
    return read(KEY.best, {});
  }

  function getHistory() {
    var list = read(KEY.runs, []);
    return Array.isArray(list) ? list : [];
  }

  /* Returns true when this run set a new personal best for its
     mode and parameter pair. Accuracy is the tie-breaker. */
  function addRun(record) {
    var runs = getHistory();
    runs.unshift(record);
    if (runs.length > MAX_RUNS) runs.length = MAX_RUNS;
    write(KEY.runs, runs);

    var key = bestKey(record.mode, record.param);
    var bests = getBests();
    var prev = bests[key];
    var isBest = !prev ||
      record.cpm > prev.cpm ||
      (record.cpm === prev.cpm && record.acc > prev.acc);

    if (isBest) {
      bests[key] = { cpm: record.cpm, acc: record.acc, at: record.at };
      write(KEY.best, bests);
    }

    return isBest;
  }

  function clearAll() {
    write(KEY.runs, []);
    write(KEY.best, {});
  }

  /* v1 stored words per minute. Reading those numbers back as
     characters per minute would show every past run as five times too
     slow, so convert them once rather than silently reinterpret them. */
  function migrateFromWords() {
    if (read(KEY.runs, null) !== null) return;

    var old = read(LEGACY.runs, null);
    if (old === null) return;

    var runs = Array.isArray(old) ? old : [];
    write(KEY.runs, runs.map(function (run) {
      return {
        mode: run.mode,
        param: run.param,
        cpm: Math.round((run.wpm || 0) * 5),
        raw: Math.round((run.raw || 0) * 5),
        acc: run.acc,
        cons: run.cons,
        chars: run.chars,
        time: run.time,
        at: run.at
      };
    }));

    var bests = read(LEGACY.best, {}) || {};
    var next = {};
    Object.keys(bests).forEach(function (key) {
      next[key] = {
        cpm: Math.round((bests[key].wpm || 0) * 5),
        acc: bests[key].acc,
        at: bests[key].at
      };
    });
    write(KEY.best, next);
  }

  migrateFromWords();

  return {
    getSettings: getSettings,
    saveSettings: saveSettings,
    getBests: getBests,
    getHistory: getHistory,
    addRun: addRun,
    clearAll: clearAll,
    bestKey: bestKey
  };

})();
