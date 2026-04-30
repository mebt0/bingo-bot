# 🎯 አማርኛ ቢንጎ ቦት — Python Version (Full Pro)

## 📁 Files

```
bingo-python/
├── bot.py               ← Main entry — run this
├── database.py          ← SQLite setup (auto-creates tables)
├── models.py            ← All DB operations + bingo engine
├── handlers_user.py     ← /start /balance /history /leaderboard
├── handlers_wallet.py   ← /deposit /withdraw (multi-step)
├── handlers_game.py     ← /play /mycard + live game engine
├── handlers_admin.py    ← /admin panel + approve/reject
├── requirements.txt     ← pip dependencies
├── .env.example         ← Copy to .env
└── data/                ← SQLite DB stored here (auto-created)
```

---

## ⚙️ Setup (Step by Step)

### 1. Install Python 3.10+
Download: https://python.org

### 2. Install dependencies
```bash
cd bingo-python
pip install -r requirements.txt
```

### 3. Create your bot
- Open Telegram → search **@BotFather**
- Send `/newbot` → copy the **BOT_TOKEN**

### 4. Get your admin Telegram ID
- Search **@userinfobot** → send any message → copy your numeric ID

### 5. Configure
```bash
cp .env.example .env
```
Edit `.env`:
```
BOT_TOKEN=1234567890:ABCdef...
ADMIN_IDS=123456789
```

### 6. Run
```bash
python bot.py
```

---

## 🎮 Commands

### Players
| Command | Description |
|---|---|
| `/start` | Register & welcome |
| `/play` | See open game rooms |
| `/mycard` | View your bingo card |
| `/balance` | Check balance |
| `/deposit` | Add money (screenshot proof) |
| `/withdraw` | Request payout |
| `/history` | Transaction history |
| `/leaderboard` | Top winners |

### Admins
| Command | Description |
|---|---|
| `/admin` | Dashboard with buttons |
| `/newgame` | Create a new game room |
| `/ban <id>` | Ban a user |
| `/unban <id>` | Unban a user |
| `/addbalance <id> <amount>` | Manually credit user |

---

## 💰 Money Flow

```
Player /deposit → sends screenshot → Admin approves → balance added
Player /play → joins room → entry fee deducted → prize pool grows
Game starts → numbers called every 15s → winner detected automatically
Winner gets prize → balance credited → notified privately
Player /withdraw → admin approves → paid via TeleBirr/CBE/Awash
```

**House cut** (default 10%) taken from each entry fee.

---

## 🚀 Run 24/7 (Production)

```bash
# Install screen
sudo apt install screen

# Start in background
screen -S bingo
python bot.py
# Press Ctrl+A then D to detach

# Reattach later
screen -r bingo
```

Or use **systemd** / **PM2** (via npx) for auto-restart.

---

## ⚠️ Legal Notice

Running a money-based game requires legal compliance in your country.
Use responsibly. The developer is not liable for misuse.
