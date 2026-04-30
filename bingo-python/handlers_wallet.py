"""
WALLET HANDLERS — /deposit  /withdraw  (multi-step ConversationHandler)
"""
import os
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, ConversationHandler, CommandHandler,
    MessageHandler, CallbackQueryHandler, filters,
)
from models import UserModel, WalletModel, fmt_money

ADMIN_IDS = [int(x) for x in os.getenv("ADMIN_IDS", "").split(",") if x.strip()]

# ── Deposit conversation states ───────────────────────────────
DEP_AMOUNT, DEP_PHOTO, DEP_CONFIRM = range(3)

# ── Withdraw conversation states ──────────────────────────────
WDR_AMOUNT, WDR_TYPE, WDR_NUMBER, WDR_NAME, WDR_CONFIRM = range(5, 10)


# ════════════════════════════════════════════════════════════════
#  DEPOSIT FLOW
# ════════════════════════════════════════════════════════════════

async def deposit_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tg = update.effective_user
    user = await UserModel.find_or_create(tg.id, tg.full_name, tg.username)
    if user["is_banned"]:
        await update.message.reply_text("❌ ታግደዋል።")
        return ConversationHandler.END

    min_dep = float(os.getenv("MIN_DEPOSIT", 10))
    await update.message.reply_text(
        f"💵 *ገንዘብ ማስገቢያ*\n\nዝቅተኛ: *{fmt_money(min_dep)}*\n\n"
        "የሚያስገቡትን *መጠን* ይጻፉ (ቁጥር ብቻ):\n\n/cancel — ለመሰረዝ",
        parse_mode="Markdown",
    )
    context.user_data["dep_user_id"] = user["id"]
    return DEP_AMOUNT


async def deposit_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    min_dep = float(os.getenv("MIN_DEPOSIT", 10))
    try:
        amount = float(update.message.text.strip())
        if amount < min_dep:
            raise ValueError()
    except ValueError:
        await update.message.reply_text(f"❌ ትክክለኛ መጠን ያስገቡ (ቢያንስ {fmt_money(min_dep)}):")
        return DEP_AMOUNT

    context.user_data["dep_amount"] = amount
    await update.message.reply_text(
        f"✅ መጠን: *{fmt_money(amount)}*\n\n"
        "አሁን *የክፍያ ማስረጃ ፎቶ* ይላኩ (TeleBirr / CBE / Awash screenshot):",
        parse_mode="Markdown",
    )
    return DEP_PHOTO


async def deposit_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    photo = update.message.photo
    if not photo:
        await update.message.reply_text("❌ ፎቶ ይላኩ:")
        return DEP_PHOTO

    file_id = photo[-1].file_id
    context.user_data["dep_file_id"] = file_id
    amount = context.user_data["dep_amount"]

    kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ አዎ, ላክ", callback_data="dep_confirm"),
        InlineKeyboardButton("❌ ሰርዝ",    callback_data="dep_cancel"),
    ]])
    await update.message.reply_text(
        f"📋 *ማረጋገጫ*\n\n💵 መጠን: *{fmt_money(amount)}*\n📸 ፎቶ: ✅\n\nትክክል ነው?",
        parse_mode="Markdown",
        reply_markup=kb,
    )
    return DEP_CONFIRM


