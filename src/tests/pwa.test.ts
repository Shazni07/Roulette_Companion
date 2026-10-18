import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { installAdvice, isIosDevice } from "@/lib/pwa";

const UA = {
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
  ipadAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

describe("install advice for each kind of device", () => {
  it("Android with an install button, Android without, iPhone Safari, iPhone other browser", () => {
    expect(installAdvice(UA.androidChrome, false, true)).toBe("prompt");
    expect(installAdvice(UA.androidChrome, false, false)).toBe("android-menu");
    expect(installAdvice(UA.iphoneSafari, false, false)).toBe("ios-safari");
    expect(installAdvice(UA.iphoneChrome, false, false)).toBe("ios-other");
  });
  it("an iPad that looks like a Mac is recognised by its touch screen; a real Mac is not", () => {
    expect(isIosDevice(UA.ipadAsMac, 5)).toBe(true);
    expect(isIosDevice(UA.ipadAsMac, 0)).toBe(false);
    expect(installAdvice(UA.ipadAsMac, false, false, 5)).toBe("ios-safari");
    expect(installAdvice(UA.ipadAsMac, false, false, 0)).toBe("none");
  });
  it("nothing is shown on a computer or when the app is already installed", () => {
    expect(installAdvice(UA.windowsChrome, false, false)).toBe("none");
    expect(installAdvice(UA.windowsChrome, false, true)).toBe("none");
    expect(installAdvice(UA.androidChrome, true, true)).toBe("none");
    expect(installAdvice(UA.iphoneSafari, true, false)).toBe("none");
  });
});

/** width and height from the header of a PNG file */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe("web app manifest and icons", () => {
  const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")) as {
    id: string; name: string; short_name: string; start_url: string; scope: string; display: string; orientation: string;
    background_color: string; theme_color: string; icons: { src: string; sizes: string; type: string; purpose: string }[];
  };

  it("has what a phone needs to install it as an app", () => {
    expect(manifest.name).toBe("Roulette Companion");
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest).toMatchObject({ start_url: "/", scope: "/", display: "standalone", orientation: "portrait", id: "/" });
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("lists real icon files of the sizes it claims, including a maskable one", () => {
    for (const icon of manifest.icons) {
      const file = "public" + icon.src;
      expect(existsSync(file), file).toBe(true);
      if (icon.type === "image/png") {
        const [w, h] = pngSize(file);
        expect(`${w}x${h}`).toBe(icon.sizes);
      }
    }
    const sizes = manifest.icons.filter((i) => i.purpose === "any" && i.type === "image/png").map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512")).toBe(true);
  });

  it("has an iPhone home-screen icon (180 x 180)", () => {
    expect(pngSize("public/apple-touch-icon.png")).toEqual([180, 180]);
  });
});

/* ───────── the service worker, run against a tiny fake browser ───────── */
function loadServiceWorker(opts: { network?: (url: string) => Promise<Response> } = {}) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const fetchLog: string[] = [];
  const urlOf = (r: unknown) => (typeof r === "string" ? r : (r as { url: string }).url);
  const makeCache = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      add: async (r: unknown) => {
        const u = urlOf(r).startsWith("http") ? urlOf(r) : "https://app.test" + urlOf(r);
        store.set(u, await fakeFetch(u));
      },
      put: async (r: unknown, res: Response) => void store.set(urlOf(r).startsWith("http") ? urlOf(r) : "https://app.test" + urlOf(r), res),
      match: async (r: unknown) => store.get(urlOf(r).startsWith("http") ? urlOf(r) : "https://app.test" + urlOf(r))?.clone(),
    };
  };
  const fakeFetch = async (r: unknown) => {
    const u = urlOf(r);
    fetchLog.push(u);
    return opts.network ? opts.network(u) : new Response("net:" + u);
  };
  const caches = {
    open: async (n: string) => makeCache(n),
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async (r: unknown) => {
      const key = urlOf(r).startsWith("http") ? urlOf(r) : "https://app.test" + urlOf(r); // like a browser: "/" means this site's "/"
      for (const s of stores.values()) {
        const hit = s.get(key);
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  const skip = vi.fn();
  const claim = vi.fn(async () => undefined);
  const self = { location: { origin: "https://app.test" }, addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn), skipWaiting: skip, clients: { claim } };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches, fetch: fakeFetch, URL, Response, Promise, Array, Map });

  const run = async (type: string, extra: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | null = null;
    const event = { ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => (responded = Promise.resolve(p)) };
    listeners[type]!(event);
    await Promise.all(waits);
    return { responded: responded as Promise<Response> | null };
  };
  const req = (url: string, init: { method?: string; mode?: string } = {}) => ({ url, method: init.method ?? "GET", mode: init.mode ?? "no-cors" });
  return { listeners, stores, fetchLog, skip, claim, run, req };
}

