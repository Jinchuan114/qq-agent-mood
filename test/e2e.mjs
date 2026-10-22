// 端到端：把一个真的插件实例跑在临时数据目录里，喂它几句话，看它记分、贴提示、面板起不起来。
// 不碰线上她的数据（QQ_AGENT_DATA_DIR 指向临时目录），不需要网络（判官关掉）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qqmood-'));
process.env.QQ_AGENT_DATA_DIR = TMP;
// 面板转发目标：先指到一个没人监听的端口（验「应用没起来时不假成功」），
// 后面再换成测试自己起的假应用。真应用的 3210 可能正开着，不能拿它当默认。
const DEAD_API = 'http://127.0.0.1:3599';
process.env.QQ_AGENT_API = DEAD_API;

const settings = { enabled: true, useJudge: false, panel: true, panelPort: 3291, characterName: '她' };
const tools = {};
const fakeApi = {
  config: () => settings,
  log: () => {},
  registerTool: (t) => { tools[t.id] = t; },
};

const mod = await import('../index.js');
mod.setup(fakeApi);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name} ${extra}`); }
};

const stFile = path.join(TMP, 'self', 'qq-agent-mood', 'mood.json');
const readMood = () => JSON.parse(fs.readFileSync(stFile, 'utf8'));
const round = (v) => Math.round(Number(v));

console.log('· 记分');
// 只有 triggerEntries 里带原文 —— 真机就是这么传的（ctx.text 根本不存在）。
await mod.hooks['before-context']({ chatKey: 'group:1', triggerEntries: [{ text: '你这个人真废物', senderId: '9', senderName: '路人' }] });
ok('数据落在临时目录', fs.existsSync(stFile), stFile);
ok('被骂掉到 −40', round(readMood().score) === -40, JSON.stringify(readMood().score));
ok('档位记成不高兴', readMood().lastKind === 'insult');

console.log('· 不高兴时贴提示 / 能力门');
const messages = [{ role: 'system', content: 'base' }, { role: 'user', content: '在吗' }];
await mod.hooks['before-llm-messages']({ messages, chatKey: 'group:1' });
const tail = JSON.stringify(messages);
ok('不高兴会贴心情行', /不高兴|不太高兴/.test(tail), tail.slice(-240));
ok('不让她报分数', /别报分数/.test(tail));
ok('原消息没被替换', messages[1].content.startsWith('在吗'));
// 默认「只是语气变」：心情低只改语气，不许压气泡、不许静音（设置面板是这么写的，代码必须兑现）
ok('默认只改语气：不压气泡', mod.providers['mood.bubble-cap']() === null, String(mod.providers['mood.bubble-cap']()));
ok('默认只改语气：不静音', Number(mod.providers['mood.mute-rate']()) === 0, String(mod.providers['mood.mute-rate']()));
// 调成「也会少说话」之后，能力门才真的生效
settings.lowMood = '也会少说话';
ok('不高兴时气泡上限 2', round(mod.providers['mood.bubble-cap']()) === 2, String(mod.providers['mood.bubble-cap']()));
ok('不高兴时静音率 0.5', Number(mod.providers['mood.mute-rate']()) === 0.5, String(mod.providers['mood.mute-rate']()));

console.log('· 被哄回来');
await mod.hooks['before-context']({ text: '别难过了，我陪你', chatKey: 'private:5', triggerEntries: [{ senderId: '5', senderName: '主人' }] });
ok('被主人哄回接近 −5', Math.abs(readMood().score - -5) < 1, JSON.stringify(readMood().score));
ok('回升后档位回到平常', mod.providers['mood.bubble-cap']() === null, String(mod.providers['mood.bubble-cap']()));

const before = readMood().score;
await mod.hooks['before-context']({ text: '今天天气不错', chatKey: 'group:1', triggerEntries: [{ senderId: '9', senderName: '路人' }] });
ok('普通句子不改分', Math.abs(readMood().score - before) < 1, `${before} → ${readMood().score}`);

const quiet = [{ role: 'user', content: '在吗' }];
await mod.hooks['before-llm-messages']({ messages: quiet, chatKey: 'group:1' });
ok('平常不贴心情行（省 token）', quiet.length === 1, JSON.stringify(quiet));

console.log('· 能力门读的是文件，不是钩子留下的缓存');
// 把「起算时刻」推到 10 小时前：分数该回落，能力门要跟着变回 null / 0。
// 如果 provider 用的是内存里的 lastBand，这里就会还是「不高兴」。
const stNow = readMood();
stNow.since = Date.now() - 10 * 3600 * 1000;
stNow.at = Date.now() - 10 * 3600 * 1000;
fs.writeFileSync(stFile, JSON.stringify(stNow, null, 2), 'utf8');
ok('时间过去后气泡上限自己放开', mod.providers['mood.bubble-cap']() === null, String(mod.providers['mood.bubble-cap']()));
ok('时间过去后静音率归 0', Number(mod.providers['mood.mute-rate']()) === 0, String(mod.providers['mood.mute-rate']()));

console.log('· 留痕文件不会一直长');
const logFile = path.join(TMP, 'self', 'qq-agent-mood', 'hook.log');
fs.writeFileSync(logFile, Array.from({ length: 8000 }, (_, i) => `old ${i} ${'x'.repeat(60)}`).join('\n'), 'utf8');
const bigBefore = fs.statSync(logFile).size;
await mod.hooks['before-llm-messages']({ messages: [{ role: 'user', content: '在吗' }], chatKey: 'group:1' });
const bigAfter = fs.statSync(logFile).size;
ok('超过 512KB 会被砍短', bigAfter < bigBefore / 2, `${bigBefore} → ${bigAfter}`);
ok('砍完还留着最新一行', /before-llm-messages/.test(fs.readFileSync(logFile, 'utf8').split('\n').slice(-3).join('\n')));

console.log('· 工具');
ok('注册了 note_mood', Boolean(tools.note_mood));
const r = await tools.note_mood.execute({ chatKey: 'private:5', senderId: '5' }, { kind: 'praise', why: '他夸我了' });
ok('她自己记一笔会涨分', round(r?.score) > round(before), JSON.stringify(r));

console.log('· 面板');
let panel = null;
for (let i = 0; i < 30 && !panel; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${settings.panelPort}/api/state`);
    if (res.ok) panel = await res.json();
  } catch { /* 还没起来 */ }
  if (!panel) await new Promise((r2) => setTimeout(r2, 100));
}
ok('面板起来了并能读到状态', Boolean(panel?.ok), JSON.stringify(panel).slice(0, 160));
ok('面板分数跟文件一致', round(panel?.score) === round(readMood().score), `${panel?.score} vs ${readMood().score}`);
const cfgRes = await fetch(`http://127.0.0.1:${settings.panelPort}/api/config`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { calmHours: 9 } }),
});
ok('没有应用时面板改设置会报错、不假成功', cfgRes.status === 502, String(cfgRes.status));

// 反过来：应用在的时候应该转发成功，把设置真交出去。
const http = await import('node:http');
let gotSettings = null;
const fakeApp = http.createServer((rq, rs) => {
  let raw = '';
  rq.on('data', (c) => { raw += c; });
  rq.on('end', () => {
    gotSettings = JSON.parse(raw || '{}').settings || null;
    rs.writeHead(200, { 'content-type': 'application/json' });
    rs.end(JSON.stringify({ ok: true, settings: gotSettings }));
  });
});
await new Promise((r3) => fakeApp.listen(3599, '127.0.0.1', r3));
const cfgRes2 = await fetch(`http://127.0.0.1:${settings.panelPort}/api/config`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { calmHours: 9 } }),
});
const cfgBody = await cfgRes2.json().catch(() => ({}));
ok('应用在的时候面板能把设置转发过去', cfgRes2.status === 200 && gotSettings?.calmHours === 9, `${cfgRes2.status} ${JSON.stringify(cfgBody)}`);
fakeApp.close();
process.env.QQ_AGENT_API = DEAD_API;

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
console.log(`临时目录：${TMP}`);
try { mod.dispose(); } catch { /* 关不掉也无所谓 */ }
process.exit(fail ? 1 : 0);
