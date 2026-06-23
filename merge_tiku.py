"""
题库JSON合并去重工具
用法: python merge_tiku.py [文件夹路径] [输出文件名]
默认: 合并 tiku/ 下所有 .json -> merged.json

去重策略：内容优先（归一化题干 + 题型 + 正确答案）
qid 不可靠 — 同一道题在不同考试中 qid 不同
"""
import json
import sys
import os
from pathlib import Path


def normalize(s):
    """归一化字符串：去首尾空白，合并连续空白为单个空格"""
    if not s:
        return ''
    return ' '.join(s.replace('\n', ' ').replace('\t', ' ').replace('\r', ' ').split())


def content_key(q):
    """内容去重key：归一化(题干, 题型, 正确答案)"""
    stem = normalize(q.get('stem', ''))
    qtype = normalize(q.get('type', ''))
    answer = normalize(q.get('answer', ''))
    return (stem, qtype, answer)


def load_json_files(folder):
    """加载文件夹内所有JSON文件"""
    folder = Path(folder)
    if not folder.exists():
        print(f'[ERROR] 文件夹不存在: {folder}')
        sys.exit(1)

    files = sorted(folder.glob('*.json'))
    if not files:
        print(f'[ERROR] 文件夹内没有JSON文件: {folder}')
        sys.exit(1)

    all_questions = []
    for f in files:
        try:
            data = json.loads(f.read_text(encoding='utf-8'))
            if isinstance(data, list):
                all_questions.extend(data)
                print(f'  [OK] {f.name} -> {len(data)} 题')
            else:
                print(f'  [SKIP] {f.name} -> 不是数组，跳过')
        except json.JSONDecodeError as e:
            print(f'  [SKIP] {f.name} -> JSON解析失败: {e}')

    return all_questions


def merge_and_dedup(all_questions):
    """合并去重，内容相同取第一个出现（保留更完整的那份）"""
    seen = {}     # key -> index in merged list
    merged = []
    dup_count = 0

    for q in all_questions:
        k = content_key(q)
        if k not in seen:
            seen[k] = len(merged)
            merged.append(q)
        else:
            dup_count += 1
            # 如果新题有更完整的数据（如analysis），替补进去
            existing = merged[seen[k]]
            if (q.get('analysis') and not existing.get('analysis')):
                merged[seen[k]] = q
            elif (q.get('options') and not existing.get('options')):
                merged[seen[k]] = q

    return merged, dup_count


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'tiku')
    output = sys.argv[2] if len(sys.argv) > 2 else os.path.join(folder, '..', 'merged.json')

    print(f'[SCAN] 扫描文件夹: {folder}')
    all_q = load_json_files(folder)
    print(f'\n[INFO] 合并前总计: {len(all_q)} 题')

    # 内部去重统计
    seen = set()
    internal_dup = 0
    for q in all_q:
        k = content_key(q)
        if k in seen:
            internal_dup += 1
        seen.add(k)

    merged, dups = merge_and_dedup(all_q)

    # 题型分布
    type_count = {}
    for q in merged:
        t = q.get('type', '其他')
        type_count[t] = type_count.get(t, 0) + 1

    out_path = Path(output).resolve()
    out_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f'\n[DONE] 合并完成: {out_path}')
    print(f'   重复移除:       {dups} 题')
    print(f'   最终保留:       {len(merged)} 题')
    print(f'   题型分布:       {json.dumps(type_count, ensure_ascii=False)}')


if __name__ == '__main__':
    main()
