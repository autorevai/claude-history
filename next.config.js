const path = require('path');

/** @type {import('next').NextConfig} */
module.exports = {
  outputFileTracingRoot: path.join(__dirname),
  // Native / heavy server-only deps must not be webpack-bundled.
  // @xenova/transformers pulls onnxruntime-node (native .node binary) for local embeddings.
  serverExternalPackages: ['@xenova/transformers', 'sharp', 'onnxruntime-node'],
  experimental: { serverActions: { allowedOrigins: ['127.0.0.1:4000', 'localhost:4000'] } },
};
