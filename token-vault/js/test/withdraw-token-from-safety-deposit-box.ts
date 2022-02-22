import test from 'tape';

import {
  addressLabels,
  assertCombinedVault,
  assertDeactivatedVault,
  initVault,
  killStuckProcess,
  logDebug,
  verifyTokenBalance,
} from './utils';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  assertConfirmedTransaction,
  assertTransactionSummary,
  PayerTransactionHandler,
  TokenBalances,
} from '@metaplex-foundation/amman';
import {
  activateVault,
  addTokenToInactiveVault,
  combineVault,
  CombineVaultSetup,
  SafetyDepositSetup,
  setupWithdrawFromSafetyDestinationAccount,
  withdrawTokenFromSafetyDepositBox,
  WithdrawTokenFromSafetyDepositBoxAccounts,
} from '../src/mpl-token-vault';

killStuckProcess();

async function addSafetyDeposit(
  t: test.Test,
  transactionHandler: PayerTransactionHandler,
  connection: Connection,
  vaultAuthorityPair: Keypair,
  accounts: {
    vault: PublicKey;
    payer: PublicKey;
  },
  mintAmount: number,
) {
  const { vault, payer } = accounts;
  const safetyDepositSetup = await SafetyDepositSetup.create(connection, {
    payer,
    vault,
    mintAmount,
  });

  addressLabels.findAndAddLabels(safetyDepositSetup);

  const addTokenIx = await addTokenToInactiveVault(safetyDepositSetup, {
    payer,
    vaultAuthority: vaultAuthorityPair.publicKey,
  });
  const tx = new Transaction().add(...safetyDepositSetup.instructions).add(addTokenIx);
  const signers = [
    ...safetyDepositSetup.signers,
    safetyDepositSetup.transferAuthorityPair,
    vaultAuthorityPair,
  ];

  const res = await transactionHandler.sendAndConfirmTransaction(tx, signers);
  assertConfirmedTransaction(t, res.txConfirmed);

  return safetyDepositSetup;
}

async function activateAndCombineVault(
  t: test.Test,
  transactionHandler: PayerTransactionHandler,
  connection: Connection,
  vaultAuthorityPair: Keypair,
  accounts: {
    vault: PublicKey;
    fractionMint: PublicKey;
    fractionTreasury: PublicKey;
    redeemTreasury: PublicKey;
    priceMint: PublicKey;
    pricingLookupAddress: PublicKey;
    payer: PublicKey;
  },
) {
  const {
    vault,
    fractionMint,
    fractionTreasury,
    redeemTreasury,
    priceMint,
    pricingLookupAddress,
    payer,
  } = accounts;
  const activateVaultIx = await activateVault(
    vault,
    {
      vault,
      vaultAuthority: vaultAuthorityPair.publicKey,
      fractionMint,
      fractionTreasury,
    },
    0,
  );
  const combineSetup: CombineVaultSetup = await CombineVaultSetup.create(connection, {
    vault,
    vaultAuthority: vaultAuthorityPair.publicKey,
    fractionMint,
    fractionTreasury,
    redeemTreasury,
    priceMint,
    externalPricing: pricingLookupAddress,
  });
  await combineSetup.createOutstandingShares(payer);
  await combineSetup.createPayment(payer);
  combineSetup.approveTransfers(payer);
  combineSetup.assertComplete();

  addressLabels.findAndAddLabels(combineSetup);

  const combineIx = await combineVault(combineSetup);

  const tx = new Transaction()
    .add(activateVaultIx)
    .add(...combineSetup.instructions)
    .add(combineIx);
  const res = await transactionHandler.sendAndConfirmTransaction(tx, [
    ...combineSetup.signers,
    combineSetup.transferAuthorityPair,
    vaultAuthorityPair,
  ]);

  assertConfirmedTransaction(t, res.txConfirmed);
}

async function combinedVaultWithOneDeposit(t: test.Test, tokenAmount: number) {
  const {
    transactionHandler,
    connection,
    accounts: initVaultAccounts,
  } = await initVault(t, { allowFurtherShareCreation: true });
  const { vaultAuthorityPair } = initVaultAccounts;

  const safetyDeposit = await addSafetyDeposit(
    t,
    transactionHandler,
    connection,
    vaultAuthorityPair,
    initVaultAccounts,
    tokenAmount,
  );

  await activateAndCombineVault(
    t,
    transactionHandler,
    connection,
    vaultAuthorityPair,
    initVaultAccounts,
  );
  return {
    transactionHandler,
    connection,
    safetyDeposit,
    initVaultAccounts,
  };
}

