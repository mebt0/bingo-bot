// ============================================================
//  USER HANDLERS — /start, /balance, /history, /leaderboard
// ============================================================
const User   = require('../models/user');
const Wallet = require('../models/wallet');
const { formatMoney, formatDate, safeReply } = require('../utils/helpers');

// ── Shared main keyboard ──────────────────────────────────────
const { Markup } = require('telegraf');
const MAIN_KB = Markup.keyboard([
  ['🎟 ጨዋታ ተቀላቀሉ', '🎮 ጨዋታዎች'],
  ['💰 ቀሪ ሂሳብ',     '📋 ታሪክ'],
  ['💵 ገቢ',          '💸 ወጪ'],
  ['🏆 ምርጥ ተጫዋቾች', '🔗 ጓደኛ ጋብዝ'],
  ['ℹ️ እርዳታ']
]).resize();

// ── /start ────────────────────────────────────────────────────
async function handleStart(ctx) {
  const tg   = ctx.from;
  const user = User.findOrCreate(tg.id, tg.first_name + (tg.last_name ? ' ' + tg.last_name : ''), tg.username);

  if (user.is_banned) {
    return ctx.reply('❌ እርስዎ ታግደዋል። ለድጋፍ አስተዳዳሪውን ያነጋግሩ።');
  }

  const welcome = `
🎮 *Welcome to Bingo Bot*
📞 Contact: +251924787903

🎯 *አማርኛ ቢንጎ ቦት እንኳን ደህና መጡ!*

👤 ስም: *${user.full_name}*
💰 ቀሪ ሂሳብ: *${formatMoney(user.balance)}*
🎮 የተጫወቱ ጨዋታዎች: *${user.games_played}*
🏆 ያሸነፉ ጨዋታዎች: *${user.games_won}*

*ትዕዛዞች:*
/play — ጨዋታ ይቀላቀሉ
/balance — ሂሳብ ይመልከቱ
/deposit — ገንዘብ ያስገቡ
/withdraw — ገንዘብ ያውጡ
/history — የግብይት ታሪክ
/mycard — የእርስዎ ካርድ
/leaderboard — ምርጥ ተጫዋቾች
/help — እርዳታ
  `;
  await safeReply(ctx, welcome);
}

// ── /balance ──────────────────────────────────────────────────
async function handleBalance(ctx) {
  const user = User.findOrCreate(ctx.from.id, ctx.from.first_name, ctx.from.username);
  if (user.is_banned) return ctx.reply('❌ ታግደዋል።');

  await ctx.reply(
    `💰 *የሂሳብ ዝርዝር*\n\n` +
    `👤 ${user.full_name}\n` +
    `💵 ቀሪ ሂሳብ: *${formatMoney(user.balance)}*\n` +
    `📈 ጠቅላላ ያሸነፉ: *${formatMoney(user.total_won)}*\n` +
    `📉 ጠቅላላ ያወጡ: *${formatMoney(user.total_spent)}*\n` +
    `🎮 ጨዋታዎች: *${user.games_played}* (አሸናፊ: ${user.games_won})`,
    { parse_mode: 'Markdown', ...MAIN_KB }
  );
}

// ── /history ──────────────────────────────────────────────────
async function handleHistory(ctx) {
  const user = User.findOrCreate(ctx.from.id, ctx.from.first_name, ctx.from.username);
  const txs  = Wallet.getUserTransactions(user.id, 10);

  if (txs.length === 0) {
    return ctx.reply('📭 ምንም ግብይት የለም።');
  }

  const typeEmoji = { deposit:'💵', withdraw:'💸', entry_fee:'🎮', prize:'🏆', refund:'↩️', commission:'🏦', withdraw_hold:'⏳' };
  const lines = txs.map(t =>
    `${typeEmoji[t.type] || '•'} *${t.type}* — ${formatMoney(t.amount)}\n   ` +
    `ቀሪ: ${formatMoney(t.balance_after)} | ${formatDate(t.created_at)}`
  );

  await safeReply(ctx, `📋 *የቅርብ ጊዜ ግብይቶች*\n\n${lines.join('\n\n')}`);
}

// ── /leaderboard ──────────────────────────────────────────────
async function handleLeaderboard(ctx) {
  const top = User.topWinners(10);
  if (top.length === 0) return ctx.reply('📭 ምንም ውጤት የለም።');

  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  const lines  = top.map((u, i) =>
    `${medals[i]} *${u.full_name}* — ${formatMoney(u.total_won)} (${u.games_won} አሸናፊ)`
  );

  await safeReply(ctx, `🏆 *ምርጥ ተጫዋቾች*\n\n${lines.join('\n')}`);
}

// ── /help ─────────────────────────────────────────────────────
async function handleHelp(ctx) {
  await ctx.reply(
    `ℹ️ *እርዳታ*\n\n` +
    `*ጨዋታ:*\n` +
    `/play — ክፍት ጨዋታዎችን ይመልከቱ\n` +
    `/mycard — ካርድዎን ይመልከቱ\n\n` +
    `*ሂሳብ:*\n` +
    `/balance — ቀሪ ሂሳብ\n` +
    `/deposit — ገንዘብ ያስገቡ\n` +
    `/withdraw — ገንዘብ ያውጡ\n` +
    `/history — ታሪክ\n\n` +
    `*ሌሎች:*\n` +
    `/leaderboard — ምርጥ ተጫዋቾች\n` +
    `/invite — ጓደኛ ጋብዝ\n\n` +
    `📞 *ድጋፍ:* +251924787903\n` +
    `⚠️ ጨዋታ ከመጀመርዎ በፊት ሂሳብዎ ሙሉ መሆኑን ያረጋግጡ።`,
    { parse_mode: 'Markdown', ...MAIN_KB }
  );
}

module.exports = { handleStart, handleBalance, handleHistory, handleLeaderboard, handleHelp };
