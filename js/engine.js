/* ============================================================
   typo — typing engine

   The engine owns three things and nothing else:
     1. the character state derived from (target, typed)
     2. the caret position and the scroll offset that keeps   it
        visible
     3. the clock and the per-second samples the chart needs

   Character state is derived, never stored per keystroke:
   position i is correct when typed[i] === target[i], wrong when
   it differs, and anything past the target is "extra". Backspace
   needs no special handling because the derivation is total.

   Painting is diffed against a shadow array so a keystroke only
   touches the spans whose state actually changed.
   ============================================================ */

window.Engine = (function () {

  var KEEP_LINE = 1;         /* caret rests on the second visible line */
  var SAMPLE_MS = 1000;      /* chart resolution */
  var EXTRA_POOL = 48;       /* spans reserved for overshoot */
  /* Guard rail for the endless modes. Reaching it takes roughly an
     hour of continuous typing at a normal pace, and the caller warns
     once when it happens rather than letting text stop silently. */
  var MAX_TEXT = 24000;

  function Engine(cfg) {
    this.els = cfg.els;
    this.onChange = cfg.onChange || function () {};
    this.onEnd = cfg.onEnd || function () {};
    this.limit = cfg.limit || null;

    this.spans = [];
    this.painted = [];
    this.extra = [];
    this.shadow = [];

    this.reset(cfg.text, cfg.limit);
  }

  /* ---------- lifecycle ---------- */

  Engine.prototype.reset = function (text, limit) {
    this.text = text;
    this.limit = limit === undefined ? this.limit : limit;
    this.input = "";
    this.painted = [];
    this.started = false;
    this.finished = false;
    this.startTime = 0;
    this.endTime = 0;
    this.lastSample = 0;
    this.samples = [];
    this.scrollOffset = 0;
    this.raf = 0;

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
    this.moveCaret();
  };

  Engine.prototype.destroy = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  /* ---------- input ---------- */

  Engine.prototype.push = function (value) {
    if (this.finished) return;

    this.input = value;

    if (!this.started && value.length > 0) {
      this.started = true;
      this.startTime = performance.now();
      this.lastSample = 0;
      this.scheduleTick();
    }

    this.paint();
    this.moveCaret();

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
    var i;

    for (i = 0; i < n; i++) {
      var want = input.charAt(i) === text.charAt(i) ? "ok" : "bad";
      if (painted[i] !== want) {
        spans[i].className = want === "ok" ? "ch ok" : "ch bad";
        painted[i] = want;
      }
    }

    for (i = n; i < text.length; i++) {
      if (painted[i] !== undefined && painted[i] !== "") {
        spans[i].className = "ch";
        painted[i] = "";
      }
    }

    var over = Math.max(0, input.length - text.length);
    for (i = 0; i < this.extra.length; i++) {
      var node = this.extra[i];
      if (i < over) {
        var glyph = input.charAt(text.length + i);
        if (node.textContent !== glyph) node.textContent = glyph;
        if (node.className !== "ch bad") node.className = "ch bad";
      } else if (node.textContent !== "") {
        node.textContent = "";
        node.className = "ch";
      }
    }
  };

  /* ---------- caret & scroll ---------- */

  /* The caret marks the slot the next keystroke will land in, so it
     sits at the left edge of the pending character rather than after
     it. Past the end of the target it tracks the overshoot spans,
     whose left edge is the right edge of everything typed so far. */
  Engine.prototype.moveCaret = function () {
    var index = this.input.length;
    var slot = null;
    var past = false;

    if (index < this.text.length) {
      slot = this.spans[index];
    } else {
      var over = index - this.text.length;
      if (over < this.extra.length) {
        slot = this.extra[over];
      } else if (this.extra.length) {
        slot = this.extra[this.extra.length - 1];
        past = true;
      }
    }
    if (!slot) return;

    var innerBox = this.els.inner.getBoundingClientRect();
    var box = slot.getBoundingClientRect();

    var x = (past && box.width)
      ? box.right - innerBox.left
      : box.left - innerBox.left;
    var y = box.top - innerBox.top;

    this.els.caret.style.transform = "translate3d(" + x + "px," + y + "px,0)";

    /* measure the line box on the element that actually sets it */
    var lineHeight = parseFloat(window.getComputedStyle(this.els.text).lineHeight);
    if (!lineHeight || isNaN(lineHeight)) return;

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
    return true;
  };

  Engine.prototype.remaining = function () {
    return this.text.length - this.input.length;
  };

  return Engine;

})();
