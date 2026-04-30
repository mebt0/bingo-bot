"""
MODELS — all database operations (async)
"""
import json
import random
import string
import os
from database import get_db

HOUSE_CUT_PCT = float(os.getenv("HOUSE_CUT_PERCENT", 10))

# ── Amharic number names ──────────────────────────────────────
AMHARIC_NUMS = [
    "", "አንድ", "ሁለት", "ሶስት", "አራት", "አምስት",
    "ስድስት", "ሰባት", "ስምንት", "ዘጠኝ", "አስር",
    "አስራ አንድ", "አስራ ሁለት", "አስራ ሶስት", "አስራ አራት", "አስራ አምስት",
    "አስራ ስድስት", "አስራ ሰባት", "አስራ ስምንት", "አስራ ዘጠኝ", "ሃያ",
    "ሃያ አንድ", "ሃያ ሁለት", "ሃያ ሶስት", "ሃያ አራት", "ሃያ አምስት",
    "ሃያ ስድስት", "ሃያ ሰባት", "ሃያ ስምንት", "ሃያ ዘጠኝ", "ሰላሳ",
    "ሰላሳ አንድ", "ሰላሳ ሁለት", "ሰላሳ ሶስት", "ሰላሳ አራት", "ሰላሳ አምስት",
    "ሰላሳ ስድስት", "ሰላሳ ሰባት", "ሰላሳ ስምንት", "ሰላሳ ዘጠኝ", "አርባ",
    "አርባ አንድ", "አርባ ሁለት", "አርባ ሶስት", "አርባ አራት", "አርባ አምስት",
    "አርባ ስድስት", "አርባ ሰባት", "አርባ ስምንት", "አርባ ዘጠኝ", "ሃምሳ",
    "ሃምሳ አንድ", "ሃምሳ ሁለት", "ሃምሳ ሶስት", "ሃምሳ አራት", "ሃምሳ አምስት",
    "ሃምሳ ስድስት", "ሃምሳ ሰባት", "ሃምሳ ስምንት", "ሃምሳ ዘጠኝ", "ስልሳ",
    "ስልሳ አንድ", "ስልሳ ሁለት", "ስልሳ ሶስት", "ስልሳ አራት", "ስልሳ አምስት",
    "ስልሳ ስድስት", "ስልሳ ሰባት", "ስልሳ ስምንት", "ስልሳ ዘጠኝ", "ሰባ",
    "ሰባ አንድ", "ሰባ ሁለት", "ሰባ ሶስት", "ሰባ አራት", "ሰባ አምስት",
]

COL_RANGES = [(1, 15), (16, 30), (31, 45), (46, 60), (61, 75)]
COL_LABELS = ["B", "I", "N", "G", "O"]


def amharic_num(n: int) -> str:
    return AMHARIC_NUMS[n] if 1 <= n <= 75 else str(n)


def col_letter(n: int) -> str:
    for i, (lo, hi) in enumerate(COL_RANGES):
        if lo <= n <= hi:
            return COL_LABELS[i]
    return ""


def fmt_money(amount) -> str:
    return f"{float(amount or 0):.2f} ብር"


# ── Card generator ────────────────────────────────────────────
def generate_card() -> list:
    """Returns 5x5 grid as list[col][row]. Center = 0 (FREE)."""
    grid = []
    for lo, hi in COL_RANGES:
        col = random.sample(range(lo, hi + 1), 5)
        grid.append(col)
    grid[2][2] = 0  # FREE
    return grid


def default_marked(grid: list) -> list:
    """Mark FREE cell automatically."""
    return [[grid[c][r] == 0 for r in range(5)] for c in range(5)]


def check_bingo(marked: list) -> bool:
    # Rows
    for r in range(5):
        if all(marked[c][r] for c in range(5)):
            return True
    # Columns
    for c in range(5):
        if all(marked[c][r] for r in range(5)):
            return True
    # Diagonals
    if all(marked[i][i] for i in range(5)):
        return True
    if all(marked[i][4 - i] for i in range(5)):
        return True
    return False


