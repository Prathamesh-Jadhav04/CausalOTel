# C++20 Sweep-Line Interval Union Core

High-performance native interval union module for CausalOTel distributed trace latency analysis.

## Algorithm Overview
- Clips child span intervals to parent span bounds $[s_P, e_P]$:
  $$C_i' = [\max(s_P, s_i), \min(e_P, e_i)]$$
- Performs Sweep-Line Interval Union in $\mathcal{O}(N \log N)$ time to merge overlapping or concurrent asynchronous spans.
- Computes true parent self-time:
  $$T_{\text{self}} = \max(0, (e_P - s_P) - T_{\text{child\_union}})$$

## Build Instructions (When C++20 Compiler is Present)
```bash
cmake -B build -S .
cmake --build build --config Release
```
Outputs `build/Release/sweep_line.exe` or `build/sweep_line`.

## IPC Contract
- Standard Input: JSON `{ "parent": { "start": 100, "end": 500 }, "children": [ { "start": 120, "end": 200 } ] }`
- Standard Output: JSON `{ "parentDuration": 400, "childUnionDuration": 80, "selfTime": 320, "mergedIntervals": [...] }`
