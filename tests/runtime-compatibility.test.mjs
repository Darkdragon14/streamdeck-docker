import { JsonRpcError, JsonRpcRequest, JsonRpcResponse } from "@elgato/utils/rpc";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { WebSocketServer } from "ws";

test("Elgato RPC schemas work with the patched Zod Mini implementation", () => {
	const request = { jsonrpc: "2.0", method: "test", params: [1, "value"], id: "1" };
	assert.equal(JsonRpcRequest.safeParse(request).success, true);
	assert.equal(JsonRpcRequest.safeParse({ ...request, params: { value: 1 } }).success, true);
	assert.equal(JsonRpcRequest.safeParse({ ...request, method: 123 }).success, false);
	assert.equal(JsonRpcRequest.safeParse({ ...request, jsonrpc: "1.0" }).success, false);

	const error = { code: -32600, message: "Invalid request", data: null };
	assert.equal(JsonRpcError.safeParse(error).success, true);
	assert.equal(JsonRpcError.safeParse({ ...error, code: "invalid" }).success, false);
	assert.equal(JsonRpcResponse.safeParse({ jsonrpc: "2.0", result: { ok: true }, id: "1" }).success, true);
	assert.equal(JsonRpcResponse.safeParse({ jsonrpc: "2.0", error, id: "1" }).success, true);
	assert.equal(JsonRpcResponse.safeParse({ jsonrpc: "2.0", id: "1" }).success, false);
});

test("built plugin registers with Stream Deck using the patched dependencies", { timeout: 10000 }, async (t) => {
	const pluginDirectory = new URL("../com.darkdragon14.elgato-docker.sdPlugin/", import.meta.url);
	const manifest = JSON.parse(await readFile(new URL("manifest.json", pluginDirectory), "utf8"));
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	t.after(() => {
		for (const socket of server.clients) socket.terminate();
		server.close();
	});
	await once(server, "listening");

	const info = {
		application: { version: "7.1.0", platform: "windows", language: "en", platformVersion: "10" },
		plugin: { uuid: manifest.UUID, version: manifest.Version },
		devices: [],
		colors: {},
	};
	const child = spawn(
		process.execPath,
		[
			manifest.CodePath,
			"-port",
			String(server.address().port),
			"-pluginUUID",
			manifest.UUID,
			"-registerEvent",
			"registerPlugin",
			"-info",
			JSON.stringify(info),
		],
		{ cwd: pluginDirectory, stdio: ["ignore", "ignore", "pipe"] },
	);
	let stderr = "";
	child.stderr.on("data", (data) => (stderr += data));
	t.after(() => child.kill());
	const connection = once(server, "connection");
	const registration = connection.then(async ([socket]) => {
		const [data] = await once(socket, "message");
		assert.deepEqual(JSON.parse(data.toString()), { event: "registerPlugin", uuid: manifest.UUID });
	});
	await Promise.race([
		registration,
		once(child, "exit").then(([code]) => {
			throw new Error(`Plugin exited before registration (${code}): ${stderr}`);
		}),
	]);
});
