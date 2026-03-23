/**
 * OG Image Generator
 * Generates 1200x630 PNG battle cards for social sharing using satori + resvg
 */

let satori;
let Resvg;

async function loadDeps() {
  if (!satori) {
    const satoriModule = await import('satori');
    satori = satoriModule.default;
  }
  if (!Resvg) {
    const resvgModule = await import('@resvg/resvg-js');
    Resvg = resvgModule.Resvg;
  }
}

const RARITY_COLORS = {
  bronze: '#cd7f32',
  silver: '#c0c0c0',
  gold: '#ffd700',
  diamond: '#b9f2ff'
};

const STAT_COLORS = {
  atk: '#ff4444',
  def: '#4488ff',
  int: '#aa44ff',
  spd: '#ffcc00',
  cha: '#44ff88',
  lck: '#44ffff'
};

const STAT_LABELS = {
  atk: 'ATK',
  def: 'DEF',
  int: 'INT',
  spd: 'SPD',
  cha: 'CHA',
  lck: 'LCK'
};

function shortAddr(addr) {
  if (!addr) return '0x???';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function hashColor(addr, offset = 0) {
  const hex = addr.slice(2 + offset, 8 + offset);
  const num = parseInt(hex, 16);
  const h = num % 360;
  return `hsl(${h}, 70%, 55%)`;
}

// Helper: satori requires display:flex on every div with children
function d(style, children) {
  return { type: 'div', props: { style: { display: 'flex', ...style }, children } };
}
function t(style, text) {
  return { type: 'div', props: { style: { display: 'flex', ...style }, children: text } };
}

function buildStatBar(label, value, color) {
  return d(
    { alignItems: 'center', width: '100%', marginBottom: '4px' },
    [
      t({ width: '32px', fontSize: '11px', color: '#888', fontWeight: 'bold' }, label),
      d(
        { flex: 1, height: '12px', background: '#1a1a3a', borderRadius: '6px', overflow: 'hidden', marginLeft: '6px', marginRight: '6px' },
        [d({ width: `${value}%`, height: '100%', background: color, borderRadius: '6px' }, [])]
      ),
      t({ width: '24px', fontSize: '11px', color: '#ccc', textAlign: 'right' }, String(value))
    ]
  );
}

function buildCard(wallet, isWinner) {
  const rc = RARITY_COLORS[wallet.rarity] || RARITY_COLORS.bronze;
  const glow = isWinner ? `0 0 20px ${rc}` : 'none';

  const statBars = Object.entries(wallet.stats).map(([key, value]) =>
    buildStatBar(STAT_LABELS[key], value, STAT_COLORS[key])
  );

  return d(
    {
      flexDirection: 'column', alignItems: 'center',
      width: '420px', padding: '24px 20px',
      background: 'linear-gradient(180deg, #12122a 0%, #0d0d20 100%)',
      borderRadius: '16px', border: `2px solid ${rc}`, boxShadow: glow
    },
    [
      // Avatar
      d({ width: '64px', height: '64px', borderRadius: '50%',
        background: `linear-gradient(135deg, ${hashColor(wallet.address, 0)}, ${hashColor(wallet.address, 6)})`,
        border: `3px solid ${rc}`, marginBottom: '8px' }, []),
      // Address
      t({ fontSize: '13px', color: '#888', marginBottom: '4px' }, shortAddr(wallet.address)),
      // Title
      t({ fontSize: '16px', fontWeight: 'bold', color: rc, marginBottom: '4px' }, wallet.title),
      // Level
      t({ fontSize: '11px', color: '#ccc', marginBottom: '12px', padding: '2px 12px', borderRadius: '10px', background: '#1a1a3a' }, `LVL ${wallet.level}`),
      // Stats container
      d({ flexDirection: 'column', width: '100%' }, statBars),
      // Score
      t({ fontSize: '14px', fontWeight: 'bold', color: '#fff', marginTop: '10px' }, `Score: ${wallet.totalScore}`),
      // Portfolio
      t({ fontSize: '11px', color: '#666', marginTop: '4px' }, `$${parseFloat(wallet.portfolioValue).toLocaleString()} USD`)
    ]
  );
}

function buildBattleCard(battle) {
  const isA = battle.winner === 'a';
  const isB = battle.winner === 'b';

  let winnerText = 'DRAW!';
  let winnerColor = '#888';
  if (isA) { winnerText = `${shortAddr(battle.walletA.address)} WINS!`; winnerColor = RARITY_COLORS[battle.walletA.rarity] || '#ffd700'; }
  else if (isB) { winnerText = `${shortAddr(battle.walletB.address)} WINS!`; winnerColor = RARITY_COLORS[battle.walletB.rarity] || '#ffd700'; }

  return d(
    { flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      width: '1200px', height: '630px',
      background: 'linear-gradient(180deg, #0a0a1a 0%, #060612 100%)', padding: '20px' },
    [
      t({ fontSize: '24px', fontWeight: 'bold', color: '#fff', marginBottom: '16px', letterSpacing: '4px' }, 'WALLET BATTLE ARENA'),
      d({ alignItems: 'center', justifyContent: 'center' }, [
        buildCard(battle.walletA, isA),
        t({ fontSize: '36px', fontWeight: 'bold', color: '#ff4444', margin: '0 20px' }, 'VS'),
        buildCard(battle.walletB, isB)
      ]),
      t({ fontSize: '22px', fontWeight: 'bold', color: winnerColor, marginTop: '16px', letterSpacing: '2px' }, winnerText),
      t({ fontSize: '11px', color: '#444', marginTop: '8px' }, 'Powered by Nansen CLI')
    ]
  );
}

/**
 * Generate OG image PNG buffer for a battle
 */
async function generateOgImage(battle) {
  await loadDeps();

  const markup = buildBattleCard(battle);

  const svg = await satori(markup, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: 'sans-serif',
        data: await getDefaultFont(),
        weight: 400,
        style: 'normal'
      },
      {
        name: 'sans-serif',
        data: await getDefaultFont(true),
        weight: 700,
        style: 'normal'
      }
    ]
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 }
  });

  return resvg.render().asPng();
}

// Fetch a default font for satori (Inter from Google Fonts CDN)
let fontCache = {};
async function getDefaultFont(bold = false) {
  const weight = bold ? 700 : 400;
  if (fontCache[weight]) return fontCache[weight];

  try {
    const url = `https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-${weight}-normal.woff`;
    const response = await fetch(url);
    fontCache[weight] = await response.arrayBuffer();
  } catch (e) {
    // Fallback: create minimal font buffer (satori requires at least one font)
    // In production, bundle a font file instead
    const url = `https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiA.woff2`;
    const response = await fetch(url);
    fontCache[weight] = await response.arrayBuffer();
  }
  return fontCache[weight];
}

module.exports = { generateOgImage };
