import { executionAsyncId, createHook } from "async_hooks";

const ENABLED = !!process.env.BLOCKING_TRACER_ENABLED;
const THRESHOLD = (parseInt(process.env.BLOCKING_TRACER_THRESHOLD || "", 10) || 100) * 1e6; // 100ms

type State = {
  id: number;
  startTime?: [number, number];
  tags: string[];
  parent?: number;
  type?: string;
};

const states = new Map<number, State>();

function formatAsyncChain(state: State | undefined): string {
  const parts = [] as string[];
  while (state) {
    parts.push(`[${state.id} ${state.tags.join(",") || state.type || "?"}]`);
    state = state.parent ? states.get(state.parent) : undefined;
  }
  return parts.join(" <- ");
}

function init(asyncId: number, type: string, triggerAsyncId: number, resource) {
  const tags = [] as string[];
  if (type === "HTTPCLIENTREQUEST") {
    tags.push(`${resource?.req?.protocol}//${resource?.req?.host}${resource?.req?.path}`);
  }
  states.set(asyncId, { type, parent: triggerAsyncId, id: asyncId, tags });
}

function destroy(asyncId: number) {
  states.delete(asyncId);
}

function before(asyncId: number) {
  const state = states.get(asyncId);

  if (!state) {
    return;
  }
  state.startTime = process.hrtime();
}

function after(asyncId: number) {
  const state = states.get(asyncId);

  if (!state) {
    return;
  }

  if (!state.startTime) {
    console.warn(`[${asyncId}] Missing startTime`);
    return;
  }

  const diff = process.hrtime(state.startTime);

  const diffNs = diff[0] * 1e9 + diff[1];

  if (diffNs > THRESHOLD) {
    const time = diffNs / 1e6;
    console.warn(`[${asyncId}] Blocked event loop for ${Math.floor(time)}ms: ${formatAsyncChain(state)}`, {
      time,
      asyncId,
      state,
    });
  }
}

export function tag(tag: string) {
  if (!ENABLED) {
    return;
  }
  const id = executionAsyncId();
  const state = states.get(id);
  if (!state) {
    console.warn(`[${id}] No async state`);
    return;
  }
  if (!state.tags.includes(tag)) {
    state.tags.push(tag);
  }
}

export default { tag };

if (ENABLED) {
  const asyncHook = createHook({ before, after, init, destroy });
  asyncHook.enable();
}
