// ==UserScript==
// @name         超星考试题目批量导出
// @namespace    chaoxing-exam-export
// @version      1.0.0
// @description  逐题翻页采集超星考试所有题目（含正确答案），导出JSON供本地练习使用
// @author       You
// @match        *://*.chaoxing.com/exam-ans/exam/test/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ── 配置 ──────────────────────────────────────────────
  const STORAGE_KEY = 'cx_export_questions';
  const PROGRESS_KEY = 'cx_export_progress';
  const AUTO_DELAY = 2500; // 每题等待DOM渲染的毫秒数

  // ── 注入样式 ──────────────────────────────────────────
  GM_addStyle(`
    #cx-export-panel {
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      background: #fff; border: 2px solid #2196F3; border-radius: 12px;
      padding: 16px 20px; min-width: 280px;
      box-shadow: 0 8px 32px rgba(0,0,0,.18); font-size: 14px;
      font-family: "Microsoft YaHei", sans-serif;
    }
    #cx-export-panel h3 {
      margin: 0 0 10px; font-size: 16px; color: #1976D2;
    }
    #cx-export-panel .info { color: #666; margin-bottom: 8px; }
    #cx-export-panel .bar-wrap {
      height: 10px; background: #e0e0e0; border-radius: 5px;
      margin: 8px 0; overflow: hidden;
    }
    #cx-export-panel .bar-inner {
      height: 100%; width: 0%; background: linear-gradient(90deg,#2196F3,#00BCD4);
      border-radius: 5px; transition: width .3s;
    }
    #cx-export-panel button {
      padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer;
      font-size: 13px; margin: 4px 4px 0 0;
    }
    #cx-export-panel .btn-start  { background: #2196F3; color: #fff; }
    #cx-export-panel .btn-stop   { background: #f44336; color: #fff; }
    #cx-export-panel .btn-pause  { background: #FF9800; color: #fff; }
    #cx-export-panel .btn-down   { background: #4CAF50; color: #fff; }
    #cx-export-panel .btn-reset  { background: #9E9E9E; color: #fff; }
    #cx-export-panel button:disabled { opacity: .45; cursor: not-allowed; }
  `);

  // ── DOM解析: 提取当前页面的题目与正确答案 ──────────────
  function parseCurrentQuestion() {
    const qWrap = document.querySelector('.questionLi');
    if (!qWrap) return null;

    // 题号
    const markName = qWrap.querySelector('.mark_name');
    const numText = markName ? markName.childNodes[0]?.textContent?.trim().replace(/\.$/, '') : '?';

    // 题型
    const typeSpan = qWrap.querySelector('.colorShallow');
    const typeName = typeSpan ? typeSpan.textContent.replace(/[()（）]/g, '').trim() : '';

    // 题目ID
    const qid = qWrap.getAttribute('data') || '';

    // 题干
    const stemDiv = markName ? markName.querySelector('div:last-child') : null;
    const stem = stemDiv ? stemDiv.textContent.trim() : '';

    // 选项
    const options = [];
    const optionEls = qWrap.querySelectorAll('.stem_answer .answerBg');
    optionEls.forEach(function (opt) {
      const letter = opt.querySelector('span')?.getAttribute('data') || '';
      const text = opt.querySelector('.answer_p')?.textContent?.trim() || '';
      if (letter) options.push({ label: letter, text: text });
    });

    // 正确答案 (来自 .eye_over .yoursanswer)
    const answerEl = qWrap.querySelector('.eye_over .yoursanswer');
    let answer = '';
    if (answerEl) {
      answer = answerEl.textContent?.trim() || answerEl.getAttribute('data') || '';
    }
    // 填空/简答类题型正确答案可能在其他位置
    if (!answer) {
      const eyeOver = qWrap.querySelector('.eye_over');
      if (eyeOver) {
        const ansSpans = eyeOver.querySelectorAll('.yoursanswer');
        if (ansSpans.length > 0) {
          answer = Array.from(ansSpans).map(function (s) { return s.textContent.trim() || s.getAttribute('data') || ''; }).join('；');
        }
      }
    }

    // 学生答案
    const myEl = qWrap.querySelector('.eye_over .myanswer');
    let myAnswer = '';
    if (myEl) {
      myAnswer = myEl.textContent?.trim() || myEl.getAttribute('data') || '';
    }

    // 所属章节 (从 type_tit 获取)
    const typeTit = qWrap.querySelector('.type_tit');
    const section = typeTit ? typeTit.textContent.trim().replace(/^[一二三四五六七八九十]+[、，,]?\s*/, '') : '';

    return {
      index: parseInt(numText) || 0,
      qid: qid,
      type: typeName,
      section: section,
      stem: stem,
      options: options,
      answer: answer,
      myAnswer: myAnswer
    };
  }

  // ── 工具: 创建面板 ────────────────────────────────────
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'cx-export-panel';
    panel.innerHTML = `
      <h3>📤 题目批量导出</h3>
      <div class="info" id="cx-info">准备就绪</div>
      <div class="bar-wrap"><div class="bar-inner" id="cx-bar"></div></div>
      <div>
        <button class="btn-start" id="cx-btn-start">▶ 开始导出</button>
        <button class="btn-pause" id="cx-btn-pause" disabled>⏸ 暂停</button>
        <button class="btn-stop" id="cx-btn-stop" disabled>⏹ 停止</button>
        <button class="btn-down" id="cx-btn-down" disabled>💾 下载JSON</button>
        <button class="btn-reset" id="cx-btn-reset">🔄 重置</button>
      </div>
    `;
    document.body.appendChild(panel);

    const $ = function (id) { return document.getElementById(id); };
    const info = $('cx-info');
    const bar = $('cx-bar');
    const btnStart = $('cx-btn-start');
    const btnPause = $('cx-btn-pause');
    const btnStop = $('cx-btn-stop');
    const btnDown = $('cx-btn-down');
    const btnReset = $('cx-btn-reset');

    // 刷新状态
    function refreshUI() {
      const prog = GM_getValue(PROGRESS_KEY, null);
      const questions = GM_getValue(STORAGE_KEY, []);
      const total = getTotalCount();

      if (prog && prog.running && !prog.paused) {
        info.textContent = '⏳ 采集中... 第 ' + (prog.current + 1) + ' / ' + total + ' 题';
        bar.style.width = (prog.current / Math.max(total, 1) * 100) + '%';
        btnStart.disabled = true;
        btnPause.disabled = false;
        btnStop.disabled = false;
      } else if (prog && prog.paused) {
        info.textContent = '⏸ 已暂停 — 第 ' + (prog.current + 1) + ' / ' + total + ' 题';
        bar.style.width = (prog.current / Math.max(total, 1) * 100) + '%';
        btnStart.disabled = false;
        btnStart.textContent = '▶ 继续';
        btnPause.disabled = true;
        btnStop.disabled = false;
      } else if (questions.length > 0) {
        info.textContent = '✅ 已采集 ' + questions.length + ' 题（去重后），点击下载';
        bar.style.width = '100%';
        btnStart.disabled = false;
        btnStart.textContent = '▶ 开始导出';
        btnPause.disabled = true;
        btnStop.disabled = true;
        btnDown.disabled = false;
      } else {
        info.textContent = '准备就绪，点击开始逐题采集';
        bar.style.width = '0%';
        btnStart.disabled = false;
        btnStart.textContent = '▶ 开始导出';
        btnPause.disabled = true;
        btnStop.disabled = true;
        btnDown.disabled = true;
      }
    }

    // 获取总题数
    function getTotalCount() {
      const lis = document.querySelectorAll('.topicNumber_list li');
      // 统计所有章节的总题数
      let count = 0;
      const allLists = document.querySelectorAll('.topicNumber_list');
      allLists.forEach(function (ul) { count += ul.querySelectorAll('li').length; });
      return count > 0 ? count : 500; // 兜底
    }

    // 翻页到指定题目
    function goToQuestion(index, answeredView) {
      const startInput = document.getElementById('start');
      if (startInput) {
        // 通过修改start值后提交表单
        startInput.value = index;
        const form = document.getElementById('submitTest');
        if (form) {
          // 改为显示答案模式
          const answeredInput = document.getElementById('answeredView');
          if (answeredInput) answeredInput.value = answeredView ? '1' : '0';
          form.submit();
          return;
        }
      }
      // 兜底: 直接修改URL跳转
      let url = window.location.href;
      url = url.replace(/[?&]start=\d+/, '');
      url = url.replace(/[?&]answeredView=\d+/, '');
      if (answeredView) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + 'answeredView=1';
      }
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 'start=' + index;
      window.location.href = url;
    }

    // 采集当前题目
    function collectCurrent() {
      const q = parseCurrentQuestion();
      if (!q) return false;

      const questions = GM_getValue(STORAGE_KEY, []);
      // 去重: 按 qid 优先，其次按题干+题型
      const exists = questions.some(function (e) {
        if (q.qid && e.qid && q.qid === e.qid) return true;
        return e.stem === q.stem && e.type === q.type;
      });
      if (!exists) {
        questions.push(q);
        GM_setValue(STORAGE_KEY, questions);
      }
      return true;
    }

    // 主循环: 采集 → 翻页
    function runLoop() {
      const prog = GM_getValue(PROGRESS_KEY, null);
      if (!prog || !prog.running || prog.paused) return;

      const total = prog.total;
      const current = prog.current;

      if (current >= total) {
        // 完成
        prog.running = false;
        GM_setValue(PROGRESS_KEY, prog);
        refreshUI();
        info.textContent = '🎉 全部采集完成！共 ' + GM_getValue(STORAGE_KEY, []).length + ' 题（去重后）';
        btnDown.disabled = false;
        return;
      }

      // 检查是否在显示答案模式
      const answeredView = document.getElementById('answeredView');
      const isAnswerMode = answeredView && answeredView.value === '1';
      const hasAnswer = document.querySelector('.eye_over .yoursanswer');

      if (isAnswerMode && hasAnswer) {
        // 已经有答案，直接采集并翻到下一题
        collectCurrent();
        prog.current = current + 1;
        GM_setValue(PROGRESS_KEY, prog);

        // 翻到下一题（非答案模式，因为下一页还要先点"显示答案"）
        goToQuestion(current + 1, false);
      } else if (isAnswerMode && !hasAnswer) {
        // 答案模式但答案还没出来，等待
        setTimeout(runLoop, 1000);
      } else {
        // 非答案模式 → 采集题干信息（不含答案）然后点"显示答案"
        // 先快速采集题干/选项，然后再点显示答案
        collectCurrent();

        // 点击"显示答案"
        const eyeopen = document.querySelector('.eyeopen');
        if (eyeopen) {
          // 通过表单提交方式触发
          const answeredInput = document.getElementById('answeredView');
          if (answeredInput) answeredInput.value = '1';
          const form = document.getElementById('submitTest');
          if (form) {
            const startVal = document.getElementById('start')?.value || current;
            prog.current = current; // 保持当前索引
            GM_setValue(PROGRESS_KEY, prog);
            form.submit();
            return;
          }
        }

        // 如果没有显示答案按钮，直接翻页
        prog.current = current + 1;
        GM_setValue(PROGRESS_KEY, prog);
        goToQuestion(current + 1, true);
      }
    }

    // 按钮事件
    btnStart.addEventListener('click', function () {
      const prog = GM_getValue(PROGRESS_KEY, null);
      if (prog && prog.paused) {
        // 继续
        prog.paused = false;
        GM_setValue(PROGRESS_KEY, prog);
        refreshUI();
        setTimeout(runLoop, AUTO_DELAY);
        return;
      }

      // 新建导出
      const total = getTotalCount();
      const newProg = {
        running: true,
        paused: false,
        current: 0,
        total: total,
        startedAt: Date.now()
      };
      GM_setValue(PROGRESS_KEY, newProg);
      refreshUI();
      // 跳到第0题，带答案模式
      goToQuestion(0, true);
    });

    btnPause.addEventListener('click', function () {
      const prog = GM_getValue(PROGRESS_KEY, null);
      if (prog) {
        prog.paused = true;
        GM_setValue(PROGRESS_KEY, prog);
        refreshUI();
      }
    });

    btnStop.addEventListener('click', function () {
      const prog = GM_getValue(PROGRESS_KEY, null);
      if (prog) {
        prog.running = false;
        GM_setValue(PROGRESS_KEY, prog);
        refreshUI();
      }
    });

    btnDown.addEventListener('click', function () {
      const questions = GM_getValue(STORAGE_KEY, []);
      if (questions.length === 0) {
        alert('还没有采集到题目！');
        return;
      }
      const json = JSON.stringify(questions, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chaoxing-exam-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    btnReset.addEventListener('click', function () {
      if (confirm('确定清除所有采集进度和已导出数据？')) {
        GM_setValue(STORAGE_KEY, []);
        GM_setValue(PROGRESS_KEY, null);
        refreshUI();
        info.textContent = '已重置，准备就绪';
        bar.style.width = '0%';
      }
    });

    // 初始化
    refreshUI();

    // 自动继续（如果之前有进行中的任务）
    const prog = GM_getValue(PROGRESS_KEY, null);
    if (prog && prog.running && !prog.paused) {
      setTimeout(runLoop, AUTO_DELAY);
    }
  }

  // ── 启动 ──────────────────────────────────────────────
  function init() {
    // 确保在考试页面
    if (!document.querySelector('.questionLi') && !document.querySelector('.topicNumber_list')) {
      return;
    }

    // 检查是否已经显示答案模式（自动采集）
    const answeredView = document.getElementById('answeredView');
    const isAnswerMode = answeredView && answeredView.value === '1';
    const prog = GM_getValue(PROGRESS_KEY, null);

    if (isAnswerMode && prog && prog.running && !prog.paused) {
      // 在答案模式下等待DOM加载完成后采集
      const checkAndCollect = function () {
        const hasAnswer = document.querySelector('.eye_over .yoursanswer');
        if (hasAnswer) {
          const q = parseCurrentQuestion();
          if (q) {
            const questions = GM_getValue(STORAGE_KEY, []);
            const exists = questions.some(function (e) {
              if (q.qid && e.qid && q.qid === e.qid) return true;
              return e.stem === q.stem && e.type === q.type;
            });
            if (!exists) {
              questions.push(q);
              GM_setValue(STORAGE_KEY, questions);
            }
          }
          // 翻到下一题（非答案模式）
          const total = prog.total;
          const next = prog.current + 1;
          prog.current = next;
          if (next >= total) {
            prog.running = false;
            GM_setValue(PROGRESS_KEY, prog);
          } else {
            GM_setValue(PROGRESS_KEY, prog);
            const startInput = document.getElementById('start');
            if (startInput) {
              startInput.value = next;
              const answeredInput = document.getElementById('answeredView');
              if (answeredInput) answeredInput.value = '0';
              const form = document.getElementById('submitTest');
              if (form) {
                form.submit();
                return;
              }
            }
          }
        } else {
          setTimeout(checkAndCollect, 800);
        }
      };
      setTimeout(checkAndCollect, 1200);
    }

    createPanel();
  }

  // 页面加载完成后启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
