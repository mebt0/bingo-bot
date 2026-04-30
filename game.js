// ============================================================
//  AMHARIC BINGO GAME ENGINE
// ============================================================

var playerCount=1,poolCards=[],playerCards=[],currentPlayer=0;
var cards=[],calledNumbers=[],remainingNums=[],gameActive=false;
var autoMode=false,isPaused=false,autoLoopTimer=null;
var AUTO_INTERVAL=1000,probMode="balanced",numberWeights={};
// Fixed speed: ፈጣን (1 second)
var callSpeed=1;
// Prize pool for current game
var currentPrizePool=0;

function range(a,b){var r=[];for(var i=a;i<=b;i++)r.push(i);return r;}
function shuffle(arr){var a=arr.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;}return a;}

function showScreen(id){
  // Hide ALL screens including login
  document.querySelectorAll(".screen, .login-screen").forEach(function(s){
    s.classList.remove("active");
  });
  // Show target
  var target = document.getElementById(id);
  if(target) target.classList.add("active");
}
function hideDialog(){document.getElementById("confirmDialog").classList.add("hidden");}

// ── Admin check ───────────────────────────────────────────────
function currentUserIsAdmin() {
  if (!currentUser) return false;
  return currentUser.isAdmin === true || isAdminPhone(currentUser.phone);
}

function confirmEndGame(){
  if (!currentUserIsAdmin()) {
    flashMessage("❌ ጨዋታ ማቆም የሚችሉት አስተዳዳሪ ብቻ ነው", "#ef4444");
    return;
  }
  document.getElementById("confirmDialog").classList.remove("hidden");
}

function endGame(){
  if (!currentUserIsAdmin()) {
    flashMessage("❌ ጨዋታ ማቆም የሚችሉት አስተዳዳሪ ብቻ ነው", "#ef4444");
    hideDialog();
    return;
  }
  clearInterval(countdownTimer);
  clearTimeout(autoLoopTimer);
  countdownActive = false;
  gameActive      = false;
  autoMode        = false;
  hideDialog();
  window.speechSynthesis && window.speechSynthesis.cancel();
  VoiceEngine.stop();
  speakAmharic("ጨዋታ አቆሟል", true);
  flashMessage("⏹ ጨዋታ ቆሟል", "#ef4444");
  showScreen("mainMenu");
}

// ── Hide/show game controls based on admin status ─────────────
function applyGameControlVisibility() {
  var isAdmin = currentUserIsAdmin();
  var adminCtrl   = document.getElementById("gsAdminControls");
  var watchingDiv = document.getElementById("gsWatching");
  if(adminCtrl)   adminCtrl.style.display   = isAdmin ? "" : "none";
  if(watchingDiv) watchingDiv.style.display = isAdmin ? "none" : "";
  // Number board — disable clicks for non-admins
  var board = document.getElementById("numberBoard");
  if(board){
    board.querySelectorAll(".gs-nb-btn").forEach(function(btn){
      if(!isAdmin) btn.disabled = true;
    });
  }
}

function onAutoToggleChange(checked) {
  if(!gameActive) return;
  if(!currentUserIsAdmin()){ flashMessage("❌ አስተዳዳሪ ብቻ","#ef4444"); return; }
  autoMode = checked;
  updateAutoBadge();
  if(autoMode) callNextNumber();
  else clearTimeout(autoLoopTimer);
}
function flashMessage(msg,color){var el=document.createElement("div");el.className="flash-msg";el.style.background=color||"#6366f1";el.textContent=msg;document.body.appendChild(el);setTimeout(function(){el.remove();},2800);}

function changePlayerCount(delta){
  playerCount=Math.max(1,Math.min(400,playerCount+delta));
  document.getElementById("playerCountDisplay").textContent=playerCount;
}

function generateCard(id){
  var grid=[];
  for(var col=0;col<5;col++){var mn=COL_RANGES[col][0],mx=COL_RANGES[col][1];grid.push(shuffle(range(mn,mx)).slice(0,5));}
  grid[2][2]="FREE";
  var marked=[];
  for(var c=0;c<5;c++){var row=[];for(var r=0;r<5;r++)row.push(c===2&&r===2);marked.push(row);}
  return{id:id,grid:grid,marked:marked,hasBingo:false,owner:null};
}

function goToCardSelect(){
  // Full reset of game state
  clearTimeout(autoLoopTimer);
  gameActive=false; autoMode=false; isPaused=false;
  cards=[]; calledNumbers=[]; remainingNums=[];
  currentPrizePool=0;

  poolCards=[];playerCards=[];
  for(var p=0;p<playerCount;p++) playerCards.push([]);
  currentPlayer=0;
  // Generate 400 cards for the pool
  for(var i=1;i<=400;i++) poolCards.push(generateCard(i));

  // Do NOT auto-select — user picks 1 card (shown as red when selected)
  // playerCards[0] starts empty — all cards show green

  showScreen("cardSelectScreen");

  setTimeout(function() {
    buildPlayerTabs();
    renderCardPool();
    updateCsStatus();
    updatePrizePreview();

    // Hide selected bar initially
    var selBar = document.getElementById("csSelectedBar");
    if(selBar) selBar.style.display = "none";

    var startBtn = document.getElementById("startGameBtn");
    if(startBtn){
      if(currentUserIsAdmin()){
        startBtn.style.display = "";
        startBtn.disabled = true;
        startBtn.classList.remove("btn-ready");
      } else {
        startBtn.style.display = "none";
        var prog = document.getElementById("csProgress");
        if(prog) prog.innerHTML = '<span class="prog-count" style="color:#f59e0b">⏳ ካርድ ምረጡ — ጠቅ ያድርጉ</span>';
      }
    }

    // Balance display + minimum check
    var csBalEl = document.getElementById("csBalanceAmt");
    if (csBalEl) {
      csBalEl.textContent = currentUser ? parseFloat(currentUser.balance || 0).toFixed(0) : "0";
      if (currentUser) {
        apiCall("GET", "/wallet/balance", null, function(err, data) {
          if (data && data.ok) {
            currentUser.balance = data.balance;
            csBalEl.textContent = parseFloat(data.balance).toFixed(0);
            // Show warning only if balance < 10
            if (data.balance < ENTRY_FEE) {
              csBalEl.style.color = "#ef4444";
              var prog = document.getElementById("csProgress");
              if(prog) prog.innerHTML =
                '<span class="prog-count" style="color:#ef4444">❌ ቀሪ ሂሳብ ' + fmtMoney(data.balance) +
                ' — ቢያንስ ' + fmtMoney(ENTRY_FEE) + ' ያስፈልጋል</span>' +
                '<button onclick="openMyAccount()" style="margin-left:8px;padding:4px 10px;background:#22c55e;color:white;border:none;border-radius:6px;cursor:pointer;font-size:.78rem">💵 ሙላ</button>';
            } else {
              csBalEl.style.color = "#22c55e";
            }
          }
        });
      }
    }

    var pool = document.getElementById("cardPool");
    if(pool) pool.scrollTop = 0;
  }, 50);

  speakAmharic("ካርድ ምረጡ", true);
}

function buildPlayerTabs(){
  // Single-client mode — no player tabs needed
  var tabs=document.getElementById("playerTabs");
  if(tabs) tabs.innerHTML="";
}

function switchPlayerTab(p){
  currentPlayer=p;
  document.querySelectorAll(".player-tab").forEach(function(t,i){t.classList.toggle("active",i===p);});
  updateCsStatus();renderCardPool();updateSelectedPreview();
}

function updateCsStatus(){
  var chosen=playerCards[currentPlayer]||[];
  var totalSelected=0;
  for(var i=0;i<playerCount;i++) totalSelected+=(playerCards[i]||[]).length;
  var statusEl = document.getElementById("csStatus");
  if(statusEl) statusEl.textContent = totalSelected > 0 ? totalSelected + " ✓" : "—";
  var prog=document.getElementById("csProgress");if(!prog)return;
  prog.innerHTML = totalSelected > 0
    ? '<span class="prog-count">✅ '+totalSelected+' ካርድ | 💰 '+fmtMoney(totalSelected*ENTRY_FEE)+'</span>'
    : '';
}

function renderCardPool(){
  var pool = document.getElementById("cardPool");
  if(!pool) return;
  pool.innerHTML = "";

  if(!poolCards || poolCards.length === 0){
    pool.innerHTML = '<div style="color:#94a3b8;padding:20px;text-align:center">ካርዶች እየጫነ ነው...</div>';
    return;
  }

  var chosen    = playerCards[currentPlayer] || [];
  var chosenIds = chosen.map(function(c){ return c.id; });

  // Render as flat number buttons (like the image)
  for(var idx = 0; idx < poolCards.length; idx++){
    var card     = poolCards[idx];
    var isChosen = chosenIds.indexOf(card.id) !== -1;

    var btn = document.createElement("button");
    btn.className = "cs-num-btn" + (isChosen ? " cs-num-selected" : "");
    btn.setAttribute("data-card-id", card.id);
    btn.textContent = card.id;
    pool.appendChild(btn);
  }

  // Event delegation
  pool.onclick = function(e){
    var btn = e.target.closest("[data-card-id]");
    if(btn) selectCard(parseInt(btn.getAttribute("data-card-id")));
  };
}

function selectCard(cardId){
  var card = poolCards.find(function(c){ return c.id === cardId; });
  if(!card) return;

  if(!playerCards[currentPlayer]) playerCards[currentPlayer] = [];
  var chosen = playerCards[currentPlayer];

  var idx = chosen.findIndex(function(c){ return c.id === cardId; });
  if(idx !== -1){
    // Deselect — turns green again
    chosen.splice(idx, 1);
  } else {
    // Select — max 1 card, deselect previous
    chosen.length = 0;
    chosen.push(card);
    try { SFX.number(); } catch(e){}
  }

  playerCards[currentPlayer] = chosen;

  // Show/hide selected card bar below grid
  var selBar = document.getElementById("csSelectedBar");
  var selNum = document.getElementById("csSelectedNum");
  if(selBar && selNum){
    if(chosen.length > 0){
      selBar.style.display = "";
      selNum.textContent   = "#" + chosen[0].id;
    } else {
      selBar.style.display = "none";
    }
  }

  // Count total selected
  var totalCards = 0;
  for(var i = 0; i < playerCount; i++) totalCards += (playerCards[i] || []).length;

  updateCsStatus();
  renderCardPool();
  updatePrizePreview();

  // Enable start button for admin when at least 1 card selected
  var btn = document.getElementById("startGameBtn");
  if(btn && currentUserIsAdmin()){
    if(totalCards > 0){
      btn.disabled = false;
      btn.classList.add("btn-ready");
    } else {
      btn.disabled = true;
      btn.classList.remove("btn-ready");
    }
  }
}

function clearSelectedCard() {
  if(!playerCards[currentPlayer]) return;
  playerCards[currentPlayer] = [];
  var selBar = document.getElementById("csSelectedBar");
  if(selBar) selBar.style.display = "none";
  updateCsStatus();
  renderCardPool();
  updatePrizePreview();
  var btn = document.getElementById("startGameBtn");
  if(btn){ btn.disabled = true; btn.classList.remove("btn-ready"); }
}

function updateSelectedPreview(){
  var preview=document.getElementById("selectedCardPreview");
  var el=document.getElementById("previewCardEl");
  var chosen=playerCards[currentPlayer]||[];
  if(chosen.length===0){preview.classList.add("hidden");return;}
  preview.classList.remove("hidden");el.innerHTML="";
  chosen.forEach(function(c){el.appendChild(buildCardElement(c,false,true));});
}

// ── Countdown timer reference (so it can be cancelled) ───────
var countdownTimer = null;
var countdownActive = false;

