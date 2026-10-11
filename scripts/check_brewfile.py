#!/usr/bin/env -S uv run --no-python-downloads --script
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Read-only audit of the repository Brewfile against local Homebrew state."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
BREWFILE = ROOT / "home/.config/homebrew/Brewfile"


def audit_entries(formulae, casks, taps, declared):
    """Compare explicit installations, accepting aliases and qualified names."""
    aliases = {}
    for formula in formulae:
        canonical = formula["full_name"]
        names = [formula["name"], canonical]
        names += formula.get("aliases", []) + formula.get("oldnames", [])
        if formula.get("tap") == "homebrew/core":
            names.append(f"homebrew/core/{formula['name']}")
        for name in names:
            aliases[name] = canonical

    wanted_formulae = {aliases.get(name, name) for name in declared["formulae"]}
    installed_formulae = {formula["full_name"] for formula in formulae}
    requested_formulae = {
        formula["full_name"]
        for formula in formulae
        if any(item.get("installed_on_request") for item in formula["installed"])
    }
    cask_aliases = {
        name: cask["token"]
        for cask in casks
        for name in (cask["token"], cask.get("full_token", cask["token"]))
    }
    wanted_casks = {cask_aliases.get(name, name) for name in declared["casks"]}
    installed_casks = {cask["token"] for cask in casks}
    wanted_taps = set(declared["taps"])
    stale = {
        item.get("full_name", item.get("token"))
        for item in formulae + casks
        if (item.get("full_name", item.get("token")) in wanted_formulae | wanted_casks)
        and (item.get("deprecated") or item.get("disabled"))
    }
    return {
        "Declared formulae not installed": wanted_formulae - installed_formulae,
        "Explicitly installed formulae missing from Brewfile": requested_formulae - wanted_formulae,
        "Declared casks not installed": wanted_casks - installed_casks,
        "Installed casks missing from Brewfile": installed_casks - wanted_casks,
        "Declared taps not installed": wanted_taps - set(taps),
        "Installed taps missing from Brewfile": set(taps) - wanted_taps,
        "Deprecated or disabled entries": stale,
    }


def main():
    brew = shutil.which("brew")
    if not brew:
        print("Error: Homebrew is not available on PATH; nothing was installed.", file=sys.stderr)
        return 2

    env = dict(os.environ, HOMEBREW_NO_AUTO_UPDATE="1", HOMEBREW_NO_ANALYTICS="1")

    def run(*args, allow_failure=False):
        command = [brew, *args]
        result = subprocess.run(command, env=env, text=True, capture_output=True)
        if result.returncode and not allow_failure:
            raise RuntimeError(
                f"Command failed ({result.returncode}): {' '.join(command)}\n"
                f"{result.stdout}{result.stderr}"
            )
        return result

    print(f"Brewfile: {BREWFILE}")
    print("Read-only audit; auto-update disabled. Versions use local Homebrew metadata.")
    info = json.loads(run("info", "--json=v2", "--installed").stdout)
    declared = {
        kind: run("bundle", "list", f"--file={BREWFILE}", flag).stdout.splitlines()
        for kind, flag in (("formulae", "--brews"), ("casks", "--casks"), ("taps", "--taps"))
    }
    findings = audit_entries(
        info["formulae"], info["casks"], run("tap").stdout.splitlines(), declared
    )
    for label, entries in findings.items():
        print(f"{label}: {', '.join(sorted(entries)) or 'none'}")

    check = run(
        "bundle", "check", f"--file={BREWFILE}", "--no-upgrade", "--verbose",
        allow_failure=True,
    )
    print("\nBundle installation check:")
    print((check.stdout + check.stderr).strip())

    print("\nOrphaned dependencies (preview only):")
    orphans = run("autoremove", "--dry-run")
    print((orphans.stdout + orphans.stderr).strip() or "none")

    outdated = json.loads(run("outdated", "--json=v2").stdout)
    print("\nAvailable upgrades (informational):")
    for item in outdated.get("formulae", []) + outdated.get("casks", []):
        versions = item.get("installed_versions", [])
        if isinstance(versions, str):
            versions = [versions]
        print(f"  {item['name']}: {', '.join(versions)} -> {item['current_version']}")
    if not outdated.get("formulae") and not outdated.get("casks"):
        print("none")

    drift = any(findings.values()) or check.returncode != 0
    print("\nResult: " + ("Brewfile drift found." if drift else "Brewfile entries match installed state."))
    print("Orphans and available upgrades do not fail this check. Nothing was changed.")
    return 1 if drift else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(2)
