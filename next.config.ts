import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Do not let `next dev` append its managed block to CLAUDE.md — that file is
  // this project's hand-maintained product spec. To use Next's bundled docs
  // pointer instead, set this to true (or remove it) and see
  // node_modules/next/dist/docs/01-app/02-guides/ai-agents.md.
  agentRules: false,
};

export default nextConfig;
