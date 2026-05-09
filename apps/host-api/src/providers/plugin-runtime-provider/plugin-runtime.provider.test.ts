import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HostLlmInvokeInput, HostLlmInvokeResult, PluginRuntimeExtension } from "@wclaw/plugin-sdk";
import { HostEventHub } from "../host-event-hub-provider/host-event-hub.js";
import { NotificationProvider } from "../notification-provider/index.js";
import { PluginRuntimeProvider } from "./plugin-runtime.provider.js";

describe("PluginRuntimeProvider#setInvokeHostLlm", () => {
  it("forces toolPolicy=none for injected invokeHostLlm", async () => {
    const log = {
      warn: () => {
        // ignore in tests
      }
    };
    const provider = await PluginRuntimeProvider.create({
      hostEventHub: new HostEventHub(new NotificationProvider()),
      log
    });

    let captured: HostLlmInvokeInput | null = null;
    provider.setInvokeHostLlm(() => async (input): Promise<HostLlmInvokeResult> => {
      captured = input;
      return { ok: true, text: "ok" };
    });

    const target = provider
      .pluginLoading
      .snapshot()
      .find((row) => {
        const kind = row.manifest?.kind;
        if (kind !== "runtime_plugin" && kind !== "command_plugin") return false;
        if (kind === "command_plugin" && row.manifest?.commandMode === "ephemeral_no_context") return false;
        return Boolean(row.object);
      });
    assert.ok(target?.object, "expected at least one plugin eligible for invokeHostLlm injection");

    const ext = target.object as PluginRuntimeExtension & {
      invokeHostLlm?: (input: HostLlmInvokeInput) => Promise<HostLlmInvokeResult>;
    };
    assert.equal(typeof ext.invokeHostLlm, "function");

    const input: HostLlmInvokeInput = {
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-4o-mini",
      toolPolicy: "auto"
    };
    const result = await ext.invokeHostLlm!(input);
    assert.equal(result.ok, true);
    assert.ok(captured);
    assert.equal(captured?.toolPolicy, "none");
  });
});

