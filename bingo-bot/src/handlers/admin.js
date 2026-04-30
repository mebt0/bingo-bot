// ============================================================
//  ADMIN HANDLERS  — /admin  /newgame  /startgame  /endgame
//                    approve/reject deposits & withdrawals
//                    ban/unban users, stats
// ============================================================
const User    = require('../models/user');
const GameModel  = require('../models/game');
const Wallet  = require('../models/wallet');
const { startGameEngine, stopGameEngine } = require('./game');
const { isAdmin, formatMoney, formatDate, safeReply } = require('../utils/helpers');

// ── Guard ─────────────────────────────────────────────────────
function adminOnly(ctx) {
  if (!isAdmin(ctx.from.id)) {
    ctx.reply('❌ ይህ ትዕዛዝ ለአስተዳዳሪዎች ብቻ ነው።');
    return false;
  }
  return true;
}

// ── /admin — dashboard ────────────────────────────────────────
async function handleAdminMenu(ctx) {
  if (!adminOnly(ctx)) return;

  const userCount  = User.count();
  const games      = GameModel.recentGames(5);
  const totalPrize = GameModel.totalPrizePool();
  const totalHouse = GameModel.totalHouseCut();
  const pendingDep = Wallet.getPendingDeposits().length;
  const pendingWdr = Wallet.getPendingWithdraws().length;

  await safeReply(ctx, `
👨‍💻 *አስተዳዳሪ ፓነል*

👥 ተጫዋቾች: *${userCount}*
🏆 ጠቅላላ ሽልማት: *${formatMoney(totalPrize)}*
🏦 ቤት ትርፍ: *${formatMoney(totalHouse)}*
💵 ያልተፈቀዱ ገቢዎች: *${pendingDep}*
💸 ያልተፈቀዱ ማውጫዎች: *${pendingWdr}*
  `, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎮 አዲስ ጨዋታ ፍጠር',    callback_data: 'adm_newgame'      }],
        [{ text: '▶️ ጨዋታ ጀምር',          callback_data: 'adm_listgames'    }],
        [{ text: '💵 ያልተፈቀዱ ገቢዎች',     callback_data: 'adm_pendingdep'   }],
        [{ text: '💸 ያልተፈቀዱ ማውጫዎች',   callback_data: 'adm_pendingwdr'   }],
        [{ text: '👥 ተጫዋቾች ዝርዝር',      callback_data: 'adm_users'        }],
        [{ text: '📊 ስታቲስቲክስ',          callback_data: 'adm_stats'        }],
      ]
    }
  });
}

// ── New game creation state ───────────────────────────────────
const newGameState = new Map(); // adminId → { step, entryFee, maxPlayers, chatId }