def mark_number(grid: list, marked: list, number: int) -> list:
    m = [col[:] for col in marked]
    for c in range(5):
        for r in range(5):
            if grid[c][r] == number:
                m[c][r] = True
    return m


def render_card(grid: list, marked: list, called: list) -> str:
    """Render card as monospace text for Telegram."""
    lines = ["```", "  B    I    N    G    O"]
    for r in range(5):
        row_cells = []
        for c in range(5):
            v = grid[c][r]
            if v == 0:
                row_cells.append(" ★  ")
            elif marked[c][r]:
                row_cells.append(f"[{v:02d}]")
            elif v in called:
                row_cells.append(f"·{v:02d}·")
            else:
                row_cells.append(f" {v:02d} ")
        lines.append(" ".join(row_cells))
    lines.append("```")
    return "\n".join(lines)


# ── User model ────────────────────────────────────────────────
class UserModel:

    @staticmethod
    async def find_or_create(telegram_id: int, full_name: str, username: str = None):
        async with await get_db() as db:
            async with db.execute(
                "SELECT * FROM users WHERE telegram_id=?", (str(telegram_id),)
            ) as cur:
                user = await cur.fetchone()

            if not user:
                await db.execute(
                    "INSERT INTO users (telegram_id, full_name, username) VALUES (?,?,?)",
                    (str(telegram_id), full_name, username),
                )
                await db.commit()
                async with db.execute(
                    "SELECT * FROM users WHERE telegram_id=?", (str(telegram_id),)
                ) as cur:
                    user = await cur.fetchone()
            else:
                await db.execute(
                    "UPDATE users SET full_name=?, username=?, updated_at=datetime('now') WHERE telegram_id=?",
                    (full_name, username, str(telegram_id)),
                )
                await db.commit()
                async with db.execute(
                    "SELECT * FROM users WHERE telegram_id=?", (str(telegram_id),)
                ) as cur:
                    user = await cur.fetchone()
            return dict(user)

    @staticmethod
    async def find_by_telegram_id(telegram_id):
        async with await get_db() as db:
            async with db.execute(
                "SELECT * FROM users WHERE telegram_id=?", (str(telegram_id),)
            ) as cur:
                row = await cur.fetchone()
                return dict(row) if row else None

    @staticmethod
    async def find_by_id(user_id):
        async with await get_db() as db:
            async with db.execute("SELECT * FROM users WHERE id=?", (user_id,)) as cur:
                row = await cur.fetchone()
                return dict(row) if row else None

    @staticmethod
    async def credit(user_id, amount, tx_type, reference=None, note=None):
        async with await get_db() as db:
            async with db.execute("SELECT balance FROM users WHERE id=?", (user_id,)) as cur:
                row = await cur.fetchone()
            before = row["balance"]
            after = before + amount
            await db.execute("UPDATE users SET balance=?, updated_at=datetime('now') WHERE id=?", (after, user_id))
            await db.execute(
                "INSERT INTO transactions (user_id,type,amount,balance_before,balance_after,reference,note) VALUES (?,?,?,?,?,?,?)",
                (user_id, tx_type, amount, before, after, reference, note),
            )
            await db.commit()
            return after

    @staticmethod
    async def debit(user_id, amount, tx_type, reference=None, note=None):
        async with await get_db() as db:
            async with db.execute("SELECT balance FROM users WHERE id=?", (user_id,)) as cur:
                row = await cur.fetchone()
            before = row["balance"]
            if before < amount:
                raise ValueError("ቀሪ ሂሳብ በቂ አይደለም")
            after = before - amount
            await db.execute("UPDATE users SET balance=?, updated_at=datetime('now') WHERE id=?", (after, user_id))
            await db.execute(
                "INSERT INTO transactions (user_id,type,amount,balance_before,balance_after,reference,note) VALUES (?,?,?,?,?,?,?)",
                (user_id, tx_type, amount, before, after, reference, note),
            )
            await db.commit()
            return after

    @staticmethod
    async def top_winners(limit=10):
        async with await get_db() as db:
            async with db.execute(
                "SELECT * FROM users ORDER BY total_won DESC LIMIT ?", (limit,)
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]

    @staticmethod
    async def all_users(limit=20):
        async with await get_db() as db:
            async with db.execute(
                "SELECT * FROM users ORDER BY created_at DESC LIMIT ?", (limit,)
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]

    @staticmethod
    async def count():
        async with await get_db() as db:
            async with db.execute("SELECT COUNT(*) as c FROM users") as cur:
                return (await cur.fetchone())["c"]

    @staticmethod
    async def ban(user_id):
        async with await get_db() as db:
            await db.execute("UPDATE users SET is_banned=1 WHERE id=?", (user_id,))
            await db.commit()

    @staticmethod
    async def unban(user_id):
        async with await get_db() as db:
            await db.execute("UPDATE users SET is_banned=0 WHERE id=?", (user_id,))
            await db.commit()

    @staticmethod
    async def get_transactions(user_id, limit=10):
        async with await get_db() as db:
            async with db.execute(
                "SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
                (user_id, limit),
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]


