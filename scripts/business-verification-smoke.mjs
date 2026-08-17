import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const business = read("lib/public-business.ts");
const businessPage = read("app/business/page.tsx");
const checkoutPage = read("app/checkout/page.tsx");
const footer = read("app/public-site.tsx");
const language = read("lib/public-language.ts");
const switcher = read("app/public-language-switch.tsx");

assert.match(business, /北京简融易数科技有限公司/);
assert.match(business, /北京华腾大厦1005室/);
assert.match(business, /\+86 133 1136 5567/);
assert.match(business, /Beijing Jianrong Yishu Technology Co\., Ltd\./);
assert.match(businessPage, /Credit packs and prices/);
assert.match(businessPage, /Business and contact details/);
assert.match(checkoutPage, /Pay with Xendit/);
assert.match(checkoutPage, /Terms of Service/);
assert.match(checkoutPage, /选择预付费 Credits 套餐/);
assert.match(language, /return value === "zh-CN" \? "zh-CN" : "en"/);
assert.match(switcher, /kv_public_language/);
for (const page of ["business", "checkout", "contact", "privacy", "refund-policy", "terms"]) {
  assert.match(read(`app/${page}/page.tsx`), /getPublicLanguage/);
}
for (const path of ["\/terms", "\/privacy", "\/refund-policy", "\/contact", "\/checkout"]) {
  assert.match(footer, new RegExp(path));
}

console.log("Business verification public-site smoke passed.");
