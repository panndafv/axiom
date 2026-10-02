// The hand-built SOL transfer must match @solana/web3.js byte for byte. These vectors were made
// with web3.js 1.98 (Transaction + SystemProgram.transfer, plus ComputeBudgetProgram
// .setComputeUnitPrice for the second) from the same seed, recipient and blockhash.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { buildTransfer } from '../server/transfer.js';

const { secretKey } = nacl.sign.keyPair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

test('a plain transfer matches web3.js', () => {
  const out = buildTransfer({
    secretKey,
    to: '35tSDZHhdqCYVYyWN6LRya9d98BPZMhac6cQ9TUddjkD',
    lamports: 12_345_678,
    blockhash: 'UuhfC7XbYkJHbkW1e7yGStDZugay2wQaS8WzPHZ5nX9',
  });
  assert.equal(out.wire, 'AQkjud22VZwYcnI+9qST80onH/gN0f1xEDfbCFt75ccryCgIy/p1yxFU3+fIgSRmRa6XQEtmRMR9xVaSONirBgsBAAEDebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQe99rE0CWIqCJVZbHg787+3cT1n3suVUk/m08wfjR08gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAByZFZIOiweD/Hj1ce5q52PcWNVRzkrHQ7w4tTGuKqcgBAgIAAQwCAAAATmG8AAAAAAA=');
  assert.equal(out.signature, 'BbhciNTXc2FMUktGdLnDiaNXgqa1rb1Fhdo2avdpUf91XHuJTNzWdL6kK4VAEtc6McFkq7nYrmu8qgwRHuwTzYJ');
});

test('a transfer with a priority fee matches web3.js', () => {
  const out = buildTransfer({
    secretKey,
    to: 'DMdfHcaCkmbEgMhqPtzW7x3xgiNimWxJ9Rkh1Njf6xeY',
    lamports: 1,
    blockhash: 'ckHwo3Yn9LMEBGQax4dPKcJv95ZyqpvRTqKrCfWzcrD',
    priorityMicroLamports: 10_000,
  });
  assert.equal(out.wire, 'ATFS/dyHDTJ95Ta2uonZfaIfb/ikU7UK6AB7r3pxsTqHtBVIzGeIUZI6IcKYxysGK4m/Wvmqs9HBPlzuDAHCMAoBAAIEebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmS3lU+e1WcTos216UTwl6MBWy0b+4nksEfrk9y9HtlT5QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwZGb+UhFzL/7K26csOb57yM5bvF9xJrLEObOkAAAAAJKEdmhaTD4gEgP159nLva+Rg3VnWUs9LxEC9ObYyrygIDAAkDECcAAAAAAAACAgABDAIAAAABAAAAAAAAAA==');
});

test('bad transfers are refused', () => {
  const to = bs58.encode(nacl.sign.keyPair().publicKey);
  const blockhash = bs58.encode(new Uint8Array(32).fill(7));
  assert.throws(() => buildTransfer({ secretKey, to, lamports: 0, blockhash }), /positive/);
  assert.throws(() => buildTransfer({ secretKey, to, lamports: 1.5, blockhash }), /positive/);
  assert.throws(() => buildTransfer({ secretKey, to: 'nope', lamports: 1, blockhash }), /recipient/);
  assert.throws(() => buildTransfer({ secretKey, to: bs58.encode(secretKey.slice(32)), lamports: 1, blockhash }), /itself/);
});
