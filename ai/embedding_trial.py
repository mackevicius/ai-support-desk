import json
import sys

from retrieval import retrieve


def evaluate_run(dataset, run):
    articles = [
        {**article, 'embedding': run['documents'][str(article['id'])]}
        for article in dataset['articles']
    ]
    evaluations = []
    for step in range(25, 96, 5):
        threshold = step / 100
        cases = []
        for case in dataset['cases']:
            found = retrieve(
                case['question'], articles, 'embeddings',
                run['questions'][case['id']], embedding_threshold=threshold,
            )
            found_ids = [article['id'] for article in found]
            cases.append({**case, 'found_ids': found_ids, 'hit': case['expected_id'] in found_ids})
        negatives = []
        for case in dataset['negatives']:
            found = retrieve(
                case['question'], articles, 'embeddings',
                run['negatives'][case['id']], embedding_threshold=threshold,
            )
            negatives.append({**case, 'found_ids': [article['id'] for article in found]})
        evaluations.append({
            'threshold': threshold,
            'hits': sum(case['hit'] for case in cases),
            'total': len(cases),
            'negative_matches': sum(bool(case['found_ids']) for case in negatives),
            'negative_total': len(negatives),
            'cases': cases,
            'negatives': negatives,
        })
    safe = [result for result in evaluations if result['negative_matches'] == 0]
    return {
        'config': run['config'],
        'measurements': run['measurements'],
        'current': evaluations[0],
        'calibrated': max(safe, key=lambda result: (result['hits'], -result['threshold']), default=None),
        'thresholds': [
            {key: result[key] for key in ('threshold', 'hits', 'total', 'negative_matches', 'negative_total')}
            for result in evaluations
        ],
    }


def trial_report(payload):
    dataset = payload['dataset']
    word_cases = []
    for case in dataset['cases']:
        found_ids = [article['id'] for article in retrieve(case['question'], dataset['articles'])]
        word_cases.append({**case, 'found_ids': found_ids, 'hit': case['expected_id'] in found_ids})
    return {
        'schema_version': 1,
        'environment': payload.get('environment', {}),
        'dataset': {
            'article_count': len(dataset['articles']),
            'cases': dataset['cases'],
            'negatives': dataset['negatives'],
            'fingerprints': dataset.get('fingerprints', {}),
        },
        'metric': 'hit@3',
        'word_matching': {
            'hits': sum(case['hit'] for case in word_cases),
            'total': len(word_cases),
            'cases': word_cases,
        },
        'models': [evaluate_run(dataset, run) for run in payload['runs']],
    }


if __name__ == '__main__':
    json.dump(trial_report(json.load(sys.stdin)), sys.stdout, indent=2)
    sys.stdout.write('\n')