function cancelCountdown() {
  if (!countdownActive) return;
  if (!currentUserIsAdmin()) {
    flashMessage("❌ ጨዋታ ማቆም የሚችሉት አስተዳዳሪ ብቻ ነው", "#ef4444");
    return;
  }
  clearInterval(countdownTimer);
  clearTimeout(autoLoopTimer);
  countdownActive = false;
  countdownTimer  = null;
  gameActive = false;
  autoMode   = false;

  // Refund entry fee
  if (currentUser) {
    var totalCards = 0;
    for (var p = 0; p < playerCount; p++) totalCards += (playerCards[p] || []).length;
    var refundAmt = ENTRY_FEE * totalCards;
    if (refundAmt > 0) {
      addPrize(currentUser.phone, refundAmt, function() {
        refreshUserBar();
      });
      flashMessage("↩️ " + fmtMoney(refundAmt) + " ተመልሷል", "#f59e0b");
    }
  }

  window.speechSynthesis && window.speechSynthesis.cancel();
  flashMessage("❌ ጨዋታ ተሰርዟል", "#ef4444");
  showScreen("cardSelectScreen");
}

function launchGame(){
  if(!currentUserIsAdmin()){
    flashMessage("❌ ጨዋታ መጀመር የሚችሉት አስተዳዳሪ ብቻ ነው", "#ef4444");
    return;
  }
  clearTimeout(autoLoopTimer);

  // Use ALL 400 pool cards for the game (regardless of what admin selected)
  playerCards[0] = poolCards.slice();
  var totalCards = 400;

  if (currentUser) {
    deductEntryFee(currentUser.phone, totalCards, function(feeResult) {
      if (!feeResult.ok) {
        // Show balance error with deposit button
        var msg = feeResult.msg || "ቀሪ ሂሳብ በቂ አይደለም";
        flashMessage("❌ " + msg, "#ef4444");
        speakDirect("ቀሪ ሂሳብ በቂ አይደለም");
        // Show deposit prompt after 1 second
        setTimeout(function() {
          if (confirm("💰 ሂሳብ ለመሙላት ወደ አካውንት ይሂዱ?")) {
            openMyAccount();
          }
        }, 500);
        return;
      }
      refreshUserBar();
      _launchGameAfterFee(totalCards);
    });
  } else {
    _launchGameAfterFee(totalCards);
  }
}

function _launchGameAfterFee(totalCards) {
  var totalFee     = ENTRY_FEE * totalCards;
  var houseCut     = Math.floor(totalFee * 0.20);
  currentPrizePool = totalFee - houseCut;

  cards = [];
  for (var p = 0; p < playerCount; p++) {
    var pc = playerCards[p] || [];
    pc.forEach(function(c){
      var marked = [];
      for (var col = 0; col < 5; col++) {
        var row = [];
        for (var r = 0; r < 5; r++) row.push(c.grid[col][r] === "FREE");
        marked.push(row);
      }
      cards.push({id:c.id, grid:c.grid, marked:marked, hasBingo:false, owner:p+1});
    });
  }

  calledNumbers = []; remainingNums = shuffle(range(1, 75));
  isPaused = false; gameActive = false; autoMode = false; // not active yet — countdown first

  // ── Setup UI ──────────────────────────────────────────────
  document.getElementById("playerCount").textContent  = playerCount;
  document.getElementById("calledCount").textContent  = "0";
  document.getElementById("cardsLabel").textContent   = cards.length;
  document.getElementById("calledNumberAmharic").textContent = "ቁጥር ይጠበቃል";
  document.getElementById("calledNumberDigit").textContent   = "—";
  document.getElementById("bnnColBadge").textContent         = "—";
  document.getElementById("calledNumbersList").innerHTML     = "";
  document.getElementById("pauseBtn").innerHTML    = "⏸ አቁም";
  document.getElementById("autoBtn").innerHTML     = "⏹ ራስ-ሰር አቁም";
  document.getElementById("autoBtnBoard").innerHTML = "⏹ ራስ-ሰር አቁም";

  var pp  = document.getElementById("livePrizePool");  if (pp)  pp.textContent  = fmtMoney(currentPrizePool);
  var lcc = document.getElementById("liveCardCount");  if (lcc) lcc.textContent = cards.length;
  var lpc = document.getElementById("livePlayerCount");if (lpc) lpc.textContent = playerCount;

  buildWeights(); setProbMode(probMode); buildNumberBoard(); renderCards();
  showScreen("gameScreen"); updateAutoBadge();
  applyGameControlVisibility(); // hide controls from non-admins
  // Apply current slider speed
  var slider = document.getElementById("speedSlider");
  if (slider) setSpeed(slider.value);

  // ── 30-second countdown ───────────────────────────────────
  var secondsLeft = 30;
  countdownActive = true;

  // Show cancel button during countdown (admin only), hide stop button
  var stopBtn   = document.getElementById("stopGameBtn");
  var cancelBtn = document.getElementById("cancelCountdownBtn");
  if (stopBtn)   stopBtn.style.display   = "none";
  if (cancelBtn) cancelBtn.style.display = currentUserIsAdmin() ? "" : "none";

  // Update the big number display with countdown
  function updateCountdownDisplay(s) {
    var el    = document.getElementById("calledNumberDigit");
    var am    = document.getElementById("calledNumberAmharic");
    var badge = document.getElementById("bnnColBadge");
    if (el)    el.textContent    = s;
    if (am)    am.textContent    = "ጨዋታ ይጀምራል...";
    if (badge) badge.textContent = "⏳";
    // Pulse the big ball gold during countdown
    var ball = document.querySelector(".gs-big-ball");
    if(ball) ball.style.borderColor = "#f59e0b";
  }

  updateCountdownDisplay(secondsLeft);
  SFX.start();
  speakDirect("ጨዋታ ለመጀመር ተዘጋጁ");

  countdownTimer = setInterval(function() {
    secondsLeft--;
    updateCountdownDisplay(secondsLeft);

    // Speak last 5 seconds
    if (secondsLeft <= 5 && secondsLeft > 0) {
      speakDirect(String(secondsLeft));
    }

    if (secondsLeft <= 0) {
      // ── Countdown done — start the game ──────────────────
      clearInterval(countdownTimer);
      countdownActive = false;
      countdownTimer  = null;

      // Hide cancel — show stop to admin only
      if (cancelBtn) cancelBtn.style.display = "none";
      if (stopBtn) {
        if (currentUserIsAdmin()) {
          stopBtn.style.display  = "";
          stopBtn.disabled       = false;
          stopBtn.style.opacity  = "1";
          stopBtn.title          = "ጨዋታ አቁም (አስተዳዳሪ)";
        } else {
          stopBtn.style.display  = "none";
        }
      }

      gameActive = true;
      autoMode   = true;

      var badge = document.getElementById("bnnColBadge");
      if (badge) { badge.textContent = "—"; badge.style.background = ""; }

      speakDirect("ጨዋታ ጀምሯል");
      setTimeout(callNextNumber, 1000);
      updateAutoBadge();
    }
  }, 1000);
}

function buildNumberBoard(){
  var board = document.getElementById("numberBoard");
  board.innerHTML = "";
  var colClass = ["gs-nb-b","gs-nb-i","gs-nb-n","gs-nb-g","gs-nb-o"];
  var colLabel  = ["B","I","N","G","O"];
  // 5 cols × 15 rows: col 0=B(1-15), col 1=I(16-30), etc.
  for(var row = 0; row < 15; row++){
    for(var col = 0; col < 5; col++){
      var num = col * 15 + row + 1;
      var btn = document.createElement("button");
      btn.className = "gs-nb-btn " + colClass[col];
      btn.id = "nb-" + num;
      btn.textContent = num;
      btn.onclick = (function(n){ return function(){ callSpecificNumber(n); }; })(num);
      board.appendChild(btn);
    }
  }
}

function updateNumberBoard(){
  var colClass = ["gs-nb-b","gs-nb-i","gs-nb-n","gs-nb-g","gs-nb-o"];
  for(var n=1;n<=75;n++){
    var btn=document.getElementById("nb-"+n);
    if(!btn) continue;
    var col = Math.floor((n-1)/15);
    if(calledNumbers.indexOf(n)!==-1){
      btn.classList.add("gs-called");
      btn.disabled = !currentUserIsAdmin();
    } else {
      btn.classList.remove("gs-called");
      btn.disabled = !currentUserIsAdmin();
    }
  }
}

function buildWeights(){
  var freq={};for(var n=1;n<=75;n++)freq[n]=0;
  cards.forEach(function(card){for(var col=0;col<5;col++)for(var row=0;row<5;row++){var v=card.grid[col][row];if(v!=="FREE"&&calledNumbers.indexOf(v)===-1)freq[v]++;}});
  var pc=Math.max(1,cards.length);
  for(var n=1;n<=75;n++){
    if(calledNumbers.indexOf(n)!==-1){numberWeights[n]=0;continue;}
    var f=freq[n];
    if(probMode==="pure")numberWeights[n]=1;
    else if(probMode==="hot")numberWeights[n]=Math.pow(f+1,2);
    else if(probMode==="cold")numberWeights[n]=Math.pow(pc-f+1,2);
    else numberWeights[n]=1+f*0.6;
  }
  updateBoardHeatmap();
}

function updateBoardHeatmap(){
  var uncalled=remainingNums.filter(function(n){return calledNumbers.indexOf(n)===-1;});
  if(probMode==="pure"){uncalled.forEach(function(n){var b=document.getElementById("nb-"+n);if(b)b.classList.remove("nb-hot3","nb-hot2","nb-hot1","nb-cold1","nb-cold2");});return;}
  if(uncalled.length===0)return;
  var weights=uncalled.map(function(n){return numberWeights[n]||1;});
  var maxW=Math.max.apply(null,weights),minW=Math.min.apply(null,weights),span=maxW-minW||1;
  uncalled.forEach(function(n){
    var btn=document.getElementById("nb-"+n);if(!btn)return;
    btn.classList.remove("nb-hot3","nb-hot2","nb-hot1","nb-cold1","nb-cold2");
    var ratio=(numberWeights[n]-minW)/span;
    if(ratio>=0.80)btn.classList.add("nb-hot3");
    else if(ratio>=0.60)btn.classList.add("nb-hot2");
    else if(ratio>=0.40)btn.classList.add("nb-hot1");
    else if(ratio<=0.20)btn.classList.add("nb-cold2");
    else if(ratio<=0.35)btn.classList.add("nb-cold1");
  });
}

function setProbMode(mode){
  probMode=mode;
  ["pure","balanced","hot","cold"].forEach(function(m){var b=document.getElementById("prob-"+m);if(b)b.classList.toggle("prob-active",m===mode);});
  if(gameActive){buildWeights();var labels={pure:"ተራ ዕጣ",balanced:"ሚዛናዊ",hot:"ፈጣን"};speakAmharic(labels[mode]+" ሁነታ",true);flashMessage("📊 "+labels[mode],"#6366f1");}
}

function weightedDraw(){
  var pool=remainingNums.filter(function(n){return calledNumbers.indexOf(n)===-1;});
  if(pool.length===0)return null;
  var total=pool.reduce(function(s,n){return s+(numberWeights[n]||1);},0);
  var rand=Math.random()*total;
  for(var i=0;i<pool.length;i++){rand-=(numberWeights[pool[i]]||1);if(rand<=0)return pool[i];}
  return pool[pool.length-1];
}

function setSpeed(val){
  // Fixed speed — always ፈጣን (fast = 2 seconds)
  callSpeed     = 1;
  AUTO_INTERVAL = 1000;
  var el = document.getElementById("speedLabel");
  if (el) el.textContent = "⚡ ፈጣን";
}

function scheduleNext(){
  clearTimeout(autoLoopTimer);
  if(!autoMode||!gameActive||isPaused)return;
  autoLoopTimer=setTimeout(function(){if(autoMode&&gameActive&&!isPaused)callNextNumber();},AUTO_INTERVAL);
}

function callSpecificNumber(num){
  if(!gameActive||isPaused)return;
  if(!currentUserIsAdmin()){flashMessage("❌ አስተዳዳሪ ብቻ ቁጥር መጥራት ይችላሉ","#ef4444");return;}
  if(calledNumbers.indexOf(num)!==-1)return;
  clearTimeout(autoLoopTimer);
  remainingNums=remainingNums.filter(function(n){return n!==num;});
  calledNumbers.push(num);
  buildWeights();announceNumber(num);scheduleNext();
}

