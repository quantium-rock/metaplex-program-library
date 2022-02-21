import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createTokenAccount, getTokenRentExempt, pdaForVault } from '../common/helpers';
import { InstructionsWithAccounts } from '../types';
import {
  createWithdrawTokenFromSafetyDepositBoxInstruction,
  WithdrawTokenFromSafetyDepositBoxInstructionAccounts,
} from '../generated';
import { bignum } from '@metaplex-foundation/beet';

/**
 * Sets up a token account and required instructions that can be used as the
 * {@link WithdrawSharesFromTreasuryInstructionAccounts.destination}.
 */
// TODO(thlorenz): Copied from src/instructions/withdraw-shares-from-treasury.ts
// point those to a common utility function instead
export async function setupWithdrawFromSafetyDestinationAccount(
  connection: Connection,
  args: {
    payer: PublicKey;
    fractionMint: PublicKey;
  },
): Promise<InstructionsWithAccounts<{ destination: PublicKey; destinationPair: Keypair }>> {
  const rentExempt = await getTokenRentExempt(connection);
  const { payer, fractionMint } = args;
  const [instructions, signers, { tokenAccount: destination, tokenAccountPair: destinationPair }] =
    createTokenAccount(payer, rentExempt, fractionMint, payer);
  return [instructions, signers, { destination, destinationPair }];
}

/**
 * // TODO(thlorenz): Update this fully
 * Withdraw shares from the {@link WithdrawTokenFromSafetyDepositBox.store}.
 *
 * ### Conditions for {@link WithdrawTokenFromSafetyDepositBoxInstructionAccounts} accounts
 *
 * _Aside from the conditions outlined in detail in {@link InitVault.initVault}_ the following should hold:
 *
 * #### vault
 *
 * - state: {@link VaultState.Combined}
 *
 * #### safetyDeposit
 *
 * - vault: vault address
 * - store: store address
 *
 * #### fractionMint
 *
 * - adddress: vault.fractionMint
 *
 * #### store
 *
 * - amount: > 0 and >= amount
 *
 * #### destination
 *
 * - mint: safetyDeposit.tokenMint
 *
 *
 * _set this up via {@link setupWithdrawFromSafetyDestinationAccount}_
 *
 * ### Updates as a result of completing the Transaction
 *
 * #### destination
 *
 * - credit {@link amount}
 *
 * #### store
 *
 * - debit {@link amount}
 *
 * #### vault
 *
 * - tokenTypeCount: decremented
 * - state: if tokenTypeCount == 0 and fractionMint.supply == 0 -> {@link VaultState.Deactivated}
 *
 * @param accounts needed to withdraw
 * @param amount to withdray
 *
 * NOTE: that the {@link WithdrawTokenFromSafetyDepositBoxInstructionAccounts.transferAuthority} account is
 * derived from the {@link WithdrawTokenFromSafetyDepositBoxInstructionAccounts.vault} and does
 * not need to be provided
 */
export async function withdrawTokenFromSafetyDepositBox(
  accounts: Omit<WithdrawTokenFromSafetyDepositBoxInstructionAccounts, 'transferAuthority'>,
  amount: bignum,
) {
  const transferAuthority = await pdaForVault(accounts.vault);
  return createWithdrawTokenFromSafetyDepositBoxInstruction(
    { ...accounts, transferAuthority },
    { amountArgs: { amount } },
  );
}
