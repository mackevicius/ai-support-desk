import json
import math
import re
from functools import lru_cache
from pathlib import Path


STOP_WORDS = {'a', 'an', 'and', 'are', 'can', 'do', 'find', 'for', 'from', 'how', 'i', 'in', 'is', 'my', 'of', 'please', 'the', 'to', 'under', 'what', 'where', 'you', 'your'}
ROOT = Path(__file__).with_name('evaluation-data')
if not ROOT.is_dir():
    ROOT = Path(__file__).parent.parent / 'api'


@lru_cache(maxsize=1)
def selected_method():
    return json.loads(Path(__file__).with_name('retrieval-results.json').read_text())['selected_method']


def terms(text):
    return {word.rstrip('s') for word in re.findall(r'[a-z]{3,}|\d+', text.lower()) if word not in STOP_WORDS}


def retrieve(question, articles, method='word_matching', question_embedding=None):
    active = [article for article in articles if not article.get('retired')]
    if method == 'embeddings':
        def score(article):
            vector = article.get('embedding')
            if not vector or not question_embedding or len(vector) != len(question_embedding):
                return 0
            denominator = math.sqrt(sum(value * value for value in vector) * sum(value * value for value in question_embedding))
            return sum(left * right for left, right in zip(vector, question_embedding)) / denominator if denominator else 0
        threshold = 0.25
    else:
        keywords = terms(question)
        def score(article):
            return len(keywords & terms(f"{article['title']} {article['body']}"))
        threshold = 0
    ranked = sorted(((score(article), article) for article in active), key=lambda item: item[0], reverse=True)
    return [article for value, article in ranked if value > threshold][:3]


@lru_cache(maxsize=1)
def comparison():
    saved = json.loads((ROOT / 'saved-embeddings.json').read_text())
    articles = json.loads((ROOT / 'starter-data.json').read_text())['articles']
    for article in articles:
        article['embedding'] = saved['vectors'][f"{article['title']}\n{article['body']}"]
    cases = json.loads((ROOT / 'retrieval-cases.json').read_text())
    for case in cases:
        for method in ('word_matching', 'embeddings'):
            found = retrieve(case['question'], articles, method, saved['vectors'][case['question']])
            case[f'{method}_hit'] = case['expected_id'] in [article['id'] for article in found]
            case[f'{method}_ids'] = [article['id'] for article in found]
    rates = {method: {'hits': sum(case[f'{method}_hit'] for case in cases), 'total': len(cases),
                      'hit_rate': sum(case[f'{method}_hit'] for case in cases) / len(cases)}
             for method in ('word_matching', 'embeddings')}
    return {**rates, 'model': saved['model'], 'metric': 'hit@3', 'cases': cases,
            'selected_method': 'embeddings' if rates['embeddings']['hit_rate'] > rates['word_matching']['hit_rate'] else 'word_matching'}