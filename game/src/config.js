// Client settings. Everything here can be set at build time with VITE_* env vars (see .env.example);
// when the game server is reachable, /api/config overrides the token details so they live in one place.
const env = import.meta.env;

export const CONFIG = {
  gameName: env.VITE_GAME_NAME || 'Drift',
  tokenSymbol: env.VITE_TOKEN_SYMBOL || 'DRIFT',
  tokenMint: env.VITE_TOKEN_MINT || '',
  buyUrl: env.VITE_BUY_URL || '',
  xUrl: env.VITE_X_URL || 'https://x.com/driftgamesol',
  apiUrl: (env.VITE_API_URL || '').replace(/\/$/, ''),
  minHoldUsd: 30,
  earnGate: 10,
  explorerUrl: (mint) => `https://solscan.io/token/${mint}`,
  cluster: 'mainnet',
  autoPayouts: false,
  txUrl: (sig) => `https://solscan.io/tx/${sig}${CONFIG.cluster === 'devnet' ? '?cluster=devnet' : ''}`,
};

export function applyServerConfig(cfg) {
  if (!cfg) return;
  if (cfg.gameName) CONFIG.gameName = cfg.gameName;
  if (cfg.tokenSymbol) CONFIG.tokenSymbol = cfg.tokenSymbol;
  if (cfg.tokenMint) CONFIG.tokenMint = cfg.tokenMint;
  if (Number.isFinite(cfg.minHoldUsd)) CONFIG.minHoldUsd = cfg.minHoldUsd;
  if (Number.isFinite(cfg.earnGate)) CONFIG.earnGate = cfg.earnGate;
  if (cfg.cluster) CONFIG.cluster = cfg.cluster;
  CONFIG.autoPayouts = !!cfg.autoPayouts;
}