// ── Admin callback router ─────────────────────────────────────
async function handleAdminCallback(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('❌ ፈቃድ የለዎትም');
  await ctx.answerCbQuery();

  const data = ctx.callbackQuery.data;
  const tid  = ctx.from.id;

  // ── New game wizard ───────────────────────────────────────
  if (data === 'adm_newgame') {
    newGameState.set(tid, { step: 'entry_fee' });
    return ctx.reply('💰 የመግቢያ ክፍያ ያስገቡ (ብር):');
  }

  // ── List games to start ───────────────────────────────────
  if (data === 'adm_listgames') {
    const waiting = GameModel.findWaiting();
    if (waiting.length === 0) return ctx.reply('📭 ጀምር የሚጠብቅ ጨዋታ የለም።');
    const btns = waiting.map(g => [{
      text: `▶️ ${g.room_code} (${GameModel.getPlayerCount(g.id)} ተጫዋቾች, ${formatMoney(g.entry_fee)})`,
      callback_data: `adm_start_${g.id}`
    }]);
    return ctx.reply('ጨዋታ ይምረጡ:', { reply_markup: { inline_keyboard: btns } });
  }

  // ── Start specific game ───────────────────────────────────
  if (data.startsWith('adm_start_')) {
    const gameId = parseInt(data.replace('adm_start_', ''));
    const game   = GameModel.findById(gameId);
    if (!game) return ctx.reply('❌ ጨዋታ አልተገኘም።');
    if (game.status !== 'waiting') return ctx.reply('❌ ጨዋታ ቀድሞ ጀምሯል።');

    const count = GameModel.getPlayerCount(gameId);
    if (count < 1) return ctx.reply('❌ ቢያንስ አንድ ተጫዋች ያስፈልጋል።');

    GameModel.start(gameId);

    // Use the chat where admin issued the command as announce channel
    const announceChatId = ctx.chat.id;
    await ctx.reply(
      `✅ *${game.room_code}* ጨዋታ ጀምሯል!\n👥 ተጫዋቾች: ${count}\n💰 ሽልማት: ${formatMoney(game.prize_pool)}`,
      { parse_mode: 'Markdown' }
    );
    await startGameEngine(ctx.telegram, game, announceChatId);
    return;
  }

  // ── End/cancel game ───────────────────────────────────────
  if (data.startsWith('adm_cancel_')) {
    const gameId = parseInt(data.replace('adm_cancel_', ''));
    const game   = GameModel.findById(gameId);
    if (!game) return ctx.reply('❌ ጨዋታ አልተገኘም።');

    stopGameEngine(gameId);

    // Refund all players
    const players = GameModel.getPlayers(gameId);
    for (const p of players) {
      try {
        User.credit(p.user_id, game.entry_fee, 'refund', `CANCEL-${gameId}`, 'Game cancelled');
        await ctx.telegram.sendMessage(p.telegram_id,
          `↩️ ጨዋታ ${game.room_code} ተሰርዟል። ${formatMoney(game.entry_fee)} ተመልሷል።`
        );
      } catch {}
    }
    GameModel.cancel(gameId);
    return ctx.reply(`✅ ጨዋታ ${game.room_code} ተሰርዟል። ሁሉም ክፍያ ተመልሷል።`);
  }

  // ── Pending deposits ──────────────────────────────────────
  if (data === 'adm_pendingdep') {
    const reqs = Wallet.getPendingDeposits();
    if (reqs.length === 0) return ctx.reply('✅ ያልተፈቀደ ገቢ የለም።');
    for (const r of reqs.slice(0, 5)) {
      await ctx.reply(
        `💵 *ገቢ ጥያቄ #${r.id}*\n👤 ${r.full_name} (@${r.username || 'N/A'})\n💰 ${formatMoney(r.amount)}\n📅 ${formatDate(r.created_at)}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ አጽድቅ', callback_data: `adm_dep_ok_${r.id}` },
              { text: '❌ ውድቅ',  callback_data: `adm_dep_no_${r.id}` }
            ]]
          }
        }
      );
      if (r.screenshot_file_id) {
        try { await ctx.replyWithPhoto(r.screenshot_file_id, { caption: `Proof #${r.id}` }); } catch {}
      }
    }
    return;
  }

  // ── Approve deposit ───────────────────────────────────────
  if (data.startsWith('adm_dep_ok_')) {
    const reqId = parseInt(data.replace('adm_dep_ok_', ''));
    try {
      const req  = Wallet.approveDeposit(reqId, tid);
      const user = User.findById(req.user_id);
      await ctx.reply(`✅ ገቢ #${reqId} ተፈቅዷል። ${formatMoney(req.amount)} ለ ${user.full_name}`);
      try {
        await ctx.telegram.sendMessage(user.telegram_id,
          `✅ ገቢዎ ተፈቅዷል!\n💰 *${formatMoney(req.amount)}* ሂሳብዎ ላይ ተጨምሯል።`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
    } catch (e) { ctx.reply('❌ ' + e.message); }
    return;
  }

  // ── Reject deposit ────────────────────────────────────────
  if (data.startsWith('adm_dep_no_')) {
    const reqId = parseInt(data.replace('adm_dep_no_', ''));
    try {
      Wallet.rejectDeposit(reqId, tid, 'Admin rejected');
      const req  = require('../db/database').prepare('SELECT * FROM deposit_requests WHERE id=?').get(reqId);
      const user = User.findById(req.user_id);
      await ctx.reply(`❌ ገቢ #${reqId} ውድቅ ተደርጓል።`);
      try {
        await ctx.telegram.sendMessage(user.telegram_id,
          `❌ ገቢ ጥያቄዎ ውድቅ ተደርጓል። ለድጋፍ አስተዳዳሪውን ያነጋግሩ።`
        );
      } catch {}
    } catch (e) { ctx.reply('❌ ' + e.message); }
    return;
  }

  // ── Pending withdrawals ───────────────────────────────────
  if (data === 'adm_pendingwdr') {
    const reqs = Wallet.getPendingWithdraws();
    if (reqs.length === 0) return ctx.reply('✅ ያልተፈቀደ ማውጫ የለም።');
    for (const r of reqs.slice(0, 5)) {
      await ctx.reply(
        `💸 *ማውጫ ጥያቄ #${r.id}*\n👤 ${r.full_name}\n💰 ${formatMoney(r.amount)}\n💳 ${r.account_type}: ${r.account_number}\n👤 ${r.account_name}\n📅 ${formatDate(r.created_at)}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ ተፈቅዷል (ተላከ)', callback_data: `adm_wdr_ok_${r.id}` },
              { text: '❌ ውድቅ (መልስ)',   callback_data: `adm_wdr_no_${r.id}` }
            ]]
          }
        }
      );
    }
    return;
  }

  // ── Approve withdrawal ────────────────────────────────────
  if (data.startsWith('adm_wdr_ok_')) {
    const reqId = parseInt(data.replace('adm_wdr_ok_', ''));
    try {
      const req  = Wallet.approveWithdraw(reqId, tid);
      const user = User.findById(req.user_id);
      await ctx.reply(`✅ ማውጫ #${reqId} ተፈቅዷል። ${formatMoney(req.amount)} ለ ${user.full_name}`);
      try {
        await ctx.telegram.sendMessage(user.telegram_id,
          `✅ ማውጫ ጥያቄዎ ተፈቅዷል!\n💸 *${formatMoney(req.amount)}* ወደ ${req.account_type} ${req.account_number} ተልኳል።`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
    } catch (e) { ctx.reply('❌ ' + e.message); }
    return;
  }

  // ── Reject withdrawal ─────────────────────────────────────
  if (data.startsWith('adm_wdr_no_')) {
    const reqId = parseInt(data.replace('adm_wdr_no_', ''));
    try {
      const req  = Wallet.rejectWithdraw(reqId, tid, 'Admin rejected');
      const user = User.findById(req.user_id);
      await ctx.reply(`↩️ ማውጫ #${reqId} ውድቅ ተደርጓል። ${formatMoney(req.amount)} ተመልሷል።`);
      try {
        await ctx.telegram.sendMessage(user.telegram_id,
          `↩️ ማውጫ ጥያቄዎ ውድቅ ተደርጓል። ${formatMoney(req.amount)} ሂሳብዎ ላይ ተመልሷል።`
        );
      } catch {}
    } catch (e) { ctx.reply('❌ ' + e.message); }
    return;
  }

  // ── Users list ────────────────────────────────────────────
  if (data === 'adm_users') {
    const users = User.all().slice(0, 10);
    const lines = users.map(u =>
      `• *${u.full_name}* (@${u.username || 'N/A'}) — ${formatMoney(u.balance)} ${u.is_banned ? '🚫' : '✅'}`
    );
    return safeReply(ctx, `👥 *ተጫዋቾች (ቅርብ 10)*\n\n${lines.join('\n')}`);
  }

  // ── Stats ─────────────────────────────────────────────────
  if (data === 'adm_stats') {
    const games  = GameModel.recentGames(100);
    const done   = games.filter(g => g.status === 'finished').length;
    const active = games.filter(g => g.status === 'active').length;
    return safeReply(ctx, `
📊 *ስታቲስቲክስ*

👥 ተጫዋቾች: *${User.count()}*
🎮 ጠቅላላ ጨዋታዎች: *${games.length}*
✅ የተጠናቀቁ: *${done}*
🔴 ንቁ: *${active}*
🏆 ጠቅላላ ሽልማት: *${formatMoney(GameModel.totalPrizePool())}*
🏦 ቤት ትርፍ: *${formatMoney(GameModel.totalHouseCut())}*
    `);
  }
}

// ── Admin text message handler (new game wizard) ──────────────
async function handleAdminMessage(ctx) {
  if (!isAdmin(ctx.from.id)) return;
  const tid  = ctx.from.id;
  const text = (ctx.message.text || '').trim();

  if (!newGameState.has(tid)) return;
  const state = newGameState.get(tid);

  if (state.step === 'entry_fee') {
    const fee = parseFloat(text);
    if (isNaN(fee) || fee < 1) return ctx.reply('❌ ትክክለኛ ክፍያ ያስገቡ (ቢያንስ 1 ብር):');
    state.entryFee = fee;
    state.step = 'max_players';
    newGameState.set(tid, state);
    return ctx.reply('👥 ከፍተኛ ተጫዋቾች ቁጥር ያስገቡ (ለምሳሌ 50):');
  }

  if (state.step === 'max_players') {
    const max = parseInt(text);
    if (isNaN(max) || max < 2 || max > 400) return ctx.reply('❌ 2–400 ያስገቡ:');
    state.maxPlayers = max;
    newGameState.delete(tid);

    try {
      const game = GameModel.create(state.entryFee, state.maxPlayers, tid);
      const housePct = parseFloat(process.env.HOUSE_CUT_PERCENT || 10);
      await safeReply(ctx, `
✅ *ጨዋታ ተፈጠረ!*

🎯 ኮድ: *${game.room_code}*
💰 ክፍያ: *${formatMoney(game.entry_fee)}*
👥 ከፍተኛ: *${game.max_players}*
🏦 ቤት ቅናሽ: *${housePct}%*

ተጫዋቾች /play ብለው ሊቀላቀሉ ይችላሉ።
ጨዋታ ለመጀመር /admin → ▶️ ጨዋታ ጀምር ይምረጡ።
      `);
    } catch (e) {
      ctx.reply('❌ ' + e.message);
    }
  }
}

// ── /ban  /unban ──────────────────────────────────────────────
async function handleBan(ctx) {
  if (!adminOnly(ctx)) return;
  const parts = ctx.message.text.split(' ');
  const targetId = parts[1];
  if (!targetId) return ctx.reply('አጠቃቀም: /ban <telegram_id>');
  const user = User.findByTelegramId(targetId);
  if (!user) return ctx.reply('❌ ተጫዋች አልተገኘም።');
  User.ban(user.id);
  ctx.reply(`🚫 ${user.full_name} ታግዷል።`);
}

async function handleUnban(ctx) {
  if (!adminOnly(ctx)) return;
  const parts = ctx.message.text.split(' ');
  const targetId = parts[1];
  if (!targetId) return ctx.reply('አጠቃቀም: /unban <telegram_id>');
  const user = User.findByTelegramId(targetId);
  if (!user) return ctx.reply('❌ ተጫዋች አልተገኘም።');
  User.unban(user.id);
  ctx.reply(`✅ ${user.full_name} ታግዶ ተፈቷል።`);
}

// ── /addbalance (manual credit) ───────────────────────────────
async function handleAddBalance(ctx) {
  if (!adminOnly(ctx)) return;
  const parts  = ctx.message.text.split(' ');
  const tgId   = parts[1];
  const amount = parseFloat(parts[2]);
  if (!tgId || isNaN(amount)) return ctx.reply('አጠቃቀም: /addbalance <telegram_id> <amount>');
  const user = User.findByTelegramId(tgId);
  if (!user) return ctx.reply('❌ ተጫዋች አልተገኘም።');
  User.credit(user.id, amount, 'deposit', 'MANUAL', 'Admin manual credit');
  ctx.reply(`✅ ${formatMoney(amount)} ለ ${user.full_name} ተጨምሯል።`);
  try {
    await ctx.telegram.sendMessage(tgId,
      `💰 አስተዳዳሪው *${formatMoney(amount)}* ሂሳብዎ ላይ ጨምሯል።`,
      { parse_mode: 'Markdown' }
    );
  } catch {}
}

module.exports = {
  handleAdminMenu,
  handleAdminCallback,
  handleAdminMessage,
  handleBan,
  handleUnban,
  handleAddBalance
};
