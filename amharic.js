// ============================================================
//  AMHARIC VOICE ENGINE — Browser only
// ============================================================

var AMHARIC_ONES = [
  "", "አንድ", "ሁለት", "ሶስት", "አራት", "አምስት",
  "ስድስት", "ሰባት", "ስምንት", "ዘጠኝ", "አስር",
  "አስራ አንድ", "አስራ ሁለት", "አስራ ሶስት", "አስራ አራት", "አስራ አምስት",
  "አስራ ስድስት", "አስራ ሰባት", "አስራ ስምንት", "አስራ ዘጠኝ", "ሃያ",
  "ሃያ አንድ", "ሃያ ሁለት", "ሃያ ሶስት", "ሃያ አራት", "ሃያ አምስት",
  "ሃያ ስድስት", "ሃያ ሰባት", "ሃያ ስምንት", "ሃያ ዘጠኝ", "ሰላሳ",
  "ሰላሳ አንድ", "ሰላሳ ሁለት", "ሰላሳ ሶስት", "ሰላሳ አራት", "ሰላሳ አምስት",
  "ሰላሳ ስድስት", "ሰላሳ ሰባት", "ሰላሳ ስምንት", "ሰላሳ ዘጠኝ", "አርባ",
  "አርባ አንድ", "አርባ ሁለት", "አርባ ሶስት", "አርባ አራት", "አርባ አምስት",
  "አርባ ስድስት", "አርባ ሰባት", "አርባ ስምንት", "አርባ ዘጠኝ", "ሃምሳ",
  "ሃምሳ አንድ", "ሃምሳ ሁለት", "ሃምሳ ሶስት", "ሃምሳ አራት", "ሃምሳ አምስት",
  "ሃምሳ ስድስት", "ሃምሳ ሰባት", "ሃምሳ ስምንት", "ሃምሳ ዘጠኝ", "ስልሳ",
  "ስልሳ አንድ", "ስልሳ ሁለት", "ስልሳ ሶስት", "ስልሳ አራት", "ስልሳ አምስት",
  "ስልሳ ስድስት", "ስልሳ ሰባት", "ስልሳ ስምንት", "ስልሳ ዘጠኝ", "ሰባ",
  "ሰባ አንድ", "ሰባ ሁለት", "ሰባ ሶስት", "ሰባ አራት", "ሰባ አምስት"
];

var BINGO_COLS_AM    = ["ቢ", "ኢ", "ን", "ጎ", "!"];
var BINGO_COLS_FULL  = ["ቢ", "ኢ", "ን", "ጎ", "ኦ"];
var BINGO_COLS_VOICE = ["ቢ", "ኢ", "ን", "ጎ", "ኦ"];
var COL_RANGES       = [[1,15],[16,30],[31,45],[46,60],[61,75]];

function getAmharicName(n) {
  return (n >= 1 && n <= 75) ? AMHARIC_ONES[n] : String(n);
}
function getColumnLabel(n) {
  for (var i = 0; i < COL_RANGES.length; i++)
    if (n >= COL_RANGES[i][0] && n <= COL_RANGES[i][1]) return BINGO_COLS_AM[i];
  return "";
}
function getColumnFull(n) {
  for (var i = 0; i < COL_RANGES.length; i++)
    if (n >= COL_RANGES[i][0] && n <= COL_RANGES[i][1]) return BINGO_COLS_FULL[i];
  return "";
}

