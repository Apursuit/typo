/* ============================================================
   typo — beginner course

   A graded introduction to the keyboard. The order follows how
   the hands actually learn: one finger at a time on the home row,
   then a whole row at once, then two rows together, and only at
   the end the full board with nothing to hold on to.

   Drill text is always generated from key sets — never words or
   sentences. A beginner should be fighting the keyboard, not
   spelling or grammar.
   ============================================================ */

/* Which finger owns each column. Identical for all three rows
   because every row is "pinky, ring, middle, index, index" per hand. */
window.KEY_FINGERS = ["lp", "lr", "lm", "li", "li", "ri", "ri", "rm", "rr", "rp"];

/* Physical layout. The stagger is expressed in CSS via data-row,
   not here, so the rows stay a pure description of the board. */
window.KEY_ROWS = [
  { name: "top", keys: "qwertyuiop", home: false },
  { name: "home", keys: "asdfghjkl;", home: true },
  { name: "bottom", keys: "zxcvbnm,./", home: false }
];

window.DRILL_STAGES = [
  { n: 1, title: "基准行", blurb: "八个手指的落点，先按手指分别练" },
  { n: 2, title: "上行", blurb: "向上够，再回到基准位" },
  { n: 3, title: "下行", blurb: "向下够，再回到基准位" },
  { n: 4, title: "纵向", blurb: "同一根手指在行与行之间移动" },
  { n: 5, title: "相邻行组合", blurb: "两行混着来" },
  { n: 6, title: "全键盘", blurb: "所有字母随机" },
  { n: 7, title: "大小写", blurb: "Shift 用对侧小指按" }
];

/* Order matters more than count here. Every row runs the same arc —
   one finger pair at a time, then the pairs together, then the whole
   row — because jumping straight from two keys to a full row leaves
   the middle of the curve unpractised.

   The vertical stage follows the same rule: a finger is introduced to
   the row above it on four keys before it is given the whole column. */
window.DRILLS = [
  { id: "f-j", stage: 1, name: "f j", keys: "fj", note: "左右食指" },
  { id: "d-k", stage: 1, name: "d k", keys: "dk", note: "左右中指" },
  { id: "s-l", stage: 1, name: "s l", keys: "sl", note: "左右无名指" },
  { id: "a-semi", stage: 1, name: "a ;", keys: "a;", note: "左右小指" },
  { id: "home-eight", stage: 1, name: "八指", keys: "fjdksla;", note: "四个手指对一起上" },
  { id: "home", stage: 1, name: "整行", keys: "asdfghjkl;", note: "含 g h，食指内伸" },

  { id: "r-u", stage: 2, name: "r u", keys: "ru", note: "左右食指" },
  { id: "e-i", stage: 2, name: "e i", keys: "ei", note: "左右中指" },
  { id: "w-o", stage: 2, name: "w o", keys: "wo", note: "左右无名指" },
  { id: "q-p", stage: 2, name: "q p", keys: "qp", note: "左右小指" },
  { id: "top-eight", stage: 2, name: "八指", keys: "rueiwoqp", note: "四个手指对一起上" },
  { id: "top", stage: 2, name: "整行", keys: "qwertyuiop", note: "含 t y，食指内伸" },

  { id: "v-n", stage: 3, name: "v n", keys: "vn", note: "左右食指" },
  { id: "c-comma", stage: 3, name: "c ,", keys: "c,", note: "左右中指" },
  { id: "x-dot", stage: 3, name: "x .", keys: "x.", note: "左右无名指" },
  { id: "z-slash", stage: 3, name: "z /", keys: "z/", note: "左右小指" },
  { id: "bottom-eight", stage: 3, name: "八指", keys: "vnc,x.z/", note: "四个手指对一起上" },
  { id: "bottom", stage: 3, name: "整行", keys: "zxcvbnm,./", note: "含 b m，食指内伸" },

  { id: "index-up", stage: 4, name: "f r j u", keys: "frju", note: "食指 · 向上够" },
  { id: "index-col", stage: 4, name: "食指·纵向", keys: "rtfgvbyuhjnm", note: "三行贯通" },
  { id: "middle-up", stage: 4, name: "d e k i", keys: "deki", note: "中指 · 向上够" },
  { id: "middle-col", stage: 4, name: "中指·纵向", keys: "edcik,", note: "三行贯通" },
  { id: "ring-up", stage: 4, name: "s w l o", keys: "swlo", note: "无名指 · 向上够" },
  { id: "ring-col", stage: 4, name: "无名指·纵向", keys: "wsxol.", note: "三行贯通" },
  { id: "pinky-up", stage: 4, name: "a q ; p", keys: "aq;p", note: "小指 · 向上够" },
  { id: "pinky-col", stage: 4, name: "小指·纵向", keys: "qazp;/", note: "三行贯通" },

  { id: "home-top", stage: 5, name: "基准+上行", keys: "asdfghjkl;qwertyuiop", note: "两行混着来" },
  { id: "home-bottom", stage: 5, name: "基准+下行", keys: "asdfghjkl;zxcvbnm,./", note: "两行混着来" },

  { id: "letters", stage: 6, name: "全部字母", keys: "asdfghjkl;qwertyuiopzxcvbnm,./", note: "整个键盘随机" },

  { id: "caps-first", stage: 7, name: "首字母大写", keys: "asdfghjkl;qwertyuiopzxcvbnm,./", caps: "first", note: "Shift 用对侧小指" },
  { id: "caps-mixed", stage: 7, name: "随机大小写", keys: "asdfghjkl;qwertyuiopzxcvbnm,./", caps: "mixed", note: "约三成字母大写" }
];

