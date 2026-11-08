#!/usr/bin/env python3
"""Forward real ModSecurity serial audit events to BAGATI's signed ingest API."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import re
import signal
import stat
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

LOG = logging.getLogger("bagati-apache-modsec")
DEFAULT_LOG = Path("/var/log/apache2/modsec_audit.log")
DEFAULT_SECRET = Path("/etc/bagati/apache-ingest.secret")
DEFAULT_STATE = Path("/var/lib/bagati-modsec/cursor.json")
MAX_RECORD_BYTES = 4 * 1024 * 1024
READ_CHUNK_BYTES = 64 * 1024
MAX_SECTION_BYTES = 64 * 1024
CURSOR_GUARD_BYTES = 128
MAX_RETRIES = 5
MAX_BACKOFF_SECONDS = 8

DELIMITER = re.compile(rb"^--([^\r\n]+)-([A-Z])--$")
AUDIT_TIME = re.compile(
    rb"^\[([0-9]{2}/[A-Za-z]{3}/[0-9]{4}:[0-9]{2}:[0-9]{2}:[0-9]{2} [+-][0-9]{4})\]\s+(.+)$"
)
RULE_ID = re.compile(r'\[id\s+"([A-Za-z0-9._:-]{1,128})"\]')
RULE_SEVERITY = re.compile(r'\[severity\s+"([^"]{1,32})"\]', re.IGNORECASE)
REQUEST_LINE = re.compile(r"^\S+\s+(\S+)\s+HTTP/[0-9.]+$")
SEVERITY_RANK = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}


class AgentError(Exception):
    """An operational error with a message safe to write to service logs."""


class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request: Request, file: Any, code: int,
                         message: str, headers: Any, new_url: str) -> None:
        return None


def _decode(value: bytes) -> str:
    return value.decode("utf-8", errors="replace")


def _append_section(sections: dict[str, bytes], section: str, line: bytes) -> None:
    if section in {"A", "B", "F"}:
        if not sections.get(section) and line.strip():
            sections[section] = line[:2048]
        return
    if section in {"H", "K"} and len(sections.get(section, b"")) < MAX_SECTION_BYTES:
        previous = sections.get(section, b"")
        remaining = MAX_SECTION_BYTES - len(previous)
        sections[section] = previous + line[:remaining] + b"\n"


def _severity(value: str) -> str:
    normalized = value.strip().upper()
    named = {
        "EMERGENCY": "CRITICAL",
        "ALERT": "CRITICAL",
        "CRITICAL": "CRITICAL",
        "ERROR": "HIGH",
        "WARNING": "MEDIUM",
        "WARN": "MEDIUM",
        "NOTICE": "LOW",
        "INFO": "LOW",
        "DEBUG": "LOW",
    }
    if normalized in named:
        return named[normalized]
    if normalized.isdigit():
        numeric = int(normalized)
        if numeric <= 1:
            return "CRITICAL"
        if numeric == 2:
            return "HIGH"
        if numeric <= 4:
            return "MEDIUM"
        if numeric <= 7:
            return "LOW"
    return "MEDIUM"


def _transaction_event(sections: dict[str, bytes]) -> dict[str, str] | None:
    audit_line = AUDIT_TIME.match(sections.get("A", b"").strip())
    if not audit_line:
        return None

    transaction_fields = audit_line.group(2).split()
    if not transaction_fields:
        return None
    transaction_id = _decode(transaction_fields[0])
    if not transaction_id or len(transaction_id) > 256:
        return None

    try:
        occurred = datetime.strptime(
            _decode(audit_line.group(1)), "%d/%b/%Y:%H:%M:%S %z"
        ).isoformat(timespec="seconds")
    except ValueError:
        return None

    source_ip = None
    if len(transaction_fields) > 1:
        candidate_ip = _decode(transaction_fields[1])
        try:
            source_ip = str(ipaddress.ip_address(candidate_ip))
        except ValueError:
            pass

    rule_text = "\n".join(_decode(sections.get(name, b"")) for name in ("H", "K"))
    rule_ids = RULE_ID.findall(rule_text)
    if not rule_ids:
        return None

    request_path = None
    request_line = _decode(sections.get("B", b"").strip())
    match = REQUEST_LINE.match(request_line)
    if match:
        target = match.group(1)
        try:
            path = urlsplit(target).path
            if (path.startswith("/") and len(path) <= 500
                    and not any(ord(char) < 32 or ord(char) == 127 for char in path)
                    and "?" not in path and "#" not in path):
                request_path = path
        except ValueError:
            pass

    severities = [_severity(value) for value in RULE_SEVERITY.findall(rule_text)]
    severity = max(severities, key=SEVERITY_RANK.get) if severities else "MEDIUM"
    message_text = _decode(sections.get("H", b""))
    action = "BLOCKED" if re.search(
        r"access denied with code", message_text, re.IGNORECASE
    ) else "OBSERVED"

    event_id = hashlib.sha256(transaction_id.encode("utf-8")).hexdigest()
    event = {
        "eventId": f"apache-{event_id}",
        "occurredAt": occurred,
        "eventType": "MODSECURITY_EVENT",
        "severity": severity,
        "action": action,
        "ruleId": rule_ids[0],
    }
    if source_ip:
        event["sourceIp"] = source_ip
    if request_path:
        event["path"] = request_path
    return event


def extract_audit_records(
    data: bytes,
) -> tuple[list[tuple[dict[str, str] | None, int, str | None]], int]:
    """Return complete serial audit transactions and the safe consumed byte count."""
    lines = data.splitlines(keepends=True)
    records: list[tuple[dict[str, str] | None, int, str | None]] = []
    current_boundary: bytes | None = None
    current_section: str | None = None
    current_start = 0
    sections: dict[str, bytes] = {}
    consumed = 0
    position = 0

    for raw_line in lines:
        line_end = position + len(raw_line)
        if not raw_line.endswith((b"\n", b"\r")):
            break
        line = raw_line.rstrip(b"\r\n")
        delimiter = DELIMITER.match(line)
        if delimiter:
            boundary, section_bytes = delimiter.groups()
            section = section_bytes.decode("ascii")
            if section == "A":
                current_boundary = boundary
                current_section = "A"
                current_start = position
                sections = {}
            elif current_boundary == boundary and section == "Z":
                oversized = line_end - current_start > MAX_RECORD_BYTES
                event = None if oversized else _transaction_event(sections)
                records.append((event, line_end, "oversized" if oversized else None))
                consumed = line_end
                current_boundary = None
                current_section = None
                sections = {}
            elif current_boundary == boundary:
                current_section = section
            elif current_boundary is None:
                consumed = line_end
        elif current_boundary is not None and current_section is not None:
            if line_end - current_start <= MAX_RECORD_BYTES:
                _append_section(sections, current_section, line)
        else:
            consumed = line_end
        position = line_end

    if current_boundary is not None:
        consumed = min(consumed, current_start)
    elif position == len(data):
        consumed = position

    return records, consumed


def make_signature(secret: bytes, timestamp: str, body: bytes) -> str:
    if not re.fullmatch(r"[0-9]{10}", timestamp):
        raise AgentError("Invalid signing timestamp.")
    return hmac.new(
        secret, timestamp.encode("ascii") + b"." + body, hashlib.sha256
    ).hexdigest()


def validate_endpoint(endpoint: str) -> None:
    try:
        parsed = urlsplit(endpoint)
        _ = parsed.port
    except ValueError as error:
        raise AgentError("Ingest endpoint is invalid.") from error
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or parsed.path != "/api/security/ingest/apache"):
        raise AgentError(
            "Ingest endpoint must be the HTTPS Apache ingest URL without credentials or query."
        )


def read_secret(secret_file: Path) -> bytes:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(secret_file, flags)
    except OSError as error:
        raise AgentError("Cannot safely open the Apache ingest secret file.") from error
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise AgentError("The Apache ingest secret must be a regular file.")
        mode = stat.S_IMODE(info.st_mode)
        if mode & 0o027 or mode & 0o007:
            raise AgentError("The Apache ingest secret file permissions are too broad.")
        if os.name == "posix" and info.st_uid != 0:
            raise AgentError("The Apache ingest secret file must be owned by root.")
        with os.fdopen(descriptor, "rb", closefd=False) as secret_handle:
            secret = secret_handle.read(4097).strip()
    finally:
        os.close(descriptor)
    if len(secret) < 32 or len(secret) > 4096:
        raise AgentError("The Apache ingest secret must contain at least 32 bytes.")
    return secret


def decode_acknowledgement(status: int, response_body: bytes) -> bool:
    if not 200 <= status < 300:
        raise AgentError(f"Ingest endpoint returned HTTP {status}.")
    try:
        result = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AgentError("Ingest endpoint returned an invalid acknowledgement.") from error
    if (not isinstance(result, dict) or result.get("accepted") is not True
            or not isinstance(result.get("duplicate"), bool)):
        raise AgentError("Ingest endpoint did not confirm event acceptance.")
    return result["duplicate"]


def post_event(
    event: dict[str, str],
    endpoint: str,
    secret: bytes,
    opener: Any = None,
    sleeper: Any = time.sleep,
) -> bool:
    validate_endpoint(endpoint)
    body = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sender = opener or build_opener(NoRedirectHandler())
    for attempt in range(MAX_RETRIES):
        timestamp = str(int(time.time()))
        request = Request(
            endpoint,
            data=body,
            headers={
                "Content-Type": "application/json",
                "x-bagati-timestamp": timestamp,
                "x-bagati-signature": make_signature(secret, timestamp, body),
            },
            method="POST",
        )
        try:
            with sender.open(request, timeout=15) as response:
                status = response.status
                response_body = response.read(4097)
            return decode_acknowledgement(status, response_body)
        except HTTPError as error:
            if error.code != 429 and error.code < 500:
                raise AgentError(
                    f"Ingest endpoint rejected an event (HTTP {error.code})."
                ) from None
            if attempt == MAX_RETRIES - 1:
                raise AgentError(
                    f"Ingest endpoint is temporarily unavailable (HTTP {error.code})."
                ) from None
        except (URLError, TimeoutError, OSError):
            if attempt == MAX_RETRIES - 1:
                raise AgentError(
                    "Could not connect to the ingest endpoint after bounded retries."
                ) from None
        sleeper(min(2 ** attempt, MAX_BACKOFF_SECONDS))
    raise AgentError("Ingest retry limit reached.")


def _file_guard(handle: Any, offset: int) -> str:
    current = handle.tell()
    start = max(0, offset - CURSOR_GUARD_BYTES)
    try:
        handle.seek(start)
        sample = handle.read(offset - start)
        if len(sample) != offset - start:
            raise AgentError("Audit log changed while validating its cursor.")
        return hashlib.sha256(sample).hexdigest()
    finally:
        handle.seek(current)


def _save_cursor(
    state_file: Path, device: int, inode: int, offset: int, guard: str,
) -> None:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(
        {
            "version": 2,
            "device": device,
            "inode": inode,
            "offset": offset,
            "guard": guard,
        },
        separators=(",", ":"),
    ).encode("ascii")
    descriptor, temporary = tempfile.mkstemp(prefix=".cursor-", dir=state_file.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as cursor:
            cursor.write(payload)
            cursor.flush()
            os.fsync(cursor.fileno())
        os.replace(temporary, state_file)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _load_cursor(state_file: Path) -> dict[str, Any] | None:
    try:
        info = state_file.stat()
        if (not stat.S_ISREG(info.st_mode)
                or (os.name == "posix" and stat.S_IMODE(info.st_mode) & 0o077)):
            raise AgentError("Cursor file must be a private regular file.")
        value = json.loads(state_file.read_text(encoding="ascii"))
    except FileNotFoundError:
        return None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AgentError("Cannot read the agent cursor safely.") from error
    if (not isinstance(value, dict)
            or any(type(value.get(key)) is not int for key in ("device", "inode", "offset"))
            or value["offset"] < 0):
        raise AgentError("Agent cursor has an invalid format; refusing to reset it.")
    if value.get("version") is None and set(value) == {"device", "inode", "offset"}:
        value["version"] = 1
        return value
    if (value.get("version") != 2
            or not isinstance(value.get("guard"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", value["guard"])):
        raise AgentError("Agent cursor has an invalid format; refusing to reset it.")
    return value


class ApacheModsecAgent:
    def __init__(
        self, log_file: Path, state_file: Path, endpoint: str,
        secret: bytes, poll_seconds: float,
    ) -> None:
        self.log_file = log_file
        self.state_file = state_file
        self.endpoint = endpoint
        self.secret = secret
        self.poll_seconds = poll_seconds
        self._handle: Any = None
        self._device = 0
        self._inode = 0
        self._offset = 0
        self._guard = ""
        self._pending = b""

    def _find_saved_log(self, device: int, inode: int) -> Path:
        parent = self.log_file.parent
        prefix = f"{self.log_file.name}."
        try:
            candidates = [self.log_file]
            candidates.extend(
                parent / entry.name
                for entry in os.scandir(parent)
                if entry.name.startswith(prefix)
            )
            for candidate in candidates:
                try:
                    info = candidate.stat(follow_symlinks=False)
                except OSError:
                    continue
                if (stat.S_ISREG(info.st_mode)
                        and info.st_dev == device and info.st_ino == inode):
                    return candidate
        except OSError as error:
            raise AgentError("Cannot locate the audit log recorded by the cursor.") from error
        raise AgentError(
            "The cursor's audit log inode is missing; refusing to skip unread events."
        )

    def _set_log(self, handle: Any, device: int, inode: int, offset: int) -> None:
        guard = _file_guard(handle, offset)
        _save_cursor(self.state_file, device, inode, offset, guard)
        handle.seek(offset)
        previous = self._handle
        self._handle = handle
        self._device = device
        self._inode = inode
        self._offset = offset
        self._guard = guard
        self._pending = b""
        if previous is not None:
            previous.close()

    def _open_log(self, initial: bool = False) -> None:
        saved = _load_cursor(self.state_file)
        if saved is None:
            if not initial:
                raise AgentError("Cannot switch logs without a durable cursor.")
            path = self.log_file
        else:
            path = self._find_saved_log(saved["device"], saved["inode"])
        handle = path.open("rb")
        try:
            info = os.fstat(handle.fileno())
            if saved is None:
                offset = info.st_size
            elif info.st_dev == saved["device"] and info.st_ino == saved["inode"]:
                offset = saved["offset"]
            else:
                raise AgentError("Located audit log does not match the saved cursor.")
            if info.st_size < offset:
                raise AgentError(
                    "Audit log was truncated below its saved cursor; refusing to skip events."
                )
            if (saved is not None and saved["version"] == 2
                    and _file_guard(handle, offset) != saved["guard"]):
                raise AgentError(
                    "Audit log contents changed at the saved cursor; "
                    "copytruncate or rewrite detected."
                )
            if saved is not None and saved["version"] == 1:
                LOG.warning(
                    "Upgrading legacy audit cursor; copytruncate before this upgrade "
                    "cannot be verified. Confirm rename/create rotation before relying on it."
                )
            self._set_log(handle, info.st_dev, info.st_ino, offset)
        except (AgentError, OSError):
            handle.close()
            raise

    def _checkpoint(self, offset: int) -> None:
        if os.fstat(self._handle.fileno()).st_size < offset:
            raise AgentError("Audit log was truncated while processing; cursor preserved.")
        guard = _file_guard(self._handle, offset)
        _save_cursor(
            self.state_file, self._device, self._inode, offset, guard
        )
        self._offset = offset
        self._guard = guard

    def _next_log_after_rotation(self) -> Path:
        active_path = self._find_saved_log(self._device, self._inode)
        prefix = f"{self.log_file.name}."
        suffix = active_path.name[len(prefix):] if active_path.name.startswith(prefix) else ""
        if suffix.isdigit():
            rotation_number = int(suffix)
            if rotation_number > 1:
                next_path = self.log_file.with_name(
                    f"{self.log_file.name}.{rotation_number - 1}"
                )
                try:
                    info = next_path.stat(follow_symlinks=False)
                except OSError as error:
                    raise AgentError(
                        "An intermediate rotated audit log is missing; refusing to skip it."
                    ) from error
                if not stat.S_ISREG(info.st_mode):
                    raise AgentError(
                        "An intermediate rotated audit log is not a regular file."
                    )
                return next_path
            return self.log_file

        try:
            with os.scandir(self.log_file.parent) as entries:
                ambiguous = [
                    entry.name for entry in entries
                    if entry.name.startswith(prefix) and entry.name != active_path.name
                ]
        except OSError as error:
            raise AgentError("Cannot inspect rotated audit log names safely.") from error
        if ambiguous:
            raise AgentError(
                "Rotated audit log order is ambiguous; refusing to skip possible events."
            )
        return self.log_file

    def _switch_to_next_log(self) -> None:
        if self._pending:
            return
        active_info = os.fstat(self._handle.fileno())
        if self._handle.tell() < active_info.st_size:
            return
        try:
            next_path = self._next_log_after_rotation()
            expected = next_path.stat(follow_symlinks=False)
            if not stat.S_ISREG(expected.st_mode):
                raise AgentError("Next audit log is not a regular file.")
            handle = next_path.open("rb")
            info = os.fstat(handle.fileno())
        except AgentError:
            raise
        except OSError as error:
            raise AgentError("Could not open the next audit log after rotation.") from error
        try:
            current_next_path = self._next_log_after_rotation()
            current_path_info = next_path.stat(follow_symlinks=False)
        except Exception:
            handle.close()
            raise
        if (current_next_path != next_path
                or info.st_dev != expected.st_dev or info.st_ino != expected.st_ino
                or current_path_info.st_dev != info.st_dev
                or current_path_info.st_ino != info.st_ino):
            handle.close()
            raise AgentError(
                "Audit log rotation changed while switching files; retrying safely."
            )
        if info.st_dev == self._device and info.st_ino == self._inode:
            handle.close()
            return
        try:
            self._set_log(handle, info.st_dev, info.st_ino, 0)
        except Exception:
            handle.close()
            raise

    def poll_once(self) -> int:
        if self._handle is None:
            try:
                self._open_log(initial=True)
            except AgentError:
                raise
            except OSError as error:
                raise AgentError(
                    "Could not open the configured audit log or private cursor."
                ) from error
        try:
            path_info = self.log_file.stat()
            active_info = os.fstat(self._handle.fileno())
        except OSError as error:
            raise AgentError(
                "Cannot inspect the configured ModSecurity audit log."
            ) from error

        if active_info.st_size < max(self._offset, self._handle.tell()):
            raise AgentError(
                "Audit log truncation detected; refusing to reset the cursor. "
                "Use rename/create rotation, not copytruncate."
            )
        if _file_guard(self._handle, self._offset) != self._guard:
            raise AgentError(
                "Audit log contents changed behind the cursor; refusing unsafe recovery. "
                "Use rename/create rotation, not copytruncate."
            )

        rotated = path_info.st_dev != self._device or path_info.st_ino != self._inode
        if (rotated and self._handle.tell() == active_info.st_size
                and not self._pending):
            self._switch_to_next_log()

        sent = 0
        while True:
            chunk = self._handle.read(READ_CHUNK_BYTES)
            if not chunk:
                break
            base_offset = self._offset
            self._pending += chunk
            records, consumed = extract_audit_records(self._pending)
            if (len(self._pending) > MAX_RECORD_BYTES + READ_CHUNK_BYTES
                    and consumed == 0 and not records):
                raise AgentError(
                    "An incomplete audit record exceeds the parser safety limit."
                )
            last_checkpoint = 0
            for event, end_offset, reason in records:
                if reason == "oversized":
                    raise AgentError(
                        "A ModSecurity audit transaction exceeds the parser safety limit; cursor preserved."
                    )
                if event is not None:
                    duplicate = post_event(event, self.endpoint, self.secret)
                    LOG.info("Accepted ModSecurity event; duplicate=%s.", duplicate)
                    sent += 1
                absolute_end = base_offset + end_offset
                try:
                    self._checkpoint(absolute_end)
                except OSError as error:
                    raise AgentError("Could not safely persist the agent cursor.") from error
                last_checkpoint = end_offset
            if consumed > last_checkpoint:
                try:
                    self._checkpoint(base_offset + consumed)
                except OSError as error:
                    raise AgentError("Could not safely persist the agent cursor.") from error
            self._pending = self._pending[consumed:]
        return sent

    def close(self) -> None:
        if self._handle:
            self._handle.close()
            self._handle = None


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log-file", type=Path, default=DEFAULT_LOG)
    parser.add_argument("--secret-file", type=Path, default=DEFAULT_SECRET)
    parser.add_argument("--state-file", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--endpoint", default=os.environ.get("BAGATI_SECURITY_INGEST_URL", ""))
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    parser.add_argument(
        "--once", action="store_true",
        help="Process currently available complete records, then exit.",
    )
    return parser.parse_args()


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _arguments()
    if not args.endpoint or args.poll_seconds <= 0:
        LOG.error("Configure a valid endpoint and positive polling interval.")
        return 2
    try:
        validate_endpoint(args.endpoint)
        secret = read_secret(args.secret_file)
        agent = ApacheModsecAgent(
            args.log_file, args.state_file, args.endpoint, secret, args.poll_seconds
        )
    except AgentError as error:
        LOG.error("%s", error)
        return 2

    stopping = False

    def request_stop(_signum: int, _frame: Any) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    try:
        while not stopping:
            try:
                agent.poll_once()
            except AgentError as error:
                LOG.error("%s", error)
                return 1
            if args.once:
                return 0
            time.sleep(args.poll_seconds)
    finally:
        agent.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
