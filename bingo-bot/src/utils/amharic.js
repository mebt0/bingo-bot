// ============================================================
//  AMHARIC NUMBER NAMES + CARD FORMATTER
// ============================================================

const AMHARIC_NUMS = [
  '', 'አንድ', 'ሁለት', 'ሶስት', 'አራት', 'አምስት',
  'ስድስት', 'ሰባት', 'ስምንት', 'ዘጠኝ', 'አስር',
  'አስራ አንድ', 'አስራ ሁለት', 'አስራ ሶስት', 'አስራ አራት', 'አስራ አምስት',
  'አስራ ስድስት', 'አስራ ሰባት', 'አስራ ስምንት', 'አስራ ዘጠኝ', 'ሃያ',
  'ሃያ አንድ', 'ሃያ ሁለት', 'ሃያ ሶስት', 'ሃያ አራት', 'ሃያ አምስት',
  'ሃያ ስድስት', 'ሃያ ሰባት', 'ሃያ ስምንት', 'ሃያ ዘጠኝ', 'ሰላሳ',
  'ሰላሳ አንድ', 'ሰላሳ ሁለት', 'ሰላሳ ሶስት', 'ሰላሳ አራት', 'ሰላሳ አምስት',
  'ሰላሳ ስድስት', 'ሰላሳ ሰባት', 'ሰላሳ ስምንት', 'ሰላሳ ዘጠኝ', 'አርባ',
  'አርባ አንድ', 'አርባ ሁለት', 'አርባ ሶስት', 'አርባ አራት', 'አርባ አምስት',
  'አርባ ስድስት', 'አርባ ሰባት', 'አርባ ስምንት', 'አርባ ዘጠኝ', 'ሃምሳ',
  'ሃምሳ አንድ', 'ሃምሳ ሁለት', 'ሃምሳ ሶስት', 'ሃምሳ አራት', 'ሃምሳ አምስት',
  'ሃምሳ ስድስት', 'ሃምሳ ሰባት', 'ሃምሳ ስምንት', 'ሃምሳ ዘጠኝ', 'ስልሳ',
  'ስልሳ አንድ', 'ስልሳ ሁለት', 'ስልሳ ሶስት', 'ስልሳ አራት', 'ስልሳ አምስት',
  'ስልሳ ስድስት', 'ስልሳ ሰባት', 'ስልሳ ስምንት', 'ስልሳ ዘጠኝ', 'ሰባ',
  'ሰባ አንድ', 'ሰባ ሁለት', 'ሰባ ሶስት', 'ሰባ አራት', 'ሰባ አምስት'
];

const COL_LABELS = ['B', 'I', 'N', 'G', 'O'];
const COL_RANGES = [[1,15],[16,30],[31,45],[46,60],[61,75]];

function amharicNum(n) {
  return (n >= 1 && n <= 75) ? AMHARIC_NUMS[n] : String(n);
}

function colLetter(n) {
  for (let i = 0; i < COL_RANGES.length; i++)
    if (n >= COL_RANGES[i][0] && n <= COL_RANGES[i][1]) return COL_LABELS[i];
  return '';
}

// Render a 5x5 card as a Telegram-friendly text table
function renderCard(grid, marked, calledNumbers = []) {
  const header = '┌─────────────────────────┐\n│  B    I    N    G    O  │\n├─────────────────────────┤';
  const rows = [];

  for (let row = 0; row < 5; row++) {
    const cells = [];
    for (let col = 0; col < 5; col++) {
      const val      = grid[col][row];
      const isFree   = val === 0;
      const isMarked = marked[col][row];
      const isCalled = calledNumbers.includes(val);

      if (isFree)        cells.push(' ★  ');
      else if (isMarked) cells.push(`[${String(val).padStart(2,'0')}]`);
      else if (isCalled) cells.push(`·${String(val).padStart(2,'0')}·`);
      else               cells.push(` ${String(val).padStart(2,'0')} `);
    }
    rows.push('│' + cells.join(' ') + '│');
  }

  return '```\n' + header + '\n' + rows.join('\n') + '\n└─────────────────────────┘\n```';
}

module.exports = { amharicNum, colLetter, renderCard, COL_LABELS, COL_RANGES };
