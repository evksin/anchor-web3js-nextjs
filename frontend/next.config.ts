import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Снижаем нагрузку на память: тяжёлые Solana-пакеты не бандлятся на сервере
  serverExternalPackages: [
    "@solana/web3.js",
    "@solana/spl-token",
    "@solana/spl-token-metadata",
    "@coral-xyz/anchor",
  ],
};

export default nextConfig;
