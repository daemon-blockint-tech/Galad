import { isAllowedEntryUrl } from "./src/core/plugins/validateManifest";
const S = "https://app.invalid/";                                  // sentinel (new)
const R = "https://galad.example.com/_next/static/chunks/main-abc.js"; // real import() base
const c = [
  "/plugins/ok.js", "./plugins/ok.js", "../plugins/ok.js", "../../../plugins/ok.js",
  "plugins/ok.js", "./ok.js", "ok.js",
  "/api/camera/proxy/iframe?url=https://evil.com/x.js",
  "/plugins/../api/camera/proxy/iframe?url=https://evil.com/x.js",
  "/plugins/..%2fapi/camera/proxy/iframe?url=https://evil.com/x.js",
  "/plugins/..%2F..%2Fapi/camera/proxy/iframe?url=https://evil.com/x.js",
  "/plugins/;/../api/camera/proxy/iframe?url=https://evil.com/x.js",
  "/plugins/\\..\\api/camera/proxy/iframe?url=https://evil.com/x.js",
  "/plugins/x.js/../../api/camera/proxy/iframe?url=e",
  "//app.invalid/plugins/x.js", "https://app.invalid/plugins/x.js",
  "blob:https://app.invalid/plugins/x",
  "https://unpkg.com/x.js", "https://ｕｎｐｋｇ.com/x.js", "https://GROND.DEV./x.js",
  "http://127.1/x.js", "http://localhost/x.js",
  "https://unpkg.com/goodpkg@1.0.0/../../evilpkg@9.9.9/dist/evil.mjs?/dist/frontend.mjs",
];
for (const x of c) {
  const p = (b:string)=>{try{const u=new URL(x,b);return u.href+"  [path="+u.pathname+"]";}catch{return "PARSE-ERR";}};
  console.log(`${isAllowedEntryUrl(x)?"ALLOW":"block"}  ${JSON.stringify(x)}\n   sentinel=${p(S)}\n   browser =${p(R)}`);
}
