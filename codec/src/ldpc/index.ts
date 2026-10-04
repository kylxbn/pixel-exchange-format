// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { createRNG } from "../utils/rng";

/**
 * LDPC Implementation for Pixel Exchange Format.
 * Uses a systematic construction (H = [H_d | I]) for efficient encoding.
 * Uses Sum-Product Algorithm (Belief Propagation) with edge-list representation.
 */

const SPA_CLAMP = 1.0 - 1e-15;

const EMIT_JSON = false;

/**
 * Represents a directed edge in the bipartite graph (Check Node -> Variable Node).
 * Optimized as a tuple [checkIndex, varIndex] for compact storage.
 */
export type Edge = [number, number];

export type LDPCGraphData = {
    n: number;
    k: number;
    m: number;
    seed: number;
    edges: Edge[];
    checkNodeEdges: number[][];
    variableNodeEdges: number[][];
}

export class LDPCGraphBuilder {
    private n: number; // Total bits
    private k: number; // Data bits
    private m: number; // Parity bits
    private seed: number;

    // Graph Topology
    // We store the graph as a list of Edges.
    // We also store Adjacency Lists as indices into this Edge array.
    // This allows message passing logic to just iterate over flat arrays.
    private edges: Edge[] = [];
    private checkNodeEdges: number[][];    // [CheckIndex] -> [EdgeIndices...]
    private variableNodeEdges: number[][]; // [VarIndex]   -> [EdgeIndices...]

    public constructor(n: number, k: number, seed: number) {
        this.n = n;
        this.k = k;
        this.m = n - k;
        this.seed = seed;

        // Initialize storage
        this.edges = [];
        this.checkNodeEdges = Array.from({ length: this.m }, () => []);
        this.variableNodeEdges = Array.from({ length: this.n }, () => []);
    }

    public packGraph(): LDPCGraphData {
        const rng = createRNG(this.seed);
        const colWeight = 3;

        // 1. Construct H_p (Staircase) - Fixed Structure
        // We construct this FIRST so that the PEG algorithm accounts for these edges
        // when optimizing the data connections.
        for (let i = 0; i < this.m; i++) {
            const col = this.k + i;

            // Diagonal
            this.addEdge(i, col);

            // Sub-diagonal (Dual-Diagonal)
            if (i < this.m - 1) {
                this.addEdge(i + 1, col);
            }
        }

        // 2. Construct H_d (Data) - PEG Construction
        // Expand the graph column by column (variable by variable)
        for (let col = 0; col < this.k; col++) {
            for (let l = 0; l < colWeight; l++) {
                // Find the best check node for the l-th edge of this variable
                const bestCheck = this.pegSelectCheckNode(col, rng);
                this.addEdge(bestCheck, col);
            }
        }

        if (EMIT_JSON) {
            console.log("LdpcCode: Emitting JSON graph data...");

            const json = JSON.stringify(
                {
                    n: this.n,
                    k: this.k,
                    m: this.m,
                    seed: this.seed,
                    edges: this.edges,
                    checkNodeEdges: this.checkNodeEdges,
                    variableNodeEdges: this.variableNodeEdges
                },
                null,
                0
            );

            // I'm lazy so just dump it all on console
            console.log(json);

        }

        return {
            n: this.n,
            k: this.k,
            m: this.m,
            seed: this.seed,
            edges: this.edges,
            checkNodeEdges: this.checkNodeEdges,
            variableNodeEdges: this.variableNodeEdges
        };
    }

    private addEdge(checkIdx: number, varIdx: number) {
        const edgeIdx = this.edges.length;
        this.edges.push([checkIdx, varIdx]);
        this.checkNodeEdges[checkIdx].push(edgeIdx);
        this.variableNodeEdges[varIdx].push(edgeIdx);
    }

