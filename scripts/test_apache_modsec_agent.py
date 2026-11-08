import hashlib
import hmac
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

from apache_modsec_agent import (
    ApacheModsecAgent,
    AgentError,
    decode_acknowledgement,
    extract_audit_records,
    make_signature,
    post_event,
    validate_endpoint,
)


def audit_record(transaction_id="test-transaction-1", access_denied=True):
    denial = "Access denied with code 403 (phase 2)." if access_denied else "Matched rule."
    return (
        f"--boundary-{transaction_id}-A--\n"
        "[17/Oct/2026:13:57:36 +0000] "
        f"{transaction_id} 192.0.2.44 51234 198.51.100.8 443\n"
        f"--boundary-{transaction_id}-B--\n"
        "GET /account/login?token=must-not-leak HTTP/1.1\n"
        "Host: example.invalid\n"
        f"--boundary-{transaction_id}-H--\n"
        f'Message: Warning. {denial} [id "949110"] '
        '[msg "Example test rule"] [severity "CRITICAL"]\n'
        f"--boundary-{transaction_id}-Z--\n"
    ).encode("utf-8")


class ApacheModsecAgentTests(unittest.TestCase):
    def test_hmac_uses_timestamp_dot_exact_utf8_body(self):
        secret = b"test-secret-with-at-least-32-bytes"
        timestamp = "1792245456"
        body = '{"eventId":"event-1","path":"/hello"}'.encode("utf-8")
        expected = hmac.new(
            secret, timestamp.encode("ascii") + b"." + body, hashlib.sha256
        ).hexdigest()
        self.assertEqual(make_signature(secret, timestamp, body), expected)
        self.assertEqual(len(expected), 64)

    def test_signature_rejects_non_ten_digit_timestamp(self):
        with self.assertRaises(AgentError):
            make_signature(b"x" * 32, "123", b"{}")

    def test_endpoint_requires_exact_https_ingest_path_without_credentials(self):
        validate_endpoint("https://shopbagati.com/api/security/ingest/apache")
        for endpoint in (
            "http://shopbagati.com/api/security/ingest/apache",
            "https://shopbagati.com/other",
            "https://user:password@shopbagati.com/api/security/ingest/apache",
            "https://shopbagati.com/api/security/ingest/apache?token=secret",
        ):
            with self.subTest(endpoint=endpoint):
                with self.assertRaises(AgentError):
                    validate_endpoint(endpoint)

    def test_audit_parser_emits_only_normalized_rule_metadata(self):
        record = audit_record()
        records, consumed = extract_audit_records(record)
        self.assertEqual(consumed, len(record))
        self.assertEqual(len(records), 1)
        event, end, reason = records[0]
        self.assertEqual(end, len(record))
        self.assertIsNone(reason)
        self.assertEqual(event["sourceIp"], "192.0.2.44")
        self.assertEqual(event["path"], "/account/login")
        self.assertEqual(event["eventType"], "MODSECURITY_EVENT")
        self.assertEqual(event["severity"], "CRITICAL")
        self.assertEqual(event["action"], "BLOCKED")
        self.assertEqual(event["ruleId"], "949110")
        serialized = json.dumps(event)
        self.assertNotIn("token", serialized)
        self.assertNotIn("Host", serialized)
        self.assertNotIn("Example test rule", serialized)

    def test_audit_parser_does_not_invent_nonexistent_rule_events(self):
        record = audit_record(access_denied=False).replace(
            b'[id "949110"] ', b'[msg "message without a rule id"] '
        )
        records, consumed = extract_audit_records(record)
        self.assertEqual(consumed, len(record))
        self.assertIsNone(records[0][0])

    def test_event_id_is_stable_for_duplicate_audit_transaction(self):
        first, _ = extract_audit_records(audit_record())
        duplicate, _ = extract_audit_records(audit_record())
        self.assertEqual(first[0][0]["eventId"], duplicate[0][0]["eventId"])

    def test_oversized_audit_record_is_not_forwarded_or_checkpointed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log_file = root / "modsec_audit.log"
            state_file = root / "state" / "cursor.json"
            log_file.write_bytes(b"")
            agent = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                agent.poll_once()
                initial_offset = json.loads(state_file.read_text())["offset"]
                with log_file.open("ab") as log:
                    log.write(audit_record())
                with patch("apache_modsec_agent.MAX_RECORD_BYTES", 100):
                    with patch("apache_modsec_agent.post_event") as send:
                        with self.assertRaisesRegex(AgentError, "cursor preserved"):
                            agent.poll_once()
                send.assert_not_called()
                self.assertEqual(json.loads(state_file.read_text())["offset"], initial_offset)
            finally:
                agent.close()

    def test_incomplete_record_is_retained_for_later_append(self):
        record = audit_record()
        split = record.index(b"--boundary-test-transaction-1-H--")
        partial_records, consumed = extract_audit_records(record[:split])
        self.assertEqual(partial_records, [])
        self.assertEqual(consumed, 0)
        complete_records, complete_consumed = extract_audit_records(
            record[:split] + record[split:]
        )
        self.assertEqual(len(complete_records), 1)
        self.assertEqual(complete_consumed, len(record))

    def test_duplicate_acknowledgement_is_successful_idempotent_delivery(self):
        body = b'{"accepted":true,"duplicate":true}'
        self.assertTrue(decode_acknowledgement(200, body))

    def test_invalid_acknowledgement_and_http_status_are_rejected(self):
        with self.assertRaises(AgentError):
            decode_acknowledgement(200, b'{"accepted":false,"duplicate":false}')
        with self.assertRaises(AgentError):
            decode_acknowledgement(401, b"{}")
        with self.assertRaises(AgentError):
            decode_acknowledgement(200, b"not-json")

    def test_connection_failure_is_retried_and_exact_body_is_signed(self):
        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self, _limit):
                return b'{"accepted":true,"duplicate":false}'

        class Opener:
            def __init__(self):
                self.calls = 0
                self.request = None

            def open(self, request, timeout):
                self.calls += 1
                self.asserted_timeout = timeout
                if self.calls == 1:
                    raise URLError("test connection failure")
                self.request = request
                return Response()

        opener = Opener()
        delays = []
        event = {
            "eventId": "apache-test",
            "occurredAt": "2026-10-17T13:57:36+00:00",
            "eventType": "MODSECURITY_EVENT",
            "severity": "HIGH",
            "action": "OBSERVED",
            "ruleId": "949110",
        }
        self.assertFalse(post_event(
            event,
            "https://shopbagati.com/api/security/ingest/apache",
            b"test-secret-with-at-least-32-bytes",
            opener=opener,
            sleeper=delays.append,
        ))
        self.assertEqual(opener.calls, 2)
        self.assertEqual(delays, [1])
        self.assertEqual(opener.asserted_timeout, 15)
        headers = {key.lower(): value for key, value in opener.request.header_items()}
        body = opener.request.data
        self.assertEqual(
            headers["x-bagati-signature"],
            make_signature(
                b"test-secret-with-at-least-32-bytes",
                headers["x-bagati-timestamp"],
                body,
            ),
        )

    def test_agent_tails_new_records_and_persists_accepted_cursor(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log_file = root / "modsec_audit.log"
            state_file = root / "state" / "cursor.json"
            log_file.write_bytes(b"older existing log data\n")
            agent = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                self.assertEqual(agent.poll_once(), 0)
                initial_offset = json.loads(state_file.read_text())["offset"]
                self.assertEqual(initial_offset, log_file.stat().st_size)
                with log_file.open("ab") as log:
                    log.write(audit_record())
                with patch("apache_modsec_agent.post_event", return_value=False) as send:
                    self.assertEqual(agent.poll_once(), 1)
                self.assertEqual(send.call_count, 1)
                self.assertEqual(
                    json.loads(state_file.read_text())["offset"],
                    log_file.stat().st_size,
                )
            finally:
                agent.close()

    def test_failed_delivery_keeps_cursor_for_safe_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log_file = root / "modsec_audit.log"
            state_file = root / "state" / "cursor.json"
            log_file.write_bytes(b"")
            agent = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                agent.poll_once()
                initial_offset = json.loads(state_file.read_text())["offset"]
                with log_file.open("ab") as log:
                    log.write(audit_record())
                with patch(
                    "apache_modsec_agent.post_event",
                    side_effect=AgentError("safe test failure"),
                ):
                    with self.assertRaises(AgentError):
                        agent.poll_once()
                self.assertEqual(json.loads(state_file.read_text())["offset"], initial_offset)
            finally:
                agent.close()

            retry = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                with patch("apache_modsec_agent.post_event", return_value=True) as send:
                    self.assertEqual(retry.poll_once(), 1)
                self.assertEqual(send.call_count, 1)
            finally:
                retry.close()

    def test_rotation_drains_open_inode_before_switching_to_new_log(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log_file = root / "modsec_audit.log"
            new_log_file = root / "new-modsec-audit.log"
            state_file = root / "state" / "cursor.json"
            log_file.write_bytes(b"")
            new_log_file.write_bytes(audit_record("new-1"))
            agent = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                agent.poll_once()
                old_records = audit_record("old-1") + audit_record("old-2")
                with log_file.open("ab") as old_log:
                    old_log.write(old_records)
                agent.log_file = new_log_file

                with patch("apache_modsec_agent.post_event", return_value=False) as send:
                    self.assertEqual(agent.poll_once(), 2)
                    self.assertEqual(
                        [call.args[0]["eventId"] for call in send.call_args_list],
                        [
                            "apache-" + hashlib.sha256(b"old-1").hexdigest(),
                            "apache-" + hashlib.sha256(b"old-2").hexdigest(),
                        ],
                    )
                    with patch.object(agent, "_find_saved_log", return_value=log_file):
                        self.assertEqual(agent.poll_once(), 1)
                    self.assertEqual(
                        send.call_args.args[0]["eventId"],
                        "apache-" + hashlib.sha256(b"new-1").hexdigest(),
                    )
            finally:
                agent.close()

    def test_incomplete_old_record_is_finished_before_rotation_switch(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log_file = root / "modsec_audit.log"
            new_log_file = root / "new-modsec-audit.log"
            state_file = root / "state" / "cursor.json"
            log_file.write_bytes(b"")
            new_log_file.write_bytes(audit_record("new-after-partial"))
            agent = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                agent.poll_once()
                record = audit_record("old-partial")
                split_at = record.index(b"--boundary-old-partial-Z--")
                with log_file.open("ab") as old_log:
                    old_log.write(record[:split_at])
                agent.log_file = new_log_file

                with patch("apache_modsec_agent.post_event", return_value=False) as send:
                    self.assertEqual(agent.poll_once(), 0)
                    send.assert_not_called()
                    with log_file.open("ab") as old_log:
                        old_log.write(record[split_at:])
                    self.assertEqual(agent.poll_once(), 1)
                    self.assertEqual(
                        send.call_args.args[0]["eventId"],
                        "apache-" + hashlib.sha256(b"old-partial").hexdigest(),
                    )
                    with patch.object(agent, "_find_saved_log", return_value=log_file):
                        self.assertEqual(agent.poll_once(), 1)
                    self.assertEqual(
                        send.call_args.args[0]["eventId"],
                        "apache-" + hashlib.sha256(b"new-after-partial").hexdigest(),
                    )
            finally:
                agent.close()

    def test_restart_finds_and_resumes_unread_renamed_inode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log_file = root / "modsec_audit.log"
            rotated = root / "modsec_audit.log.1"
            state_file = root / "state" / "cursor.json"
            log_file.write_bytes(b"")
            first = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            first.poll_once()
            with log_file.open("ab") as old_log:
                old_log.write(audit_record("restart-old"))
            first.close()
            log_file.rename(rotated)
            log_file.write_bytes(audit_record("restart-new"))

            resumed = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                with patch("apache_modsec_agent.post_event", return_value=False) as send:
                    self.assertEqual(resumed.poll_once(), 1)
                    self.assertEqual(
                        send.call_args.args[0]["eventId"],
                        "apache-" + hashlib.sha256(b"restart-old").hexdigest(),
                    )
                    self.assertEqual(resumed.poll_once(), 1)
                    self.assertEqual(
                        send.call_args.args[0]["eventId"],
                        "apache-" + hashlib.sha256(b"restart-new").hexdigest(),
                    )
            finally:
                resumed.close()

    def test_restart_drains_multiple_numbered_rotations_in_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log_file = root / "modsec_audit.log"
            rotated_one = root / "modsec_audit.log.1"
            rotated_two = root / "modsec_audit.log.2"
            state_file = root / "state" / "cursor.json"
            log_file.write_bytes(b"")
            first = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            first.poll_once()
            with log_file.open("ab") as log:
                log.write(audit_record("rotated-oldest"))
            first.close()
            log_file.rename(rotated_one)
            log_file.write_bytes(audit_record("rotated-middle"))
            rotated_one.rename(rotated_two)
            log_file.rename(rotated_one)
            log_file.write_bytes(audit_record("current-newest"))

            resumed = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                expected_ids = ("rotated-oldest", "rotated-middle", "current-newest")
                with patch("apache_modsec_agent.post_event", return_value=False) as send:
                    for event_id in expected_ids:
                        self.assertEqual(resumed.poll_once(), 1)
                        self.assertEqual(
                            send.call_args.args[0]["eventId"],
                            "apache-" + hashlib.sha256(event_id.encode()).hexdigest(),
                        )
            finally:
                resumed.close()

    def test_legacy_cursor_resumes_at_its_offset_and_upgrades_in_place(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log_file = root / "modsec_audit.log"
            state_file = root / "state" / "cursor.json"
            record = audit_record("legacy-cursor")
            log_file.write_bytes(record)
            info = log_file.stat()
            state_file.parent.mkdir()
            state_file.write_text(json.dumps({
                "device": info.st_dev,
                "inode": info.st_ino,
                "offset": 0,
            }))
            if os.name == "posix":
                state_file.chmod(0o600)
            agent = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                with patch("apache_modsec_agent.post_event", return_value=False) as send:
                    self.assertEqual(agent.poll_once(), 1)
                    send.assert_called_once()
                state = json.loads(state_file.read_text())
                self.assertEqual(state["version"], 2)
                self.assertEqual(state["offset"], len(record))
                self.assertRegex(state["guard"], r"^[0-9a-f]{64}$")
            finally:
                agent.close()

    def test_restart_fails_closed_if_unread_rotated_inode_is_missing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log_file = root / "modsec_audit.log"
            state_file = root / "state" / "cursor.json"
            log_file.write_bytes(b"")
            first = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            first.poll_once()
            with log_file.open("ab") as old_log:
                old_log.write(audit_record("missing-rotated"))
            first.close()
            log_file.rename(root / "unrecognized-rotated-file")
            log_file.write_bytes(audit_record("must-not-skip-to-new"))

            resumed = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                with patch("apache_modsec_agent.post_event") as send:
                    with self.assertRaisesRegex(AgentError, "inode is missing"):
                        resumed.poll_once()
                    send.assert_not_called()
            finally:
                resumed.close()

    def test_copytruncate_is_rejected_when_shrink_is_observed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log_file = root / "modsec_audit.log"
            state_file = root / "state" / "cursor.json"
            log_file.write_bytes(b"original log contents\n")
            agent = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                agent.poll_once()
                log_file.write_bytes(b"x")
                with self.assertRaisesRegex(AgentError, "Use rename/create rotation"):
                    agent.poll_once()
                self.assertEqual(
                    json.loads(state_file.read_text())["offset"],
                    len(b"original log contents\n"),
                )
            finally:
                agent.close()

    def test_copytruncate_regrown_past_cursor_is_rejected_by_cursor_guard(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log_file = root / "modsec_audit.log"
            state_file = root / "state" / "cursor.json"
            original = b"original-" * 40
            log_file.write_bytes(original)
            agent = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                agent.poll_once()
                log_file.write_bytes(b"replacement-" * 40)
                self.assertGreaterEqual(log_file.stat().st_size, len(original))
                with self.assertRaisesRegex(AgentError, "contents changed behind the cursor"):
                    agent.poll_once()
                self.assertEqual(
                    json.loads(state_file.read_text())["offset"], len(original)
                )
            finally:
                agent.close()

    def test_restart_replays_accepted_event_and_duplicate_ack_advances_cursor(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log_file = root / "modsec_audit.log"
            state_file = root / "state" / "cursor.json"
            log_file.write_bytes(b"")
            agent = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            agent.poll_once()
            with log_file.open("ab") as log:
                log.write(audit_record("accepted-before-crash"))
            with patch("apache_modsec_agent._save_cursor", side_effect=OSError("disk")):
                with patch("apache_modsec_agent.post_event", return_value=False) as send:
                    with self.assertRaises(AgentError):
                        agent.poll_once()
                    send.assert_called_once()
            agent.close()

            resumed = ApacheModsecAgent(
                log_file, state_file,
                "https://shopbagati.com/api/security/ingest/apache",
                b"test-secret-with-at-least-32-bytes", 1,
            )
            try:
                with patch("apache_modsec_agent.post_event", return_value=True) as resend:
                    self.assertEqual(resumed.poll_once(), 1)
                    resend.assert_called_once()
                self.assertEqual(
                    json.loads(state_file.read_text())["offset"],
                    log_file.stat().st_size,
                )
            finally:
                resumed.close()


if __name__ == "__main__":
    unittest.main()
