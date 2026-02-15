"use client";

import React, { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getMintLen,
  getAssociatedTokenAddressSync,
  ExtensionType,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  pack,
  type TokenMetadata,
} from "@solana/spl-token-metadata";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const DECIMALS = 9;
const FAUCET_URL = "https://faucet.solana.com";
const EXPLORER_DEVNET = "https://explorer.solana.com";

/** Преобразует ошибку в читаемую строку (никогда не [object Object]) */
function errorMessage(err: unknown): string {
  if (err == null) return "Неизвестная ошибка";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try {
    const msg = (err as { message?: string }).message;
    if (typeof msg === "string") return msg;
  } catch {
    // ignore
  }
  return String(err);
}

export function CreateToken2022Card() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [tokenName, setTokenName] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    mintAddress: string;
    signature: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createAndMint = useCallback(async () => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setError("Подключите кошелёк");
      return;
    }
    const name = tokenName.trim();
    const amountNum = Number(amount);
    if (!name) {
      setError("Введите название токена");
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Введите корректное количество (положительное число)");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const payer = wallet.publicKey;
      const mintKeypair = Keypair.generate();
      const mint = mintKeypair.publicKey;
      const mintAuthority = payer;
      const updateAuthority = payer;
      const symbol = "TKN";
      const uri = ""; // минимальный URI для метаданных

      // ——— Размер и рента аккаунта минта ———
      // Только MetadataPointer в первом аргументе; TokenMetadata — переменной длины (тип 19), только во втором аргументе.
      const metadata: TokenMetadata = {
        mint,
        name,
        symbol,
        uri,
        updateAuthority: mintAuthority,
        additionalMetadata: [],
      };
      const metadataBytes = pack(metadata);
      const mintSpaceOnlyMetadataPointer = getMintLen([
        ExtensionType.MetadataPointer,
      ]);
      const fullMintSpace = getMintLen([ExtensionType.MetadataPointer], {
        [ExtensionType.TokenMetadata]: metadataBytes.length,
      } as Record<number, number>);
      const lamports = await connection.getMinimumBalanceForRentExemption(
        fullMintSpace
      );

      // 1. CreateAccount — создание аккаунта минта (space = только MetadataPointer, lamports = рента на полный размер)
      const createAccountIx = SystemProgram.createAccount({
        fromPubkey: payer,
        newAccountPubkey: mint,
        space: mintSpaceOnlyMetadataPointer,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      });

      // 2. Initialize MetadataPointer (mint, authority, mint — метаданные на самом минте)
      const initMetadataPointerIx = createInitializeMetadataPointerInstruction(
        mint,
        mintAuthority,
        mint, // metadata address = mint (inline)
        TOKEN_2022_PROGRAM_ID
      );

      // 3. Initialize Mint (decimals, mint authority, без freeze authority = null)
      const initMintIx = createInitializeMintInstruction(
        mint,
        DECIMALS,
        mintAuthority,
        null,
        TOKEN_2022_PROGRAM_ID
      );

      // 4. Initialize TokenMetadata (name, symbol, uri) через createInitializeInstruction, programId: TOKEN_2022_PROGRAM_ID
      const initTokenMetadataIx = createInitializeInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        mint,
        metadata: mint,
        mintAuthority,
        name,
        symbol,
        uri,
        updateAuthority,
      });

      // 5. ATA для Token-2022: считаем адрес с TOKEN_2022_PROGRAM_ID и ASSOCIATED_TOKEN_PROGRAM_ID
      const ata = getAssociatedTokenAddressSync(
        mint,
        payer,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const createAtaIx = createAssociatedTokenAccountInstruction(
        payer,
        ata,
        payer,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // 6. MintTo (mint → ATA, authority, amount)
      const amountRaw = BigInt(Math.floor(amountNum * 10 ** DECIMALS));
      const mintToIx = createMintToInstruction(
        mint,
        ata,
        mintAuthority,
        amountRaw,
        [],
        TOKEN_2022_PROGRAM_ID
      );

      const transaction = new Transaction().add(
        createAccountIx,
        initMetadataPointerIx,
        initMintIx,
        initTokenMetadataIx,
        createAtaIx,
        mintToIx
      );

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      transaction.feePayer = payer;
      transaction.recentBlockhash = blockhash;

      const signature = await wallet.sendTransaction(connection, transaction, {
        signers: [mintKeypair],
        skipPreflight: true,
      });

      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      setResult({
        mintAddress: mint.toBase58(),
        signature,
      });
      toast.success("Токен создан и заминчен");
    } catch (err) {
      const msg = errorMessage(err);
      const isFunds = /insufficient|insufficient funds|0x1/i.test(msg);
      const isIncludesError = /Cannot read properties of undefined \(reading 'includes'\)/i.test(msg);
      const displayMsg = isIncludesError
        ? "Ошибка окружения кошелька или браузера. Обновите страницу, попробуйте другой браузер или переподключите кошелёк."
        : isFunds
          ? `${msg} Приложение в Devnet — получите SOL на ${FAUCET_URL}`
          : msg;
      setError(displayMsg);
      toast.error(displayMsg);
    } finally {
      setLoading(false);
    }
  }, [connection, wallet, tokenName, amount]);

  const explorerMintUrl = result
    ? `${EXPLORER_DEVNET}/address/${result.mintAddress}?cluster=devnet`
    : "";
  const explorerTxUrl = result
    ? `${EXPLORER_DEVNET}/tx/${result.signature}?cluster=devnet`
    : "";

  return (
    <Card className="w-full max-w-md mx-auto border-gray-800 bg-gray-900/70 backdrop-blur-sm shadow-xl shadow-purple-900/10">
      <CardHeader>
        <CardTitle className="text-lg">Create Token-2022</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-amber-200/90 text-sm bg-amber-950/30 border border-amber-800/50 rounded-md px-3 py-2">
          Приложение работает в <strong>Devnet</strong>. Для транзакций нужны
          Devnet SOL:{" "}
          <a
            href={FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-amber-300 hover:text-amber-200"
          >
            faucet.solana.com
          </a>
        </p>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-gray-400">Token Name</label>
          <input
            type="text"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="My Token"
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            disabled={loading}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm text-gray-400">Amount</label>
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1000"
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            disabled={loading}
          />
        </div>

        <Button
          onClick={createAndMint}
          disabled={loading || !wallet.publicKey}
          className="w-full"
        >
          {loading ? "Creating & minting…" : "Create & Mint Token"}
        </Button>

        {error && (
          <p className="text-red-400 text-sm" role="alert">
            {error}
          </p>
        )}

        {result && (
          <div className="rounded-md bg-gray-800/80 border border-gray-700 p-3 text-sm space-y-2">
            <p className="text-gray-300">
              <span className="text-gray-500">Минт:</span>{" "}
              <span className="font-mono break-all">{result.mintAddress}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={explorerMintUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline"
              >
                Открыть в Explorer (минт)
              </a>
              <a
                href={explorerTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline"
              >
                Транзакция в Explorer
              </a>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
