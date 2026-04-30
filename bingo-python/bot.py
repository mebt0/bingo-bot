"""
AMHARIC BINGO BOT — Main Entry Point
Run: python bot.py
"""
import asyncio
import logging
import os
from dotenv import load_dotenv

from telegram import Update
from telegram.ext import (
    ApplicationBuilder, CommandHandler,
    CallbackQueryHandler, MessageHandler, filters,
)

from database import init_db
from handlers_user   import start, balance, history, leaderboard, help_cmd
from handlers_wallet import deposit_conv, withdraw_conv
from handlers_game   import play, join_game_cb, mycard
from handlers_admin  import (
    admin_menu, admin_callback, newgame_conv,
    ban_user, unban_user, add_balance,
)

load_dotenv()
logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
log = logging.getLogger(__name__)


async def post_init(app):
    """Runs after bot starts — init DB and set bot commands."""
    await init_db()
    await app.bot.set_my_commands([
        ("start",       "ጀምር / ምዝገባ"),
        ("play",        "ጨዋታ ይቀላቀሉ"),
        ("mycard",      "ካርድዎን ይመልከቱ"),
        ("balance",     "ቀሪ ሂሳብ"),
        ("deposit",     "ገንዘብ ያስገቡ"),
        ("withdraw",    "ገንዘብ ያውጡ"),
        ("history",     "የግብይት ታሪክ"),
        ("leaderboard", "ምርጥ ተጫዋቾች"),
        ("help",        "እርዳታ"),
    ])
    log.info("✅ Bot ready!")


def main():
    token = os.getenv("BOT_TOKEN")
    if not token:
        raise RuntimeError("BOT_TOKEN is missing in .env")

    app = (
        ApplicationBuilder()
        .token(token)
        .post_init(post_init)
        .build()
    )

    # ── User commands ─────────────────────────────────────────
    app.add_handler(CommandHandler("start",       start))
    app.add_handler(CommandHandler("balance",     balance))
    app.add_handler(CommandHandler("history",     history))
    app.add_handler(CommandHandler("leaderboard", leaderboard))
    app.add_handler(CommandHandler("help",        help_cmd))
    app.add_handler(CommandHandler("play",        play))
    app.add_handler(CommandHandler("mycard",      mycard))

    # ── Wallet conversations ──────────────────────────────────
    app.add_handler(deposit_conv())
    app.add_handler(withdraw_conv())

    # ── Admin commands ────────────────────────────────────────
    app.add_handler(CommandHandler("admin",      admin_menu))
    app.add_handler(CommandHandler("newgame",    newgame_conv().entry_points[0].callback))
    app.add_handler(newgame_conv())
    app.add_handler(CommandHandler("ban",        ban_user))
    app.add_handler(CommandHandler("unban",      unban_user))
    app.add_handler(CommandHandler("addbalance", add_balance))

    # ── Callback queries ──────────────────────────────────────
    app.add_handler(CallbackQueryHandler(join_game_cb,  pattern=r"^join_\d+$"))
    app.add_handler(CallbackQueryHandler(admin_callback, pattern=r"^adm_"))

    # ── Error handler ─────────────────────────────────────────
    async def error_handler(update, context):
        log.error("Error: %s", context.error, exc_info=context.error)
        if update and update.effective_message:
            try:
                await update.effective_message.reply_text(
                    "❌ ስህተት ተፈጥሯል። እባክዎ እንደገና ይሞክሩ።"
                )
            except Exception:
                pass

    app.add_error_handler(error_handler)

    log.info("🎯 አማርኛ ቢንጎ ቦት እየጀመረ ነው...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