    private pegSelectCheckNode(varIdx: number, rng: any): number {
        // PEG (Progressive Edge-Growth) Selection
        // We want to select a check node 'c' such that adding edge (varIdx, c)
        // maximizes the length of the shortest cycle created.
        // This is equivalent to finding a check node that is "furthest" from 'varIdx' in the current graph.

        const m = this.m;
        const currentEdges = this.variableNodeEdges[varIdx];

        // If no edges yet, any check node is distance infinity. Pick min degree.
        if (currentEdges.length === 0) {
            return this.getMinDegreeCheckNode(rng);
        }

        // BFS to find distances
        const visitedChecks = new Set<number>();
        const visitedVars = new Set<number>();

        // Initialize frontier with existing connections
        let frontierChecks: number[] = [];
        for (const e of currentEdges) {
            const c = this.edges[e][0]; // checkIndex
            frontierChecks.push(c);
            visitedChecks.add(c);
        }
        visitedVars.add(varIdx);

        let checksAtMaxDepth: number[] = [...frontierChecks];

        // Expand tree
        while (frontierChecks.length > 0 && visitedChecks.size < m) {
            const nextFrontierChecks: number[] = [];
            const frontierVars: number[] = [];

            // Expand Checks -> Vars
            for (const c of frontierChecks) {
                const edges = this.checkNodeEdges[c];
                for (const e of edges) {
                    const v = this.edges[e][1]; // varIndex
                    if (!visitedVars.has(v)) {
                        visitedVars.add(v);
                        frontierVars.push(v);
                    }
                }
            }

            if (frontierVars.length === 0) break;

            // Expand Vars -> Checks
            for (const v of frontierVars) {
                const edges = this.variableNodeEdges[v];
                for (const e of edges) {
                    const c = this.edges[e][0]; // checkIndex
                    if (!visitedChecks.has(c)) {
                        visitedChecks.add(c);
                        nextFrontierChecks.push(c);
                    }
                }
            }

            if (nextFrontierChecks.length > 0) {
                checksAtMaxDepth = nextFrontierChecks;
                frontierChecks = nextFrontierChecks;
            } else {
                break;
            }
        }

        // Selection Process
        if (visitedChecks.size < m) {
            // Case 1: Not all check nodes are reachable.
            // Pick a check node from the complement set (unreachable nodes) with minimum degree.
            // This guarantees no cycles (infinite girth) relative to the current tree.
            let minDeg = Number.MAX_SAFE_INTEGER;
            const candidates: number[] = [];

            for (let c = 0; c < m; c++) {
                if (!visitedChecks.has(c)) {
                    const deg = this.checkNodeEdges[c].length;
                    if (deg < minDeg) {
                        minDeg = deg;
                        candidates.length = 0;
                        candidates.push(c);
                    } else if (deg === minDeg) {
                        candidates.push(c);
                    }
                }
            }
            return candidates[(rng.next32() >>> 0) % candidates.length];
        } else {
            // Case 2: All check nodes are reachable.
            // Pick from 'checksAtMaxDepth' (furthest away) with minimum degree.
            let minDeg = Number.MAX_SAFE_INTEGER;
            const candidates: number[] = [];

            for (const c of checksAtMaxDepth) {
                const deg = this.checkNodeEdges[c].length;
                if (deg < minDeg) {
                    minDeg = deg;
                    candidates.length = 0;
                    candidates.push(c);
                } else if (deg === minDeg) {
                    candidates.push(c);
                }
            }
            return candidates[(rng.next32() >>> 0) % candidates.length];
        }
    }

    private getMinDegreeCheckNode(rng: any): number {
        let minDeg = Number.MAX_SAFE_INTEGER;
        const candidates: number[] = [];
        for (let c = 0; c < this.m; c++) {
            const deg = this.checkNodeEdges[c].length;
            if (deg < minDeg) {
                minDeg = deg;
                candidates.length = 0;
                candidates.push(c);
            } else if (deg === minDeg) {
                candidates.push(c);
            }
        }
        const idx = (rng.next32() >>> 0) % candidates.length;
        return candidates[idx];
    }
}

