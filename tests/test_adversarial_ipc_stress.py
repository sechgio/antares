import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from backend.ipc_protocol import _try_extract_request_id_bytes


def test_adversarial_ascii_and_unicode_escaped_id_extraction():
    prefix_ascii = b'{"jsonrpc":"2.0","id":"550e8400-e29b-41d4-a716-446655440000","method":"version"}'
    assert _try_extract_request_id_bytes(prefix_ascii) == "550e8400-e29b-41d4-a716-446655440000"

    prefix_num = b'{"jsonrpc":"2.0","id":12345,"method":"version"}'
    assert _try_extract_request_id_bytes(prefix_num) == 12345

    prefix_escaped = b'{"jsonrpc":"2.0","id":"req-\\u00e9-\\u2714","method":"version"}'
    assert _try_extract_request_id_bytes(prefix_escaped) == "req-é-✔"


def test_adversarial_live_backend_burst_and_queue_saturation():
    env = os.environ.copy()
    env.update({
        "PYTHONUNBUFFERED": "1",
        "PYTHONUTF8": "1",
        "ANTARES_MAP_PROVIDER": "google",
    })

    proc = subprocess.Popen(
        [sys.executable, "-u", "backend/main.py"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(Path(__file__).resolve().parent.parent),
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )

    responses: dict[str, dict] = {}
    ready_event = threading.Event()
    all_responses_event = threading.Event()
    total_requests = 200

    def reader_stdout():
        for line in proc.stdout:
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            if data.get("method") == "ready":
                ready_event.set()
            if "id" in data:
                responses[str(data["id"])] = data
                if len(responses) >= total_requests:
                    all_responses_event.set()

    def reader_stderr():
        for _ in proc.stderr:
            pass

    t_stdout = threading.Thread(target=reader_stdout, daemon=True)
    t_stderr = threading.Thread(target=reader_stderr, daemon=True)
    t_stdout.start()
    t_stderr.start()

    try:
        assert ready_event.wait(timeout=10.0), "Timed out waiting for backend ready handshake"

        t0_burst = time.perf_counter()
        for i in range(total_requests):
            method = "version" if i % 2 == 0 else "formats"
            req = {
                "jsonrpc": "2.0",
                "id": f"burst-{i}",
                "method": method,
                "params": {},
            }
            line = json.dumps(req) + "\n"
            proc.stdin.write(line)
        proc.stdin.flush()

        assert all_responses_event.wait(timeout=10.0), f"Timed out waiting for 200 responses, got {len(responses)}"
        burst_duration_ms = (time.perf_counter() - t0_burst) * 1000
        avg_req_latency_ms = burst_duration_ms / total_requests
        throughput_req_per_sec = (total_requests / burst_duration_ms) * 1000

        sync_success = 0
        sync_rejected = 0
        light_success = 0
        light_rejected = 0

        for i in range(total_requests):
            resp = responses[f"burst-{i}"]
            is_sync = (i % 2 == 0)
            if "result" in resp:
                if is_sync:
                    sync_success += 1
                else:
                    light_success += 1
            elif "error" in resp:
                if is_sync:
                    sync_rejected += 1
                else:
                    light_rejected += 1

        print(
            f"\nBENCHMARK:ADV_PYTHON_BURST_200: total_ms={burst_duration_ms:.2f}ms, "
            f"avg_ms={avg_req_latency_ms:.3f}ms, throughput={throughput_req_per_sec:.1f} req/s\n"
            f"  sync_lane (version): {sync_success}/100 success, {sync_rejected}/100 rejected\n"
            f"  light_lane (formats): {light_success}/100 success, {light_rejected}/100 rejected (due to light_queue_limit saturation)"
        )

        assert sync_success == 100
        assert sync_rejected == 0

        assert light_success > 0
        assert (light_success + light_rejected) == 100

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
