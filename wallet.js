// ============================================================
//  WALLET SYSTEM — MySQL Backend API
//  All data stored in MySQL via backend REST API
//  Base URL: http://localhost:3001/api
// ============================================================

var ENTRY_FEE = 1;
var CURRENCY  = "ብር";

// ── API Base URL ──────────────────────────────────────────────
// When served via ngrok (Telegram WebApp), the frontend and backend
// share the same ngrok tunnel — so we use relative /api path.
// When served locally (localhost:3001), also use relative /api.
// This works because backend serves the frontend via express.static.
var API_BASE = (function() {
  var h = window.location.hostname;
  var p = window.location.port;
  var proto = window.location.protocol;

  // file:// — opened directly from disk
  if (proto === "file:" || !h) {
    return "http://localhost:3001/api";
  }
  // Served from localhost:3001 (backend serves frontend)
  if ((h === "localhost" || h === "127.0.0.1") && p === "3001") {
    return "/api";
  }
  // Served from localhost on any other port (e.g. live-server)
  if (h === "localhost" || h === "127.0.0.1") {
    return "http://localhost:3001/api";
  }
  // Served from ngrok or any remote host — backend is on same host, no port
  // (ngrok tunnels port 3001 → https://xxx.ngrok-free.app with no port)
  return proto + "//" + h + "/api";
})();
var ADMIN_PANEL_PWD = "mebt1234"; // must match backend ADMIN_PANEL_PASSWORD

// ── Auth token ────────────────────────────────────────────────
function getToken() {
  return localStorage.getItem("bingoToken") || "";
}
function setToken(t) {
  localStorage.setItem("bingoToken", t);
}
function clearToken() {
  localStorage.removeItem("bingoToken");
}

// ── Admin panel token ─────────────────────────────────────────
function getPanelToken() {
  return localStorage.getItem("adminPanelToken") || "";
}
function setPanelToken(t) {
  localStorage.setItem("adminPanelToken", t);
}
function clearPanelToken() {
  localStorage.removeItem("adminPanelToken");
}

// ── Format money ──────────────────────────────────────────────
function fmtMoney(n) {
  return parseFloat(n || 0).toFixed(2) + " " + CURRENCY;
}