/**
 * Builds a staircase graph without a search, for codes too large to ship as JSON.
 * Every data variable takes three check nodes off a shuffled deck that holds each
 * check the same number of times, which keeps the check degrees balanced. A slot is
 * skipped when it would repeat a check within the variable or put two variables on
 * the same pair of checks (a 4-cycle).
 */
export function buildDeckGraph(n: number, k: number, seed: number): LDPCGraphData {
    const m = n - k;
    const colWeight = 3;
    const rng = createRNG(seed);

    const edges: Edge[] = [];
    const checkNodeEdges: number[][] = Array.from({ length: m }, () => []);
    const variableNodeEdges: number[][] = Array.from({ length: n }, () => []);
    const addEdge = (checkIdx: number, varIdx: number) => {
        checkNodeEdges[checkIdx].push(edges.length);
        variableNodeEdges[varIdx].push(edges.length);
        edges.push([checkIdx, varIdx]);
    };

    for (let i = 0; i < m; i++) {
        addEdge(i, k + i);
        if (i < m - 1) addEdge(i + 1, k + i);
    }

    const copies = Math.ceil((colWeight * k) / m);
    const deck = new Int32Array(m * copies);
    for (let i = 0; i < deck.length; i++) deck[i] = i % m;
    for (let i = deck.length - 1; i > 0; i--) {
        const j = (rng.next32() >>> 0) % (i + 1);
        const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }

    const usedPairs = new Set<number>();
    const pairKey = (a: number, b: number) => (a < b ? a * m + b : b * m + a);
    const chosen = new Int32Array(colWeight);
    let pos = 0;

    for (let col = 0; col < k; col++) {
        for (let l = 0; l < colWeight; l++) {
            // First slot that keeps the graph free of 4-cycles, else the first that
            // is at least a new check for this variable
            let pick = -1;
            let fallback = -1;
            for (let j = pos; j < deck.length; j++) {
                const c = deck[j];
                let repeated = false;
                let shared = false;
                for (let p = 0; p < l; p++) {
                    if (chosen[p] === c) repeated = true;
                    else if (usedPairs.has(pairKey(chosen[p], c))) shared = true;
                }
                if (repeated) continue;
                if (!shared) { pick = j; break; }
                if (fallback === -1) fallback = j;
            }
            if (pick === -1) pick = fallback;

            let check: number;
            if (pick === -1) {
                // Deck exhausted of usable slots: take the next check not yet on this variable
                check = deck[pos];
                for (let p = 0; p < l; p++) {
                    if (chosen[p] === check) { check = (check + 1) % m; p = -1; }
                }
            } else {
                check = deck[pick];
                deck[pick] = deck[pos];
                deck[pos] = check;
            }
            pos++;
            chosen[l] = check;
        }
        usedPairs.add(pairKey(chosen[0], chosen[1]));
        usedPairs.add(pairKey(chosen[0], chosen[2]));
        usedPairs.add(pairKey(chosen[1], chosen[2]));
        for (let l = 0; l < colWeight; l++) addEdge(chosen[l], col);
    }

    return { n, k, m, seed, edges, checkNodeEdges, variableNodeEdges };
}

export class LdpcCode {
    private n: number; // Total bits
    private k: number; // Data bits
    private m: number; // Parity bits

    // Graph Topology
    // We store the graph as a list of Edges.
    // We also store Adjacency Lists as indices into this Edge array.
    // This allows message passing logic to just iterate over flat arrays.
    private edges: Edge[] = [];
    private checkNodeEdges: number[][];    // [CheckIndex] -> [EdgeIndices...]
    private variableNodeEdges: number[][]; // [VarIndex]   -> [EdgeIndices...]

    // The same graph flattened for the decoder: the variables of check c are
    // checkVars[checkStart[c] .. checkStart[c + 1])
    private checkStart: Int32Array;
    private checkVars: Int32Array;
    private maxCheckDegree = 0;

