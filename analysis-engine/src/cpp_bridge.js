import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calculateSweepLine } from './sweep_line.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const possibleBinaryPaths = [
  path.resolve(__dirname, '../../cpp-core/bin/sweep_line.exe'),
  path.resolve(__dirname, '../../cpp-core/build/Release/sweep_line.exe'),
  path.resolve(__dirname, '../../cpp-core/build/sweep_line.exe'),
  path.resolve(__dirname, '../../cpp-core/build/sweep_line')
];

let nativeBinaryPath = null;
for (const p of possibleBinaryPaths) {
  if (fs.existsSync(p)) {
    nativeBinaryPath = p;
    break;
  }
}

/**
 * Executes Sweep-Line Interval Union calculation.
 * Tries high-performance C++20 binary if available; otherwise falls back to pure JavaScript.
 */
export function computeIntervalUnion(parent, children = []) {
  if (nativeBinaryPath) {
    try {
      const payload = JSON.stringify({ parent, children });
      const proc = spawnSync(nativeBinaryPath, [], {
        input: payload,
        encoding: 'utf-8',
        timeout: 500
      });

      if (proc.status === 0 && proc.stdout) {
        return {
          ...JSON.parse(proc.stdout.trim()),
          engine: 'cpp20'
        };
      }
    } catch {
      // Fall through to JS fallback
    }
  }

  const jsResult = calculateSweepLine(parent, children);
  return {
    ...jsResult,
    engine: 'javascript_fallback'
  };
}

export function hasNativeBinary() {
  return nativeBinaryPath !== null;
}

export default {
  computeIntervalUnion,
  hasNativeBinary
};
