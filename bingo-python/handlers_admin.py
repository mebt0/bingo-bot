"""
ADMIN HANDLERS — /admin  /newgame  /ban  /unban  /addbalance
                 approve/reject deposits & withdrawals
"""
import asyncio
import os
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, ConversationHandler, CommandHandler, MessageHandler, filters

from models import UserModel, GameModel, WalletModel, fmt_money
from handlers_game import run_game, stop_game, active_tasks

ADMIN_IDS = [int(x) for x in os.getenv("ADMIN_IDS", "").split(",") if x.strip()]

# New-game wizard states
NG_FEE, NG_MAX = range(20, 22)


def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_IDS


# ── /admin dashboard ──────────────────────────────────────────
async def admin_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ ፈቃድ የለዎትም።")
        return

    user_count  = await UserModel.count()
    total_prize = await GameModel.total_prize_pool()
    total_house = await GameModel.total_house_cut()
    pending_dep = len(await WalletModel.pending_deposits())
    pending_wdr = len(await WalletModel.pending_withdraws())

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🎮 አዲስ ጨዋታ ፍጠር",  callback_data="adm_newgame")],
        [InlineKeyboardButton("▶️ ጨዋታ ጀምር",        callback_data="adm_listgames")],
        [InlineKeyboardButton(f"💵 ያልተፈቀዱ ገቢዎች ({pending_dep})",   callback_data="adm_pendingdep")],
        [InlineKeyboardButton(f"💸 ያልተፈቀዱ ማውጫዎች ({pending_wdr})", callback_data="adm_pendingwdr")],
        [InlineKeyboardButton("👥 ተጫዋቾች",           callback_data="adm_users")],
        [InlineKeyboardButton("📊 ስታቲስቲክስ",         callback_data="adm_stats")],
    ])

    await update.message.reply_text(
        f"👨‍💻 *አስተዳዳሪ ፓነል*\n\n"
        f"👥 ተጫዋቾች: *{user_count}*\n"
        f"🏆 ጠቅላላ ሽልማት: *{fmt_money(total_prize)}*\n"
        f"🏦 ቤት ትርፍ: *{fmt_money(total_house)}*\n"
        f"💵 ያልተፈቀዱ ገቢዎች: *{pending_dep}*\n"
        f"💸 ያልተፈቀዱ ማውጫዎች: *{pending_wdr}*",
        parse_mode="Markdown",
        reply_markup=kb,
    )


# ── New game wizard ───────────────────────────────────────────
async def newgame_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return ConversationHandler.END
    await update.message.reply_text("💰 የመግቢያ ክፍያ ያስገቡ (ብር):\n\n/cancel — ለመሰረዝ")
    return NG_FEE


