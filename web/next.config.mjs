import path from 'node:path';

export default {
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  experimental: { nodeMiddleware: true },
};
