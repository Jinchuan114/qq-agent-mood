// 面板：插件自己起的一个小服务，只监听 127.0.0.1。
//
// 为什么不是"加个页面进应用"：插件没有路由、也没有页面权限（改核心才行）。
// 自己起服务的好处是：页面和接口同源，绕开跨域与 CSP；卸载插件页面自然消失。
// 端口被占就往后顺延，并把真实端口写回日志/接口。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bandOf } from '../lib/score.js';
import { BAND_TEXT } from '../lib/score.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, 'index.html');
// 转发目标每次现读环境变量：测试里要靠它把「应用没起来」和「应用在」分开验。
const appApiBase = () => String(process.env.QQ_AGENT_API || 'http://127.0.0.1:3210').replace(/\/+$/, '');
const SKILL_ID = 'qq-agent-mood';

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * @param {object} deps  { cfg, log, read, write, clear, apply, bandOf, clampScore, setCache }
 * @returns {Promise<{port:number, close:Function}>}
 */
export async function startPanel(deps) {
  const { cfg, log = () => {}, read, write, clear, apply, setCache } = deps;
  const basePort = Math.max(1024, Math.min(65535, Number(cfg()?.panelPort) || 3221));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const c = cfg();

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      try {
        const html = fs.readFileSync(PAGE);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
      } catch (error) {
        json(res, 500, { ok: false, error: `面板文件读不到：${error.message}` });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const st = await read();
      const band = bandOf(Number(st.score) || 0, c.bands || {});
      const history = Array.isArray(st.history) ? st.history.slice(0, 8) : [];
      json(res, 200, {
        ok: true,
        score: Number(st.score) || 0,
        band,
        bandText: BAND_TEXT[band] || BAND_TEXT.calm,
        history,
        since: st.since ?? st.at ?? Date.now(),
        config: {
          characterName: c.characterName,
          temper: c.temperScale,
          calmHours: c.calmHours,
          lowMood: c.lowMood,
          useJudge: c.useJudge,
          decayStrength: c.decayStrength,
          bands: c.bands,
          weights: c.weights,
          judgeMaxPerDay: c.judgeMaxPerDay,
        },
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/config') {
      const body = await readBody(req);
      // 设置由应用保管（config.skills['qq-agent-mood']），面板不自己另存一份
      try {
        const r = await fetch(`${appApiBase()}/api/skills/${SKILL_ID}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ settings: body.settings || body || {} }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data?.ok === false) return json(res, 502, { ok: false, error: data?.error || `应用回了 ${r.status}` });
        json(res, 200, { ok: true, settings: data.settings || {} });
      } catch (error) {
        json(res, 502, { ok: false, error: `连不上应用（${appApiBase()}）：${error.message}` });
      }
      return;
    }

    // 手动记一笔（面板上「试一下」用，改完立刻能看到分数动）
    if (req.method === 'POST' && url.pathname === '/api/note') {
      const body = await readBody(req);
      const st = await read();
      const res1 = apply(String(body.kind || 'neutral'), {
        state: st, cfg: c, isOwner: body.isOwner !== false,
        why: String(body.why || '面板上手动记的').slice(0, 60), from: '面板',
        now: Date.now(), deterministic: true,
      });
      await write(res1.state);
      setCache?.(res1.band);
      json(res, 200, { ok: true, delta: res1.delta, score: res1.score, band: res1.band });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      await clear();
      await write({ score: 0, at: Date.now(), since: Date.now(), history: [], streak: {} });
      setCache?.('calm');
      json(res, 200, { ok: true, score: 0, band: 'calm' });
      return;
    }

    json(res, 404, { ok: false, error: '没有这个接口' });
  });

  // 端口被占就往后退几个
  const port = await new Promise((resolve, reject) => {
    let tries = 0;
    const tryListen = (p) => {
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && tries < 6) { tries += 1; tryListen(p + 1); return; }
        reject(error);
      });
      server.listen(p, '127.0.0.1', () => resolve(p));
    };
    tryListen(basePort);
  });

  return {
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