async def deposit_confirm_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    if query.data == "dep_cancel":
        await query.edit_message_text("❌ ተሰርዟል።")
        return ConversationHandler.END

    user_id = context.user_data["dep_user_id"]
    amount  = context.user_data["dep_amount"]
    file_id = context.user_data.get("dep_file_id")

    req = await WalletModel.create_deposit(user_id, amount, file_id)
    await query.edit_message_text(
        f"✅ ጥያቄዎ ተልኳል! (#*{req['id']}*)\n\nአስተዳዳሪው ሲያረጋግጥ ሂሳብዎ ይሞላል።",
        parse_mode="Markdown",
    )

    # Notify admins
    tg = update.effective_user
    kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ አጽድቅ", callback_data=f"adm_dep_ok_{req['id']}"),
        InlineKeyboardButton("❌ ውድቅ",  callback_data=f"adm_dep_no_{req['id']}"),
    ]])
    for admin_id in ADMIN_IDS:
        try:
            await context.bot.send_message(
                admin_id,
                f"💵 *አዲስ ገቢ ጥያቄ #{req['id']}*\n\n"
                f"👤 {tg.full_name} (@{tg.username or 'N/A'})\n"
                f"💰 {fmt_money(amount)}\n🆔 {tg.id}",
                parse_mode="Markdown",
                reply_markup=kb,
            )
            if file_id:
                await context.bot.send_photo(admin_id, file_id, caption=f"Proof #{req['id']}")
        except Exception:
            pass

    return ConversationHandler.END


async def deposit_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ ተሰርዟል።")
    return ConversationHandler.END


# ════════════════════════════════════════════════════════════════
#  WITHDRAW FLOW
# ════════════════════════════════════════════════════════════════

async def withdraw_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tg = update.effective_user
    user = await UserModel.find_or_create(tg.id, tg.full_name, tg.username)
    if user["is_banned"]:
        await update.message.reply_text("❌ ታግደዋል።")
        return ConversationHandler.END

    min_w = float(os.getenv("MIN_WITHDRAW", 50))
    if user["balance"] < min_w:
        await update.message.reply_text(
            f"❌ ቀሪ ሂሳብ *{fmt_money(user['balance'])}* ነው።\n"
            f"ዝቅተኛ ማውጫ *{fmt_money(min_w)}* ነው።",
            parse_mode="Markdown",
        )
        return ConversationHandler.END

    context.user_data["wdr_user_id"] = user["id"]
    context.user_data["wdr_balance"] = user["balance"]
    max_w = float(os.getenv("MAX_WITHDRAW", 5000))

    await update.message.reply_text(
        f"💸 *ገንዘብ ማውጫ*\n\n"
        f"💰 ቀሪ: *{fmt_money(user['balance'])}*\n"
        f"📉 ዝቅተኛ: *{fmt_money(min_w)}*\n"
        f"📈 ከፍተኛ: *{fmt_money(max_w)}*\n\n"
        "የሚያወጡትን *መጠን* ይጻፉ:\n\n/cancel — ለመሰረዝ",
        parse_mode="Markdown",
    )
    return WDR_AMOUNT


async def withdraw_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    min_w = float(os.getenv("MIN_WITHDRAW", 50))
    max_w = float(os.getenv("MAX_WITHDRAW", 5000))
    bal   = context.user_data["wdr_balance"]
    try:
        amount = float(update.message.text.strip())
        if amount < min_w or amount > max_w or amount > bal:
            raise ValueError()
    except ValueError:
        await update.message.reply_text(
            f"❌ ትክክለኛ መጠን ያስገቡ ({fmt_money(min_w)} – {fmt_money(min(max_w, bal))}):"
        )
        return WDR_AMOUNT

    context.user_data["wdr_amount"] = amount
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("📱 TeleBirr",       callback_data="wtype_telebirr")],
        [InlineKeyboardButton("🏦 CBE (ንግድ ባንክ)", callback_data="wtype_cbe")],
        [InlineKeyboardButton("🏦 Awash Bank",     callback_data="wtype_awash")],
    ])
    await update.message.reply_text("💳 የሂሳብ አይነት ይምረጡ:", reply_markup=kb)
    return WDR_TYPE


async def withdraw_type_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    context.user_data["wdr_type"] = query.data.replace("wtype_", "")
    await query.edit_message_text(f"🔢 {context.user_data['wdr_type']} ቁጥርዎን ይጻፉ:")
    return WDR_NUMBER


