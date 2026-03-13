from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

POLICY_FILENAME = ".remote-lab-tools.json"
READ_ONLY_TOOLS = {"read_file", "glob", "grep"}
ALWAYS_CONFIRM_TOOLS = {"bash", "web_search"}
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


def load_project_policy(project_path: Path) -> dict[str, Any]:
    path = _policy_path(project_path)
    if not path.exists():
        return {"version": 1, "rules": []}
    try:
        data = json.loads(path.read_text())
    except Exception:
        return {"version": 1, "rules": []}
    if not isinstance(data, dict):
        return {"version": 1, "rules": []}
    rules = data.get("rules")
    if not isinstance(rules, list):
        rules = []
    return {"version": 1, "rules": rules}


def save_project_policy(project_path: Path, policy: dict[str, Any]) -> None:
    _policy_path(project_path).write_text(json.dumps(policy, indent=2) + "\n")


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
    if tool_name not in {"read_file", "write_file", "edit_file"}:
        return None
    if isinstance(args, dict):
        path = args.get("path")
        return str(path) if path else None
    if isinstance(args, str):
        match = re.search(r"['\"]?path['\"]?\s*[:=]\s*['\"]([^'\"]+)['\"]", args)
        if match:
            return match.group(1)
    return None


def _normalize_rule(tool_name: str, args: Any) -> dict[str, Any]:
    rule: dict[str, Any] = {"tool": tool_name}
    path = _extract_path(tool_name, args)
    if path:
        rule["path"] = path
    return rule


def tool_is_always_confirmed(tool_name: str, args: Any) -> bool:
    if tool_name in ALWAYS_CONFIRM_TOOLS:
        if tool_name != "bash":
            return True
        command = summarize_args(args)
        return any(re.search(pattern, command) for pattern in DANGEROUS_BASH_PATTERNS)
    return False


def is_tool_auto_allowed(project_path: Path, convo_autonomous: bool, tool_name: str, args: Any) -> bool:
    if convo_autonomous and not tool_is_always_confirmed(tool_name, args):
        return True
    policy = load_project_policy(project_path)
    candidate = _normalize_rule(tool_name, args)
    for rule in policy.get("rules", []):
        if not isinstance(rule, dict):
            continue
        if rule.get("tool") != candidate.get("tool"):
            continue
        rule_path = rule.get("path")
        if rule_path and rule_path != candidate.get("path"):
            continue
        return True
    return False


def add_project_rule(project_path: Path, tool_name: str, args: Any) -> None:
    policy = load_project_policy(project_path)
    rule = _normalize_rule(tool_name, args)
    rules = policy.setdefault("rules", [])
    if rule not in rules:
        rules.append(rule)
        save_project_policy(project_path, policy)