async def newgame_fee(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        fee = float(update.message.text.strip())
        if fee < 1:
            raise ValueError()
    except ValueError:
        await update.message.reply_text("❌ ትክክለኛ ክፍያ ያስገቡ (ቢያንስ 1 ብር):")
        return NG_FEE
    context.user_data["ng_fee"] = fee
    await update.message.reply_text("👥 ከፍተኛ ተጫዋቾች ቁጥር (2–400):")
    return NG_MAX


async def newgame_max(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        max_p = int(update.message.text.strip())
        if not (2 <= max_p <= 400):
            raise ValueError()
    except ValueError:
        await update.message.reply_text("❌ 2–400 ያስገቡ:")
        return NG_MAX

    fee  = context.user_data["ng_fee"]
    tg   = update.effective_user
    game = await GameModel.create(fee, max_p, tg.id, update.effective_chat.id)
    house_pct = float(os.getenv("HOUSE_CUT_PERCENT", 10))

    await update.message.reply_text(
        f"✅ *ጨዋታ ተፈጠረ!*\n\n"
        f"🎯 ኮድ: *{game['room_code']}*\n"
        f"💰 ክፍያ: *{fmt_money(game['entry_fee'])}*\n"
        f"👥 ከፍተኛ: *{game['max_players']}*\n"
        f"🏦 ቤት ቅናሽ: *{house_pct}%*\n\n"
        "ተጫዋቾች /play ብለው ሊቀላቀሉ ይችላሉ።\n"
        "/admin → ▶️ ጨዋታ ጀምር ይምረጡ።",
        parse_mode="Markdown",
    )
    return ConversationHandler.END


async def newgame_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ ተሰርዟል።")
    return ConversationHandler.END


def newgame_conv():
    return ConversationHandler(
        entry_points=[CommandHandler("newgame", newgame_start)],
        states={
            NG_FEE: [MessageHandler(filters.TEXT & ~filters.COMMAND, newgame_fee)],
            NG_MAX: [MessageHandler(filters.TEXT & ~filters.COMMAND, newgame_max)],
        },
        fallbacks=[CommandHandler("cancel", newgame_cancel)],
        per_user=True,
    )


# ── Admin callback router ─────────────────────────────────────
async def admin_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if not is_admin(query.from_user.id):
        await query.answer("❌ ፈቃድ የለዎትም")
        return
    await query.answer()
    data = query.data

    # ── List waiting games ────────────────────────────────────
    if data == "adm_listgames":
        waiting = await GameModel.find_waiting()
        if not waiting:
            await query.message.reply_text("📭 ጀምር የሚጠብቅ ጨዋታ የለም።")
            return
        btns = []
        for g in waiting:
            count = await GameModel.player_count(g["id"])
            btns.append([InlineKeyboardButton(
                f"▶️ {g['room_code']} ({count} ተጫዋቾች, {fmt_money(g['entry_fee'])})",
                callback_data=f"adm_start_{g['id']}",
            )])
            btns.append([InlineKeyboardButton(
                f"❌ ሰርዝ {g['room_code']}",
                callback_data=f"adm_cancel_{g['id']}",
            )])
        await query.message.reply_text("ጨዋታ ይምረጡ:", reply_markup=InlineKeyboardMarkup(btns))
        return

    # ── Start game ────────────────────────────────────────────
    if data.startswith("adm_start_"):
        game_id = int(data.replace("adm_start_", ""))
        game    = await GameModel.find_by_id(game_id)
        if not game or game["status"] != "waiting":
            await query.message.reply_text("❌ ጨዋታ አልተገኘም ወይም ቀድሞ ጀምሯል።")
            return
        count = await GameModel.player_count(game_id)
        if count < 1:
            await query.message.reply_text("❌ ቢያንስ አንድ ተጫዋች ያስፈልጋል።")
            return

        announce_chat = game.get("announce_chat") or query.message.chat_id
        await GameModel.start(game_id, announce_chat)

        await query.message.reply_text(
            f"✅ *{game['room_code']}* ጨዋታ ጀምሯል!\n"
            f"👥 ተጫዋቾች: {count}\n"
            f"💰 ሽልማት: {fmt_money(game['prize_pool'])}",
            parse_mode="Markdown",
        )

        # Launch background task
        task = asyncio.create_task(run_game(context.bot, game_id, int(announce_chat)))
        active_tasks[game_id] = task
        return

    # ── Cancel game ───────────────────────────────────────────
    if data.startswith("adm_cancel_"):
        game_id = int(data.replace("adm_cancel_", ""))
        game    = await GameModel.find_by_id(game_id)
        if not game:
            await query.message.reply_text("❌ ጨዋታ አልተገኘም።")
            return
        stop_game(game_id)
        players = await GameModel.get_players(game_id)
        for p in players:
            try:
                await UserModel.credit(p["user_id"], game["entry_fee"], "refund",
                                       f"CANCEL-{game_id}", "Game cancelled")
                await context.bot.send_message(
                    p["telegram_id"],
                    f"↩️ ጨዋታ {game['room_code']} ተሰርዟል። {fmt_money(game['entry_fee'])} ተመልሷል።",
                )
            except Exception:
                pass
        await GameModel.cancel(game_id)
        await query.message.reply_text(f"✅ ጨዋታ {game['room_code']} ተሰርዟል። ሁሉም ክፍያ ተመልሷል።")
        return

    # ── Pending deposits ──────────────────────────────────────
    if data == "adm_pendingdep":
        reqs = await WalletModel.pending_deposits()
        if not reqs:
            await query.message.reply_text("✅ ያልተፈቀደ ገቢ የለም።")
            return
        for r in reqs[:5]:
            kb = InlineKeyboardMarkup([[
                InlineKeyboardButton("✅ አጽድቅ", callback_data=f"adm_dep_ok_{r['id']}"),
                InlineKeyboardButton("❌ ውድቅ",  callback_data=f"adm_dep_no_{r['id']}"),
            ]])
            await query.message.reply_text(
                f"💵 *ገቢ #{r['id']}*\n👤 {r['full_name']}\n"
                f"💰 {fmt_money(r['amount'])}\n📅 {r['created_at'][:16]}",
                parse_mode="Markdown",
                reply_markup=kb,
            )
            if r.get("screenshot_file_id"):
                try:
                    await context.bot.send_photo(
                        query.message.chat_id, r["screenshot_file_id"],
                        caption=f"Proof #{r['id']}"
                    )
                except Exception:
                    pass
        return

    # ── Approve deposit ───────────────────────────────────────
    if data.startswith("adm_dep_ok_"):
        req_id = int(data.replace("adm_dep_ok_", ""))
        try:
            req  = await WalletModel.approve_deposit(req_id, query.from_user.id)
            user = await UserModel.find_by_id(req["user_id"])
            await query.message.reply_text(f"✅ ገቢ #{req_id} ተፈቅዷል። {fmt_money(req['amount'])} ለ {user['full_name']}")
            try:
                await context.bot.send_message(
                    user["telegram_id"],
                    f"✅ ገቢዎ ተፈቅዷል!\n💰 *{fmt_money(req['amount'])}* ሂሳብዎ ላይ ተጨምሯል።",
                    parse_mode="Markdown",
                )
            except Exception:
                pass
        except Exception as e:
            await query.message.reply_text(f"❌ {e}")
        return

    # ── Reject deposit ────────────────────────────────────────
    if data.startswith("adm_dep_no_"):
        req_id = int(data.replace("adm_dep_no_", ""))
        await WalletModel.reject_deposit(req_id, query.from_user.id, "Admin rejected")
        await query.message.reply_text(f"❌ ገቢ #{req_id} ውድቅ ተደርጓል።")
        return

    # ── Pending withdrawals ───────────────────────────────────
    if data == "adm_pendingwdr":
        reqs = await WalletModel.pending_withdraws()
        if not reqs:
            await query.message.reply_text("✅ ያልተፈቀደ ማውጫ የለም።")
            return
        for r in reqs[:5]:
            kb = InlineKeyboardMarkup([[
                InlineKeyboardButton("✅ ተፈቅዷል (ተላከ)", callback_data=f"adm_wdr_ok_{r['id']}"),
                InlineKeyboardButton("❌ ውድቅ (መልስ)",   callback_data=f"adm_wdr_no_{r['id']}"),
            ]])
            await query.message.reply_text(
                f"💸 *ማውጫ #{r['id']}*\n👤 {r['full_name']}\n"
                f"💰 {fmt_money(r['amount'])}\n"
                f"💳 {r['account_type']}: {r['account_number']}\n"
                f"👤 {r['account_name']}\n📅 {r['created_at'][:16]}",
                parse_mode="Markdown",
                reply_markup=kb,
            )
        return

    # ── Approve withdrawal ────────────────────────────────────
    if data.startswith("adm_wdr_ok_"):
        req_id = int(data.replace("adm_wdr_ok_", ""))
        try:
            req  = await WalletModel.approve_withdraw(req_id, query.from_user.id)
            user = await UserModel.find_by_id(req["user_id"])
            await query.message.reply_text(f"✅ ማውጫ #{req_id} ተፈቅዷል። {fmt_money(req['amount'])} ለ {user['full_name']}")
            try:
                await context.bot.send_message(
                    user["telegram_id"],
                    f"✅ ማውጫ ጥያቄዎ ተፈቅዷል!\n"
                    f"💸 *{fmt_money(req['amount'])}* → {req['account_type']} {req['account_number']}",
                    parse_mode="Markdown",
                )
            except Exception:
                pass
        except Exception as e:
            await query.message.reply_text(f"❌ {e}")
        return

    # ── Reject withdrawal ─────────────────────────────────────
    if data.startswith("adm_wdr_no_"):
        req_id = int(data.replace("adm_wdr_no_", ""))
        try:
            req  = await WalletModel.reject_withdraw(req_id, query.from_user.id)
            user = await UserModel.find_by_id(req["user_id"])
            await query.message.reply_text(f"↩️ ማውጫ #{req_id} ውድቅ ተደርጓል። {fmt_money(req['amount'])} ተመልሷል።")
            try:
                await context.bot.send_message(
                    user["telegram_id"],
                    f"↩️ ማውጫ ጥያቄዎ ውድቅ ተደርጓል። {fmt_money(req['amount'])} ሂሳብዎ ላይ ተመልሷል።",
                )
            except Exception:
                pass
        except Exception as e:
            await query.message.reply_text(f"❌ {e}")
        return

    # ── Users list ────────────────────────────────────────────
    if data == "adm_users":
        users = await UserModel.all_users(10)
        lines = [
            f"• *{u['full_name']}* (@{u['username'] or 'N/A'}) — "
            f"{fmt_money(u['balance'])} {'🚫' if u['is_banned'] else '✅'}"
            for u in users
        ]
        await query.message.reply_text(
            "👥 *ተጫዋቾች (ቅርብ 10)*\n\n" + "\n".join(lines),
            parse_mode="Markdown",
        )
        return

    # ── Stats ─────────────────────────────────────────────────
    if data == "adm_stats":
        games  = await GameModel.recent(100)
        done   = sum(1 for g in games if g["status"] == "finished")
        active = sum(1 for g in games if g["status"] == "active")
        await query.message.reply_text(
            f"📊 *ስታቲስቲክስ*\n\n"
            f"👥 ተጫዋቾች: *{await UserModel.count()}*\n"
            f"🎮 ጠቅላላ ጨዋታዎች: *{len(games)}*\n"
            f"✅ የተጠናቀቁ: *{done}*\n"
            f"🔴 ንቁ: *{active}*\n"
            f"🏆 ጠቅላላ ሽልማት: *{fmt_money(await GameModel.total_prize_pool())}*\n"
            f"🏦 ቤት ትርፍ: *{fmt_money(await GameModel.total_house_cut())}*",
            parse_mode="Markdown",
        )
        return

    # ── New game from dashboard ───────────────────────────────
    if data == "adm_newgame":
        await query.message.reply_text("ለአዲስ ጨዋታ /newgame ይጠቀሙ።")
        return


# ── /ban  /unban  /addbalance ─────────────────────────────────
async def ban_user(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return
    parts = update.message.text.split()
    if len(parts) < 2:
        await update.message.reply_text("አጠቃቀም: /ban <telegram_id>")
        return
    user = await UserModel.find_by_telegram_id(parts[1])
    if not user:
        await update.message.reply_text("❌ ተጫዋች አልተገኘም።")
        return
    await UserModel.ban(user["id"])
    await update.message.reply_text(f"🚫 {user['full_name']} ታግዷል።")


async def unban_user(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return
    parts = update.message.text.split()
    if len(parts) < 2:
        await update.message.reply_text("አጠቃቀም: /unban <telegram_id>")
        return
    user = await UserModel.find_by_telegram_id(parts[1])
    if not user:
        await update.message.reply_text("❌ ተጫዋች አልተገኘም።")
        return
    await UserModel.unban(user["id"])
    await update.message.reply_text(f"✅ {user['full_name']} ታግዶ ተፈቷል።")


async def add_balance(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return
    parts = update.message.text.split()
    if len(parts) < 3:
        await update.message.reply_text("አጠቃቀም: /addbalance <telegram_id> <amount>")
        return
    try:
        amount = float(parts[2])
    except ValueError:
        await update.message.reply_text("❌ ትክክለኛ መጠን ያስገቡ።")
        return
    user = await UserModel.find_by_telegram_id(parts[1])
    if not user:
        await update.message.reply_text("❌ ተጫዋች አልተገኘም።")
        return
    await UserModel.credit(user["id"], amount, "deposit", "MANUAL", "Admin credit")
    await update.message.reply_text(f"✅ {fmt_money(amount)} ለ {user['full_name']} ተጨምሯል።")
    try:
        await context.bot.send_message(
            user["telegram_id"],
            f"💰 አስተዳዳሪው *{fmt_money(amount)}* ሂሳብዎ ላይ ጨምሯል።",
            parse_mode="Markdown",
        )
    except Exception:
        pass