async def withdraw_number(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["wdr_number"] = update.message.text.strip()
    await update.message.reply_text("👤 የሂሳብ ባለቤት ስም ይጻፉ:")
    return WDR_NAME


async def withdraw_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["wdr_name"] = update.message.text.strip()
    d = context.user_data
    kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ አዎ, ላክ", callback_data="wdr_confirm"),
        InlineKeyboardButton("❌ ሰርዝ",    callback_data="wdr_cancel"),
    ]])
    await update.message.reply_text(
        f"📋 *ማረጋገጫ*\n\n"
        f"💸 መጠን: *{fmt_money(d['wdr_amount'])}*\n"
        f"💳 አይነት: *{d['wdr_type']}*\n"
        f"🔢 ቁጥር: *{d['wdr_number']}*\n"
        f"👤 ስም: *{d['wdr_name']}*\n\nትክክል ነው?",
        parse_mode="Markdown",
        reply_markup=kb,
    )
    return WDR_CONFIRM


async def withdraw_confirm_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    if query.data == "wdr_cancel":
        await query.edit_message_text("❌ ተሰርዟል።")
        return ConversationHandler.END

    d = context.user_data
    try:
        req = await WalletModel.create_withdraw(
            d["wdr_user_id"], d["wdr_amount"],
            d["wdr_type"], d["wdr_number"], d["wdr_name"],
        )
        await query.edit_message_text(
            f"✅ ጥያቄዎ ተልኳል! (#*{req['id']}*)\n\nአስተዳዳሪው ሲያረጋግጥ ይላካል።",
            parse_mode="Markdown",
        )
        tg = update.effective_user
        kb = InlineKeyboardMarkup([[
            InlineKeyboardButton("✅ ተፈቅዷል", callback_data=f"adm_wdr_ok_{req['id']}"),
            InlineKeyboardButton("❌ ውድቅ",   callback_data=f"adm_wdr_no_{req['id']}"),
        ]])
        for admin_id in ADMIN_IDS:
            try:
                await context.bot.send_message(
                    admin_id,
                    f"💸 *ማውጫ ጥያቄ #{req['id']}*\n\n"
                    f"👤 {tg.full_name}\n💰 {fmt_money(d['wdr_amount'])}\n"
                    f"💳 {d['wdr_type']}: {d['wdr_number']}\n👤 {d['wdr_name']}",
                    parse_mode="Markdown",
                    reply_markup=kb,
                )
            except Exception:
                pass
    except Exception as e:
        await query.edit_message_text(f"❌ ስህተት: {e}")

    return ConversationHandler.END


async def withdraw_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ ተሰርዟል።")
    return ConversationHandler.END


# ── Build conversation handlers ───────────────────────────────

def deposit_conv():
    return ConversationHandler(
        entry_points=[CommandHandler("deposit", deposit_start)],
        states={
            DEP_AMOUNT:  [MessageHandler(filters.TEXT & ~filters.COMMAND, deposit_amount)],
            DEP_PHOTO:   [MessageHandler(filters.PHOTO, deposit_photo),
                          MessageHandler(filters.TEXT & ~filters.COMMAND,
                                         lambda u, c: u.message.reply_text("❌ ፎቶ ይላኩ:") or DEP_PHOTO)],
            DEP_CONFIRM: [CallbackQueryHandler(deposit_confirm_cb, pattern="^dep_")],
        },
        fallbacks=[CommandHandler("cancel", deposit_cancel)],
        per_user=True,
    )


def withdraw_conv():
    return ConversationHandler(
        entry_points=[CommandHandler("withdraw", withdraw_start)],
        states={
            WDR_AMOUNT:  [MessageHandler(filters.TEXT & ~filters.COMMAND, withdraw_amount)],
            WDR_TYPE:    [CallbackQueryHandler(withdraw_type_cb, pattern="^wtype_")],
            WDR_NUMBER:  [MessageHandler(filters.TEXT & ~filters.COMMAND, withdraw_number)],
            WDR_NAME:    [MessageHandler(filters.TEXT & ~filters.COMMAND, withdraw_name)],
            WDR_CONFIRM: [CallbackQueryHandler(withdraw_confirm_cb, pattern="^wdr_")],
        },
        fallbacks=[CommandHandler("cancel", withdraw_cancel)],
        per_user=True,
    )