# ── Game model ────────────────────────────────────────────────
class GameModel:

    @staticmethod
    async def create(entry_fee, max_players, created_by, announce_chat=None):
        room_code = "BNG-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        async with await get_db() as db:
            await db.execute(
                "INSERT INTO games (room_code,entry_fee,max_players,created_by,announce_chat) VALUES (?,?,?,?,?)",
                (room_code, entry_fee, max_players, str(created_by), str(announce_chat) if announce_chat else None),
            )
            await db.commit()
            async with db.execute("SELECT * FROM games WHERE room_code=?", (room_code,)) as cur:
                return dict(await cur.fetchone())

    @staticmethod
    async def find_by_id(game_id):
        async with await get_db() as db:
            async with db.execute("SELECT * FROM games WHERE id=?", (game_id,)) as cur:
                row = await cur.fetchone()
                return dict(row) if row else None

    @staticmethod
    async def find_waiting():
        async with await get_db() as db:
            async with db.execute("SELECT * FROM games WHERE status='waiting' ORDER BY created_at DESC") as cur:
                return [dict(r) for r in await cur.fetchall()]

    @staticmethod
    async def find_active():
        async with await get_db() as db:
            async with db.execute(
                "SELECT * FROM games WHERE status IN ('waiting','active') ORDER BY created_at DESC"
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]

    @staticmethod
    async def add_player(game_id, user_id):
        game = await GameModel.find_by_id(game_id)
        if not game:
            raise ValueError("ጨዋታ አልተገኘም")
        if game["status"] != "waiting":
            raise ValueError("ጨዋታ ቀድሞ ጀምሯል")

        async with await get_db() as db:
            async with db.execute(
                "SELECT COUNT(*) as c FROM game_players WHERE game_id=?", (game_id,)
            ) as cur:
                count = (await cur.fetchone())["c"]
            if count >= game["max_players"]:
                raise ValueError("ቦታ አልቋል")

            async with db.execute(
                "SELECT id FROM game_players WHERE game_id=? AND user_id=?", (game_id, user_id)
            ) as cur:
                if await cur.fetchone():
                    raise ValueError("ቀድሞ ተቀላቅለዋል")

            card = generate_card()
            marked = default_marked(card)
            house = game["entry_fee"] * (HOUSE_CUT_PCT / 100)
            contribution = game["entry_fee"] - house

            await db.execute(
                "INSERT INTO game_players (game_id,user_id,card,marked) VALUES (?,?,?,?)",
                (game_id, user_id, json.dumps(card), json.dumps(marked)),
            )
            await db.execute(
                "UPDATE games SET prize_pool=prize_pool+?, house_cut=house_cut+? WHERE id=?",
                (contribution, house, game_id),
            )
            await db.commit()
            return card, marked

    @staticmethod
    async def get_players(game_id):
        async with await get_db() as db:
            async with db.execute(
                """SELECT gp.*, u.telegram_id, u.full_name, u.username
                   FROM game_players gp JOIN users u ON u.id=gp.user_id
                   WHERE gp.game_id=?""",
                (game_id,),
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]

    @staticmethod
    async def player_count(game_id):
        async with await get_db() as db:
            async with db.execute(
                "SELECT COUNT(*) as c FROM game_players WHERE game_id=?", (game_id,)
            ) as cur:
                return (await cur.fetchone())["c"]

    @staticmethod
    async def get_player_card(game_id, user_id):
        async with await get_db() as db:
            async with db.execute(
                "SELECT * FROM game_players WHERE game_id=? AND user_id=?", (game_id, user_id)
            ) as cur:
                row = await cur.fetchone()
                return dict(row) if row else None

    @staticmethod
    async def start(game_id, announce_chat=None):
        async with await get_db() as db:
            if announce_chat:
                await db.execute(
                    "UPDATE games SET status='active', started_at=datetime('now'), announce_chat=? WHERE id=?",
                    (str(announce_chat), game_id),
                )
            else:
                await db.execute(
                    "UPDATE games SET status='active', started_at=datetime('now') WHERE id=?",
                    (game_id,),
                )
            await db.commit()

    @staticmethod
    async def draw_and_call(game_id):
        """Draw a random uncalled number, mark all cards, return (number, winners)."""
        game = await GameModel.find_by_id(game_id)
        called = json.loads(game["called_numbers"])
        pool = [n for n in range(1, 76) if n not in called]
        if not pool:
            return None, []

        number = random.choice(pool)
        called.append(number)

        players = await GameModel.get_players(game_id)
        winners = []

        async with await get_db() as db:
            await db.execute(
                "UPDATE games SET called_numbers=? WHERE id=?",
                (json.dumps(called), game_id),
            )
            for p in players:
                grid = json.loads(p["card"])
                marked = mark_number(grid, json.loads(p["marked"]), number)
                has_bingo = check_bingo(marked)
                await db.execute(
                    "UPDATE game_players SET marked=?, has_bingo=? WHERE id=?",
                    (json.dumps(marked), 1 if has_bingo else 0, p["id"]),
                )
                if has_bingo and not p["has_bingo"]:
                    winners.append({**p, "marked": marked})
            await db.commit()

        return number, winners

    @staticmethod
    async def finish(game_id, winner_id=None, prize=None):
        async with await get_db() as db:
            await db.execute(
                "UPDATE games SET status='finished', winner_id=?, winner_prize=?, finished_at=datetime('now') WHERE id=?",
                (winner_id, prize, game_id),
            )
            await db.commit()

    @staticmethod
    async def cancel(game_id):
        async with await get_db() as db:
            await db.execute(
                "UPDATE games SET status='cancelled', finished_at=datetime('now') WHERE id=?",
                (game_id,),
            )
            await db.commit()

    @staticmethod
    async def recent(limit=20):
        async with await get_db() as db:
            async with db.execute(
                "SELECT * FROM games ORDER BY created_at DESC LIMIT ?", (limit,)
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]

    @staticmethod
    async def total_prize_pool():
        async with await get_db() as db:
            async with db.execute(
                "SELECT SUM(prize_pool) as t FROM games WHERE status='finished'"
            ) as cur:
                v = (await cur.fetchone())["t"]
                return v or 0

    @staticmethod
    async def total_house_cut():
        async with await get_db() as db:
            async with db.execute(
                "SELECT SUM(house_cut) as t FROM games WHERE status='finished'"
            ) as cur:
                v = (await cur.fetchone())["t"]
                return v or 0


