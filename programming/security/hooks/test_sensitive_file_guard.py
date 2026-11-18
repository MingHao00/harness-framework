#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# test_sensitive_file_guard.py -- Unit tests for sensitive_file_guard.py (T3)
# Run: cd D:/Python && python -m pytest Hook/test_sensitive_file_guard.py -v

from __future__ import annotations
import io, json, sys
from pathlib import Path
from unittest.mock import patch
import pytest

sys.path.insert(0, str(Path(__file__).parent))
import sensitive_file_guard as sfg


def run_main(payload: dict) -> dict:
    raw = json.dumps(payload, ensure_ascii=False)
    buf = io.StringIO()
    with patch('sys.stdout', buf):
        sfg.main(raw)
    return json.loads(buf.getvalue().strip())


def run_main_raw(raw: str) -> dict:
    buf = io.StringIO()
    with patch('sys.stdout', buf):
        sfg.main(raw)
    return json.loads(buf.getvalue().strip())


# -- 1. _is_sensitive: positive cases --------------------------------
class TestIsSensitivePositive:

    @pytest.mark.parametrize('fname', [
        '.env', '.env.local', '.env.production', '.envrc',
    ])
    def test_env_files(self, fname: str) -> None:
        ok, _ = sfg._is_sensitive(fname)
        assert ok, f'{fname!r} should be sensitive'

    @pytest.mark.parametrize('fname', [
        'server.pem', 'cert.key', 'bundle.pfx', 'cert.p12',
        'push.p8', 'store.keystore', 'store.jks', 'key.ppk', 'backup.asc',
    ])
    def test_cert_key_files(self, fname: str) -> None:
        ok, _ = sfg._is_sensitive(fname)
        assert ok, f'{fname!r} should be sensitive'

    @pytest.mark.parametrize('fname', [
        'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
        'id_rsa.pub', 'id_ed25519.pub',
    ])
    def test_ssh_keys(self, fname: str) -> None:
        ok, _ = sfg._is_sensitive(fname)
        assert ok, f'{fname!r} should be sensitive'

    @pytest.mark.parametrize('fname', [
        'credentials.json', 'credentials',
        'app_secrets.yml', 'secret.json', 'MY_SECRET.env',
        'access_token.txt', 'TOKEN_KEY.env', 'tokens.json',
        '.htpasswd', '.pgpass', '.netrc', '.npmrc',
    ])
    def test_credential_patterns(self, fname: str) -> None:
        ok, _ = sfg._is_sensitive(fname)
        assert ok, f'{fname!r} should be sensitive'

    @pytest.mark.parametrize('fname', [
        '.kubeconfig', 'kubeconfig',
        'service_account.json', 'service-account.json',
        'application_default_credentials.json',
        'vars.tfvars',
        'docker-compose.override.yml',
        'docker-compose.override.yaml',
    ])
    def test_infra_secrets(self, fname: str) -> None:
        ok, _ = sfg._is_sensitive(fname)
        assert ok, f'{fname!r} should be sensitive'


# -- 2. _is_sensitive: negative cases (false-positive prevention) ----
class TestIsSensitiveNegative:

    @pytest.mark.parametrize('fname', [
        'main.py', 'README.md', 'config.yaml', 'package.json',
        'requirements.txt', 'Dockerfile', 'docker-compose.yml',
    ])
    def test_common_files(self, fname: str) -> None:
        ok, _ = sfg._is_sensitive(fname)
        assert not ok, f'{fname!r} should NOT be sensitive'

    @pytest.mark.parametrize('fname', [
        'tokenize.py',
        'access_tokenizer.go',
        'secretariat.txt',
        'secretary_notes.md',
    ])
    def test_r3_word_boundary(self, fname: str) -> None:
        # R3: token/secret patterns must not fire on these files
        ok, _ = sfg._is_sensitive(fname)
        assert not ok, f'{fname!r} must NOT be sensitive (R3)'

    @pytest.mark.parametrize('fname', [
        'lock.txt',
        'docker-compose.yml',
        'serviceaccount_helper.sh',
    ])
    def test_edge_cases(self, fname: str) -> None:
        ok, _ = sfg._is_sensitive(fname)
        assert not ok, f'{fname!r} should NOT be sensitive'


