import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Pi equivalent of the Claude Code SessionStart hook installed by `rex skill setup`.
// Pi has no command hooks, so run the same command at session start and add its
// output to the system prompt. Does nothing outside a Rex terminal.
export default function (pi: ExtensionAPI) {
	let context: string | undefined;

	pi.on("session_start", async () => {
		context = undefined;
		if (!process.env.REX_SESSION) return;
		try {
			const res = await pi.exec("rex", ["__internal", "session-start", "--agent", "pi"], { timeout: 5000 });
			if (res.code === 0 && res.stdout.trim()) context = res.stdout.trim();
		} catch {
			// rex missing or server unreachable: stay silent, like the Claude hook (`|| true`)
		}
	});

	pi.on("before_agent_start", (event) => {
		if (context) event.systemPromptOptions.sections.rex = context;
	});
}