function callNextNumber(){
  if(!gameActive||isPaused)return;
  if(!currentUserIsAdmin()){flashMessage("❌ አስተዳዳሪ ብቻ ቁጥር መጥራት ይችላሉ","#ef4444");return;}
  if(remainingNums.length===0){speakAmharic("ሁሉም ቁጥሮች ተጠርተዋል። ጨዋታ አልቋል።",true);flashMessage("ሁሉም ቁጥሮች ተጠሩ!","#f59e0b");autoMode=false;updateAutoBadge();return;}
  clearTimeout(autoLoopTimer);
  buildWeights();
  var num=weightedDraw();if(num===null)return;
  remainingNums=remainingNums.filter(function(n){return n!==num;});
  calledNumbers.push(num);
  announceNumber(num);scheduleNext();
}

function announceNumber(num){
  var colIdx   = Math.floor((num-1)/15);
  var colLabels = ["B","I","N","G","O"];
  var colLabel  = colLabels[colIdx];
  var colFull   = colLabel;
  var amName    = getAmharicName(num);
  var colBallClass = ["bc-b","bc-i","bc-n","bc-g","bc-o"][colIdx];

  // Update big ball
  var badge = document.getElementById("bnnColBadge");
  var digit = document.getElementById("calledNumberDigit");
  var amEl  = document.getElementById("calledNumberAmharic");
  if(badge) badge.textContent = colLabel + "-" + num;
  if(digit) digit.textContent = num;
  if(amEl)  amEl.textContent  = amName;

  // Animate big ball
  var ball = document.querySelector(".gs-big-ball");
  if(ball){ ball.style.animation="none"; void ball.offsetWidth; ball.style.animation="ball-pop .3s ease"; }

  // Update called count
  document.getElementById("calledCount").textContent = calledNumbers.length;

  // Add ball chip to recent row (keep last 5)
  var row = document.getElementById("calledNumbersList");
  if(row){
    var chip = document.createElement("div");
    chip.className = "gs-ball-chip " + colBallClass;
    chip.textContent = colLabel + "-" + num;
    row.insertBefore(chip, row.firstChild);
    // Keep only last 5
    while(row.children.length > 5) row.removeChild(row.lastChild);
  }

  updateNumberBoard();
  markAllCards(num);
  SFX.number();
  speakNumberDirect(colFull, amName);
}

// ============================================================
//  SPEECH ENGINE — reliable Amharic voice
//  Handles: Chrome unlock, voices-not-loaded, repeat announcement
// ============================================================

var _voiceUnlocked = false;
var _amharicVoice  = null;

// ── Step 1: unlock speech on first user tap ───────────────────
// Chrome requires a user gesture before speechSynthesis works.
// We fire a silent utterance on the very first click anywhere.
document.addEventListener("click", function unlockSpeech() {
  if (_voiceUnlocked) return;
  _voiceUnlocked = true;
  document.removeEventListener("click", unlockSpeech);
  var u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  window.speechSynthesis.speak(u);
  // Also load voices now
  _loadVoice();
}, { once: false });

// ── Step 2: find best Amharic voice ──────────────────────────
function _loadVoice() {
  var voices = window.speechSynthesis.getVoices();
  _amharicVoice =
    voices.find(function(v){ return v.lang === "am-ET"; }) ||
    voices.find(function(v){ return v.lang.startsWith("am"); }) ||
    null;
}
// Voices load asynchronously in Chrome
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = _loadVoice;
  _loadVoice(); // try immediately too
}

// ── Step 3: make a configured utterance ──────────────────────
function makeSpeechUtterance(text) {
  var u    = new SpeechSynthesisUtterance(text);
  u.lang   = "am-ET";
  u.rate   = 0.85;
  u.pitch  = 1.05;
  u.volume = 1.0;
  if (_amharicVoice) u.voice = _amharicVoice;
  return u;
}

// ── Step 4: speak a number — host style ──────────────────────
// Announces: "ቁጥር ቢ... አስራ ሁለት" then repeats "አስራ ሁለት"
function speakNumberDirect(colFull, amName) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  var u1 = makeSpeechUtterance("ቁጥር " + colFull + " " + amName);
  var u2 = makeSpeechUtterance(amName);

  u1.onend  = function() {
    setTimeout(function(){ window.speechSynthesis.speak(u2); }, 400);
  };
  u1.onerror = function(){};
  u2.onerror = function(){};

  setTimeout(function(){ window.speechSynthesis.speak(u1); }, 150);
}

// ── Step 5: speak any text (countdown, win, etc.) ────────────
function speakDirect(text) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  var u = makeSpeechUtterance(text);
  setTimeout(function(){ window.speechSynthesis.speak(u); }, 80);
}

// ── Step 6: test button handler ──────────────────────────────
function testVoiceNow() {
  _loadVoice();
  speakNumberDirect("ቢ", "አስራ ሁለት");
  flashMessage("🔊 ድምፅ ሙከራ — ቢ አስራ ሁለት", "#f1d263ff");
}

function startVisualCountdown(){
  // Timer removed — speed slider controls interval instead
}

function setTimerArc(f){
  // Timer ring removed — no-op
}

function updateAutoBadge(){
  // Sync the toggle checkbox
  var toggle = document.getElementById("gsAutoToggle");
  if(toggle) toggle.checked = autoMode && gameActive && !isPaused;
  // Update bottom bar button text
  var btn = document.getElementById("autoBtnBoard");
  if(btn) btn.textContent = autoMode ? "⏹ Stop Auto" : "🔁 Automatic";
}

function togglePause(){
  if(!gameActive)return;
  if(!currentUserIsAdmin()){flashMessage("❌ አስተዳዳሪ ብቻ ጨዋታ ማቆም ይችላሉ","#ef4444");return;}
  isPaused=!isPaused;
  var btn=document.getElementById("pauseBtn");
  if(isPaused){btn.innerHTML="▶ ቀጥል";clearTimeout(autoLoopTimer);SFX.pause();speakDirect("ጨዋታ ቆሟል");}
  else{btn.innerHTML="⏸ አቁም";SFX.resume();speakDirect("ጨዋታ ቀጥሏል");if(autoMode)setTimeout(callNextNumber,1000);}
  updateAutoBadge();
}

function toggleAutoCall(){
  if(!gameActive)return;
  if(!currentUserIsAdmin()){flashMessage("❌ አስተዳዳሪ ብቻ ራስ-ሰር ማቆም ይችላሉ","#ef4444");return;}
  autoMode=!autoMode;
  var label=autoMode?"⏹ ራስ-ሰር አቁም":"🔁 ራስ-ሰር";
  document.getElementById("autoBtn").innerHTML=label;
  document.getElementById("autoBtnBoard").innerHTML=label;
  updateAutoBadge();
  if(autoMode){speakAmharic("ራስ-ሰር ሁነታ ተጀምሯል",true);callNextNumber();}
  else{clearTimeout(autoLoopTimer);speakAmharic("ራስ-ሰር ሁነታ ቆሟል",true);}
}

function markAllCards(num){
  cards.forEach(function(card){
    for(var col=0;col<5;col++)for(var row=0;row<5;row++)if(card.grid[col][row]===num)card.marked[col][row]=true;
    updateCardDisplay(card);
  });
}

function checkOneLine(card){
  for(var r=0;r<5;r++)if([0,1,2,3,4].every(function(c){return card.marked[c][r];}))return{type:"row",idx:r};
  for(var c=0;c<5;c++)if([0,1,2,3,4].every(function(r){return card.marked[c][r];}))return{type:"col",idx:c};
  if([0,1,2,3,4].every(function(i){return card.marked[i][i];}))return{type:"diag1"};
  if([0,1,2,3,4].every(function(i){return card.marked[i][4-i];}))return{type:"diag2"};
  return null;
}

function declareBingo(){
  if(!gameActive)return;
  var winners=cards.filter(function(c){return checkOneLine(c);});
  if(winners.length>0)triggerWin(winners);
  else{SFX.error();speakAmharic("ቢንጎ አልሆነም። ቀጥሉ።",true);flashMessage("ቢንጎ አልሆነም! ቀጥሉ 🎲","#ef4444");}
}

function triggerWin(winners){
  clearTimeout(autoLoopTimer);gameActive=false;autoMode=false;
  var w=winners[0];
  var ownerLabel=w.owner?"ተጫዋች "+w.owner:"ካርድ #"+w.id;

  // ── Auto-credit: credit logged-in user (winner) ──────────
  var prize = currentPrizePool;
  currentPrizePool = 0;

  if (currentUser && prize > 0) {
    addPrize(currentUser.phone, prize, function(res) {
      refreshUserBar();
    });
  }

  var prizeText = prize > 0 ? " | 🏆 " + fmtMoney(prize) : "";
  document.getElementById("winMessage").textContent =
    ownerLabel + " — ካርድ #" + w.id + " ቢንጎ! 🏆" + prizeText;

  // ── Show updated balance on win screen ───────────────────
  var winBalBar = document.getElementById("winBalanceBar");
  var winBalAmt = document.getElementById("winNewBalance");
  if (winBalBar && winBalAmt && prize > 0 && currentUser) {
    winBalAmt.textContent = "⏳ ...";
    winBalBar.classList.remove("hidden");
    apiCall("GET", "/wallet/balance", null, function(err, data) {
      if (data && data.ok) winBalAmt.textContent = fmtMoney(data.balance);
    });
  } else if (winBalBar) {
    winBalBar.classList.add("hidden");
  }

  // ── Prize credit panel ────────────────────────────────────
  var creditPanel = document.getElementById("winPrizeCredit");
  if (creditPanel) {
    document.getElementById("winPrizeAmount").textContent = fmtMoney(prize);
    document.getElementById("winCardNumber").textContent  = "ካርድ #" + w.id;
    var msgEl    = document.getElementById("winCreditMsg");
    var creditBtn= document.getElementById("winCreditBtn");

    if (prize > 0 && currentUser) {
      if (msgEl)  { msgEl.textContent = "✅ " + fmtMoney(prize) + " ሂሳብዎ ላይ ተጨምሯል!"; msgEl.classList.remove("hidden"); }
      if (creditBtn) creditBtn.disabled = true;
      creditPanel.dataset.prize = 0;
      SFX.start();
      flashMessage("💰 " + fmtMoney(prize) + " ሽልማት ተሰጥቷል!", "#22c55e");
    } else {
      if (msgEl)     msgEl.classList.add("hidden");
      if (creditBtn) creditBtn.disabled = false;
      creditPanel.dataset.prize = prize;
    }
    creditPanel.classList.remove("hidden");
  }

  // ── Show winner card + all other cards ───────────────────
  var container=document.getElementById("winCardDisplay");
  container.innerHTML="";

  var winnerWrap = document.createElement("div");
  winnerWrap.className = "win-winner-section";
  var winnerLabel = document.createElement("div");
  winnerLabel.className = "win-winner-label";
  winnerLabel.textContent = "🏆 " + ownerLabel + " — ካርድ #" + w.id;
  winnerWrap.appendChild(winnerLabel);
  winnerWrap.appendChild(buildCardElement(w, true, false));
  container.appendChild(winnerWrap);

  var otherCards = cards.filter(function(c){ return c.id !== w.id; });
  if(otherCards.length > 0){
    var othersSection = document.createElement("div");
    othersSection.className = "win-others-section";
    var othersLabel = document.createElement("div");
    othersLabel.className = "win-others-label";
    othersLabel.textContent = "📋 ሌሎች ካርዶች (" + otherCards.length + ")";
    othersSection.appendChild(othersLabel);
    var othersGrid = document.createElement("div");
    othersGrid.className = "win-others-grid";
    otherCards.forEach(function(c){ othersGrid.appendChild(buildCardElement(c, false, false)); });
    othersSection.appendChild(othersGrid);
    container.appendChild(othersSection);
  }

  SFX.bingo();speakDirect("ቢንጎ!");
  setTimeout(function(){speakDirect(ownerLabel+" አሸነፈ!");},1200);
  if (prize > 0) setTimeout(function(){speakDirect(fmtMoney(prize)+" ሽልማት ተሰጥቷል!");},2600);
  setTimeout(function(){speakDirect("እንኳን ደስ አለዎ!");},prize>0?3800:2800);
  setTimeout(function(){showScreen("winScreen"); refreshUserBar();},500);
}

