// ============================================================
//  GAME HANDLERS  — /play  /mycard  + live game engine
// ============================================================
const User   = require('../models/user');
const GameModel = require('../models/game');
const { amharicNum, colLetter, renderCard } = require('../utils/amharic');
const { formatMoney, safeReply } = require('../utils/helpers');

// Active game timers: gameId → { interval, bot, chatId }
const activeTimers = new Map();

// ── /play — show open rooms ───────────────────────────────────
async function handlePlay(ctx) {
  const user = User.findOrCreate(ctx.from.id, ctx.from.first_name, ctx.from.username);
  if (user.is_banned) return ctx.reply('❌ ታግደዋል።');

  const rooms = GameModel.findWaiting();
  if (rooms.length === 0) {
    return ctx.reply(
      '📭 አሁን ክፍት ጨዋታ የለም። አስተዳዳሪው ሲከፍት ይጠብቁ።\n\n' +
      'ጓደኞችዎን ጋብዘው አብረው ይጫወቱ 👇',
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🔗 ጓደኛ ጋብዝ', url: 'https://t.me/share/url?url=https://t.me/BingoAmharicBot' }
          ]]
        }
      }
    );
  }

  // Build one row per room: [Join button] [Share link button]
  const buttons = rooms.map(r => [
    {
      text:          `🎯 ${r.room_code} — ${formatMoney(r.entry_fee)} | ${GameModel.getPlayerCount(r.id)} ተጫዋቾች`,
      callback_data: `join_${r.id}`
    }
  ]);

  await ctx.reply('🎮 *ክፍት ጨዋታዎች — ይቀላቀሉ:*', {
    parse_mode:   'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

// ── Join game callback ────────────────────────────────────────
async function handleJoinGame(ctx, gameId) {
  await ctx.answerCbQuery();
  const user = User.findOrCreate(ctx.from.id, ctx.from.first_name, ctx.from.username);
  if (user.is_banned) return ctx.reply('❌ ታግደዋል።');

  const game = GameModel.findById(gameId);
  if (!game) return ctx.reply('❌ ጨዋታ አልተገኘም።');
  if (game.status !== 'waiting') return ctx.reply('❌ ጨዋታ ቀድሞ ጀምሯል።');

  if (user.balance < game.entry_fee) {
    return safeReply(ctx,
      `❌ ቀሪ ሂሳብ በቂ አይደለም።\n💰 ቀሪ: *${formatMoney(user.balance)}*\n🎟 ክፍያ: *${formatMoney(game.entry_fee)}*\n\n/deposit ይጠቀሙ።`
    );
  }

  try {
    // Deduct entry fee
    User.debit(user.id, game.entry_fee, 'entry_fee', `GAME-${game.id}`, `Joined room ${game.room_code}`);
    User.recordSpent(user.id, game.entry_fee);

    // Add player + get card
    const card = GameModel.addPlayer(game.id, user.id);
    const marked = Array.from({ length: 5 }, (_, col) =>
      Array(5).fill(false).map((_, row) => card[col][row] === 0)
    );

    const count = GameModel.getPlayerCount(game.id);
    const cardText = renderCard(card, marked, []);

    await ctx.reply(
      `✅ *${game.room_code}* ጨዋታ ተቀላቀሉ!\n\n` +
      `🎟 ክፍያ: *${formatMoney(game.entry_fee)}*\n` +
      `💰 ቀሪ: *${formatMoney(user.balance - game.entry_fee)}*\n` +
      `👥 ተጫዋቾች: *${count}*\n\n` +
      `🃏 *የእርስዎ ካርድ:*\n${cardText}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔗 ጓደኛ ጋብዝ — ይህን ጨዋታ ያጋሩ', callback_data: `sharelink_${game.id}` }
          ]]
        }
      }
    );
  } catch (e) {
    ctx.reply('❌ ' + e.message);
  }
}

// ── /mycard ───────────────────────────────────────────────────
async function handleMyCard(ctx) {
  const user = User.findOrCreate(ctx.from.id, ctx.from.first_name, ctx.from.username);

  // Find the active game this user is in
  const activeGames = GameModel.findActive();
  let playerRecord = null;
  let activeGame   = null;

  for (const g of activeGames) {
    const p = GameModel.getPlayerCard(g.id, user.id);
    if (p) { playerRecord = p; activeGame = g; break; }
  }

  if (!playerRecord) {
    return ctx.reply('📭 አሁን ጨዋታ ውስጥ አልተቀላቀሉም። /play ይጠቀሙ።');
  }

  const grid    = JSON.parse(playerRecord.card);
  const marked  = JSON.parse(playerRecord.marked);
  const called  = JSON.parse(activeGame.called_numbers);
  const cardText = renderCard(grid, marked, called);

  await safeReply(ctx,
    `🃏 *የእርስዎ ካርድ — ${activeGame.room_code}*\n\n` +
    `📢 የተጠሩ ቁጥሮች: *${called.length}/75*\n\n` +
    cardText +
    `\n\n✅ = ምልክት ተደርጓል  ·· = ተጠርቷል`
  );
}

// ── Game engine: called by admin when game starts ─────────────
async function startGameEngine(bot, game, announceChatId) {
  const callInterval = parseInt(process.env.NUMBER_CALL_INTERVAL || 15) * 1000;

  async function callNext() {
    const freshGame = GameModel.findById(game.id);
    if (!freshGame || freshGame.status !== 'active') {
      stopGameEngine(game.id);
      return;
    }

    const number = GameModel.drawNumber(game.id);
    if (number === null) {
      await bot.telegram.sendMessage(announceChatId,
        '📭 ሁሉም ቁጥሮች ተጠርተዋል። ጨዋታ አልቋል።'
      );
      GameModel.finish(game.id, null, null);
      stopGameEngine(game.id);
      return;
    }

    // Call number + auto-mark all cards, get winners
    const winners = GameModel.callNumber(game.id, number);
    const col     = colLetter(number);
    const amName  = amharicNum(number);
    const called  = JSON.parse(GameModel.findById(game.id).called_numbers);

    // Announce to group/channel
    await bot.telegram.sendMessage(announceChatId,
      `🔊 *${col}${number} — ${amName}*\n📢 ተጠርተዋል: ${called.length}/75`,
      { parse_mode: 'Markdown' }
    );

    // Notify each player their updated card
    const players = GameModel.getPlayers(game.id);
    for (const p of players) {
      try {
        const grid   = JSON.parse(p.card);
        const marked = JSON.parse(p.marked);
        const cardTxt = renderCard(grid, marked, called);
        await bot.telegram.sendMessage(p.telegram_id,
          `🔊 *${col}${number} — ${amName}*\n\n${cardTxt}`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
    }

    // Handle winners
    if (winners.length > 0) {
      stopGameEngine(game.id);
      const winner     = winners[0];
      const winnerUser = User.findById(winner.user_id);
      const freshG     = GameModel.findById(game.id);
      const prize      = freshG.prize_pool;

      // Pay winner
      User.credit(winnerUser.id, prize, 'prize', `GAME-${game.id}`, 'Bingo winner');
      User.recordGameWon(winnerUser.id, prize);
      GameModel.finish(game.id, winnerUser.id, prize);

      // Update games_played for all players
      for (const p of players) User.recordGamePlayed(p.user_id);

      await bot.telegram.sendMessage(announceChatId,
        `🏆 *ቢንጎ!*\n\n` +
        `🥇 አሸናፊ: *${winnerUser.full_name}*\n` +
        `💰 ሽልማት: *${formatMoney(prize)}*\n` +
        `📢 ቁጥሮች: ${called.length}`,
        { parse_mode: 'Markdown' }
      );

      // Notify winner privately
      try {
        await bot.telegram.sendMessage(winnerUser.telegram_id,
          `🏆 *እንኳን ደስ አለዎ! ቢንጎ አሸነፉ!*\n\n💰 ሽልማት: *${formatMoney(prize)}* ሂሳብዎ ላይ ተጨምሯል!`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
    }
  }

  // Start calling numbers on interval
  const interval = setInterval(callNext, callInterval);
  activeTimers.set(game.id, { interval, bot, chatId: announceChatId });

  // First call immediately
  setTimeout(callNext, 3000);
}

function stopGameEngine(gameId) {
  const t = activeTimers.get(gameId);
  if (t) { clearInterval(t.interval); activeTimers.delete(gameId); }
}

module.exports = {
  handlePlay,
  handleJoinGame,
  handleMyCard,
  startGameEngine,
  stopGameEngine,
  activeTimers
};
