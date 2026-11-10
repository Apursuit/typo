/* ============================================================
   typo — typing engine

   The engine owns four things and nothing else:
     1. the character state derived from (target, typed)
     2. the caret position and the scroll offset that keeps it
        visible
     3. the clock and the per-second samples the chart needs
     4. the per-keystroke feedback: pulse, streak, live rate

   Character state is derived, never stored per keystroke:
   position i is correct when typed[i] === target[i], wrong when
   it differs, and anything past the target is "extra". Backspace
   needs no special handling because the derivation is total.

   Painting is diffed against a shadow array so a keystroke only
   touches the spans whose state actually changed.

   Geometry is measured into a cache instead of being read back once
   per keystroke. Reading offsetLeft right after writing a className
   forces a synchronous layout; at ten keystrokes a second, three of
   those per key is what made fast typing feel gritty. The layout is
   now read once per text change and on resize, never on the
   keystroke path.
   ============================================================ */

window.Engine = (function () {

  var KEEP_LINE = 1;         /* caret rests on the second visible line */
  var SAMPLE_MS = 1000;      /* chart resolution */
  var EXTRA_POOL = 48;       /* spans reserved for overshoot */
  /* Guard rail for the endless modes. Reaching it takes roughly an
     hour of continuous typing at a normal pace, and the caller warns
     once when it happens rather than letting text stop silently. */
  var MAX_TEXT = 24000;

  /* The live readout reports the last five seconds, not the average
     since the first key. An average moves by a fraction of a point per
     keystroke, so it reads as a number that never reacts; a window
     shows what the hands are doing right now. */
  var RATE_WINDOW = 5000;
  var RATE_FLOOR = 1000;     /* a shorter window is divided by this */

  var PULSE_MS = 110;
  var SHAKE_MS = 95;
  var LINE_MS = 90;

  var reduced = false;
  try {
    reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (err) { /* the query is old enough to rely on; not worth a throw */ }

  function Engine(cfg) {
    this.els = cfg.els;
    this.onChange = cfg.onChange || function () {};
    this.onEnd = cfg.onEnd || function () {};
    this.limit = cfg.limit || null;

    this.spans = [];
    this.painted = [];
    this.extra = [];
    this.geo = [];
    this.extraGeo = [];

    this.reset(cfg.text, cfg.limit);
  }

  /* ---------- lifecycle ---------- */

  Engine.prototype.reset = function (text, limit) {
    this.text = text;
    this.limit = limit === undefined ? this.limit : limit;
    this.input = "";
    this.painted = [];
    this.dirtyTo = 0;
    this.started = false;
    this.finished = false;
    this.startTime = 0;
    this.endTime = 0;
    this.lastSample = 0;
    this.samples = [];
    this.scrollOffset = 0;
    this.raf = 0;

    /* feedback state */
    this.geo = [];
    this.extraGeo = [];
    this.lineHeight = 0;
    this.caretX = 0;
    this.caretY = 0;
    this.caretPlaced = false;
    this.caretShifted = false;
    this.recent = [];
    this.streak = 0;
    this.streakMax = 0;
    this.errors = 0;
    this.errMap = Object.create(null);

    this.els.inner.style.transform = "translateY(0px)";
    this.els.text.textContent = "";

    var frag = document.createDocumentFragment();
    this.spans = [];
    for (var i = 0; i < text.length; i++) {
      var sp = document.createElement("span");
      sp.className = "ch";
      sp.textContent = text.charAt(i);
      frag.appendChild(sp);
      this.spans.push(sp);
    }
    this.els.text.appendChild(frag);

    var pool = document.createDocumentFragment();
    this.extra = [];
    for (var j = 0; j < EXTRA_POOL; j++) {
      var ex = document.createElement("span");
      ex.className = "ch";
      pool.appendChild(ex);
      this.extra.push(ex);
    }
    this.els.text.appendChild(pool);

    this.paint();
    this.measure();
    this.moveCaret();
  };

  Engine.prototype.destroy = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  /* ---------- input ---------- */

  Engine.prototype.push = function (value) {
    if (this.finished) return;

    var before = this.input;
    this.input = value;

    if (!this.started && value.length > 0) {
      this.started = true;
      this.startTime = performance.now();
      this.lastSample = 0;
      this.scheduleTick();
    }

    this.paint();
    this.moveCaret();

    /* One new character is a keystroke and gets a pulse. Two or more is
       a paste or an autocomplete — firing forty animations in one frame
       would be noise, so only the count is booked. */
    var delta = value.length - before.length;
    if (delta === 1) {
      this.registerHit(value.length - 1);
    } else if (delta > 1) {
      this.registerBulk(value.length - 1);
    }

    var state = this.snapshot();
    this.onChange(state);

    if (this.complete()) {
      this.finish("complete");
    }
  };

  /* Time and word modes end the moment the target is reached.
     A wrong final character still ends the run — otherwise a typo
     on the last letter would strand the user with no way out. */
  Engine.prototype.complete = function () {
    if (this.limit !== null) return false;
    return this.input.length >= this.text.length;
  };

  Engine.prototype.finish = function (reason) {
    if (this.finished) return;
    this.finished = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;

    var seconds = this.elapsed();
    if (this.started && seconds > 0) {
      this.samples.push(this.sampleAt(seconds, seconds));
    }

    var result = this.snapshot();
    result.reason = reason;
    result.seconds = seconds;
    result.samples = this.samples;
    this.onEnd(result);
  };

  /* ---------- feedback ---------- */

  Engine.prototype.hitIsCorrect = function (index) {
    return index < this.text.length &&
      this.input.charAt(index) === this.text.charAt(index);
  };

  Engine.prototype.registerHit = function (index) {
    var ok = this.hitIsCorrect(index);

    if (ok) {
      this.streak++;
      if (this.streak > this.streakMax) this.streakMax = this.streak;
    } else {
      this.streak = 0;
      this.errors++;
      var target = index < this.text.length ? this.text.charAt(index) : "";
      if (target) this.errMap[target] = (this.errMap[target] || 0) + 1;
      this.shake();
    }

    this.bookKeystroke(ok);

    if (ok) this.pulse(index);
  };

  /* Pastes: the ratio still has to be recorded, but no animation — the
     eye cannot follow forty pulses in a single frame. */
  Engine.prototype.registerBulk = function (lastIndex) {
    var first = Math.max(0, lastIndex - 40);
    var ok = 0;
    var bad = 0;
    var i, target;

    for (i = first; i <= lastIndex; i++) {
      if (this.hitIsCorrect(i)) {
        ok++;
      } else {
        bad++;
        target = i < this.text.length ? this.text.charAt(i) : "";
        if (target) this.errMap[target] = (this.errMap[target] || 0) + 1;
      }
    }

    this.streak = bad === 0 ? this.streak + ok : 0;
    this.errors += bad;
    this.bookKeystroke(bad === 0);
  };

  Engine.prototype.bookKeystroke = function (ok) {
    var now = performance.now();
    this.recent.push({ t: now, ok: ok });

    var cut = now - RATE_WINDOW;
    var list = this.recent;
    while (list.length && list[0].t < cut) list.shift();
  };

  /* Rate over the sliding window, per minute. The window is floored at
     one second so the first two keystrokes do not report 600 characters
     a minute. */
  Engine.prototype.recentCpm = function () {
    var list = this.recent;
    if (!list.length) return 0;

    var now = performance.now();
    var cut = now - RATE_WINDOW;
    while (list.length && list[0].t < cut) list.shift();
    if (!list.length) return 0;

    var ok = 0;
    for (var i = 0; i < list.length; i++) if (list[i].ok) ok++;

    var span = (now - list[0].t) / 1000;
    if (span < RATE_FLOOR / 1000) span = RATE_FLOOR / 1000;

    return ok / (span / 60);
  };

  /* A correct character lights up: it arrives dim and comes up to full
     colour, which reads as the letter being switched on. Animated with
     WAAPI rather than a class because paint() owns className outright —
     a class added here would be wiped by the next keystroke's diff. */
  Engine.prototype.pulse = function (index) {
    if (reduced) return;
    var node = index < this.text.length
      ? this.spans[index]
      : this.extra[index - this.text.length];
    if (!node || !node.animate) return;

    node.animate(
      [{ opacity: 0.35 }, { opacity: 1 }],
      { duration: PULSE_MS, easing: "cubic-bezier(0.22,0.61,0.36,1)" }
    );
  };

  /* A wrong key nudges the caret rather than the letter. The caret is
     already absolutely positioned, so a transform costs nothing, and the
     motion lands where the typist is looking instead of shifting the
     text they are reading. Skipped when the line just changed — that
     move already owns the transition. */
  Engine.prototype.shake = function () {
    if (reduced || this.caretShifted) return;
    var el = this.els.caret;
    if (!el || !el.animate) return;

    var x = this.caretX;
    var y = this.caretY;
    var at = function (dx) {
      return "translate3d(" + (x + dx) + "px," + y + "px,0)";
    };

    el.animate([
      { transform: at(0) },
      { transform: at(-2), offset: 0.28 },
      { transform: at(2), offset: 0.62 },
      { transform: at(0) }
    ], { duration: SHAKE_MS, easing: "ease-out" });
  };

  /* ---------- clock ---------- */

  Engine.prototype.elapsed = function () {
    if (!this.started) return 0;
    var end = this.finished && this.endTime ? this.endTime : performance.now();
    return (end - this.startTime) / 1000;
  };

  Engine.prototype.scheduleTick = function () {
    var self = this;
    var tick = function () {
      if (self.finished) return;
      var seconds = self.elapsed();

      if (seconds - self.lastSample >= SAMPLE_MS / 1000) {
        self.lastSample = Math.floor(seconds);
        self.samples.push(self.sampleAt(seconds, Math.floor(seconds)));
        self.onChange(self.snapshot());
      }

      if (self.limit !== null && seconds >= self.limit) {
        self.endTime = performance.now();
        self.finish("time");
        return;
      }

      self.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };

  /* A sample is frozen at the moment it was taken, so the chart
     shows the shape of the run rather than its final average. */
  Engine.prototype.sampleAt = function (seconds, frozenAt) {
    var counts = this.counts();
    return {
      t: seconds,
      at: frozenAt,
      correct: counts.correct,
      cpm: window.Stats.cpm(counts.correct, seconds),
      raw: window.Stats.raw(counts.correct, counts.incorrect, counts.extra, seconds),
      errors: counts.incorrect + counts.extra
    };
  };

  /* ---------- state ---------- */

  Engine.prototype.counts = function () {
    var input = this.input;
    var text = this.text;
    var n = Math.min(input.length, text.length);
    var correct = 0;
    var incorrect = 0;

    for (var i = 0; i < n; i++) {
      if (input.charAt(i) === text.charAt(i)) correct++;
      else incorrect++;
    }

    return {
      correct: correct,
      incorrect: incorrect,
      extra: Math.max(0, input.length - text.length),
      missed: Math.max(0, text.length - input.length)
    };
  };

  Engine.prototype.snapshot = function () {
    var c = this.counts();
    var seconds = this.elapsed();
    return {
      correct: c.correct,
      incorrect: c.incorrect,
      extra: c.extra,
      missed: c.missed,
      errors: c.incorrect + c.extra,
      seconds: seconds,
      progress: this.text.length ? Math.min(1, this.input.length / this.text.length) : 0,
      cpm: window.Stats.cpm(c.correct, seconds),
      live: this.recentCpm(),
      streak: this.streak,
      streakMax: this.streakMax,
      errMap: this.errMap,
      raw: window.Stats.raw(c.correct, c.incorrect, c.extra, seconds)
    };
  };

  /* ---------- painting ---------- */

  Engine.prototype.paint = function () {
    var input = this.input;
    var text = this.text;
    var spans = this.spans;
    var painted = this.painted;
    var n = Math.min(input.length, text.length);
    var i, span, want, glyph;

    for (i = 0; i < n; i++) {
      want = input.charAt(i) === text.charAt(i) ? "ok" : "bad";
      span = spans[i];

      if (painted[i] !== want) {
        span.className = want === "ok" ? "ch ok" : "ch bad";
        painted[i] = want;
      }

      /* An error used to leave the *target* glyph tinted red, which said
         something was wrong but never what had actually been pressed.
         Showing the keystroke instead is the difference between "there is
         an error here" and "you typed s for d". */
      glyph = want === "ok" ? text.charAt(i) : input.charAt(i);
      if (span.textContent !== glyph) span.textContent = glyph;
    }

    /* Undo only what a backspace actually uncovered. Walking the whole
       remaining text on every keystroke is O(n) reads for a run that can
       be 20 000 characters into zen by the end. */
    var restoreTo = Math.min(this.dirtyTo, text.length);
    for (i = n; i < restoreTo; i++) {
      span = spans[i];
      if (painted[i] !== undefined && painted[i] !== "") {
        span.className = "ch";
        painted[i] = "";
      }
      if (span.textContent !== text.charAt(i)) span.textContent = text.charAt(i);
    }
    this.dirtyTo = n;

    var over = Math.max(0, input.length - text.length);
    for (i = 0; i < this.extra.length; i++) {
      var node = this.extra[i];
      if (i < over) {
        var extraGlyph = input.charAt(text.length + i);
        if (node.textContent !== extraGlyph) node.textContent = extraGlyph;
        if (node.className !== "ch bad") node.className = "ch bad";
      } else if (node.textContent !== "") {
        node.textContent = "";
        node.className = "ch";
      }
    }
  };

  /* ---------- geometry ---------- */

  /* Reads layout for the whole text once. Every read happens before
     anything else is written, so the browser lays out once instead of
     once per character. offsetLeft/offsetTop are relative to the
     positioned ancestor, which is also the caret's containing block —
     both live in the same coordinate system. */
  Engine.prototype.measure = function () {
    this.measureFrom(0);
  };

  Engine.prototype.measureFrom = function (from) {
    var i, node, box;

    for (i = from; i < this.spans.length; i++) {
      node = this.spans[i];
      box = this.geo[i] || (this.geo[i] = { x: 0, y: 0, w: 0 });
      box.x = node.offsetLeft;
      box.y = node.offsetTop;
      box.w = node.offsetWidth;
    }

    for (i = 0; i < this.extra.length; i++) {
      node = this.extra[i];
      box = this.extraGeo[i] || (this.extraGeo[i] = { x: 0, y: 0, w: 0 });
      box.x = node.offsetLeft;
      box.y = node.offsetTop;
      box.w = node.offsetWidth;
    }

    var lh = parseFloat(window.getComputedStyle(this.els.text).lineHeight);
    this.lineHeight = (!lh || isNaN(lh)) ? 0 : lh;
  };

  /* Called after the webfont lands and on resize: both move every
     character without changing the text. */
  Engine.prototype.remeasure = function () {
    this.measure();
    this.caretPlaced = false;
    this.moveCaret();
  };

  /* ---------- caret & scroll ---------- */

  /* The caret marks the slot the next keystroke will land in, so it
     sits at the left edge of the pending character rather than after
     it. Past the end of the target it follows the overshoot spans; an
     empty span has no box of its own, so the anchor is the right edge
     of the last overshoot character that does. */
  Engine.prototype.moveCaret = function () {
    var index = this.input.length;
    var x = 0;
    var y = 0;
    var found = false;

    if (index < this.text.length) {
      var g = this.geo[index];
      if (!g) { this.measure(); g = this.geo[index]; }
      if (g) { x = g.x; y = g.y; found = true; }
    } else {
      var over = index - this.text.length;
      for (var k = Math.min(over, this.extra.length) - 1; k >= 0; k--) {
        var eg = this.extraGeo[k];
        if (eg && eg.w > 0) { x = eg.x + eg.w; y = eg.y; found = true; break; }
      }
      if (!found && this.text.length) {
        var last = this.geo[this.text.length - 1];
        if (last) { x = last.x + last.w; y = last.y; found = true; }
      }
    }
    if (!found) return;

    var el = this.els.caret;
    var lineChanged = this.caretPlaced && Math.abs(y - this.caretY) > 1;

    /* Within a line: no transition, the caret is where the character
       is. Across a line: a short tween, otherwise the jump is a blink
       the eye has to re-find. */
    el.style.transition = (lineChanged && !reduced)
      ? "transform " + LINE_MS + "ms cubic-bezier(0.22,0.61,0.36,1)"
      : "none";
    el.style.transform = "translate3d(" + x + "px," + y + "px,0)";

    this.caretX = x;
    this.caretY = y;
    this.caretPlaced = true;
    this.caretShifted = lineChanged;

    var lineHeight = this.lineHeight;
    if (!lineHeight) return;

    var line = Math.floor(y / lineHeight + 0.5);
    var target = Math.max(0, line - KEEP_LINE);
    var offset = -target * lineHeight;

    if (Math.abs((this.scrollOffset || 0) - offset) > 0.5) {
      this.scrollOffset = offset;
      this.els.inner.style.transform = "translateY(" + offset + "px)";
    }
  };

  /* ---------- zen extension ---------- */

  Engine.prototype.appendText = function (more) {
    if (!more || this.text.length + more.length > MAX_TEXT) return false;

    var from = this.spans.length;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < more.length; i++) {
      var sp = document.createElement("span");
      sp.className = "ch";
      sp.textContent = more.charAt(i);
      frag.appendChild(sp);
      this.spans.push(sp);
    }

    /* keep the overshoot pool last so ordering stays predictable */
    this.els.text.insertBefore(frag, this.extra[0]);
    this.text += more;

    /* the new spans, plus the pool, which just moved down a line */
    this.measureFrom(from);
    return true;
  };

  Engine.prototype.remaining = function () {
    return this.text.length - this.input.length;
  };

  return Engine;

})();