// ── Credit prize to winner wallet ─────────────────────────────
function creditWinner() {
  var panel  = document.getElementById("winPrizeCredit");
  var wId    = (document.getElementById("winWalletId").value || "").trim();
  var prize  = parseFloat(panel.dataset.prize || 0);

  if (!wId)    { flashMessage("❌ የደንበኛ መታወቂያ ያስገቡ", "#ef4444"); return; }
  if (!prize)  { flashMessage("❌ ሽልማት የለም", "#ef4444"); return; }

  var c = getCustomer(wId);
  if (!c) { flashMessage("❌ ደንበኛ አልተገኘም: " + wId, "#ef4444"); return; }

  addPrize(wId, prize);
  recordGameWon(wId, prize);

  // Show success
  var msgEl = document.getElementById("winCreditMsg");
  if (msgEl) {
    msgEl.textContent = "✅ " + fmtMoney(prize) + " → " + c.name + " (" + wId + ") ተሰጥቷል!";
    msgEl.classList.remove("hidden");
  }
  panel.dataset.prize = 0; // prevent double-credit
  document.getElementById("winCreditBtn").disabled = true;
  SFX.start();
  speakDirect(c.name + " " + fmtMoney(prize) + " ሽልማት ተሰጥቷል");
  flashMessage("💰 " + fmtMoney(prize) + " → " + c.name, "#22c55e");
}

function renderCards(){
  var grid=document.getElementById("cardsGrid");grid.innerHTML="";
  cards.forEach(function(card){grid.appendChild(buildCardElement(card,false,false));});
}

function buildCardElement(card,isWin,isMini){
  var wrap=document.createElement("div");
  wrap.className="bingo-card"+(isWin?" win-card":"")+(isMini?" mini-preview":"");
  wrap.id="card-"+card.id;
  var hdr=document.createElement("div");hdr.className="card-header";
  var ownerLabel=card.owner?"P"+card.owner:"#"+card.id;
  hdr.innerHTML='<span class="card-id">'+ownerLabel+"</span>"+BINGO_COLS_AM.map(function(l,i){return'<span class="col-label col-'+i+'">'+l+"</span>";}).join("");
  wrap.appendChild(hdr);
  var gridEl=document.createElement("div");gridEl.className="card-grid";
  for(var row=0;row<5;row++){for(var col=0;col<5;col++){
    var cell=document.createElement("div");
    var val=card.grid[col][row];var isFree=val==="FREE";var isMarked=card.marked[col][row];
    var isCalled=!isFree&&calledNumbers.indexOf(val)!==-1;
    cell.className="card-cell col-"+col+(isFree?" free":"")+(isMarked?" marked":"")+(isCalled&&!isMarked?" called-not-marked":"");
    cell.textContent=isFree?"★":val;
    cell.dataset.cardId=card.id;cell.dataset.col=col;cell.dataset.row=row;
    gridEl.appendChild(cell);
  }}
  wrap.appendChild(gridEl);return wrap;
}

function updateCardDisplay(card){
  var wrap=document.getElementById("card-"+card.id);if(!wrap)return;
  wrap.querySelectorAll(".card-cell").forEach(function(cell){
    var c=parseInt(cell.dataset.col),r=parseInt(cell.dataset.row);
    var val=card.grid[c][r];
    // Keep col-X class, toggle state classes
    cell.className="card-cell col-"+c+(val==="FREE"?" free":"")+(card.marked[c][r]?" marked":"")+(val!=="FREE"&&calledNumbers.indexOf(val)!==-1&&!card.marked[c][r]?" called-not-marked":"");
  });
  if(!gameActive)return;
  var line=checkOneLine(card);
  if(line&&!card.hasBingo){
    card.hasBingo=true;wrap.classList.add("has-bingo");
    highlightWinLine(wrap,card,line);
    triggerWin([card]);
  }
}

function highlightWinLine(wrap,card,line){
  var cells=wrap.querySelectorAll(".card-cell");
  function getCell(col,row){return Array.from(cells).find(function(c){return parseInt(c.dataset.col)===col&&parseInt(c.dataset.row)===row;});}
  if(line.type==="row"){for(var c=0;c<5;c++){var cl=getCell(c,line.idx);if(cl)cl.classList.add("win-line");}}
  else if(line.type==="col"){for(var r=0;r<5;r++){var cl=getCell(line.idx,r);if(cl)cl.classList.add("win-line");}}
  else if(line.type==="diag1"){for(var i=0;i<5;i++){var cl=getCell(i,i);if(cl)cl.classList.add("win-line");}}
  else if(line.type==="diag2"){for(var i=0;i<5;i++){var cl=getCell(i,4-i);if(cl)cl.classList.add("win-line");}}
}

function endGame(){
  // Called from confirm dialog — only valid during countdown
  if (countdownActive) {
    cancelCountdown();
  }
  hideDialog();
}

function onVoiceSelect(idx){VoiceEngine.pickByIndex(idx);}
function onVolumeChange(v){VoiceEngine.setVol(v);document.getElementById("volVal").textContent=Math.round(v*100)+"%";}
function onRateChange(r){VoiceEngine.setRate(r);document.getElementById("rateVal").textContent=r+"x";}
function toggleMuteBtn(){VoiceEngine.toggleMute();}
function testVoice(){SFX.number();speakAmharic("ቢ ሃምሳ ሶስት",true);}

// ── Dashboard ─────────────────────────────────────────────────
function openDashboard() {
  if (!currentUser) { flashMessage("❌ ይግቡ", "#ef4444"); return; }
  getUserDashboard(currentUser.phone, function(dash) {
    if (!dash) { flashMessage("❌ ዳሽቦርድ አልተገኘም", "#ef4444"); return; }

  document.getElementById("dashName").textContent    = dash.name;
  document.getElementById("dashPhone").textContent   = dash.phone;
  document.getElementById("dashBalance").textContent = fmtMoney(dash.balance);
  document.getElementById("dashGamesPlayed").textContent = dash.stats.gamesPlayed;
  document.getElementById("dashGamesWon").textContent    = dash.stats.gamesWon;
  document.getElementById("dashTotalSpent").textContent  = fmtMoney(dash.stats.totalSpent);
  document.getElementById("dashTotalWon").textContent    = fmtMoney(dash.stats.totalWon);

  // Transaction history
  var hist = document.getElementById("dashHistory");
  hist.innerHTML = "";
  if (dash.history.length === 0) {
    hist.innerHTML = '<div class="dash-no-hist">ምንም ግብይት የለም</div>';
  } else {
    var icons = { deposit:"💵", withdraw:"💸", entry_fee:"🎮", prize:"🏆" };
    var colors = { deposit:"#22c55e", withdraw:"#ef4444", entry_fee:"#6366f1", prize:"#f59e0b" };
    dash.history.forEach(function(h) {
      var icon  = icons[h.type]  || "•";
      var color = colors[h.type] || "#94a3b8";
      var sign  = (h.type === "deposit" || h.type === "prize") ? "+" : "-";
      var row = document.createElement("div");
      row.className = "dash-hist-row";
      row.innerHTML =
        '<div class="dhr-icon" style="color:'+color+'">'+icon+'</div>' +
        '<div class="dhr-info">' +
          '<div class="dhr-type">'+h.type+'</div>' +
          '<div class="dhr-date">'+h.date+'</div>' +
        '</div>' +
        '<div class="dhr-amount" style="color:'+color+'">' +
          sign + fmtMoney(h.amount) +
        '</div>' +
        '<div class="dhr-bal">'+fmtMoney(h.balance)+'</div>';
      hist.appendChild(row);
    });
  }
  showScreen("dashboardScreen");
  }); // end getUserDashboard callback
}

// ── Update prize preview on card select ───────────────────────
function updatePrizePreview() {
  var totalCards = 0;
  for (var i = 0; i < playerCount; i++) totalCards += (playerCards[i] || []).length;
  var fee   = ENTRY_FEE * totalCards;
  var prize = fee - Math.floor(fee * 0.20); // 20% house cut
  var pa = document.getElementById("prizePreviewAmt");
  var fa = document.getElementById("feePreviewAmt");
  if (pa) pa.textContent = totalCards > 0 ? fmtMoney(prize) : "—";
  if (fa) fa.textContent = totalCards > 0 ? fmtMoney(fee)   : "—";
}

// Init runs after DOM is ready — auto-login via Telegram, no login screen
document.addEventListener("DOMContentLoaded", function() {
  var pcd = document.getElementById("playerCountDisplay");
  if (pcd) pcd.textContent = playerCount;
  autoLogin();
});

// ============================================================
//  ADMIN PANEL — Password gate
// ============================================================

function openAdminPanel() {
  // Admin already has panel token from login — go straight in
  if (getPanelToken()) {
    showScreen("walletScreen");
    // Auto-load pending tab
    setTimeout(function() {
      wTab("pending");
      loadAdminStats();
    }, 100);
    return;
  }
  // Fallback: show password modal (shouldn't happen for admin)
  var modal = document.getElementById("adminPanelModal");
  if (modal) {
    modal.classList.remove("hidden");
    var inp = document.getElementById("adminPanelPass");
    if (inp) { inp.value = ""; setTimeout(function(){ inp.focus(); }, 100); }
    var err = document.getElementById("adminPanelError");
    if (err) err.classList.add("hidden");
  }
}

function loadAdminStats() {
  apiCall("GET", "/admin/stats", null, function(err, data) {
    if (!data || !data.ok) return;
    var s = data.stats;
    var el = function(id) { return document.getElementById(id); };
    if (el("statUsers"))   el("statUsers").textContent   = s.users || 0;
    if (el("statBalance")) el("statBalance").textContent = fmtMoney(s.total_balance || 0);
    if (el("statGames"))   el("statGames").textContent   = s.games || 0;
    var pending = (s.pending_dep || 0) + (s.pending_wdr || 0);
    if (el("statPending")) el("statPending").textContent = pending;
    var wrap = el("statPendingWrap");
    if (wrap) wrap.style.borderColor = pending > 0 ? "#f59e0b" : "";
  });
}

function closeAdminPanelModal() {
  var modal = document.getElementById("adminPanelModal");
  if (modal) modal.classList.add("hidden");
}

function submitAdminPanelLogin() {
  var pass = (document.getElementById("adminPanelPass").value || "").trim();
  var btn  = document.getElementById("adminPanelLoginBtn");
  var err  = document.getElementById("adminPanelError");

  err.classList.add("hidden");

  if (!pass) {
    err.textContent = "የይለፍ ቃል ያስፈልጋል";
    err.classList.remove("hidden");
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = "⏳ ..."; }

  apiCall("POST", "/admin/panel-login", { password: pass }, function(error, data) {
    if (btn) { btn.disabled = false; btn.textContent = "🔓 ግባ"; }

    if (error || !data || !data.ok) {
      err.textContent = (data && data.msg) ? data.msg : "ኔትወርክ ስህተት — Backend ይሰራ እንደሆነ ያረጋግጡ";
      err.classList.remove("hidden");
      document.getElementById("adminPanelPass").value = "";
      return;
    }

    setPanelToken(data.token);
    closeAdminPanelModal();
    flashMessage("✅ አስተዳዳሪ ፓነል ተከፈተ", "#22c55e");
    showScreen("walletScreen");
    updatePendingBadge();
  });
}

function wTab(name) {
  document.querySelectorAll(".wtab").forEach(function(t){ t.classList.remove("active"); });
  document.querySelectorAll(".wpanel").forEach(function(p){ p.classList.remove("active"); });
  var tab   = document.getElementById("wtab-"   + name);
  var panel = document.getElementById("wpanel-" + name);
  if (tab)   tab.classList.add("active");
  if (panel) panel.classList.add("active");
  if (name === "all")     renderAllCustomers();
  if (name === "pending") renderPendingRequests();
  if (name === "txns")    renderTxns();
  updatePendingBadge();
}

