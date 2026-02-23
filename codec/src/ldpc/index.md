---
order: 12
title: Low Density Parity Check (LDPC) Codes
---

The format employs Low Density Parity Check (LDPC) codes for forward error correction, providing robust data recovery from corrupted or noisy image pixels. The implementation uses systematic construction with layered Sum-Product Algorithm decoding.

## Code Structure

LDPC codes are defined by sparse parity check matrices H of dimension m*n:
- n: Total codeword length (bits)
- k: Data length (information bits)
- m: Parity length (n - k)

The format uses systematic codes with a staircase parity structure (`H = [H_d | H_p]`, where `H_p` is dual-diagonal), enabling efficient parity accumulation during encoding.

## Graph Construction

### Progressive Edge Growth (PEG)

The data portion H_d is constructed using PEG algorithm to maximize code girth:

1. Initialize bipartite graph with m check nodes and n variable nodes
2. For each data variable (0 to k-1):
   - Add 3 edges to check nodes using PEG selection
   - PEG selects check nodes that maximize shortest cycle length

### Staircase Parity Structure

The parity portion uses a dual-diagonal staircase:
- For parity variable `p_i` at column `(k + i)`, connect to check `i` (diagonal).
- For `i < m-1`, also connect `p_i` to check `(i + 1)` (sub-diagonal).
- Equivalent check-node view:
  - check `0` sees `p_0`
  - check `i` (`1..m-1`) sees `p_{i-1}` and `p_i`

This allows parity accumulation during encoding and message propagation during decoding.

## Encoding Algorithm

Systematic encoding computes parity bits p such that H * [d | p]^T = 0:

1. Initialize parity bits to 0
2. For each data bit set to 1, XOR into connected parity positions
3. Apply staircase accumulation: p_i = p_{i-1} XOR p_i for i = 1 to m-1
4. Concatenate data and parity bits

## Decoding Algorithm

### Layered Sum-Product Algorithm (SPA)

Iterative belief propagation on the bipartite graph:

1. Initialize variable LLRs with channel observations
2. Initialize check-to-variable messages R to 0
3. For each iteration (up to 50):
   - For each check node c:
     - Compute variable-to-check messages: L_vc = Lq[v] - R_old[edge]
     - Update check-to-variable messages: R_new = 2 * artanh(PRODUCT_{v != target} tanh(L_vc/2))
     - Update posterior LLRs: Lq[v] += R_new - R_old
   - Check syndrome: if H * hard_decision = 0, success

### Ordered Statistics Decoding (OSD)

Post-processing for failed SPA convergence:
1. Sort variable nodes by LLR magnitude (reliability)
2. Try flipping the 15 least reliable bits
3. Check syndrome after each flip
4. Return first valid codeword found

## Parameters

- **Header LDPC**: N=8192, K=6144 (rate 0.75)
- **Row Metadata LDPC**: N=256, K=224 (rate 0.875)
- **Binary LDPC**: N=20064, K=19840 (rate ~0.989)

## Usage in Format

LDPC provides error correction for:
- Header data (global metadata)
- Per-row audio metadata
- Binary payload data

Enabling reliable data recovery from image corruption or transmission errors.
