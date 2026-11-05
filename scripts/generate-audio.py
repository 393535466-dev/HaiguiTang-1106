#!/usr/bin/env python3
"""Build a pinned eSpeak NG in a temp cache and render the nine local verdicts.

No cloud service, API key, system voice, runtime TTS library or recorded voice is
used. See miniprogram/assets/audio/NOTICE.md for provenance and licence scope.
"""

import argparse
import array
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import wave


ROOT = Path(__file__).resolve().parents[1]
ESPEAK_VERSION = "1.52.0"
SONIC_COMMIT = "fbf75c3d6d846bad3bb3d456cbc5d07d9fd8c104"
SOURCES = (
    ("espeak-ng-1.52.0", "https://github.com/espeak-ng/espeak-ng/archive/refs/tags/1.52.0.tar.gz",
     "bb4338102ff3b49a81423da8a1a158b420124b055b60fa76cfb4b18677130a23"),
    ("sonic-" + SONIC_COMMIT, "https://github.com/waywardgeek/sonic/archive/" + SONIC_COMMIT + ".tar.gz",
     "715827b5a39b79e56e44397d7b845910df996d4cca74777b3b61629b1ddc98c1"),
)
PHRASES = {
    "yes": "是。",
    "no": "否。",
    "irrelevant": "无关。",
    "unspecified": "题目未设定。",
    "clarify": "请澄清。",
    "solved": "猜中了。",
    "incomplete": "还差一点。",
    "incorrect": "方向不对。",
    "uncertain": "暂无法判定。",
}


def run(args, **kwargs):
    print("Running:", " ".join(str(x) for x in args), flush=True)
    subprocess.run([str(x) for x in args], check=True, **kwargs)


def source(cache, name, url, expected):
    archive = cache / (name + ".tar.gz")
    if not archive.exists():
        partial = archive.with_suffix(".download")
        print("Downloading official source:", url, flush=True)
        with urllib.request.urlopen(url, timeout=120) as response, partial.open("wb") as dest:
            shutil.copyfileobj(response, dest)
        partial.replace(archive)
    actual = hashlib.sha256(archive.read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError("Source SHA256 mismatch for " + str(archive) + "; do not accept silently")
    directory = cache / name
    if not directory.exists():
        with tarfile.open(archive, "r:gz") as data:
            for member in data.getmembers():
                resolved = (cache / member.name).resolve()
                if cache.resolve() not in resolved.parents:
                    raise RuntimeError("Unexpected archive path: " + member.name)
                if member.issym() or member.islnk():
                    base = (cache / member.name).parent if member.issym() else cache
                    linked = (base / member.linkname).resolve()
                    if cache.resolve() not in linked.parents:
                        raise RuntimeError("Unexpected archive link: " + member.name)
            data.extractall(cache)
    return directory


def cmake_binary(cache, requested):
    if requested:
        return Path(requested).resolve()
    # Use our known version; do not modify the machine's Python or CMake install.
    tools = cache / "cmake-3.31.6"
    binary = tools / "cmake" / "data" / "bin" / "cmake"
    if not binary.exists():
        run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
             "--target", tools, "cmake==3.31.6"])
    return binary


def inspect_wav(path):
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, 22050, "NONE"):
            raise RuntimeError("Expected 22050 Hz, 16-bit, mono PCM WAV: " + str(path))
        frames = audio.getnframes()
        samples = array.array("h", audio.readframes(frames))
    if sys.byteorder != "little":
        samples.byteswap()
    peak = max(abs(x) for x in samples)
    seconds = frames / 22050
    active = sum(1 for x in samples if abs(x) > 250) / len(samples)
    if not 0.2 <= seconds <= 5 or peak < 1000 or peak >= 32767 or active < 0.03:
        raise RuntimeError("Unexpected silent, clipped or out-of-range audio: " + str(path))
    return {
        "text": PHRASES[path.stem], "file": path.name,
        "sampleRate": 22050, "channels": 1, "bitsPerSample": 16,
        "durationSeconds": round(seconds, 4), "bytes": path.stat().st_size,
        "peak": peak, "activeSampleFraction": round(active, 4),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path, default=Path(tempfile.gettempdir()) / "haiguitang-verdict-tts")
    parser.add_argument("--cmake", help="Use an existing CMake 3.x binary instead of a temp-local pip install")
    parser.add_argument("--sdk", type=Path, help="Optional macOS SDK override")
    parser.add_argument("--verify-only", action="store_true", help="Check committed WAVs without downloads or compilation")
    args = parser.parse_args()
    output = ROOT / "miniprogram" / "assets" / "audio"
    if args.verify_only:
        manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        recorded = {entry["file"]: entry for entry in manifest["files"]}
        for key in PHRASES:
            actual = inspect_wav(output / (key + ".wav"))
            expected = recorded.get(key + ".wav", {})
            if actual["sha256"] != expected.get("sha256") or actual["text"] != expected.get("text"):
                raise RuntimeError("WAV differs from recorded generation manifest: " + key)
            print(json.dumps(actual, ensure_ascii=False))
        return
    cache = args.work_dir.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    engine, sonic = [source(cache, *entry) for entry in SOURCES]
    cmake = cmake_binary(cache, args.cmake)
    build = cache / "build"
    options = ["-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=OFF", "-DBUILD_TESTING=OFF",
               "-DUSE_MBROLA=OFF", "-DUSE_LIBPCAUDIO=OFF", "-DUSE_LIBSONIC=OFF",
               "-DUSE_SPEECHPLAYER=OFF", "-DUSE_ASYNC=OFF",
               "-DFETCHCONTENT_SOURCE_DIR_SONIC-GIT=" + str(sonic)]
    if platform.system() == "Darwin":
        # The host's default 27.0 SDK can be newer than its installed linker.
        fallback = Path("/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk")
        sdk = args.sdk or (fallback if fallback.exists() else None)
        if sdk:
            options.append("-DCMAKE_OSX_SYSROOT=" + str(sdk.resolve()))
        options.append("-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0")
    run([cmake, "-S", engine, "-B", build] + options)
    run([cmake, "--build", build, "--target", "espeak-ng-bin", "data", "--parallel", "4"])
    binary = build / "src" / "espeak-ng"
    output.mkdir(parents=True, exist_ok=True)
    results = []
    for key, text in PHRASES.items():
        path = output / (key + ".wav")
        run([binary, "--path=" + str(build), "-v", "cmn", "-s", "160", "-p", "48",
             "-a", "100", "-w", path, text])
        results.append(inspect_wav(path))
    manifest = {
        "generator": "eSpeak NG", "version": ESPEAK_VERSION, "voice": "cmn",
        "voiceKind": "formant synthesis", "speed": 160, "pitch": 48, "amplitude": 100,
        "buildSources": [{"url": item[1], "sha256": item[2]} for item in SOURCES],
        "files": results,
        "verification": "WAV format, duration, non-silence and clipping checks; device listening test still required",
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Generated and structurally verified", len(results), "spoken verdict WAVs in", output)


if __name__ == "__main__":
    main()
