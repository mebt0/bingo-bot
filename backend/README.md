# 🎯 Bingo Backend API

Express + SQLite REST API for the Amharic Bingo game.

## Setup

```bash
cd backend
npm install
npm start
```

Server runs on: `http://localhost:3001`

---

## API Endpoints

### Auth
| Method | URL | Body | Description |
|--------|-----|------|-------------|
| POST | `/api/auth/register` | `{phone, password, full_name}` | Register |
| POST | `/api/auth/login` | `{phone, password}` | Login → returns JWT token |
| GET  | `/api/auth/me` | — | Get current user (requires token) |

### Wallet
| Method | URL | Description |
|--------|-----|-------------|
| GET  | `/api/wallet/balance` | Get balance + stats |
| GET  | `/api/wallet/history` | Transaction history |
| POST | `/api/wallet/deposit/request` | Request deposit `{amount, tx_id}` |
| POST | `/api/wallet/withdraw/request` | Request withdrawal `{amount, account_type, account_number}` |

### Game
| Method | URL | Description |
|--------|-----|-------------|
| GET  | `/api/game/rooms` | List open game rooms |
| GET  | `/api/game/:id` | Get game state |
| GET  | `/api/game/:id/mycard` | Get my cards in a game |
| POST | `/api/game/cards/select` | Select cards & pay `{game_id, card_count}` |
| POST | `/api/game/bingo` | Declare bingo `{game_id, card_id}` |
| POST | `/api/game/create` | *(admin)* Create room `{entry_fee, max_players}` |
| POST | `/api/game/start` | *(admin)* Start game `{game_id}` |
| POST | `/api/game/call` | *(admin)* Call next number `{game_id}` |

### Admin
| Method | URL | Description |
|--------|-----|-------------|
| GET  | `/api/admin/stats` | Dashboard stats |
| GET  | `/api/admin/users` | All users |
| GET  | `/api/admin/deposits/pending` | Pending deposits |
| POST | `/api/admin/deposits/:id/approve` | Approve deposit |
| POST | `/api/admin/deposits/:id/reject` | Reject deposit |
| GET  | `/api/admin/withdrawals/pending` | Pending withdrawals |
| POST | `/api/admin/withdrawals/:id/approve` | Approve withdrawal |
| POST | `/api/admin/withdrawals/:id/reject` | Reject withdrawal |
| POST | `/api/admin/users/:id/ban` | Ban user |
| POST | `/api/admin/users/:id/unban` | Unban user |
| POST | `/api/admin/users/:id/credit` | Manually credit `{amount, note}` |
| GET  | `/api/admin/games` | All games |

---

## Authentication

All protected routes require:
```
Authorization: Bearer <your_jwt_token>
```

---

## .env Configuration

```env
PORT=3001
JWT_SECRET=your_secret_here
DB_PATH=./data/bingo.db
ENTRY_FEE=20
HOUSE_CUT_PERCENT=20
ADMIN_PHONES=0924787903
MIN_DEPOSIT=10
MIN_WITHDRAW=50
MAX_WITHDRAW=5000
```
