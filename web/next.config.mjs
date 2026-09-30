import path from 'node:path';

export default {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  experimental: { nodeMiddleware: true },
};
