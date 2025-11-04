// Only per-key context now; no global context fallback

type GlobalSettings = { defaultContext?: string };

type SettingsWithContext = { contextName?: string };

export async function getEffectiveContext(settings?: SettingsWithContext): Promise<string | undefined> {
	const perKey = (settings?.contextName ?? "").toString();
	if (!perKey || perKey === "default") return undefined;
	return perKey;
}
