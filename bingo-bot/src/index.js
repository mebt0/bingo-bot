require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is missing in bingo-bot/.env");
  process.exit(1);
}

const WEB_APP_URL = process.env.WEB_APP_URL || "https://strobe-anteater-pancake.ngrok-free.dev";
const ADMIN_IDS   = (process.env.ADMIN_IDS || "7627811244,1119881250").split(",").map(s => s.trim());

const bot = new Telegraf(BOT_TOKEN);

// ── Game state ────────────────────────────────────────────────
let players      = [];   // list of Telegram user objects
let gameRunning  = false;
let joinTimer    = null;

// ── Helper: is admin ─────────────────────────────────────────
function isAdmin(ctx) {
  return ADMIN_IDS.includes(String(ctx.from.id));
}

// ── /start — show Play button ─────────────────────────────────
bot.start((ctx) => {
  ctx.reply(
    "🎮 *ኣድዋ ቢንጎ እንኳን ደህና መጡ!*\n\nጨዋታ ለመጀመር ከዚህ ይጫኑ 👇",
    {
      parse_mode: "Markdown",
      reply_markup: {
        keyboard: [[{ text: "🚀 Play Bingo", web_app: { url: WEB_APP_URL } }]],
        resize_keyboard: true
      }
    }
  );
});

// ── /startgame — admin starts a round (30s join window) ───────
bot.command("startgame", async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply("❌ አስተዳዳሪ ብቻ ጨዋታ ሊጀምር ይችላል።");
  }
  if (gameRunning) {
    return ctx.reply("⚠️ ጨዋታ ቀድሞ ይሰራል! /stopgame ን ይጠቀሙ።");
  }

  players     = [];
  gameRunning = true;

  await ctx.reply(
    "🎮 *ጨዋታ ይጀምራል!*\n\n" +
    "⏳ 30 ሰከንድ ውስጥ /join ን ጠቅ አድርጉ ለመቀላቀል!\n\n" +
    "👇 ወይም ከዚህ ጨዋታ ይጫወቱ:",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "🎯 Join Game", callback_data: "join_game" },
          { text: "🚀 Open App",  web_app: { url: WEB_APP_URL } }
        ]]
      }
    }
  );

  // 30-second countdown
  let secondsLeft = 30;
  const countdownMsg = await ctx.reply(`⏳ ${secondsLeft} ሰከንድ ቀርቷል...`);

  const countdownInterval = setInterval(async () => {
    secondsLeft -= 10;
    if (secondsLeft > 0) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          countdownMsg.message_id,
          null,
          `⏳ ${secondsLeft} ሰከንድ ቀርቷል... (${players.length} ተጫዋቾች)`
        );
      } catch(e) {}
    }
  }, 10000);

  // After 30 seconds — start or cancel
  joinTimer = setTimeout(async () => {
    clearInterval(countdownInterval);

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, countdownMsg.message_id);
    } catch(e) {}

    if (players.length === 0) {
      gameRunning = false;
      return ctx.reply("❌ ምንም ተጫዋች አልተቀላቀለም። ጨዋታ ተሰርዟል።");
    }

    // Pick random winner
    const winner = players[Math.floor(Math.random() * players.length)];
    const names  = players.map(p => p.first_name).join(", ");

    await ctx.reply(
      `🎮 *ጨዋታ ጀምሯል!*\n\n` +
      `👥 ተጫዋቾች (${players.length}): ${names}\n\n` +
      `🎲 ቁጥሮች እየተጠሩ ነው...`,
      { parse_mode: "Markdown" }
    );

    // Simulate game (3 seconds) then announce winner
    setTimeout(async () => {
      await ctx.reply(
        `🏆 *ቢንጎ! አሸናፊ!*\n\n` +
        `🎉 ${winner.first_name} አሸነፈ!\n\n` +
        `🔄 ቀጣይ ዙር ብዙም ሳይቆይ...`,
        { parse_mode: "Markdown" }
      );
      gameRunning = false;
      players     = [];
    }, 3000);

  }, 30000);
});

// ── /join — player joins current game ─────────────────────────
bot.command("join", async (ctx) => {
  if (!gameRunning) {
    return ctx.reply("⚠️ አሁን ጨዋታ የለም። አስተዳዳሪ /startgame ሲልክ ይቀላቀሉ።");
  }
  const user = ctx.from;
  const alreadyJoined = players.some(p => p.id === user.id);
  if (alreadyJoined) {
    return ctx.reply(`⚠️ ${user.first_name}፣ ቀድሞ ተቀላቅለዋል!`);
  }
  players.push(user);
  await ctx.reply(
    `✅ *${user.first_name} ተቀላቀለ!*\n👥 ጠቅላላ ተጫዋቾች: ${players.length}`,
    { parse_mode: "Markdown" }
  );
});

// ── Inline button: join_game ──────────────────────────────────
bot.action("join_game", async (ctx) => {
  await ctx.answerCbQuery();
  if (!gameRunning) {
    return ctx.reply("⚠️ ጨዋታ አልተጀመረም።");
  }
  const user = ctx.from;
  const alreadyJoined = players.some(p => p.id === user.id);
  if (alreadyJoined) {
    return ctx.reply(`⚠️ ${user.first_name}፣ ቀድሞ ተቀላቅለዋል!`);
  }
  players.push(user);
  await ctx.reply(
    `✅ *${user.first_name} ተቀላቀለ!*\n👥 ጠቅላላ ተጫዋቾች: ${players.length}`,
    { parse_mode: "Markdown" }
  );
});

// ── /stopgame — admin stops current game ─────────────────────
bot.command("stopgame", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ አስተዳዳሪ ብቻ ጨዋታ ሊያቆም ይችላል።");
  if (!gameRunning)  return ctx.reply("⚠️ ጨዋታ አልተጀመረም።");

  if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
  gameRunning = false;
  players     = [];
  await ctx.reply("⏹ ጨዋታ ቆሟል።");
});

// ── /players — show current players ──────────────────────────
bot.command("players", async (ctx) => {
  if (!gameRunning) return ctx.reply("⚠️ ጨዋታ አልተጀመረም።");
  if (players.length === 0) return ctx.reply("👥 ምንም ተጫዋች አልተቀላቀለም።");
  const list = players.map((p, i) => `${i+1}. ${p.first_name}`).join("\n");
  await ctx.reply(`👥 *ተጫዋቾች (${players.length}):*\n${list}`, { parse_mode: "Markdown" });
});

// ── /help ─────────────────────────────────────────────────────
bot.command("help", (ctx) => {
  ctx.reply(
    "📋 *Commands:*\n\n" +
    "🎮 /startgame — ጨዋታ ጀምር (admin)\n" +
    "✅ /join — ጨዋታ ተቀላቀሉ\n" +
    "👥 /players — ተጫዋቾች ዝርዝር\n" +
    "⏹ /stopgame — ጨዋታ አቁም (admin)\n" +
    "🚀 /start — Play Bingo app ክፈት",
    { parse_mode: "Markdown" }
  );
});

// ── Launch ────────────────────────────────────────────────────
console.log("⏳ Connecting to Telegram...");

bot.launch().catch(err => {
  console.error("❌ Bot launch error:", err.message);
  process.exit(1);
});

setTimeout(async () => {
  try {
    const me = await bot.telegram.getMe();
    console.log("✅ Bot running: @" + me.username);
    console.log("🌐 Web App:    " + WEB_APP_URL);
    console.log("📋 Commands:   /startgame /join /stopgame /players /help");
  } catch(e) {
    console.log("📡 Bot is running...");
  }
}, 3000);

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
