// ==UserScript==
// @name         超星考试题目批量导出（查看详情页）
// @namespace    chaoxing-exam-export
// @version      2.0.0
// @description  在超星"查看详情"页面一键解析全部题目（含正确答案），导出JSON供本地练习
// @author       You
// @match        *://*.chaoxing.com/exam-ans/exam/test/reVersionPaperMarkContentNew*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ── 注入样式 ──
  GM_addStyle(`
    #cx-export-panel {
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      background: #fff; border: 2px solid #2196F3; border-radius: 12px;
      padding: 16px 20px; min-width: 260px;
      box-shadow: 0 8px 32px rgba(0,0,0,.18); font-size: 14px;
      font-family: "Microsoft YaHei", sans-serif;
    }
    #cx-export-panel h3 {
      margin: 0 0 10px; font-size: 16px; color: #1976D2;
    }
    #cx-export-panel .info { color: #666; margin-bottom: 8px; line-height: 1.6; }
    #cx-export-panel .info b { color: #1a73e8; }
    #cx-export-panel button {
      padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer;
      font-size: 13px; margin: 4px 4px 0 0;
    }
    #cx-export-panel .btn-download { background: #4CAF50; color: #fff; }
    #cx-export-panel .btn-copy    { background: #2196F3; color: #fff; }
    #cx-export-panel .btn-rescan  { background: #FF9800; color: #fff; }
    #cx-export-panel button:hover { opacity: .85; }
  `);

  // ── 题型码映射 ──
  function normalizeType(rawType) {
    const t = (rawType || '').replace(/[()（）]/g, '').trim().replace(/^\d+\.?\s*/, '');
    if (/单/.test(t)) return '单选题';
    if (/多/.test(t)) return '多选题';
    if (/判断/.test(t)) return '判断题';
    if (/填空/.test(t)) return '填空题';
    if (/简答|问答/.test(t)) return '简答题';
    if (/计算/.test(t)) return '计算题';
    if (/案例.*分析|分析.*案例/.test(t)) return '案例分析题';
    if (/统考/.test(t)) return '单选题';  // 统考真题本质是单选
    return t || '简答题';
  }

  function isChoiceType(type) {
    return type === '单选题' || type === '多选题' || type === '判断题';
  }

  // ── 解析全部题目 ──
  function parseAllQuestions() {
    const questionEls = document.querySelectorAll('.questionLi');
    if (!questionEls || questionEls.length === 0) {
      return { error: '未找到题目，请确认在"查看详情"页面且页面已加载完毕。' };
    }

    const results = [];
    const sections = [];  // 章节信息：{section, startIndex}

    // 收集所有 h2.type_tit 的位置
    const typeTits = document.querySelectorAll('.mark_table h2.type_tit');
    const titMap = new Map(); // element -> section name
    typeTits.forEach(function (tit) {
      titMap.set(tit, tit.textContent.trim());
    });

    questionEls.forEach(function (qWrap, idx) {
      try {
        const qid = qWrap.getAttribute('data') || qWrap.id?.replace('question', '') || '';

        // ── 找到最近的前一个 h2.type_tit 作为章节 ──
        let section = '';
        let prev = qWrap.previousElementSibling;
        while (prev) {
          if (prev.tagName === 'H2' && prev.classList.contains('type_tit')) {
            section = prev.textContent.trim().replace(/^[一二三四五六七八九十]+[、，,.\s]*/, '');
            break;
          }
          prev = prev.previousElementSibling;
        }

        // ── 题号 + 题型 + 题干 ──
        const markName = qWrap.querySelector('.mark_name');
        const numText = markName
          ? markName.childNodes[0]?.textContent?.trim().replace(/\.$/, '')
          : String(idx + 1);

        const typeSpan = qWrap.querySelector('.colorShallow');
        const rawType = typeSpan ? typeSpan.textContent.trim() : '';
        const type = normalizeType(rawType);

        const stemEl = qWrap.querySelector('.qtContent');
        const stem = stemEl ? stemEl.textContent.trim() : '';

        // ── 选项 (仅选择题) ──
        const options = [];
        if (isChoiceType(type)) {
          const optLis = qWrap.querySelectorAll('ul.qtDetail > li');
          optLis.forEach(function (li) {
            const text = li.textContent.trim();
            const match = text.match(/^([A-Za-z]+)[.、．]\s*(.*)/);
            if (match) {
              options.push({ label: match[1], text: match[2] });
            } else {
              options.push({ label: '', text: text });
            }
          });
        }

        // ── 正确答案 ──
        let answer = '';
        const isChoice = isChoiceType(type);

        if (isChoice) {
          // 选择题：从 .rightAnswerContent 获取
          const rightEl = qWrap.querySelector('.mark_key .rightAnswerContent');
          answer = rightEl ? rightEl.textContent.trim() : '';
        } else {
          // 填空/简答：从 dl.mark_fill.colorGreen dd.rightAnswerContent 获取
          const rightDDs = qWrap.querySelectorAll('dl.mark_fill.colorGreen dd.rightAnswerContent');
          if (rightDDs.length > 0) {
            answer = Array.from(rightDDs).map(function (dd) {
              return dd.textContent.trim();
            }).join('\n');
          } else {
            // 兜底
            const anyRight = qWrap.querySelector('.rightAnswerContent');
            answer = anyRight ? anyRight.textContent.trim() : '';
          }
        }

        // ── 学生答案 ──
        let myAnswer = '';
        if (isChoice) {
          const stuEl = qWrap.querySelector('.mark_key .stuAnswerContent');
          myAnswer = stuEl ? stuEl.textContent.trim() : '';
        } else {
          const stuDDs = qWrap.querySelectorAll('dl.mark_fill.colorDeep dd.stuAnswerContent');
          myAnswer = Array.from(stuDDs).map(function (dd) {
            return dd.textContent.trim();
          }).join('\n').trim();
        }

        // ── 对错状态 ──
        const judgeSpan = qWrap.querySelector('.mark_judge_name span');
        let isCorrect = null; // null = 未知 / 未批改
        if (judgeSpan) {
          if (judgeSpan.classList.contains('marking_dui')) isCorrect = true;
          else if (judgeSpan.classList.contains('marking_cuo')) isCorrect = false;
        }

        // ── 答案解析 ──
        const analysisEl = qWrap.querySelector('.qtAnalysis');
        const analysis = analysisEl ? analysisEl.textContent.trim() : '';

        // ── 难度 ──
        let difficulty = '';
        const analysisBlocks = qWrap.querySelectorAll('.analysis');
        analysisBlocks.forEach(function (block) {
          const text = block.textContent;
          if (text.includes('难易度')) {
            difficulty = text.replace(/难易度[：:]\s*/, '').trim();
          }
        });

        results.push({
          index: parseInt(numText) || (idx + 1),
          qid: qid,
          type: type,
          section: section,
          stem: stem,
          options: options,
          answer: answer,
          myAnswer: myAnswer,
          isCorrect: isCorrect,
          analysis: analysis,
          difficulty: difficulty
        });
      } catch (e) {
        console.warn('[CX Export] 解析第 ' + (idx + 1) + ' 题出错:', e);
      }
    });

    return results;
  }

  // ── 统计 ──
  function buildStats(questions) {
    const typeCount = {};
    let withAnswer = 0;
    questions.forEach(function (q) {
      const t = q.type || '其他';
      typeCount[t] = (typeCount[t] || 0) + 1;
      if (q.answer) withAnswer++;
    });
    return { typeCount: typeCount, withAnswer: withAnswer };
  }

  // ── 创建面板 ──
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'cx-export-panel';

    const questions = parseAllQuestions();
    let infoHtml = '';

    if (questions.error) {
      infoHtml = '<span style="color:#f44336;">' + questions.error + '</span>';
    } else if (Array.isArray(questions)) {
      const stats = buildStats(questions);
      infoHtml = '📋 共解析 <b>' + questions.length + '</b> 题，含答案 <b>' + stats.withAnswer + '</b> 题<br>';
      infoHtml += '题型分布：';
      Object.keys(stats.typeCount).forEach(function (t) {
        infoHtml += '<b>' + t + '</b>×' + stats.typeCount[t] + ' ';
      });
    }

    panel.innerHTML =
      '<h3>📤 题目导出</h3>' +
      '<div class="info">' + infoHtml + '</div>' +
      '<div style="margin-top:8px;">' +
      '  <button class="btn-download" id="cx-btn-dl">💾 下载JSON</button>' +
      '  <button class="btn-copy" id="cx-btn-cp">📋 复制JSON</button>' +
      '  <button class="btn-rescan" id="cx-btn-rs">🔄 重新扫描</button>' +
      '</div>';

    document.body.appendChild(panel);

    // ── 按钮事件 ──
    document.getElementById('cx-btn-dl').addEventListener('click', function () {
      const data = parseAllQuestions();
      if (data.error) { alert(data.error); return; }
      downloadJSON(data, 'chaoxing-exam-' + new Date().toISOString().slice(0, 10) + '.json');
    });

    document.getElementById('cx-btn-cp').addEventListener('click', function () {
      const data = parseAllQuestions();
      if (data.error) { alert(data.error); return; }
      const json = JSON.stringify(data, null, 2);
      navigator.clipboard.writeText(json).then(function () {
        alert('✅ 已复制 ' + data.length + ' 题到剪贴板！');
      }).catch(function () {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = json;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        alert('✅ 已复制 ' + data.length + ' 题到剪贴板！');
      });
    });

    document.getElementById('cx-btn-rs').addEventListener('click', function () {
      panel.remove();
      createPanel();
    });
  }

  function downloadJSON(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── 等待DOM完整后启动 ──
  function init() {
    const questionEls = document.querySelectorAll('.questionLi');
    if (questionEls.length === 0) {
      // 可能还在渲染，等一等
      setTimeout(init, 1000);
      return;
    }
    createPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(init, 1500);
    });
  } else {
    setTimeout(init, 1500);
  }
})();
