"""ClipPilot "chat" lane — the agent_chat worker that powers the team Slack.

It hosts the four peer personas (see `shared/personas.py`), voices real pipeline activity
as in-character announcements, and routes natural-language @-replies and DMs between agents
over `shared/team_chat.py`.

It is a communication FACILITATOR, not an orchestrator: it never assigns work, and each
persona reasons independently with its own system prompt and its own LLM call. The agents
are peers — there is no one looking over them.
"""
