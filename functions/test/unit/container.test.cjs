const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { Container } = require("../../lib/di/container");

describe("Container", () => {
  it("registers and resolves the instance for a provider", () => {
    class ExampleService {}

    const provider = {
      provide: "example-service",
      useClass: ExampleService,
    };
    const instance = new ExampleService();
    const container = new Container();

    container.register(provider, instance);

    assert.strictEqual(container.resolve(provider), instance);
  });

  it("throws a clear error when the provider is not registered", () => {
    class MissingService {}

    const provider = {
      provide: "missing-service",
      useClass: MissingService,
    };
    const container = new Container();

    assert.throws(
      () => container.resolve(provider),
      {
        name: "Error",
        message: "Provider missing-service is not registered",
      }
    );
  });
});
