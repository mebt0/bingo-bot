const { Telegraf, Markup } = require("telegraf");

const bot = new Telegraf("8024604530:AAEr5lqr7yfBUWw38DQnDi3Ve4KWukMA6Qo");

// ===== START MENU =====
bot.start((ctx) => {
  ctx.reply(
    "🎮 Main Menu",
    Markup.keyboard([
      ["🎮 Open Game / ጨዋታ"],
      ["💳 Deposit / ተከፍል", "💰 Balance / ቀሪ"],
      ["🏧 Withdraw / ውጣ", "📜 History / ታሪክ"],
      ["👤 Profile / መገለጫ", "🏢 Support / ድጋፍ"]
    ])
      .resize()
      .persistent()
  );
});


// ===== BUTTON ACTIONS =====
bot.hears("🎮 Open Game / ጨዋታ", (ctx) => {
  ctx.reply("Game is starting...");
});

bot.hears("💳 Deposit / ተከፍል", (ctx) => {
  ctx.reply("Deposit system coming soon 💳");
});

bot.hears("💰 Balance / ቀሪ", (ctx) => {
  ctx.reply("Your balance is: 0 ETB");
});

bot.hears("🏧 Withdraw / ውጣ", (ctx) => {
  ctx.reply("Withdraw request started 🏧");
});

bot.hears("📜 History / ታሪክ", (ctx) => {
  ctx.reply("No history yet 📜");
});

bot.hears("👤 Profile / መገለጫ", (ctx) => {
  ctx.reply(`👤 Name: ${ctx.from.first_name}`);
});

bot.hears("🏢 Support / ድጋፍ", (ctx) => {
  ctx.reply("Contact support: @your_support_username");
});


// ===== START BOT =====
bot.launch();

console.log("Bot is running...");
