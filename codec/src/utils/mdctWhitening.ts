// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

const MDCT_BIN_COUNT = 96;
const AVG_FLOOR = 1e-12;
const MDCT_N = 128;
const WHITENING_REFERENCE_SAMPLE_RATE = 32000;

// Tail model fitted via:
// tools/audio/eval/fit_mdct_whitening_samplerate.py --start-bin 84 --end-bin 96
const MDCT_TAIL_POWER_A = 8.431983656386986375e+07;
const MDCT_TAIL_POWER_P = 2.141400000;

// Derived from experiments/static/data/avg.csv.
// Whitening uses bins 0..95 only (bins 96..127 are reconstructed via SBR).
const MDCT_AVG_ABS = new Float32Array([
    9.339509011520338078e+00,
    5.949760598249255850e+00,
    3.525043920527306973e+00,
    2.592122633885418193e+00,
    2.054396577331191409e+00,
    1.985932618989419973e+00,
    1.880900054998687843e+00,
    1.755311232552380307e+00,
    1.493797970481048676e+00,
    1.321468215211635266e+00,
    1.240819833835243857e+00,
    1.072895344162733577e+00,
    1.102965389978766364e+00,
    1.064781475796387156e+00,
    9.897787649451644798e-01,
    9.655357647761014794e-01,
    9.333437099838047812e-01,
    8.704531231384092793e-01,
    8.228091279076368281e-01,
    7.571012086678347019e-01,
    7.450301721229936058e-01,
    7.128693256003183487e-01,
    6.185412973485053811e-01,
    6.354298935943227811e-01,
    6.573065012423942033e-01,
    6.686631303503516310e-01,
    6.504907751670653271e-01,
    6.417153969525418722e-01,
    6.285168491039248018e-01,
    5.760645572680593851e-01,
    5.486498300906667014e-01,
    5.856690792844574389e-01,
    5.332326447467702346e-01,
    5.344622157903717863e-01,
    5.133706045853648758e-01,
    4.997707106704641911e-01,
    4.647503619713653222e-01,
    4.693071441654570464e-01,
    4.227968374010923625e-01,
    4.156710719301855983e-01,
    3.821641520743083720e-01,
    3.647348059119324137e-01,
    3.802533579929753826e-01,
    3.673939211090946899e-01,
    3.672002034236378498e-01,
    3.541283772034438670e-01,
    3.393926843105677937e-01,
    3.336357467599684323e-01,
    3.033463065089705979e-01,
    3.053006253370736389e-01,
    3.010439975889206421e-01,
    2.783762671201562289e-01,
    2.884199468017512036e-01,
    2.869691263252970859e-01,
    2.732661391203478063e-01,
    2.779683435097984878e-01,
    2.816083906074823839e-01,
    2.702103625604874160e-01,
    2.641807535823902375e-01,
    2.608786752560967592e-01,
    2.551494606833330514e-01,
    2.501821868363204304e-01,
    2.590971577607436016e-01,
    2.671457155813665163e-01,
    2.531807956492271305e-01,
    2.529241178732063999e-01,
    2.469435147525682328e-01,
    2.424749164339044527e-01,
    2.436557567207698616e-01,
    2.342370331628057523e-01,
    2.374222120051699969e-01,
    2.387761978124730011e-01,
    2.271001565110345732e-01,
    2.299501329336249567e-01,
    2.299707300587751913e-01,
    2.226486149517668822e-01,
    2.204673020820602514e-01,
    2.205697305265627850e-01,
    2.128058492755608155e-01,
    2.102004562315970271e-01,
    2.061007089356724498e-01,
    2.069527595939050224e-01,
    2.062886738363038652e-01,
    2.002667635212830033e-01,
    2.066594352803724222e-01,
    1.971016568807779645e-01,
    1.910941885821544062e-01,
    1.920386085941042098e-01,
    1.870927634297010755e-01,
    1.779728389967470403e-01,
    1.763588821639715531e-01,
    1.691362666132126269e-01,
    1.680460593897969146e-01,
    1.622682421145814902e-01,
    1.637228447513321694e-01,
    1.571532918102930276e-01,
    1.468013301424200556e-01,
    1.401910087747423872e-01,
    1.395365885754567548e-01,
    1.399152164626387140e-01,
    1.351781230846899606e-01,
    1.288492760663964287e-01,
    1.275666721835674311e-01,
    1.226018833777755418e-01,
    1.190487271476195069e-01,
    1.211366202638989170e-01,
    1.190413511608110347e-01,
    1.123425061241326711e-01,
    1.065809368719976419e-01,
    1.065889959868085435e-01,
    1.050882743389562196e-01,
    1.016936823581243016e-01,
    1.015837080561496353e-01,
    1.044537634800332543e-01,
    1.017534827100537165e-01,
    9.144733616714555147e-02,
    8.965358463856831772e-02,
    8.596942586067377046e-02,
    8.409917372523526002e-02,
    8.051129233779837080e-02,
    7.379017617642512350e-02,
    5.684605888388487988e-02,
    3.493348448749702267e-02,
    1.666912204237962561e-02,
    5.695253635177709856e-03,
    2.246239731250771442e-03,
    1.649891536806754114e-03,
    1.523230066190377164e-03,
]);

