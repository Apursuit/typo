/* ============================================================
   typo — statistics

   Speed is reported in characters per minute (CPM), not words per
   minute. A "word" is a fiction of five characters invented by the
   typing-test industry; this app measures keystrokes, and CPM is the
   unit that does not pretend otherwise.

   Definitions, stated once so the numbers stay comparable:

     correct     a keystroke that matched the target character
     incorrect   a keystroke that did not match
     extra       characters typed past the end of the target
     missed      target characters never reached

     cpm         correct characters / minute
     raw cpm     every character typed, right or wrong, / minute
     accuracy    correct / everything typed — characters never
                 reached are excluded, see accuracy()
     consistency 100 * (1 - sd/mean) over per-second rate samples
   ============================================================ */

window.Stats = (function () {

  function raw(correct, incorrect, extra, seconds) {
    if (seconds <= 0) return 0;
    return (correct + incorrect + extra) / (seconds / 60);
  }

  function cpm(correct, seconds) {
    if (seconds <= 0) return 0;
    return correct / (seconds / 60);
  }

  /* Measured over what was actually typed. Characters the run never
     reached are deliberately excluded: a timed run generates far more
     text than anyone can finish, so counting the untouched remainder
     would report a 98%-accurate 15-second run as 33%. */
  function accuracy(correct, incorrect, extra) {
    var typed = correct + incorrect + extra;
    if (typed <= 0) return 100;
    return (correct / typed) * 100;
  }

  function mean(values) {
    if (!values.length) return 0;
    var sum = 0;
    for (var i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
  }

  function stddev(values) {
    if (values.length < 2) return 0;
    var m = mean(values);
    var sum = 0;
    for (var i = 0; i < values.length; i++) {
      var d = values[i] - m;
      sum += d * d;
    }
    return Math.sqrt(sum / values.length);
  }

  /* Coefficient of variation inverted into a 0-100 score. The unit
     cancels, so this score is unaffected by the choice of cpm or wpm.
     Fewer than three samples is too small a window to say anything. */
  function consistency(values) {
    var usable = values.filter(function (v) { return v > 0; });
    if (usable.length < 3) return 0;
    var m = mean(usable);
    if (m <= 0) return 0;
    var score = 100 * (1 - stddev(usable) / m);
    return Math.max(0, Math.min(100, score));
  }

  return {
    raw: raw,
    cpm: cpm,
    accuracy: accuracy,
    consistency: consistency,
    mean: mean
  };

})();
