import test from 'tape';

import {
  Account,
  addressLabels,
  getAccount,
  initAndActivateVault,
  initVault,
  killStuckProcess,
  spokSameBignum,
  spokSamePubkey,
} from './utils';
import { Signer, Transaction } from '@solana/web3.js';
import {
  assertConfirmedTransaction,
  assertError,
  assertTransactionSummary,
  tokenBalanceFor,
} from '@metaplex-foundation/amman';
import { mintSharesToTreasury } from '../src/instructions/mint-shares-to-treasury';
import { MintFractionalSharesInstructionAccounts } from '../src/mpl-token-vault';
import spok, { Specifications } from 'spok';
import { bignum } from '@metaplex-foundation/beet';
import BN from 'bn.js';

killStuckProcess();

test('mint shares: active vault which allows further share creation, mint various sizes 0 - 5,000,000,000', async (t) => {
  // -----------------
  // Init and Activate Vault
  // -----------------
  const {
    transactionHandler,
    connection,
    accounts: initVaultAccounts,
  } = await initAndActivateVault(t, { allowFurtherShareCreation: true });
  const {
    vault,
    authority: vaultAuthority,
    vaultAuthorityPair,
    fractionMint,
    fractionTreasury,
    fractionMintAuthority,
  } = initVaultAccounts;

  addressLabels.addLabels(initVaultAccounts);

  // -----------------
  // Mint Shares
  // -----------------
  const accounts: MintFractionalSharesInstructionAccounts = {
    fractionTreasury,
    fractionMint,
    vault,
    vaultAuthority,
    mintAuthority: fractionMintAuthority,
  };
  const signers: Signer[] = [vaultAuthorityPair];

  async function runAndVerify(numberOfShares: bignum, previouslyMinted: bignum) {
    t.comment(`++++++ Minting ${numberOfShares} shares`);
    const mintSharesIx = mintSharesToTreasury(accounts, numberOfShares);

    const tx = new Transaction().add(mintSharesIx);
    const res = await transactionHandler.sendAndConfirmTransaction(tx, signers);
    assertConfirmedTransaction(t, res.txConfirmed);
    assertTransactionSummary(t, res.txSummary, {
      msgRx: [/Mint new fractional shares/i, /MintTo/i, /success/i],
    });

    const expectedTotal = new BN(numberOfShares).add(new BN(previouslyMinted));

    // Ensure the mint authority minted the tokens
    const tokenBalance = await tokenBalanceFor(connection, {
      sig: res.txSignature,
      mint: fractionMint,
      owner: fractionMintAuthority,
    });
    spok(t, tokenBalance, {
      $topic: 'tokenBalance fractionMintAuthority',
      amountPre: spokSameBignum(previouslyMinted),
      amountPost: spokSameBignum(expectedTotal),
    });

    // Ensure fractionTreasury received the tokens
    const fractionTreasuryAccount = await getAccount(connection, fractionTreasury);
    spok(t, fractionTreasuryAccount, <Specifications<Partial<Account>>>{
      $topic: 'fractionTreasuryAccount',
      address: spokSamePubkey(fractionTreasury),
      mint: spokSamePubkey(fractionMint),
      owner: spokSamePubkey(fractionMintAuthority),
      amount: spokSameBignum(expectedTotal),
    });
  }

  await runAndVerify(0, 0);
  await runAndVerify(5, 0);
  await runAndVerify(new BN('5000000000' /* 5,000,000,000 */), 5);
});

test('mint shares: active vault which does not all further share creation, fails', async (t) => {
  // -----------------
  // Init and Activate Vault
  // -----------------
  const { transactionHandler, accounts: initVaultAccounts } = await initAndActivateVault(t, {
    allowFurtherShareCreation: false,
  });
  const {
    vault,
    authority: vaultAuthority,
    vaultAuthorityPair,
    fractionMint,
    fractionTreasury,
    fractionMintAuthority,
  } = initVaultAccounts;

  addressLabels.addLabels(initVaultAccounts);

  // -----------------
  // Mint Shares
  // -----------------
  const accounts: MintFractionalSharesInstructionAccounts = {
    fractionTreasury,
    fractionMint,
    vault,
    vaultAuthority,
    mintAuthority: fractionMintAuthority,
  };
  const signers: Signer[] = [vaultAuthorityPair];

  const mintSharesIx = mintSharesToTreasury(accounts, 1);

  const tx = new Transaction().add(mintSharesIx);
  try {
    await transactionHandler.sendAndConfirmTransaction(tx, signers);
  } catch (err) {
    assertError(t, err, [
      /Mint new fractional shares/i,
      /vault does not allow the minting of new shares/i,
    ]);
  }
});

test('mint shares: inactive vault, fails', async (t) => {
  // -----------------
  // Init Vault
  // -----------------
  const { transactionHandler, accounts: initVaultAccounts } = await initVault(t, {
    allowFurtherShareCreation: true,
  });
  const {
    vault,
    authority: vaultAuthority,
    vaultAuthorityPair,
    fractionMint,
    fractionTreasury,
    fractionMintAuthority,
  } = initVaultAccounts;

  addressLabels.addLabels(initVaultAccounts);

  // -----------------
  // Mint Shares
  // -----------------
  const accounts: MintFractionalSharesInstructionAccounts = {
    fractionTreasury,
    fractionMint,
    vault,
    vaultAuthority,
    mintAuthority: fractionMintAuthority,
  };
  const signers: Signer[] = [vaultAuthorityPair];

  const mintSharesIx = mintSharesToTreasury(accounts, 1);

  const tx = new Transaction().add(mintSharesIx);
  try {
    await transactionHandler.sendAndConfirmTransaction(tx, signers);
  } catch (err) {
    assertError(t, err, [/Mint new fractional shares/i, /vault should be active/i]);
  }
});
