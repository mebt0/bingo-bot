# 🎯 አማርኛ ቢንጎ ቦት — Amharic Bingo Telegram Bot

A full Telegram Bingo bot with Amharic voice, wallet system, admin panel, and SQLite database.

---

## 📁 Project Structure

```
bingo-bot/
├── src/
│   ├── index.js                  ← Main entry point
│   ├── db/
│   │   ├── database.js           ← SQLite singleton
│   │   ├── migrate.js            ← Manual migration script
│   │   └── migrate-auto.js       ← Auto-runs on startup
│   ├── models/
│   │   ├── user.js               ← User CRUD + balance ops
│   │   ├── game.js               ← Game engine + card generator
│   │   └── wallet.js             ← Deposit/withdraw requests
│   ├── handlers/
│   │   ├── user.js               ← /start /balance /history
│   │   ├── wallet.js             ← /deposit /withdraw flows
│   │   ├── game.js               ← /play /mycard + live engine
│   │   └── admin.js              ← /admin panel + approvals
│   └── utils/
│       ├── amharic.js            ← Number names + card renderer
│       └── helpers.js            ← isAdmin, formatMoney, etc.
├── data/                         ← SQLite DB stored here (auto-created)
├── .env.example                  ← Copy to .env and fill in
├── package.json
└── README.md
```

---

## ⚙️ Setup

### 1. Install Node.js
Download from https://nodejs.org (v18 or higher)

### 2. Create your Telegram Bot
1. Open Telegram → search **@BotFather**
2. Send `/newbot` → follow steps → copy the **BOT_TOKEN**

### 3. Get your Telegram Admin ID
1. Search **@userinfobot** on Telegram
2. Send any message → it shows your numeric ID

### 4. Install dependencies
```bash
cd bingo-bot
npm install
```

### 5. Configure environment
```bash
cp .env.example .env
```
Edit `.env`:
```
BOT_TOKEN=1234567890:ABCdef...your_token_here
ADMIN_IDS=123456789
DB_PATH=./data/bingo.db
MIN_DEPOSIT=10
MIN_WITHDRAW=50
MAX_WITHDRAW=5000
CURRENCY=ETB
DEFAULT_ENTRY_FEE=10
DEFAULT_MAX_PLAYERS=50
NUMBER_CALL_INTERVAL=15
HOUSE_CUT_PERCENT=10
```

### 6. Start the bot
```bash
npm start
```

---

## 🎮 How to Play

### Players:
| Command | Description |
|---|---|
| `/start` | Register & see menu |
| `/deposit` | Add money (sends screenshot to admin) |
| `/withdraw` | Request payout (TeleBirr / CBE / Awash) |
| `/balance` | Check balance |
| `/play` | Join an open game room |
| `/mycard` | View your bingo card |
| `/history` | Transaction history |
| `/leaderboard` | Top winners |

### Admins:
| Command | Description |
|---|---|
| `/admin` | Open admin dashboard |
| `/addbalance <id> <amount>` | Manually credit a user |
| `/ban <telegram_id>` | Ban a user |
| `/unban <telegram_id>` | Unban a user |

### Admin Dashboard Buttons:
- **🎮 አዲስ ጨዋታ ፍጠር** — Create a new game room (set entry fee + max players)
- **▶️ ጨዋታ ጀምር** — Start a waiting game (auto-calls numbers every 15s)
- **💵 ያልተፈቀዱ ገቢዎች** — Review & approve deposit requests
- **💸 ያልተፈቀዱ ማውጫዎች** — Review & approve withdrawal requests
- **👥 ተጫዋቾች ዝርዝር** — View users
- **📊 ስታቲስቲክስ** — View stats

---

## 💰 Money Flow

```
Player deposits → Admin approves → Balance added
Player joins game → Entry fee deducted → Prize pool grows
Winner found → Prize paid to winner → House cut kept
Player withdraws → Admin approves → Paid via TeleBirr/CBE/Awash
```

**House cut** (default 10%) is taken from each entry fee.  
Example: 10 players × 10 ETB = 100 ETB → 90 ETB prize pool, 10 ETB house.

---

## ⚠️ Legal Warning

> Running a money-based game in Ethiopia requires compliance with:
> - **National Bank of Ethiopia** regulations
> - **Ethiopian Communications Authority** rules
> - Local gambling/gaming laws
>
> Use this system responsibly. The developer is not liable for misuse.

---

## 🔧 Production Tips

- Use **PM2** to keep the bot running: `npm install -g pm2 && pm2 start src/index.js --name bingo-bot`
- Back up `data/bingo.db` regularly
- Set `NUMBER_CALL_INTERVAL=20` for slower games
- Add the bot to a Telegram group/channel for public number announcements
