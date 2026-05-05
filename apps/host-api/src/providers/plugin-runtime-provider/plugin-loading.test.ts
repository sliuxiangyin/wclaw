import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PluginLoading } from "./plugin-loading.js";

describe("PluginLoading", () => {
  it("scans plugins/ and instantiates plugin-loading-test-stub", async () => {
    const warns: string[] = [];
    const log = {
      warn: (obj: Record<string, unknown>, msg?: string) => {
        warns.push([JSON.stringify(obj), msg].filter(Boolean).join(" "));
      }
    };
    let publishCalls = 0;
    const publish: (input: { topics: readonly string[] }) => void = () => {
      publishCalls += 1;
    };

    const loading = await PluginLoading.create({ publish, log });

    const items = await loading.plugins();
    const stub = items.find((x) => x.pluginId === "plugin-loading-test-stub");
    assert.ok(stub, "expected plugin-loading-test-stub in workspace plugins/");
    assert.equal(stub.status, "valid");
    assert.equal(stub.manifest?.id, "plugin-loading-test-stub");
    assert.equal(stub.manifest?.entry, "runtime.mjs");
    assert.ok(stub.object, "expected default export class to be constructed");
    assert.equal((stub.object as { pluginId?: string }).pluginId, "plugin-loading-test-stub");

    const byGet = loading.get("plugin-loading-test-stub");
    assert.ok(byGet?.object);
    assert.strictEqual(byGet?.object, stub.object);

    assert.equal(
      warns.length,
      0,
      `unexpected load warnings: ${warns.join("; ") || "(none)"}`
    );
    assert.equal(publishCalls, 0);
  });
});