# -- 3. Case insensitivity -------------------------------------------
class TestCaseInsensitivity:

    @pytest.mark.parametrize('fname', [
        'SERVER.PEM', 'CERT.KEY', 'ID_RSA',
        'CREDENTIALS.JSON', 'APP_SECRETS.YML',
        'ACCESS_TOKEN.TXT', 'KUBECONFIG', '.ENV',
    ])
    def test_uppercase(self, fname: str) -> None:
        ok, _ = sfg._is_sensitive(fname)
        assert ok, f'{fname!r} (uppercase) should be detected'


# -- 4. main(): normal I/O paths -------------------------------------
class TestMainNormalFlow:

    def test_read_nonsensitive_allow(self) -> None:
        resp = run_main({'tool': 'Read', 'input': {'path': 'D:/proj/main.py'}})
        assert resp['permission'] == 'allow'

    def test_read_sensitive_ask(self) -> None:
        resp = run_main({'tool': 'Read', 'input': {'path': 'D:/proj/.env'}})
        assert resp['permission'] == 'ask'
        assert 'user_message' in resp and 'agent_message' in resp

    @pytest.mark.parametrize('tool', ['Write', 'StrReplace', 'EditNotebook', 'Delete'])
    def test_write_tools_sensitive_deny(self, tool: str) -> None:
        resp = run_main({'tool': tool, 'input': {'path': 'D:/proj/id_rsa'}})
        assert resp['permission'] == 'deny'

    def test_tool_name_case_insensitive(self) -> None:
        r1 = run_main({'tool': 'write', 'input': {'path': 'D:/proj/id_rsa'}})
        r2 = run_main({'tool': 'WRITE', 'input': {'path': 'D:/proj/id_rsa'}})
        assert r1['permission'] == 'deny'
        assert r2['permission'] == 'deny'

    def test_empty_input_allow(self) -> None:
        resp = run_main_raw('')
        assert resp['permission'] == 'allow'

    def test_empty_path_allow(self) -> None:
        resp = run_main({'tool': 'Read', 'input': {'path': ''}})
        assert resp['permission'] == 'allow'

    def test_missing_input_field_allow(self) -> None:
        resp = run_main({'tool': 'Read'})
        assert resp['permission'] == 'allow'


# -- 5. main(): Fail-Safe paths --------------------------------------
class TestMainFailSafe:

    def test_n1_malformed_json_deny(self) -> None:
        # N1: malformed JSON must trigger Fail-Safe deny, not allow
        resp = run_main_raw('{not valid json')
        assert resp['permission'] == 'deny', 'malformed JSON must be denied'

    def test_n1_truncated_json_deny(self) -> None:
        resp = run_main_raw('{"tool": "Read", "input": {"path"')
        assert resp['permission'] == 'deny'

    def test_t2_tool_input_list_allow(self) -> None:
        # T2: non-empty list bypasses `or {}` -- isinstance check catches it
        resp = run_main({'tool': 'Read', 'input': ['/etc/passwd']})
        assert resp['permission'] == 'allow'

    def test_t2_tool_input_string_allow(self) -> None:
        resp = run_main({'tool': 'Read', 'input': '/etc/passwd'})
        assert resp['permission'] == 'allow'

    def test_n3_path_as_list_allow(self) -> None:
        # N3: path as list must not be str()-coerced; should allow
        resp = run_main({'tool': 'Read', 'input': {'path': ['/etc/passwd']}})
        assert resp['permission'] == 'allow'

    def test_n3_path_as_none_allow(self) -> None:
        resp = run_main({'tool': 'Read', 'input': {'path': None}})
        assert resp['permission'] == 'allow'

    def test_n3_path_as_int_allow(self) -> None:
        resp = run_main({'tool': 'Read', 'input': {'path': 42}})
        assert resp['permission'] == 'allow'


# -- 6. Message content quality --------------------------------------
class TestMessageContent:

    def test_ask_contains_path(self) -> None:
        resp = run_main({'tool': 'Read', 'input': {'path': '/proj/app_secrets.yml'}})
        assert '/proj/app_secrets.yml' in resp['user_message']

    def test_deny_contains_path(self) -> None:
        resp = run_main({'tool': 'Write', 'input': {'path': '/proj/server.pem'}})
        assert '/proj/server.pem' in resp['user_message']

    def test_deny_contains_rule_description(self) -> None:
        resp = run_main({'tool': 'Write', 'input': {'path': '/proj/server.pem'}})
        assert 'PEM' in resp['user_message']