window.Drill = (function () {

  function byId(id) {
    for (var i = 0; i < window.DRILLS.length; i++) {
      if (window.DRILLS[i].id === id) return window.DRILLS[i];
    }
    return null;
  }

  function indexOf(id) {
    for (var i = 0; i < window.DRILLS.length; i++) {
      if (window.DRILLS[i].id === id) return i;
    }
    return -1;
  }

  function nextOf(id) {
    var i = indexOf(id);
    if (i < 0 || i + 1 >= window.DRILLS.length) return null;
    return window.DRILLS[i + 1];
  }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  /* A group of keys with no character landing twice in a row —
     a repeated letter is muscle memory, not a decision. */
  function group(keys, length) {
    var out = "";
    var prev = "";
    for (var i = 0; i < length; i++) {
      var ch = prev;
      var guard = 0;
      while (ch === prev && guard < 12) {
        ch = keys.charAt(Math.floor(Math.random() * keys.length));
        guard++;
      }
      out += ch;
      prev = ch;
    }
    return out;
  }

  function plan(drill) {
    switch (drill.stage) {
      /* vertical runs are the hardest per keystroke, so they are kept
         a little shorter than the horizontal ones */
      case 4: return { groups: 20, min: 3, max: 4 };
      case 5: return { groups: 24, min: 3, max: 5 };
      case 6: return { groups: 26, min: 3, max: 6 };
      case 7: return { groups: 22, min: 3, max: 5 };
      default: return { groups: 22, min: 3, max: 4 };
    }
  }

  /* Capitals are a shift problem, not a key-position problem, so they
     are left until the last stage — paying for them earlier would
     slow every drill before it without teaching anything new. */
  function applyCaps(text, mode) {
    if (mode === "first") {
      return text.replace(/(^|\s)([a-z])/g, function (all, lead, ch) {
        return lead + ch.toUpperCase();
      });
    }
    if (mode === "mixed") {
      return text.replace(/[a-z]/g, function (ch) {
        return Math.random() < 0.35 ? ch.toUpperCase() : ch;
      });
    }
    return text;
  }

  /* Two-key drills cycle every combination instead of sampling at
     random: with only four possible pairs, random sampling would
     leave one of them under-practised for a long time. */
  function text(drill) {
    var keys = drill.keys;
    var parts = [];
    var i;

    if (keys.length === 2) {
      var a = keys.charAt(0);
      var b = keys.charAt(1);
      var pool = [a + a, a + b, b + a, b + b];
      for (i = 0; i < 28; i++) {
        if (i % 4 === 0) shuffle(pool);
        parts.push(pool[i % 4]);
      }
      return parts.join(" ");
    }

    var cfg = plan(drill);
    for (i = 0; i < cfg.groups; i++) {
      var len = cfg.min + Math.floor(Math.random() * (cfg.max - cfg.min + 1));
      parts.push(group(keys, len));
    }
    return applyCaps(parts.join(" "), drill.caps);
  }

  return {
    byId: byId,
    indexOf: indexOf,
    nextOf: nextOf,
    text: text
  };

})();
