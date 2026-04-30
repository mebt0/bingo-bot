// ============================================================
//  WALLET HANDLERS  — /deposit  /withdraw
// ============================================================
const User   = require('../models/user');
const Wallet = require('../models/wallet');
const { formatMoney, safeReply, ADMIN_IDS } = require('../utils/helpers');

// Per-user conversation state (simple in-memory)
const depositState  = new Map();  // telegramId → { step, userId, amount }
const withdrawState = new Map();  // telegramId → { step, userId, amount, accountType, accountNumber }

// ── /deposit ──────────────────────────────────────────────────
async function handleDeposit(ctx) {
  const user = User.findOrCreate(ctx.from.id, ctx.from.first_name, ctx.from.username);
  if (user.is_banned) return ctx.reply('❌ ታግደዋል።');

  const minDep = parseFloat(process.env.MIN_DEPOSIT || 10);
  depositState.set(ctx.from.id, { step: 'amount', userId: user.id });

  await safeReply(ctx, `
💵 *ገንዘብ ማስገቢያ*

ዝቅተኛ መጠን: *${formatMoney(minDep)}*

*የሚያስገቡትን መጠን ይጻፉ* (ቁጥር ብቻ):
  `);
}

// ── /withdraw ─────────────────────────────────────────────────
async function handleWithdraw(ctx) {
  const user = User.findOrCreate(ctx.from.id, ctx.from.first_name, ctx.from.username);
  if (user.is_banned) return ctx.reply('❌ ታግደዋል።');

  const minW = parseFloat(process.env.MIN_WITHDRAW || 50);
  const maxW = parseFloat(process.env.MAX_WITHDRAW || 5000);

  if (user.balance < minW) {
    return safeReply(ctx, `❌ ቀሪ ሂሳብዎ *${formatMoney(user.balance)}* ነው። ዝቅተኛ ማውጫ *${formatMoney(minW)}* ነው።`);
  }

  withdrawState.set(ctx.from.id, { step: 'amount', userId: user.id });

  await safeReply(ctx, `
💸 *ገንዘብ ማውጫ*

💰 ቀሪ ሂሳብ: *${formatMoney(user.balance)}*
📉 ዝቅተኛ: *${formatMoney(minW)}*
📈 ከፍተኛ: *${formatMoney(maxW)}*

*የሚያወጡትን መጠን ይጻፉ*:
  `);
}

// ── Message router for multi-step flows ───────────────────────
async function handleWalletMessage(ctx) {
  const tid  = ctx.from.id;
  const text = (ctx.message.text || '').trim();

  // ── DEPOSIT FLOW ──────────────────────────────────────────
  if (depositState.has(tid)) {
    const state = depositState.get(tid);

    if (state.step === 'amount') {
      const amount = parseFloat(text);
      const minDep = parseFloat(process.env.MIN_DEPOSIT || 10);
      if (isNaN(amount) || amount < minDep) {
        return ctx.reply(`❌ ትክክለኛ መጠን ያስገቡ። ዝቅተኛ: ${formatMoney(minDep)}`);
      }
      state.amount = amount;
      state.step   = 'screenshot';
      depositState.set(tid, state);

      return safeReply(ctx, `
✅ መጠን: *${formatMoney(amount)}*

አሁን *የክፍያ ማስረጃ ፎቶ* ይላኩ (TeleBirr / CBE / Awash screenshot):
      `);
    }
    return; // wait for photo
  }

  // ── WITHDRAW FLOW ─────────────────────────────────────────
  if (withdrawState.has(tid)) {
    const state = withdrawState.get(tid);

    if (state.step === 'amount') {
      const amount = parseFloat(text);
      const user   = User.findById(state.userId);
      const minW   = parseFloat(process.env.MIN_WITHDRAW || 50);
      const maxW   = parseFloat(process.env.MAX_WITHDRAW || 5000);
      if (isNaN(amount) || amount < minW || amount > maxW) {
        return ctx.reply(`❌ ትክክለኛ መጠን ያስገቡ (${formatMoney(minW)} – ${formatMoney(maxW)})`);
      }
      if (user.balance < amount) {
        return ctx.reply(`❌ ቀሪ ሂሳብ በቂ አይደለም። ቀሪ: ${formatMoney(user.balance)}`);
      }
      state.amount = amount;
      state.step   = 'account_type';
      withdrawState.set(tid, state);

      return ctx.reply('💳 የሂሳብ አይነት ይምረጡ:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 TeleBirr', callback_data: 'wtype_telebirr' }],
            [{ text: '🏦 CBE (ንግድ ባንክ)', callback_data: 'wtype_cbe' }],
            [{ text: '🏦 Awash Bank', callback_data: 'wtype_awash' }],
          ]
        }
      });
    }

    if (state.step === 'account_number') {
      state.accountNumber = text;
      state.step = 'account_name';
      withdrawState.set(tid, state);
      return ctx.reply('👤 የሂሳብ ባለቤት ስም ይጻፉ:');
    }

    if (state.step === 'account_name') {
      state.accountName = text;
      withdrawState.set(tid, state);

      // Confirm
      return safeReply(ctx, `
📋 *ማረጋገጫ*

💸 መጠን: *${formatMoney(state.amount)}*
💳 አይነት: *${state.accountType}*
🔢 ቁጥር: *${state.accountNumber}*
👤 ስም: *${state.accountName}*

ትክክል ነው?
      `, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ አዎ, ላክ', callback_data: 'withdraw_confirm' },
              { text: '❌ ሰርዝ',    callback_data: 'withdraw_cancel'  }
            ]
          ]
        }
      });
    }
  }
}

