#!/usr/bin/env python3
"""Rank Cloudflare IPv4 addresses using real WebSocket upgrades from this network."""

import argparse
import base64
import csv
import http.client
import ipaddress
import json
import os
import socket
import ssl
import statistics
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

IPV4_RANGES = "https://api.cloudflare.com/client/v4/ips"
DIRECT_HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def probe(host, path, ip, timeout, tls_context):
    started = time.monotonic()
    key = base64.b64encode(os.urandom(16)).decode()
    request = (
        f"GET {path} HTTP/1.1\r\nHost: {host}\r\n"
        "Connection: Upgrade\r\nUpgrade: websocket\r\n"
        f"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n\r\n"
    )
    try:
        with socket.create_connection((str(ip), 443), timeout) as tcp:
            with tls_context.wrap_socket(tcp, server_hostname=host) as tls:
                tls_ready = time.monotonic()
                tls.sendall(request.encode("ascii"))
                response = http.client.HTTPResponse(tls)
                response.begin()
                colo = response.getheader("CF-Ray", "").rpartition("-")[2].upper()
                if response.status == 101 and colo:
                    upgraded = time.monotonic()
                    return (colo, round((tls_ready - started) * 1000),
                            round((upgraded - tls_ready) * 1000),
                            round((upgraded - started) * 1000))
    except (OSError, http.client.HTTPException):
        pass
    return None


def candidates(args):
    with DIRECT_HTTP.open(IPV4_RANGES, timeout=10) as response:
        ranges = json.load(response)["result"]["ipv4_cidrs"]
    networks = [ipaddress.IPv4Network(cidr) for cidr in ranges]
    supplied = list(args.ip)
    if args.cfst_csv:
        with args.cfst_csv.open(encoding="utf-8-sig", newline="") as file:
            rows = csv.reader(file)
            next(rows, None)
            supplied.extend(row[0] for row in rows if row and row[0].strip())
    if args.record:
        try:
            supplied.extend(item[4][0] for item in socket.getaddrinfo(
                args.record, 443, socket.AF_INET, socket.SOCK_STREAM
            ))
        except socket.gaierror:
            pass
    addresses = [ipaddress.IPv4Address(value.strip()) for value in supplied]
    if not args.ip and not args.cfst_csv:
        addresses.extend(network.network_address + offset for network in networks
                         for offset in (1, network.num_addresses // 2 + 1))
    return list(dict.fromkeys(ip for ip in addresses if any(ip in net for net in networks)))


def update_record(name, winner, zone_id, token):
    base = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def request(url, method="GET", data=None):
        body = json.dumps(data).encode() if data else None
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        with DIRECT_HTTP.open(req, timeout=15) as response:
            result = json.load(response)
        if not result["success"]:
            raise ValueError("Cloudflare DNS request failed")
        return result["result"]

    query = urllib.parse.urlencode({"name": name, "type": "A"})
    records = request(f"{base}?{query}")
    if (len(records) != 1 or records[0]["name"] != name
            or records[0]["type"] != "A" or records[0]["proxied"]):
        raise ValueError("Expected exactly one DNS-only A record")
    current = records[0]
    if current["content"] != str(winner):
        updated = request(f"{base}/{current['id']}", "PATCH", {"content": str(winner)})
        if updated["content"] != str(winner):
            raise ValueError("Cloudflare returned an unexpected A record value")
    print(f"DNS {name}: {current['content']} → {winner}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True, help="WebSocket TLS SNI and Host")
    parser.add_argument("--path", required=True, help="WebSocket request path")
    parser.add_argument("--ip", action="append", default=[], help="IPv4 candidate, repeatable")
    parser.add_argument("--cfst-csv", type=Path, help="CloudflareSpeedTest result CSV")
    parser.add_argument("--colo", default="", help="Allowed Cloudflare colo codes, comma-separated")
    parser.add_argument("--attempts", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=5)
    parser.add_argument("--record", help="DNS-only hostname to include as the baseline")
    parser.add_argument("--apply", action="store_true", help="Update --record to the winner")
    args = parser.parse_args()
    if args.attempts < 2 or args.timeout <= 0 or not args.path.startswith("/"):
        parser.error("Use at least two attempts, a positive timeout, and an absolute path")
    if any(character.isspace() for character in args.host + args.path):
        parser.error("Host and path must not contain whitespace")
    args.host = args.host.encode("idna").decode("ascii")
    if args.record:
        args.record = args.record.lower().rstrip(".")
    zone_id = os.environ.get("CLOUDFLARE_ZONE_ID", "")
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if args.apply and not (args.record and zone_id and token):
        parser.error("--apply requires --record, CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN")

    allowed_colos = {colo.strip() for colo in args.colo.upper().split(",") if colo.strip()}
    ips = candidates(args)
    if not ips:
        raise SystemExit("No valid Cloudflare IPv4 candidates")
    tls = ssl.create_default_context()
    results = {ip: [] for ip in ips}
    with ThreadPoolExecutor(max_workers=12) as pool:
        for _ in range(args.attempts):
            measurements = pool.map(lambda ip: probe(args.host, args.path, ip, args.timeout, tls), ips)
            for ip, result in zip(ips, measurements):
                if result:
                    results[ip].append(result)

    qualified = []
    for ip, samples in results.items():
        colos = {sample[0] for sample in samples}
        matching = [sample for sample in samples if not allowed_colos or sample[0] in allowed_colos]
        tls_ms, upgrade_ms, latency = (
            [statistics.median(sample[index] for sample in matching) for index in (1, 2, 3)]
            if matching else (None, None, None)
        )
        print(f"{str(ip):>15}  {len(samples)}/{args.attempts} WSS  "
              f"colo={','.join(sorted(colos)) or '-'}  matched={len(matching)}  "
              f"tcp_tls_ms={tls_ms}  upgrade_ms={upgrade_ms}  median_ms={latency}")
        if len(matching) == args.attempts:
            qualified.append((latency, ip))
    if not qualified:
        raise SystemExit("No candidate passed every WebSocket test in the requested colos")
    latency, winner = min(qualified)
    print(f"Selected {winner} ({latency:g} ms median)")
    if args.apply:
        update_record(args.record, winner, zone_id, token)


if __name__ == "__main__":
    main()
