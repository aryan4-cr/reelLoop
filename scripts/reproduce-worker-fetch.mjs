// Local runtime reproduction only; every outbound request is intercepted.
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
const bundle = await build({
  stdin: {
    contents: `import { Instagram } from './worker/instagram.ts';
    export default { async fetch() {
      try { await new Instagram({META_APP_ID:'test',META_APP_SECRET:'test',PUBLIC_ORIGIN:'https://example.test',META_API_VERSION:'v25.0'}).exchange('test-only'); return Response.json({ok:true}); }
      catch(e) { return Response.json({stage:'first code exchange',name:e.name,illegalInvocation:String(e).includes('Illegal invocation')}); }
    }};`,
    resolveDir: process.cwd(),
    sourcefile: "reproduction.ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
let calls = 0;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    outboundService: () => {
      calls++;
      return Response.json({
        access_token: "test-only",
        expires_in: 3600,
        user_id: "123",
        username: "test",
      });
    },
  }),
);
try {
  console.log(
    JSON.stringify({
      result: await (await mf.dispatchFetch("https://example.test")).json(),
      outboundCalls: calls,
    }),
  );
} finally {
  await mf.dispose();
}
