// ============================================================
//  HELPERS
// ============================================================

const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

function isAdmin(telegramId) {
  return ADMIN_IDS.includes(String(telegramId));
}

function formatMoney(amount) {
  return Number(amount || 0).toFixed(2) + ' ብር';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('am-ET', { timeZone: 'Africa/Addis_Ababa' });
}

function escapeMarkdown(text) {
  return String(text || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// Safe reply — falls back to plain text if markdown fails
async function safeReply(ctx, text, extra = {}) {
  try {
    return await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
  } catch {
    return await ctx.reply(text.replace(/[*_`[\]]/g, ''), extra);
  }
}

async function safeEdit(ctx, text, extra = {}) {
  try {
    return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...extra });
  } catch {
    try { return await ctx.reply(text.replace(/[*_`[\]]/g, ''), extra); } catch {}
  }
}

module.exports = { isAdmin, formatMoney, formatDate, escapeMarkdown, safeReply, safeEdit, ADMIN_IDS };
