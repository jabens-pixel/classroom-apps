"""Makes the tour videos' background music: an original, upbeat 120 BPM loop, synthesized from
scratch (no samples, nothing licensed), so every tour can use it freely.
    python3 make-music.py            -> upbeat.mp3 next to this file (about 96 seconds)
Needs numpy and scipy, plus ffmpeg for the mp3. Change SEED or the progression for a different tune."""
import os, subprocess
import numpy as np
from scipy.signal import butter, sosfilt

SR, BPM = 44100, 120
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 48
N = int(BARS * BAR * SR) + SR
rng = np.random.default_rng(7)
out = os.path.dirname(os.path.abspath(__file__))

def t_(sec): return np.arange(int(sec * SR)) / SR
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)
def put(buf, sig, at):
    i = int(at * SR); j = min(len(buf), i + len(sig)); buf[i:j] += sig[: j - i]
def saw(f, t): return 2 * ((f * t) % 1) - 1
def sq(f, t, w=.5): return np.where((f * t) % 1 < w, 1.0, -1.0)

def kick():
    t = t_(.35); f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 9) + 0.25 * np.exp(-t * 300) * rng.standard_normal(len(t))
def snare():
    t = t_(.25)
    n = bp(rng.standard_normal(len(t)), 1200, 7000) * np.exp(-t * 18)
    return 0.6 * n + 0.35 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
def clap():
    t = t_(.2); n = bp(rng.standard_normal(len(t)), 900, 4000)
    env = sum(np.exp(-np.maximum(t - d, 0) * 60) * (t >= d) for d in (0, .012, .024)) * np.exp(-t * 12)
    return 0.5 * n * env
def hat(open_=False):
    t = t_(.18 if open_ else .05)
    return hp(rng.standard_normal(len(t)), 7000) * np.exp(-t * (14 if open_ else 70)) * 0.35
def bass(m, dur):
    t = t_(dur); f = hz(m)
    x = 0.6 * saw(f, t) + 0.4 * sq(f / 2, t)
    env = np.minimum(1, t * 300) * np.exp(-t * 3.5)
    return lp(x, 900) * env
def pluck(ms, dur):
    t = t_(dur); x = np.zeros(len(t))
    for m in ms:
        for d in (-0.08, 0.08): x += saw(hz(m) * 2 ** (d / 12), t)
    env = np.minimum(1, t * 400) * np.exp(-t * 9)
    return lp(x / (2 * len(ms)), 3200) * env
def lead(m, dur):
    t = t_(dur); f = hz(m) * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t * 4))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sign(np.sin(ph)) * 0.5 + 0.5 * np.sin(2 * ph)
    env = np.minimum(1, t * 200) * np.exp(-t * 2.2)
    return lp(x, 4500) * env

# I – V – vi – IV in G major, one chord per bar
PROG = [(43, [67, 71, 74]), (38, [66, 69, 74]), (40, [67, 71, 76]), (36, [67, 72, 76])]
HOOK = [  # (beat offset within 2 bars, midi note, length in beats)
    (0, 79, .5), (.5, 81, .5), (1, 83, 1), (2, 81, .5), (2.5, 79, .5), (3, 76, 1),
    (4, 74, .5), (4.5, 76, .5), (5, 79, 1.5), (6.5, 81, .5), (7, 79, 1)]

drums = np.zeros(N); bas = np.zeros(N); chords = np.zeros(N); mel = np.zeros(N)
K, S, C = kick(), snare(), clap()
for b in range(BARS):
    root, ch = PROG[b % 4]
    bar0 = b * BAR
    intro, breakdown = b < 4, 28 <= b < 32
    for q in range(4):
        at = bar0 + q * BEAT
        if not breakdown: put(drums, K, at)
        if q in (1, 3) and not intro: put(drums, S, at); put(drums, C, at)
        put(drums, hat(open_=(q == 3 and b % 2 == 1)), at + BEAT / 2)
        if not intro: put(drums, hat() * .6, at)
    if b >= 2:
        for e in range(8):   # driving eighth-note bass with octave pops
            m = root + (12 if e in (3, 7) else 0)
            put(bas, bass(m, BEAT / 2 * .95), bar0 + e * BEAT / 2)
    if not intro:
        for q in range(4):   # off-beat chord stabs
            put(chords, pluck(ch, BEAT * .45), bar0 + q * BEAT + BEAT / 2)
    if (8 <= b < 28 or 32 <= b < 46) and b % 2 == 0:
        for off, m, ln in HOOK:
            put(mel, lead(m + (12 if b >= 36 else 0) - (0 if b >= 36 else 0), ln * BEAT), bar0 + off * BEAT)

# riser into the drop after the breakdown
t = t_(4 * BAR); rise = hp(rng.standard_normal(len(t)), 2000) * (t / t[-1]) ** 2 * 0.25
put(drums, rise, 28 * BAR)

mix = 0.95 * drums + 0.75 * bas + 0.45 * chords + 0.32 * mel
# light stereo: chords and hats slightly wide
L = mix + 0.05 * np.roll(chords, 300); R = mix + 0.05 * np.roll(chords, -300)
st = np.stack([L, R], 1)
st = np.tanh(st * 1.6) / np.tanh(1.6)                       # gentle glue
n = int(BARS * BAR * SR); st = st[:n]
fade = int(1.5 * SR); st[-fade:] *= np.linspace(1, 0, fade)[:, None]
st *= 0.89 / np.max(np.abs(st))
wav = os.path.join(out, 'upbeat.wav')
import wave
with wave.open(wav, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype('<i2').tobytes())
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '160k', os.path.join(out, 'upbeat.mp3')], check=True)
os.remove(wav)
print('upbeat.mp3', round(n / SR), 's')
