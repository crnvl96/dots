---
name: agent-browser
description: Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", "automate browser actions", or any task requiring programmatic web interaction.
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*)
---

# agent-browser

Fast browser automation CLI for AI agents. Chrome/Chromium via CDP with accessibility-tree snapshots and compact `@eN` element refs.

## Start here

This file is a discovery stub, not the usage guide. Before running any `agent-browser` command, load the actual workflow content from the CLI:

```bash
agent-browser skills get core             # start here — workflows, common patterns, troubleshooting
agent-browser skills get core --full      # include full command reference and templates
```

The CLI serves skill content that always matches the installed version, so instructions never go stale. The content in this stub cannot change between releases, which is why it just points at `skills get core`.

## Specialized skills

Load a specialized skill when the task falls outside browser web pages:

```bash
agent-browser skills get electron          # Electron desktop apps (VS Code, Slack, Discord, Figma, ...)
agent-browser skills get slack             # Slack workspace automation
agent-browser skills get dogfood           # Exploratory testing / QA / bug hunts
agent-browser skills get derive-client     # Record a HAR, derive a standalone API client for a site
agent-browser skills get vercel-sandbox    # agent-browser inside Vercel Sandbox microVMs
agent-browser skills get protected-vercel-deployments  # Access protected Vercel deployments
agent-browser skills get agentcore         # AWS Bedrock AgentCore cloud browsers
```

Run `agent-browser skills list` to see everything available on the installed version.

## Taking screenshots

Before taking screenshots to verify UI work or to share (PRs, chat), read [references/screenshots.md](references/screenshots.md), including its **Runtime configuration** section. Defaults: 2x resolution (`set viewport 1600 1000 2`) and dark theme (`--color-scheme dark` on every command). Obtain authorized values and securely export the required `DEMO_*` variables at runtime; ask for missing values or an approved source. Reuse one unique session per screenshot task, exclude output files before capture, and review screenshots for identifying data before sharing. Never discard pre-existing user edits or modify persisted records without permission. Add only sanitized lessons to the reference.

## Recording demo videos

Before recording a video for people to watch (a demo, a PR walkthrough), read [references/demo-videos.md](references/demo-videos.md), including its **Runtime configuration and sensitive data** section. It covers the recipe that worked: preparing outside the take, one script per take, forced repaints, `click --human`, a macOS-style cursor with a click ring, dark mode, verifying frames, and trimming with ffmpeg. It also lists the pitfalls already hit. Adaptable example scripts are in [examples/tariff-demo/](examples/tariff-demo/).

Before running those scripts, obtain the user's authorized runtime configuration and securely export the required `DEMO_*` variables documented in that reference. Ask for missing values or an approved source; never guess credentials. Do not hardcode or log passwords, real emails, internal URLs or identifying record values, and never enable shell tracing. Keep generated recordings and session artifacts out of commits and review them before sharing. Add only sanitized lessons to the reference after each recording.

## Observability Dashboard

The dashboard runs independently of browser sessions on port 4848 and can also be opened through a proxied or forwarded URL such as `https://dashboard.agent-browser.localhost`. Agents should stay on the dashboard origin: session tabs, status, and stream traffic are proxied internally, so session ports do not need to be exposed.
