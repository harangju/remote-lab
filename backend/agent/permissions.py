from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

POLICY_FILENAME = ".remote-lab-tools.json"
ALWAYS_CONFIRM_TOOLS = {"bash", "web_search"}
FILE_TOOLS = {"read_file", "write_file", "edit_file"}
DANGEROUS_BASH_PATTERNS = [
    r"(^|\s)rm\s",
    r"(^|\s)sudo\s",
    r"(^|\s)git\s+push(\s|$)",
    r"curl\s+[^|\n]+\|",
    r"wget\s+[^|\n]+\|",
    r"(^|\s)chmod\s",
    r"(^|\s)chown\s",
]


def _policy_path(project_path: Path) -> Path:
    return project_path / POLICY_FILENAME


def summarize_args(args: Any) -> str:
    if args is None:
        return ""
    if isinstance(args, str):
        return args
    try:
        return json.dumps(args, sort_keys=True)
    except Exception:
        return str(args)


def _extract_path(tool_name: str, args: Any) -> str | None:
    if tool_name not in FILE_TOOLS:
        return None
    if isinstance(args, dict):
        path = args.get("path")
        return str(path) if path else None
    if isinstance(args, str):
        match = re.search(r"['\"]?path['\"]?\s*[:=]\s*['\"]([^'\"]+)['\"]", args)
        if match:
            return match.group(1)
    return None


def _extract_command(tool_name: str, args: Any) -> str | None:
    if tool_name != "bash":
        return None
    if isinstance(args, dict):
        command = args.get("command")
        return str(command) if command else None
    if isinstance(args, str):
        match = re.search(r"['\"]?command['\"]?\s*[:=]\s*['\"]([^'\"]+)['\"]", args)
        if match:
            return match.group(1)
        return args
    return None


def _default_policy() -> dict[str, Any]:
    return {"version": 2, "permissions": {"allow": []}}


def _upgrade_legacy_rules(rules: list[Any]) -> list[dict[str, Any]]:
    upgraded: list[dict[str, Any]] = []
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        tool_name = rule.get("tool")
        if not tool_name:
            continue
        new_rule: dict[str, Any] = {"tool": tool_name}
        if isinstance(rule.get("path"), str):
            new_rule["path"] = rule["path"]
        upgraded.append(new_rule)
    return upgraded


def load_project_policy(project_path: Path) -> dict[str, Any]:
    path = _policy_path(project_path)
    if not path.exists():
        return _default_policy()
    try:
        data = json.loads(path.read_text())
    except Exception:
        return _default_policy()
    if not isinstance(data, dict):
        return _default_policy()

    permissions = data.get("permissions")
    if isinstance(permissions, dict) and isinstance(permissions.get("allow"), list):
        return {
            "version": 2,
            "permissions": {"allow": [r for r in permissions["allow"] if isinstance(r, dict)]},
        }

    rules = data.get("rules")
    if isinstance(rules, list):
        return {"version": 2, "permissions": {"allow": _upgrade_legacy_rules(rules)}}

    return _default_policy()


def save_project_policy(project_path: Path, policy: dict[str, Any]) -> None:
    _policy_path(project_path).write_text(json.dumps(policy, indent=2) + "\n")


def tool_is_always_confirmed(tool_name: str, args: Any) -> bool:
    if tool_name in ALWAYS_CONFIRM_TOOLS:
        if tool_name != "bash":
            return True
        command = summarize_args(args)
        return any(re.search(pattern, command) for pattern in DANGEROUS_BASH_PATTERNS)
    return False


def _rule_matches(rule: dict[str, Any], tool_name: str, args: Any) -> bool:
    if rule.get("tool") != tool_name:
        return False

    if tool_name in FILE_TOOLS:
        return rule.get("path") == _extract_path(tool_name, args)

    if tool_name == "bash":
        command = _extract_command(tool_name, args)
        if not command:
            return False
        if isinstance(rule.get("command"), str):
            return rule["command"] == command
        if isinstance(rule.get("command_prefix"), str):
            return command.startswith(rule["command_prefix"])
        return False

    return True


def is_tool_auto_allowed(project_path: Path, convo_autonomous: bool, tool_name: str, args: Any) -> bool:
    if convo_autonomous and not tool_is_always_confirmed(tool_name, args):
        return True
    policy = load_project_policy(project_path)
    allow_rules = policy.get("permissions", {}).get("allow", [])
    return any(isinstance(rule, dict) and _rule_matches(rule, tool_name, args) for rule in allow_rules)


def build_project_rule(tool_name: str, args: Any) -> dict[str, Any] | None:
    if tool_name in FILE_TOOLS:
        path = _extract_path(tool_name, args)
        if not path:
            return None
        return {"tool": tool_name, "path": path}
    if tool_name == "bash":
        command = _extract_command(tool_name, args)
        if not command:
            return None
        return {"tool": tool_name, "command": command}
    return {"tool": tool_name}


def add_project_rule(project_path: Path, tool_name: str, args: Any) -> None:
    policy = load_project_policy(project_path)
    policy = {
        "version": 2,
        "permissions": {
            "allow": list(policy.get("permissions", {}).get("allow", [])),
        },
    }
    rule = build_project_rule(tool_name, args)
    if not rule:
        return
    allow_rules = policy["permissions"]["allow"]
    if rule not in allow_rules:
        allow_rules.append(rule)
    save_project_policy(project_path, policy)

