"""Sequential, read-only API baseline. This is not a concurrent load test.

Credentials are read from API_BENCHMARK_USERNAME / API_BENCHMARK_PASSWORD.
Only authentication uses POST; measured requests use GET, no response bodies are saved.
"""
import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import time

import httpx


def percentile(values: list[float], fraction: float) -> float | None:
    return round(sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)], 3) if values else None


def benchmark(base_url: str, samples: int) -> dict:
    username, password = os.getenv("API_BENCHMARK_USERNAME"), os.getenv("API_BENCHMARK_PASSWORD")
    if not username or not password:
        raise ValueError("Set API_BENCHMARK_USERNAME and API_BENCHMARK_PASSWORD")
    paths = ("/health", "/auth/me", "/patients", "/alerts/inbox?limit=20", "/analytics/engagement")
    results = []
    with httpx.Client(base_url=base_url, timeout=10, follow_redirects=False) as client:
        login = client.post("/auth/login", json={"username": username, "password": password})
        if login.status_code != 200:
            raise ValueError(f"Authentication failed (HTTP {login.status_code})")
        client.headers["Authorization"] = "Bearer " + login.json()["access_token"]
        for path in paths:
            client.get(path)  # Explicit unmeasured warm-up for the connection/query path.
            times, statuses, errors = [], {}, 0
            for _ in range(samples):
                start = time.perf_counter()
                try:
                    response = client.get(path)
                    statuses[str(response.status_code)] = statuses.get(str(response.status_code), 0) + 1
                    if response.status_code == 200:
                        times.append((time.perf_counter() - start) * 1000)
                    else:
                        errors += 1
                except httpx.HTTPError:
                    errors += 1
            results.append({"path": path, "requests": samples, "successes": len(times), "errors": errors,
                            "http_statuses": statuses, "p50_ms": percentile(times, 0.5),
                            "p95_ms": percentile(times, 0.95), "max_ms": round(max(times), 3) if times else None})
    return {"verified_at": datetime.now(timezone.utc).isoformat(), "base_url": base_url,
            "concurrency": 1, "warmup_requests_per_path": 1, "percentile_method": "nearest_rank",
            "results": results, "scope": "Warm local baseline; no clinical response SLA, concurrent capacity or production guarantee"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.samples <= 200:
        parser.error("--samples must be between 1 and 200")
    url = httpx.URL(args.base_url)
    if url.scheme not in {"http", "https"} or not url.host or url.userinfo or url.query or url.fragment:
        parser.error("Use an HTTP(S) base URL without credentials, query or fragment")
    try:
        report = benchmark(args.base_url, args.samples)
    except ValueError as error:
        parser.exit(1, str(error) + "\n")
    except Exception as error:
        parser.exit(1, f"Baseline stopped: {type(error).__name__}; response bodies and credentials suppressed\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for row in report["results"]:
        print(f'{row["path"]}: {row["successes"]}/{row["requests"]}, p50 {row["p50_ms"]}ms, p95 {row["p95_ms"]}ms')
    if any(row["errors"] for row in report["results"]):
        parser.exit(1, "Baseline contains failed requests; see status counts in report\n")


if __name__ == "__main__":
    main()
