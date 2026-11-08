import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const exe = ["C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe"].find(existsSync);
const b = await chromium.launch({ executablePath: exe, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--disable-crash-reporter"] });
const c = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: "zh-CN", colorScheme: "dark" });
const p = await c.newPage();
const wd = (new Date().getDay() + 6) % 7;
const seed = { schema:1, settings:{ theme:"liquid-glass", colorMode:"dark", perf:"balanced", glassBlur:true, onboarded:true, blocks:[], quoteSeed:"x", studyFrom:"17:40", studyTo:"22:30" },
  periods:[{id:"p1",name:"第1节",start:"08:00",end:"08:45",counts:true}],
  courses:[{id:"c1",subject:"数学",title:"数学",weekday:wd,periodId:"p1"}],
  goals:[],tasks:[],sessions:[],dates:[],
  background:{current:"scene:aurora",mode:"fixed",rotateMinutes:60,enabledIds:["scene:aurora"],custom:[],dim:0.35,dynamic:false,showVeil:true},
  timer:null, courseStatus:{} };
await p.goto("http://127.0.0.1:5188/", { waitUntil: "load" });
await p.evaluate((s)=>localStorage.setItem("learning-os:v1:state", JSON.stringify(s)), seed);
await p.goto("http://127.0.0.1:5188/#/stats", { waitUntil: "load" });
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(2200);
const r = await p.evaluate(() => {
  const t = document.querySelector("main")?.textContent ?? "";
  return {
    hasSection: t.includes("课程完成情况"),
    hasSeparateNote: t.includes("与学习时长互不相干"),
    hasStat: t.includes("今天课程"),
    hasWarning: t.includes("学校上课时间不计入学习时长"),
    courseRows: Array.from(document.querySelectorAll("main .pill")).map(e=>e.textContent.trim()).filter(x=>["已上完","未确认","请假","调课"].includes(x)),
  };
});
console.log(JSON.stringify(r, null, 2));
await p.screenshot({ path: ".preview/glass/stats-courses.png", fullPage: true });
await b.close();
