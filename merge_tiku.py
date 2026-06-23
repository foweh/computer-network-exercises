"""
题库JSON合并去重工具
=====================
用法:
  python merge_tiku.py                          # 扫描 tiku/ 全部JSON → merged.json
  python merge_tiku.py tiku/ merged.json        # 同上，显式指定
  python merge_tiku.py --add 新下载.json         # 把新文件合并进现有 merged.json

去重策略：归一化(题干) + 题型 + 归一化(正确答案) 作为唯一key
qid 不可靠 — 同一道题在不同考试中 qid 不同
"""
import json
import sys
import os
from pathlib import Path


def normalize(s):
    if not s:
        return ''
    return ' '.join(s.replace('\n', ' ').replace('\t', ' ').replace('\r', ' ').split())


def content_key(q):
    return (normalize(q.get('stem', '')), normalize(q.get('type', '')), normalize(q.get('answer', '')))


def load_json_files(folder):
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
                print(f'  [SKIP] {f.name} -> 不是数组')
        except json.JSONDecodeError as e:
            print(f'  [SKIP] {f.name} -> JSON解析失败: {e}')
    return all_questions


def merge_and_dedup(all_questions):
    seen = {}     # key -> index in merged
    merged = []
    dup_count = 0
    upgraded = 0
    for q in all_questions:
        k = content_key(q)
        if k not in seen:
            seen[k] = len(merged)
            merged.append(q)
        else:
            dup_count += 1
            existing = merged[seen[k]]
            changed = False
            # 新副本数据更完整就替换
            if q.get('analysis') and not existing.get('analysis'):
                existing['analysis'] = q['analysis']
                changed = True
            if q.get('options') and not existing.get('options'):
                existing['options'] = q['options']
                changed = True
            if q.get('difficulty') and not existing.get('difficulty'):
                existing['difficulty'] = q['difficulty']
                changed = True
            if changed:
                upgraded += 1
    return merged, dup_count, upgraded


def main():
    # --add 模式: 追加新文件到现有 merged.json
    if len(sys.argv) >= 2 and sys.argv[1] == '--add':
        new_files = sys.argv[2:]
        base_path = Path('merged.json')
        if not base_path.exists():
            print('[ERROR] merged.json 不存在，请先执行一次完整合并')
            sys.exit(1)

        base = json.loads(base_path.read_text(encoding='utf-8'))
        print(f'[BASE] merged.json: {len(base)} 题')

        new_all = []
        for f in new_files:
            fp = Path(f)
            if not fp.exists():
                print(f'  [SKIP] 文件不存在: {f}')
                continue
            try:
                data = json.loads(fp.read_text(encoding='utf-8'))
                if isinstance(data, list):
                    new_all.extend(data)
                    print(f'  [OK] {fp.name} -> {len(data)} 题')
            except json.JSONDecodeError as e:
                print(f'  [SKIP] {fp.name} -> JSON解析失败: {e}')

        if not new_all:
            print('[DONE] 没有新题，无需合并')
            return

        # 已存在的key
        seen = {}
        for i, q in enumerate(base):
            seen[content_key(q)] = i

        added = 0
        dup_count = 0
        for q in new_all:
            k = content_key(q)
            if k not in seen:
                seen[k] = len(base)
                base.append(q)
                added += 1
            else:
                dup_count += 1
                # 补充缺失字段
                existing = base[seen[k]]
                if q.get('analysis') and not existing.get('analysis'):
                    existing['analysis'] = q['analysis']
                if q.get('options') and not existing.get('options'):
                    existing['options'] = q['options']

        base_path.write_text(json.dumps(base, ensure_ascii=False, indent=2), encoding='utf-8')

        type_count = {}
        for q in base:
            t = q.get('type', '其他')
            type_count[t] = type_count.get(t, 0) + 1

        print(f'\n[DONE] merged.json 已更新: {base_path.resolve()}')
        print(f'   新增:           {added} 题')
        print(f'   重复跳过:       {dup_count} 题')
        print(f'   题库总量:       {len(base)} 题')
        print(f'   题型分布:       {json.dumps(type_count, ensure_ascii=False)}')
        return

    # 全量模式
    folder = sys.argv[1] if len(sys.argv) > 1 else 'tiku'
    output = sys.argv[2] if len(sys.argv) > 2 else 'merged.json'

    print(f'[SCAN] 扫描文件夹: {folder}')
    all_q = load_json_files(folder)
    print(f'\n[INFO] 合并前总计: {len(all_q)} 题')

    merged, dups, upgraded = merge_and_dedup(all_q)

    type_count = {}
    for q in merged:
        t = q.get('type', '其他')
        type_count[t] = type_count.get(t, 0) + 1

    out_path = Path(output).resolve()
    out_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f'\n[DONE] 合并完成: {out_path}')
    print(f'   重复移除:       {dups} 题')
    print(f'   字段补齐:       {upgraded} 题')
    print(f'   最终保留:       {len(merged)} 题')
    print(f'   题型分布:       {json.dumps(type_count, ensure_ascii=False)}')


if __name__ == '__main__':
    main()