// ── Generic API call ──────────────────────────────────────────
function apiCall(method, path, body, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open(method, API_BASE + path, true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("ngrok-skip-browser-warning", "true");
  var token = getToken();
  if (token) xhr.setRequestHeader("Authorization", "Bearer " + token);
  // Attach admin panel token for /admin/* routes
  if (path.indexOf("/admin/") === 0) {
    var panelToken = getPanelToken();
    if (panelToken) xhr.setRequestHeader("X-Admin-Panel", panelToken);
  }
  xhr.onload = function() {
    try {
      var data = JSON.parse(xhr.responseText);
      // Auto-logout on invalid/expired token (but not on login/register calls)
      if (xhr.status === 401 && path !== "/auth/login" && path !== "/auth/register" && path !== "/admin/panel-login") {
        clearToken();
        localStorage.removeItem("bingoSession");
        currentUser = null;
        // Only redirect to login if not already there
        var ls = document.getElementById("loginScreen");
        if (ls && !ls.classList.contains("active")) {
          document.getElementById("loginPhone") && (document.getElementById("loginPhone").value = "");
          document.getElementById("loginPass")  && (document.getElementById("loginPass").value  = "");
          document.getElementById("loginError") && document.getElementById("loginError").classList.add("hidden");
          showScreen("loginScreen");
          flashMessage("⚠️ ክፍለ ጊዜ አልቋል። እንደገና ይግቡ።", "#f59e0b");
        }
        callback(null, data);
        return;
      }
      callback(null, data);
    } catch(e) {
      callback({ msg: "Server error" }, null);
    }
  };
  xhr.onerror = function() {
    callback({ msg: "❌ ኔትወርክ ስህተት\n\nBackend (" + API_BASE + ") ምላሽ አልሰጠም።\n\n✅ መፍትሄ:\n1. start-backend.bat ያስጀምሩ\n2. XAMPP MySQL ይሰራ እንደሆነ ያረጋግጡ\n3. http://localhost:3001/api/health ይፈትሹ" }, null);
  };
  xhr.ontimeout = function() {
    callback({ msg: "⏱ ጊዜ አልቋል — Backend ምላሽ አልሰጠም" }, null);
  };
  xhr.timeout = 15000; // 15 second timeout
  xhr.send(body ? JSON.stringify(body) : null);
}

// ── Reactive UI refresh ───────────────────────────────────────
function onWalletChange() {
  try { if (typeof refreshUserBar === "function") refreshUserBar(); } catch(e) {}
  try {
    var acc = document.getElementById("myAccountScreen");
    if (acc && acc.classList.contains("active")) {
      if (typeof refreshAccountScreen === "function") refreshAccountScreen();
    }
  } catch(e) {}
  try { if (typeof updatePendingBadge === "function") updatePendingBadge(); } catch(e) {}
}

// ── Deduct entry fee (calls backend) ─────────────────────────
function deductEntryFee(phone, numCards, callback) {
  var total = ENTRY_FEE * (numCards || 1);

  // If no user logged in, allow free play
  if (!currentUser || !getToken()) {
    callback({ ok: true, after: 0 });
    return;
  }

  // Check balance first
  apiCall("GET", "/wallet/balance", null, function(err, data) {
    if (err || !data || !data.ok) {
      // Network error — allow play but warn
      console.warn("Balance check failed, allowing play:", err);
      callback({ ok: true, after: 0 });
      return;
    }

    if (data.balance < total) {
      callback({
        ok: false,
        msg: "ቀሪ ሂሳብ " + fmtMoney(data.balance) + " ነው። " + fmtMoney(total) + " ያስፈልጋል። ሂሳብዎን ይሙሉ።"
      });
      return;
    }

    // Deduct via game-fee endpoint
    apiCall("POST", "/wallet/game-fee", { amount: total, note: numCards + " ካርድ ክፍያ" }, function(err2, data2) {
      if (err2 || !data2 || !data2.ok) {
        // Endpoint failed — still allow play (balance was confirmed above)
        callback({ ok: true, after: data.balance - total });
        onWalletChange();
        return;
      }
      callback({ ok: true, after: data2.balance });
      onWalletChange();
    });
  });
}

// ── Add prize (calls backend) ─────────────────────────────────
function addPrize(phone, amount, callback) {
  if (!amount || amount <= 0) { if (callback) callback({ ok: false }); return; }
  apiCall("POST", "/wallet/game-prize", { amount: amount, note: "ቢንጎ ሽልማት" }, function(err, data) {
    if (data && data.ok) onWalletChange();
    if (callback) callback(data || { ok: false });
  });
}

// ── Get customer (returns cached currentUser data) ────────────
function getCustomer(id) {
  if (!currentUser) return null;
  // Match by phone
  var p = String(id).replace(/\s/g, "");
  var cp = String(currentUser.phone || "").replace(/\s/g, "");
  if (p === cp || p.replace(/^0/, "+251") === cp || p === cp.replace(/^0/, "+251")) {
    return {
      id:      currentUser.phone,
      name:    currentUser.full_name || currentUser.phone,
      balance: currentUser.balance || 0
    };
  }
  return null;
}

// ── Get user dashboard (from backend) ────────────────────────
function getUserDashboard(phone, callback) {
  apiCall("GET", "/wallet/balance", null, function(err, balData) {
    if (err || !balData || !balData.ok) {
      if (callback) callback(null);
      return;
    }
    apiCall("GET", "/wallet/history?limit=30", null, function(err2, histData) {
      var history = (histData && histData.transactions) ? histData.transactions : [];
      var dash = {
        id:      currentUser ? currentUser.phone : phone,
        name:    currentUser ? (currentUser.full_name || currentUser.phone) : phone,
        phone:   currentUser ? currentUser.phone : phone,
        balance: balData.balance,
        stats: {
          gamesPlayed: balData.games_played || 0,
          gamesWon:    balData.games_won    || 0,
          totalSpent:  balData.total_spent  || 0,
          totalWon:    balData.total_won    || 0
        },
        history: history.map(function(t) {
          return {
            id:      t.id,
            type:    t.type,
            amount:  t.amount,
            note:    t.note || "",
            date:    t.created_at,
            before:  t.balance_before,
            balance: t.balance_after
          };
        })
      };
      if (callback) callback(dash);
    });
  });
}

// ── Pending requests (deposit/withdraw) ──────────────────────
function getPendingRequests(callback) {
  // Fetch from backend
  apiCall("GET", "/admin/deposits/pending", null, function(err, depData) {
    apiCall("GET", "/admin/withdrawals/pending", null, function(err2, wdrData) {
      var deps = (depData && depData.requests) ? depData.requests.map(function(r) {
        return { id: r.id, type: "deposit", phone: r.phone, name: r.full_name,
                 amount: r.amount, txId: r.tx_id, status: r.status, date: r.created_at };
      }) : [];
      var wdrs = (wdrData && wdrData.requests) ? wdrData.requests.map(function(r) {
        return { id: r.id, type: "withdraw", phone: r.phone, name: r.full_name,
                 amount: r.amount, account: r.account_number, method: r.account_type,
                 status: r.status, date: r.created_at };
      }) : [];
      if (callback) callback(deps.concat(wdrs));
    });
  });
}

// ── All customers (admin) ─────────────────────────────────────
function allCustomers(callback) {
  apiCall("GET", "/admin/users?limit=200", null, function(err, data) {
    if (callback) callback((data && data.users) ? data.users : []);
  });
}

// ── Record game played (local tracking only) ──────────────────
function recordGamePlayed(phone, numCards, entryFee) {
  // Stats are tracked server-side via game routes
  // This is a no-op for the local game mode
}
function recordGameWon(phone, prize) {
  // Stats tracked server-side
}

// ── Wallet screen helpers ─────────────────────────────────────
function setAmt(inputId, val) {
  var el = document.getElementById(inputId);
  if (el) el.value = val;
}

// ── Lookup customer by phone (admin wallet screen) ────────────
function doLookup() {
  var phone = (document.getElementById("lookupId").value || "").trim();
  var el    = document.getElementById("lookupResult");
  if (!phone) { el.innerHTML = '<div class="wr-err">ስልክ ቁጥር ያስገቡ</div>'; el.classList.remove("hidden"); return; }

  apiCall("GET", "/admin/users?search=" + encodeURIComponent(phone), null, function(err, data) {
    if (err || !data.ok || !data.users.length) {
      el.innerHTML = '<div class="wr-err">❌ ደንበኛ አልተገኘም: ' + phone + '</div>';
      el.classList.remove("hidden");
      return;
    }
    var u = data.users[0];
    el.innerHTML =
      '<div class="wr-card">' +
        '<div class="wr-row"><span>📱 ስልክ</span><strong>' + u.phone + '</strong></div>' +
        '<div class="wr-row"><span>👤 ስም</span><strong>' + (u.full_name || u.phone) + '</strong></div>' +
        '<div class="wr-row"><span>💰 ቀሪ ሂሳብ</span><strong class="wr-bal">' + fmtMoney(u.balance) + '</strong></div>' +
        '<div class="wr-row"><span>🎮 ጨዋታዎች</span><strong>' + u.games_played + '</strong></div>' +
        '<div class="wr-row"><span>🏆 አሸናፊ</span><strong>' + u.games_won + '</strong></div>' +
        (u.is_admin ? '<div class="wr-row"><span>👑 አስተዳዳሪ</span><strong>አዎ</strong></div>' : '') +
        (u.is_banned ? '<div class="wr-row" style="color:#ef4444"><span>🚫 ታግዷል</span><strong>አዎ</strong></div>' : '') +
      '</div>';
    el.classList.remove("hidden");
  });
}

// ── Admin: deposit to user ────────────────────────────────────
function doDeposit() {
  var phone  = (document.getElementById("depId").value || "").trim();
  var amount = parseFloat(document.getElementById("depAmount").value);
  var txId   = (document.getElementById("depTxId").value || "").trim();
  var el     = document.getElementById("depositResult");

  if (!phone || isNaN(amount) || amount <= 0) {
    el.innerHTML = '<div class="wr-err">❌ ስልክ ቁጥር እና መጠን ያስፈልጋሉ</div>';
    el.classList.remove("hidden"); return;
  }

  // Find user ID first
  apiCall("GET", "/admin/users?search=" + encodeURIComponent(phone), null, function(err, data) {
    if (err || !data.ok || !data.users.length) {
      el.innerHTML = '<div class="wr-err">❌ ደንበኛ አልተገኘም</div>';
      el.classList.remove("hidden"); return;
    }
    var userId = data.users[0].id;
    apiCall("POST", "/admin/users/" + userId + "/credit", { amount: amount, note: "Admin deposit" + (txId ? " TXN:" + txId : "") }, function(err2, data2) {
      if (err2 || !data2.ok) {
        el.innerHTML = '<div class="wr-err">❌ ' + (data2 ? data2.msg : "ስህተት") + '</div>';
      } else {
        el.innerHTML = '<div class="wr-ok">✅ ' + fmtMoney(amount) + ' ለ ' + phone + ' ተሰጥቷል። አዲስ ሂሳብ: ' + fmtMoney(data2.new_balance) + '</div>';
        document.getElementById("depId").value     = "";
        document.getElementById("depAmount").value = "";
        document.getElementById("depTxId").value   = "";
      }
      el.classList.remove("hidden");
    });
  });
}

// ── Admin: withdraw from user ─────────────────────────────────
function doWithdraw() {
  var phone  = (document.getElementById("wdrId").value || "").trim();
  var amount = parseFloat(document.getElementById("wdrAmount").value);
  var el     = document.getElementById("withdrawResult");

  if (!phone || isNaN(amount) || amount <= 0) {
    el.innerHTML = '<div class="wr-err">❌ ስልክ ቁጥር እና መጠን ያስፈልጋሉ</div>';
    el.classList.remove("hidden"); return;
  }

  el.innerHTML = '<div class="wr-info">⏳ እየተሰራ ነው...</div>';
  el.classList.remove("hidden");

  apiCall("GET", "/admin/users?search=" + encodeURIComponent(phone), null, function(err, data) {
    if (err || !data.ok || !data.users.length) {
      el.innerHTML = '<div class="wr-err">❌ ደንበኛ አልተገኘም</div>'; return;
    }
    el.innerHTML = '<div class="wr-ok">✅ ጥያቄ ተልኳል</div>';
    document.getElementById("wdrId").value     = "";
    document.getElementById("wdrAmount").value = "";
  });
}

// ── Admin: render pending requests ───────────────────────────
function renderPendingRequests() {
  var el = document.getElementById("pendingRequestsList");
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:16px">⏳ እየጫነ ነው...</div>';

  getPendingRequests(function(requests) {
    if (!requests.length) {
      el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:16px">✅ ምንም ጥያቄ የለም</div>';
      return;
    }

    var html = "";
    requests.forEach(function(r) {
      var isDeposit = r.type === "deposit";
      // Show balance impact clearly: deposit = +amount (adds), withdraw = -amount (already deducted on request)
      var amtLabel  = isDeposit
        ? '<span style="color:#22c55e;font-weight:900">+' + fmtMoney(r.amount) + '</span>'
        : '<span style="color:#f87171;font-weight:900">−' + fmtMoney(r.amount) + '</span>';
      var balNote   = isDeposit
        ? '<span style="color:#94a3b8;font-size:.72rem">ሂሳብ ይጨምራል ✅</span>'
        : '<span style="color:#94a3b8;font-size:.72rem">ሂሳብ ቀድሞ ተቀንሷል ⚠️</span>';

      html +=
        '<div class="pending-item">' +
          '<div class="pi-top">' +
            '<span class="pi-type ' + (isDeposit ? "pi-dep" : "pi-wdr") + '">' +
              (isDeposit ? "💵 ገቢ" : "💸 ወጪ") +
            '</span>' +
            '<span class="pi-phone">' + (r.name || r.phone || "") + '</span>' +
            '<span class="pi-amount">' + amtLabel + '</span>' +
          '</div>' +
          '<div class="pi-detail">' +
            balNote + '<br>' +
            (r.txId    ? '🔢 TXN: <strong>' + r.txId + '</strong> | ' : '') +
            (r.account ? '📱 ' + (r.method || "telebirr") + ': <strong>' + r.account + '</strong> | ' : '') +
            '📅 ' + (r.date || "") +
          '</div>' +
          '<div class="pi-actions">' +
            '<button class="btn-approve" onclick="approveRequest(\'' + r.type + '\',' + r.id + ',this)">' +
              (isDeposit ? '✅ ፍቀድ (+ሂሳብ)' : '✅ ፍቀድ (ተልኳል)') +
            '</button>' +
            '<button class="btn-reject"  onclick="rejectRequest(\'' + r.type + '\',' + r.id + ',this)">' +
              (isDeposit ? '❌ ውድቅ' : '❌ ውድቅ (+ሂሳብ ተመልሳል)') +
            '</button>' +
          '</div>' +
        '</div>';
    });
    el.innerHTML = html;
  });
}

function approveRequest(type, id, btn) {
  btn.disabled = true;
  var path = type === "deposit"
    ? "/admin/deposits/" + id + "/approve"
    : "/admin/withdrawals/" + id + "/approve";
  apiCall("POST", path, {}, function(err, data) {
    if (data && data.ok) {
      var msg = type === "deposit"
        ? "✅ ገቢ ተፈቅዷል — ሂሳብ ተጨምሯል"
        : "✅ ወጪ ተፈቅዷል — ሂሳብ ቀድሞ ተቀንሷል";
      flashMessage(msg, "#22c55e");
      renderPendingRequests();
      loadAdminStats();
    } else {
      flashMessage("❌ " + (data ? data.msg : "ስህተት"), "#ef4444");
      btn.disabled = false;
    }
  });
}

function rejectRequest(type, id, btn) {
  btn.disabled = true;
  var path = type === "deposit"
    ? "/admin/deposits/" + id + "/reject"
    : "/admin/withdrawals/" + id + "/reject";
  apiCall("POST", path, { note: "Admin rejected" }, function(err, data) {
    if (data && data.ok) {
      var msg = type === "deposit"
        ? "↩️ ገቢ ውድቅ — ሂሳብ አልተቀየረም"
        : "↩️ ወጪ ውድቅ — ሂሳብ ተመልሷል";
      flashMessage(msg, "#f59e0b");
      renderPendingRequests();
      loadAdminStats();
    } else {
      flashMessage("❌ " + (data ? data.msg : "ስህተት"), "#ef4444");
      btn.disabled = false;
    }
  });
}

// ── Admin: render all customers ───────────────────────────────
function renderAllCustomers() {
  var el = document.getElementById("allCustomers");
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:16px">⏳ እየጫነ ነው...</div>';

  allCustomers(function(users) {
    if (!users.length) {
      el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:16px">ምንም ተጠቃሚ የለም</div>';
      return;
    }
    var html = "";
    users.forEach(function(u) {
      html +=
        '<div class="customer-item' + (u.is_banned ? " cust-banned" : "") + '">' +
          '<div class="ci-top">' +
            '<span class="ci-phone">' + (u.is_admin ? "👑 " : "👤 ") + u.phone + '</span>' +
            '<span class="ci-bal">' + fmtMoney(u.balance) + '</span>' +
          '</div>' +
          '<div class="ci-stats">' +
            '🎮 ' + u.games_played + ' | 🏆 ' + u.games_won +
            ' | 💸 ' + fmtMoney(u.total_spent) + ' | 💰 ' + fmtMoney(u.total_won) +
          '</div>' +
          '<div class="ci-actions">' +
            '<button class="btn-sm-blue" onclick="adminCreditUser(' + u.id + ',\'' + u.phone + '\')">💵 ስጥ</button>' +
            (u.is_banned
              ? '<button class="btn-sm-gray" onclick="adminUnban(' + u.id + ',this)">🔓 ፍታ</button>'
              : '<button class="btn-sm-red"  onclick="adminBan(' + u.id + ',this)">🚫 ታገድ</button>') +
          '</div>' +
        '</div>';
    });
    el.innerHTML = html;
  });
}

function adminCreditUser(userId, phone) {
  var amt = prompt("💵 ለ " + phone + " ምን ያህል ብር ይስጡ?");
  if (!amt || isNaN(parseFloat(amt))) return;
  apiCall("POST", "/admin/users/" + userId + "/credit", { amount: parseFloat(amt) }, function(err, data) {
    if (data && data.ok) {
      flashMessage("✅ " + fmtMoney(amt) + " ለ " + phone + " ተሰጥቷል", "#22c55e");
      renderAllCustomers();
    } else {
      flashMessage("❌ " + (data ? data.msg : "ስህተት"), "#ef4444");
    }
  });
}

function adminBan(userId, btn) {
  btn.disabled = true;
  apiCall("POST", "/admin/users/" + userId + "/ban", {}, function(err, data) {
    if (data && data.ok) { flashMessage("🚫 ታግዷል", "#ef4444"); renderAllCustomers(); }
    else { btn.disabled = false; }
  });
}

function adminUnban(userId, btn) {
  btn.disabled = true;
  apiCall("POST", "/admin/users/" + userId + "/unban", {}, function(err, data) {
    if (data && data.ok) { flashMessage("🔓 ታግዶ ተፈቷል", "#22c55e"); renderAllCustomers(); }
    else { btn.disabled = false; }
  });
}

// ── Pending badge count ───────────────────────────────────────
function updatePendingBadge() {
  apiCall("GET", "/admin/deposits/pending", null, function(err, depData) {
    apiCall("GET", "/admin/withdrawals/pending", null, function(err2, wdrData) {
      var count = 0;
      if (depData && depData.requests) count += depData.requests.length;
      if (wdrData && wdrData.requests) count += wdrData.requests.length;
      var badge = document.getElementById("pendingBadge");
      if (badge) {
        badge.textContent = count > 0 ? count : "";
        badge.style.display = count > 0 ? "" : "none";
      }
    });
  });
}

// ── Admin register (wallet screen) ───────────────────────────
function doAdminRegister() {
  var phone = (document.getElementById("regPhone2").value || "").trim();
  var pass  = (document.getElementById("regPass3").value || "");
  var el    = document.getElementById("registerResult");

  if (!phone || phone.length < 10) { el.innerHTML = '<div class="wr-err">❌ ትክክለኛ ስልክ ቁጥር ያስገቡ</div>'; el.classList.remove("hidden"); return; }
  if (pass.length < 4)             { el.innerHTML = '<div class="wr-err">❌ የይለፍ ቃል ቢያንስ 4 ቁጥር</div>'; el.classList.remove("hidden"); return; }

  apiCall("POST", "/auth/register", { phone: phone, password: pass, full_name: phone }, function(err, data) {
    if (err || !data.ok) {
      el.innerHTML = '<div class="wr-err">❌ ' + (data ? data.msg : "ስህተት") + '</div>';
    } else {
      el.innerHTML = '<div class="wr-ok">✅ ምዝገባ ተሳክቷል — ' + phone + '</div>';
      document.getElementById("regPhone2").value = "";
      document.getElementById("regPass3").value  = "";
    }
    el.classList.remove("hidden");
  });
}

// ── Render account history ────────────────────────────────────
function renderAccHistory(history) {
  var el = document.getElementById("accHistoryList");
  if (!el) return;
  if (!history || !history.length) {
    el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:20px">ምንም ታሪክ የለም</div>';
    return;
  }
  var typeLabels = {
    deposit:       "💵 ገቢ",
    prize:         "🏆 ሽልማት",
    entry_fee:     "🎮 ካርድ ክፍያ",
    withdraw:      "💸 ወጪ",
    withdraw_hold: "💸 ወጪ (ተያዘ)",
    refund:        "↩️ ተመላሽ"
  };
  var creditTypes = { deposit: true, prize: true, refund: true };

  var html = "";
  history.forEach(function(t) {
    var isCredit = !!creditTypes[t.type];
    var sign     = isCredit ? "+" : "-";
    var color    = isCredit ? "#22c55e" : "#ef4444";

    var dateStr = t.date || t.created_at || "";
    try {
      var d = new Date(dateStr);
      if (!isNaN(d)) dateStr = d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    } catch(e) {}

    var balAfter = t.balance || t.balance_after;

    html +=
      '<div class="hist-item">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<span class="hi-type">' + (typeLabels[t.type] || t.type) + '</span>' +
          '<span style="font-size:.95rem;font-weight:900;color:' + color + '">' +
            sign + fmtMoney(t.amount) +
          '</span>' +
        '</div>' +
        (t.note ? '<span class="hi-note">' + t.note + '</span>' : '') +
        '<div style="display:flex;justify-content:space-between;margin-top:2px">' +
          '<span class="hi-date">' + dateStr + '</span>' +
          (balAfter !== undefined
            ? '<span style="font-size:.7rem;color:#64748b">ቀሪ: ' + fmtMoney(balAfter) + '</span>'
            : '') +
        '</div>' +
      '</div>';
  });
  el.innerHTML = html;
}
