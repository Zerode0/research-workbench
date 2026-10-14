"""Bounded bibliographic search; records are candidates until explicitly saved."""
import hashlib
import json
import os
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from core import Problem, now


def fetch(endpoint):
    request = Request(endpoint, headers={'User-Agent': 'LocalResearchWorkbench/1.0', 'Accept': 'application/json'})
    with urlopen(request, timeout=15) as response:
        value = json.load(response)
    if not isinstance(value, dict):
        raise ValueError('返回数据不是对象')
    return value


def paper_id(value):
    return 'paper-' + hashlib.sha256(value.encode()).hexdigest()[:16]


def abstract_text(index):
    if not isinstance(index, dict):
        return ''
    words = {}
    for word, positions in index.items():
        if isinstance(positions, list):
            for pos in positions:
                if type(pos) is int and 0 <= pos < 200000:
                    words[pos] = word
    return ' '.join(str(words[pos]) for pos in sorted(words))


def search(query, provider='openalex', recent=False):
    query = query.strip()
    if not query or len(query) > 500:
        raise Problem('请输入 1–500 字符的检索词')
    if provider not in ('openalex', 'crossref'):
        raise Problem('检索源应为 openalex 或 crossref')
    stamp = now()
    warnings = []
    try:
        if provider == 'openalex':
            try:
                results, endpoint = openalex(query, recent, stamp)
            except Exception:
                warnings.append('OpenAlex 请求失败，已回退到 Crossref；PDF 开放获取链接可能缺失。')
                provider = 'crossref'
                results, endpoint = crossref(query, recent, stamp)
        else:
            results, endpoint = crossref(query, recent, stamp)
    except Exception:
        # Avoid returning an exception that might contain credential-bearing URLs.
        raise Problem('文献服务暂不可用；请稍后重试或让聊天 AI 使用 paper-lookup 检索', 502)
    return {'provider': provider, 'query': query, 'retrieved_at': stamp,
            'results': results, 'warnings': warnings, 'endpoint': endpoint}


def openalex(query, recent, stamp):
    params = {'search': query, 'per_page': 12}
    if recent:
        params['sort'] = 'publication_date:desc'
    public_endpoint = 'https://api.openalex.org/works?' + urlencode(params)
    if os.environ.get('OPENALEX_API_KEY'):
        params['api_key'] = os.environ['OPENALEX_API_KEY']
    payload = fetch('https://api.openalex.org/works?' + urlencode(params))
    if not isinstance(payload.get('results'), list):
        raise ValueError('OpenAlex results 缺失')
    results = []
    for work in payload['results']:
        if not isinstance(work, dict) or not work.get('id') or not work.get('title'):
            continue
        locations = [work.get('best_oa_location'), work.get('primary_location'), *work.get('locations', [])]
        pdf = next((loc.get('pdf_url') for loc in locations if isinstance(loc, dict) and loc.get('pdf_url')), '')
        doi = (work.get('doi') or '').removeprefix('https://doi.org/')
        source = (work.get('primary_location') or {}).get('source') or {}
        results.append({'id': paper_id(doi.casefold() or work['id']), 'title': work['title'],
                        'kind': 'paper', 'authors': [a.get('author', {}).get('display_name', '') for a in work.get('authorships', [])],
                        'year': work.get('publication_year'), 'doi': doi, 'url': work.get('doi') or work['id'],
                        'pdf_url': pdf, 'venue': source.get('display_name', ''),
                        'abstract': abstract_text(work.get('abstract_inverted_index')),
                        'provenance': {'provider': 'openalex', 'query': query, 'retrieved_at': stamp, 'endpoint': public_endpoint},
                        'notes': '检索候选，相关性尚待核实' + ('；数据库标记为撤稿' if work.get('is_retracted') else '')})
    return results, public_endpoint


def crossref(query, recent, stamp):
    params = {'query': query, 'rows': 12}
    if recent:
        params.update(sort='published', order='desc')
    endpoint = 'https://api.crossref.org/works?' + urlencode(params)
    payload = fetch(endpoint)
    if payload.get('status') != 'ok' or not isinstance(payload.get('message', {}).get('items'), list):
        raise ValueError('Crossref 响应格式异常')
    results = []
    for item in payload['message']['items']:
        doi, titles = item.get('DOI'), item.get('title') or []
        if not doi or not titles:
            continue
        parts = (item.get('published') or item.get('issued') or {}).get('date-parts') or [[]]
        year = parts[0][0] if parts[0] else None
        pdf = next((link.get('URL', '') for link in item.get('link', []) if link.get('content-type') == 'application/pdf'), '')
        results.append({'id': paper_id(doi.casefold()), 'title': titles[0], 'kind': 'textbook' if item.get('type') in ('book', 'monograph') else 'paper',
                        'authors': [' '.join(filter(None, [a.get('given'), a.get('family')])) for a in item.get('author', [])],
                        'year': year, 'doi': doi, 'url': item.get('URL') or 'https://doi.org/' + doi,
                        'pdf_url': pdf, 'venue': (item.get('container-title') or [''])[0],
                        'abstract': re.sub(r'<[^>]*>', '', item.get('abstract') or ''),
                        'provenance': {'provider': 'crossref', 'query': query, 'retrieved_at': stamp, 'endpoint': endpoint},
                        'notes': '检索候选，相关性和 PDF 可访问性尚待核实'})
    return results, endpoint