// ── Voice Engine ─────────────────────────────────────────────
var VoiceEngine = (function() {
  var voices      = [];
  var chosenVoice = null;
  var vol         = 1.0;
  var spRate      = 0.80;
  var spPitch     = 1.0;
  var muted       = false;
  var queue       = [];
  var busy        = false;

  function loadVoices() {
    if (!window.speechSynthesis) return;
    voices = window.speechSynthesis.getVoices();
    autoPick();
    buildSelector();
    updateStatus();
  }

  function autoPick() {
    chosenVoice = null;
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].lang === "am-ET") { chosenVoice = voices[i]; return; }
    }
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].lang.indexOf("am") === 0) { chosenVoice = voices[i]; return; }
    }
  }

  function buildSelector() {
    var sel = document.getElementById("voiceSelect");
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = "<option value=\"\">— Auto —</option>";
    for (var i = 0; i < voices.length; i++) {
      var o = document.createElement("option");
      o.value = i;
      o.textContent = voices[i].name + " (" + voices[i].lang + ")";
      sel.appendChild(o);
    }
    if (prev) sel.value = prev;
  }

  function updateStatus() {
    var el = document.getElementById("voiceStatus");
    if (!el) return;
    if (!window.speechSynthesis) { el.textContent = "❌ ድምፅ አይደገፍም"; el.className = "vs-error"; return; }
    if (muted) { el.textContent = "🔇 ድምፅ ጠፍቷል"; el.className = "vs-muted"; return; }
    el.textContent = chosenVoice ? "🔊 " + chosenVoice.name : "🔊 ነባሪ ድምፅ";
    el.className = chosenVoice ? "vs-ok" : "vs-warn";
  }

  function next() {
    if (queue.length === 0) { busy = false; return; }
    busy = true;
    var text = queue.shift();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "am-ET"; u.rate = spRate; u.pitch = spPitch; u.volume = vol;
    if (chosenVoice) u.voice = chosenVoice;
    u.onend = next;
    u.onerror = function() { busy = false; next(); };
    window.speechSynthesis.speak(u);
  }

  function speak(text, priority) {
    if (!window.speechSynthesis || muted || !text) return;
    if (priority) {
      window.speechSynthesis.cancel();
      queue = []; busy = false;
      setTimeout(function() { queue.push(text); if (!busy) next(); }, 80);
      return;
    }
    queue.push(text);
    if (!busy) next();
  }

  return {
    init: function() {
      if (!window.speechSynthesis) { updateStatus(); return; }
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    },
    speak: speak,
    pickByIndex: function(idx) {
      chosenVoice = (idx === "" || idx === null) ? null : voices[parseInt(idx)] || null;
      if (idx === "") autoPick();
      updateStatus();
    },
    setVol:   function(v) { vol     = parseFloat(v); },
    setRate:  function(r) { spRate  = parseFloat(r); },
    setPitch: function(p) { spPitch = parseFloat(p); },
    toggleMute: function() {
      muted = !muted;
      if (muted && window.speechSynthesis) { window.speechSynthesis.cancel(); queue = []; busy = false; }
      updateStatus();
      var b1 = document.getElementById("muteBtn");
      var b2 = document.getElementById("muteBtnGame");
      if (b1) b1.innerHTML = muted ? "🔇 ክፈት" : "🔊 ዝጋ";
      if (b2) b2.textContent = muted ? "🔇" : "🔊";
      return muted;
    },
    isMuted: function() { return muted; },
    stop: function() {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      queue = []; busy = false;
    }
  };
})();

function speakAmharic(text, priority) {
  VoiceEngine.speak(text, priority !== false);
}

// ── Sound Effects ─────────────────────────────────────────────
var SFX = (function() {
  var ctx = null;
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { return null; } }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function beep(freq, dur, type, gain) {
    var c = ac(); if (!c) return;
    try {
      var o = c.createOscillator();
      var g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type = type || "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.25, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      o.start(); o.stop(c.currentTime + dur);
    } catch(e) {}
  }
  return {
    start:  function() { [392,523,659,784].forEach(function(f,i){ setTimeout(function(){ beep(f,.18,"sine",.28); }, i*90); }); },
    number: function() { beep(880,.1,"sine",.22); setTimeout(function(){ beep(1100,.09,"sine",.18); }, 120); },
    tick:   function() { beep(440,.05,"square",.07); },
    urgent: function() { beep(660,.07,"square",.14); },
    bingo:  function() { [523,659,784,1047,1319].forEach(function(f,i){ setTimeout(function(){ beep(f,.22,"triangle",.32); }, i*110); }); },
    error:  function() { beep(200,.3,"sawtooth",.2); },
    pause:  function() { beep(330,.15,"sine",.18); },
    resume: function() { beep(550,.15,"sine",.18); }
  };
})();

document.addEventListener("DOMContentLoaded", function() {
  VoiceEngine.init();
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = function() {
      window.speechSynthesis.getVoices();
      VoiceEngine.init();
    };
  }
});