describe("service worker (offline support)", () => {
  it("handles install, activate, message and fetch", () => {
    const sw = loadServiceWorker();
    expect(Object.keys(sw.listeners).sort()).toEqual(["activate", "fetch", "install", "message"]);
  });

  it("saves the app shell when installed and removes old versions when activated", async () => {
    const sw = loadServiceWorker();
    sw.stores.set("roulette-companion-v0-old", new Map());
    sw.stores.set("someone-elses-cache", new Map());
    await sw.run("install");
    const mine = [...sw.stores.keys()].find((k) => k === "roulette-companion-v1")!;
    expect([...sw.stores.get(mine)!.keys()]).toEqual(expect.arrayContaining(["https://app.test/", "https://app.test/manifest.webmanifest", "https://app.test/icon-192.png"]));
    await sw.run("activate");
    expect([...sw.stores.keys()]).toEqual(["someone-elses-cache", "roulette-companion-v1"]);
    expect(sw.claim).toHaveBeenCalled();
  });

  it("never touches saving data or other websites (POST, or another origin such as Supabase)", async () => {
    const sw = loadServiceWorker();
    expect((await sw.run("fetch", { request: sw.req("https://app.test/api/x", { method: "POST" }) })).responded).toBeNull();
    expect((await sw.run("fetch", { request: sw.req("https://abc.supabase.co/rest/v1/sessions") })).responded).toBeNull();
  });

  it("opens the page from the network, and from the saved copy when offline", async () => {
    let online = true;
    const sw = loadServiceWorker({ network: async (u) => (online ? new Response("page:" + u) : Promise.reject(new TypeError("offline"))) });
    const first = await sw.run("fetch", { request: sw.req("https://app.test/", { mode: "navigate" }) });
    expect(await (await first.responded!).text()).toBe("page:https://app.test/");
    await new Promise((r) => setTimeout(r, 0)); // the copy is saved after the answer
    online = false;
    const offline = await sw.run("fetch", { request: sw.req("https://app.test/", { mode: "navigate" }) });
    expect(await (await offline.responded!).text()).toBe("page:https://app.test/"); // the saved copy
  });

  it("serves hashed build files from the saved copy after the first time", async () => {
    const sw = loadServiceWorker();
    const url = "https://app.test/_next/static/chunks/app-123.js";
    expect(await (await (await sw.run("fetch", { request: sw.req(url) })).responded!).text()).toBe("net:" + url);
    await new Promise((r) => setTimeout(r, 0));
    const before = sw.fetchLog.length;
    expect(await (await (await sw.run("fetch", { request: sw.req(url) })).responded!).text()).toBe("net:" + url);
    expect(sw.fetchLog.length).toBe(before); // no second network request
  });

  it("an update waits for the user: it only takes over after SKIP_WAITING", async () => {
    const sw = loadServiceWorker();
    await sw.run("install");
    expect(sw.skip).not.toHaveBeenCalled();
    await sw.run("message", { data: { type: "SKIP_WAITING" } });
    expect(sw.skip).toHaveBeenCalledTimes(1);
  });

  it("saves the files the page already loaded, but only from this site", async () => {
    const sw = loadServiceWorker();
    await sw.run("message", { data: { type: "CACHE_URLS", urls: ["https://app.test/_next/static/a.js", "https://evil.test/x.js", 42] } });
    const keys = [...sw.stores.get("roulette-companion-v1")!.keys()];
    expect(keys).toEqual(["https://app.test/_next/static/a.js"]);
  });
});