    public constructor(graph: LDPCGraphData) {
        this.n = graph.n;
        this.k = graph.k;
        this.m = graph.m;
        this.edges = graph.edges;
        this.checkNodeEdges = graph.checkNodeEdges;
        this.variableNodeEdges = graph.variableNodeEdges;

        this.checkStart = new Int32Array(this.m + 1);
        this.checkVars = new Int32Array(this.edges.length);
        let pos = 0;
        for (let c = 0; c < this.m; c++) {
            this.checkStart[c] = pos;
            for (const edgeIdx of this.checkNodeEdges[c]) this.checkVars[pos++] = this.edges[edgeIdx][1];
            this.maxCheckDegree = Math.max(this.maxCheckDegree, pos - this.checkStart[c]);
        }
        this.checkStart[this.m] = pos;
    }

    /**
     * Systematically encode bytes.
     * p' = H_d * d'
     */
    public encode(dataBytes: Uint8Array): Uint8Array {
        if (dataBytes.length * 8 !== this.k) {
            throw new Error(`LDPC Encode: Expected ${this.k} bits input, got ${dataBytes.length * 8}`);
        }

        const dataBits = new Uint8Array(this.k);
        for (let i = 0; i < this.k; i++) {
            dataBits[i] = (dataBytes[i >>> 3] >> (7 - (i & 7))) & 1;
        }

        const parityBits = new Uint8Array(this.m);

        // Iterate over edges connected to Data Variables to accumulate parity
        // (Since H = [Hd | I], p_i = sum(Hd_row * data))
        for (let dCol = 0; dCol < this.k; dCol++) {
            if (dataBits[dCol] === 1) {
                const edgeIndices = this.variableNodeEdges[dCol];
                for (const edgeIdx of edgeIndices) {
                    const row = this.edges[edgeIdx][0]; // checkIndex
                    parityBits[row] ^= 1;
                }
            }
        }

        // Apply Accumulator (for Dual-Diagonal / Staircase structure)
        // p_i = p_{i-1} + s_i
        for (let i = 1; i < this.m; i++) {
            parityBits[i] ^= parityBits[i - 1];
        }

        const outputLen = Math.ceil(this.n / 8);
        const output = new Uint8Array(outputLen);
        output.set(dataBytes, 0);

        let bytePos = this.k >>> 3;
        let bitPos = this.k & 7;

        for (let i = 0; i < this.m; i++) {
            if (parityBits[i]) {
                output[bytePos] |= (1 << (7 - bitPos));
            }
            bitPos++;
            if (bitPos === 8) {
                bitPos = 0;
                bytePos++;
            }
        }

        return output;
    }

