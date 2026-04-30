require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is missing in bingo-bot/.env");
  process.exit(1);
}

const WEB_APP_URL = process.env.WEB_APP_URL || "https://strobe-anteater-pancake.ngrok-free.dev";

const bot = new Telegraf(BOT_TOKEN);

// Start command
bot.start((ctx) => {
  ctx.reply(
    "🎮 Open Mini App",
    Markup.inlineKeyboard([
      Markup.button.webApp("🚀 Open App", WEB_APP_URL)
    ])
  );
});

bot.launch();
console.log("✅ Bot running...");
console.log("🌐 Web App URL:", WEB_APP_URL);

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
