/**
 * L-01/L-04: report the real native sweep-line build state instead of a
 * hardcoded path. CMake defines the target `sweep_line`; multi-config
 * generators place it in a Release/Debug subdirectory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const BUILD_COMMAND = 'cmake -S cpp-core -B cpp-core/build && cmake --build cpp-core/build --config Release';

const CANDIDATES = [
    'cpp-core/build/sweep_line.exe',
    'cpp-core/build/Release/sweep_line.exe',
    'cpp-core/build/Debug/sweep_line.exe',
    'cpp-core/build/sweep_line'
];

export function nativeCoreStatus() {
    const checkedPaths = CANDIDATES.map(relative => ({
        relative,
        exists: fs.existsSync(path.join(REPO_ROOT, relative))
    }));
    const found = checkedPaths.find(candidate => candidate.exists);

    return {
        available: Boolean(found),
        target: 'sweep_line',
        binary: found ? found.relative : null,
        expectedBinary: 'cpp-core/build/Release/sweep_line.exe',
        buildCommand: BUILD_COMMAND,
        checkedPaths
    };
}

export default nativeCoreStatus;
