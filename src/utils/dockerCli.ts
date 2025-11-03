import { promisify } from "util";
import { execFile as cpExecFile } from "child_process";

const execFile = promisify(cpExecFile as any) as (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

async function run(args: string[], context?: string) {
  const finalArgs = [] as string[];
  if (context && context !== "") finalArgs.push("--context", context);
  finalArgs.push(...args);
  const { stdout } = await execFile("docker", finalArgs);
  return stdout;
}

export async function ping(context?: string): Promise<boolean> {
  try {
    await run(["version"], context);
    return true;
  } catch {
    return false;
  }
}

export type PsItem = { name: string; state: string; labels?: Record<string, string> };

export async function listContainers(all: boolean, context?: string, filters: string[] = []): Promise<PsItem[]> {
  const format = "{{.Names}}\t{{.State}}\t{{json .Labels}}";
  const args = ["ps", all ? "-a" : "", ...filters.flatMap((f) => ["--filter", f]), "--format", format].filter(Boolean) as string[];
  const out = await run(args, context);
  const items: PsItem[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, state, labelsJson] = line.split("\t");
    let labels: Record<string, string> | undefined;
    try { labels = labelsJson ? JSON.parse(labelsJson) : undefined; } catch { labels = undefined; }
    items.push({ name, state, labels });
  }
  return items;
}

export async function getContainerState(name: string, context?: string): Promise<string | undefined> {
  try {
    const out = await run(["inspect", "-f", "{{.State.Status}}", name], context);
    return out.trim();
  } catch {
    return undefined;
  }
}

export async function startContainer(name: string, context?: string): Promise<void> {
  await run(["start", name], context);
}

export async function stopContainer(name: string, context?: string): Promise<void> {
  await run(["stop", name], context);
}

export async function waitContainer(name: string, context?: string): Promise<void> {
  await run(["wait", name], context);
}

export async function removeContainer(name: string, context?: string): Promise<void> {
  await run(["rm", "-f", name], context);
}

export async function runDetached(image: string, name: string, context?: string): Promise<void> {
  await run(["run", "-d", "--name", name, image], context);
}

export async function listImages(context?: string): Promise<string[]> {
  const out = await run(["images", "--format", "{{.Repository}}:{{.Tag}}"], context);
  return out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && s !== "<none>:<none>");
}

export async function listComposeProjects(context?: string): Promise<string[]> {
  const items = await listContainers(true, context);
  const set = new Set<string>();
  for (const it of items) {
    const composeProject = it.labels?.["com.docker.compose.project"]; // Compose v2
    const swarmStack = it.labels?.["com.docker.stack.namespace"]; // Swarm stack
    if (composeProject) set.add(composeProject);
    if (swarmStack) set.add(swarmStack);
  }
  try {
    const out = await run(["compose", "ls", "-a", "--format", "json"], context);
    const arr: { Name: string }[] = JSON.parse(out);
    arr.forEach((it) => set.add(it.Name));
  } catch {}
  // Try Swarm stacks as well (if Swarm enabled)
  try {
    const out = await run(["stack", "ls", "-a", "--format", "{{.Name}}"], context);
    out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((n) => set.add(n));
  } catch {}
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export async function containersByComposeProject(project: string, context?: string): Promise<PsItem[]> {
  // Match both compose and swarm label to support both workflows
  const viaCompose = await listContainers(true, context, ["label=com.docker.compose.project=" + project]).catch(() => [] as PsItem[]);
  const viaSwarm = await listContainers(true, context, ["label=com.docker.stack.namespace=" + project]).catch(() => [] as PsItem[]);
  // Merge unique by name
  const map = new Map<string, PsItem>();
  [...viaCompose, ...viaSwarm].forEach((it) => map.set(it.name, it));
  return Array.from(map.values());
}
