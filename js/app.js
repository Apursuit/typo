/* ============================================================
   typo — application shell
   Mode selection, text sourcing, input plumbing, the result
   screen and its chart, and the local statistics panel.
   ============================================================ */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    bar: $("bar"),
    modes: $("modes"),
    params: $("params"),
    typing: $("typing"),
    wordsInner: $("wordsInner"),
    wordsText: $("wordsText"),
    caret: $("caret"),
    readout: $("readout"),
    hint: $("hint"),
    tick: $("tick"),
    tickFill: $("tickFill"),
    rCpm: $("rCpm"),
    rAcc: $("rAcc"),
    rTime: $("rTime"),
    typer: $("typer"),
    result: $("result"),
    resCpm: $("resCpm"),
    resAcc: $("resAcc"),
    resBest: $("resBest"),
    resRaw: $("resRaw"),
    resCons: $("resCons"),
    resChars: $("resChars"),
    resTime: $("resTime"),
    chart: $("chart"),
    resSource: $("resSource"),
    btnNext: $("btnNext"),
    btnRepeat: $("btnRepeat"),
    nextLabel: $("nextLabel"),
    tools: document.querySelector(".tools"),
    btnStats: $("btnStats"),
    btnSound: $("btnSound"),
    btnTheme: $("btnTheme"),
    panel: $("panel"),
    btnClose: $("btnClose"),
    btnClear: $("btnClear"),
    bestList: $("bestList"),
    histList: $("histList"),
    histEmpty: $("histEmpty"),
    handsFigure: $("handsFigure"),
    teach: $("teach"),
    btnTeach: $("btnTeach"),
    btnTeachOk: $("btnTeachOk"),
    btnTeachClose: $("btnTeachClose"),
    panelLessons: $("panelLessons"),
    lessonsBody: $("lessonsBody"),
    btnLessonsClose: $("btnLessonsClose")
  };

  var MODES = {
    learn: { params: [], fallback: null },
    time:  { params: [15, 30, 60, 120], fallback: 30 },
    words: { params: [10, 25, 50, 100], fallback: 25 },
    quote: { params: ["short", "medium", "long"], fallback: "medium" },
    zen:   { params: [], fallback: null }
  };

  var LABEL = { short: "短", medium: "中", long: "长" };

  /* anything outside ASCII means an IME is on, not a typist making
     mistakes — see the input handler */
  var NON_ASCII = /[^\x00-\x7F]/;

  var MODE_CN = { time: "限时", words: "词数", quote: "名言", zen: "无限", drill: "课程" };

  /* Parameters read as a bare number in English but need their unit
     spelled out once the interface is Chinese. */
  function paramLabel(value) {
    if (LABEL[value]) return LABEL[value];
    if (state.mode === "time") return value + "秒";
    if (state.mode === "words") return value + "词";
    return String(value);
  }

  var state = {
    mode: "learn",
    param: null,
    drill: null,
    quote: null,
    text: "",
    engine: null,
    lastQuote: -1,
    lastResult: null,
    dimmed: false,
    settings: null
  };

  /* ============================================================
     text sourcing
     ============================================================ */

  function randomWords(count) {
    var pool = window.WORDS;
    var out = [];
    var prev = "";
    for (var i = 0; i < count; i++) {
      var word;
      var guard = 0;
      do {
        word = pool[Math.floor(Math.random() * pool.length)];
        guard++;
      } while (word === prev && guard < 8);
      out.push(word);
      prev = word;
    }
    return out;
  }

  function pickQuote(bucket) {
    var list = (window.QUOTES && window.QUOTES[bucket]) || window.QUOTES.medium;
    if (list.length < 2) return list[0];
    var index = Math.floor(Math.random() * list.length);
    if (index === state.lastQuote) index = (index + 1) % list.length;
    state.lastQuote = index;
    return list[index];
  }

  function buildText() {
    state.quote = null;

    switch (state.mode) {
      case "learn":
        var drill = window.Drill.byId(state.drill);
        return drill ? window.Drill.text(drill) : window.Drill.text(window.DRILLS[0]);
      case "quote":
        /* carry the whole quote, not just its text — the source is
           shown on the result screen, and re-deriving it from a
           stored index breaks the moment the run is repeated */
        state.quote = pickQuote(state.param);
        return state.quote.text;
      case "words":
        return randomWords(state.param).join(" ");
      case "time":
        /* Extended on demand while typing, see onProgress. The initial
           run only has to cover the first stretch comfortably. */
        return randomWords(Math.ceil(state.param * 2.2) + 24).join(" ");
      case "zen":
        return randomWords(160).join(" ");
      default:
        return randomWords(50).join(" ");
    }
  }

  /* ============================================================
     modes and parameters
     ============================================================ */

  function renderModes() {
    var buttons = els.modes.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("is-on", buttons[i].dataset.mode === state.mode);
    }
  }

  function renderParams() {
    els.params.textContent = "";

    /* learn has no parameters — its right-hand slot is navigation */
    if (state.mode === "learn") {
      var index = window.Drill.indexOf(state.drill);
      if (index >= 0) {
        var where = document.createElement("span");
        where.className = "param-note";
        where.textContent = (index + 1) + " / " + window.DRILLS.length;
        els.params.appendChild(where);
      }

      var all = document.createElement("button");
      all.type = "button";
      all.textContent = "全部课程";
      all.addEventListener("click", openLessons);
      els.params.appendChild(all);
      return;
    }

    MODES[state.mode].params.forEach(function (value) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = paramLabel(value);
      if (value === state.param) button.classList.add("is-on");
      button.addEventListener("click", function () {
        if (state.param === value) return;
        state.param = value;
        renderParams();
        startFresh();
      });
      els.params.appendChild(button);
    });
  }

  function setMode(mode) {
    if (!MODES[mode] || state.mode === mode) return;
    state.mode = mode;
    state.param = MODES[mode].fallback;
    state.lastQuote = -1;
    renderModes();
    renderParams();

    if (mode === "learn") {
      startDrill(suggestedLesson() || window.DRILLS[0].id);
      return;
    }
    startFresh();
  }

  /* ============================================================
     run lifecycle
     ============================================================ */

  function limitFor() {
    return state.mode === "time" ? state.param : null;
  }

  /* The hint is the only place the escape route is stated before a
     run starts, so it changes with the mode. */
  function hintFor() {
    if (state.mode === "learn") return "开始输入 · Esc 打开课程表";
    if (state.mode === "zen") return "开始输入 · Esc 结束本轮";
    return "开始输入";
  }

  /* Anything needing the typist's attention borrows the hint slot and
     hands it back, rather than adding a permanent second line the
     interface would then have to carry everywhere. */
  var hintTimer = 0;

  function restoreHint() {
    els.hint.textContent = hintFor();
    var running = state.engine && state.engine.started && !state.engine.finished;
    els.hint.classList.toggle("is-out", !!running);
  }

  function flashHint(text) {
    els.hint.textContent = text;
    els.hint.classList.remove("is-out");
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(restoreHint, 2400);
  }

  function focusTyper() {
    try { els.typer.focus({ preventScroll: true }); } catch (err) { els.typer.focus(); }
  }

  function undim() {
    state.dimmed = false;
    els.bar.classList.remove("is-dim");
    els.tools.classList.remove("is-dim");
    els.hint.classList.remove("is-out");
  }

  function dim() {
    state.dimmed = true;
    els.bar.classList.add("is-dim");
    els.tools.classList.add("is-dim");
    els.hint.classList.add("is-out");
  }

  function attach(text) {
    state.text = text;

    els.typer.value = "";
    els.result.hidden = true;
    els.typing.hidden = false;
    els.readout.classList.remove("is-out");

    if (state.engine) state.engine.destroy();

    state.engine = new window.Engine({
      text: text,
      limit: limitFor(),
      els: {
        text: els.wordsText,
        caret: els.caret,
        inner: els.wordsInner
      },
      onChange: onProgress,
      onEnd: onEnd
    });

    els.rCpm.textContent = "0";
    els.rAcc.textContent = "100";
    els.rTime.textContent = "0";

    els.hint.textContent = hintFor();

    state.lastGood = "";
    state.textCapped = false;
    els.tick.classList.toggle("on", state.mode === "time");
    els.tickFill.style.transform = "scaleX(0)";
    els.typing.classList.remove("is-idle");

    undim();
    focusTyper();
    requestAnimationFrame(function () {
      if (state.engine) state.engine.moveCaret();
    });
  }

  /* A fresh run: new text. */
  function startFresh() {
    attach(buildText());
  }

  /* The same text again. */
  function startRepeat() {
    if (!state.text) return startFresh();
    attach(state.text);
  }

  /* ============================================================
     lessons
     ============================================================ */

  function bestFor(id) {
    return window.Store.getBests()[window.Store.bestKey("drill", id)];
  }

  function completedCount() {
    var n = 0;
    window.DRILLS.forEach(function (drill) { if (bestFor(drill.id)) n++; });
    return n;
  }

  /* The first lesson still without a personal best is the one to
     point at — everything before it has been passed already. */
  function suggestedLesson() {
    for (var i = 0; i < window.DRILLS.length; i++) {
      if (!bestFor(window.DRILLS[i].id)) return window.DRILLS[i].id;
    }
    return null;
  }

  /* The syllabus lives in a dialog, not on the page: the first thing
     a course should show is a run, not a table of contents. */
  function openLessons() {
    renderStages();
    openDialog(els.panelLessons);
  }

  function startDrill(id) {
    var drill = window.Drill.byId(id);
    if (!drill) return;

    /* picking a lesson is how most runs start; leaving the syllabus
       open here would silently block all typing */
    if (els.panelLessons.open) els.panelLessons.close();

    state.drill = id;
    attach(window.Drill.text(drill));
    renderParams();
  }

  /* What "next" means depends on where the run came from: inside the
     course it walks the syllabus, everywhere else it reshuffles. */
  function advance() {
    if (state.mode === "learn" && state.drill) {
      var next = window.Drill.nextOf(state.drill);
      if (next) {
        startDrill(next.id);
        return;
      }
      /* past the last lesson there is nothing to advance to */
      openLessons();
      return;
    }
    startFresh();
  }

  function renderStages() {
    var suggested = suggestedLesson();
    els.lessonsBody.textContent = "";

    var progress = document.createElement("p");
    progress.className = "lessons-progress";
    var done = completedCount();
    progress.textContent = done === window.DRILLS.length
      ? window.DRILLS.length + " 关全部完成"
      : "已过 " + done + " / " + window.DRILLS.length + " 关";
    progress.classList.toggle("is-full", done === window.DRILLS.length);
    els.lessonsBody.appendChild(progress);

    window.DRILL_STAGES.forEach(function (stage) {
      var section = document.createElement("section");
      section.className = "lesson-group";

      var head = document.createElement("div");
      head.className = "stage-head";
      var title = document.createElement("h3");
      title.textContent = stage.title;
      var blurb = document.createElement("p");
      blurb.textContent = stage.blurb;
      head.appendChild(title);
      head.appendChild(blurb);
      section.appendChild(head);

      window.DRILLS.forEach(function (drill) {
        if (drill.stage !== stage.n) return;
        section.appendChild(lessonRow(drill, drill.id === suggested));
      });

      els.lessonsBody.appendChild(section);
    });
  }

  function lessonRow(drill, isNext) {
    var best = bestFor(drill.id);

    var row = document.createElement("button");
    row.type = "button";
    row.className = "lesson" + (best ? " is-done" : "") + (isNext ? " is-next" : "");

    var dot = document.createElement("span");
    dot.className = "dot";

    var main = document.createElement("span");
    main.className = "lesson-main";

    var name = document.createElement("span");
    name.className = "lesson-name";
    name.textContent = drill.name;

    var note = document.createElement("span");
    note.className = "lesson-note";
    note.textContent = drill.note;

    main.appendChild(name);
    main.appendChild(note);

    var score = document.createElement("span");
    score.className = "lesson-best";
    score.textContent = best ? best.cpm + " 字符/分" : "";

    row.appendChild(dot);
    row.appendChild(main);
    row.appendChild(score);
    row.addEventListener("click", function () { startDrill(drill.id); });
    return row;
  }

  /* ---------- keyboard diagram ---------- */

  /* Plain boxes rather than SVG: an inline <svg> depends on the browser
     deriving an intrinsic ratio from the viewBox, and where that fails
     the figure collapses to zero height. Flex boxes cannot do that. */
  function buildKeyboard() {
    var frag = document.createDocumentFragment();

    window.KEY_ROWS.forEach(function (row) {
      var line = document.createElement("div");
      line.className = "kb-row";
      line.setAttribute("data-row", row.name);

      for (var i = 0; i < row.keys.length; i++) {
        var key = document.createElement("span");
        key.className = "kb-key f-" + window.KEY_FINGERS[i] +
          (row.home ? " home" : "") +
          (row.home && (i === 3 || i === 6) ? " bump" : "");
        key.textContent = row.keys.charAt(i);
        line.appendChild(key);
      }

      frag.appendChild(line);
    });

    els.handsFigure.textContent = "";
    els.handsFigure.appendChild(frag);
  }

  function openDialog(node) {
    if (typeof node.showModal === "function") node.showModal();
    else node.setAttribute("open", "");
  }

  /* A modal dialog renders everything behind it inert. Any path that
     leaves one open — picking a lesson, dismissing the tutorial — would
     silently swallow every subsequent keystroke, so closing and focus
     restoration are handled in one place instead of at each call site. */
  function wireDialogs() {
    [els.teach, els.panelLessons, els.panel].forEach(function (node) {
      /* clicking the backdrop is the click target being the dialog itself */
      node.addEventListener("click", function (event) {
        if (event.target === node) node.close();
      });

      node.addEventListener("close", function () {
        focusTyper();
      });
    });

    /* however the tutorial is dismissed — escape, the cross, or the
       button — it has been seen. Raising it again on every visit is
       nagging, not teaching. */
    els.teach.addEventListener("close", function () {
      state.settings = window.Store.saveSettings({ taught: true });
    });
  }

  /* ---------- onboarding ---------- */

  function openTeach() {
    openDialog(els.teach);
  }

  function dismissTeach() {
    els.teach.close();
  }

  function onProgress(s) {
    els.rCpm.textContent = String(Math.round(s.cpm) || 0);

    /* a timed run counts down — what matters to the typist is what
       is left, not what has gone */
    if (state.mode === "time" && state.param) {
      els.rTime.textContent = String(Math.max(0, Math.ceil(state.param - s.seconds)));
      els.tickFill.style.transform =
        "scaleX(" + Math.min(1, s.seconds / state.param).toFixed(4) + ")";
    } else {
      els.rTime.textContent = String(Math.floor(s.seconds));
    }

    var typed = s.correct + s.incorrect + s.extra;
    var acc = typed === 0 ? 100 : (s.correct / typed) * 100;
    els.rAcc.textContent = String(Math.round(acc));

    if (!s.progress && !state.engine.started) return;

    /* A timed run extends like zen. Its text is generated long, but a
       fast typist can still outrun it — and because a timed run has no
       length-based finish, every key past the end would count as an
       error with no way to recover until the clock ran out. */
    var endless = state.mode === "zen" || state.mode === "time";
    if (endless && state.engine.remaining() < 130) {
      var grew = state.engine.appendText(" " + randomWords(48).join(" "));
      if (!grew && !state.textCapped) {
        state.textCapped = true;
        flashHint("已到本段长度上限，Esc 结束并查看成绩");
      }
    }

    if (state.engine.started && !state.dimmed && s.progress > 0) dim();
  }

  function onEnd(result) {
    var acc = window.Stats.accuracy(result.correct, result.incorrect, result.extra);
    var cons = consistencyOf(result.samples);

    var record = {
      mode: state.mode === "learn" ? "drill" : state.mode,
      param: state.mode === "learn" ? state.drill : state.param,
      cpm: Math.round(result.cpm),
      raw: Math.round(result.raw),
      acc: Math.round(acc),
      cons: Math.round(cons),
      chars: result.correct,
      time: Math.round(result.seconds),
      at: Date.now()
    };

    var isBest = window.Store.addRun(record);
    state.lastResult = { record: record, raw: result };

    showResult(record, result, isBest);
  }

  /* Instantaneous rate between consecutive samples. Using the
     running average instead would report a flattering, monotone
     curve and hide every pause in the run. */
  function consistencyOf(samples) {
    if (!samples || samples.length < 3) return 0;
    var rates = [];
    for (var i = 1; i < samples.length; i++) {
      var dt = samples[i].t - samples[i - 1].t;
      var dc = samples[i].correct - samples[i - 1].correct;
      if (dt > 0 && dc >= 0) rates.push(dc / (dt / 60));
    }
    return window.Stats.consistency(rates);
  }

  /* ============================================================
     result screen
     ============================================================ */

  function showResult(record, result, isBest) {
    els.typing.hidden = true;
    els.result.hidden = false;

    els.resCpm.textContent = String(record.cpm);
    els.resAcc.textContent = String(record.acc);
    els.resRaw.textContent = String(record.raw);
    els.resCons.textContent = record.cons > 0 ? String(record.cons) : "—";
    els.resChars.textContent = String(record.chars);
    els.resTime.textContent = record.time + " 秒";
    els.resBest.hidden = !isBest;

    /* the label has to name what the key will actually do: another
       lesson, the way back to the syllabus, or just a fresh set */
    if (state.mode === "learn") {
      els.nextLabel.textContent = window.Drill.nextOf(state.drill) ? "下一关" : "全部课程";
    } else {
      els.nextLabel.textContent = "换一组";
    }

    undim();

    var source = state.quote && state.quote.from ? state.quote.from : "";
    els.resSource.textContent = source ? "— " + source : "";
    els.resSource.hidden = !source;

    requestAnimationFrame(function () {
      drawChart(result.samples);
    });
  }

  /* ---------- chart ---------- */

  function cssVar(name) {
    return window.getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
  }

  function drawChart(samples) {
    var canvas = els.chart;
    if (!canvas) return;

    var dpr = window.devicePixelRatio || 1;
    var width = canvas.clientWidth || canvas.parentNode.clientWidth || 480;
    var height = 150;

    /* A run under a second produces no samples at all. Leaving the
       canvas blank reads as a rendering failure, so say why it is
       empty instead. */
    if (!samples || samples.length < 2) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.height = height + "px";

      var ctx0 = canvas.getContext("2d");
      ctx0.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx0.clearRect(0, 0, width, height);
      ctx0.fillStyle = cssVar("--fg-faint") || "#d9d7d1";
      ctx0.font = "12px " + (cssVar("--mono") || "monospace");
      ctx0.textAlign = "center";
      ctx0.textBaseline = "middle";
      ctx0.fillText("这一轮太短，还没有速度曲线", width / 2, height / 2);
      return;
    }

    /* sampling starts after the first second, which would leave the
       left edge of the chart empty — anchor the series at the origin */
    var series = samples.slice();
    if (series[0].t > 0.25) {
      series.unshift({ t: 0, cpm: 0, raw: 0, correct: 0, errors: 0 });
    }

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = height + "px";

    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    var padTop = 14;
    var padBottom = 22;
    var plotH = height - padTop - padBottom;

    var total = series[series.length - 1].t || 1;
    var peak = 0;
    series.forEach(function (s) {
      peak = Math.max(peak, s.cpm, s.raw);
    });
    peak = Math.max(20, peak * 1.12);

    var xOf = function (s) { return (s.t / total) * width; };
    var yOf = function (v) { return padTop + plotH - (v / peak) * plotH; };

    var accent = cssVar("--accent") || "#1d9e75";
    var faint = cssVar("--fg-faint") || "#d9d7d1";
    var dim = cssVar("--fg-dim") || "#b3b1aa";
    var line = cssVar("--line") || "#e7e5df";

    /* baseline */
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, padTop + plotH + 0.5);
    ctx.lineTo(width, padTop + plotH + 0.5);
    ctx.stroke();

    var rawPoints = series.map(function (s) {
      return { x: xOf(s), y: yOf(s.raw) };
    });
    var cpmPoints = series.map(function (s) {
      return { x: xOf(s), y: yOf(s.cpm) };
    });

    /* raw sits behind, quiet */
    ctx.strokeStyle = faint;
    ctx.lineWidth = 1.5;
    trace(ctx, rawPoints);

    /* net cpm with a soft fill */
    ctx.beginPath();
    ctx.moveTo(cpmPoints[0].x, padTop + plotH);
    cpmPoints.forEach(function (p) { ctx.lineTo(p.x, p.y); });
    ctx.lineTo(cpmPoints[cpmPoints.length - 1].x, padTop + plotH);
    ctx.closePath();
    ctx.fillStyle = hexAlpha(accent, 0.13);
    ctx.fill();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    trace(ctx, cpmPoints);

    /* axis hints */
    ctx.fillStyle = dim;
    ctx.font = "11px " + (cssVar("--mono") || "monospace");
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText("0 秒", 0, padTop + plotH + 6);
    ctx.textAlign = "right";
    ctx.fillText(Math.round(total) + " 秒", width, padTop + plotH + 6);
    ctx.textAlign = "left";
    ctx.fillText(Math.round(peak) + " 字符/分", 0, 0);
  }

  function trace(ctx, points) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) {
      var prev = points[i - 1];
      var cur = points[i];
      var mx = (prev.x + cur.x) / 2;
      var my = (prev.y + cur.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    var last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  function hexAlpha(hex, alpha) {
    var value = hex.replace("#", "").trim();
    if (value.length === 3) {
      value = value.split("").map(function (c) { return c + c; }).join("");
    }
    if (value.length !== 6) return hex;
    var r = parseInt(value.slice(0, 2), 16);
    var g = parseInt(value.slice(2, 4), 16);
    var b = parseInt(value.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  /* ============================================================
     statistics panel
     ============================================================ */

  var ORDER = [
    ["time", [15, 30, 60, 120]],
    ["words", [10, 25, 50, 100]],
    ["quote", ["short", "medium", "long"]],
    ["zen", [null]],
    ["drill", window.DRILLS.map(function (drill) { return drill.id; })]
  ];

  /* Lessons are stored by id, which means nothing to a reader —
     show the drill's own name instead. */
  function labelFor(mode, param) {
    var name = MODE_CN[mode] || mode;
    if (mode === "drill") {
      var drill = window.Drill.byId(param);
      return "课程 · " + (drill ? drill.name : param);
    }
    if (param === null) return name;
    if (mode === "time") return name + " · " + param + "秒";
    if (mode === "words") return name + " · " + param + "词";
    return name + " · " + (LABEL[param] || param);
  }

  function updatePanel() {
    var bests = window.Store.getBests();
    els.bestList.textContent = "";

    var any = false;
    ORDER.forEach(function (group) {
      group[1].forEach(function (param) {
        var key = window.Store.bestKey(group[0], param);
        var entry = bests[key];
        if (!entry) return;
        any = true;

        var row = document.createElement("div");
        var dt = document.createElement("dt");
        var dd = document.createElement("dd");

        dt.textContent = labelFor(group[0], param);
        dd.textContent = entry.cpm + " 字符/分 · " + entry.acc + "%";

        row.appendChild(dt);
        row.appendChild(dd);
        els.bestList.appendChild(row);
      });
    });

    if (!any) {
      var none = document.createElement("p");
      none.className = "empty";
      none.textContent = "还没有个人最佳";
      els.bestList.appendChild(none);
    }

    var runs = window.Store.getHistory().slice(0, 20);
    els.histList.textContent = "";
    els.histEmpty.hidden = runs.length > 0;

    runs.forEach(function (run) {
      var li = document.createElement("li");

      var label = document.createElement("span");
      label.textContent = labelFor(run.mode, run.param);

      var cpm = document.createElement("span");
      cpm.className = "h-wpm";
      cpm.textContent = run.cpm;

      var acc = document.createElement("span");
      acc.textContent = run.acc + "%";

      var when = document.createElement("span");
      when.className = "h-when";
      when.textContent = relativeTime(run.at);

      li.appendChild(label);
      li.appendChild(cpm);
      li.appendChild(acc);
      li.appendChild(when);
      els.histList.appendChild(li);
    });
  }

  function relativeTime(stamp) {
    var diff = Date.now() - stamp;
    var minute = 60000;
    var hour = 60 * minute;
    var day = 24 * hour;

    if (diff < minute) return "刚刚";
    if (diff < hour) return Math.floor(diff / minute) + " 分钟前";
    if (diff < day) return Math.floor(diff / hour) + " 小时前";
    return Math.floor(diff / day) + " 天前";
  }

  /* ============================================================
     sound — synthesised, no assets
     ============================================================ */

  var audio = null;

  function blip(frequency, level) {
    if (!state.settings.sound) return;
    try {
      if (!audio) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audio = new Ctx();
      }
      if (audio.state === "suspended") audio.resume();

      var now = audio.currentTime;
      var osc = audio.createOscillator();
      var gain = audio.createGain();

      osc.type = "triangle";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(level, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    } catch (err) {
      /* audio is a nicety, never a failure path */
    }
  }

  /* ============================================================
     input wiring
     ============================================================ */

  function wireInput() {
    els.typer.addEventListener("input", function (event) {
      if (event.isComposing) return;
      var value = els.typer.value;
      var ceiling = state.text.length + 48;

      if (value.length > ceiling) {
        value = value.slice(0, ceiling);
        els.typer.value = value;
      }

      /* An IME commits a whole character at a time. Matched against an
         English target every one of them is wrong, the run collapses to
         zero accuracy, and nothing on screen says why. Roll the
         keystroke back and name the cause instead. */
      if (NON_ASCII.test(value)) {
        els.typer.value = state.lastGood || "";
        try { els.typer.setSelectionRange(els.typer.value.length, els.typer.value.length); } catch (err) {}
        flashHint("请切换到英文输入法");
        return;
      }

      state.lastGood = value;

      /* keep the caret pinned to the end so typing stays linear */
      try { els.typer.setSelectionRange(value.length, value.length); } catch (err) {}

      if (state.engine) state.engine.push(value);
    });

    els.typer.addEventListener("keydown", function (event) {
      var caps = typeof event.getModifierState === "function" &&
        event.getModifierState("CapsLock");
      if (caps && !state.capsWarned) {
        state.capsWarned = true;
        flashHint("大写锁定已开启");
      } else if (!caps) {
        state.capsWarned = false;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1 && event.key !== "Backspace") return;
      if (!state.engine || state.engine.finished) return;

      /* correct or not is the engine's business; the click only
         reports that a key landed */
      if (event.key === "Backspace") blip(320, 0.035);
      else blip(660, 0.03);
    });

    /* losing focus silently swallows keystrokes — the classic "the page
       stopped working" report. Say so, and dim the text so the pause
       reads as deliberate rather than broken. */
    els.typer.addEventListener("blur", function () {
      if (!state.engine || state.engine.finished) return;
      els.typing.classList.add("is-idle");
      flashHint("点击页面继续");
    });

    els.typer.addEventListener("focus", function () {
      els.typing.classList.remove("is-idle");
      window.clearTimeout(hintTimer);
      restoreHint();
    });

    document.addEventListener("keydown", function (event) {
      /* Escape closes whatever is on top. Modal dialogs do this
         natively, but closing it here as well keeps the reflex working
         regardless, and keeps the page-level escape from firing
         underneath and reopening the syllabus right after. */
      var raised = [els.teach, els.panelLessons, els.panel].filter(function (node) {
        return node.open;
      });

      if (raised.length) {
        if (event.key === "Escape") raised[0].close();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        var running = state.engine && state.engine.started && !state.engine.finished;
        /* zen has no finish line, so escape ends the run there;
           inside a lesson it steps back out to the syllabus;
           everywhere else it is the quick way back to the start */
        if (state.mode === "zen" && running) state.engine.finish("manual");
        else if (state.mode === "learn" && els.result.hidden) openLessons();
        else startRepeat();
        return;
      }

      if (!els.result.hidden && event.key === "Enter") {
        event.preventDefault();
        advance();
      }
    });

    document.addEventListener("mousedown", function (event) {
      var node = event.target;
      if (!(node instanceof Element)) return;
      if (node.closest("button, dialog, a, input")) return;
      focusTyper();
    });

    /* A button keeps the focus after being clicked, and keystrokes then
       go nowhere — the controls in the corner never rebuild the run, so
       nothing was taking the focus back. Let each button's own handler
       run first, then reclaim it. A dialog is the one exception: it
       owns the focus for as long as it is open. */
    document.addEventListener("click", function (event) {
      if (!(event.target instanceof Element)) return;
      window.requestAnimationFrame(function () {
        if (els.panel.open || els.teach.open || els.panelLessons.open) return;
        if (document.activeElement === els.typer) return;
        focusTyper();
      });
    });

    var idleTimer = 0;
    document.addEventListener("mousemove", function () {
      undim();
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(function () {
        if (state.engine && state.engine.started && !state.engine.finished) dim();
      }, 2200);
    });
  }

  /* ============================================================
     settings
     ============================================================ */

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (state.lastResult) {
      requestAnimationFrame(function () {
        drawChart(state.lastResult.raw.samples);
      });
    }
  }

  function wireTools() {
    els.btnTheme.addEventListener("click", function () {
      var next = state.settings.theme === "dark" ? "light" : "dark";
      state.settings = window.Store.saveSettings({ theme: next });
      applyTheme(next);
    });

    els.btnSound.addEventListener("click", function () {
      var next = !state.settings.sound;
      state.settings = window.Store.saveSettings({ sound: next });
      els.btnSound.setAttribute("aria-pressed", next ? "true" : "false");
      if (next) blip(660, 0.03);
    });

    els.btnStats.addEventListener("click", function () {
      updatePanel();
      openDialog(els.panel);
    });

    els.btnTeach.addEventListener("click", openTeach);
    els.btnTeachOk.addEventListener("click", dismissTeach);
    els.btnTeachClose.addEventListener("click", function () { els.teach.close(); });
    els.btnLessonsClose.addEventListener("click", function () { els.panelLessons.close(); });

    els.btnClose.addEventListener("click", function () { els.panel.close(); });

    els.btnClear.addEventListener("click", function () {
      window.Store.clearAll();
      updatePanel();
    });

    els.btnNext.addEventListener("click", function () { advance(); });
    els.btnRepeat.addEventListener("click", function () { startRepeat(); });

    els.modes.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-mode]");
      if (button) setMode(button.dataset.mode);
    });

    var resizeTimer = 0;
    window.addEventListener("resize", function () {
      if (els.result.hidden || !state.lastResult) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        drawChart(state.lastResult.raw.samples);
      }, 150);
    });
  }

  /* ============================================================
     boot
     ============================================================ */

  function boot() {
    state.settings = window.Store.getSettings();
    applyTheme(state.settings.theme);
    els.btnSound.setAttribute("aria-pressed", state.settings.sound ? "true" : "false");

    renderModes();
    wireInput();
    wireTools();
    wireDialogs();

    buildKeyboard();

    if (state.mode === "learn") {
      startDrill(suggestedLesson() || window.DRILLS[0].id);
    } else {
      startFresh();
    }

    /* the tutorial is shown once and dismissed for good — but it has
       to come after the first run is on screen, or it would sit in
       front of an empty page */
    if (!state.settings.taught) openTeach();

    /* the layout shifts slightly once the webfont lands, which
       moves every character — re-measure the caret when it does */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (state.engine) state.engine.moveCaret();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})();
