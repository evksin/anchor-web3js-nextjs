"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

function getNetworkName(endpoint: string | undefined) {
  if (endpoint == null || typeof endpoint !== "string") return "custom";
  const lower = endpoint.toLowerCase();
  if (lower.includes("devnet")) return "devnet";
  if (lower.includes("testnet")) return "testnet";
  if (lower.includes("mainnet")) return "mainnet-beta";
  return "custom";
}

export function WalletStatus() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const networkName = useMemo(
    () => getNetworkName(connection?.rpcEndpoint),
    [connection?.rpcEndpoint]
  );

  useEffect(() => {
    if (!publicKey) {
      setBalance(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    connection
      .getBalance(publicKey)
      .then((lamports) => {
        if (!cancelled) {
          setBalance(lamports / LAMPORTS_PER_SOL);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBalance(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);

  const balanceLabel = !publicKey
    ? "кошелек не подключен"
    : loading
      ? "загрузка..."
      : balance === null
        ? "недоступно"
        : `${balance.toFixed(4)} SOL`;

  return (
    <div className="flex flex-col items-center gap-1 text-sm text-gray-400">
      <div>
        Сеть: <span className="text-gray-200">{networkName}</span>
      </div>
      <div>
        Баланс: <span className="text-gray-200">{balanceLabel}</span>
      </div>
    </div>
  );
}
