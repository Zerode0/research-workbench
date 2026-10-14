"""Derived classification tree. Edit a concept's domain; no second taxonomy database."""


def concept_tree(records):
    root = {'name': '知识分类', 'kind': 'root', 'path': [], 'count': 0, 'concepts': [], 'children': []}
    for record in records:
        path = [level.strip() for level in record.get('domain', []) if level.strip()]
        current = root
        current['count'] += 1
        if not path:
            child = next((node for node in root['children'] if node['kind'] == 'uncategorized'), None)
            if child is None:
                child = {'name': '未分类', 'kind': 'uncategorized', 'path': [], 'count': 0, 'concepts': [], 'children': []}
                root['children'].append(child)
            child['count'] += 1
            current = child
        for depth, name in enumerate(path):
            child = next((node for node in current['children'] if node['kind'] == 'category' and node['name'] == name), None)
            if child is None:
                child = {'name': name, 'kind': 'category', 'path': path[:depth + 1], 'count': 0, 'concepts': [], 'children': []}
                current['children'].append(child)
            child['count'] += 1
            current = child
        current['concepts'].append({key: record[key] for key in ('id', 'name', 'revision')})
    pending = [root]
    while pending:
        node = pending.pop()
        node['children'].sort(key=lambda child: (child['kind'] == 'uncategorized', child['name'].casefold()))
        node['concepts'].sort(key=lambda record: (record['name'].casefold(), record['id']))
        pending.extend(node['children'])
    return root