test('combined vault: with one safety deposit, withdraw all tokens', async (t) => {
  const TOKEN_AMOUNT = 2;
  const { transactionHandler, connection, safetyDeposit, initVaultAccounts } =
    await combinedVaultWithOneDeposit(t, TOKEN_AMOUNT);

  const {
    payer,
    vault,
    authority: vaultAuthority,
    vaultAuthorityPair,
    fractionMint,
  } = initVaultAccounts;

  const [setupDestinationIxs, setupDestinationSigners, { destination }] =
    await setupWithdrawFromSafetyDestinationAccount(connection, {
      payer,
      mint: safetyDeposit.tokenMint,
    });
  addressLabels.addLabels({ destination });

  const accounts: WithdrawTokenFromSafetyDepositBoxAccounts = {
    destination,
    fractionMint,
    vault,
    vaultAuthority,
    store: safetyDeposit.store,
    safetyDeposit: safetyDeposit.safetyDeposit,
  };
  const withdrawIx = await withdrawTokenFromSafetyDepositBox(accounts, TOKEN_AMOUNT);

  const signers = [...setupDestinationSigners, vaultAuthorityPair];
  const tx = new Transaction().add(...setupDestinationIxs).add(withdrawIx);
  const res = await transactionHandler.sendAndConfirmTransaction(tx, signers);
  assertConfirmedTransaction(t, res.txConfirmed);
  assertTransactionSummary(t, res.txSummary, {
    msgRx: [/Withdraw Token from Safety Deposit Box/i, /Transfer/i, /success/i],
  });

  const tokens = await TokenBalances.forTransaction(
    connection,
    res.txSignature,
    addressLabels,
  ).dump(logDebug);

  await verifyTokenBalance(t, tokens, safetyDeposit.store, safetyDeposit.tokenMint, 2, 0);
  await verifyTokenBalance(t, tokens, destination, safetyDeposit.tokenMint, 0, 2);

  await assertDeactivatedVault(t, connection, initVaultAccounts, {
    allowFurtherShareCreation: true,
  });
});

test('combined vault: with one safety deposit, withdraw half of all tokens', async (t) => {
  const TOKEN_AMOUNT = 2;
  const { transactionHandler, connection, safetyDeposit, initVaultAccounts } =
    await combinedVaultWithOneDeposit(t, TOKEN_AMOUNT);

  const {
    payer,
    vault,
    authority: vaultAuthority,
    vaultAuthorityPair,
    fractionMint,
  } = initVaultAccounts;

  const [setupDestinationIxs, setupDestinationSigners, { destination }] =
    await setupWithdrawFromSafetyDestinationAccount(connection, {
      payer,
      mint: safetyDeposit.tokenMint,
    });
  addressLabels.addLabels({ destination });

  const accounts: WithdrawTokenFromSafetyDepositBoxAccounts = {
    destination,
    fractionMint,
    vault,
    vaultAuthority,
    store: safetyDeposit.store,
    safetyDeposit: safetyDeposit.safetyDeposit,
  };
  const withdrawIx = await withdrawTokenFromSafetyDepositBox(accounts, TOKEN_AMOUNT / 2);

  const signers = [...setupDestinationSigners, vaultAuthorityPair];
  const tx = new Transaction().add(...setupDestinationIxs).add(withdrawIx);
  const res = await transactionHandler.sendAndConfirmTransaction(tx, signers);
  assertConfirmedTransaction(t, res.txConfirmed);
  assertTransactionSummary(t, res.txSummary, {
    msgRx: [/Withdraw Token from Safety Deposit Box/i, /Transfer/i, /success/i],
  });

  const tokens = await TokenBalances.forTransaction(
    connection,
    res.txSignature,
    addressLabels,
  ).dump(logDebug);

  await verifyTokenBalance(t, tokens, safetyDeposit.store, safetyDeposit.tokenMint, 2, 1);
  await verifyTokenBalance(t, tokens, destination, safetyDeposit.tokenMint, 0, 1);

  await assertCombinedVault(t, connection, initVaultAccounts, {
    allowFurtherShareCreation: true,
    tokenTypeCount: 1,
  });
});
