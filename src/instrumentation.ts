/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * We use it to kick off the built-in OpenAI-key monitor loop. Guarded to the
 * Node.js runtime (the loop touches the filesystem + Sub2API) and dynamically
 * imported so the Edge runtime never pulls in server-only modules.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startOpenAIKeyMonitor } = await import("@/lib/openai-key-monitor");
  startOpenAIKeyMonitor();
}