# ── Wallet model ──────────────────────────────────────────────
class WalletModel:

    @staticmethod
    async def create_deposit(user_id, amount, file_id=None):
        async with await get_db() as db:
            await db.execute(
                "INSERT INTO deposit_requests (user_id,amount,screenshot_file_id) VALUES (?,?,?)",
                (user_id, amount, file_id),
            )
            await db.commit()
            async with db.execute(
                "SELECT * FROM deposit_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
                (user_id,),
            ) as cur:
                return dict(await cur.fetchone())

    @staticmethod
    async def pending_deposits():
        async with await get_db() as db:
            async with db.execute(
                """SELECT dr.*, u.telegram_id, u.full_name, u.username
                   FROM deposit_requests dr JOIN users u ON u.id=dr.user_id
                   WHERE dr.status='pending' ORDER BY dr.created_at ASC"""
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]

    @staticmethod
    async def approve_deposit(req_id, reviewed_by):
        async with await get_db() as db:
            async with db.execute("SELECT * FROM deposit_requests WHERE id=?", (req_id,)) as cur:
                req = await cur.fetchone()
            if not req or req["status"] != "pending":
                raise ValueError("ጥያቄ አልተገኘም ወይም ቀድሞ ተፈቅዷል")
            await db.execute(
                "UPDATE deposit_requests SET status='approved', reviewed_by=?, reviewed_at=datetime('now') WHERE id=?",
                (str(reviewed_by), req_id),
            )
            await db.commit()
        await UserModel.credit(req["user_id"], req["amount"], "deposit", f"DEP-{req_id}", "Deposit approved")
        return dict(req)

    @staticmethod
    async def reject_deposit(req_id, reviewed_by, note=None):
        async with await get_db() as db:
            await db.execute(
                "UPDATE deposit_requests SET status='rejected', reviewed_by=?, reviewed_at=datetime('now'), note=? WHERE id=?",
                (str(reviewed_by), note, req_id),
            )
            await db.commit()

    @staticmethod
    async def create_withdraw(user_id, amount, account_type, account_number, account_name):
        min_w = float(os.getenv("MIN_WITHDRAW", 50))
        max_w = float(os.getenv("MAX_WITHDRAW", 5000))
        if amount < min_w:
            raise ValueError(f"ዝቅተኛ ማውጫ {fmt_money(min_w)} ነው")
        if amount > max_w:
            raise ValueError(f"ከፍተኛ ማውጫ {fmt_money(max_w)} ነው")
        # Hold balance
        await UserModel.debit(user_id, amount, "withdraw_hold", note="Withdraw pending")
        async with await get_db() as db:
            await db.execute(
                "INSERT INTO withdraw_requests (user_id,amount,account_type,account_number,account_name) VALUES (?,?,?,?,?)",
                (user_id, amount, account_type, account_number, account_name),
            )
            await db.commit()
            async with db.execute(
                "SELECT * FROM withdraw_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
                (user_id,),
            ) as cur:
                return dict(await cur.fetchone())

    @staticmethod
    async def pending_withdraws():
        async with await get_db() as db:
            async with db.execute(
                """SELECT wr.*, u.telegram_id, u.full_name
                   FROM withdraw_requests wr JOIN users u ON u.id=wr.user_id
                   WHERE wr.status='pending' ORDER BY wr.created_at ASC"""
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]

    @staticmethod
    async def approve_withdraw(req_id, reviewed_by):
        async with await get_db() as db:
            async with db.execute("SELECT * FROM withdraw_requests WHERE id=?", (req_id,)) as cur:
                req = await cur.fetchone()
            if not req or req["status"] != "pending":
                raise ValueError("ጥያቄ አልተገኘም")
            await db.execute(
                "UPDATE withdraw_requests SET status='approved', reviewed_by=?, reviewed_at=datetime('now') WHERE id=?",
                (str(reviewed_by), req_id),
            )
            await db.commit()
        return dict(req)

    @staticmethod
    async def reject_withdraw(req_id, reviewed_by, note=None):
        async with await get_db() as db:
            async with db.execute("SELECT * FROM withdraw_requests WHERE id=?", (req_id,)) as cur:
                req = await cur.fetchone()
            if not req or req["status"] != "pending":
                raise ValueError("ጥያቄ አልተገኘም")
            await db.execute(
                "UPDATE withdraw_requests SET status='rejected', reviewed_by=?, reviewed_at=datetime('now'), note=? WHERE id=?",
                (str(reviewed_by), note, req_id),
            )
            await db.commit()
        # Refund
        await UserModel.credit(req["user_id"], req["amount"], "refund", f"WDR-{req_id}", "Withdraw rejected")
        return dict(req)
