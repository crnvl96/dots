import unittest

from scripts.check_brewfile import audit_entries


def formula(name, requested=True, **extra):
    return {
        "name": name,
        "full_name": name,
        "tap": "homebrew/core",
        "installed": [{"installed_on_request": requested}],
        **extra,
    }


class AuditEntriesTests(unittest.TestCase):
    def audit(self, installed_formulae=None, installed_casks=None, installed_taps=None, **declared):
        return audit_entries(
            installed_formulae or [],
            installed_casks or [],
            installed_taps or [],
            {"formulae": [], "casks": [], "taps": [], **declared},
        )

    def test_dependency_and_orphan_are_not_missing_manifest_entries(self):
        result = self.audit(
            [formula("git"), formula("gettext", False), formula("go", False)],
            formulae=["git"],
        )
        self.assertFalse(any(result.values()))

    def test_explicit_dependency_is_still_a_missing_entry(self):
        result = self.audit([formula("gettext")])
        self.assertEqual(
            result["Explicitly installed formulae missing from Brewfile"], {"gettext"}
        )

    def test_missing_installation(self):
        result = self.audit(formulae=["neovim"])
        self.assertEqual(result["Declared formulae not installed"], {"neovim"})

    def test_formula_aliases_and_qualified_names(self):
        result = self.audit(
            [
                formula("git", aliases=["git-alias"], oldnames=["old-git"]),
                formula("krunkit", full_name="libkrun/krun/krunkit", tap="libkrun/krun"),
            ],
            installed_taps=["libkrun/krun"],
            formulae=["homebrew/core/git", "git-alias", "old-git", "krunkit"],
        )
        # The intentionally undeclared tap is the only finding.
        self.assertEqual(result["Installed taps missing from Brewfile"], {"libkrun/krun"})
        self.assertFalse(any(value for key, value in result.items() if "taps" not in key))

    def test_cask_and_tap_drift(self):
        result = self.audit(
            installed_casks=[{"token": "app", "full_token": "vendor/apps/app"}, {"token": "extra"}],
            installed_taps=["vendor/apps"],
            casks=["vendor/apps/app", "missing"],
            taps=["other/apps"],
        )
        self.assertEqual(result["Declared casks not installed"], {"missing"})
        self.assertEqual(result["Installed casks missing from Brewfile"], {"extra"})
        self.assertEqual(result["Declared taps not installed"], {"other/apps"})
        self.assertEqual(result["Installed taps missing from Brewfile"], {"vendor/apps"})

    def test_only_declared_deprecated_or_disabled_packages_are_flagged(self):
        result = self.audit(
            [formula("old", deprecated=True), formula("dependency", False, disabled=True)],
            installed_casks=[{"token": "app", "disabled": True}],
            formulae=["old"],
            casks=["app"],
        )
        self.assertEqual(result["Deprecated or disabled entries"], {"old", "app"})


if __name__ == "__main__":
    unittest.main()
