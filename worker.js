// 青竹十六張：在瀏覽器背景執行 Python 牌桌（Pyodide），避免畫面卡住。
import { loadPyodide } from './pyodide/pyodide.mjs';

const progress = (text, pct) => postMessage({ type: 'progress', text, pct });
let handle = null;

const ready = (async () => {
  try {
    progress('下載 Python 執行環境…', 10);
    const py = await loadPyodide({ indexURL: new URL('./pyodide/', self.location).href });
    progress('載入 numpy 與規則檔讀取器…', 45);
    await py.loadPackage(['numpy', 'pyyaml'], { messageCallback: () => {} });
    progress('載入牌桌程式…', 70);
    const res = await fetch(new URL('./qingzhu-py.zip', self.location));
    if (!res.ok) throw new Error('無法下載牌桌程式（' + res.status + '）');
    py.unpackArchive(new Uint8Array(await res.arrayBuffer()), 'zip', { extractDir: '/home/pyodide/qz' });
    py.runPython("import sys; sys.path.insert(0, '/home/pyodide/qz')");
    progress('準備 AI 模型…', 85);
    const boot = py.runPython('import json, qz_web; json.dumps(qz_web.boot())');
    handle = py.globals.get('qz_web').handle;
    progress('完成', 100);
    postMessage({ type: 'ready', boot: JSON.parse(boot) });
  } catch (error) {
    postMessage({ type: 'fatal', message: String(error && error.message || error) });
    throw error;
  }
})();

onmessage = async (event) => {
  const { id, method, path, body } = event.data;
  try {
    await ready;
    const result = handle(method, path, body ?? null);
    const [status, text] = result.toJs();
    result.destroy();
    postMessage({ id, status, text });
  } catch (error) {
    postMessage({ id, status: 500, text: JSON.stringify({ error: '瀏覽器牌桌無法執行：' + String(error && error.message || error) }) });
  }
};