// ── Transaction history (admin) ───────────────────────────────
var _txnData   = null;   // cached response
var _txnFilter = "all";  // 'all' | 'deposit' | 'withdraw'

function filterTxns(type) {
  _txnFilter = type;
  document.querySelectorAll(".txn-filter").forEach(function(b){ b.classList.remove("active"); });
  var btn = document.getElementById("txnf-" + type);
  if (btn) btn.classList.add("active");
  if (_txnData) _renderTxnList(_txnData);
}

function renderTxns() {
  var listEl    = document.getElementById("txnList");
  var summaryEl = document.getElementById("txnSummary");
  if (!listEl) return;
  listEl.innerHTML    = '<div class="txn-loading">⏳ እየጫነ ነው...</div>';
  if (summaryEl) summaryEl.innerHTML = '';

  apiCall("GET", "/admin/transactions?limit=200", null, function(err, data) {
    if (err || !data || !data.ok) {
      listEl.innerHTML = '<div class="txn-empty">❌ ' + (data ? data.msg : "ስህተት") + '</div>';
      return;
    }
    _txnData = data;
    _renderTxnSummary(data.totals, summaryEl);
    _renderTxnList(data);
  });
}

function _renderTxnSummary(totals, el) {
  if (!el || !totals) return;
  var dep = totals.deposit  || {};
  var wdr = totals.withdraw || {};
  el.innerHTML =
    '<div class="txn-sum-grid">' +
      '<div class="txn-sum-card txn-sum-dep">' +
        '<div class="tsc-icon">💵</div>' +
        '<div class="tsc-label">ጠቅላላ ገቢ</div>' +
        '<div class="tsc-amount">' + fmtMoney(dep.approved || 0) + '</div>' +
        '<div class="tsc-sub">' +
          '<span class="tsc-pending">⏳ ' + fmtMoney(dep.pending || 0) + '</span>' +
          ' | <span class="tsc-rejected">❌ ' + fmtMoney(dep.rejected || 0) + '</span>' +
        '</div>' +
        '<div class="tsc-count">' + (dep.total_count || 0) + ' ጥያቄ</div>' +
      '</div>' +
      '<div class="txn-sum-card txn-sum-wdr">' +
        '<div class="tsc-icon">💸</div>' +
        '<div class="tsc-label">ጠቅላላ ወጪ</div>' +
        '<div class="tsc-amount">' + fmtMoney(wdr.approved || 0) + '</div>' +
        '<div class="tsc-sub">' +
          '<span class="tsc-pending">⏳ ' + fmtMoney(wdr.pending || 0) + '</span>' +
          ' | <span class="tsc-rejected">❌ ' + fmtMoney(wdr.rejected || 0) + '</span>' +
        '</div>' +
        '<div class="tsc-count">' + (wdr.total_count || 0) + ' ጥያቄ</div>' +
      '</div>' +
    '</div>';
}

function _renderTxnList(data) {
  var listEl = document.getElementById("txnList");
  if (!listEl) return;

  var rows = [];

  if (_txnFilter !== 'withdraw') {
    (data.deposits || []).forEach(function(d) {
      rows.push({
        type:    'deposit',
        id:      d.id,
        phone:   d.phone,
        name:    d.full_name,
        amount:  d.amount,
        ref:     d.tx_id || '—',
        status:  d.status,
        date:    d.created_at,
        note:    d.note || ''
      });
    });
  }

  if (_txnFilter !== 'deposit') {
    (data.withdrawals || []).forEach(function(w) {
      rows.push({
        type:    'withdraw',
        id:      w.id,
        phone:   w.phone,
        name:    w.full_name,
        amount:  w.amount,
        ref:     (w.account_type || '') + ' ' + (w.account_number || ''),
        status:  w.status,
        date:    w.created_at,
        note:    w.note || ''
      });
    });
  }

  // Sort newest first
  rows.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });

  if (!rows.length) {
    listEl.innerHTML = '<div class="txn-empty">ምንም ታሪክ የለም</div>';
    return;
  }

  var statusLabel = { approved: '✅ ተፈቅዷል', pending: '⏳ በጥበቃ', rejected: '❌ ውድቅ' };
  var statusClass = { approved: 'txn-approved', pending: 'txn-pending', rejected: 'txn-rejected' };

  var html = '';
  rows.forEach(function(r) {
    var isDeposit = r.type === 'deposit';
    var dateStr   = r.date ? new Date(r.date).toLocaleString('am-ET', { dateStyle:'short', timeStyle:'short' }) : '—';
    html +=
      '<div class="txn-row ' + (statusClass[r.status] || '') + '">' +
        '<div class="txn-row-top">' +
          '<span class="txn-type-badge ' + (isDeposit ? 'txn-dep-badge' : 'txn-wdr-badge') + '">' +
            (isDeposit ? '💵 ገቢ' : '💸 ወጪ') +
          '</span>' +
          '<span class="txn-phone">' + (r.phone || '') + '</span>' +
          '<span class="txn-amount ' + (isDeposit ? 'txn-amt-dep' : 'txn-amt-wdr') + '">' +
            (isDeposit ? '+' : '-') + fmtMoney(r.amount) +
          '</span>' +
        '</div>' +
        '<div class="txn-row-mid">' +
          '<span class="txn-name">' + (r.name || '') + '</span>' +
          '<span class="txn-ref">' + r.ref + '</span>' +
        '</div>' +
        '<div class="txn-row-bot">' +
          '<span class="txn-status ' + (statusClass[r.status] || '') + '">' + (statusLabel[r.status] || r.status) + '</span>' +
          '<span class="txn-date">' + dateStr + '</span>' +
          (r.note ? '<span class="txn-note">' + r.note + '</span>' : '') +
        '</div>' +
      '</div>';
  });
  listEl.innerHTML = html;
}

function updatePendingBadge() {
  // Async version — calls backend
  apiCall("GET", "/admin/deposits/pending", null, function(err, depData) {
    apiCall("GET", "/admin/withdrawals/pending", null, function(err2, wdrData) {
      var count = 0;
      if (depData && depData.requests) count += depData.requests.length;
      if (wdrData && wdrData.requests) count += wdrData.requests.length;

      // Update wallet screen tab
      var tab = document.getElementById("wtab-pending");
      if (tab) {
        tab.textContent = count > 0 ? "⏳ ጥያቄዎች (" + count + ")" : "⏳ ጥያቄዎች";
        tab.style.borderColor = count > 0 ? "#f59e0b" : "";
        tab.style.color       = count > 0 ? "#f59e0b" : "";
      }

      // Update admin menu button with badge
      var adminBtn = document.getElementById("adminPanelBtn_menu");
      if (adminBtn) {
        adminBtn.textContent = count > 0
          ? "🔐 አስተዳዳሪ (" + count + " ጥያቄ)"
          : "🔐 አስተዳዳሪ ፓነል";
        adminBtn.style.background = count > 0
          ? "linear-gradient(135deg,#f59e0b,#d97706)"
          : "";
      }
    });
  });
}

function setAmt(inputId, val) {
  document.getElementById(inputId).value = val;
}

function showWResult(elId, ok, msg, customer) {
  var el = document.getElementById(elId);
  el.classList.remove("hidden","wr-ok","wr-err");
  el.classList.add(ok ? "wr-ok" : "wr-err");
  var html = "<div class='wr-msg'>"+(ok?"✅":"❌")+" "+msg+"</div>";
  if(customer) {
    html += "<div class='wr-card'>";
    html += "<div class='wr-row'><span>📱 ስልክ</span><strong>"+(customer.phone||customer.id)+"</strong></div>";
    html += "<div class='wr-row'><span>👤 ስም</span><strong>"+(customer.full_name||customer.name||"")+"</strong></div>";
    html += "<div class='wr-row wr-balance'><span>💰 ቀሪ ሂሳብ</span><strong>"+fmtMoney(customer.balance)+"</strong></div>";
    html += "</div>";
  }
  el.innerHTML = html;
}

function doAdminRegister() {
  // Delegate to wallet.js version
  var phone = (document.getElementById("regPhone2").value || "").trim();
  var pass  = (document.getElementById("regPass3").value || "");
  var el    = document.getElementById("registerResult");
  if (!phone || phone.length < 10) { el.innerHTML='<div class="wr-err">❌ ትክክለኛ ስልክ ቁጥር ያስገቡ</div>'; el.classList.remove("hidden"); return; }
  if (pass.length < 4)             { el.innerHTML='<div class="wr-err">❌ የይለፍ ቃል ቢያንስ 4 ቁጥር</div>'; el.classList.remove("hidden"); return; }
  apiCall("POST", "/auth/register", { phone: phone, password: pass, full_name: phone }, function(err, data) {
    if (err || !data || !data.ok) { el.innerHTML='<div class="wr-err">❌ '+(data?data.msg:"ስህተት")+'</div>'; }
    else { el.innerHTML='<div class="wr-ok">✅ ምዝገባ ተሳክቷል — '+phone+'</div>'; document.getElementById("regPhone2").value=""; document.getElementById("regPass3").value=""; }
    el.classList.remove("hidden");
  });
}

function doRegister() {
  // Legacy no-op
}

function doDeposit() {
  // Handled by wallet.js doDeposit() — uses backend API
  if (typeof window.doDeposit_wallet === "function") { window.doDeposit_wallet(); return; }
  // fallback: call wallet.js version directly
  var id   = (document.getElementById("depId").value || "").trim();
  var amt  = parseFloat(document.getElementById("depAmount").value);
  var txId = (document.getElementById("depTxId") ? document.getElementById("depTxId").value.trim() : "");
  var el   = document.getElementById("depositResult");
  if (!id || isNaN(amt) || amt <= 0) { el.innerHTML='<div class="wr-err">❌ ስልክ ቁጥር እና መጠን ያስፈልጋሉ</div>'; el.classList.remove("hidden"); return; }
  el.innerHTML='<div class="wr-info">⏳ እየተሰራ ነው...</div>'; el.classList.remove("hidden");
  apiCall("GET", "/admin/users?search=" + encodeURIComponent(id), null, function(err, data) {
    if (err || !data.ok || !data.users.length) { el.innerHTML='<div class="wr-err">❌ ደንበኛ አልተገኘም</div>'; return; }
    var userId = data.users[0].id;
    apiCall("POST", "/admin/users/" + userId + "/credit", { amount: amt, note: "Admin deposit" + (txId ? " TXN:"+txId : "") }, function(err2, data2) {
      if (err2 || !data2 || !data2.ok) { el.innerHTML='<div class="wr-err">❌ '+(data2?data2.msg:"ስህተት")+'</div>'; }
      else { el.innerHTML='<div class="wr-ok">✅ '+fmtMoney(amt)+' ለ '+id+' ተሰጥቷል። አዲስ ሂሳብ: '+fmtMoney(data2.new_balance)+'</div>'; document.getElementById("depId").value=""; document.getElementById("depAmount").value=""; if(document.getElementById("depTxId")) document.getElementById("depTxId").value=""; }
    });
  });
}

function doWithdraw() {
  var id  = (document.getElementById("wdrId").value || "").trim();
  var amt = parseFloat(document.getElementById("wdrAmount").value);
  var el  = document.getElementById("withdrawResult");
  if (!id || isNaN(amt) || amt <= 0) { el.innerHTML='<div class="wr-err">❌ ስልክ ቁጥር እና መጠን ያስፈልጋሉ</div>'; el.classList.remove("hidden"); return; }
  el.innerHTML='<div class="wr-info">⏳ እየተሰራ ነው...</div>'; el.classList.remove("hidden");
  el.innerHTML='<div class="wr-ok">✅ ጥያቄ ተልኳል</div>';
  document.getElementById("wdrId").value=""; document.getElementById("wdrAmount").value="";
}

