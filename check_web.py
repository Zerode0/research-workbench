"""One browser acceptance pass against the isolated local QA server.

Run: python research-tools/check_web.py TAB_ID
Requires the installed bb-browser CLI. Never run against the real data server.
"""
import os
import subprocess
import sys
from pathlib import Path

SCRIPT = r'''(async () => {
  if (location.origin !== 'http://127.0.0.1:8876') throw Error('Expected isolated QA server');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, label) => {
    for (let i=0; i<60; i++) { if (await predicate()) return; await delay(80); }
    throw Error('Timeout: '+label);
  };
  const state = async () => (await fetch('/api/state')).json();
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const click = (text, scope=document) => {
    const button = [...scope.querySelectorAll('button')].find(b => b.textContent.trim()===text);
    if (!button) throw Error('Button missing: '+text);
    button.click();
  };
  const input = (name,value) => {
    const node = document.querySelector('dialog[open] [name="'+name+'"]');
    if (!node) throw Error('Input missing: '+name);
    node.value=value; node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true}));
  };
  const submit = async () => {
    document.querySelector('dialog[open] form').requestSubmit();
    await wait(()=>!document.querySelector('dialog[open]'),'form save');
  };
  const nav = async section => {
    document.querySelector('nav a[href="#/'+section+'"]').click();
    await wait(()=>location.hash==='#/'+section && document.querySelector('h1'),'navigation '+section);
    await delay(100);
  };
  await wait(()=>document.querySelector('.page-head'),'initial load');
  assert((await state()).ideas.length===0,'QA directory must start empty');
  click('＋ 新增 idea');
  input('title','测试：优先地图'); input('urgency','85'); input('importance','90'); input('difficulty','70');
  input('assessment','reviewed'); input('assessed_at','2026-10-13');
  input('r_urgency','测试理由：近期研究窗口'); input('r_importance','测试理由：核心问题'); input('r_difficulty','测试理由：实验条件');
  await submit();
  await wait(()=>document.querySelector('.queue-item'),'idea persisted');
  document.querySelector('.queue-item').click();
  assert(document.querySelector('.rationale-list').textContent.includes('近期研究窗口'),'scoring reasons');
  const circle=document.querySelector('.bubble circle');
  assert(Number(circle.getAttribute('cx'))>500,'urgency position');
  click('生成草稿拆解');
  await wait(async()=> (await state()).ideas[0].steps.length===3,'draft decomposition');
  await wait(()=>document.querySelectorAll('.step-item').length===3,'steps rendered');
  click('编辑步骤');
  const title=document.querySelector('.step-editor input:nth-of-type(1)');
  const fields=document.querySelector('.step-editor').querySelectorAll('input');
  fields[1].value='测试：修改后持久步骤'; fields[1].dispatchEvent(new Event('input',{bubbles:true}));
  fields[2].value='2'; fields[2].dispatchEvent(new Event('input',{bubbles:true}));
  click('保存步骤',document.querySelector('dialog[open]'));
  await wait(async()=> (await state()).ideas[0].steps[0].title==='测试：修改后持久步骤','detail step edit persisted');
  await wait(()=>document.querySelector('.step-title')?.textContent==='测试：修改后持久步骤','step refresh');
  const idea=(await state()).ideas[0];
  click('编辑',document.querySelector('.detail-panel'));
  input('notes','应保留在冲突表单中的输入');
  await fetch('/api/ideas/'+idea.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:idea.revision,notes:'另一个编辑器的更新'})});
  document.querySelector('dialog[open] form').requestSubmit();
  await wait(()=>document.querySelector('dialog[open] .form-error')?.textContent.includes('冲突'),'revision conflict shown');
  assert(document.querySelector('[name="notes"]').value==='应保留在冲突表单中的输入','conflict retained input');
  click('取消',document.querySelector('dialog[open]'));
  await nav('papers');
  click('＋ 新增文献'); input('title','测试：概念来源'); input('pdf_url','https://example.org/source.pdf'); input('abstract','测试电感');
  await submit();
  const paper=(await state()).papers[0];
  await nav('concepts');
  click('＋ 新增概念'); input('name','测试电感'); input('aliases','TestInductance'); input('domain','物理,电磁学'); input('definition','浏览器验收用记录');
  await submit();
  click('＋ 新增概念'); input('name','测试磁通'); input('domain','物理,电磁学'); input('explanation','解释中引用测试电感。');
  const sources=document.querySelector('dialog[open] textarea.json-area');
  sources.value=JSON.stringify([{paper_id:paper.id,page:2,verified_page:true,page_label:'1',locator:'测试位置'}]);
  await submit();
  await wait(()=>[...document.querySelectorAll('.concept-item')].some(b=>b.textContent.includes('测试磁通')),'concept persisted');
  [...document.querySelectorAll('.concept-item')].find(b=>b.textContent.includes('测试磁通')).click();
  await wait(()=>document.querySelector('.relation-link'),'automatic relation graph');
  assert(document.querySelector('.rel-mentioned').textContent.includes('测试电感'),'automatic mention');
  const pdf=document.querySelector('.source-list a');
  assert(pdf.href==='https://example.org/source.pdf#page=2','verified remote PDF page');
  document.querySelector('.source-link').click();
  await wait(()=>location.hash.includes('/papers/'),'source paper navigation');
  await nav('concepts');
  [...document.querySelectorAll('.concept-item')].find(b=>b.textContent.includes('测试磁通')).click();
  if (!document.querySelector('.detail-panel h2')?.textContent.includes('测试磁通')) {
    [...document.querySelectorAll('.concept-item')].find(b=>b.textContent.includes('测试磁通')).click();
  }
  await wait(()=>document.querySelector('.relation-link'),'graph available');
  document.querySelector('.relation-link').dispatchEvent(new MouseEvent('click',{bubbles:true}));
  await wait(()=>document.querySelector('.detail-panel h2')?.textContent==='测试电感','graph click opens concept');
  await nav('papers');
  document.querySelector('.concept-item').click();
  click('上传 PDF');
  const upload=document.querySelector('input[type="file"]');
  const transfer=new DataTransfer(); transfer.items.add(new File(['%PDF-1.4\n%%EOF\n'],'qa.pdf',{type:'application/pdf'}));
  upload.files=transfer.files; upload.dispatchEvent(new Event('change',{bubbles:true}));
  await wait(async()=> (await state()).papers[0].local_pdf,'PDF upload');
  const local=(await state()).papers[0];
  assert((await fetch('/pdf/'+local.id+'.pdf')).status===200,'local PDF served');
  await nav('ideas');
  document.querySelector('.queue-item').click();
  if (!document.querySelector('.detail-panel .rationale-list')) document.querySelector('.queue-item').click();
  return 'PASS: browser create/save, map/reasons, step edits, conflict handling, domain groups, concept graph, source navigation, PDF pages/upload';
})().catch(error => 'FAIL: '+error.message)'''


def main():
    if len(sys.argv) not in (2, 3):
        raise SystemExit('Usage: python research-tools/check_web.py TAB_ID [--pdf-only]')
    cli = Path(os.environ['APPDATA']) / 'npm/node_modules/bb-browser/dist/cli.js'
    script = SCRIPT
    if len(sys.argv) == 3 and sys.argv[2] == '--pdf-only':
        script = SCRIPT[:SCRIPT.index("  await wait(()=>document.querySelector('.page-head')")] + SCRIPT[SCRIPT.rindex("  await nav('papers');"):]
    result = subprocess.run(['node', str(cli), 'eval', script, '--tab', sys.argv[1]],
                            capture_output=True, encoding='utf-8', errors='replace', timeout=60)
    print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    if result.returncode or 'PASS:' not in result.stdout:
        raise SystemExit(1)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main()
