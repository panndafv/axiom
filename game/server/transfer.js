// Builds and signs a plain SOL transfer (a legacy Solana transaction) without pulling in the
// whole Solana SDK. Only two instructions are ever used: an optional ComputeBudget priority fee
// and SystemProgram.transfer. test/transfer.test.js checks the bytes against @solana/web3.js.

import nacl from 'tweetnacl';
import bs58 from 'bs58';

const SYSTEM_PROGRAM = new Uint8Array(32); // 11111111111111111111111111111111
const COMPUTE_BUDGET_PROGRAM = bs58.decode('ComputeBudget111111111111111111111111111111');

// Solana's compact-u16 length prefix.
function shortVec(n) {
  const out = [];
  for (;;) {
    let b = n & 0x7f;
    n >>= 7;
    if (n === 0) { out.push(b); return out; }
    b |= 0x80;
    out.push(b);
  }
}

function u64le(n) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return [...b];
}

function key(base58, what) {
  let bytes;
  try {
    bytes = bs58.decode(base58);
  } catch {
    bytes = null;
  }
  if (!bytes || bytes.length !== 32) throw new Error(`${what} is not a valid Solana address`);
  return bytes;
}

// secretKey: 64 bytes (seed + public key). to: base58 address. lamports: a positive safe integer.
// blockhash: base58. priorityMicroLamports: price per compute unit, 0 for none.
// Returns the transaction signature (base58, also its id on Solscan) and the base64 wire bytes.
export function buildTransfer({ secretKey, to, lamports, blockhash, priorityMicroLamports = 0 }) {
  if (!Number.isSafeInteger(lamports) || lamports <= 0) throw new Error('lamports must be a positive whole number');
  const from = secretKey.slice(32, 64);
  const toKey = key(to, 'recipient');
  if (toKey.every((b, i) => b === from[i])) throw new Error('the pool wallet cannot pay itself');
  const recent = key(blockhash, 'blockhash');
  const priority = priorityMicroLamports > 0;

  // Account order: the signing fee payer, the writable recipient, then the read-only programs
  // (sorted the way @solana/web3.js sorts them, so the bytes match).
  const keys = [from, toKey, SYSTEM_PROGRAM, ...(priority ? [COMPUTE_BUDGET_PROGRAM] : [])];
  const instructions = [];
  if (priority) {
    // ComputeBudget SetComputeUnitPrice: [3, u64 micro-lamports]
    instructions.push({ program: 3, accounts: [], data: [3, ...u64le(priorityMicroLamports)] });
  }
  // SystemProgram Transfer: [u32 2, u64 lamports]
  instructions.push({ program: 2, accounts: [0, 1], data: [2, 0, 0, 0, ...u64le(lamports)] });

  const message = [
    1, 0, keys.length - 2, // header: 1 signer, 0 read-only signers, the programs are read-only
    ...shortVec(keys.length), ...keys.flatMap((k) => [...k]),
    ...recent,
    ...shortVec(instructions.length),
    ...instructions.flatMap((ix) => [
      ix.program,
      ...shortVec(ix.accounts.length), ...ix.accounts,
      ...shortVec(ix.data.length), ...ix.data,
    ]),
  ];
  const msg = Uint8Array.from(message);
  const signature = nacl.sign.detached(msg, secretKey);
  const wire = Uint8Array.from([...shortVec(1), ...signature, ...msg]);
  return { signature: bs58.encode(signature), wire: Buffer.from(wire).toString('base64') };
}