    /**
     * Decode using Layered Sum-Product Algorithm (SPA).
     * Layered (Serial) scheduling converges ~2x faster than Flooding and is more robust.
     * especially for the wrapper Staircase structure which allows parity info to ripple
     * through the whole graph in one iteration.
     */
    public decode(llrs: Float32Array, maxIter: number = 50): { data: Uint8Array, corrected: boolean, osd: boolean, iter: number } {
        const n = this.n;
        const m = this.m;
        const checkStart = this.checkStart;
        const checkVars = this.checkVars;

        // Message Storage: Check-to-Variable messages (R_cv)
        // In Layered decoding, we only strictly need to store R messages.
        // Lq (Posterior LLRs) serves as the Variable-to-Check interface.
        const R = new Float32Array(checkVars.length); // Initialized to 0
        const Lq = new Float32Array(llrs);            // Initialize with Channel LLRs (Intrinsic)

        const hardDecision = new Uint8Array(n);
        const tanhs = new Float32Array(this.maxCheckDegree);

        // Number of parity checks the given hard decision fails; stops at the first when `any` is set
        const countUnsatisfiedChecks = (bits: Uint8Array, any: boolean) => {
            let count = 0;
            for (let c = 0; c < m; c++) {
                let p = 0;
                for (let e = checkStart[c]; e < checkStart[c + 1]; e++) p ^= bits[checkVars[e]];
                if (p !== 0) {
                    count++;
                    if (any) break;
                }
            }
            return count;
        };

        const decide = () => {
            for (let i = 0; i < n; i++) hardDecision[i] = Lq[i] >= 0 ? 0 : 1;
        };

        // Initial Check (Pre-Decoding)
        decide();
        if (countUnsatisfiedChecks(hardDecision, true) === 0) {
            // Channel was perfect!
            return { data: this.packData(hardDecision), corrected: true, osd: false, iter: 0 };
        }

        let iter = 0;
        for (; iter < maxIter; iter++) {

            // Layered pass: Visit each check node c
            for (let c = 0; c < m; c++) {
                const start = checkStart[c];
                const end = checkStart[c + 1];

                // 1. Compute incoming Variable-to-Check messages (L_vc = Lq[v] - R_old[edge])
                //    and the product of tanh(L_vc / 2) on the fly.
                let totalProd = 1.0;
                let zeroCount = 0;
                let firstZeroIdx = -1;

                for (let e = start; e < end; e++) {
                    let l_vc = Lq[checkVars[e]] - R[e];

                    // Numerical Stability Clamp
                    if (l_vc > 30) l_vc = 30;
                    else if (l_vc < -30) l_vc = -30;

                    const t = Math.tanh(l_vc / 2.0);
                    tanhs[e - start] = t;

                    if (Math.abs(t) < 1e-15) {
                        zeroCount++;
                        if (firstZeroIdx === -1) firstZeroIdx = e;
                    } else {
                        totalProd *= t;
                    }
                }

                // 2. Compute new R_cv messages
                for (let e = start; e < end; e++) {
                    let prodExcl = 0;
                    if (zeroCount > 1) {
                        prodExcl = 0;
                    } else if (zeroCount === 1) {
                        if (e === firstZeroIdx) prodExcl = totalProd;
                        else prodExcl = 0;
                    } else {
                        prodExcl = totalProd / tanhs[e - start];
                    }

                    if (prodExcl > SPA_CLAMP) prodExcl = SPA_CLAMP;
                    if (prodExcl < -SPA_CLAMP) prodExcl = -SPA_CLAMP;

                    const r_new = 2.0 * Math.atanh(prodExcl);

                    // 3. Update Posterior Lq immediately
                    const diff = r_new - R[e];
                    R[e] = r_new;
                    Lq[checkVars[e]] += diff;
                }
            }

            // End of full iteration check
            decide();
            if (countUnsatisfiedChecks(hardDecision, true) === 0) {
                return { data: this.packData(hardDecision), corrected: true, osd: false, iter: iter + 1 };
            }
        }

        // Post-Processing: OSD-Lite (Ordered Statistics Decoding)
        const magnitudes = new Float32Array(n);
        const indices = new Int32Array(n);

        for (let i = 0; i < n; i++) {
            magnitudes[i] = Math.abs(Lq[i]);
            indices[i] = i;
        }

        indices.sort((a, b) => magnitudes[a] - magnitudes[b]);

        const K = 15;
        for (let k = 0; k < K; k++) {
            const idx = indices[k];

            hardDecision[idx] ^= 1; // Flip

            if (countUnsatisfiedChecks(hardDecision, true) === 0) {
                return { data: this.packData(hardDecision), corrected: true, osd: true, iter: iter + k };
            }

            hardDecision[idx] ^= 1; // Backtrack
        }

        return { data: this.packData(hardDecision), osd: true, corrected: false, iter };
    }

    private packData(bits: Uint8Array): Uint8Array {
        const bytes = new Uint8Array(this.k >>> 3);
        for (let i = 0; i < bytes.length; i++) {
            let b = 0;
            for (let j = 0; j < 8; j++) {
                if (bits[i * 8 + j] === 1) b |= (1 << (7 - j));
            }
            bytes[i] = b;
        }
        return bytes;
    }
}
