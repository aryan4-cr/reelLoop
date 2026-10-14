// Local workerd reproduction. Fake credentials and intercepted S3 response only.
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
const bundle = await build({
  stdin: {
    contents: `import { S3Client, CopyObjectCommand } from '@aws-sdk/client-s3';
    export default { async fetch() {
      try { const c = new S3Client({region:'auto', endpoint:'https://test.r2.cloudflarestorage.com', credentials:{accessKeyId:'test-only',secretAccessKey:'test-only'},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
        await c.send(new CopyObjectCommand({Bucket:'test-bucket',Key:'videos/test',CopySource:'test-bucket/staging/test',CopySourceIfMatch:'"test-etag"',MetadataDirective:'REPLACE',ContentType:'video/mp4'}));
        return Response.json({ok:true}); }
      catch(e) { return Response.json({stage:'S3 CopyObject response',name:e.name, message:e.message}); }
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
      return new Response(
        '<CopyObjectResult><ETag>"test-etag"</ETag><LastModified>2026-10-14T00:00:00.000Z</LastModified></CopyObjectResult>',
        { headers: { "Content-Type": "application/xml" } },
      );
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