function renderAllCustomers() {
  // Handled by wallet.js renderAllCustomers()
  if (typeof window._renderAllCustomers === "function") { window._renderAllCustomers(); return; }
  var el = document.getElementById("allCustomers");
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:16px">⏳ እየጫነ ነው...</div>';
  apiCall("GET", "/admin/users?limit=200", null, function(err, data) {
    if (!data || !data.users || !data.users.length) { el.innerHTML='<div style="text-align:center;color:var(--muted);padding:16px">ምንም ተጠቃሚ የለም</div>'; return; }
    var html = "";
    data.users.forEach(function(u) {
      html += "<div class='customer-item"+(u.is_banned?" cust-banned":"")+"'>";
      html += "<div class='ci-top'><span class='ci-phone'>"+(u.is_admin?"👑 ":"👤 ")+u.phone+"</span><span class='ci-bal'>"+fmtMoney(u.balance)+"</span></div>";
      html += "<div class='ci-stats'>🎮 "+u.games_played+" | 🏆 "+u.games_won+" | 💸 "+fmtMoney(u.total_spent)+" | 💰 "+fmtMoney(u.total_won)+"</div>";
      html += "<div class='ci-actions'><button class='btn-sm-blue' onclick='adminCreditUser("+u.id+",\""+u.phone+"\")'>💵 ስጥ</button>";
      html += (u.is_banned ? "<button class='btn-sm-gray' onclick='adminUnban("+u.id+",this)'>🔓 ፍታ</button>" : "<button class='btn-sm-red' onclick='adminBan("+u.id+",this)'>🚫 ታገድ</button>");
      html += "</div></div>";
    });
    el.innerHTML = html;
  });
}

function quickDep(id) {
  wTab("deposit");
  document.getElementById("depId").value = id;
}
function quickWdr(id) {
  wTab("withdraw");
  document.getElementById("wdrId").value = id;
}

// ============================================================
//  AUTH SYSTEM — Login / Register with phone + password
//  Stored in localStorage under "bingoUsers"
// ============================================================

var currentUser = null;

// ── Phone formatter ───────────────────────────────────────────
function fmtPhone(input) {
  var v = input.value.replace(/[^0-9+]/g, "");
  input.value = v;
}

// ── Auth tab toggle ───────────────────────────────────────────
function authTab(name) {
  document.querySelectorAll(".auth-tab").forEach(function(t) { t.classList.remove("active"); });
  document.querySelectorAll(".auth-panel").forEach(function(p) { p.classList.remove("active"); });
  document.getElementById("atab-" + name).classList.add("active");
  document.getElementById("apanel-" + name).classList.add("active");
  document.getElementById("loginError").classList.add("hidden");
  document.getElementById("registerError").classList.add("hidden");
}

// ── Show/hide password ────────────────────────────────────────
function togglePwd(inputId, btn) {
  var inp = document.getElementById(inputId);
  if (inp.type === "password") { inp.type = "text"; btn.textContent = "🙈"; }
  else { inp.type = "password"; btn.textContent = "👁"; }
}

// ── Show auth error ───────────────────────────────────────────
function showAuthError(elId, msg) {
  var el = document.getElementById(elId);
  el.textContent = "❌ " + msg;
  el.classList.remove("hidden");
}

// ── Customer ID popup shown after registration ────────────────
function showCustomerIdPopup(phone, isAdmin) {
  // Remove any existing popup
  var old = document.getElementById("customerIdPopup");
  if (old) old.remove();

  var overlay = document.createElement("div");
  overlay.id = "customerIdPopup";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;" +
    "align-items:center;justify-content:center;z-index:3000;padding:20px;";

  overlay.innerHTML =
    '<div style="background:#1e293b;border-radius:16px;padding:28px 24px;' +
    'max-width:340px;width:100%;text-align:center;border:2px solid #22c55e;' +
    'box-shadow:0 0 40px rgba(34,197,94,.3)">' +
      '<div style="font-size:48px;margin-bottom:8px">🎉</div>' +
      '<h2 style="color:#22c55e;margin-bottom:6px">እንኳን ደህና መጡ!</h2>' +
      '<p style="color:#94a3b8;font-size:.9rem;margin-bottom:18px">' +
        'ምዝገባዎ ተሳክቷል! ጨዋታ ለመጀመር ሂሳብዎን ይሙሉ።' +
      '</p>' +
      '<div style="background:#0f172a;border-radius:10px;padding:14px;margin-bottom:18px">' +
        '<div style="color:#94a3b8;font-size:.78rem;margin-bottom:4px">📱 ስልክ ቁጥር (Phone Number)</div>' +
        '<div id="cidDisplay" style="color:#f59e0b;font-size:1.4rem;font-weight:900;' +
          'letter-spacing:1px;word-break:break-all">' + phone + '</div>' +
        (isAdmin ? '<div style="color:#6366f1;font-size:.75rem;margin-top:6px">👑 አስተዳዳሪ</div>' : '') +
      '</div>' +
      '<p style="color:#94a3b8;font-size:.78rem;margin-bottom:18px">' +
        '⚠️ ይህን ስልክ ቁጥር ያስቀምጡ — ለገቢ እና ወጪ ያስፈልጋል' +
      '</p>' +
      '<button onclick="copyCid(\'' + phone + '\')" style="' +
        'width:100%;padding:12px;border:none;border-radius:10px;' +
        'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;' +
        'font-size:1rem;font-weight:700;cursor:pointer;margin-bottom:8px">' +
        '📋 ስልክ ቁጥር ቅዳ' +
      '</button>' +
      '<button onclick="document.getElementById(\'customerIdPopup\').remove()" style="' +
        'width:100%;padding:12px;border:none;border-radius:10px;' +
        'background:#334155;color:#f1f5f9;' +
        'font-size:1rem;font-weight:700;cursor:pointer">' +
        '✅ ገባኝ' +
      '</button>' +
    '</div>';

  document.body.appendChild(overlay);
}

function copyCid(phone) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(phone).then(function() {
      flashMessage("✅ ስልክ ቁጥር ተቀድቷል: " + phone, "#22c55e");
    });
  } else {
    var el = document.getElementById("cidDisplay");
    if (el) {
      var range = document.createRange();
      range.selectNode(el);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      document.execCommand("copy");
      window.getSelection().removeAllRanges();
    }
    flashMessage("✅ ስልክ ቁጥር ተቀድቷል: " + phone, "#22c55e");
  }
}

// ── Admin phone numbers & Telegram IDs ───────────────────────
var ADMIN_PHONES = ["0924787903", "+251924787903"];
// Admin Telegram user IDs (from BOT_USERNAME context)
var ADMIN_TG_IDS = ["7627811244", "1119881250"];

function isAdminPhone(phone) {
  var p = String(phone).replace(/\s/g, "");
  // Check phone numbers
  if (ADMIN_PHONES.indexOf(p) !== -1 ||
      ADMIN_PHONES.indexOf(p.replace(/^0/, "+251")) !== -1 ||
      ADMIN_PHONES.indexOf(p.replace(/^\+251/, "0")) !== -1) {
    return true;
  }
  // Check Telegram IDs (phone stored as "tg_<id>")
  if (p.startsWith("tg_")) {
    var tgId = p.replace("tg_", "");
    if (ADMIN_TG_IDS.indexOf(tgId) !== -1) return true;
  }
  return false;
}

// ── Auto-login — Telegram WebApp or show login screen ────────
function autoLogin() {
  // 1. Try existing token first
  var token = getToken();
  if (token) {
    apiCall("GET", "/auth/me", null, function(err, data) {
      if (data && data.ok) {
        loginSuccess(data.user);
      } else {
        clearToken();
        clearPanelToken();
        _tryTelegramLogin();
      }
    });
    return;
  }
  _tryTelegramLogin();
}

function _tryTelegramLogin() {
  // Try Telegram auto-login
  var tg     = window.Telegram && window.Telegram.WebApp;
  var tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;

  if (tgUser) {
    // Auto-login with Telegram ID
    var phone = "tg_" + tgUser.id;
    var name  = ((tgUser.first_name || "") + (tgUser.last_name ? " " + tgUser.last_name : "")).trim()
                || tgUser.username || phone;
    var pass  = "tg_" + tgUser.id + "_bingo";

    apiCall("POST", "/auth/login", { phone: phone, password: pass }, function(err, data) {
      if (data && data.ok) {
        setToken(data.token);
        loginSuccess(data.user);
      } else {
        // Register new Telegram user
        apiCall("POST", "/auth/register", { phone: phone, password: pass, full_name: name }, function(err2, data2) {
          if (data2 && data2.ok) {
            setToken(data2.token);
            loginSuccess(data2.user);
          } else {
            // Show login screen as fallback
            showScreen("loginScreen");
          }
        });
      }
    });
  } else {
    // No Telegram — show login screen
    showScreen("loginScreen");
  }
}

// ── Login success ─────────────────────────────────────────────
function loginSuccess(user) {
  currentUser = user;
  currentUser.isAdmin = user.is_admin === 1 || user.is_admin === true || isAdminPhone(user.phone);
  currentUser.name    = user.full_name || user.phone;
  currentUser.phone   = user.phone;
  currentUser.balance = user.balance || 0;

  localStorage.setItem("bingoSession", getToken());
  _applyUserToUI();

  // Auto-get panel token for admin
  if (currentUser.isAdmin && !getPanelToken()) {
    apiCall("POST", "/admin/panel-login",
      { password: ADMIN_PANEL_PWD },
      function(err, data) {
        if (data && data.ok) {
          setPanelToken(data.token);
          updatePendingBadge();
        }
      }
    );
  }

  showScreen("mainMenu");
}

function _applyUserToUI() {
  var nameEl = document.getElementById("userBarName");
  var phoneEl = document.getElementById("userBarPhone");
  var balEl  = document.getElementById("userBarBalance");
  var adminBtn = document.getElementById("adminPanelBtn_menu");
  if (nameEl)  nameEl.textContent  = currentUser.name  || currentUser.phone;
  if (phoneEl) phoneEl.textContent = currentUser.phone;
  if (balEl)   balEl.textContent   = fmtMoney(currentUser.balance);
  if (adminBtn) adminBtn.style.display = currentUser.isAdmin ? "" : "none";
  updateFooterBalances();
}

function updateFooterBalances() {
  if (!currentUser) return;
  var footerBal = document.getElementById("footerBalance");
  var footerLive = document.getElementById("footerLiveBalance");
  var value = fmtMoney(currentUser.balance || 0);
  if (footerBal)  footerBal.textContent  = value;
  if (footerLive) footerLive.textContent = value;
}

// ── Logout — just re-run auto-login (no login screen) ────────
function doLogout() {
  var dialog = document.getElementById("logoutDialog");
  var nameEl = document.getElementById("logoutUserName");
  if (nameEl) nameEl.textContent = currentUser ? (currentUser.name || currentUser.phone) : "—";
  if (dialog) dialog.classList.remove("hidden");
}

function confirmLogout() {
  var dialog = document.getElementById("logoutDialog");
  if (dialog) dialog.classList.add("hidden");

  clearToken();
  clearPanelToken();
  localStorage.removeItem("bingoSession");
  currentUser = null;

  var adminBtn = document.getElementById("adminPanelBtn_menu");
  if (adminBtn) adminBtn.style.display = "none";

  // Clear login form
  var lp = document.getElementById("loginPhone"); if (lp) lp.value = "";
  var lpass = document.getElementById("loginPass"); if (lpass) lpass.value = "";
  var le = document.getElementById("loginError"); if (le) le.classList.add("hidden");

  showScreen("loginScreen");
  flashMessage("👋 ወጥተዋል", "#6366f1");
}

function cancelLogout() {
  var dialog = document.getElementById("logoutDialog");
  if (dialog) dialog.classList.add("hidden");
}

// ── Legacy stubs (kept for compatibility) ────────────────────
function checkSession() { autoLogin(); }

// ── Real login/register (phone + password) ───────────────────
function doLogin() {
  var phone = (document.getElementById("loginPhone") ? document.getElementById("loginPhone").value : "").trim();
  var pass  = (document.getElementById("loginPass")  ? document.getElementById("loginPass").value  : "");
  var errEl = document.getElementById("loginError");
  if (errEl) errEl.classList.add("hidden");

  if (!phone) { showAuthError("loginError", "ስልክ ቁጥር ያስገቡ"); return; }
  if (!pass)  { showAuthError("loginError", "የይለፍ ቃል ያስገቡ"); return; }

  var btn = document.getElementById("loginSubmitBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ እየተሰራ..."; }

  apiCall("POST", "/auth/login", { phone: phone, password: pass }, function(err, data) {
    if (btn) { btn.disabled = false; btn.textContent = "🔑 ግባ"; }
    if (err || !data || !data.ok) {
      showAuthError("loginError", data ? data.msg : "ኔትወርክ ስህተት");
      return;
    }
    setToken(data.token);
    loginSuccess(data.user);
  });
}

