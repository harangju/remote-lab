# Current context

- Conversation/event persistence was aligned more closely with the live tool UI.
- Canonical persisted event types now include tool lifecycle and runtime/system events:
  - `tool-call`
  - `tool-output`
  - `tool-result`
  - `user-message`
  - `assistant-message`
  - `run-error`
  - `system`
- Frontend replay now reconstructs tool chips from canonical events and renders runtime/system events as centered system pills instead of assistant messages.
- Duplicate persisted tool-call rows were traced to repeated upstream `FunctionToolCallEvent` emissions for the same `tool_call_id`; persistence now dedupes `tool-call` rows by semantic `tool_call_id`.
- Shared/model-facing context now summarizes recent tool and system events more explicitly so the assistant is more likely to act on prior runtime/tool history.
- Frontend live/replay reconciliation was improved so a running tool chip is less likely to be duplicated by a second completed chip when persisted history catches up.
- Manual bash/sleep tests showed the live tool chip transitioning cleanly without leaving a duplicate completed copy.
- Builds/compile pass after these changes.