// ── Photo handler (deposit screenshot) ───────────────────────
async function handleDepositPhoto(ctx) {
  const tid   = ctx.from.id;
  const state = depositState.get(tid);
  if (!state || state.step !== 'screenshot') return;

  const photo      = ctx.message.photo;
  const fileId     = photo[photo.length - 1].file_id;
  state.fileId     = fileId;
  state.step       = 'confirm';
  depositState.set(tid, state);

  await safeReply(ctx, `
📋 *ማረጋገጫ*

💵 መጠን: *${formatMoney(state.amount)}*
📸 ፎቶ: ተቀብሏል ✅

ትክክል ነው?
  `, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ አዎ, ላክ', callback_data: 'deposit_confirm' },
          { text: '❌ ሰርዝ',    callback_data: 'deposit_cancel'  }
        ]
      ]
    }
  });
}

// ── Callback query handler ────────────────────────────────────
async function handleWalletCallback(ctx) {
  const tid  = ctx.from.id;
  const data = ctx.callbackQuery.data;
  await ctx.answerCbQuery();

  // ── Deposit ───────────────────────────────────────────────
  if (data === 'deposit_confirm') {
    const state = depositState.get(tid);
    if (!state) return ctx.reply('❌ ጊዜው አልፏል። /deposit ይሞክሩ።');
    depositState.delete(tid);

    try {
      const req = Wallet.createDepositRequest(state.userId, state.amount, state.fileId);
      await ctx.reply(`✅ ጥያቄዎ ተልኳል! (#${req.id})\n\nአስተዳዳሪው ሲያረጋግጥ ሂሳብዎ ይሞላል።`);

      // Notify all admins
      for (const adminId of ADMIN_IDS) {
        try {
          await ctx.telegram.sendMessage(adminId,
            `💵 *አዲስ ገቢ ጥያቄ #${req.id}*\n\n` +
            `👤 ${ctx.from.first_name} (@${ctx.from.username || 'N/A'})\n` +
            `💰 መጠን: ${formatMoney(state.amount)}\n` +
            `🆔 ID: ${tid}`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[
                  { text: '✅ አጽድቅ', callback_data: `adm_dep_ok_${req.id}`  },
                  { text: '❌ ውድቅ',  callback_data: `adm_dep_no_${req.id}`  }
                ]]
              }
            }
          );
          // Forward the screenshot
          if (state.fileId) {
            await ctx.telegram.sendPhoto(adminId, state.fileId, { caption: `Deposit proof #${req.id}` });
          }
        } catch {}
      }
    } catch (e) {
      ctx.reply('❌ ስህተት: ' + e.message);
    }
    return;
  }

  if (data === 'deposit_cancel') {
    depositState.delete(tid);
    return ctx.reply('❌ ተሰርዟል።');
  }

  // ── Withdraw account type ─────────────────────────────────
  if (data.startsWith('wtype_')) {
    const state = withdrawState.get(tid);
    if (!state) return;
    state.accountType = data.replace('wtype_', '');
    state.step = 'account_number';
    withdrawState.set(tid, state);
    return ctx.reply(`🔢 ${state.accountType} ቁጥርዎን ይጻፉ:`);
  }

  // ── Withdraw confirm ──────────────────────────────────────
  if (data === 'withdraw_confirm') {
    const state = withdrawState.get(tid);
    if (!state) return ctx.reply('❌ ጊዜው አልፏል። /withdraw ይሞክሩ።');
    withdrawState.delete(tid);

    try {
      const req = Wallet.createWithdrawRequest(
        state.userId, state.amount,
        state.accountType, state.accountNumber, state.accountName
      );
      await ctx.reply(`✅ ጥያቄዎ ተልኳል! (#${req.id})\n\nአስተዳዳሪው ሲያረጋግጥ ይላካል።`);

      for (const adminId of ADMIN_IDS) {
        try {
          await ctx.telegram.sendMessage(adminId,
            `💸 *አዲስ ማውጫ ጥያቄ #${req.id}*\n\n` +
            `👤 ${ctx.from.first_name} (@${ctx.from.username || 'N/A'})\n` +
            `💰 ${formatMoney(state.amount)}\n` +
            `💳 ${state.accountType}: ${state.accountNumber}\n` +
            `👤 ${state.accountName}`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[
                  { text: '✅ አጽድቅ', callback_data: `adm_wdr_ok_${req.id}` },
                  { text: '❌ ውድቅ',  callback_data: `adm_wdr_no_${req.id}` }
                ]]
              }
            }
          );
        } catch {}
      }
    } catch (e) {
      ctx.reply('❌ ስህተት: ' + e.message);
    }
    return;
  }

  if (data === 'withdraw_cancel') {
    withdrawState.delete(tid);
    return ctx.reply('❌ ተሰርዟል።');
  }
}

module.exports = {
  handleDeposit,
  handleWithdraw,
  handleWalletMessage,
  handleDepositPhoto,
  handleWalletCallback,
  depositState,
  withdrawState
};