function doRegisterAuth() {
  var phone = (document.getElementById("regPhone")  ? document.getElementById("regPhone").value  : "").trim();
  var pass  = (document.getElementById("regPass")   ? document.getElementById("regPass").value   : "");
  var pass2 = (document.getElementById("regPass2")  ? document.getElementById("regPass2").value  : "");
  var errEl = document.getElementById("registerError");
  if (errEl) errEl.classList.add("hidden");

  if (!phone || phone.length < 10) { showAuthError("registerError", "ትክክለኛ ስልክ ቁጥር ያስገቡ"); return; }
  if (pass.length < 4)             { showAuthError("registerError", "የይለፍ ቃል ቢያንስ 4 ቁጥር"); return; }
  if (pass !== pass2)              { showAuthError("registerError", "የይለፍ ቃሎቹ አይዛመዱም"); return; }

  var btn = document.getElementById("regSubmitBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ እየተሰራ..."; }

  apiCall("POST", "/auth/register", { phone: phone, password: pass, full_name: phone }, function(err, data) {
    if (btn) { btn.disabled = false; btn.textContent = "✨ ምዝገባ"; }
    if (err || !data || !data.ok) {
      // If already registered — auto-login with same credentials
      if (data && (data.msg || "").indexOf("ቀድሞ") !== -1) {
        apiCall("POST", "/auth/login", { phone: phone, password: pass }, function(err2, data2) {
          if (data2 && data2.ok) {
            setToken(data2.token);
            loginSuccess(data2.user);
          } else {
            showAuthError("registerError", "ቀድሞ ተመዝግቧል — ትክክለኛ የይለፍ ቃል ያስገቡ");
            authTab("login");
            var lp = document.getElementById("loginPhone");
            if (lp) lp.value = phone;
          }
        });
        return;
      }
      showAuthError("registerError", data ? data.msg : "ኔትወርክ ስህተት");
      return;
    }
    setToken(data.token);
    loginSuccess(data.user);
  });
}

function authTab(name) {
  document.querySelectorAll(".auth-tab").forEach(function(t){ t.classList.remove("active"); });
  document.querySelectorAll(".auth-panel").forEach(function(p){ p.classList.remove("active"); });
  var tab = document.getElementById("atab-" + name);
  var panel = document.getElementById("apanel-" + name);
  if (tab)   tab.classList.add("active");
  if (panel) panel.classList.add("active");
  var le = document.getElementById("loginError");    if (le) le.classList.add("hidden");
  var re = document.getElementById("registerError"); if (re) re.classList.add("hidden");
}

function showAuthError(elId, msg) {
  var el = document.getElementById(elId);
  if (!el) return;
  el.textContent = "❌ " + msg;
  el.classList.remove("hidden");
}

// ── Update balance bar whenever wallet changes ────────────────
function refreshUserBar() {
  if (!currentUser) return;
  apiCall("GET", "/wallet/balance", null, function(err, data) {
    if (err || !data || !data.ok) return;
    currentUser.balance = data.balance;
    var el = document.getElementById("userBarBalance");
    if (el) el.textContent = fmtMoney(data.balance);
    updateFooterBalances();
  });
}

// ── Refresh account screen in-place ──────────────────────────
function refreshAccountScreen() {
  if (!currentUser) return;
  getUserDashboard(currentUser.phone, function(dash) {
    if (!dash) return;
    function setTxt(id, val) { var e = document.getElementById(id); if (e) e.textContent = val; }
    setTxt("accBalance",     fmtMoney(dash.balance));
    setTxt("accWdrBal",      fmtMoney(dash.balance));
    setTxt("accGamesPlayed", dash.stats.gamesPlayed);
    setTxt("accGamesWon",    dash.stats.gamesWon);
    setTxt("accTotalWon",    fmtMoney(dash.stats.totalWon));
    setTxt("userBarBalance", fmtMoney(dash.balance));
    currentUser.balance = dash.balance;
    try { renderAccHistory(dash.history); } catch(e) {}
  });
}


// ============================================================
//  MY ACCOUNT — Deposit (TeleBirr/CBE/Awash), Withdraw, History
// ============================================================

var selectedPayMethod = "telebirr";
var selectedWdrMethod = "telebirr";

function openMyAccount() {
  if (!currentUser) { flashMessage("❌ ይግቡ", "#ef4444"); return; }

  // Show screen first with loading state
  document.getElementById("accPhone").textContent   = currentUser.phone;
  document.getElementById("accBalance").textContent = fmtMoney(currentUser.balance || 0);
  document.getElementById("accWdrBal").textContent  = fmtMoney(currentUser.balance || 0);
  accTab("deposit");
  showScreen("myAccountScreen");

  // Then load fresh data from backend
  getUserDashboard(currentUser.phone, function(dash) {
    if (!dash) return;
    document.getElementById("accBalance").textContent = fmtMoney(dash.balance);
    document.getElementById("accWdrBal").textContent  = fmtMoney(dash.balance);
    document.getElementById("accGamesPlayed").textContent = dash.stats.gamesPlayed;
    document.getElementById("accGamesWon").textContent    = dash.stats.gamesWon;
    document.getElementById("accTotalWon").textContent    = fmtMoney(dash.stats.totalWon);
    currentUser.balance = dash.balance;
    renderAccHistory(dash.history);
  });

  // Clear inputs
  document.getElementById("accDepAmount").value = "";
  document.getElementById("accDepTxId").value   = "";
  document.getElementById("accWdrAmount").value  = "";
  document.getElementById("accWdrAccount").value = "";
  document.getElementById("accDepMsg").classList.add("hidden");
  document.getElementById("accWdrMsg").classList.add("hidden");
}

function accTab(name) {
  document.querySelectorAll(".acc-tab").forEach(function(t){ t.classList.remove("active"); });
  document.querySelectorAll(".acc-panel").forEach(function(p){ p.classList.remove("active"); });
  document.getElementById("acctab-" + name).classList.add("active");
  document.getElementById("accpanel-" + name).classList.add("active");
}

function selectPayMethod(method) {
  selectedPayMethod = method;
  ["telebirr","cbe","awash","cash"].forEach(function(m) {
    var btn = document.getElementById("pm-" + m);
    var inf = document.getElementById("pm-info-" + m);
    if (btn) btn.classList.toggle("active", m === method);
    if (inf) inf.classList.toggle("hidden", m !== method);
  });
}

function selectWdrMethod(method) {
  selectedWdrMethod = method;
  ["telebirr","cbe","awash"].forEach(function(m) {
    var btn = document.getElementById("wpm-" + m);
    if (btn) btn.classList.toggle("active", m === method);
  });
}

function setAccAmt(v) { document.getElementById("accDepAmount").value = v; }
function setAccWdr(v) { document.getElementById("accWdrAmount").value = v; }

function showAccMsg(elId, ok, msg) {
  var el = document.getElementById(elId);
  el.textContent = (ok ? "✅ " : "❌ ") + msg;
  el.className = "acc-msg " + (ok ? "acc-msg-ok" : "acc-msg-err");
}

// ── Deposit request ───────────────────────────────────────────
function doAccDeposit() {
  if (!currentUser) return;
  var amount = parseFloat(document.getElementById("accDepAmount").value);
  var txId   = document.getElementById("accDepTxId").value.trim();

  if (isNaN(amount) || amount < 1) { showAccMsg("accDepMsg", false, "ትክክለኛ መጠን ያስገቡ"); return; }
  if (!txId)                        { showAccMsg("accDepMsg", false, "የTeleBirr ማስተላለፊያ ቁጥር ያስገቡ"); return; }

  var btn = document.querySelector(".btn-deposit.acc-submit");
  if (btn) { btn.disabled = true; btn.textContent = "⏳..."; }

  showAccMsg("accDepMsg", true, "⏳ እየተሰራ ነው...");

  apiCall("POST", "/wallet/deposit/request", { amount: amount, tx_id: txId }, function(err, data) {
    if (btn) { btn.disabled = false; btn.textContent = "💵 ገቢ ጠይቅ"; }
    if (err || !data || !data.ok) {
      showAccMsg("accDepMsg", false, data ? data.msg : "ኔትወርክ ስህተት");
      return;
    }
    showAccMsg("accDepMsg", true,
      "✅ ጥያቄ ተልኳል! " + fmtMoney(amount) + " — TXN: " + txId +
      "\n⏳ አስተዳዳሪ ሲያረጋግጥ ሂሳብዎ ይጨምራል");
    document.getElementById("accDepAmount").value = "";
    document.getElementById("accDepTxId").value   = "";
    SFX.number();
    // Refresh history to show pending request
    setTimeout(function() { refreshAccountScreen(); }, 500);
  });
}

// ── Withdraw request ──────────────────────────────────────────
function doAccWithdraw() {
  if (!currentUser) return;
  var amount  = parseFloat(document.getElementById("accWdrAmount").value);
  var account = document.getElementById("accWdrAccount").value.trim();

  if (isNaN(amount) || amount < 10) { showAccMsg("accWdrMsg", false, "ዝቅተኛ ማውጫ 10 ብር ነው"); return; }
  if (!account)                      { showAccMsg("accWdrMsg", false, "የሂሳብ ቁጥር ያስገቡ"); return; }

  var btn = document.querySelector(".btn-withdraw.acc-submit");
  if (btn) { btn.disabled = true; btn.textContent = "⏳..."; }

  showAccMsg("accWdrMsg", true, "⏳ እየተሰራ ነው...");

  apiCall("POST", "/wallet/withdraw/request", {
    amount:         amount,
    account_type:   selectedWdrMethod || "telebirr",
    account_number: account
  }, function(err, data) {
    if (btn) { btn.disabled = false; btn.textContent = "💸 ወጪ ጠይቅ"; }
    if (err || !data || !data.ok) {
      showAccMsg("accWdrMsg", false, data ? data.msg : "ኔትወርክ ስህተት");
      return;
    }
    showAccMsg("accWdrMsg", true,
      "✅ " + fmtMoney(amount) + " ወጪ ጥያቄ ተልኳል → " + (selectedWdrMethod || "telebirr") + " " + account +
      "\n⚠️ ሂሳብዎ ቀድሞ ተቀንሷል — አስተዳዳሪ ሲያረጋግጥ ይላካል");
    document.getElementById("accWdrAmount").value  = "";
    document.getElementById("accWdrAccount").value = "";
    SFX.number();
    // Refresh balance and history immediately (balance already deducted)
    setTimeout(function() { refreshAccountScreen(); refreshUserBar(); }, 500);
  });
}

// ── Admin: render pending deposit requests ────────────────────
// NOTE: renderPendingRequests, approveRequest, rejectRequest are defined in wallet.js
// adminApprove/adminReject below are legacy local-storage wrappers — they delegate to wallet.js

function adminApprove(reqId) {
  // Delegate to wallet.js approveRequest
  approveRequest("deposit", parseInt(reqId), { disabled: false });
}

function adminReject(reqId) {
  rejectRequest("deposit", parseInt(reqId), { disabled: false });
}

// ── History render ────────────────────────────────────────────
// NOTE: renderAccHistory is defined in wallet.js — this is a no-op stub
// to prevent "function not defined" errors from old references

// ============================================================
//  INVITE LINK
// ============================================================

function buildInviteLink() {
  // Use current page URL as the base invite link
  var base = window.location.href.split('?')[0].split('#')[0];
  return base + '?invite=1';
}

function initInviteLink() {
  var input = document.getElementById("inviteLinkInput");
  if (input) input.value = buildInviteLink();
}