const REF_HZ_PER_BIN = WHITENING_REFERENCE_SAMPLE_RATE / (2 * MDCT_N);
const MAX_REF_BIN = MDCT_BIN_COUNT - 1;

export interface MdctWhiteningProfile {
    sampleRate: number;
    avgAbs: Float32Array;
    gain: Float32Array;
}

const profileBySampleRate = new Map<number, MdctWhiteningProfile>();

function normalizeSampleRate(sampleRate: number): number {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
        return WHITENING_REFERENCE_SAMPLE_RATE;
    }
    return Math.max(1, Math.round(sampleRate));
}

function fitTailAvgAbs(freqHz: number): number {
    return MDCT_TAIL_POWER_A * Math.pow(Math.max(freqHz, 1e-3), -MDCT_TAIL_POWER_P);
}

function buildAvgAbsForSampleRate(sampleRate: number): Float32Array {
    const out = new Float32Array(MDCT_BIN_COUNT);
    for (let k = 0; k < MDCT_BIN_COUNT; k++) {
        const freqHz = (k + 0.5) * sampleRate / (2 * MDCT_N);
        const refPos = (freqHz / REF_HZ_PER_BIN) - 0.5;

        let avgAbs: number;
        if (refPos <= 0) {
            avgAbs = MDCT_AVG_ABS[0];
        } else if (refPos < MAX_REF_BIN) {
            const i0 = Math.floor(refPos);
            const t = refPos - i0;
            avgAbs = (MDCT_AVG_ABS[i0] * (1 - t)) + (MDCT_AVG_ABS[i0 + 1] * t);
        } else if (refPos <= MAX_REF_BIN) {
            avgAbs = MDCT_AVG_ABS[MAX_REF_BIN];
        } else {
            avgAbs = fitTailAvgAbs(freqHz);
        }

        out[k] = Math.max(avgAbs, AVG_FLOOR);
    }
    return out;
}

function getAvgAbsForSampleRate(sampleRate: number): Float32Array {
    const sr = normalizeSampleRate(sampleRate);
    const cached = profileBySampleRate.get(sr);
    if (cached) return cached.avgAbs;
    return buildAvgAbsForSampleRate(sr);
}

export function getMdctWhiteningProfile(sampleRate: number): MdctWhiteningProfile {
    const sr = normalizeSampleRate(sampleRate);
    const cached = profileBySampleRate.get(sr);
    if (cached) return cached;

    const avgAbs = getAvgAbsForSampleRate(sr);
    const gain = new Float32Array(MDCT_BIN_COUNT);
    for (let k = 0; k < MDCT_BIN_COUNT; k++) {
        gain[k] = 1 / Math.max(avgAbs[k], AVG_FLOOR);
    }

    const profile: MdctWhiteningProfile = { sampleRate: sr, avgAbs, gain };
    profileBySampleRate.set(sr, profile);
    return profile;
}

export function applyMdctWhitening(buffer: Float32Array, offset = 0, sampleRate = WHITENING_REFERENCE_SAMPLE_RATE): void {
    const gains = getMdctWhiteningProfile(sampleRate).gain;
    for (let k = 0; k < MDCT_BIN_COUNT; k++) {
        buffer[offset + k] *= gains[k];
    }
}

export function reverseMdctWhitening(buffer: Float32Array, offset = 0, sampleRate = WHITENING_REFERENCE_SAMPLE_RATE): void {
    const avgAbs = getMdctWhiteningProfile(sampleRate).avgAbs;
    for (let k = 0; k < MDCT_BIN_COUNT; k++) {
        buffer[offset + k] *= avgAbs[k];
    }
}

export function applyMdctWhiteningWithProfile(buffer: Float32Array, profile: MdctWhiteningProfile, offset = 0): void {
    const gains = profile.gain;
    for (let k = 0; k < MDCT_BIN_COUNT; k++) {
        buffer[offset + k] *= gains[k];
    }
}

export function reverseMdctWhiteningWithProfile(buffer: Float32Array, profile: MdctWhiteningProfile, offset = 0): void {
    const avgAbs = profile.avgAbs;
    for (let k = 0; k < MDCT_BIN_COUNT; k++) {
        buffer[offset + k] *= avgAbs[k];
    }
}
