"""
GAME HANDLERS — /play  /mycard  + live game engine (asyncio)
"""
import asyncio
import os
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
from models import UserModel, GameModel, WalletModel, fmt_money, render_card, amharic_num, col_letter

# gameId → asyncio.Task
active_tasks: dict[int, asyncio.Task] = {}


# ── /play ─────────────────────────────────────────────────────
async def play(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tg = update.effective_user
    user = await UserModel.find_or_create(tg.id, tg.full_name, tg.username)
    if user["is_banned"]:
        await update.message.reply_text("❌ ታግደዋል።")
        return

    rooms = await GameModel.find_waiting()
    if not rooms:
        await update.message.reply_text("📭 አሁን ክፍት ጨዋታ የለም። አስተዳዳሪው ሲከፍት ይጠብቁ።")
        return

    buttons = []
    for r in rooms:
        count = await GameModel.player_count(r["id"])
        buttons.append([InlineKeyboardButton(
            f"🎯 {r['room_code']} — {fmt_money(r['entry_fee'])} | {count}/{r['max_players']} ተጫዋቾች",
            callback_data=f"join_{r['id']}",
        )])

    await update.message.reply_text(
        "🎮 *ክፍት ጨዋታዎች:*",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


# ── Join callback ─────────────────────────────────────────────
async def join_game_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    tg   = update.effective_user
    user = await UserModel.find_or_create(tg.id, tg.full_name, tg.username)

    if user["is_banned"]:
        await query.message.reply_text("❌ ታግደዋል።")
        return

    game_id = int(query.data.replace("join_", ""))
    game    = await GameModel.find_by_id(game_id)
    if not game:
        await query.message.reply_text("❌ ጨዋታ አልተገኘም።")
        return
    if game["status"] != "waiting":
        await query.message.reply_text("❌ ጨዋታ ቀድሞ ጀምሯል።")
        return

    if user["balance"] < game["entry_fee"]:
        await query.message.reply_text(
            f"❌ ቀሪ ሂሳብ በቂ አይደለም።\n"
            f"💰 ቀሪ: *{fmt_money(user['balance'])}*\n"
            f"🎟 ክፍያ: *{fmt_money(game['entry_fee'])}*\n\n/deposit ይጠቀሙ።",
            parse_mode="Markdown",
        )
        return

    try:
        await UserModel.debit(user["id"], game["entry_fee"], "entry_fee",
                              f"GAME-{game_id}", f"Joined {game['room_code']}")
        await UserModel.find_or_create(tg.id, tg.full_name, tg.username)  # refresh

        card, marked = await GameModel.add_player(game_id, user["id"])
        count = await GameModel.player_count(game_id)
        card_text = render_card(card, marked, [])

        await query.message.reply_text(
            f"✅ *{game['room_code']}* ጨዋታ ተቀላቀሉ!\n\n"
            f"🎟 ክፍያ: *{fmt_money(game['entry_fee'])}*\n"
            f"👥 ተጫዋቾች: *{count}*\n\n"
            f"🃏 *የእርስዎ ካርድ:*\n{card_text}",
            parse_mode="Markdown",
        )
    except Exception as e:
        await query.message.reply_text(f"❌ {e}")


# ── /mycard ───────────────────────────────────────────────────
async def mycard(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tg   = update.effective_user
    user = await UserModel.find_or_create(tg.id, tg.full_name, tg.username)

    active = await GameModel.find_active()
    player_rec = None
    active_game = None

    for g in active:
        p = await GameModel.get_player_card(g["id"], user["id"])
        if p:
            player_rec  = p
            active_game = g
            break

    if not player_rec:
        await update.message.reply_text("📭 አሁን ጨዋታ ውስጥ አልተቀላቀሉም። /play ይጠቀሙ።")
        return

    import json
    grid   = json.loads(player_rec["card"])
    marked = json.loads(player_rec["marked"])
    called = json.loads(active_game["called_numbers"])
    card_text = render_card(grid, marked, called)

    await update.message.reply_text(
        f"🃏 *ካርድ — {active_game['room_code']}*\n\n"
        f"📢 ተጠርተዋል: *{len(called)}/75*\n\n{card_text}\n\n"
        "✅=ምልክት  ··=ተጠርቷል",
        parse_mode="Markdown",
    )


# ── Live game engine ──────────────────────────────────────────
async def run_game(bot, game_id: int, announce_chat_id: int):
    """Runs in background: draws numbers every N seconds until winner."""
    import json
    interval = int(os.getenv("NUMBER_CALL_INTERVAL", 15))

    await asyncio.sleep(3)  # brief pause before first call

    while True:
        game = await GameModel.find_by_id(game_id)
        if not game or game["status"] != "active":
            break

        number, winners = await GameModel.draw_and_call(game_id)

        if number is None:
            await bot.send_message(announce_chat_id, "📭 ሁሉም ቁጥሮች ተጠርተዋል። ጨዋታ አልቋል።")
            await GameModel.finish(game_id)
            break

        col   = col_letter(number)
        am    = amharic_num(number)
        fresh = await GameModel.find_by_id(game_id)
        called = json.loads(fresh["called_numbers"])

        # Announce number
        await bot.send_message(
            announce_chat_id,
            f"🔊 *{col}{number} — {am}*\n📢 ተጠርተዋል: {len(called)}/75",
            parse_mode="Markdown",
        )

        # Send updated card to each player
        players = await GameModel.get_players(game_id)
        for p in players:
            try:
                grid      = json.loads(p["card"])
                marked    = json.loads(p["marked"])
                card_text = render_card(grid, marked, called)
                await bot.send_message(
                    p["telegram_id"],
                    f"🔊 *{col}{number} — {am}*\n\n{card_text}",
                    parse_mode="Markdown",
                )
            except Exception:
                pass

        # Handle winners
        if winners:
            winner_p    = winners[0]
            winner_user = await UserModel.find_by_id(winner_p["user_id"])
            prize       = fresh["prize_pool"]

            await UserModel.credit(winner_user["id"], prize, "prize",
                                   f"GAME-{game_id}", "Bingo winner")
            await GameModel.finish(game_id, winner_user["id"], prize)

            # Update games_played for all
            for p in players:
                async with __import__("database").get_db() as db:
                    await db.execute(
                        "UPDATE users SET games_played=games_played+1 WHERE id=?", (p["user_id"],)
                    )
                    await db.commit()
            async with __import__("database").get_db() as db:
                await db.execute(
                    "UPDATE users SET games_won=games_won+1, total_won=total_won+? WHERE id=?",
                    (prize, winner_user["id"]),
                )
                await db.commit()

            await bot.send_message(
                announce_chat_id,
                f"🏆 *ቢንጎ!*\n\n"
                f"🥇 አሸናፊ: *{winner_user['full_name']}*\n"
                f"💰 ሽልማት: *{fmt_money(prize)}*\n"
                f"📢 ቁጥሮች: {len(called)}",
                parse_mode="Markdown",
            )
            try:
                await bot.send_message(
                    winner_user["telegram_id"],
                    f"🏆 *እንኳን ደስ አለዎ! ቢንጎ አሸነፉ!*\n\n"
                    f"💰 *{fmt_money(prize)}* ሂሳብዎ ላይ ተጨምሯል!",
                    parse_mode="Markdown",
                )
            except Exception:
                pass

            active_tasks.pop(game_id, None)
            break

        await asyncio.sleep(interval)


def stop_game(game_id: int):
    task = active_tasks.pop(game_id, None)
    if task:
        task.cancel()