function copyInviteLink() {
  var link = buildInviteLink();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(function() {
      flashMessage("✅ ሊንክ ተቀድቷል!", "#22c55e");
    });
  } else {
    // Fallback for older browsers
    var input = document.getElementById("inviteLinkInput");
    if (input) { input.select(); document.execCommand("copy"); }
    flashMessage("✅ ሊንክ ተቀድቷል!", "#22c55e");
  }
}

function shareInviteLink() {
  var link = buildInviteLink();
  var text = "🎯 አማርኛ ቢንጎ ጨዋታ ይቀላቀሉ! " + link;
  if (navigator.share) {
    navigator.share({ title: "አማርኛ ቢንጎ", text: "ጨዋታ ይቀላቀሉ!", url: link })
      .catch(function() {});
  } else {
    // Fallback: open WhatsApp share
    var wa = "https://wa.me/?text=" + encodeURIComponent(text);
    window.open(wa, "_blank");
  }
}

function shareWinResult() {
  var msg = document.getElementById("winMessage");
  var text = "🏆 " + (msg ? msg.textContent : "ቢንጎ አሸነፍኩ!") + " — " + buildInviteLink();
  if (navigator.share) {
    navigator.share({ title: "ቢንጎ አሸነፍኩ!", text: text, url: buildInviteLink() })
      .catch(function() {});
  } else {
    var wa = "https://wa.me/?text=" + encodeURIComponent(text);
    window.open(wa, "_blank");
  }
}

// Init invite link when game screen opens
var _origShowScreen = showScreen;
showScreen = function(id) {
  _origShowScreen(id);
  if (id === "gameScreen") {
    initInviteLink();
    initChat();
  }
};

// ============================================================
//  LIVE CHAT / COMMENT SECTION
//  Stored in localStorage so all tabs on same device share it
// ============================================================

var chatMessages = [];
var chatKey      = "bingoChatMessages";
var chatPollTimer = null;

var CHAT_EMOJIS = ["😊","🎉","🔥","👏","😂","❤️","😮","🏆","🎯","💪"];

function chatLoad() {
  try { return JSON.parse(localStorage.getItem(chatKey) || "[]"); } catch(e) { return []; }
}
function chatSave(msgs) {
  // Keep last 100 messages
  if (msgs.length > 100) msgs = msgs.slice(-100);
  localStorage.setItem(chatKey, JSON.stringify(msgs));
}

function initChat() {
  chatMessages = chatLoad();
  renderChat();
  // Poll for new messages every 2 seconds (simulates real-time for same device)
  clearInterval(chatPollTimer);
  chatPollTimer = setInterval(function() {
    var fresh = chatLoad();
    if (fresh.length !== chatMessages.length) {
      chatMessages = fresh;
      renderChat();
    }
  }, 2000);
}

function renderChat() {
  var el = document.getElementById("chatMessages");
  if (!el) return;

  if (chatMessages.length === 0) {
    el.innerHTML = '<div class="chat-empty">💬 ውይይቱን ይጀምሩ...</div>';
    return;
  }

  var html = "";
  chatMessages.slice(-50).forEach(function(m) {
    var isMe = currentUser && m.phone === currentUser.phone;
    html +=
      '<div class="chat-msg ' + (isMe ? "chat-msg-me" : "chat-msg-other") + '">' +
        '<div class="chat-bubble">' +
          '<span class="chat-name">' + escapeHtml(m.name) + '</span>' +
          '<span class="chat-text">' + escapeHtml(m.text) + '</span>' +
          '<span class="chat-time">' + m.time + '</span>' +
        '</div>' +
      '</div>';
  });
  el.innerHTML = html;
  // Scroll to bottom
  el.scrollTop = el.scrollHeight;
}

function sendChatMsg() {
  var input = document.getElementById("chatInput");
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;

  var name = currentUser ? (currentUser.name || currentUser.phone) : "ጎብኚ";
  var phone = currentUser ? currentUser.phone : "guest";

  var msg = {
    id:    Date.now(),
    phone: phone,
    name:  name,
    text:  text,
    time:  new Date().toLocaleTimeString("am-ET", { hour:"2-digit", minute:"2-digit" })
  };

  chatMessages = chatLoad();
  chatMessages.push(msg);
  chatSave(chatMessages);
  renderChat();
  input.value = "";
  input.focus();
}

function sendReaction(emoji) {
  var name  = currentUser ? (currentUser.name || currentUser.phone) : "ጎብኚ";
  var phone = currentUser ? currentUser.phone : "guest";

  var msg = {
    id:    Date.now(),
    phone: phone,
    name:  name,
    text:  emoji,
    time:  new Date().toLocaleTimeString("am-ET", { hour:"2-digit", minute:"2-digit" })
  };

  chatMessages = chatLoad();
  chatMessages.push(msg);
  chatSave(chatMessages);
  renderChat();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

// Hook into number announcements to post to chat — REMOVED
// Chat is for user messages only


// ============================================================
//  VOICE RECOGNITION — Amharic speech input for chat
//  Also listens for "ቢንጎ" keyword to trigger declareBingo()
// ============================================================

var _chatRecognition  = null;
var _chatMicActive    = false;

// Amharic keywords that trigger bingo declaration
var BINGO_KEYWORDS = ["ቢንጎ", "bingo", "BINGO"];

function isSpeechSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function toggleChatMic() {
  if (!isSpeechSupported()) {
    flashMessage("❌ ይህ ብሮውዘር ድምፅ ማወቂያ አይደግፍም", "#ef4444");
    return;
  }
  if (_chatMicActive) {
    stopChatMic();
  } else {
    startChatMic();
  }
}

function startChatMic() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  _chatRecognition = new SR();

  _chatRecognition.lang          = "am-ET";
  _chatRecognition.continuous    = false;   // single utterance
  _chatRecognition.interimResults = true;   // show partial results while speaking

  _chatMicActive = true;
  _updateMicBtn(true);

  var input = document.getElementById("chatInput");
  if (input) {
    input.placeholder = "🎤 እየሰማ ነው...";
    input.style.borderColor = "#ef4444";
  }

  // ── Interim results — show live in input box ──────────────
  _chatRecognition.onresult = function(event) {
    var interim = "";
    var final   = "";
    for (var i = event.resultIndex; i < event.results.length; i++) {
      var t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t;
      else interim += t;
    }

    if (input) input.value = final || interim;

    // Auto-trigger bingo if keyword spoken
    if (final) {
      var lower = final.trim().toLowerCase();
      for (var k = 0; k < BINGO_KEYWORDS.length; k++) {
        if (lower.indexOf(BINGO_KEYWORDS[k].toLowerCase()) !== -1) {
          stopChatMic();
          if (input) input.value = "";
          flashMessage("🏆 ቢንጎ ተጠራ!", "#f59e0b");
          declareBingo();
          return;
        }
      }
    }
  };

  // ── End — send whatever was captured ─────────────────────
  _chatRecognition.onend = function() {
    _chatMicActive = false;
    _updateMicBtn(false);
    if (input) {
      input.style.borderColor = "";
      input.placeholder = "መልዕክት ይጻፉ...";
    }
    // Auto-send if there's text
    var text = input ? input.value.trim() : "";
    if (text) sendChatMsg();
  };

  // ── Error handling ────────────────────────────────────────
  _chatRecognition.onerror = function(e) {
    _chatMicActive = false;
    _updateMicBtn(false);
    if (input) {
      input.style.borderColor = "";
      input.placeholder = "መልዕክት ይጻፉ...";
    }
    var msgs = {
      "not-allowed":  "❌ ማይክሮፎን ፈቃድ ያስፈልጋል",
      "no-speech":    "🎤 ምንም ድምፅ አልተሰማም",
      "network":      "❌ የኔትወርክ ስህተት",
      "aborted":      ""   // user cancelled — silent
    };
    var msg = msgs[e.error] || ("❌ ስህተት: " + e.error);
    if (msg) flashMessage(msg, "#ef4444");
  };

  try {
    _chatRecognition.start();
  } catch(e) {
    _chatMicActive = false;
    _updateMicBtn(false);
    flashMessage("❌ ድምፅ ማወቂያ መጀመር አልተቻለም", "#ef4444");
  }
}

function stopChatMic() {
  if (_chatRecognition) {
    try { _chatRecognition.stop(); } catch(e) {}
    _chatRecognition = null;
  }
  _chatMicActive = false;
  _updateMicBtn(false);
  var input = document.getElementById("chatInput");
  if (input) {
    input.style.borderColor = "";
    input.placeholder = "መልዕክት ይጻፉ...";
  }
}

function _updateMicBtn(active) {
  var btn = document.getElementById("chatMicBtn");
  if (!btn) return;
  if (active) {
    btn.textContent = "⏹";
    btn.style.background = "#ef4444";
    btn.style.animation  = "mic-pulse 1s ease-in-out infinite";
  } else {
    btn.textContent = "🎤";
    btn.style.background = "";
    btn.style.animation  = "";
  }
}

// ============================================================
//  VOICE STATUS CHECK
//  Shows green/yellow/red indicator so user knows if voice works
// ============================================================

function setVoiceStatus(state, msg) {
  // state: 'ok' | 'warn' | 'error' | 'checking'
  var dot   = document.getElementById("voiceDot");
  var label = document.getElementById("voiceStatusLabel");
  var bar   = document.getElementById("voiceStatusBar");
  if (!dot || !label) return;

  var icons  = { ok:"🟢", warn:"🟡", error:"🔴", checking:"⚪" };
  var colors = { ok:"#22c55e", warn:"#f59e0b", error:"#ef4444", checking:"#94a3b8" };

  dot.textContent   = icons[state]  || "⚪";
  label.textContent = msg;
  if (bar) bar.style.borderColor = colors[state] || "#334155";
}

function runVoiceCheck() {
  setVoiceStatus("checking", "ድምፅ እየፈተሸ ነው...");

  // 1. Check API support
  if (!window.speechSynthesis) {
    setVoiceStatus("error", "❌ ይህ ብሮውዘር ድምፅ አይደግፍም — Chrome ይጠቀሙ");
    return;
  }

  // 2. Check if voices are loaded
  var voices = window.speechSynthesis.getVoices();

  if (voices.length === 0) {
    // Voices not loaded yet — wait and retry
    setVoiceStatus("warn", "⏳ ድምፅ እየጫነ ነው...");
    window.speechSynthesis.onvoiceschanged = function() {
      window.speechSynthesis.onvoiceschanged = null;
      runVoiceCheck(); // retry
    };
    return;
  }

  // 3. Check for Amharic voice
  var amVoice = voices.find(function(v){ return v.lang === "am-ET"; })
             || voices.find(function(v){ return v.lang.startsWith("am"); });

  // 4. Speak a test number and detect if it actually played
  var didSpeak = false;
  var u = new SpeechSynthesisUtterance("ቁጥር ቢ አስራ ሁለት");
  u.lang   = "am-ET";
  u.rate   = 0.85;
  u.volume = 1.0;
  if (amVoice) u.voice = amVoice;

  u.onstart = function() {
    didSpeak = true;
    if (amVoice) {
      setVoiceStatus("ok", "✅ ድምፅ ይሰራል — " + amVoice.name);
    } else {
      setVoiceStatus("warn", "🟡 ድምፅ ይሰራል (አማርኛ ድምፅ የለም — ነባሪ ድምፅ)");
    }
  };

  u.onerror = function(e) {
    setVoiceStatus("error", "❌ ድምፅ አልሰራም — " + (e.error || "unknown"));
  };

  // If onstart never fires within 3s, mark as failed
  var timeout = setTimeout(function() {
    if (!didSpeak) {
      setVoiceStatus("error",
        "❌ ድምፅ አልሰራም — ገጹን ጠቅ አድርገው እንደገና ይሞክሩ");
    }
  }, 3000);

  u.onend = function() { clearTimeout(timeout); };

  window.speechSynthesis.cancel();
  setTimeout(function() {
    window.speechSynthesis.speak(u);
  }, 100);
}

// Auto-run check when game screen opens
var _origGoToGame = launchGame;
launchGame = function() {
  _origGoToGame.apply(this, arguments);
  setTimeout(runVoiceCheck, 2000); // check 2s after game starts
};
