"""
USER HANDLERS — /start /balance /history /leaderboard /help
"""
from telegram import Update
from telegram.ext import ContextTypes
from models import UserModel, fmt_money


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tg = update.effective_user
    user = await UserModel.find_or_create(tg.id, tg.full_name, tg.username)

    if user["is_banned"]:
        await update.message.reply_text("❌ እርስዎ ታግደዋል። ለድጋፍ አስተዳዳሪውን ያነጋግሩ።")
        return

    text = (
        f"🎯 *አማርኛ ቢንጎ ቦት እንኳን ደህና መጡ!*\n\n"
        f"👤 ስም: *{user['full_name']}*\n"
        f"💰 ቀሪ ሂሳብ: *{fmt_money(user['balance'])}*\n"
        f"🎮 ጨዋታዎች: *{user['games_played']}*\n"
        f"🏆 አሸናፊ: *{user['games_won']}*\n\n"
        "*ትዕዛዞች:*\n"
        "/play — ጨዋታ ይቀላቀሉ\n"
        "/balance — ሂሳብ\n"
        "/deposit — ገንዘብ ያስገቡ\n"
        "/withdraw — ገንዘብ ያውጡ\n"
        "/mycard — ካርድዎ\n"
        "/history — ታሪክ\n"
        "/leaderboard — ምርጥ ተጫዋቾች\n"
        "/help — እርዳታ"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def balance(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tg = update.effective_user
    user = await UserModel.find_or_create(tg.id, tg.full_name, tg.username)
    if user["is_banned"]:
        await update.message.reply_text("❌ ታግደዋል።")
        return

    text = (
        f"💰 *የሂሳብ ዝርዝር*\n\n"
        f"👤 {user['full_name']}\n"
        f"💵 ቀሪ ሂሳብ: *{fmt_money(user['balance'])}*\n"
        f"📈 ጠቅላላ ያሸነፉ: *{fmt_money(user['total_won'])}*\n"
        f"📉 ጠቅላላ ያወጡ: *{fmt_money(user['total_spent'])}*\n"
        f"🎮 ጨዋታዎች: *{user['games_played']}* (አሸናፊ: {user['games_won']})"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def history(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tg = update.effective_user
    user = await UserModel.find_or_create(tg.id, tg.full_name, tg.username)
    txs = await UserModel.get_transactions(user["id"], 10)

    if not txs:
        await update.message.reply_text("📭 ምንም ግብይት የለም።")
        return

    emoji = {
        "deposit": "💵", "withdraw": "💸", "entry_fee": "🎮",
        "prize": "🏆", "refund": "↩️", "withdraw_hold": "⏳",
    }
    lines = []
    for t in txs:
        e = emoji.get(t["type"], "•")
        lines.append(
            f"{e} *{t['type']}* — {fmt_money(t['amount'])}\n"
            f"   ቀሪ: {fmt_money(t['balance_after'])} | {t['created_at'][:16]}"
        )

    await update.message.reply_text(
        "📋 *የቅርብ ጊዜ ግብይቶች*\n\n" + "\n\n".join(lines),
        parse_mode="Markdown",
    )


async def leaderboard(update: Update, context: ContextTypes.DEFAULT_TYPE):
    top = await UserModel.top_winners(10)
    if not top:
        await update.message.reply_text("📭 ምንም ውጤት የለም።")
        return

    medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]
    lines = [
        f"{medals[i]} *{u['full_name']}* — {fmt_money(u['total_won'])} ({u['games_won']} አሸናፊ)"
        for i, u in enumerate(top)
    ]
    await update.message.reply_text(
        "🏆 *ምርጥ ተጫዋቾች*\n\n" + "\n".join(lines),
        parse_mode="Markdown",
    )


async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "ℹ️ *እርዳታ*\n\n"
        "*ጨዋታ:*\n/play — ክፍት ጨዋታዎች\n/mycard — ካርድዎ\n\n"
        "*ሂሳብ:*\n/balance — ቀሪ ሂሳብ\n/deposit — ገቢ\n/withdraw — ማውጫ\n/history — ታሪክ\n\n"
        "*ሌሎች:*\n/leaderboard — ምርጥ ተጫዋቾች\n/help — ይህ ዝርዝር",
        parse_mode="Markdown",
    )
