import { promisify } from "util";
import { exec as cpExec } from "child_process";
import { readFile } from "fs/promises";
import * as path from "path";

const exec = promisify(cpExec);

export type DockerContextInfo = {
  name: string;
};

export async function listDockerContexts(): Promise<DockerContextInfo[]> {
  try {
    const { stdout } = await exec("docker context ls --format \"{{.Name}}\"");
    const names = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return names.map((name) => ({ name }));
  } catch {
    return [];
  }
}

export type ResolvedDockerContext = {
  host: string;
  port: number;
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
};

export async function resolveDockerContext(name: string): Promise<ResolvedDockerContext | undefined> {
  try {
    const { stdout } = await exec(`docker context inspect ${name}`);
    const arr = JSON.parse(stdout);
    const ctx = Array.isArray(arr) ? arr[0] : arr;
    const endpoint = ctx?.Endpoints?.docker || ctx?.Endpoints?.["docker"];
    const hostUrl: string | undefined = endpoint?.Host;
    if (!hostUrl) return undefined;

    let url = hostUrl as string;
    if (url.startsWith("unix://") || url.startsWith("npipe://")) {
      // Local socket contexts should use the default docker client from plugin
      return undefined;
    }
    if (url.startsWith("tcp://")) url = "https://" + url.slice(6); // default to TLS for tcp contexts
    const u = new URL(url);
    const host = `${u.protocol}//${u.hostname}`;
    const port = u.port ? parseInt(u.port, 10) : u.protocol === "https:" ? 2376 : 2375;

    // TLS material
    let ca: Buffer | undefined;
    let cert: Buffer | undefined;
    let key: Buffer | undefined;

    const tlsDir: string | undefined = ctx?.TLSMaterialDir;
    if (tlsDir) {
      try {
        ca = await tryRead(path.join(tlsDir, "ca.pem"));
        cert = await tryRead(path.join(tlsDir, "cert.pem"));
        key = await tryRead(path.join(tlsDir, "key.pem"));
      } catch {
        // ignore
      }
    } else if (ctx?.TLSMaterial) {
      // Sometimes structured as map of endpoint -> files
      const mats = ctx.TLSMaterial;
      const firstKey = Object.keys(mats || {})[0];
      const files = firstKey ? mats[firstKey] : undefined;
      if (files) {
        try {
          ca = files.CA ? await tryRead(files.CA) : undefined;
          cert = files.Cert ? await tryRead(files.Cert) : undefined;
          key = files.Key ? await tryRead(files.Key) : undefined;
        } catch {
          // ignore
        }
      }
    }

    return { host, port, ca, cert, key };
  } catch {
    return undefined;
  }
}

async function tryRead(p: string): Promise<Buffer | undefined> {
  try {
    return await readFile(p);
  } catch {
    return undefined;
  }
}
